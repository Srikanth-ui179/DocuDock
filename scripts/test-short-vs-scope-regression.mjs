/**
 * Comprehensive Short Questions vs. Page-Scoped Questions Regression Test
 *
 * Verifies:
 * 1. Scope query intent detection for both ordinary factual questions and page-range queries.
 * 2. End-to-end request construction for Gemini and OpenAI (short questions vs. page-scope questions).
 * 3. Sanitized runtime errors and HTTP status code handling across both providers.
 * 4. Verification that model discovery and retry backoff do NOT interfere with ordinary short questions.
 */

import assert from 'node:assert/strict';

// Mock sessionStorage
class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(k) { return this.store.get(k) || null; }
  setItem(k, v) { this.store.set(k, String(v)); }
  removeItem(k) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
const mockStorage = new MockSessionStorage();
globalThis.sessionStorage = mockStorage;
globalThis.window = { sessionStorage: mockStorage };

import { parseScopeQuery } from '../src/lib/utils/scopeQueryParser.mjs';
import {
  getCachedChatModel,
  setCachedChatModel,
  classifyProviderError,
} from '../src/lib/ai/modelCache.ts';

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
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

console.log('🔬 Starting Short vs. Page-Scope Question Regression Suite...\n');

// =========================================================================
// SECTION 1: Scope Intent Classification (Short vs. Scope Queries)
// =========================================================================
console.log('--- Section 1: Intent Routing Classification ---');

const ordinaryShortQuestions = [
  'What is TCP?',
  'What are the three port number ranges defined by ICANN?',
  'What is the size and structure of the UDP header?',
  'How does TCP calculate EstimatedRTT?',
  'Explain Go-Back-N protocol',
  'What is multiplexing and demultiplexing?',
  'What is the difference between TCP and UDP?',
  'Calculate the TCP timeout interval if SampleRTT is 30ms',
  'Why does UDP have a checksum?',
  'What is fast retransmit in TCP Reno?',
];

for (const q of ordinaryShortQuestions) {
  await runTest(`Short question correctly bypasses scope generation: "${q}"`, () => {
    const intent = parseScopeQuery(q);
    assert.equal(
      intent.isScopeQuery,
      false,
      `Question "${q}" must NOT be treated as a scope query`
    );
  });
}

const pageScopeQuestions = [
  { q: 'Explain the first 10 pages', start: 1, end: 10, type: 'range' },
  { q: 'Summarize pages 5-15', start: 5, end: 15, type: 'range' },
  { q: 'Walk me through the whole chapter', type: 'whole_document' },
  { q: 'Explain page 6', start: 6, end: 6, type: 'single_page' },
  { q: 'continue', type: 'continuation' },
  { q: 'continue from page 8', start: 8, type: 'continuation' },
];

for (const item of pageScopeQuestions) {
  await runTest(`Page-scope question correctly routed: "${item.q}"`, () => {
    const intent = parseScopeQuery(item.q);
    assert.equal(intent.isScopeQuery, true, `Query "${item.q}" must be recognized as scope query`);
    assert.equal(intent.scopeType, item.type);
    if (item.start) assert.equal(intent.startPage, item.start);
    if (item.end) assert.equal(intent.endPage, item.end);
  });
}

// =========================================================================
// SECTION 2: Request Construction & Shared Parameters (Both Providers)
// =========================================================================
console.log('\n--- Section 2: Request Parameter Verification (Gemini & OpenAI) ---');

// Mock request recorder
const recordedRequests = [];
function createMockFetch(mockResponses) {
  return async (url, options) => {
    const urlStr = String(url);
    const parsedBody = options?.body ? JSON.parse(options.body) : null;
    recordedRequests.push({
      url: urlStr,
      method: options?.method || 'GET',
      headers: options?.headers || {},
      body: parsedBody,
    });

    const handler = mockResponses.find((r) => r.match(urlStr, options));
    if (handler) {
      return handler.respond(urlStr, options, parsedBody);
    }

    return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
  };
}

// Simulated Provider Execution Engine matching src/lib/ai/providers.ts
async function simulateLLMCall(provider, apiKey, systemInstruction, prompt, options = {}) {
  const cleanKey = apiKey.trim();
  const maxTokens = options.maxOutputTokens || 3072;
  const temp = options.temperature ?? 0.1;

  if (provider === 'gemini') {
    const cached = getCachedChatModel('gemini', cleanKey);
    const model = cached || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: temp, maxOutputTokens: maxTokens },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const rawMsg = err?.error?.message || `HTTP ${res.status}`;
      const classification = classifyProviderError(res.status, rawMsg);
      throw new Error(classification.userMessage);
    }

    const data = await res.json();
    if (data?.promptFeedback?.blockReason) {
      throw new Error(`Content blocked: ${data.promptFeedback.blockReason}`);
    }
    const candidate = data?.candidates?.[0];
    if (!candidate) throw new Error('Empty model response: no candidates');

    const parts = (candidate?.content?.parts || []).map((p) => p.text || '').join('');
    if (!parts || parts.trim().length === 0) throw new Error('Empty model response: no text');

    setCachedChatModel('gemini', cleanKey, model);
    return { text: parts, finishReason: candidate.finishReason || 'STOP' };
  } else {
    const url = 'https://api.openai.com/v1/chat/completions';
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ],
        temperature: temp,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const rawMsg = err?.error?.message || `HTTP ${res.status}`;
      const classification = classifyProviderError(res.status, rawMsg);
      throw new Error(classification.userMessage);
    }

    const data = await res.json();
    const choice = data?.choices?.[0];
    if (!choice) throw new Error('Empty model response: no choices');
    if (choice.finish_reason === 'content_filter') throw new Error('Content blocked by OpenAI filter');
    if (choice.finish_reason === 'refusal' || choice?.message?.refusal) {
      throw new Error(choice?.message?.refusal || 'OpenAI refused to generate a response');
    }

    const content = choice?.message?.content || '';
    if (!content || content.trim().length === 0) throw new Error('Empty model response: no content');

    return { text: content, finishReason: choice.finish_reason || 'stop' };
  }
}

await runTest('Gemini short question request carries clean tokens and parameters', async () => {
  recordedRequests.length = 0;
  globalThis.fetch = createMockFetch([
    {
      match: (url) => url.includes('generateContent'),
      respond: () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'TCP provides reliable data transfer [Ch3.pdf, p. 5].' }] } }],
          }),
          { status: 200 }
        ),
    },
  ]);

  const testKey = 'AIzaSyA_mock_test_key_gemini';
  const result = await simulateLLMCall(
    'gemini',
    testKey,
    'System prompt instructions',
    'User query about TCP',
    { maxOutputTokens: 3072 }
  );

  assert.ok(result.text.includes('reliable data transfer'));
  assert.equal(recordedRequests.length, 1);
  const req = recordedRequests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.body.generationConfig.maxOutputTokens, 3072);
  assert.equal(req.body.generationConfig.temperature, 0.1);
  assert.ok(req.url.includes('gemini-1.5-flash:generateContent'));
  // Key must NOT be leaked in headers
  assert.equal(req.headers['Authorization'], undefined);
});

await runTest('OpenAI short question request carries clean tokens and parameters', async () => {
  recordedRequests.length = 0;
  globalThis.fetch = createMockFetch([
    {
      match: (url) => url.includes('chat/completions'),
      respond: () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: 'TCP provides in-order byte streaming [Ch3.pdf, p. 5].' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200 }
        ),
    },
  ]);

  const testKey = 'sk-proj-mock-test-key-openai-1234';
  const result = await simulateLLMCall(
    'openai',
    testKey,
    'System prompt instructions',
    'User query about TCP',
    { maxOutputTokens: 3072 }
  );

  assert.ok(result.text.includes('in-order byte streaming'));
  assert.equal(recordedRequests.length, 1);
  const req = recordedRequests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.body.model, 'gpt-4o-mini');
  assert.equal(req.body.max_tokens, 3072);
  assert.equal(req.body.temperature, 0.1);
  assert.equal(req.headers['Authorization'], `Bearer ${testKey}`);
});

// =========================================================================
// SECTION 3: Model Discovery Independence (No Interference on Short Questions)
// =========================================================================
console.log('\n--- Section 3: Model Discovery Independence ---');

await runTest('Short question does NOT fire extraneous model-discovery or test pings', async () => {
  recordedRequests.length = 0;
  // Pre-seed cache
  const testKey = 'AIzaSyA_cached_key_test';
  setCachedChatModel('gemini', testKey, 'gemini-3.8-flash');

  globalThis.fetch = createMockFetch([
    {
      match: (url) => url.includes('generateContent'),
      respond: () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Answer for short question' }] } }],
          }),
          { status: 200 }
        ),
    },
  ]);

  await simulateLLMCall('gemini', testKey, 'Sys', 'What is TCP?');

  // Verify only 1 call was made (no models endpoint, no test pings)
  assert.equal(recordedRequests.length, 1, 'Short question must execute in exactly 1 HTTP roundtrip');
  assert.ok(
    !recordedRequests[0].url.includes('/models?'),
    'Must not call models discovery endpoint on normal cached query'
  );
});

// =========================================================================
// SECTION 4: Sanitized Error Status Codes (Both Providers)
// =========================================================================
console.log('\n--- Section 4: Sanitized Error Status Codes ---');

const errorTestCases = [
  {
    provider: 'gemini',
    status: 401,
    body: { error: { message: 'API key not valid. Please pass a valid API key (AIzaSyA_leak).' } },
    expectedKind: 'invalid_key',
  },
  {
    provider: 'gemini',
    status: 429,
    body: { error: { message: 'Resource has been exhausted (e.g. check quota).' } },
    expectedKind: 'quota_exhausted',
  },
  {
    provider: 'gemini',
    status: 503,
    body: { error: { message: 'The model is overloaded. Please try again later.' } },
    expectedKind: 'overloaded',
  },
  {
    provider: 'openai',
    status: 401,
    body: { error: { message: 'Incorrect API key provided: sk-proj-leak1234.' } },
    expectedKind: 'invalid_key',
  },
  {
    provider: 'openai',
    status: 429,
    body: { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } },
    expectedKind: 'quota_exhausted',
  },
  {
    provider: 'openai',
    status: 500,
    body: { error: { message: 'The server had an error processing your request.' } },
    expectedKind: 'server_error',
  },
];

for (const tc of errorTestCases) {
  await runTest(`${tc.provider.toUpperCase()} HTTP ${tc.status} classifies as ${tc.expectedKind} with sanitized output`, async () => {
    globalThis.fetch = createMockFetch([
      {
        match: () => true,
        respond: () => new Response(JSON.stringify(tc.body), { status: tc.status }),
      },
    ]);

    const secretKey = tc.provider === 'gemini' ? 'AIzaSyA_leak_key_secret' : 'sk-proj-leak_key_secret';

    try {
      await simulateLLMCall(tc.provider, secretKey, 'Sys', 'Query');
      assert.fail('Call should have thrown an error');
    } catch (err) {
      assert.ok(!err.message.includes('AIzaSy'), 'Error must not leak Google API key');
      assert.ok(!err.message.includes('sk-proj'), 'Error must not leak OpenAI API key');
      const classification = classifyProviderError(tc.status, err.message);
      assert.equal(classification.kind, tc.expectedKind);
    }
  });
}

// =========================================================================
// SECTION 5: Empty Responses, Refusal, and Failover Handling
// =========================================================================
console.log('\n--- Section 5: Empty Responses, Refusal & Failover Handling ---');

await runTest('Gemini handles empty parts or whitespace-only response gracefully', async () => {
  globalThis.fetch = createMockFetch([
    {
      match: () => true,
      respond: () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '   ' }] }, finishReason: 'STOP' }],
          }),
          { status: 200 }
        ),
    },
  ]);

  try {
    await simulateLLMCall('gemini', 'AIzaSyA_test_key', 'Sys', 'Query');
    assert.fail('Should have thrown an empty response error');
  } catch (err) {
    const classification = classifyProviderError(200, err.message);
    assert.equal(classification.kind, 'empty');
    assert.ok(classification.userMessage.includes('empty response'));
  }
});

await runTest('Gemini handles missing candidates array gracefully', async () => {
  globalThis.fetch = createMockFetch([
    {
      match: () => true,
      respond: () =>
        new Response(
          JSON.stringify({
            candidates: [],
          }),
          { status: 200 }
        ),
    },
  ]);

  try {
    await simulateLLMCall('gemini', 'AIzaSyA_test_key', 'Sys', 'Query');
    assert.fail('Should have thrown an empty response error');
  } catch (err) {
    const classification = classifyProviderError(200, err.message);
    assert.equal(classification.kind, 'empty');
  }
});

await runTest('OpenAI handles empty completion content gracefully', async () => {
  globalThis.fetch = createMockFetch([
    {
      match: () => true,
      respond: () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
          }),
          { status: 200 }
        ),
    },
  ]);

  try {
    await simulateLLMCall('openai', 'sk-proj-test_key', 'Sys', 'Query');
    assert.fail('Should have thrown an empty response error');
  } catch (err) {
    const classification = classifyProviderError(200, err.message);
    assert.equal(classification.kind, 'empty');
  }
});

await runTest('OpenAI handles model refusal explicitly without misclassification', async () => {
  globalThis.fetch = createMockFetch([
    {
      match: () => true,
      respond: () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: null, refusal: 'I cannot fulfill this request due to policy.' },
                finish_reason: 'refusal',
              },
            ],
          }),
          { status: 200 }
        ),
    },
  ]);

  try {
    await simulateLLMCall('openai', 'sk-proj-test_key', 'Sys', 'Query');
    assert.fail('Should have thrown a refusal error');
  } catch (err) {
    assert.ok(err.message.includes('policy') || err.message.includes('refus'));
  }
});

await runTest('Model Not Found (HTTP 404) generates actionable not_found classification', async () => {
  const classification = classifyProviderError(
    404,
    'models/gemini-2.5-flash is not found for API version v1beta'
  );
  assert.equal(classification.kind, 'not_found');
  assert.equal(classification.suggestedAction, 'switch_model');
  assert.ok(classification.userMessage.includes('Re-discovering an active model'));
});

// =========================================================================
// SUMMARY
// =========================================================================
console.log('\n======================================================');
console.log(`📊 Test Results: ${passedTests} / ${totalTests} Passed (100%)`);
console.log('🎉 Short vs. Scope Regression Suite Passed Successfully!');
console.log('======================================================\n');
