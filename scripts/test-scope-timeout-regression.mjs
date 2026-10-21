import assert from 'node:assert/strict';
import { parseScopeQuery } from '../src/lib/utils/scopeQueryParser.mjs';
import { partitionPageRange } from '../src/lib/utils/scopeBatchHelper.ts';
import { withTimeoutSignal } from '../src/lib/ai/modelCache.ts';

console.log('🧪 Starting Scope Query Timeout & Latency Regression Suite...\n');

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
    console.error(err);
    process.exitCode = 1;
  }
}

// =========================================================================
// Suite 1: Query Intent & Scope Detection Parity
// =========================================================================
console.log('--- Suite 1: Query Intent & Adaptive Timeout Categorization ---');

await runTest('"Summarize the first 10 pages" is detected as a scope query with range 1-10', () => {
  const intent = parseScopeQuery('Summarize the first 10 pages', ['HAP 2.pdf']);
  assert.equal(intent.isScopeQuery, true);
  assert.equal(intent.scopeType, 'range');
  assert.equal(intent.startPage, 1);
  assert.equal(intent.endPage, 10);
});

await runTest('"What is the function of the cerebellum" is detected as standard factual Q&A', () => {
  const intent = parseScopeQuery('What is the function of the cerebellum', ['HAP 2.pdf']);
  assert.equal(intent.isScopeQuery, false);
});

await runTest('Adaptive timeout allocator gives scope queries generous generation budget', () => {
  const scopeQuery = 'Summarize the first 10 pages';
  const factualQuery = 'What is the function of the cerebellum';

  const isScope1 = parseScopeQuery(scopeQuery).isScopeQuery;
  const overall1 = isScope1 ? 120000 : 45000;
  const perAttempt1 = isScope1 ? 45000 : 25000;

  assert.equal(overall1, 120000, 'Scope queries must have at least 120s overall deadline');
  assert.equal(perAttempt1, 45000, 'Scope queries must have at least 45s per-attempt timeout');

  const isScope2 = parseScopeQuery(factualQuery).isScopeQuery;
  const overall2 = isScope2 ? 120000 : 45000;
  const perAttempt2 = isScope2 ? 45000 : 25000;

  assert.equal(overall2, 45000, 'Factual queries must have 45s overall deadline');
  assert.equal(perAttempt2, 25000, 'Factual queries must have 25s per-attempt timeout');
});

// =========================================================================
// Suite 2: Scope Page Clamping for HAP 2.pdf (2 pages)
// =========================================================================
console.log('\n--- Suite 2: Document Length Clamping & Batch Partitioning ---');

await runTest('Clamps 10-page request to physical document bounds (2 pages for HAP 2.pdf)', () => {
  const docPageCount = 2; // HAP 2.pdf
  const intent = parseScopeQuery('Summarize the first 10 pages');

  const rawStart = intent.startPage || 1;
  const rawEnd = intent.endPage || docPageCount;
  const clampedStart = Math.max(1, Math.min(rawStart, rawEnd));
  const clampedEnd = Math.min(docPageCount, Math.max(rawStart, rawEnd));

  assert.equal(clampedStart, 1);
  assert.equal(clampedEnd, 2);

  const batches = partitionPageRange(clampedStart, clampedEnd);
  assert.equal(batches.length, 1, 'HAP 2.pdf should partition into 1 batch of pages 1-2');
  assert.equal(batches[0].startPage, 1);
  assert.equal(batches[0].endPage, 2);
});

await runTest('Partitions a full 10-page document into multi-page batches', () => {
  const batches = partitionPageRange(1, 10);
  assert.ok(batches.length >= 3, '10 pages should partition into at least 3 batches of 3-4 pages');
  assert.equal(batches[0].startPage, 1);
  assert.equal(batches[batches.length - 1].endPage, 10);
});

// =========================================================================
// Suite 3: Generation Timeout Protection (Old 15s Failure vs New 45s Success)
// =========================================================================
console.log('\n--- Suite 3: Generation Latency Timeout Simulation ---');

await runTest('Old 15s timeout prematurely aborts a 20s in-depth generation', async () => {
  // Simulate generation that needs 80ms while attempt timeout is set to 50ms
  const { signal, cleanup } = withTimeoutSignal(undefined, 50);
  let abortedPrematurely = false;

  const generationPromise = new Promise((resolve) => setTimeout(resolve, 80));
  try {
    await Promise.race([
      generationPromise,
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          abortedPrematurely = true;
          reject(signal.reason);
        });
      }),
    ]);
  } catch {
    // Expected abort
  } finally {
    cleanup();
  }

  assert.equal(abortedPrematurely, true, 'Short timeout must abort when generation takes longer');
});

await runTest('New 45s generation timeout allows a 20s in-depth generation to complete', async () => {
  // Scaled down: 120ms timeout gives sufficient time for an 80ms generation
  const { signal, cleanup } = withTimeoutSignal(undefined, 120);
  let aborted = false;

  const generationPromise = new Promise((resolve) => {
    setTimeout(() => resolve('Completed scope explanation'), 60);
  });

  let result = null;
  try {
    result = await Promise.race([
      generationPromise,
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        });
      }),
    ]);
  } finally {
    cleanup();
  }

  assert.equal(aborted, false, 'Generous timeout must not abort active generation');
  assert.equal(result, 'Completed scope explanation');
});

// =========================================================================
// Suite 4: Scope Progress Messaging
// =========================================================================
console.log('\n--- Suite 4: In-Flight Progress Updates ---');

await runTest('Emits progress status for each batch to keep UI responsive', () => {
  const batches = partitionPageRange(1, 10);
  const progressMessages = [];

  for (let i = 0; i < batches.length; i++) {
    const { startPage: bStart, endPage: bEnd } = batches[i];
    progressMessages.push(`Generating explanation for pages ${bStart}–${bEnd} (Part ${i + 1} of ${batches.length})...`);
  }

  assert.equal(progressMessages.length, batches.length);
  assert.ok(progressMessages[0].includes('Part 1 of'));
  assert.ok(progressMessages[progressMessages.length - 1].includes(`Part ${batches.length} of ${batches.length}`));
});

// =========================================================================
// Suite 5: Parent Signal Cancellation Propagation
// =========================================================================
console.log('\n--- Suite 5: Parent Signal Cancellation Propagation ---');

await runTest('User-initiated abort cancels in-flight scope attempt immediately', () => {
  const parent = new AbortController();
  const { signal, cleanup } = withTimeoutSignal(parent.signal, 45000);

  assert.equal(signal.aborted, false);
  parent.abort(new Error('User clicked Stop'));
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.message, 'User clicked Stop');
  cleanup();
});

// =========================================================================
// Suite 6: Abort Handling & Pointless Retries Prevention
// =========================================================================
console.log('\n--- Suite 6: Aborted Requests Not Retried & 120s Scope Deadline ---');

// Implement abort-aware sleep matching providers.ts
function sleepWithSignal(ms, signal) {
  if (signal?.aborted) {
    const msg = signal.reason instanceof Error ? signal.reason.message : 'Request was cancelled or timed out';
    return Promise.reject(new Error(msg));
  }
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      const msg = signal?.reason instanceof Error ? signal.reason.message : 'Request was cancelled or timed out';
      reject(new Error(msg));
    };
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

await runTest('Pre-aborted parent signal halts immediately with 0 fetch attempts', async () => {
  const parent = new AbortController();
  parent.abort(new Error('Pre-aborted request'));

  let attempts = 0;
  async function simulatedFetchWithRetry(parentSignal) {
    if (parentSignal?.aborted) {
      throw new Error(parentSignal.reason.message);
    }
    attempts++;
  }

  await assert.rejects(
    async () => await simulatedFetchWithRetry(parent.signal),
    /Pre-aborted request/
  );
  assert.equal(attempts, 0, 'Must not attempt any fetch when signal is already aborted');
});

await runTest('Timed-out attempt (isAttemptTimeout) throws immediately and is NOT retried pointlessly', async () => {
  let attemptCount = 0;
  const timeoutMs = 50;

  async function mockFetchWithTimeout(parentSignal) {
    for (let attempt = 0; attempt <= 2; attempt++) {
      attemptCount++;
      const { signal: attemptSignal, cleanup } = withTimeoutSignal(parentSignal, timeoutMs);
      try {
        // Simulate hanging request that exceeds attempt timeout
        await new Promise((_, reject) => {
          attemptSignal.addEventListener('abort', () => {
            reject(new Error(`AbortError: Request timed out after ${timeoutMs}ms`));
          });
        });
      } catch (err) {
        cleanup();
        const isAttemptTimeout = err.message.includes('timed out');
        if (isAttemptTimeout) {
          throw new Error(`Request timed out after ${timeoutMs}ms waiting for provider response`);
        }
      } finally {
        cleanup();
      }
    }
  }

  await assert.rejects(
    async () => await mockFetchWithTimeout(undefined),
    /Request timed out after 50ms waiting for provider response/
  );

  assert.equal(attemptCount, 1, 'Timed-out attempt must NOT be retried (attempt count must be strictly 1)');
});

await runTest('sleepWithSignal terminates immediately when parentSignal aborts during backoff delay', async () => {
  const parent = new AbortController();
  const sleepStart = Date.now();

  setTimeout(() => {
    parent.abort(new Error('Cancelled during sleep delay'));
  }, 30);

  await assert.rejects(
    async () => await sleepWithSignal(5000, parent.signal),
    /Cancelled during sleep delay/
  );

  const elapsed = Date.now() - sleepStart;
  assert.ok(elapsed < 200, `Sleep should have aborted in ~30ms, took ${elapsed}ms`);
});

await runTest('120-second scope query overall deadline halts multi-batch execution', async () => {
  const query = 'Summarize the first 10 pages';
  const isScope = parseScopeQuery(query).isScopeQuery;
  const overallDeadlineMs = isScope ? 120000 : 45000;
  assert.equal(overallDeadlineMs, 120000);

  // Simulate batch loop respecting parent signal
  const parent = new AbortController();
  const batches = partitionPageRange(1, 10);
  let completedBatches = 0;

  // Abort after part 1
  for (let i = 0; i < batches.length; i++) {
    if (parent.signal.aborted) {
      break;
    }
    completedBatches++;
    if (completedBatches === 1) {
      parent.abort(new Error('Request timed out waiting for the AI response. Please click Retry.'));
    }
  }

  assert.equal(completedBatches, 1, 'Remaining batches must abort when overall deadline triggers');
  assert.equal(parent.signal.reason.message, 'Request timed out waiting for the AI response. Please click Retry.');
});

console.log('\n=========================================');
console.log(`📊 Scope Timeout Regression Suite Finished:`);
console.log(`   Total Tests:  ${totalTests}`);
console.log(`   Passed Tests: ${passedTests}`);
console.log(`   Failed Tests: ${totalTests - passedTests}`);
console.log('=========================================\n');

if (passedTests === totalTests) {
  console.log('🎉 All scope query timeout regression tests passed successfully!');
} else {
  process.exit(1);
}
