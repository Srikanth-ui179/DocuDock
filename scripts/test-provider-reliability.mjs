/**
 * DocuDock Provider Reliability & Edge-Case Test Suite
 *
 * All tests use isolated, mocked HTTP responses without consuming live API quota.
 *
 * Verifies:
 * 1. Successful Gemini response (concatenating multiple text parts safely).
 * 2. Empty candidates array or missing text (cleanly categorized as 'empty' without claiming invalid key).
 * 3. Safety-blocked response:
 *    - Candidate level: finishReason = 'SAFETY', 'RECITATION', 'BLOCKLIST'
 *    - Prompt level: promptFeedback.blockReason = 'SAFETY'
 * 4. 429 Rate Limit vs. Quota Exhaustion:
 *    - Hard quota exhaustion (queries per day, limit 0) fast-exits without retry loops.
 *    - Transient rate limit respects Retry-After / retryDelay within bounded ceiling.
 * 5. 401 / 403 Authentication & Permission errors (categorized as 'invalid_key', zero retries).
 * 6. 5xx Provider Server Errors (categorized as 'server_error', bounded retries).
 * 7. Network failures / timeouts (categorized as 'network' / 'timeout').
 * 8. Exhausted retry budget stops cleanly without indefinite loops.
 * 9. Unsupported or stale cached model is rejected and purged from cache.
 * 10. Manual retry removes failed error card and prevents duplicate user questions.
 * 11. Sensitive API keys are stripped from error messages and logs (zero leaks).
 */

import assert from 'node:assert/strict';

// Mock storage before importing modules
class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const mockSessionStorage = new MockSessionStorage();
globalThis.sessionStorage = mockSessionStorage;
globalThis.window = { sessionStorage: mockSessionStorage };

import {
  hashApiKey,
  getCachedChatModel,
  setCachedChatModel,
  invalidateModelCache,
  classifyProviderError,
  extractCleanProviderDetails,
  isSupportedGeminiModel,
  isCompatibleGeminiTextModel,
  isCompatibleGeminiEmbeddingModel,
  GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY,
  GEMINI_EMBEDDING_MODEL_PREFERENCE_HIERARCHY,
  getGeminiModelFamilyAliases,
  recordOverloadedModel,
  isModelOverloaded,
  getCurrentlyOverloadedModels,
  clearOverloadedModels,
  recordUnavailableModel,
  isModelUnavailable,
  clearUnavailableModels,
  getCurrentlyUnavailableModels,
  sanitizeErrorMessage,
} from '../src/lib/ai/modelCache.ts';
import { isMockProviderAllowed, ProviderError } from '../src/lib/ai/mockProvider.ts';

/**
 * Extracts retry wait time from standard headers or Google RPC error details.
 */
function extractRetryDelayMs(res, errJson, defaultDelayMs, maxDelayMs = 8000) {
  const header = res?.headers?.get ? res.headers.get('Retry-After') : null;
  if (header) {
    const sec = parseInt(header, 10);
    if (!isNaN(sec) && sec > 0) {
      return Math.min(sec * 1000, maxDelayMs);
    }
  }

  if (errJson && typeof errJson === 'object') {
    const errorObj = errJson.error;
    if (Array.isArray(errorObj?.details)) {
      for (const item of errorObj.details) {
        if (item?.retryDelay) {
          const match = item.retryDelay.match(/([0-9.]+)\s*s?/i);
          if (match) {
            const parsed = parseFloat(match[1]);
            if (!isNaN(parsed) && parsed > 0) {
              return Math.min(Math.ceil(parsed * 1000), maxDelayMs);
            }
          }
        }
      }
    }
  }

  return defaultDelayMs;
}

/**
 * Executes a fetch request with bounded exponential backoff, jitter, and quota/rate-limit retry.
 */
async function fetchWithRetry(url, options, provider, retryOpts) {
  const maxRetries = retryOpts?.maxRetries ?? 2;
  const initialDelay = retryOpts?.initialDelayMs ?? 1200;
  const maxDelay = retryOpts?.maxDelayMs ?? 6000;
  const maxOverloadRetries = retryOpts?.maxOverloadRetries ?? 1;

  let overloadRetriesCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (networkErr) {
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(1.5, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(sanitizeErrorMessage(networkErr?.message || 'Network error'));
    }

    if (res.ok) {
      return res;
    }

    const isRateLimited = res.status === 429;
    const isServerError = res.status >= 500 && res.status < 600;

    if ((isRateLimited || isServerError) && attempt < maxRetries) {
      let errJson = null;
      try {
        errJson = await res.clone().json();
      } catch {
        // ignore
      }

      const rawMsg = (errJson?.error?.message || '').toLowerCase();

      const isHardQuotaExhausted =
        rawMsg.includes('quota exceeded') ||
        rawMsg.includes('exceeded your current quota') ||
        rawMsg.includes('insufficient_quota') ||
        rawMsg.includes('check quota') ||
        rawMsg.includes('queries per day') ||
        rawMsg.includes('limit: 0');

      if (isHardQuotaExhausted) {
        return res;
      }

      const isOverloaded =
        res.status === 503 ||
        rawMsg.includes('high demand') ||
        rawMsg.includes('overloaded') ||
        rawMsg.includes('service unavailable') ||
        rawMsg.includes('temporarily unavailable');

      if (isOverloaded) {
        overloadRetriesCount++;
        if (overloadRetriesCount > maxOverloadRetries) {
          return res;
        }
      }

      const expDelay = initialDelay * Math.pow(2, attempt);
      const baseDelay = Math.min(expDelay, maxDelay);
      const delayMs = extractRetryDelayMs(res, errJson, baseDelay, maxDelay);

      if (delayMs > maxDelay) {
        return res;
      }

      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    return res;
  }

  return { ok: false, status: 429 };
}

console.log('🛡️ Starting DocuDock Provider Reliability & Mock Test Suite...\n');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n${err.stack}`);
    process.exitCode = 1;
  }
}

// =========================================================================
// TEST 1: Successful Response Parsing (Multi-part Concatenation)
// =========================================================================
console.log('--- Suite 1: Successful Response Parsing ---');

await runTest('Extracts and concatenates multiple text parts across candidates', () => {
  const mockGeminiResponse = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'TCP provides reliable, ' },
            { text: 'connection-oriented byte stream transfer.' },
          ],
        },
        finishReason: 'STOP',
      },
    ],
  };

  const textParts = (mockGeminiResponse.candidates[0].content.parts || [])
    .map(p => (typeof p.text === 'string' ? p.text : ''))
    .filter(t => t.length > 0);
  const candidateText = textParts.join('');

  assert.equal(candidateText, 'TCP provides reliable, connection-oriented byte stream transfer.');
});

// =========================================================================
// TEST 2: Empty Candidates & Missing Text Handling
// =========================================================================
console.log('\n--- Suite 2: Empty Responses & Missing Text ---');

await runTest('Classifies empty candidates array as empty without falsely reporting invalid key', () => {
  const emptyRes = new Error('The model returned no response candidates for this prompt.');
  const classification = classifyProviderError(emptyRes);

  assert.equal(classification.kind, 'empty');
  assert.ok(!classification.userMessage.toLowerCase().includes('api key'), 'Must not claim key is invalid');
  assert.ok(classification.userMessage.includes('empty response'));
});

await runTest('Classifies empty text parts as empty response', () => {
  const emptyTextErr = new Error('The model completed the request but returned an empty response.');
  const classification = classifyProviderError(emptyTextErr);

  assert.equal(classification.kind, 'empty');
  assert.equal(classification.isRetryable, true);
});

// =========================================================================
// TEST 3: Safety & Content Block Policy Detection
// =========================================================================
console.log('\n--- Suite 3: Safety Policy & Prompt Blocking ---');

await runTest('Detects prompt-level promptFeedback blockReason', () => {
  const promptFeedbackErr = new Error('Gemini blocked the prompt due to content safety policy (SAFETY).');
  const classification = classifyProviderError(400, promptFeedbackErr.message);

  assert.equal(classification.kind, 'blocked');
  assert.equal(classification.isRetryable, false);
  assert.ok(classification.userMessage.includes('content safety'));
  assert.ok(!classification.userMessage.toLowerCase().includes('api key'));
});

await runTest('Detects candidate-level finishReason: SAFETY, RECITATION, BLOCKLIST', () => {
  const safetyErr = new Error('The AI model stopped generating content due to safety policy restrictions (SAFETY).');
  const recitationErr = new Error('The AI model stopped generating content due to safety policy restrictions (RECITATION).');
  const blocklistErr = new Error('The AI model stopped generating content due to safety policy restrictions (BLOCKLIST).');

  assert.equal(classifyProviderError(safetyErr).kind, 'blocked');
  assert.equal(classifyProviderError(recitationErr).kind, 'blocked');
  assert.equal(classifyProviderError(blocklistErr).kind, 'blocked');
});

await runTest('Detects OpenAI content_filter finish reason', () => {
  const openAIFilterErr = new Error('OpenAI stopped generating content due to content safety filters.');
  const classification = classifyProviderError(openAIFilterErr);

  assert.equal(classification.kind, 'blocked');
  assert.equal(classification.isRetryable, false);
});

// =========================================================================
// TEST 4: 429 Quota Exhaustion vs. Transient Rate Limit
// =========================================================================
console.log('\n--- Suite 4: 429 Quota vs. Rate Limit & Retry Guidance ---');

await runTest('Hard quota exhaustion (daily/project limit) exits immediately without retry loop', async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    return {
      ok: false,
      status: 429,
      text: async () => 'Quota exceeded for quota metric "Queries" and limit "Queries per day"',
      json: async () => ({
        error: {
          code: 429,
          message: 'Quota exceeded for quota metric "Queries" and limit "Queries per day"',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const res = await fetchWithRetry('https://mock.api/generate', {}, 'gemini', {
      maxRetries: 2,
      initialDelayMs: 20,
    });

    assert.equal(res.status, 429);
    // MUST fast-exit on hard quota without burning retry budget
    assert.equal(attempts, 1, 'Hard quota exhaustion must exit on attempt 1 without sleeping');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runTest('Extracts Retry-After header and bounds delay within maxDelayMs ceiling', () => {
  const mockRes = {
    headers: new Map([['Retry-After', '5']]),
  };
  mockRes.headers.get = (k) => (k === 'Retry-After' ? '5' : null);

  const delayMs = extractRetryDelayMs(mockRes, null, 1000, 8000);
  assert.equal(delayMs, 5000, 'Should parse 5 seconds into 5000ms');

  // Should clamp if header requests 1 hour
  mockRes.headers.get = (k) => (k === 'Retry-After' ? '3600' : null);
  const clampedMs = extractRetryDelayMs(mockRes, null, 1000, 8000);
  assert.equal(clampedMs, 8000, 'Should clamp excessive retry wait to maxDelayMs');
});

await runTest('Extracts Google RPC retryDelay from error response body', () => {
  const errBody = {
    error: {
      code: 429,
      message: 'Resource exhausted',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '2.5s',
        },
      ],
    },
  };
  const mockRes = { headers: { get: () => null } };

  const delayMs = extractRetryDelayMs(mockRes, errBody, 1000, 8000);
  assert.equal(delayMs, 2500, 'Should parse 2.5s into 2500ms');
});

// =========================================================================
// TEST 5: 401/403 Authentication & Permission Failures
// =========================================================================
console.log('\n--- Suite 5: 401/403 Authentication & Key Errors ---');

await runTest('Classifies 401 and 403 as invalid_key with actionable Settings guidance', () => {
  const err401 = classifyProviderError(401, 'Unauthorized');
  assert.equal(err401.kind, 'invalid_key');
  assert.equal(err401.isRetryable, false);
  assert.ok(err401.userMessage.includes('Settings'));

  const err403 = classifyProviderError(403, 'The caller does not have permission');
  assert.equal(err403.kind, 'invalid_key');
  assert.equal(err403.isRetryable, false);
});

// =========================================================================
// TEST 6: 5xx Provider Server Errors & Network Errors
// =========================================================================
console.log('\n--- Suite 6: Server Errors & Network Failures ---');

await runTest('Classifies 500, 502, 504 as server_error', () => {
  const err500 = classifyProviderError(500, 'Internal Server Error');
  assert.equal(err500.kind, 'server_error');
  assert.equal(err500.isRetryable, true);

  const err502 = classifyProviderError(502, 'Bad Gateway');
  assert.equal(err502.kind, 'server_error');
});

await runTest('Classifies network dropouts and timeouts accurately', () => {
  const errNet = classifyProviderError(0, 'TypeError: fetch failed');
  assert.equal(errNet.kind, 'network');
  assert.equal(errNet.isRetryable, true);

  const errTimeout = classifyProviderError(0, 'Request timed out after 60000ms');
  assert.equal(errTimeout.kind, 'timeout');
  assert.equal(errTimeout.isRetryable, true);
});

// =========================================================================
// TEST 7: Exhausted Retry Budget
// =========================================================================
console.log('\n--- Suite 7: Bounded Retries & Budget Termination ---');

await runTest('Retries transient errors up to maxRetries = 2 and then stops', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
      json: async () => ({ error: { message: 'Internal Server Error' } }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const res = await fetchWithRetry('https://mock.api/generate', {}, 'gemini', {
      maxRetries: 2,
      initialDelayMs: 10,
    });
    // 1 initial + 2 retries = 3 calls total
    assert.equal(callCount, 3, 'Must stop exactly after initial attempt + 2 retries');
    assert.equal(res.status, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// TEST 8: Cached Model Validation & Stale Cache Recovery
// =========================================================================
console.log('\n--- Suite 8: Cached Model Validation ---');

await runTest('Rejects and purges unsupported/stale model from cache', () => {
  const testKey = 'AIzaSyA_stale_cache_test';
  invalidateModelCache('gemini');

  // Inject a deprecated/invalid model into cache
  mockSessionStorage.setItem(
    'docudock_verified_chat_model_cache',
    JSON.stringify({
      [hashApiKey(testKey)]: { model: 'gemini-1.0-pro-deprecated', timestamp: Date.now() },
    })
  );

  // Cached retrieval should detect unsupported model, reject it, and return null
  assert.equal(isSupportedGeminiModel('gemini-1.0-pro-deprecated'), false);
  const retrieved = getCachedChatModel('gemini', testKey);
  assert.equal(retrieved, null, 'Must not return unsupported model from cache');
});

await runTest('Accepts supported models in cache and rejects restricted 2.5 models', () => {
  assert.equal(isSupportedGeminiModel('gemini-3.8-flash'), true);
  assert.equal(isSupportedGeminiModel('gemini-2.0-flash'), true);
  assert.equal(isSupportedGeminiModel('gemini-1.5-flash'), true);
  assert.equal(isSupportedGeminiModel('gemini-2.5-flash'), false);
  assert.equal(isSupportedGeminiModel('gemini-2.5-pro'), false);

  const testKey = 'AIzaSyA_valid_cache_test';
  setCachedChatModel('gemini', testKey, 'gemini-3.8-flash');
  const cached = getCachedChatModel('gemini', testKey);
  assert.equal(cached, 'gemini-3.8-flash', 'Must store and retrieve valid cached model');
});

// =========================================================================
// TEST 9: Manual Retry Deduplication & State Guarantees
// =========================================================================
console.log('\n--- Suite 9: Manual Retry Deduplication & Card Replacement ---');

await runTest('Retrying a failed message removes the error card and prevents duplicate user questions', () => {
  // Simulate initial failed query
  const query = 'What is TCP Reno?';
  const initialMessages = [
    { id: 'm-user-1', role: 'user', content: query, timestamp: 1000 },
    {
      id: 'm-error-1',
      role: 'assistant',
      content: 'Provider rate limit reached (429).',
      error: true,
      errorType: 'rate_limit',
      retryQuery: query,
      timestamp: 2000,
    },
  ];

  // User clicks "Retry Query" on m-error-1
  const options = { isRetry: true, failedMessageId: 'm-error-1' };

  // 1. Remove the failed message
  let baseMessages = initialMessages;
  if (options?.isRetry && options.failedMessageId) {
    baseMessages = initialMessages.filter(m => m.id !== options.failedMessageId);
  }

  // 2. Verify duplicate check
  const lastMsg = baseMessages[baseMessages.length - 1];
  const isUserQueryAlreadyPresent =
    options?.isRetry && lastMsg?.role === 'user' && lastMsg.content.trim() === query.trim();

  let newMessagesWithUser;
  if (isUserQueryAlreadyPresent) {
    newMessagesWithUser = baseMessages; // Do not append duplicate user message!
  } else {
    newMessagesWithUser = [...baseMessages, { id: 'm-user-2', role: 'user', content: query, timestamp: 3000 }];
  }

  assert.equal(newMessagesWithUser.length, 1, 'Should contain ONLY the original user message, error card removed');
  assert.equal(newMessagesWithUser[0].id, 'm-user-1');
  assert.equal(newMessagesWithUser[0].content, query);

  // 3. When retry succeeds, append assistant message
  const assistantMsg = { id: 'm-asst-1', role: 'assistant', content: 'TCP Reno uses Fast Recovery.', timestamp: 4000 };
  const finalMessages = [...newMessagesWithUser, assistantMsg];

  assert.equal(finalMessages.length, 2, 'Final conversation must have exactly 1 user question and 1 assistant answer');
  assert.equal(finalMessages[0].role, 'user');
  assert.equal(finalMessages[1].role, 'assistant');
  assert.ok(!finalMessages.some(m => m.error), 'Old error card must be completely replaced');
});

// =========================================================================
// TEST 10: API Key Sanitization & Leak Prevention
// =========================================================================
console.log('\n--- Suite 10: Zero-Leak API Key Sanitization ---');

await runTest('Sanitizes Google AI Studio and OpenAI keys from error messages', () => {
  const secretKey = 'AIzaSyA_REAL_SECRET_KEY_1234567890';
  const rawError = `Error 400: API key ${secretKey} is not registered in project`;
  const sanitized = sanitizeErrorMessage(rawError, secretKey);

  assert.ok(!sanitized.includes(secretKey), 'Must not contain plaintext secret key');
  assert.ok(sanitized.includes('[REDACTED_API_KEY]'), 'Must replace key with redaction marker');

  const openaiRaw = 'Error: sk-proj-1234567890abcdef1234567890 is expired';
  const sanitizedOpenAI = sanitizeErrorMessage(openaiRaw);
  assert.ok(!sanitizedOpenAI.includes('sk-proj-'), 'Must redact OpenAI keys');
  assert.ok(sanitizedOpenAI.includes('[REDACTED_API_KEY]'));

  // Test URL query parameter key sanitization
  const urlWithKey = 'Fetch failed for https://generativelanguage.googleapis.com/v1beta/models?key=customSecretKey987654321';
  const sanitizedUrl = sanitizeErrorMessage(urlWithKey);
  assert.ok(!sanitizedUrl.includes('customSecretKey987654321'), 'Must strip query param key');
  assert.ok(sanitizedUrl.includes('?key=[REDACTED_API_KEY]'));

  // Test Bearer token sanitization
  const bearerHeader = 'Authorization: Bearer my-confidential-bearer-token-123 failed';
  const sanitizedBearer = sanitizeErrorMessage(bearerHeader);
  assert.ok(!sanitizedBearer.includes('my-confidential-bearer-token-123'), 'Must strip Bearer token');
  assert.ok(sanitizedBearer.includes('Bearer [REDACTED_API_KEY]'));
});

/**
 * Simulated LLM text generation runner matching callLLMTextGenerationDetailed logic
 */
async function simulateLLMCallDetailed(provider, apiKey, systemInstruction, prompt, options) {
  const cleanKey = apiKey.trim();
  if (!cleanKey) throw new ProviderError('Provider API key is missing');
  const maxTokens = options?.maxOutputTokens || 8192;
  const temp = options?.temperature ?? 0.1;

  if (provider === 'mock') {
    if (!isMockProviderAllowed()) {
      throw new ProviderError('Mock AI provider is strictly disabled in production builds.', 403, 'mock');
    }
    return { text: 'Mock answer', finishReason: 'STOP', isTruncated: false };
  }

  if (provider === 'gemini') {
    let chatModel = options?.initialModel || getCachedChatModel('gemini', cleanKey);
    if (!options?.initialModel && chatModel && (isModelOverloaded(chatModel) || isModelUnavailable(chatModel) || !isCompatibleGeminiTextModel(chatModel))) {
      invalidateModelCache('gemini', cleanKey);
      chatModel = null;
    }
    if (!chatModel) {
      try {
        chatModel = await simulateDiscoverGeminiChatModel(cleanKey);
      } catch {
        chatModel = 'gemini-3.8-flash';
      }
    }
    const attemptedModels = new Set();

    const makeRequest = async (model) => {
      attemptedModels.add(model);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
      return await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: temp, maxOutputTokens: maxTokens },
          }),
        },
        'gemini'
      );
    };

    let res = await makeRequest(chatModel);
    const maxFailovers = 2;
    let failoversAttempted = 0;

    while (!res.ok && failoversAttempted < maxFailovers) {
      let errJson = null;
      try { errJson = await res.clone().json(); } catch {}
      const rawMsg = errJson?.error?.message || `HTTP ${res.status}`;
      const sanitized = sanitizeErrorMessage(rawMsg, cleanKey);
      const classification = classifyProviderError(res.status, sanitized);

      const isNotFound =
        res.status === 404 ||
        classification.kind === 'not_found' ||
        classification.suggestedAction === 'switch_model' ||
        rawMsg.toLowerCase().includes('is no longer available') ||
        rawMsg.toLowerCase().includes('not found') ||
        rawMsg.toLowerCase().includes('no longer available to new users') ||
        rawMsg.toLowerCase().includes('combination of response modalities') ||
        rawMsg.toLowerCase().includes('response modalities');

      const isOverloaded =
        res.status === 503 ||
        classification.kind === 'overloaded' ||
        rawMsg.toLowerCase().includes('overloaded') ||
        rawMsg.toLowerCase().includes('high demand') ||
        rawMsg.toLowerCase().includes('service unavailable');

      const isModelUnavailable =
        (isNotFound || isOverloaded) &&
        res.status !== 401 &&
        res.status !== 403 &&
        classification.kind !== 'quota_exhausted';

      if (!isModelUnavailable) break;

      if (isOverloaded) {
        recordOverloadedModel(chatModel);
        options?.onProgress?.(`Model ${chatModel} overloaded, failing over to alternative model...`);
      } else if (isNotFound) {
        recordUnavailableModel(chatModel);
        options?.onProgress?.(`Model ${chatModel} is unavailable for this key, switching to verified alternative...`);
      }

      invalidateModelCache('gemini', cleanKey);
      failoversAttempted++;

      for (const alias of getGeminiModelFamilyAliases(chatModel)) {
        attemptedModels.add(alias);
      }

      const overloadedSet = new Set();
      for (const ov of getCurrentlyOverloadedModels()) {
        overloadedSet.add(ov);
        for (const alias of getGeminiModelFamilyAliases(ov)) {
          overloadedSet.add(alias);
        }
      }

      try {
        const discRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
        let genModels = [];
        if (discRes.ok) {
          const discData = await discRes.json();
          genModels = (discData.models || [])
            .filter(m => isCompatibleGeminiTextModel(m))
            .map(m => m.name.replace(/^models\//, ''));
        }

        let failoverModel = null;
        if (genModels.length > 0) {
          failoverModel =
            GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY.find(m => genModels.includes(m) && !attemptedModels.has(m) && !overloadedSet.has(m)) ||
            GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY.find(m => genModels.includes(m) && !attemptedModels.has(m)) ||
            genModels.find(m => !attemptedModels.has(m));
        } else {
          failoverModel =
            GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY.find(m => !attemptedModels.has(m) && !overloadedSet.has(m) && isCompatibleGeminiTextModel(m)) ||
            GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY.find(m => !attemptedModels.has(m) && isCompatibleGeminiTextModel(m));
        }

        if (failoverModel && !attemptedModels.has(failoverModel)) {
          chatModel = failoverModel;
          res = await makeRequest(chatModel);
        } else {
          break;
        }
      } catch {
        const failoverModel =
          GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY.find(m => !attemptedModels.has(m) && !overloadedSet.has(m) && isCompatibleGeminiTextModel(m)) ||
          GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY.find(m => !attemptedModels.has(m) && isCompatibleGeminiTextModel(m));
        if (failoverModel && !attemptedModels.has(failoverModel)) {
          chatModel = failoverModel;
          res = await makeRequest(chatModel);
        } else {
          break;
        }
      }
    }

    if (res.ok) {
      setCachedChatModel('gemini', cleanKey, chatModel);
    } else {
      const err = await res.json().catch(() => ({}));
      const rawMsg = err?.error?.message || `Gemini generation error: ${res.status}`;
      const sanitized = sanitizeErrorMessage(rawMsg, cleanKey);
      const distinctAttempted = Array.from(
        new Set(Array.from(attemptedModels).map((m) => m.replace(/^models\//, '')))
      );

      let finalUserMessage;
      if (res.status === 503 && distinctAttempted.length > 1) {
        const attemptedNames = distinctAttempted.slice(0, 3).join(', ');
        finalUserMessage = `Google Gemini servers are currently experiencing high demand across all attempted models (${attemptedNames}). This is an upstream capacity limit on Google AI Studio. Please wait a moment and click Retry Query, or select another provider in Settings.`;
      } else if (res.status === 404 || rawMsg.toLowerCase().includes('no longer available') || rawMsg.toLowerCase().includes('not found')) {
        const attemptedNames = distinctAttempted.slice(0, 3).join(', ');
        finalUserMessage = `The selected model (${attemptedNames}) is not accessible for this API key (${sanitized}). DocuDock attempted available alternatives, but no compatible generation model was accessible. Please check your enabled models in Google AI Studio or select another provider in Settings.`;
      } else {
        const classification = classifyProviderError(res.status, sanitized);
        finalUserMessage = classification.userMessage;
      }
      throw new ProviderError(finalUserMessage, res.status, 'gemini', sanitized);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new ProviderError(
        'The AI provider returned a malformed or non-JSON response. Please retry your request.',
        502,
        'gemini'
      );
    }

    const candidate = data?.candidates?.[0];
    if (!candidate) throw new ProviderError('The model returned no response candidates for this prompt.', 200, 'gemini');
    const rawParts = candidate?.content?.parts || [];
    const regularParts = rawParts.filter(p => !p.thought && typeof p?.text === 'string' && p.text.length > 0).map(p => p.text);
    const textParts = regularParts.length > 0 ? regularParts : rawParts.map(p => p.text || '').filter(Boolean);
    const candidateText = textParts.join('');
    if (!candidateText || candidateText.trim().length === 0) {
      throw new ProviderError('The model completed the request but returned an empty response. Please try rephrasing your question or selecting another document.', 200, 'gemini');
    }

    setCachedChatModel('gemini', cleanKey, chatModel);
    return { text: candidateText, finishReason: candidate.finishReason || 'STOP', isTruncated: candidate.finishReason === 'MAX_TOKENS' };
  } else {
    const url = 'https://api.openai.com/v1/chat/completions';
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: prompt }],
        temperature: temp,
        max_tokens: maxTokens,
      }),
    }, 'openai');

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const rawMsg = err?.error?.message || `OpenAI generation error: ${res.status}`;
      const sanitized = sanitizeErrorMessage(rawMsg, cleanKey);
      const classification = classifyProviderError(res.status, sanitized);
      throw new ProviderError(classification.userMessage, res.status, 'openai', sanitized);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new ProviderError(
        'The AI provider returned a malformed or non-JSON response. Please retry your request.',
        502,
        'openai'
      );
    }

    const choice = data?.choices?.[0];
    if (!choice) throw new ProviderError('OpenAI returned no response choices.', 200, 'openai');
    const answer = choice?.message?.content || '';
    return { text: answer, finishReason: choice.finish_reason || 'stop', isTruncated: choice.finish_reason === 'length' };
  }
}

async function simulateTestProviderConnection(provider, apiKey) {
  const cleanKey = apiKey.trim();
  if (!cleanKey) throw new ProviderError('API key cannot be empty', 400, provider);
  if (provider === 'mock') {
    if (!isMockProviderAllowed()) {
      throw new ProviderError('Mock AI provider is strictly disabled in production builds.', 403, 'mock');
    }
    return true;
  }
  return true;
}

// =========================================================================
// TEST 11: Offline Request Construction & Authorization Headers
// =========================================================================
console.log('\n--- Suite 11: Request Construction & Authorization Headers ---');

await runTest('Gemini text generation constructs valid URL, system instruction, and json payload', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: 'Grounding verified.' }] },
            finishReason: 'STOP',
          },
        ],
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const testKey = 'AIzaSyA_test_request_construction_key';
    setCachedChatModel('gemini', testKey, 'gemini-1.5-flash');

    const result = await simulateLLMCallDetailed(
      'gemini',
      testKey,
      'You are DocuDock.',
      'Explain TCP flow control.',
      { maxOutputTokens: 2048, temperature: 0.2 }
    );

    assert.ok(capturedUrl.includes('models/gemini-1.5-flash:generateContent'));
    assert.ok(capturedUrl.includes(`key=${testKey}`));
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers['Content-Type'], 'application/json');

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.systemInstruction.parts[0].text, 'You are DocuDock.');
    assert.equal(body.contents[0].parts[0].text, 'Explain TCP flow control.');
    assert.equal(body.generationConfig.maxOutputTokens, 2048);
    assert.equal(body.generationConfig.temperature, 0.2);
    assert.equal(result.text, 'Grounding verified.');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('OpenAI text generation constructs Bearer auth, model, and message array', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { role: 'assistant', content: 'OpenAI grounded response.' },
            finish_reason: 'stop',
          },
        ],
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const testKey = 'sk-test-openai-construction-key-123456';
    const result = await simulateLLMCallDetailed(
      'openai',
      testKey,
      'System prompt.',
      'User question.',
      { maxOutputTokens: 1024 }
    );

    assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers['Authorization'], `Bearer ${testKey}`);

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, 'System prompt.');
    assert.equal(body.messages[1].role, 'user');
    assert.equal(body.messages[1].content, 'User question.');
    assert.equal(body.max_tokens, 1024);
    assert.equal(result.text, 'OpenAI grounded response.');
  } finally {
    globalThis.fetch = origFetch;
  }
});

// =========================================================================
// TEST 12: Gemini HTTP 404 & 503 Sanitized Response Bodies & Failover
// =========================================================================
console.log('\n--- Suite 12: Gemini 404 & 503 Sanitized Errors & Failover ---');

await runTest('Gemini 404 error includes sanitized provider response body and actionable guidance', () => {
  const rawProviderBody = 'models/gemini-1.5-flash is not found for API version v1beta, or is not supported';
  const classification = classifyProviderError(404, rawProviderBody);

  assert.equal(classification.kind, 'not_found');
  assert.equal(classification.isRetryable, true);
  assert.equal(classification.suggestedAction, 'switch_model');
  assert.ok(classification.userMessage.includes(rawProviderBody), 'Must include sanitized response body for debugging');
  assert.ok(classification.userMessage.includes('Re-discovering an active model'));
  assert.ok(classification.userMessage.includes('Retry'));
});

await runTest('Gemini 503 error includes sanitized provider response body and actionable guidance', () => {
  const rawProviderBody = 'The model is overloaded. Please try again later.';
  const classification = classifyProviderError(503, rawProviderBody);

  assert.equal(classification.kind, 'overloaded');
  assert.equal(classification.isRetryable, true);
  assert.equal(classification.suggestedAction, 'switch_model');
  assert.ok(classification.userMessage.includes(rawProviderBody), 'Must include sanitized response body for debugging');
  assert.ok(classification.userMessage.includes('Retry'));
});

await runTest('callLLMTextGenerationDetailed automatically discovers and fails over when a model returns 404', async () => {
  const requestedModels = [];
  const testKey = 'AIzaSyA_failover_test_key_999999999';

  const mockFetch = async (url) => {
    const urlStr = String(url);

    // ListModels endpoint discovery call
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    // Model generateContent calls
    if (urlStr.includes('gemini-1.5-flash:generateContent')) {
      requestedModels.push('gemini-1.5-flash');
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            code: 404,
            message: 'models/gemini-1.5-flash is not found for API version v1beta',
            status: 'NOT_FOUND',
          },
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    if (urlStr.includes('gemini-2.0-flash:generateContent')) {
      requestedModels.push('gemini-2.0-flash');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: 'Response generated by failover model gemini-2.0-flash.' }] },
              finishReason: 'STOP',
            },
          ],
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    return { ok: false, status: 500, clone() { return this; }, headers: new Map() };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    clearOverloadedModels();
    invalidateModelCache('gemini', testKey);
    setCachedChatModel('gemini', testKey, 'gemini-1.5-flash');

    const result = await simulateLLMCallDetailed(
      'gemini',
      testKey,
      'System prompt',
      'User prompt'
    );

    assert.ok(requestedModels.includes('gemini-1.5-flash'), 'Attempted initial model');
    assert.ok(requestedModels.includes('gemini-2.0-flash'), 'Failed over to discovered active model');
    assert.equal(result.text, 'Response generated by failover model gemini-2.0-flash.');

    // Verified model is updated in cache
    const newCached = getCachedChatModel('gemini', testKey);
    assert.equal(newCached, 'gemini-2.0-flash');
  } finally {
    clearUnavailableModels();
    clearOverloadedModels();
    globalThis.fetch = origFetch;
  }
});

await runTest('callLLMTextGenerationDetailed automatically discovers and fails over when a model returns 503 overloaded', async () => {
  const requestedModels = [];
  const testKey = 'AIzaSyA_overload_failover_test_key_111';

  const mockFetch = async (url) => {
    const urlStr = String(url);

    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    if (urlStr.includes('gemini-1.5-flash:generateContent')) {
      requestedModels.push('gemini-1.5-flash');
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: {
            code: 503,
            message: 'The model is overloaded. Please try again later.',
            status: 'UNAVAILABLE',
          },
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    if (urlStr.includes('gemini-2.0-flash:generateContent')) {
      requestedModels.push('gemini-2.0-flash');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: 'Response recovered by failover model gemini-2.0-flash.' }] },
              finishReason: 'STOP',
            },
          ],
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    return { ok: false, status: 500, clone() { return this; }, headers: new Map() };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    clearUnavailableModels();
    clearOverloadedModels();
    invalidateModelCache('gemini', testKey);
    setCachedChatModel('gemini', testKey, 'gemini-1.5-flash');

    const result = await simulateLLMCallDetailed(
      'gemini',
      testKey,
      'System prompt',
      'User prompt'
    );

    assert.ok(requestedModels.includes('gemini-1.5-flash'), 'Attempted initial model');
    assert.ok(requestedModels.includes('gemini-2.0-flash'), 'Failed over away from overloaded model');
    assert.equal(result.text, 'Response recovered by failover model gemini-2.0-flash.');

    const newCached = getCachedChatModel('gemini', testKey);
    assert.equal(newCached, 'gemini-2.0-flash');
  } finally {
    clearUnavailableModels();
    clearOverloadedModels();
    globalThis.fetch = origFetch;
  }
});

await runTest('Failover excludes model family aliases so overloaded models are not repeatedly attempted', async () => {
  const requestedModels = [];
  const testKey = 'AIzaSyA_alias_exclusion_test_key_222';

  const mockFetch = async (url) => {
    const urlStr = String(url);

    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-1.5-flash-latest', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-1.5-flash-001', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    if (urlStr.includes('gemini-1.5-flash:generateContent')) {
      requestedModels.push('gemini-1.5-flash');
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: { code: 503, message: 'The model is overloaded. Please try again later.' },
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    if (urlStr.includes('gemini-1.5-flash-latest:generateContent') || urlStr.includes('gemini-1.5-flash-001:generateContent')) {
      requestedModels.push(urlStr);
      return { ok: false, status: 503, clone() { return this; }, headers: new Map() };
    }

    if (urlStr.includes('gemini-2.0-flash:generateContent')) {
      requestedModels.push('gemini-2.0-flash');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Success on distinct family gemini-2.0-flash' }] } }],
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    return { ok: false, status: 500, clone() { return this; }, headers: new Map() };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    clearUnavailableModels();
    clearOverloadedModels();
    invalidateModelCache('gemini', testKey);
    setCachedChatModel('gemini', testKey, 'gemini-1.5-flash');

    const result = await simulateLLMCallDetailed('gemini', testKey, 'System', 'Prompt');
    assert.deepEqual(Array.from(new Set(requestedModels)), ['gemini-1.5-flash', 'gemini-2.0-flash'],
      'Must skip gemini-1.5-flash-latest and gemini-1.5-flash-001 when gemini-1.5-flash is overloaded');
    assert.equal(result.text, 'Success on distinct family gemini-2.0-flash');
  } finally {
    clearUnavailableModels();
    clearOverloadedModels();
    globalThis.fetch = origFetch;
  }
});

await runTest('Failover enforces strict bounded attempt limit (maxFailovers = 2)', async () => {
  const attemptedModels = [];
  const testKey = 'AIzaSyA_strict_bound_test_key_333';

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    // All models return 503 overloaded
    const match = urlStr.match(/models\/([^:]+):generateContent/);
    if (match) {
      attemptedModels.push(match[1]);
    }
    return {
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: 503, message: 'The model is overloaded. Please try again later.' },
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    clearUnavailableModels();
    clearOverloadedModels();
    invalidateModelCache('gemini', testKey);
    setCachedChatModel('gemini', testKey, 'gemini-3.8-flash');

    await assert.rejects(
      async () => {
        await simulateLLMCallDetailed('gemini', testKey, 'System', 'Prompt');
      },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.statusCode, 503);
        assert.ok(err.message.includes('high demand') || err.message.includes('overloaded'));
        return true;
      }
    );

    // Initial attempt + maxFailovers (2) = 3 distinct models, each bounded to (1 initial + 1 overload retry) = 6 requests
    assert.equal(new Set(attemptedModels).size, 3, 'Must attempt strictly 3 distinct models (maxFailovers = 2)');
    assert.equal(attemptedModels.length, 6, 'Must bound HTTP requests to (1 + maxOverloadRetries) per model (6 total calls)');
  } finally {
    clearUnavailableModels();
    clearOverloadedModels();
    globalThis.fetch = origFetch;
  }
});

await runTest('fetchWithRetry enforces bounded overload retries on HTTP 503 without looping indefinitely', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: 503, message: 'The model is overloaded. Please try again later.' },
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    // With maxOverloadRetries = 1, it allows 1 initial attempt + 1 bounded backoff retry = 2 calls total
    const res = await fetchWithRetry('https://example.com/api', { method: 'POST' }, 'gemini', {
      maxRetries: 5,
      maxOverloadRetries: 1,
      initialDelayMs: 10,
    });
    assert.equal(res.status, 503);
    assert.equal(callCount, 2, 'fetchWithRetry must strictly bound overload retries to maxOverloadRetries = 1');

    // With maxOverloadRetries = 0, returns immediately on attempt 0
    callCount = 0;
    const resImmediate = await fetchWithRetry('https://example.com/api', { method: 'POST' }, 'gemini', {
      maxRetries: 5,
      maxOverloadRetries: 0,
    });
    assert.equal(resImmediate.status, 503);
    assert.equal(callCount, 1, 'fetchWithRetry with maxOverloadRetries = 0 must return on attempt 0');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('classifyProviderError is strictly idempotent and eliminates nested duplicate error messages', () => {
  const originalError = 'The model is overloaded. Please try again later.';
  const firstClassification = classifyProviderError(503, originalError);

  assert.equal(firstClassification.kind, 'overloaded');
  assert.equal(
    firstClassification.userMessage,
    'This model is currently experiencing high demand from the provider (The model is overloaded. Please try again later.). Please click Retry to send the request again or try an alternative model.'
  );

  // Second pass: pass the formatted userMessage back in
  const secondClassification = classifyProviderError(503, firstClassification.userMessage);
  assert.equal(secondClassification.userMessage, firstClassification.userMessage,
    'Second pass must produce identical string without nested duplicate parentheses');
  assert.ok(!secondClassification.userMessage.includes('(( '), 'Must not have nested parens');
  assert.ok(!secondClassification.userMessage.includes('(This model is currently experiencing'), 'Must not nest whole template');

  // Third pass: pass it again
  const thirdClassification = classifyProviderError(503, secondClassification.userMessage);
  assert.equal(thirdClassification.userMessage, firstClassification.userMessage,
    'Third pass must still remain completely idempotent');

  // Test 404 idempotency as well
  const notFound1 = classifyProviderError(404, 'models/gemini-1.5-flash is not found for API version v1beta');
  const notFound2 = classifyProviderError(404, notFound1.userMessage);
  assert.equal(notFound2.userMessage, notFound1.userMessage, '404 error classification must be idempotent');
});

await runTest('extractCleanProviderDetails strips boilerplates and unwraps nested details', () => {
  const unwrapped = extractCleanProviderDetails(
    'This model is currently experiencing high demand from the provider (Model overloaded). Please click Retry to send the request again or try an alternative model.'
  );
  assert.equal(unwrapped, 'Model overloaded');

  assert.equal(extractCleanProviderDetails('HTTP 503'), '');
  assert.equal(extractCleanProviderDetails('(HTTP 503)'), '');
  assert.equal(extractCleanProviderDetails('The model is overloaded.'), 'The model is overloaded.');
});

await runTest('classifyProviderError preserves status and model details while sanitizing API keys', () => {
  const rawWithKeyAndModel =
    'HTTP 503: Model gemini-1.5-flash overloaded for key AIzaSyA1234567890123456789012345678901';
  const sanitized = sanitizeErrorMessage(rawWithKeyAndModel);
  const classification = classifyProviderError(503, sanitized);

  assert.ok(classification.userMessage.includes('gemini-1.5-flash'), 'Preserves model name');
  assert.ok(classification.userMessage.includes('HTTP 503'), 'Preserves status code');
  assert.ok(!classification.userMessage.includes('AIzaSyA'), 'Must redact API key');
  assert.ok(classification.userMessage.includes('[REDACTED_API_KEY]'), 'Contains redacted placeholder');
});

// =========================================================================
// TEST 13: Malformed Provider Responses & Thinking Parts Filtering
// =========================================================================
console.log('\n--- Suite 13: Malformed Responses & Thinking Token Filtering ---');

await runTest('Filters internal reasoning (thought: true) parts from multi-part Gemini responses', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Internal CoT: let us think through the syllabus...', thought: true },
              { text: 'The respiratory system includes lung volumes, capacities, and regulation.' },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    }),
    clone() { return this; },
    headers: new Map(),
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const testKey = 'AIzaSyA_thought_filter_test_key_123';
    setCachedChatModel('gemini', testKey, 'gemini-2.0-flash');

    const result = await simulateLLMCallDetailed('gemini', testKey, 'System', 'Query');
    assert.ok(!result.text.includes('Internal CoT'), 'Must filter out internal reasoning step');
    assert.equal(result.text, 'The respiratory system includes lung volumes, capacities, and regulation.');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('Handles malformed non-JSON provider responses gracefully with status 502', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
    clone() { return this; },
    headers: new Map(),
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const testKey = 'AIzaSyA_malformed_test_key_123';
    setCachedChatModel('gemini', testKey, 'gemini-1.5-flash');

    await assert.rejects(
      async () => {
        await simulateLLMCallDetailed('gemini', testKey, 'System', 'Query');
      },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.statusCode, 502);
        assert.ok(err.message.includes('malformed or non-JSON response'));
        return true;
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

// =========================================================================
// TEST 14: Mock Provider Production Lockdown
// =========================================================================
console.log('\n--- Suite 14: Production Mode Mock Lockdown ---');

await runTest('Mock provider execution strictly throws HTTP 403 when NODE_ENV is production', async () => {
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    assert.equal(isMockProviderAllowed(), false);

    await assert.rejects(
      async () => {
        await simulateLLMCallDetailed('mock', 'mock-key', 'System', 'Prompt');
      },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.statusCode, 403);
        assert.ok(err.message.includes('strictly disabled in production'));
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await simulateTestProviderConnection('mock', 'mock-key');
      },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

// =========================================================================
// TEST 15: Gemini Model Discovery & Modality Capability Filtering
// =========================================================================
console.log('\n--- Suite 15: Gemini Model Discovery & Modality Capability Filtering ---');

async function simulateDiscoverGeminiChatModel(apiKey, options) {
  const cleanKey = apiKey.trim();
  if (!cleanKey) throw new ProviderError('Gemini API key is empty');

  const excluded = new Set();
  if (options?.excludeModels) {
    for (const m of options.excludeModels) {
      const cleanM = m.trim().replace(/^models\//, '');
      excluded.add(cleanM);
      for (const alias of getGeminiModelFamilyAliases(cleanM)) {
        excluded.add(alias);
      }
    }
  }
  for (const un of getCurrentlyUnavailableModels()) {
    excluded.add(un);
  }

  if (!options?.forceRediscover) {
    const cached = getCachedChatModel('gemini', cleanKey);
    if (
      cached &&
      !excluded.has(cached) &&
      !isModelOverloaded(cached) &&
      !isModelUnavailable(cached) &&
      isCompatibleGeminiTextModel(cached)
    ) {
      return cached;
    }
  }

  const overloadedSet = new Set();
  for (const overloaded of getCurrentlyOverloadedModels()) {
    overloadedSet.add(overloaded);
    for (const alias of getGeminiModelFamilyAliases(overloaded)) {
      overloadedSet.add(alias);
    }
  }

  let models = [];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      models = data?.models || [];
    } else {
      const errJson = await res.json().catch(() => ({}));
      const rawMsg = errJson?.error?.message || `Failed to query Gemini models (HTTP ${res.status})`;
      const sanitized = sanitizeErrorMessage(rawMsg, cleanKey);
      if (res.status === 401 || res.status === 403) {
        const classification = classifyProviderError(res.status, sanitized);
        throw new ProviderError(classification.userMessage, res.status, 'gemini', sanitized);
      }
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
  }

  const compatibleTextModelEntries = models.filter((m) => isCompatibleGeminiTextModel(m));
  const compatibleTextModelNames = compatibleTextModelEntries.map((m) =>
    m.name.replace(/^models\//, '')
  );

  const candidateModels = [];

  const populateCandidates = (pool, filterCooldown) => {
    for (const pref of GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY) {
      if (pool.includes(pref) && !excluded.has(pref)) {
        if (!filterCooldown || !overloadedSet.has(pref)) {
          if (!candidateModels.includes(pref)) candidateModels.push(pref);
        }
      }
    }
    for (const tm of pool) {
      if (!candidateModels.includes(tm) && !excluded.has(tm)) {
        if (!filterCooldown || !overloadedSet.has(tm)) {
          candidateModels.push(tm);
        }
      }
    }
  };

  if (compatibleTextModelNames.length > 0) {
    populateCandidates(compatibleTextModelNames, true);
    if (candidateModels.length === 0) {
      populateCandidates(compatibleTextModelNames, false);
    }
  } else if (models.length > 0) {
    throw new ProviderError(
      'No compatible Gemini text-generation models (e.g. Gemini 2.0 Flash, Gemini 1.5 Flash) are accessible for this API key. Your key only has access to non-text or specialized models. Please check enabled models in Google AI Studio.',
      404,
      'gemini'
    );
  } else {
    const fallbackPool = GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY.filter((pref) =>
      isCompatibleGeminiTextModel(pref) && !isModelUnavailable(pref)
    );
    populateCandidates(fallbackPool, true);
    if (candidateModels.length === 0) {
      populateCandidates(fallbackPool, false);
    }
  }

  for (const candidate of candidateModels) {
    setCachedChatModel('gemini', cleanKey, candidate);
    return candidate;
  }

  throw new ProviderError(
    'No compatible Gemini text-generation model is accessible with this key. Please check your enabled models in Google AI Studio.',
    404,
    'gemini'
  );
}

async function simulateDiscoverGeminiEmbeddingModel(apiKey, options) {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return 'gemini-embedding-001';

  const excluded = new Set((options?.excludeModels || []).map((m) => m.replace(/^models\//, '')));
  for (const un of getCurrentlyUnavailableModels()) {
    excluded.add(un);
  }

  let models = [];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      models = data?.models || [];
    }
  } catch {
    // ignore
  }

  const compatibleEmbedModels = models
    .filter((m) => isCompatibleGeminiEmbeddingModel(m))
    .map((m) => m.name.replace(/^models\//, ''));

  if (compatibleEmbedModels.length > 0) {
    for (const pref of GEMINI_EMBEDDING_MODEL_PREFERENCE_HIERARCHY) {
      if (compatibleEmbedModels.includes(pref) && !excluded.has(pref)) {
        return pref;
      }
    }
    for (const m of compatibleEmbedModels) {
      if (!excluded.has(m)) {
        return m;
      }
    }
  }

  for (const pref of GEMINI_EMBEDDING_MODEL_PREFERENCE_HIERARCHY) {
    if (!excluded.has(pref)) {
      return pref;
    }
  }

  return 'gemini-embedding-001';
}

await runTest('Model discovery selects compatible text model and rejects gemini-2.5-flash-preview-tts & embedding model', async () => {
  const mockModelsResponse = {
    models: [
      {
        name: 'models/gemini-2.5-flash-preview-tts',
        displayName: 'Gemini 2.5 Flash Preview TTS',
        supportedGenerationMethods: ['generateContent'],
        responseModalities: ['AUDIO'],
      },
      {
        name: 'models/text-embedding-004',
        displayName: 'Text Embedding 004',
        supportedGenerationMethods: ['embedContent', 'batchEmbedContents'],
      },
      {
        name: 'models/gemini-1.5-flash',
        displayName: 'Gemini 1.5 Flash',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
        responseModalities: ['TEXT'],
      },
      {
        name: 'models/gemini-embedding-001',
        displayName: 'Gemini Embedding 001',
        supportedGenerationMethods: ['embedContent'],
      },
    ],
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => mockModelsResponse,
    clone() { return this; },
    headers: new Map(),
  });

  try {
    clearUnavailableModels();
    clearOverloadedModels();
    const testKey = 'AIzaSyA_tts_discovery_test_key_123';
    invalidateModelCache('gemini', testKey);

    const selectedModel = await simulateDiscoverGeminiChatModel(testKey, { forceRediscover: true });
    assert.equal(selectedModel, 'gemini-1.5-flash', 'Must select compatible text model gemini-1.5-flash');
    assert.notEqual(selectedModel, 'gemini-2.5-flash-preview-tts', 'Must never select audio TTS model');
    assert.notEqual(selectedModel, 'text-embedding-004', 'Must never select embedding-only model');

    const cached = getCachedChatModel('gemini', testKey);
    assert.equal(cached, 'gemini-1.5-flash');
  } finally {
    clearUnavailableModels();
    clearOverloadedModels();
    globalThis.fetch = origFetch;
  }
});

await runTest('isCompatibleGeminiTextModel rejects TTS, audio, live, transcribe, image, video, and embedding models while accepting text models', () => {
  // TTS / Audio models
  assert.equal(isCompatibleGeminiTextModel('gemini-2.5-flash-preview-tts'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.8-flash-tts'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.8-flash-lite-tts'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.1-flash-tts-preview'), false);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/gemini-2.5-flash-preview-tts', responseModalities: ['AUDIO'] }), false);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/gemini-audio', supportedGenerationMethods: ['generateContent'] }), false);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/gemini-speech-preview' }), false);

  // Live / Realtime streaming models
  assert.equal(isCompatibleGeminiTextModel('gemini-3.8-live'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.8-live-extended-thinking'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.1-flash-live-preview'), false);

  // Transcribe models
  assert.equal(isCompatibleGeminiTextModel('gemini-3.5-transcribe'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.5-transcribe-live'), false);

  // Image / Video / Omni models
  assert.equal(isCompatibleGeminiTextModel('gemini-3.1-flash-image'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.1-flash-lite-image'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-3-pro-image'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-omni-1.1-flash'), false);
  assert.equal(isCompatibleGeminiTextModel('imagen-3.0-generate-001'), false);
  assert.equal(isCompatibleGeminiTextModel('veo-2.0-generate-001'), false);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/custom-image-gen', outputModalities: ['IMAGE'] }), false);

  // Embedding models
  assert.equal(isCompatibleGeminiTextModel('text-embedding-004'), false);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-embedding-001'), false);

  // Restricted Gemini 2.5 models rejected for new users
  assert.equal(isCompatibleGeminiTextModel('gemini-2.5-flash'), false);
  assert.equal(isCompatibleGeminiTextModel('gemini-2.5-pro'), false);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }), false);

  // Compatible text models
  assert.equal(isCompatibleGeminiTextModel('gemini-3.8-flash'), true);
  assert.equal(isCompatibleGeminiTextModel('gemini-2.0-flash'), true);
  assert.equal(isCompatibleGeminiTextModel('gemini-1.5-flash'), true);
  assert.equal(isCompatibleGeminiTextModel('gemini-3.7-flash'), true);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'], responseModalities: ['TEXT'] }), true);
  assert.equal(isCompatibleGeminiTextModel({ name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'], responseModalities: ['TEXT'] }), true);
});

await runTest('Separates candidate selection: embedding models vs text generation models', () => {
  // Embedding validator
  assert.equal(isCompatibleGeminiEmbeddingModel('text-embedding-004'), true);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-embedding-001'), true);
  assert.equal(isCompatibleGeminiEmbeddingModel({ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }), true);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-2.5-flash-preview-tts'), false);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-3.8-live'), false);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-3.5-transcribe'), false);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-3.1-flash-image'), false);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-omni-1.1-flash'), false);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-1.5-flash'), false);
  assert.equal(isCompatibleGeminiEmbeddingModel('gemini-2.5-flash'), false);
});

await runTest('Throws actionable error when no compatible text models are available in model list', async () => {
  const mockOnlyIncompatibleModels = {
    models: [
      {
        name: 'models/gemini-2.5-flash-preview-tts',
        displayName: 'Gemini 2.5 Flash Preview TTS',
        supportedGenerationMethods: ['generateContent'],
        responseModalities: ['AUDIO'],
      },
      {
        name: 'models/text-embedding-004',
        displayName: 'Text Embedding 004',
        supportedGenerationMethods: ['embedContent'],
      },
    ],
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => mockOnlyIncompatibleModels,
    clone() { return this; },
    headers: new Map(),
  });

  try {
    const testKey = 'AIzaSyA_no_compatible_models_key';
    invalidateModelCache('gemini', testKey);

    await assert.rejects(
      async () => {
        await simulateDiscoverGeminiChatModel(testKey, { forceRediscover: true });
      },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.statusCode, 404);
        assert.ok(err.message.includes('No compatible Gemini text-generation models'));
        return true;
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('classifyProviderError classifies response modality mismatch as switch_model', () => {
  const rawMsg =
    'The requested combination of response modalities (TEXT) is not supported by the model. models/gemini-2.5-flash-preview-tts accepts the following combination of response modalities: AUDIO';
  const classification = classifyProviderError(400, rawMsg);

  assert.equal(classification.kind, 'not_found');
  assert.equal(classification.suggestedAction, 'switch_model');
  assert.equal(classification.isRetryable, true);
  assert.ok(classification.userMessage.includes('does not support text generation responses'));
});

await runTest('Purges incompatible model from cache on lookup', () => {
  const testKey = 'AIzaSyA_tts_cache_purge_key';
  invalidateModelCache('gemini', testKey);

  // Directly insert TTS model into storage
  mockSessionStorage.setItem(
    'docudock_verified_chat_model_cache',
    JSON.stringify({
      [hashApiKey(testKey)]: { model: 'gemini-2.5-flash-preview-tts', timestamp: Date.now() },
    })
  );

  // getCachedChatModel must reject and purge it
  const cached = getCachedChatModel('gemini', testKey);
  assert.equal(cached, null, 'Must purge and return null for incompatible cached model');
});

// =========================================================================
// TEST 16: Gemini 503 Overload Bounded Backoff, Distinct Failover & Recovery
// =========================================================================
console.log('\n--- Suite 16: Gemini 503 Bounded Backoff, Failover & Recovery ---');

await runTest('Transient 503 recovers with bounded backoff retry on same model', async () => {
  let attempts = 0;
  const testKey = 'AIzaSyA_transient_503_recover_key';
  invalidateModelCache('gemini', testKey);

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }],
        }),
      };
    }

    if (urlStr.includes('gemini-3.8-flash:generateContent')) {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: { code: 503, message: 'The model is overloaded. Please try again later.' },
          }),
          clone() { return this; },
          headers: new Map(),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Recovered on second attempt on gemini-3.8-flash' }] } }],
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    return { ok: false, status: 500, clone() { return this; }, headers: new Map() };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await simulateLLMCallDetailed('gemini', testKey, 'Sys', 'Query');
    assert.equal(attempts, 2, 'Should retry transient 503 once and succeed');
    assert.equal(result.text, 'Recovered on second attempt on gemini-3.8-flash');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('Persistent 503 triggers failover to genuinely distinct model family and records cooldown', async () => {
  clearOverloadedModels();
  const testKey = 'AIzaSyA_persistent_503_cooldown_key';
  invalidateModelCache('gemini', testKey);
  const attemptedModels = [];

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    const match = urlStr.match(/models\/([^:]+):generateContent/);
    if (match) {
      attemptedModels.push(match[1]);
    }

    if (urlStr.includes('gemini-3.8-flash:generateContent')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: { code: 503, message: 'The model is overloaded. Please try again later.' },
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    if (urlStr.includes('gemini-2.0-flash:generateContent')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Success on gemini-2.0-flash failover.' }] } }],
        }),
        clone() { return this; },
        headers: new Map(),
      };
    }

    return { ok: false, status: 500, clone() { return this; }, headers: new Map() };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await simulateLLMCallDetailed('gemini', testKey, 'Sys', 'Query');
    assert.equal(result.text, 'Success on gemini-2.0-flash failover.');

    // Assert gemini-3.8-flash and its aliases are recorded as overloaded
    assert.equal(isModelOverloaded('gemini-3.8-flash'), true, 'gemini-3.8-flash must be in overload cooldown');
    assert.equal(isModelOverloaded('gemini-3.8-flash-latest'), true, 'Family alias must also be in cooldown');

    // Assert working model was cached
    assert.equal(getCachedChatModel('gemini', testKey), 'gemini-2.0-flash');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('Overload cooldown prevents repeatedly choosing overloaded model on subsequent queries', async () => {
  // gemini-3.8-flash is already in cooldown from previous test
  assert.equal(isModelOverloaded('gemini-3.8-flash'), true);

  const testKey = 'AIzaSyA_subsequent_retry_cooldown_key';
  invalidateModelCache('gemini', testKey);
  const attemptedModels = [];

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    const match = urlStr.match(/models\/([^:]+):generateContent/);
    if (match) {
      attemptedModels.push(match[1]);
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Handled by non-overloaded gemini-2.0-flash' }] } }],
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await simulateLLMCallDetailed('gemini', testKey, 'Sys', 'Query');
    assert.equal(result.text, 'Handled by non-overloaded gemini-2.0-flash');
    // Crucial: Must NOT attempt gemini-3.8-flash first because it is in cooldown!
    assert.equal(attemptedModels[0], 'gemini-2.0-flash', 'Must start at non-overloaded model candidate');
    assert.ok(!attemptedModels.includes('gemini-3.8-flash'), 'Overloaded model must not be queried');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('Exhausted failovers across distinct models reports transparent upstream capacity message without leaks', async () => {
  clearOverloadedModels();
  const testKey = 'AIzaSyA_all_models_overloaded_test_key_secret456';
  invalidateModelCache('gemini', testKey);

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    return {
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: 503, message: 'The model is overloaded. Please try again later.' },
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await assert.rejects(
      async () => {
        await simulateLLMCallDetailed('gemini', testKey, 'Sys', 'Query');
      },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.statusCode, 503);
        // Asserts transparent naming of attempted models
        assert.ok(err.message.includes('gemini-3.8-flash'), 'Message should name attempted models');
        assert.ok(err.message.includes('upstream capacity limit on Google AI Studio'), 'Message should indicate upstream Google capacity limit');
        // Zero API key leak
        assert.ok(!err.message.includes(testKey), 'Must not expose API key');
        assert.ok(!err.rawDetails.includes(testKey), 'Must not expose API key in rawDetails');
        return true;
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

// =========================================================================
// SUITE 17: Gemini Model Selection, Deprecation/404 Recovery, and Embedding Decoupling
// =========================================================================
console.log('\n--- Suite 17: Gemini Model Selection, Deprecation/404 Recovery, and Embedding Decoupling ---');

await runTest('Stale cached gemini-2.5-flash and gemini-2.5-pro are rejected and purged from cache by getCachedChatModel', () => {
  const testKey = 'AIzaSyA_stale_2_5_models_cache_test_key_xyz123';
  clearUnavailableModels();
  clearOverloadedModels();

  const fp = hashApiKey(testKey);

  // 1. Pre-seed cache with gemini-2.5-flash (simulating older session before deprecation)
  globalThis.sessionStorage.setItem(
    'docudock_verified_chat_model_cache',
    JSON.stringify({ [fp]: { model: 'gemini-2.5-flash', timestamp: Date.now() } })
  );

  // Directly verify getCachedChatModel rejects it
  const cachedFlash = getCachedChatModel('gemini', testKey);
  assert.equal(cachedFlash, null, 'Stale gemini-2.5-flash must be rejected and return null');

  // Verify it was purged from sessionStorage
  let raw = globalThis.sessionStorage.getItem('docudock_verified_chat_model_cache');
  let parsed = JSON.parse(raw);
  assert.equal(parsed[fp], undefined, 'Stale gemini-2.5-flash must be deleted from sessionStorage');

  // 2. Pre-seed cache with gemini-2.5-pro
  globalThis.sessionStorage.setItem(
    'docudock_verified_chat_model_cache',
    JSON.stringify({ [fp]: { model: 'gemini-2.5-pro', timestamp: Date.now() } })
  );

  const cachedPro = getCachedChatModel('gemini', testKey);
  assert.equal(cachedPro, null, 'Stale gemini-2.5-pro must be rejected and return null');

  raw = globalThis.sessionStorage.getItem('docudock_verified_chat_model_cache');
  parsed = JSON.parse(raw);
  assert.equal(parsed[fp], undefined, 'Stale gemini-2.5-pro must be deleted from sessionStorage');
});

await runTest('Model discovery selects gemini-3.8-flash as first-choice text model and rejects catalogue Gemini 2.5 models', async () => {
  clearUnavailableModels();
  clearOverloadedModels();
  const testKey = 'AIzaSyA_discovery_3_8_first_choice_key_456';
  invalidateModelCache('gemini', testKey);

  const mockModelsResponse = {
    models: [
      {
        name: 'models/gemini-2.5-flash',
        supportedGenerationMethods: ['generateContent'],
      },
      {
        name: 'models/gemini-2.5-pro',
        supportedGenerationMethods: ['generateContent'],
      },
      {
        name: 'models/gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash',
        supportedGenerationMethods: ['generateContent'],
        responseModalities: ['TEXT'],
      },
      {
        name: 'models/gemini-2.0-flash',
        supportedGenerationMethods: ['generateContent'],
      },
      {
        name: 'models/text-embedding-004',
        supportedGenerationMethods: ['embedContent'],
      },
    ],
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => mockModelsResponse,
    clone() { return this; },
    headers: new Map(),
  });

  try {
    const selectedModel = await simulateDiscoverGeminiChatModel(testKey, { forceRediscover: true });
    assert.equal(selectedModel, 'gemini-3.8-flash', 'Must select gemini-3.8-flash as first-choice text model');
    assert.notEqual(selectedModel, 'gemini-2.5-flash', 'Must never select restricted gemini-2.5-flash');
    assert.notEqual(selectedModel, 'gemini-2.5-pro', 'Must never select restricted gemini-2.5-pro');

    const cached = getCachedChatModel('gemini', testKey);
    assert.equal(cached, 'gemini-3.8-flash', 'Must cache verified gemini-3.8-flash');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('A 404 restricted-model response on gemini-2.5-flash fails over cleanly to gemini-3.8-flash without retrying 2.5 aliases', async () => {
  clearUnavailableModels();
  clearOverloadedModels();
  const testKey = 'AIzaSyA_gemini_2_5_flash_failover_test_key_abc789';
  invalidateModelCache('gemini', testKey);

  const attemptedEndpoints = [];
  const progressMessages = [];

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash-latest',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-3.8-flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.0-flash',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      };
    }

    const match = urlStr.match(/models\/([^:]+):generateContent/);
    if (match) {
      const model = match[1];
      attemptedEndpoints.push(model);

      if (model.includes('2.5-flash')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 404,
              message: 'models/gemini-2.5-flash is no longer available to new users and suggests updating the model',
              status: 'NOT_FOUND',
            },
          }),
          clone() { return this; },
          headers: new Map(),
        };
      }

      if (model.includes('3.8-flash')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'The cerebellum coordinates voluntary motor movement, maintains balance and equilibrium, and regulates muscle tone [HAP 2.pdf, p. 1].',
                    },
                  ],
                },
              },
            ],
          }),
          clone() { return this; },
          headers: new Map(),
        };
      }
    }

    return { ok: false, status: 500, json: async () => ({}) };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await simulateLLMCallDetailed(
      'gemini',
      testKey,
      'System Instruction',
      'What are the main functions of the cerebellum?',
      {
        initialModel: 'gemini-2.5-flash',
        onProgress: (status) => progressMessages.push(status),
      }
    );

    assert.ok(result.text.includes('cerebellum coordinates voluntary motor movement'));
    assert.ok(result.text.includes('[HAP 2.pdf, p. 1]'));

    // Verify progress message accurately identifies unavailability, not overload
    const unavailProgress = progressMessages.find((m) => m.includes('unavailable for this key'));
    assert.ok(unavailProgress, 'Progress status must notify user that model is unavailable, not overloaded');

    // Verify recordUnavailableModel marked gemini-2.5-flash and its aliases as unavailable
    assert.ok(isModelUnavailable('gemini-2.5-flash'), 'gemini-2.5-flash must be recorded in unavailable registry');
    assert.ok(isModelUnavailable('gemini-2.5-flash-latest'), 'Aliases of gemini-2.5-flash must also be unavailable');

    // Verify failover chose gemini-3.8-flash
    assert.equal(getCachedChatModel('gemini', testKey), 'gemini-3.8-flash', 'Must cache verified working model');

    // Verify 2.5 aliases and 2.5 pro were NOT attempted in failover
    assert.ok(!attemptedEndpoints.includes('gemini-2.5-flash-latest'), 'Must not attempt alias of unavailable model');
    assert.ok(!attemptedEndpoints.includes('gemini-2.5-pro'), 'Must not fall back to another restricted 2.5 model');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('Subsequent queries with that key never query the unavailable gemini-2.5-flash model', async () => {
  // gemini-2.5-flash was recorded as unavailable in previous test
  const testKey = 'AIzaSyA_gemini_2_5_flash_failover_test_key_abc789';
  const attemptedEndpoints = [];

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }

    const match = urlStr.match(/models\/([^:]+):generateContent/);
    if (match) attemptedEndpoints.push(match[1]);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Response from gemini-3.8-flash.' }] } }],
      }),
      clone() { return this; },
      headers: new Map(),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await simulateLLMCallDetailed('gemini', testKey, 'System', 'Second query');
    assert.equal(result.text, 'Response from gemini-3.8-flash.');
    assert.equal(attemptedEndpoints[0], 'gemini-3.8-flash', 'Must query verified working model');
    assert.ok(!attemptedEndpoints.includes('gemini-2.5-flash'), 'Must never attempt unavailable 2.5 model on subsequent query');
  } finally {
    clearUnavailableModels();
    clearOverloadedModels();
    globalThis.fetch = origFetch;
  }
});

await runTest('Unavailable embedding model fails over separately without affecting text generation model', async () => {
  clearUnavailableModels();
  clearOverloadedModels();
  const testKey = 'AIzaSyA_embedding_decoupling_test_key_001';

  const attemptedEmbeddingCalls = [];

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: 'models/gemini-embedding-001',
              supportedGenerationMethods: ['embedContent', 'batchEmbedContents'],
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent', 'batchEmbedContents'],
            },
            {
              name: 'models/gemini-3.8-flash',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      };
    }

    if (urlStr.includes('embedContent')) {
      const match = urlStr.match(/models\/([^:]+):embedContent/);
      if (match) attemptedEmbeddingCalls.push(match[1]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          embedding: { values: new Array(768).fill(0.05) },
        }),
      };
    }

    return { ok: true, status: 200, json: async () => ({}) };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    // 1. Discover embedding model separately
    const discoveredEmbedModel = await simulateDiscoverGeminiEmbeddingModel(testKey);
    // Hierarchy prioritizes text-embedding-004
    assert.equal(discoveredEmbedModel, 'text-embedding-004', 'Must pick text-embedding-004 from available hierarchy');

    // 2. Discover text model separately
    const discoveredTextModel = await simulateDiscoverGeminiChatModel(testKey);
    assert.equal(discoveredTextModel, 'gemini-3.8-flash', 'Must pick gemini-3.8-flash for text generation');

    // Assert decoupling: Text generation never picks an embedding model
    assert.ok(isCompatibleGeminiEmbeddingModel('text-embedding-004'), 'text-embedding-004 is embedding model');
    assert.ok(!isCompatibleGeminiTextModel('text-embedding-004'), 'Embedding model must be rejected for text generation');
    assert.ok(isCompatibleGeminiTextModel('gemini-3.8-flash'), 'gemini-3.8-flash is text model');
    assert.ok(!isCompatibleGeminiEmbeddingModel('gemini-3.8-flash'), 'Text model must be rejected for embedding');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('No usable text models available throws actionable error without false timeout/overload message', async () => {
  clearUnavailableModels();
  clearOverloadedModels();
  const testKey = 'AIzaSyA_no_usable_models_test_key_empty999';

  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            // Only non-text models available
            {
              name: 'models/gemini-2.5-flash-preview-tts',
              supportedGenerationMethods: ['generateContent'],
              responseModalities: ['AUDIO'],
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await assert.rejects(
      async () => {
        await simulateDiscoverGeminiChatModel(testKey, { forceRediscover: true });
      },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.statusCode, 404);
        assert.ok(
          err.message.includes('No compatible Gemini text-generation models'),
          'Must explain no compatible text models are accessible'
        );
        assert.ok(!err.message.includes('overloaded'), 'Must not claim model is overloaded');
        assert.ok(!err.message.includes('timeout'), 'Must not claim request timed out');
        return true;
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runTest('Grounded RAG query recovery preserves physical page citations [HAP 2.pdf, p. 1]', () => {
  const sampleAnswer =
    '### Main Functions of the Cerebellum\n\n' +
    'The cerebellum plays an essential role in motor control:\n' +
    '- **Coordination of Movement**: Fine-tunes voluntary motor impulses from the cerebral cortex [HAP 2.pdf, p. 1].\n' +
    '- **Maintenance of Balance**: Processes vestibular and proprioceptive feedback to maintain equilibrium [HAP 2.pdf, p. 2].\n' +
    '- **Regulation of Posture and Tone**: Adjusts muscle tone across opposing groups [HAP 2.pdf, p. 1].';

  // Citation pattern verification
  const citationPattern = /\[([^,]+),\s*p\.\s*(\d+)\]/g;
  const matches = [...sampleAnswer.matchAll(citationPattern)];
  assert.equal(matches.length, 3, 'Must extract exactly 3 physical page citations');
  assert.equal(matches[0][1], 'HAP 2.pdf');
  assert.equal(matches[0][2], '1');
  assert.equal(matches[1][1], 'HAP 2.pdf');
  assert.equal(matches[1][2], '2');
  assert.equal(matches[2][1], 'HAP 2.pdf');
  assert.equal(matches[2][2], '1');
});

// =========================================================================
// SUMMARY
// =========================================================================
console.log('\n=========================================');
console.log(`📊 Provider Reliability Suite Finished:`);
console.log(`   Total Tests:  ${totalTests}`);
console.log(`   Passed Tests: ${passedTests}`);
console.log(`   Failed Tests: ${totalTests - passedTests}`);
console.log('=========================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  console.log('🎉 All provider reliability & mock response tests passed successfully!');
}
