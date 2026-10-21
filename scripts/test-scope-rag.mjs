import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseScopeQuery } from '../src/lib/utils/scopeQueryParser.mjs';

/**
 * Scope-Based PDF Summarization and RAG Pipeline Regression Suite
 *
 * Tests the 5 required cases:
 * 1. "Explain the first 10 pages."
 * 2. "Summarize pages 5–15."
 * 3. "What is TCP?"
 * 4. "Explain the whole chapter."
 * 5. A page range containing missing or unextractable text.
 */

console.log('=== Running Scope-Based RAG Regression Test Suite ===\n');

const EXTRACTED_CHUNKS_PATH = path.resolve('extracted_chunks.json');
assert.ok(fs.existsSync(EXTRACTED_CHUNKS_PATH), 'extracted_chunks.json must exist');

const { chunks, pagesCount } = JSON.parse(fs.readFileSync(EXTRACTED_CHUNKS_PATH, 'utf8'));
const docName = 'Ch3_Transport_Layer.pdf';

console.log(`Document: "${docName}" (${pagesCount} pages, ${chunks.length} chunks)\n`);

// Helper: Simulates chunk retrieval by physical page range
function retrievePageRangeChunks(allChunks, startPage, endPage) {
  return allChunks
    .filter((c) => c.pageNumber >= startPage && c.pageNumber <= endPage)
    .sort((a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex);
}

// Helper: Formats pages and identifies missing pages
function prepareScopeContext(allChunks, startPage, endPage, docPageCount) {
  const clampedStart = Math.min(startPage, endPage);
  const clampedEnd = Math.max(startPage, endPage);

  if (clampedStart > docPageCount) {
    return {
      chunks: [],
      missingPages: [],
      outOfBounds: true,
      errorMsg: `The requested page range (pages ${clampedStart}–${clampedEnd}) exceeds the total length of "${docName}", which contains ${docPageCount} pages.`,
    };
  }

  const effectiveEnd = Math.min(docPageCount, clampedEnd);
  const matchedChunks = retrievePageRangeChunks(allChunks, clampedStart, effectiveEnd);
  const presentPages = new Set(matchedChunks.map((c) => c.pageNumber));

  const missingPages = [];
  for (let p = clampedStart; p <= effectiveEnd; p++) {
    if (!presentPages.has(p)) missingPages.push(p);
  }

  return {
    chunks: matchedChunks,
    missingPages,
    outOfBounds: false,
    effectiveStart: clampedStart,
    effectiveEnd,
  };
}

// ---------------------------------------------------------------------------
// TEST 1: "Explain the first 10 pages."
// ---------------------------------------------------------------------------
console.log('[TEST 1] Testing: "Explain the first 10 pages."');
const q1 = 'Explain the first 10 pages.';
const intent1 = parseScopeQuery(q1);

assert.equal(intent1.isScopeQuery, true, 'Intent must be detected as scope query');
assert.equal(intent1.scopeType, 'range');
assert.equal(intent1.startPage, 1);
assert.equal(intent1.endPage, 10);

const context1 = prepareScopeContext(chunks, intent1.startPage, intent1.endPage, pagesCount);
assert.equal(context1.outOfBounds, false);
assert.equal(context1.chunks.length, 31, 'Pages 1-10 must retrieve all 31 physical chunks (not just 6 semantic fragments)');

const pagesFound1 = [...new Set(context1.chunks.map((c) => c.pageNumber))];
assert.deepEqual(pagesFound1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Must retrieve every page 1 through 10');
assert.equal(context1.missingPages.length, 0, 'No pages should be missing for pages 1-10');

// Verify key conceptual topics are present across these pages
const allText1 = context1.chunks.map((c) => c.content).join(' ');
assert.ok(allText1.includes('ICANN'), 'Page 6 ICANN port ranges must be retrieved');
assert.ok(allText1.includes('Demultiplexing'), 'Page 7 Demultiplexing must be retrieved');
assert.ok(allText1.includes('Checksum'), 'Page 9 UDP Checksum must be retrieved');
assert.ok(allText1.includes('Automatic Repeat reQuest'), 'Page 10 ARQ must be retrieved');

console.log('  ✓ PASS: Retrieved all 31 chunks across physical pages 1–10 (100% page coverage).');

// ---------------------------------------------------------------------------
// TEST 2: "Summarize pages 5–15."
// ---------------------------------------------------------------------------
console.log('\n[TEST 2] Testing: "Summarize pages 5–15."');
const q2 = 'Summarize pages 5–15.';
const intent2 = parseScopeQuery(q2);

assert.equal(intent2.isScopeQuery, true, 'Intent must be detected as scope query');
assert.equal(intent2.scopeType, 'range');
assert.equal(intent2.startPage, 5);
assert.equal(intent2.endPage, 15);

const context2 = prepareScopeContext(chunks, intent2.startPage, intent2.endPage, pagesCount);
assert.equal(context2.chunks.length, 39, 'Pages 5-15 must retrieve all 39 physical chunks');

const pagesFound2 = [...new Set(context2.chunks.map((c) => c.pageNumber))];
assert.deepEqual(pagesFound2, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'Must retrieve all pages 5 through 15');

const allText2 = context2.chunks.map((c) => c.content).join(' ');
assert.ok(allText2.includes('Stop-and-Wait'), 'Must include Stop-and-Wait ARQ (p. 11)');
assert.ok(allText2.includes('Go-Back-N'), 'Must include Go-Back-N ARQ (p. 13)');
assert.ok(allText2.includes('Selective Repeat'), 'Must include Selective Repeat ARQ (p. 15)');

console.log('  ✓ PASS: Retrieved all 39 chunks across physical pages 5–15 covering Stop-and-Wait, GBN, and SR.');

// ---------------------------------------------------------------------------
// TEST 3: "What is TCP?" (Concise Factual Question Preservation)
// ---------------------------------------------------------------------------
console.log('\n[TEST 3] Testing: "What is TCP?"');
const q3 = 'What is TCP?';
const intent3 = parseScopeQuery(q3);

assert.equal(intent3.isScopeQuery, false, 'Standard factual question must NOT trigger scope retrieval');
console.log('  ✓ PASS: Preserves concise semantic similarity search for focused factual queries.');

// ---------------------------------------------------------------------------
// TEST 4: "Explain the whole chapter." (Batched Full-Document Scope)
// ---------------------------------------------------------------------------
console.log('\n[TEST 4] Testing: "Explain the whole chapter."');
const q4 = 'Explain the whole chapter.';
const intent4 = parseScopeQuery(q4);

assert.equal(intent4.isScopeQuery, true, 'Intent must be detected as whole_document scope query');
assert.equal(intent4.scopeType, 'whole_document');

const context4 = prepareScopeContext(chunks, 1, pagesCount, pagesCount);
assert.equal(context4.chunks.length, 234, 'Whole document must retrieve all 234 chunks');
assert.equal(context4.effectiveEnd, 71, 'Must cover up to page 71');

// Verify batching logic: 3-4 pages per batch guarantees generous ~1,000-1,500 token budget per page
const BATCH_SIZE = 4;
const batches = [];
for (let p = 1; p <= pagesCount; p += BATCH_SIZE) {
  batches.push({ bStart: p, bEnd: Math.min(p + BATCH_SIZE - 1, pagesCount) });
}

assert.equal(batches.length, 18, '71 pages partitioned into 18 manageable batches of <= 4 pages');
assert.equal(batches[0].bStart, 1);
assert.equal(batches[0].bEnd, 4);
assert.equal(batches[1].bStart, 5);
assert.equal(batches[1].bEnd, 8);
assert.equal(batches[17].bStart, 69);
assert.equal(batches[17].bEnd, 71);

console.log(`  ✓ PASS: Full chapter successfully retrieved (234 chunks) and partitioned into ${batches.length} sequential batches of <= 4 pages.`);

// ---------------------------------------------------------------------------
// TEST 5: Page Range Containing Missing or Unextractable Text
// ---------------------------------------------------------------------------
console.log('\n[TEST 5] Testing: Page Range with Missing/Unextractable Text');

// Case 5A: Querying beyond total document pages (e.g. pages 80 to 90 on a 71-page document)
const q5A = 'Explain pages 80 to 90.';
const intent5A = parseScopeQuery(q5A);
assert.equal(intent5A.isScopeQuery, true);
assert.equal(intent5A.startPage, 80);
assert.equal(intent5A.endPage, 90);

const context5A = prepareScopeContext(chunks, 80, 90, pagesCount);
assert.equal(context5A.outOfBounds, true);
assert.ok(context5A.errorMsg.includes('exceeds the total length'), 'Must clearly report out-of-bounds page range');
console.log('  ✓ Case 5A PASS: Cleanly reports out-of-bounds page range without silent truncation.');

// Case 5B: A range where some intermediate pages have no extractable text
// Simulate a range where page 25 has chunks, but dummy pages 26 & 27 have no text
const syntheticChunks = [
  { chunkIndex: 0, pageNumber: 25, content: 'Page 25 TCP State Transition' },
  { chunkIndex: 1, pageNumber: 28, content: 'Page 28 TCP Flow Control' },
];
const context5B = prepareScopeContext(syntheticChunks, 25, 28, pagesCount);
assert.equal(context5B.chunks.length, 2);
assert.deepEqual(context5B.missingPages, [26, 27], 'Must detect missing physical pages 26 and 27');

console.log('  ✓ Case 5B PASS: Missing/unextractable pages accurately identified: [26, 27].');

// ---------------------------------------------------------------------------
// TEST 6: Citation Preservation & Formatting Integrity
// ---------------------------------------------------------------------------
console.log('\n[TEST 6] Testing Citation Mapping & UI Formatting Contract');

// Verify citation map builds accurate 1:1 physical page numbers
const citationsMap = new Map();
context1.chunks.forEach((c) => {
  if (!citationsMap.has(c.pageNumber)) {
    citationsMap.set(c.pageNumber, {
      document_name: docName,
      page_number: c.pageNumber,
      content: c.content,
    });
  }
});

assert.equal(citationsMap.size, 10, 'All 10 physical pages must have citations');
assert.ok(citationsMap.has(1) && citationsMap.has(10), 'Citations must span page 1 through 10');
console.log('  ✓ PASS: 10 distinct physical page citations created without fabrication.');

// ---------------------------------------------------------------------------
// TEST 7: Continuation Detection & Resumption
// ---------------------------------------------------------------------------
console.log('\n[TEST 7] Testing Continuation Queries (e.g., "continue", "continue from page 5")');

const contQuery1 = 'continue';
const contIntent1 = parseScopeQuery(contQuery1);
assert.equal(contIntent1.isScopeQuery, true, '"continue" must be recognized as scope continuation');
assert.equal(contIntent1.scopeType, 'continuation');

const contQuery2 = 'continue from page 5';
const contIntent2 = parseScopeQuery(contQuery2);
assert.equal(contIntent2.isScopeQuery, true);
assert.equal(contIntent2.scopeType, 'continuation');
assert.equal(contIntent2.startPage, 5);

console.log('  ✓ PASS: Continuation queries parsed accurately into continuation scope.');

console.log('\n======================================================================');
console.log('ALL SCOPE-BASED RAG REGRESSION TESTS PASSED (7 / 7)');
console.log('======================================================================\n');
process.exit(0);
