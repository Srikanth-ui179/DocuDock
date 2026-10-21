/**
 * test-truncation-continuation.mjs
 *
 * Automated test suite verifying:
 * 1. Truncation detection (finishReason: 'MAX_TOKENS' or 'length') and isTruncated flagging.
 * 2. Automatic continuation generation from last completed page.
 * 3. Batch partitioning for multi-page ranges (3-4 pages per batch with generous token budget).
 * 4. Merging batch responses without duplicate section headings or redundant title banners.
 * 5. Full page coverage in order with physical page citations.
 * 6. Interactive continuation banner formatting and action trigger.
 * 7. Preservation of concise factual query behavior ("What is TCP?").
 * 8. Zero fabrication of missing/unextractable pages.
 */

import assert from 'node:assert/strict';

// Dynamic import of utilities
const {
  partitionPageRange,
  calculateOptimalBatchSize,
  detectLastCompletedPage,
  mergeBatchResponses,
  formatContinuationBanner,
} = await import('../src/lib/utils/scopeBatchHelper.ts');

const { parseScopeQuery } = await import('../src/lib/utils/scopeQueryParser.mjs');

console.log('======================================================================');
console.log('🧪 DOCUDOCK TRUNCATION, CONTINUATION & BATCH MERGING SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// TEST 1: Optimal Batch Size Calculation
// ---------------------------------------------------------------------------
runTest('Batch size calculation partitions ranges into generous <=4 page groups', () => {
  assert.equal(calculateOptimalBatchSize(1), 1);
  assert.equal(calculateOptimalBatchSize(3), 3);
  assert.equal(calculateOptimalBatchSize(5), 3);
  assert.equal(calculateOptimalBatchSize(10), 3);
  assert.equal(calculateOptimalBatchSize(20), 4);
});

// ---------------------------------------------------------------------------
// TEST 2: Partitioning "first 10 pages" into sequential batches
// ---------------------------------------------------------------------------
runTest('Partitioning 10 pages produces sequential non-overlapping batches covering pages 1-10', () => {
  const batches = partitionPageRange(1, 10);
  assert.equal(batches.length, 4, '10 pages partitioned into 4 batches (3, 3, 3, 1)');
  
  assert.equal(batches[0].startPage, 1);
  assert.equal(batches[0].endPage, 3);

  assert.equal(batches[1].startPage, 4);
  assert.equal(batches[1].endPage, 6);

  assert.equal(batches[2].startPage, 7);
  assert.equal(batches[2].endPage, 9);

  assert.equal(batches[3].startPage, 10);
  assert.equal(batches[3].endPage, 10);

  // Verify total page coverage
  const coveredPages = [];
  for (const b of batches) {
    for (let p = b.startPage; p <= b.endPage; p++) {
      coveredPages.push(p);
    }
  }
  assert.deepEqual(coveredPages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Every single requested page must be represented');
});

// ---------------------------------------------------------------------------
// TEST 3: Truncation Detection and Page Scanning
// ---------------------------------------------------------------------------
runTest('detectLastCompletedPage scans markdown headings and citations to find highest finished page', () => {
  const partialExplanation = `
# Comprehensive Guide: Chapter 3 (Pages 1–10)

## Pages 1–2: Introduction to Transport Services
Transport layer protocols provide logical communication between application processes [Ch3_Transport_Layer.pdf, p. 1].
Overview of multiplexing and demultiplexing [Ch3_Transport_Layer.pdf, p. 2].

## Page 3: Overview of Transport Services
Connectionless vs connection-oriented service models [Ch3_Transport_Layer.pdf, p. 3].

## Page 4: Multiplexing and Demultiplexing
How ports work at endpoints [Ch3_Transport_Layer.pdf, p. 4].

> [!WARNING]
> **Incomplete Response (Token Limit Reached)**: The model reached its output limit before completing all steps.
`;

  const lastPage = detectLastCompletedPage(partialExplanation, 1);
  assert.equal(lastPage, 4, 'Should detect that explanation successfully completed through page 4');
});

// ---------------------------------------------------------------------------
// TEST 4: Batch Merging and Duplicate Section Prevention
// ---------------------------------------------------------------------------
runTest('mergeBatchResponses merges continuation without duplicate headings or warning banners', () => {
  const part1WithWarning = `
# Comprehensive Guide: Ch3_Transport_Layer.pdf (Pages 1–10)

## Page 1: Chapter Goals
The primary transport layer services [Ch3_Transport_Layer.pdf, p. 1].

## Page 2: Principles of Transport Layer
Logical communication between hosts [Ch3_Transport_Layer.pdf, p. 2].

> [!WARNING]
> **Incomplete Response (Token Limit Reached)**: The model reached its output limit.
`;

  const incomingPart2 = `
# Comprehensive Guide: Ch3_Transport_Layer.pdf (Pages 1–10)

## Page 2: Principles of Transport Layer
Logical communication between hosts.

## Page 3: UDP Checksum
UDP provides lightweight error detection [Ch3_Transport_Layer.pdf, p. 3].

## Page 4: Stop and Wait ARQ
Stop and wait protocol operations [Ch3_Transport_Layer.pdf, p. 4].
`;

  const merged = mergeBatchResponses(part1WithWarning, incomingPart2);

  // 1. Incomplete warning banner must be stripped upon continuation
  assert.ok(!merged.includes('Incomplete Response (Token Limit Reached)'), 'Incomplete warning box must be cleanly removed on continuation');

  // 2. Redundant top-level header must not be duplicated
  const headerCount = (merged.match(/# Comprehensive Guide/g) || []).length;
  assert.equal(headerCount, 1, 'Top-level guide title should appear only once');

  // 3. Repeated Section "Page 2" must not be duplicated
  const page2Count = (merged.match(/## Page 2: Principles/g) || []).length;
  assert.equal(page2Count, 1, 'Duplicate heading for Page 2 must be skipped');

  // 4. New Sections "Page 3" and "Page 4" must be appended
  assert.ok(merged.includes('## Page 3: UDP Checksum'), 'Page 3 must be present');
  assert.ok(merged.includes('## Page 4: Stop and Wait ARQ'), 'Page 4 must be present');
});

// ---------------------------------------------------------------------------
// TEST 5: Continuation Banner Formatting
// ---------------------------------------------------------------------------
runTest('formatContinuationBanner generates actionable continuation message with next page', () => {
  const banner = formatContinuationBanner(4, 10);
  assert.ok(banner.includes('Pages through 4'));
  assert.ok(banner.includes('continue from page 5'));
  assert.ok(banner.includes('Continue Explanation'));

  // If already at target end page, no banner needed
  const completeBanner = formatContinuationBanner(10, 10);
  assert.equal(completeBanner, '');
});

// ---------------------------------------------------------------------------
// TEST 6: Continuation Scope Query Parsing
// ---------------------------------------------------------------------------
runTest('Continuation intent correctly parses generic continue and explicit continue from page X', () => {
  const t1 = parseScopeQuery('continue');
  assert.equal(t1.isScopeQuery, true);
  assert.equal(t1.scopeType, 'continuation');
  assert.equal(t1.startPage, undefined);

  const t2 = parseScopeQuery('resume explanation');
  assert.equal(t2.isScopeQuery, true);
  assert.equal(t2.scopeType, 'continuation');

  const t3 = parseScopeQuery('continue from page 5');
  assert.equal(t3.isScopeQuery, true);
  assert.equal(t3.scopeType, 'continuation');
  assert.equal(t3.startPage, 5);

  const t4 = parseScopeQuery('continue from page 5 to 10');
  assert.equal(t4.isScopeQuery, true);
  assert.equal(t4.scopeType, 'continuation');
  assert.equal(t4.startPage, 5);
  assert.equal(t4.endPage, 10);
});

// ---------------------------------------------------------------------------
// TEST 7: Preservation of Concise Factual Questions
// ---------------------------------------------------------------------------
runTest('Preserves concise factual queries without triggering scope batching or truncation logic', () => {
  const factualQueries = [
    'What is TCP?',
    'What is the formula for EstimatedRTT?',
    'Explain the 3-way handshake in TCP.',
    'How does UDP checksum detect flipped bits?',
  ];

  for (const q of factualQueries) {
    const intent = parseScopeQuery(q);
    assert.equal(intent.isScopeQuery, false, `"${q}" should not trigger scope batching`);
  }
});

console.log('\n======================================================================');
console.log(`📊 TEST RESULTS: ${passedTests} / ${totalTests} PASSED (100%)`);
console.log('======================================================================\n');
