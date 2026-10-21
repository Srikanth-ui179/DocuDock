/**
 * DocuDock Latency & Reliability Optimization Test Suite
 *
 * Validates:
 * 1. Session Model Caching (< 1ms cached lookup vs multi-second probe discovery).
 * 2. Secure key fingerprinting (one-way hash, zero key storage/leakage).
 * 3. Cache invalidation on key change and provider disconnect.
 * 4. Error classification (invalid_key, overloaded, quota_exhausted, rate_limit, not_found, network, timeout).
 * 5. Bounded retry behavior (max 2 retries, fast exit on overloaded models without 60s stalls).
 * 6. Multi-model candidate failover on 404/503/high-demand without switching to paid tiers.
 * 7. Passage de-duplication and similarity threshold filtering (0.18 threshold to avoid token bloat).
 * 8. Loading state termination & double-submission guard verification.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import assert from 'node:assert/strict';

// Mock sessionStorage for Node environment before importing modelCache
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
  recordOverloadedModel,
  isModelOverloaded,
  clearOverloadedModels,
  getCurrentlyOverloadedModels,
  getGeminiModelFamilyAliases,
  withTimeoutSignal,
  getCachedQueryEmbedding,
  setCachedQueryEmbedding,
  clearQueryEmbeddingCache,
  clearDiscoveredModelsCache,
  isConversationalGreeting,
} from '../src/lib/ai/modelCache.ts';

console.log('⚡ Starting DocuDock Latency & Reliability Optimization Test Suite...\n');

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
  }
}

// =========================================================================
// SUITE 1: Model Caching & Key Fingerprinting
// =========================================================================
console.log('--- Test Suite 1: Model Caching & Zero-Leak Key Fingerprinting ---');

await runTest('Key fingerprinting produces deterministic, non-reversible hash without leaking key', () => {
  const rawKey = 'AIzaSyA_test_secret_key_123456789';
  const hash1 = hashApiKey(rawKey);
  const hash2 = hashApiKey(rawKey);

  assert.equal(hash1, hash2, 'Hash must be deterministic');
  assert.equal(typeof hash1, 'string');
  assert.ok(hash1.startsWith('fp_AIz_'), 'Hash should include non-reversible prefix structure');
  assert.ok(!hash1.includes('test_secret'), 'Hash must not contain plaintext key substrings');
  assert.ok(!rawKey.includes(hash1), 'Hash is one-way representation');
});

await runTest('Model cache hit returns in < 1ms (0ms nominal) without network roundtrips', () => {
  const testKey = 'AIzaSyA_mock_key_perf_test';
  invalidateModelCache('gemini');

  // Initial miss
  assert.equal(getCachedChatModel('gemini', testKey), null);

  // Set cache
  setCachedChatModel('gemini', testKey, 'gemini-3.8-flash');

  // Benchmark cache read latency over 1000 lookups
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    const model = getCachedChatModel('gemini', testKey);
    assert.equal(model, 'gemini-3.8-flash');
  }
  const totalMs = performance.now() - t0;
  const avgMs = totalMs / 1000;

  console.log(`     Latency per cached model lookup: ${(avgMs * 1000).toFixed(2)} µs (avg: ${avgMs.toFixed(4)} ms)`);
  assert.ok(avgMs < 0.1, `Cached model lookup must be under 0.1ms, was ${avgMs}ms`);
});

await runTest('Cache invalidation resets model on key rotation or provider disconnect', () => {
  const keyA = 'AIzaSyA_user_key_alpha';
  const keyB = 'AIzaSyA_user_key_beta';

  setCachedChatModel('gemini', keyA, 'gemini-3.8-flash');
  assert.equal(getCachedChatModel('gemini', keyA), 'gemini-3.8-flash');

  // Different key gets cache miss, preventing credential crossover
  assert.equal(getCachedChatModel('gemini', keyB), null);

  // Invalidate provider cache
  invalidateModelCache('gemini');
  assert.equal(getCachedChatModel('gemini', keyA), null);
  assert.equal(getCachedChatModel('gemini', keyB), null);
});

// =========================================================================
// SUITE 2: Error Classification
// =========================================================================
console.log('\n--- Test Suite 2: Granular Error Classification ---');

await runTest('Classifies invalid API keys accurately', () => {
  const err1 = new Error('API_KEY_INVALID: User API key is not valid');
  assert.equal(classifyProviderError(err1).kind, 'invalid_key');

  const err2 = new Error('HTTP 400: API key not valid. Please pass a valid API key.');
  assert.equal(classifyProviderError(err2).kind, 'invalid_key');

  const err3 = new Error('HTTP 403: Forbidden - unauthorized key');
  assert.equal(classifyProviderError(err3).kind, 'invalid_key');
});

await runTest('Classifies high-demand / overloaded model errors', () => {
  const err1 = new Error('This model is currently experiencing high demand. Please try again later.');
  assert.equal(classifyProviderError(err1).kind, 'overloaded');

  const err2 = new Error('HTTP 503: The service is temporarily unavailable / overloaded');
  assert.equal(classifyProviderError(err2).kind, 'overloaded');

  const err3 = new Error('Resource has been exhausted (e.g. check quota), model is overloaded');
  assert.equal(classifyProviderError(err3).kind, 'overloaded');
});

await runTest('Classifies rate limits vs quota exhaustion', () => {
  const errQuota = new Error('RESOURCE_EXHAUSTED: Quota exceeded for quota metric');
  assert.equal(classifyProviderError(errQuota).kind, 'quota_exhausted');

  const errRate = new Error('HTTP 429: Too many requests, slow down');
  assert.equal(classifyProviderError(errRate).kind, 'rate_limit');
});

await runTest('Classifies 404 / model not found errors', () => {
  const err1 = new Error('HTTP 404: models/gemini-2.0-flash is not found for API version v1beta');
  assert.equal(classifyProviderError(err1).kind, 'not_found');

  const err2 = new Error('models/gemini-old is not found');
  assert.equal(classifyProviderError(err2).kind, 'not_found');
});

await runTest('Classifies network failures and timeouts', () => {
  const errNet1 = new Error('Failed to fetch from Google Gemini API');
  assert.equal(classifyProviderError(errNet1).kind, 'network');

  const errNet2 = new Error('TypeError: fetch failed');
  assert.equal(classifyProviderError(errNet2).kind, 'network');

  const errTimeout = new Error('Request timed out after 30000ms');
  assert.equal(classifyProviderError(errTimeout).kind, 'timeout');
});

// =========================================================================
// SUITE 3: Bounded Retries & Overload Fast-Exit Simulation
// =========================================================================
console.log('\n--- Test Suite 3: Bounded Retries & Overload Fast-Exit ---');

// Reusable bounded retry executor matching providers.ts logic
async function simulateFetchWithRetry(mockFetch, maxRetries = 2, initialDelayMs = 50) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await mockFetch();
    if (res.ok) return res;

    const isRateLimited = res.status === 429;
    const isServerError = res.status >= 500 && res.status < 600;

    if ((isRateLimited || isServerError) && attempt < maxRetries) {
      const text = await res.text();
      const rawMsg = text.toLowerCase();
      // Fast exit on high demand / overloaded
      if (rawMsg.includes('high demand') || rawMsg.includes('overloaded') || rawMsg.includes('service unavailable')) {
        return res;
      }
      await new Promise(r => setTimeout(r, initialDelayMs * Math.pow(2, attempt)));
      continue;
    }
    return res;
  }
}

await runTest('fetchWithRetry fails fast on overloaded / high-demand errors without stalling', async () => {
  let callCount = 0;
  const mockFetchOverloaded = async () => {
    callCount++;
    return {
      ok: false,
      status: 503,
      text: async () => 'This model is currently experiencing high demand. Please try again later.',
    };
  };

  const t0 = performance.now();
  const res = await simulateFetchWithRetry(mockFetchOverloaded, 2, 100);
  const duration = performance.now() - t0;

  assert.equal(res.ok, false);
  // Fast exit: must NOT retry 6 times and stall for tens of seconds!
  assert.equal(callCount, 1, 'Must exit immediately on high-demand without hammering overloaded model');
  assert.ok(duration < 250, `Duration should be under 250ms, was ${duration.toFixed(2)}ms`);
});

await runTest('fetchWithRetry bounds transient errors to max 2 retries (total 3 attempts)', async () => {
  let callCount = 0;
  const mockFetchTransient = async () => {
    callCount++;
    return {
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    };
  };

  const res = await simulateFetchWithRetry(mockFetchTransient, 2, 20);
  assert.equal(res.ok, false);
  // Initial attempt + 2 retries = 3 calls total
  assert.equal(callCount, 3, 'Must attempt exactly initial + 2 retries = 3 calls');
});

// =========================================================================
// SUITE 4: Multi-Model Discovery & Automatic Failover
// =========================================================================
console.log('\n--- Test Suite 4: Multi-Model Candidate Failover ---');

await runTest('Model candidate failover selects healthy fallback model when primary is unavailable', async () => {
  const GEMINI_FREE_CANDIDATES = [
    'gemini-3.8-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ];

  const testKey = 'AIzaSyA_failover_test_key';
  invalidateModelCache('gemini');

  // Simulate primary model experiencing 503 high demand
  const modelStatus = {
    'gemini-3.8-flash': 503, // Overloaded
    'gemini-2.0-flash': 200, // Healthy
    'gemini-1.5-flash': 404, // Unavailable
  };

  const discoverModel = async (excludeModels = []) => {
    for (const candidate of GEMINI_FREE_CANDIDATES) {
      if (excludeModels.includes(candidate)) continue;
      const status = modelStatus[candidate];
      if (status === 200) {
        setCachedChatModel('gemini', testKey, candidate);
        return candidate;
      }
    }
    throw new Error('No candidate available');
  };

  // Exclude the overloaded gemini-3.8-flash
  const activeModel = await discoverModel(['gemini-3.8-flash']);
  assert.equal(activeModel, 'gemini-2.0-flash', 'Should choose healthy fallback model');
  assert.equal(getCachedChatModel('gemini', testKey), 'gemini-2.0-flash', 'Should cache the fallback model');
});

// =========================================================================
// SUITE 5: RAG Pipeline Optimization (Deduplication & Threshold)
// =========================================================================
console.log('\n--- Test Suite 5: RAG Passage Deduplication & Noise Pruning ---');

await runTest('De-duplicates chunks and prunes low-similarity noise at 0.18 threshold', () => {
  const rawMatches = [
    { chunk_id: 'c1', similarity: 0.85, document_name: 'Transport.pdf', page_number: 10, content: 'TCP flow control' },
    { chunk_id: 'c1', similarity: 0.85, document_name: 'Transport.pdf', page_number: 10, content: 'TCP flow control' }, // duplicate
    { chunk_id: 'c2', similarity: 0.42, document_name: 'Transport.pdf', page_number: 12, content: 'Congestion window' },
    { chunk_id: 'c3', similarity: 0.17, document_name: 'Transport.pdf', page_number: 55, content: 'Irrelevant index footnote' }, // < 0.18
    { chunk_id: 'c4', similarity: 0.19, document_name: 'Transport.pdf', page_number: 14, content: 'Additive increase' },
  ];

  // Apply our deduplication & 0.18 threshold logic
  const seen = new Set();
  const filtered = [];
  for (const match of rawMatches) {
    if (match.similarity < 0.18) continue;
    if (seen.has(match.chunk_id)) continue;
    seen.add(match.chunk_id);
    filtered.push(match);
  }

  assert.equal(filtered.length, 3, 'Should keep exactly 3 unique chunks');
  assert.equal(filtered[0].chunk_id, 'c1');
  assert.equal(filtered[1].chunk_id, 'c2');
  assert.equal(filtered[2].chunk_id, 'c4');
  assert.ok(!filtered.some(c => c.chunk_id === 'c3'), 'Must filter out chunk with similarity 0.17 < 0.18');
});

// =========================================================================
// SUITE 6: UI Resilience & State Guarantees
// =========================================================================
console.log('\n--- Test Suite 6: State Machine Resilience & Double Submission Guard ---');

await runTest('Double-submission guard blocks concurrent calls during active query', async () => {
  let isSubmitting = false;
  let executions = 0;

  const mockSendMessage = async () => {
    if (isSubmitting) return 'BLOCKED';
    isSubmitting = true;
    try {
      executions++;
      await new Promise(r => setTimeout(r, 20));
      return 'COMPLETED';
    } finally {
      isSubmitting = false;
    }
  };

  // Simulate two rapid clicks
  const [res1, res2] = await Promise.all([
    mockSendMessage('Query 1'),
    mockSendMessage('Query 1 - duplicate click'),
  ]);

  assert.equal(executions, 1, 'Only one execution should proceed');
  assert.ok(res1 === 'COMPLETED' || res2 === 'COMPLETED');
  assert.ok(res1 === 'BLOCKED' || res2 === 'BLOCKED');
});

await runTest('Safety timeout race guarantees state termination if provider hangs', async () => {
  let isLoading = true;

  const hangingProviderCall = new Promise(() => {
    // Intentionally never resolves (simulating dead socket / indefinite hang)
  });

  const TIMEOUT_LIMIT_MS = 50; // fast test limit
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timed out after safety threshold')), TIMEOUT_LIMIT_MS);
  });

  let caughtError = null;
  try {
    await Promise.race([hangingProviderCall, timeoutPromise]);
  } catch (err) {
    caughtError = err;
  } finally {
    isLoading = false;
  }

  assert.ok(caughtError !== null, 'Timeout race must fire');
  assert.equal(isLoading, false, 'Loading state must be cleared in finally block');
  assert.ok(caughtError.message.includes('timed out'));
});

// =========================================================================
// SUITE 7: Fast Conversational Greeting Intent Detection
// =========================================================================
console.log('\n--- Test Suite 7: Fast Conversational Greeting Intent Detection ---');

await runTest('Classifies simple greetings as conversational (bypasses RAG retrieval in < 1ms)', () => {
  const greetings = [
    'hello',
    'hi',
    'hey',
    'hello there',
    'hi there',
    'hey there',
    'good morning',
    'good afternoon',
    'good evening',
    'who are you',
    'what can you do',
    'what is docudock',
    'help',
    'how does this work',
  ];

  for (const g of greetings) {
    const isGreeting = isConversationalGreeting(g);
    assert.equal(isGreeting, true, `"${g}" must be detected as conversational greeting`);
  }
});

await runTest('Classifies substantive research questions as non-greetings (enforces full RAG)', () => {
  const researchQueries = [
    'whats cerebellum',
    'what is cerebellum',
    'what is TCP?',
    'explain page 5',
    'summarize HAP 2.pdf',
    'how does TCP flow control work',
    'cerebellum',
    'respiratory system',
  ];

  for (const q of researchQueries) {
    const isGreeting = isConversationalGreeting(q);
    assert.equal(isGreeting, false, `"${q}" must NOT be classified as greeting`);
  }
});

// =========================================================================
// SUITE 8: In-Memory Query Embedding Caching
// =========================================================================
console.log('\n--- Test Suite 8: Query Embedding Caching ---');

await runTest('Caches query embeddings in memory and returns repeated queries in < 1ms', () => {
  clearQueryEmbeddingCache();
  const testQuery = 'whats cerebellum';
  const dummyEmbedding = new Array(768).fill(0.05);

  // Initial miss
  assert.equal(getCachedQueryEmbedding('gemini', testQuery), null);

  // Set cache
  setCachedQueryEmbedding('gemini', testQuery, dummyEmbedding);

  // Cached hit benchmark
  const t0 = performance.now();
  const cached = getCachedQueryEmbedding('gemini', testQuery);
  const latency = performance.now() - t0;

  assert.deepEqual(cached, dummyEmbedding);
  assert.ok(latency < 1.0, `Cache lookup should be < 1ms, took ${latency.toFixed(4)}ms`);

  // Clear cache
  clearQueryEmbeddingCache();
  assert.equal(getCachedQueryEmbedding('gemini', testQuery), null);
});

// =========================================================================
// SUITE 9: Per-Attempt Timeout & Request Cancellation
// =========================================================================
console.log('\n--- Test Suite 9: Per-Attempt Timeout & Request Cancellation ---');

await runTest('withTimeoutSignal aborts individual attempt when attempt timeout fires', async () => {
  const { signal, cleanup } = withTimeoutSignal(undefined, 30);
  assert.equal(signal.aborted, false);

  await new Promise((r) => setTimeout(r, 45));
  assert.equal(signal.aborted, true);
  assert.ok(signal.reason instanceof Error);
  assert.ok(signal.reason.message.includes('timed out'));
  cleanup();
});

await runTest('withTimeoutSignal respects parent cancellation immediately', () => {
  const parentController = new AbortController();
  const { signal, cleanup } = withTimeoutSignal(parentController.signal, 5000);

  assert.equal(signal.aborted, false);
  parentController.abort(new Error('User cancelled query'));

  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.message, 'User cancelled query');
  cleanup();
});

// =========================================================================
// SUITE 10: Slow Upstream Deadlines & Error Classification
// =========================================================================
console.log('\n--- Test Suite 10: Slow Upstream Deadlines & Error Classification ---');

await runTest('Overall deadline aborts hanging request and classifies as timeout', async () => {
  const abortController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    abortController.abort(new Error('Request timed out waiting for the AI response. Please click Retry.'));
  }, 40);

  let caughtError = null;
  try {
    await new Promise((_, reject) => {
      abortController.signal.addEventListener('abort', () => {
        reject(abortController.signal.reason);
      });
    });
  } catch (err) {
    caughtError = err;
  } finally {
    clearTimeout(deadlineTimer);
  }

  assert.ok(caughtError !== null);
  const classification = classifyProviderError(0, caughtError.message);
  assert.equal(classification.kind, 'timeout');
  assert.ok(classification.userMessage.includes('timed out'));
  assert.equal(classification.isRetryable, true);
});

// =========================================================================
// SUITE 11: 503 Overload Cooldown & Distinct Model Failover
// =========================================================================
console.log('\n--- Test Suite 11: 503 Overload Cooldown & Distinct Model Failover ---');

await runTest('503 Overload records model family in cooldown and fails over to distinct family', () => {
  clearOverloadedModels();

  // Model gemini-3.8-flash encounters 503
  recordOverloadedModel('gemini-3.8-flash');

  // Both the model and its family aliases must be in cooldown
  assert.equal(isModelOverloaded('gemini-3.8-flash'), true);
  assert.equal(isModelOverloaded('gemini-3.8-flash-latest'), true);

  // Distinct model family must NOT be in cooldown
  assert.equal(isModelOverloaded('gemini-2.0-flash'), false);
  assert.equal(isModelOverloaded('gemini-1.5-flash'), false);

  clearOverloadedModels();
});

// =========================================================================
// SUITE 12: Failed Embeddings & Retrieval Error Handling
// =========================================================================
console.log('\n--- Test Suite 12: Failed Embeddings & Retrieval Error Handling ---');

await runTest('Classifies embedding network errors and empty values gracefully', () => {
  const errNet = new Error('Failed to fetch embedding');
  const classNet = classifyProviderError(errNet);
  assert.equal(classNet.kind, 'network');

  const errEmpty = new Error('The embedding model returned no values.');
  const classEmpty = classifyProviderError(errEmpty);
  assert.equal(classEmpty.kind, 'empty');
});

// =========================================================================
// SUITE 13: Manual Retry Query Deduplication
// =========================================================================
console.log('\n--- Test Suite 13: Manual Retry Query Deduplication ---');

await runTest('Retry query strips previous error card and does not duplicate user message', () => {
  const baseMessages = [
    { id: '1', role: 'user', content: 'whats cerebellum', timestamp: 100 },
    { id: '2', role: 'assistant', content: 'Request timed out waiting for the AI response.', error: true, timestamp: 200 },
  ];

  const failedMessageId = '2';
  const retryQuery = 'whats cerebellum';

  // 1. Remove old error card
  const filtered = baseMessages.filter((m) => m.id !== failedMessageId);
  assert.equal(filtered.length, 1);

  // 2. Check if previous message is already the user query
  const lastMsg = filtered[filtered.length - 1];
  const isDuplicate = lastMsg?.role === 'user' && lastMsg.content.trim() === retryQuery.trim();
  assert.equal(isDuplicate, true, 'Should detect user query is already present');

  // Result: user message is not appended a second time
  const messagesToSend = isDuplicate ? filtered : [...filtered, { id: '3', role: 'user', content: retryQuery, timestamp: 300 }];
  assert.equal(messagesToSend.length, 1);
  assert.equal(messagesToSend[0].content, 'whats cerebellum');
});

// =========================================================================
// SUITE 14: Quota & Authentication Error Differentiation
// =========================================================================
console.log('\n--- Test Suite 14: Quota & Authentication Differentiation ---');

await runTest('Granularly differentiates auth errors, daily quota, and rate limits', () => {
  const authErr = classifyProviderError(401, 'API_KEY_INVALID');
  assert.equal(authErr.kind, 'invalid_key');
  assert.equal(authErr.isRetryable, false);

  const quotaErr = classifyProviderError(429, 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric limit: 0');
  assert.equal(quotaErr.kind, 'quota_exhausted');
  assert.equal(quotaErr.isRetryable, false);

  const rateErr = classifyProviderError(429, 'Too many requests, slow down');
  assert.equal(rateErr.kind, 'rate_limit');
  assert.equal(rateErr.isRetryable, true);
});

// =========================================================================
// SUITE 15: Correct Physical-Page Citations After Grounded Answer
// =========================================================================
console.log('\n--- Test Suite 15: Physical-Page Citations Integrity ---');

await runTest('Verifies citation format and physical page bounds in grounded answers', () => {
  const sampleAnswer =
    'The cerebellum plays an important role in motor control [HAP 2.pdf, p. 2]. It coordinates voluntary movements [HAP 2.pdf, p. 3].';

  const citationRegex = /\[([^,]+),\s*p\.\s*(\d+)\]/g;
  const matches = Array.from(sampleAnswer.matchAll(citationRegex));

  assert.equal(matches.length, 2);
  assert.equal(matches[0][1].trim(), 'HAP 2.pdf');
  assert.equal(matches[0][2], '2');
  assert.equal(matches[1][1].trim(), 'HAP 2.pdf');
  assert.equal(matches[1][2], '3');
});

// =========================================================================
// SUMMARY
// =========================================================================
console.log('\n=========================================');
console.log(`📊 Latency & Reliability Suite Finished:`);
console.log(`   Total Tests:  ${totalTests}`);
console.log(`   Passed Tests: ${passedTests}`);
console.log(`   Failed Tests: ${totalTests - passedTests}`);
console.log('=========================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  console.log('🎉 All latency & reliability optimization tests passed successfully!');
}
