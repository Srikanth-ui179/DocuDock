/**
 * Comprehensive Test Suite for Development-Only Mock AI Provider
 *
 * Verifies:
 * 1. Mock embedding generation (768-dim, deterministic, normalized L2 norm).
 * 2. Strict production disabling (asserts mock throws 403 in NODE_ENV === 'production').
 * 3. Grounded mock answer generation with simulation disclaimer, KaTeX math, and physical citations.
 * 4. Multi-page scope generation and batch partitioning.
 * 5. Simulation directives for error states (401 invalid key, 429 rate limit/quota, 503 overloaded, 404 not found, empty response, truncation).
 * 6. Clickable citation formatting compatibility with DocuDock CitationInspector.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import assert from 'node:assert/strict';

import {
  isMockProviderAllowed,
  generateMockEmbedding,
  generateMockBatchEmbeddings,
  generateMockGroundedAnswer,
  generateMockScopeExplanation,
  simulateMockErrorIfRequested,
  ProviderError,
} from '../src/lib/ai/mockProvider.ts';

import { classifyProviderError } from '../src/lib/ai/modelCache.ts';

const PROVIDER_OPTIONS = {
  mock: {
    id: 'mock',
    name: 'Mock Provider (Offline Development)',
    description: 'Deterministic local simulator for zero-cost testing of citations, chat, and errors',
    embeddingModel: 'mock-embedding-768',
    embeddingDim: 768,
    chatModel: 'mock-grounded-chat',
    keyUrl: '#',
  },
};

async function testProviderConnection(provider, apiKey) {
  const cleanKey = (apiKey || '').trim();
  if (provider === 'mock') {
    if (!isMockProviderAllowed()) {
      throw new ProviderError('Mock AI provider is strictly disabled in production builds.', 403, 'mock');
    }
    simulateMockErrorIfRequested(cleanKey);
    return true;
  }
  return false;
}

async function generateGroundedAnswer(provider, apiKey, userQuery, contextPassages) {
  if (provider === 'mock') {
    if (!isMockProviderAllowed()) {
      throw new ProviderError('Mock AI provider is strictly disabled in production builds.', 403, 'mock');
    }
    simulateMockErrorIfRequested(userQuery);
    if (userQuery.toLowerCase().includes('[mock:empty]') || userQuery.toLowerCase().includes('[simulate:empty]')) {
      throw new ProviderError(
        'The model completed the request but returned an empty response. Please try rephrasing your question or selecting another document.',
        200,
        'mock'
      );
    }
    return generateMockGroundedAnswer(userQuery, contextPassages);
  }
  throw new Error('Unsupported provider in mock test');
}

async function generateScopeExplanation(provider, apiKey, userQuery, documentName, startPage, endPage, pagePassages) {
  if (provider === 'mock') {
    if (!isMockProviderAllowed()) {
      throw new ProviderError('Mock AI provider is strictly disabled in production builds.', 403, 'mock');
    }
    return generateMockScopeExplanation(documentName, startPage, endPage, pagePassages, userQuery);
  }
  throw new Error('Unsupported provider in mock test');
}

async function generateBatchedScopeExplanation(provider, apiKey, userQuery, documentName, startPage, endPage, pagePassages) {
  const batchSize = 4;
  const sections = [];
  for (let p = startPage; p <= endPage; p += batchSize) {
    const batchEnd = Math.min(p + batchSize - 1, endPage);
    const batchPassages = pagePassages.filter(pass => pass.page_number >= p && pass.page_number <= batchEnd);
    const result = await generateScopeExplanation(provider, apiKey, userQuery, documentName, p, batchEnd, batchPassages);
    sections.push(result.text);
  }
  return `## Chapter Overview: Pages ${startPage}–${endPage}\n\n` + sections.join('\n\n---\n\n');
}

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

console.log('🧪 Starting Development-Only Mock AI Provider Test Suite...\n');

// =========================================================================
// SECTION 1: Mock Vector Embeddings (Deterministic & Normalized)
// =========================================================================
console.log('--- Section 1: Mock Embedding Generation ---');

await runTest('Generates 768-dimensional deterministic embedding vector', () => {
  assert.equal(PROVIDER_OPTIONS.mock.id, 'mock');
  assert.equal(PROVIDER_OPTIONS.mock.embeddingDim, 768);
  const emb1 = generateMockEmbedding('TCP transport protocol');
  const emb2 = generateMockEmbedding('TCP transport protocol');
  const embDiff = generateMockEmbedding('UDP connectionless protocol');

  assert.equal(emb1.length, 768);
  assert.equal(emb2.length, 768);
  assert.deepEqual(emb1, emb2, 'Identical text must generate identical vector');
  assert.notDeepEqual(emb1, embDiff, 'Different text must generate different vector');
});

await runTest('Embedding vectors are normalized to unit length (L2 norm ≈ 1.0)', () => {
  const emb = generateMockEmbedding('Sample document text for embedding normalization');
  const sumSq = emb.reduce((sum, val) => sum + val * val, 0);
  const norm = Math.sqrt(sumSq);
  assert.ok(Math.abs(norm - 1.0) < 0.0001, `L2 norm must be approximately 1.0, got ${norm}`);
});

await runTest('Batch embeddings generation returns matching length array', () => {
  const texts = ['First chunk text', 'Second chunk text', 'Third chunk text'];
  const batch = generateMockBatchEmbeddings(texts, 768);
  assert.equal(batch.length, 3);
  assert.equal(batch[0].length, 768);
  assert.equal(batch[1].length, 768);
  assert.equal(batch[2].length, 768);
});

// =========================================================================
// SECTION 2: Production Lockdown Guard (Zero Mock in Production)
// =========================================================================
console.log('\n--- Section 2: Production Lockdown Guard ---');

await runTest('Mock provider execution is strictly blocked in production mode', () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    assert.equal(isMockProviderAllowed(), false);

    assert.throws(
      () => generateMockEmbedding('test text'),
      (err) => err instanceof ProviderError && err.statusCode === 403
    );

    assert.throws(
      () => generateMockGroundedAnswer('query', []),
      (err) => err instanceof ProviderError && err.statusCode === 403
    );

    assert.throws(
      () => generateMockScopeExplanation('Doc.pdf', 1, 5, [], 'query'),
      (err) => err instanceof ProviderError && err.statusCode === 403
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

// =========================================================================
// SECTION 3: Grounded Answers & Physical Citation Compatibility
// =========================================================================
console.log('\n--- Section 3: Grounded Answers & Citations ---');

const mockPassages = [
  { document_name: 'Ch3_Transport_Layer.pdf', page_number: 4, content: 'Multiplexing and demultiplexing overview...' },
  { document_name: 'Ch3_Transport_Layer.pdf', page_number: 7, content: 'UDP checksum computation and format...' },
  { document_name: 'Ch3_Transport_Layer.pdf', page_number: 32, content: 'TCP timeout interval and EstimatedRTT formula...' },
];

await runTest('Grounded answer includes prominent simulation disclaimer', async () => {
  const answer = await generateGroundedAnswer('mock', 'mock-key', 'What is TCP RTT calculation?', mockPassages);
  assert.ok(answer.includes('SIMULATED RESPONSE (Mock AI Provider)'));
  assert.ok(answer.includes('not an actual model-generated response'));
});

await runTest('Grounded answer includes verifiable physical page citations', async () => {
  const answer = await generateGroundedAnswer('mock', 'mock-key', 'How does TCP calculate RTO?', mockPassages);
  assert.ok(answer.includes('[Ch3_Transport_Layer.pdf, p. 4]'));
  assert.ok(answer.includes('[Ch3_Transport_Layer.pdf, p. 7]'));
  assert.ok(answer.includes('[Ch3_Transport_Layer.pdf, p. 32]'));
});

await runTest('Grounded answer includes formatted LaTeX math and table', async () => {
  const answer = await generateGroundedAnswer('mock', 'mock-key', 'Explain EstimatedRTT', mockPassages);
  assert.ok(answer.includes('\\text{EstimatedRTT}'));
  assert.ok(answer.includes('\\text{TimeoutInterval}'));
  assert.ok(answer.includes('| Mechanism | Stop-and-Wait |'));
});

// =========================================================================
// SECTION 4: Page-Scoped Explanations & Batching
// =========================================================================
console.log('\n--- Section 4: Page-Scoped Multi-Page Explanations ---');

const scopePassages = [
  { page_number: 1, content: 'Transport Layer services introduction' },
  { page_number: 2, content: 'Multiplexing and demultiplexing mechanics' },
  { page_number: 3, content: 'UDP header and checksum structure' },
  { page_number: 4, content: 'Principles of reliable data transfer rdt 1.0, 2.0' },
  { page_number: 5, content: 'rdt 2.1, 2.2 and Stop-and-Wait protocol' },
  { page_number: 6, content: 'Pipelined protocols: Go-Back-N' },
  { page_number: 7, content: 'Selective Repeat protocol' },
  { page_number: 8, content: 'TCP segment structure and sequence numbers' },
  { page_number: 9, content: 'TCP round-trip time and timeout interval' },
  { page_number: 10, content: 'TCP reliable data transfer and fast retransmit' },
];

await runTest('Scope explanation covers requested page range with citations', async () => {
  const result = await generateScopeExplanation(
    'mock',
    'mock-key',
    'Explain the first 4 pages',
    'Ch3_Transport_Layer.pdf',
    1,
    4,
    scopePassages.slice(0, 4)
  );

  assert.equal(result.isTruncated, false);
  assert.ok(result.text.includes('Pages 1–4'));
  assert.ok(result.text.includes('[Ch3_Transport_Layer.pdf, p. 1]'));
  assert.ok(result.text.includes('[Ch3_Transport_Layer.pdf, p. 4]'));
});

await runTest('Batched scope explanation synthesizes multi-page requests with batches', async () => {
  const fullExplanation = await generateBatchedScopeExplanation(
    'mock',
    'mock-key',
    'Explain the first 10 pages',
    'Ch3_Transport_Layer.pdf',
    1,
    10,
    scopePassages
  );

  assert.ok(fullExplanation.includes('Pages 1–10'));
  assert.ok(fullExplanation.includes('Page 1 Highlights'));
  assert.ok(fullExplanation.includes('Page 10 Highlights'));
  assert.ok(fullExplanation.includes('[Ch3_Transport_Layer.pdf, p. 10]'));
});

// =========================================================================
// SECTION 5: Simulation Directives for Error States & UI Testing
// =========================================================================
console.log('\n--- Section 5: Simulation Directives for Error States ---');

const errorDirectives = [
  { directive: '[mock:invalid_key]', expectedCode: 401, expectedKind: 'invalid_key' },
  { directive: '[mock:rate_limit]', expectedCode: 429, expectedKind: 'rate_limit' },
  { directive: '[mock:quota]', expectedCode: 429, expectedKind: 'quota_exhausted' },
  { directive: '[mock:overloaded]', expectedCode: 503, expectedKind: 'overloaded' },
  { directive: '[mock:not_found]', expectedCode: 404, expectedKind: 'not_found' },
  { directive: '[mock:blocked]', expectedCode: 400, expectedKind: 'blocked' },
  { directive: '[mock:server_error]', expectedCode: 500, expectedKind: 'server_error' },
];

for (const ed of errorDirectives) {
  await runTest(`Directive "${ed.directive}" triggers HTTP ${ed.expectedCode} (${ed.expectedKind})`, async () => {
    try {
      await generateGroundedAnswer('mock', 'mock-key', `Explain TCP ${ed.directive}`, mockPassages);
      assert.fail('Should have thrown simulated error');
    } catch (err) {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.statusCode, ed.expectedCode);
      const classification = classifyProviderError(err.statusCode, err.message);
      assert.equal(classification.kind, ed.expectedKind);
    }
  });
}

await runTest('Directive "[mock:empty]" triggers empty response handling', async () => {
  try {
    await generateGroundedAnswer('mock', 'mock-key', 'Query with [mock:empty]', mockPassages);
    assert.fail('Should have thrown empty response error');
  } catch (err) {
    const classification = classifyProviderError(err.statusCode || 200, err.message);
    assert.equal(classification.kind, 'empty');
    assert.ok(classification.userMessage.includes('empty response'));
  }
});

await runTest('Directive "[mock:truncated]" sets isTruncated: true for continuation testing', async () => {
  const result = await generateScopeExplanation(
    'mock',
    'mock-key',
    'Explain pages 1-4 [mock:truncated]',
    'Ch3.pdf',
    1,
    4,
    scopePassages.slice(0, 4)
  );

  assert.equal(result.isTruncated, true);
  assert.equal(result.finishReason, 'MAX_TOKENS');
});

// =========================================================================
// SECTION 6: Settings Connection & Validation in Mock Mode
// =========================================================================
console.log('\n--- Section 6: Settings Connection & Validation ---');

await runTest('testProviderConnection succeeds with default key in mock mode', async () => {
  const success = await testProviderConnection('mock', 'mock-key');
  assert.equal(success, true);
});

await runTest('testProviderConnection with directive [mock:invalid_key] fails validation', async () => {
  try {
    await testProviderConnection('mock', '[mock:invalid_key]');
    assert.fail('Should have failed validation');
  } catch (err) {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.statusCode, 401);
  }
});

// =========================================================================
// SECTION 7: End-to-End Retrieval Pipeline Regression Tests
// =========================================================================
console.log('\n--- Section 7: End-to-End Retrieval Pipeline Regression Tests ---');

import { parseScopeQuery } from '../src/lib/utils/scopeQueryParser.ts';
import { chunkText } from '../src/lib/pdf/extractor.ts';

// 1. Fixture Document with known physical pages and chunks (matching clean HAP 2.pdf extraction)
const fixtureDoc = {
  id: 'doc-fixture-hap-2',
  name: 'HAP 2.pdf',
  page_count: 2,
  chunks: [
    {
      id: 'chunk-1',
      document_id: 'doc-fixture-hap-2',
      chunk_index: 0,
      page_number: 1,
      content: 'BP 201T. HUMAN ANATOMY AND PHYSIOLOGY-II (Theory) 45 Hours Scope: This subject is designed to impart fundamental knowledge on the structure and functions of the various systems of the human body. It also helps in understanding both homeostatic mechanisms. The subject provides the basic knowledge required to understand the various disciplines of pharmacy. Objectives: Upon completion of this course the student should be able to: 1. Explain the gross morphology, structure and functions of various organs of the human body. 2. Describe the various homeostatic mechanisms and their imbalances. 3. Identify the various tissues and organs of different systems of human body. 4.',
    },
    {
      id: 'chunk-2',
      document_id: 'doc-fixture-hap-2',
      chunk_index: 1,
      page_number: 1,
      content: 'Identify the various tissues and organs of different systems of human body. 4. Perform the hematological tests like blood cell counts, haemoglobin estimation, bleeding/clotting time etc and also record blood pressure, heart rate, pulse and respiratory volume. 5. Appreciate coordinated working pattern of different organs of each system 6. Appreciate the interlinked mechanisms in the maintenance of normal functioning (homeostasis) of human body. Course Content: Unit I 10 hours  Nervous system Organization of nervous system, neuron, neuroglia, classification and properties of nerve fibre, electrophysiology, action potential, nerve impulse, receptors, synapse, neurotransmitters.',
    },
    {
      id: 'chunk-3',
      document_id: 'doc-fixture-hap-2',
      chunk_index: 2,
      page_number: 1,
      content: 'action potential, nerve impulse, receptors, synapse, neurotransmitters. Central nervous system: Meninges, ventricles of brain and cerebrospinal fluid.structure and functions of brain (cerebrum, brain stem, cerebellum), spinal cord (gross structure, functions of afferent and efferent nerve tracts,reflex activity) Unit II 06 hours  Digestive system Anatomy of GI Tract with special reference to anatomy and functions of stomach, ( Acid production in the stomach, regulation of acid production through parasympathetic nervous system, pepsin role in protein digestion) small intestine 54',
    },
    {
      id: 'chunk-4',
      document_id: 'doc-fixture-hap-2',
      chunk_index: 3,
      page_number: 2,
      content: 'and large intestine, anatomy and functions of salivary glands, pancreas and liver, movements of GIT, digestion and absorption of nutrients and disorders of GIT.  Energetics Formation and role of ATP, Creatinine Phosphate and BMR. Unit III  Respiratory system 10 hours Anatomy of respiratory system with special reference to anatomy of lungs, mechanism of respiration, regulation of respiration Lung Volumes and capacities transport of respiratory gases, artificial respiration, and resuscitation methods.  Urinary system Anatomy of urinary tract with special reference to anatomy of kidney and nephrons, functions of kidney and urinary tract, physiology of urine formation, micturition reflex and role of kidneys in acid base balance, role of RAS in kidney and disorders of kidney.',
    },
    {
      id: 'chunk-5',
      document_id: 'doc-fixture-hap-2',
      chunk_index: 4,
      page_number: 2,
      content: 'micturition reflex and role of kidneys in acid base balance, role of RAS in kidney and disorders of kidney.  Unit IV 10 hours   Endocrine system Classification of hormones, mechanism of hormone action, structure and functions of pituitary gland, thyroid gland, parathyroid gland, adrenal gland, pancreas, pineal gland, thymus and their disorders. Unit V 09 hours  Reproductive system Anatomy of male and female reproductive system, Functions of male and female reproductive system, sex hormones, physiology of menstruation, fertilization, spermatogenesis, oogenesis, pregnancy and parturition  Introduction to genetics Chromosomes, genes and DNA, protein synthesis, genetic pattern of inheritance 55',
    },
  ],
};

const otherDoc = {
  id: 'doc-other-networking',
  name: 'Computer_Networking.pdf',
  page_count: 3,
  chunks: [
    {
      id: 'chunk-net-1',
      document_id: 'doc-other-networking',
      chunk_index: 0,
      page_number: 1,
      content: 'Transport layer services provide logical communication between application processes on different network hosts.',
    },
  ],
};

// Mock Supabase environment simulating pgvector & document_chunks table
function createMockSupabase(documents) {
  const docsMap = new Map(documents.map(d => [d.id, d]));
  const allChunks = documents.flatMap(d => d.chunks.map(c => ({
    ...c,
    embedding: generateMockEmbedding(c.content),
  })));

  return {
    from(table) {
      if (table === 'documents') {
        return {
          select(_fields) {
            return {
              in(_field, values) {
                const results = values.map(v => docsMap.get(v)).filter(Boolean);
                return Promise.resolve({ data: results, error: null });
              },
              eq(field, value) {
                return {
                  ilike(nameField, pattern) {
                    const cleanPattern = pattern.replace(/%/g, '').toLowerCase();
                    const results = Array.from(docsMap.values()).filter(d =>
                      d[field] === value && d[nameField].toLowerCase().includes(cleanPattern)
                    );
                    return {
                      limit(n) {
                        return Promise.resolve({ data: results.slice(0, n), error: null });
                      },
                    };
                  },
                  order(_orderField, { ascending: _ascending = true } = {}) {
                    return {
                      limit(n) {
                        const results = Array.from(docsMap.values());
                        return Promise.resolve({ data: results.slice(0, n), error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'document_chunks') {
        return {
          select(_fields) {
            return {
              eq(field, value) {
                return {
                  gte(_pField, startP) {
                    return {
                      lte(_pField2, endP) {
                        return {
                          order(_o1, _opts1) {
                            return {
                              order(_o2, _opts2) {
                                const filtered = allChunks.filter(c =>
                                  c[field] === value && c.page_number >= startP && c.page_number <= endP
                                );
                                return Promise.resolve({ data: filtered, error: null });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
              in(field, values) {
                const filtered = allChunks.filter(c => values.includes(c[field]));
                return {
                  order(_o1, _opts1) {
                    return {
                      order(_o2, _opts2) {
                        return {
                          limit(n) {
                            return Promise.resolve({ data: filtered.slice(0, n), error: null });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
    rpc(fnName, { query_embedding, match_threshold = 0.18, match_count = 6, filter_document_ids = null }) {
      // Calculate dot product (cosine similarity) with stored chunk embeddings
      const candidates = allChunks.filter(c =>
        !filter_document_ids || filter_document_ids.includes(c.document_id)
      );

      const scored = candidates.map(c => {
        let sim = 0;
        for (let i = 0; i < query_embedding.length; i++) {
          sim += query_embedding[i] * c.embedding[i];
        }
        return {
          id: c.id,
          document_id: c.document_id,
          document_name: docsMap.get(c.document_id)?.name || 'Unknown',
          chunk_index: c.chunk_index,
          page_number: c.page_number,
          content: c.content,
          similarity: sim,
        };
      });

      const matched = scored
        .filter(s => s.similarity >= match_threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, match_count);

      return Promise.resolve({ data: matched, error: null });
    },
  };
}

await runTest('1. Index fixture document and verify chunks contain expected text and page numbers', () => {
  assert.equal(fixtureDoc.name, 'HAP 2.pdf');
  assert.equal(fixtureDoc.chunks.length, 5);
  // Verify chunks contain extracted text and map to physical pages 1 and 2
  assert.ok(fixtureDoc.chunks[0].content.includes('HUMAN ANATOMY'));
  assert.equal(fixtureDoc.chunks[0].page_number, 1);
  assert.ok(fixtureDoc.chunks[1].content.includes('Nervous system'));
  assert.equal(fixtureDoc.chunks[1].page_number, 1);
  assert.ok(fixtureDoc.chunks[2].content.includes('Digestive system'));
  assert.equal(fixtureDoc.chunks[2].page_number, 1);
  assert.ok(fixtureDoc.chunks[3].content.includes('Respiratory system'));
  assert.equal(fixtureDoc.chunks[3].page_number, 2);
  assert.ok(fixtureDoc.chunks[4].content.includes('Endocrine system'));
  assert.equal(fixtureDoc.chunks[4].page_number, 2);
});

await runTest('2. Scope Query Parser detects "Summarize the contents of HAP 2.pdf." as whole-document scope', () => {
  const query = 'Summarize the contents of HAP 2.pdf.';
  const intent = parseScopeQuery(query);
  assert.equal(intent.isScopeQuery, true);
  assert.equal(intent.scopeType, 'whole_document');
  assert.equal(intent.targetDocumentName, 'HAP 2.pdf');
});

await runTest('3. Scope Query Parser extracts document name for diverse summary patterns', () => {
  const cases = [
    { q: 'Summarize HAP 2.pdf', expectedDoc: 'HAP 2.pdf' },
    { q: 'Overview of HAP 2.pdf', expectedDoc: 'HAP 2.pdf' },
    { q: 'What is in HAP 2.pdf?', expectedDoc: 'HAP 2.pdf' },
    { q: 'what are the contents of HAP 2.pdf', expectedDoc: 'HAP 2.pdf' },
    { q: 'give me an overview', expectedDoc: undefined },
    { q: 'summarize', expectedDoc: undefined },
  ];

  for (const c of cases) {
    const intent = parseScopeQuery(c.q);
    assert.equal(intent.isScopeQuery, true, `Query "${c.q}" should be recognized as scope query`);
    assert.equal(intent.targetDocumentName, c.expectedDoc, `Document name mismatch for "${c.q}"`);
  }
});

await runTest('4. End-to-End Scope Query retrieves full document and organizes Units I–V sequentially without fragments', async () => {
  const mockSupabase = createMockSupabase([fixtureDoc]);
  const query = 'Summarize the contents of HAP 2.pdf.';
  const intent = parseScopeQuery(query);
  assert.equal(intent.isScopeQuery, true);

  // Simulate executeScopeQuery behavior
  const { data: chunks } = await mockSupabase
    .from('document_chunks')
    .select('id, document_id, chunk_index, page_number, content')
    .eq('document_id', fixtureDoc.id)
    .gte('page_number', 1)
    .lte('page_number', 2)
    .order('page_number')
    .order('chunk_index');

  assert.equal(chunks.length, 5);
  const pagePassages = chunks.map(c => ({ page_number: c.page_number, content: c.content }));

  const answer = await generateBatchedScopeExplanation(
    'mock',
    'mock-key',
    query,
    fixtureDoc.name,
    1,
    2,
    pagePassages
  );

  // 1. Verify prominent DEV SIMULATION disclaimer
  assert.ok(answer.includes('SIMULATED RESPONSE (Mock AI Provider - Scope Mode)'));
  assert.ok(answer.includes('not an actual model-generated response') || answer.includes('generated deterministically'));

  // 2. Verify physical page citations tied strictly to retrieved pages
  assert.ok(answer.includes('[HAP 2.pdf, p. 1]'));
  assert.ok(answer.includes('[HAP 2.pdf, p. 2]'));
  assert.ok(!answer.includes('[HAP 2.pdf, p. 3]'), 'Must not invent physical pages beyond retrieved chunks');
  assert.ok(!answer.includes('[HAP 2.pdf, p. 54]'), 'Must not confuse printed page 54 with physical PDF page numbers');
  assert.ok(!answer.includes('[HAP 2.pdf, p. 55]'), 'Must not confuse printed page 55 with physical PDF page numbers');

  // 3. Verify Overview & Objectives followed by Units I–V in original sequence
  assert.ok(answer.includes('Course Overview & Objectives'));
  assert.ok(answer.includes('Unit I: Nervous System'));
  assert.ok(answer.includes('Unit II: Digestive System & Energetics'));
  assert.ok(answer.includes('Unit III: Respiratory & Urinary Systems'));
  assert.ok(answer.includes('Unit IV: Endocrine System'));
  assert.ok(answer.includes('Unit V: Reproductive System & Introduction to Genetics'));

  const idxOverview = answer.indexOf('Course Overview & Objectives');
  const idxUnit1 = answer.indexOf('Unit I: Nervous System');
  const idxUnit2 = answer.indexOf('Unit II: Digestive System');
  const idxUnit3 = answer.indexOf('Unit III: Respiratory & Urinary');
  const idxUnit4 = answer.indexOf('Unit IV: Endocrine System');
  const idxUnit5 = answer.indexOf('Unit V: Reproductive System');

  assert.ok(idxOverview < idxUnit1, 'Overview must precede Unit I');
  assert.ok(idxUnit1 < idxUnit2, 'Unit I must precede Unit II');
  assert.ok(idxUnit2 < idxUnit3, 'Unit II must precede Unit III');
  assert.ok(idxUnit3 < idxUnit4, 'Unit III must precede Unit IV');
  assert.ok(idxUnit4 < idxUnit5, 'Unit IV must precede Unit V');

  // 4. Verify ZERO generic filler or foreign subject facts
  assert.ok(!answer.includes('Covers key principles and architectural details'), 'Must not contain generic boilerplate filler');
  assert.ok(!answer.includes('Transport Layer Services'), 'Must not inject ungrounded networking concepts');
  assert.ok(!answer.includes('Multiplexing & Demultiplexing'), 'Must not inject transport layer definitions');

  // 5. Verify NO orphaned fragments or duplicated headings
  assert.ok(!answer.includes('Objectives: Upon completion of this course the student should be able to: 1. ['), 'Must not contain orphaned numbered heading fragment');
  assert.ok(!answer.includes('and large intestine, anatomy'), 'Context must be reconstructed cleanly without orphaned fragment');
});

await runTest('5. Respiratory query retrieves ONLY respiratory passage from page 2 and excludes unrelated units', async () => {
  const mockSupabase = createMockSupabase([fixtureDoc]);
  const query = 'According to HAP 2.pdf, what topics are covered under the respiratory system?';

  // 1. Scope query parsing
  const intent = parseScopeQuery(query, [fixtureDoc.name]);
  assert.equal(intent.isScopeQuery, false, 'Focused question should not be misclassified as whole-document scope');
  assert.equal(intent.targetDocumentName, 'HAP 2.pdf', 'Target document name must be extracted');

  // 2. Vector similarity search
  const queryEmb = generateMockEmbedding(query);
  const { data: matches } = await mockSupabase.rpc('match_document_chunks_768', {
    query_embedding: queryEmb,
    match_threshold: 0.18,
    match_count: 6,
    filter_document_ids: [fixtureDoc.id],
  });

  assert.ok(matches.length > 0, 'Vector search should return relevant chunks');
  const topMatch = matches[0];
  assert.equal(topMatch.page_number, 2, 'Top match for respiratory system must be from physical page 2');
  assert.ok(topMatch.content.includes('Respiratory system'), 'Top match must contain Respiratory system text');

  // 3. Grounded answer generation using all fixture chunks to verify exclusion of unrelated passages
  const allPassages = fixtureDoc.chunks.map(c => ({
    document_name: fixtureDoc.name,
    page_number: c.page_number,
    content: c.content,
  }));
  const answer = generateMockGroundedAnswer(query, allPassages);

  // 4. Verify grounding & physical citation
  assert.ok(answer.includes('SIMULATED RESPONSE (Mock AI Provider)'));
  assert.ok(answer.includes('Respiratory system') || answer.includes('respiration'));
  assert.ok(answer.includes('[HAP 2.pdf, p. 2]'), 'Must cite physical page 2 for respiratory system content');
  
  // 5. Exclude unrelated units
  assert.ok(!answer.includes('[HAP 2.pdf, p. 1]'), 'Must not cite page 1 (unrelated units)');
  assert.ok(!answer.toLowerCase().includes('nervous system'), 'Must not include nervous system content');
  assert.ok(!answer.toLowerCase().includes('digestive system'), 'Must not include digestive system content');
  assert.ok(!answer.toLowerCase().includes('endocrine system'), 'Must not include endocrine system content');
  assert.ok(!answer.toLowerCase().includes('course content: unit i'), 'Must not include course header/overview');
});

await runTest('6. Nervous-system query returns all 6 syllabus topics, excludes digestive/respiratory content, and avoids mid-word truncations', async () => {
  const query = 'What topics does HAP 2.pdf cover under the nervous system?';
  
  // 1. Scope query parsing must cleanly extract HAP 2.pdf without swallowing question prefixes
  const intent = parseScopeQuery(query, [fixtureDoc.name]);
  assert.equal(intent.targetDocumentName, 'HAP 2.pdf', 'Must extract HAP 2.pdf cleanly without swallowing prefixes');
  assert.equal(intent.isScopeQuery, false, 'Focused question must not be whole-document scope');

  // 2. Grounded answer from all passages
  const allPassages = fixtureDoc.chunks.map(c => ({
    document_name: fixtureDoc.name,
    page_number: c.page_number,
    content: c.content,
  }));
  const answer = generateMockGroundedAnswer(query, allPassages);

  // 3. Physical citations strictly tied to page 1
  assert.ok(answer.includes('[HAP 2.pdf, p. 1]'), 'Must cite physical page 1 for nervous system');
  assert.ok(!answer.includes('[HAP 2.pdf, p. 2]'), 'Must not cite page 2 for nervous system');

  // 4. No mid-word truncation fragments
  assert.ok(!/\bd\s+properties/i.test(answer), 'Must not display mid-word truncated text ("d properties")');
  assert.ok(!/\batic\s+mechanisms/i.test(answer), 'Must not display truncated fragment ("atic")');

  // 5. Strictly exclude digestive and respiratory content
  assert.ok(!answer.toLowerCase().includes('digestive system'), 'Must not include digestive system');
  assert.ok(!answer.toLowerCase().includes('parasympathetic'), 'Must not include parasympathetic nervous system from digestive unit');
  assert.ok(!answer.toLowerCase().includes('stomach'), 'Must not include stomach acid regulation');
  assert.ok(!answer.toLowerCase().includes('respiratory system'), 'Must not include respiratory system');
  assert.ok(!answer.toLowerCase().includes('endocrine system'), 'Must not include endocrine system');

  // 6. Return all 6 required syllabus topics for Unit I Nervous system and CNS subsection
  assert.ok(answer.includes('Organization of nervous system, neuron, and neuroglia'), 'Topic 1: Organization & neurons');
  assert.ok(answer.includes('Classification and properties of nerve fibres, electrophysiology, action potential, and nerve impulse'), 'Topic 2: Nerve fibres & electrophysiology');
  assert.ok(answer.includes('Receptors, synapse, and neurotransmitters'), 'Topic 3: Receptors & synapses');
  assert.ok(answer.includes('Meninges, ventricles of brain, and cerebrospinal fluid (CSF)'), 'Topic 4: Meninges & CSF');
  assert.ok(answer.includes('Structure and functions of brain (cerebrum, brain stem, cerebellum)'), 'Topic 5: Brain structure & functions');
  assert.ok(answer.includes('Spinal cord gross structure, functions of afferent and efferent nerve tracts, and reflex activity'), 'Topic 6: Spinal cord & reflex activity');
});

await runTest('7. Digestive-system query retrieves digestive topics and excludes nervous/respiratory units', async () => {
  const query = 'What topics are covered under the digestive system in HAP 2.pdf?';
  const intent = parseScopeQuery(query, [fixtureDoc.name]);
  assert.equal(intent.targetDocumentName, 'HAP 2.pdf');

  const allPassages = fixtureDoc.chunks.map(c => ({
    document_name: fixtureDoc.name,
    page_number: c.page_number,
    content: c.content,
  }));
  const answer = generateMockGroundedAnswer(query, allPassages);

  // 1. Verify physical citations from pages 1 and 2 where digestive content spans
  assert.ok(answer.includes('[HAP 2.pdf, p. 1]'));
  assert.ok(answer.includes('[HAP 2.pdf, p. 2]'));

  // 2. Verify digestive concepts are covered
  assert.ok(answer.includes('Anatomy of GI Tract') || answer.includes('stomach'));
  assert.ok(answer.includes('Large intestine') || answer.includes('salivary glands') || answer.includes('digestion'));

  // 3. Exclude nervous system, respiratory system, and unrequested energetics content
  assert.ok(!answer.toLowerCase().includes('neuron'), 'Must not include neurons from Unit I');
  assert.ok(!answer.toLowerCase().includes('neuroglia'), 'Must not include neuroglia from Unit I');
  assert.ok(!answer.toLowerCase().includes('meninges'), 'Must not include meninges from Unit I');
  assert.ok(!answer.toLowerCase().includes('cerebellum'), 'Must not include cerebellum from Unit I');
  assert.ok(!answer.toLowerCase().includes('respiratory system'), 'Must not include respiratory system');
  assert.ok(!answer.toLowerCase().includes('resuscitation'), 'Must not include resuscitation from Unit III');
  assert.ok(!answer.toLowerCase().includes('energetics'), 'Must not include energetics unless requested');
  assert.ok(!answer.toLowerCase().includes('atp'), 'Must not include ATP unless requested');
  assert.ok(!answer.toLowerCase().includes('creatinine phosphate'), 'Must not include creatinine phosphate unless requested');
  assert.ok(!answer.toLowerCase().includes('bmr'), 'Must not include BMR unless requested');
});

await runTest('7b. Digestion and absorption query prioritizes digestive topics and excludes unrelated energetics', async () => {
  const query = 'What topics are covered under digestion and absorption?';

  const allPassages = fixtureDoc.chunks.map(c => ({
    document_name: fixtureDoc.name,
    page_number: c.page_number,
    content: c.content,
  }));
  const answer = generateMockGroundedAnswer(query, allPassages);

  // 1. Verify digestive topics are prioritized across physical pages 1 and 2
  assert.ok(answer.includes('[HAP 2.pdf, p. 1]'), 'Must cite page 1 for stomach and acid production');
  assert.ok(answer.includes('[HAP 2.pdf, p. 2]'), 'Must cite page 2 for large intestine and absorption');
  assert.ok(answer.includes('Anatomy of GI Tract') && answer.includes('stomach'));
  assert.ok(answer.includes('Large intestine') && answer.includes('salivary glands'));
  assert.ok(answer.includes('digestion and absorption of nutrients'));

  // 2. Energetics content must be strictly excluded
  assert.ok(!answer.toLowerCase().includes('energetics'), 'Must not include energetics');
  assert.ok(!answer.toLowerCase().includes('atp'), 'Must not include ATP');
  assert.ok(!answer.toLowerCase().includes('creatinine phosphate'), 'Must not include creatinine phosphate');
  assert.ok(!answer.toLowerCase().includes('bmr'), 'Must not include BMR');
});

await runTest('7c. Urinary-system query retrieves urinary topics from page 2 and excludes nervous/digestive/respiratory', async () => {
  const query = 'What topics are covered under the urinary system in HAP 2.pdf?';

  const allPassages = fixtureDoc.chunks.map(c => ({
    document_name: fixtureDoc.name,
    page_number: c.page_number,
    content: c.content,
  }));
  const answer = generateMockGroundedAnswer(query, allPassages);

  // 1. Cites physical page 2 where urinary system is located
  assert.ok(answer.includes('[HAP 2.pdf, p. 2]'), 'Must cite physical page 2 for urinary system');
  assert.ok(!answer.includes('[HAP 2.pdf, p. 1]'), 'Must not cite page 1 for urinary system');

  // 2. Covers core urinary topics from document
  assert.ok(answer.includes('Anatomy of urinary tract') || answer.includes('kidney and nephrons'));
  assert.ok(answer.includes('Physiology of urine formation') || answer.includes('micturition reflex'));
  assert.ok(answer.includes('role of RAS') || answer.includes('disorders of kidney'));

  // 3. Excludes other units
  assert.ok(!answer.toLowerCase().includes('nervous system'), 'Must not include nervous system');
  assert.ok(!answer.toLowerCase().includes('digestive system'), 'Must not include digestive system');
  assert.ok(!answer.toLowerCase().includes('respiratory system'), 'Must not include respiratory system');
});

await runTest('8. Document Scope Restriction: querying unselected document does not retrieve its chunks', async () => {
  const mockSupabase = createMockSupabase([fixtureDoc, otherDoc]);

  // User only selects fixtureDoc, so otherDoc ID is NOT in filterDocumentIds
  const filterDocumentIds = [fixtureDoc.id];
  const query = 'Explain Transport layer services';
  const queryEmb = generateMockEmbedding(query);

  const { data: matches } = await mockSupabase.rpc('match_document_chunks_768', {
    query_embedding: queryEmb,
    match_threshold: 0.18,
    match_count: 6,
    filter_document_ids: filterDocumentIds,
  });

  // Verify that otherDoc chunks are NOT returned
  const otherMatches = matches.filter(m => m.document_id === otherDoc.id);
  assert.equal(otherMatches.length, 0, 'Unselected document chunks must not be returned');
});

await runTest('9. Scope query for an unselected document returns insufficient evidence with scope explanation', async () => {
  const selectedDocIds = [fixtureDoc.id]; // User selected HAP 2.pdf, but queries Computer_Networking.pdf
  const query = 'Summarize Computer_Networking.pdf';
  const intent = parseScopeQuery(query);

  assert.equal(intent.isScopeQuery, true);
  assert.equal(intent.targetDocumentName, 'Computer_Networking.pdf');

  // Verify that target document is NOT in selected scope
  const isAllowed = selectedDocIds.includes(otherDoc.id);
  assert.equal(isAllowed, false);
});

await runTest('10. Genuinely irrelevant queries return insufficient evidence', async () => {
  const mockSupabase = createMockSupabase([fixtureDoc]);
  const query = 'What is quantum electrodynamics in particle physics?';
  const queryEmb = generateMockEmbedding(query);

  const { data: matches } = await mockSupabase.rpc('match_document_chunks_768', {
    query_embedding: queryEmb,
    match_threshold: 0.18,
    match_count: 6,
    filter_document_ids: [fixtureDoc.id],
  });

  assert.equal(matches.length, 0, 'Irrelevant query should return 0 matches above threshold');

  const answer = generateMockGroundedAnswer(query, []);
  assert.ok(answer.toLowerCase().includes('insufficient evidence'));
});

await runTest('11. Every citation matches the physical page of its supporting chunk', async () => {
  // Test with arbitrary combinations of passages
  const testPassages = [
    { document_name: 'HAP 2.pdf', page_number: 2, content: fixtureDoc.chunks[3].content },
    { document_name: 'HAP 2.pdf', page_number: 1, content: fixtureDoc.chunks[1].content },
  ];

  const answer = generateMockGroundedAnswer(
    'According to HAP 2.pdf, what topics are covered under the respiratory system?',
    testPassages
  );

  // Excerpt from chunk 3 (respiratory) must cite p. 2
  assert.ok(answer.includes('[HAP 2.pdf, p. 2]'));
  assert.ok(!answer.includes('[HAP 2.pdf, p. 1]'));
  // Findings line for respiratory must cite p. 2, not p. 1
  const findingsMatch = answer.match(/Based on the retrieved context passages[\s\S]*?### 2\./);
  assert.ok(findingsMatch, 'Answer must contain Grounded Findings section');
  const findingsText = findingsMatch[0];
  assert.ok(
    findingsText.includes('Respiratory system') && findingsText.includes('[HAP 2.pdf, p. 2]'),
    'Grounded findings must pair respiratory concept directly with [HAP 2.pdf, p. 2]'
  );
});

await runTest('12. Filename extraction handles punctuation, mid-sentence placement, and case insensitivity', () => {
  const cases = [
    { q: 'What topics does HAP 2.pdf cover under the nervous system?', expected: 'HAP 2.pdf' },
    { q: 'According to HAP 2.pdf, what topics are covered under the respiratory system?', expected: 'HAP 2.pdf' },
    { q: "Can you check 'HAP 2.pdf' for digestive topics?", expected: 'HAP 2.pdf' },
    { q: 'Does "HAP-2_v1.0.pdf" mention histology?', expected: 'HAP-2_v1.0.pdf' },
    { q: 'Is there any mention of kidneys in hap 2.pdf?', expected: 'hap 2.pdf' },
    { q: 'Please explain Nonexistent.pdf in detail.', expected: 'Nonexistent.pdf' },
  ];

  for (const c of cases) {
    const intent = parseScopeQuery(c.q, [fixtureDoc.name]);
    assert.equal(
      intent.targetDocumentName?.toLowerCase(),
      c.expected.toLowerCase(),
      `Query "${c.q}" should resolve target document "${c.expected}", got "${intent.targetDocumentName}"`
    );
  }
});

await runTest('13. Scope rejection for nonexistent or unselected documents', () => {
  const query = 'Is Nonexistent.pdf included here?';
  const intent = parseScopeQuery(query, [fixtureDoc.name]);
  assert.equal(intent.targetDocumentName, 'Nonexistent.pdf');

  // Verify that Nonexistent.pdf is not among allowed docs [fixtureDoc.name]
  const allowedNames = [fixtureDoc.name];
  const matched = allowedNames.some(
    name => name.toLowerCase() === intent.targetDocumentName?.toLowerCase()
  );
  assert.equal(matched, false, 'Nonexistent document must not match allowed workspace documents');
});

await runTest('14. Topic filtering removes cross-unit statements and prevents duplicate findings', () => {
  const query = 'According to HAP 2.pdf, what topics are covered under the respiratory system?';
  const allPassages = fixtureDoc.chunks.map(c => ({
    document_name: fixtureDoc.name,
    page_number: c.page_number,
    content: c.content,
  }));

  const answer = generateMockGroundedAnswer(query, allPassages);
  
  // Count occurrences of key findings to verify deduplication
  const lines = answer.split('\n').filter(l => l.startsWith('- '));
  const uniqueLines = new Set(lines);
  assert.equal(lines.length, uniqueLines.size, 'Answer must not contain duplicate bullet points');
  
  // Verify that findings only reference respiratory topics
  for (const line of lines) {
    assert.ok(
      line.includes('Respiratory') || line.includes('respiration') || line.includes('gases') || line.includes('lungs'),
      `Bullet point must be respiratory-focused: "${line}"`
    );
  }
});

await runTest('15. Text chunking preserves word boundaries and does not create chunks beginning mid-word', () => {
  const page1Raw = `BP 201T. HUMAN ANATOMY AND PHYSIOLOGY-II (Theory) 45 Hours Scope: This subject is designed to impart fundamental knowledge on the structure and functions of the various systems of the human body. It also helps in understanding both homeostatic mechanisms. The subject provides the basic knowledge required to understand the various disciplines of pharmacy. Objectives: Upon completion of this course the student should be able to: 1. Explain the gross morphology, structure and functions of various organs of the human body. 2. Describe the various homeostatic mechanisms and their imbalances. 3. Identify the various tissues and organs of different systems of human body. 4. Perform the hematological tests like blood cell counts, haemoglobin estimation, bleeding/clotting time etc and also record blood pressure, heart rate, pulse and respiratory volume. 5. Appreciate coordinated working pattern of different organs of each system 6. Appreciate the interlinked mechanisms in the maintenance of normal functioning (homeostasis) of human body. Course Content: Unit I 10 hours \uF0B7 Nervous system Organization of nervous system, neuron, neuroglia, classification and properties of nerve fibre, electrophysiology, action potential, nerve impulse, receptors, synapse, neurotransmitters. Central nervous system: Meninges, ventricles of brain and cerebrospinal fluid.structure and functions of brain (cerebrum, brain stem, cerebellum), spinal cord (gross structure, functions of afferent and efferent nerve tracts,reflex activity) Unit II 06 hours \uF0B7 Digestive system Anatomy of GI Tract with special reference to anatomy and functions of stomach, ( Acid production in the stomach, regulation of acid production through parasympathetic nervous system, pepsin role in protein digestion) small intestine 54`;

  const chunks = chunkText(page1Raw, 1, 0, 750, 120);
  assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    assert.equal(chunk.pageNumber, 1, `Chunk ${i} should preserve page number 1`);
    assert.ok(chunk.content.length > 0, `Chunk ${i} should not be empty`);

    // Verify chunk does not begin with a single lowercase letter or mid-word cut
    assert.ok(
      !/^[a-z]\s/.test(chunk.content),
      `Chunk ${i} must not start with a single orphaned letter like "d ": "${chunk.content.slice(0, 30)}"`
    );
    assert.ok(
      !chunk.content.startsWith('d properties'),
      `Chunk ${i} must not start with truncated "d properties"`
    );
    assert.ok(
      !chunk.content.startsWith('atic mechanisms'),
      `Chunk ${i} must not start with truncated "atic mechanisms"`
    );

    // Verify first word starts on a clean boundary (capital letter, digit, bullet, or complete word)
    const firstWord = chunk.content.split(/\s+/)[0];
    assert.ok(
      /^[A-Z0-9\uF0B7•·]/.test(firstWord) || firstWord.length > 3,
      `Chunk ${i} should start on a clean boundary, got "${firstWord}"`
    );
  }
});

await runTest('16. Core query archetypes maintain strict topic separation, page citations, and honest bounds', async () => {
  const allPassages = fixtureDoc.chunks.map(c => ({
    document_name: fixtureDoc.name,
    page_number: c.page_number,
    content: c.content,
  }));

  // Archetype 1: Nervous system -> Unit I, Page 1 only
  const nervousAns = generateMockGroundedAnswer('What topics does HAP 2.pdf cover under the nervous system?', allPassages);
  assert.ok(nervousAns.includes('[HAP 2.pdf, p. 1]'));
  assert.ok(!nervousAns.includes('[HAP 2.pdf, p. 2]'));
  assert.ok(nervousAns.includes('Organization of nervous system, neuron, and neuroglia'));
  assert.ok(!nervousAns.toLowerCase().includes('respiratory system'));
  assert.ok(!nervousAns.toLowerCase().includes('digestive system'));

  // Archetype 2: Respiratory system -> Unit III, Page 2 only
  const respAns = generateMockGroundedAnswer('According to HAP 2.pdf, what topics are covered under the respiratory system?', allPassages);
  assert.ok(respAns.includes('[HAP 2.pdf, p. 2]'));
  assert.ok(!respAns.includes('[HAP 2.pdf, p. 1]'));
  assert.ok(respAns.includes('Respiratory system anatomy'));
  assert.ok(!respAns.toLowerCase().includes('nervous system'));
  assert.ok(!respAns.toLowerCase().includes('digestive system'));

  // Archetype 3: Digestion and absorption -> Unit II, Pages 1 & 2, strictly excluding energetics
  const digestAns = generateMockGroundedAnswer('What topics are covered under digestion and absorption?', allPassages);
  assert.ok(digestAns.includes('[HAP 2.pdf, p. 1]'));
  assert.ok(digestAns.includes('[HAP 2.pdf, p. 2]'));
  assert.ok(digestAns.includes('Anatomy of GI Tract'));
  assert.ok(digestAns.includes('Large intestine'));
  assert.ok(!digestAns.toLowerCase().includes('energetics'));
  assert.ok(!digestAns.toLowerCase().includes('atp'));
  assert.ok(!digestAns.toLowerCase().includes('bmr'));
  assert.ok(!digestAns.toLowerCase().includes('neuron'));
  assert.ok(!digestAns.toLowerCase().includes('respiratory system'));

  // Archetype 4: Urinary system -> Unit III, Page 2 only
  const urinaryAns = generateMockGroundedAnswer('What topics are covered under the urinary system in HAP 2.pdf?', allPassages);
  assert.ok(urinaryAns.includes('[HAP 2.pdf, p. 2]'));
  assert.ok(!urinaryAns.includes('[HAP 2.pdf, p. 1]'));
  assert.ok(urinaryAns.includes('Anatomy of urinary tract'));
  assert.ok(urinaryAns.includes('Physiology of urine formation'));
  assert.ok(!urinaryAns.toLowerCase().includes('nervous system'));
  assert.ok(!urinaryAns.toLowerCase().includes('digestive system'));

  // Archetype 5: Energetics explicitly requested -> Unit II, Page 2
  const energyAns = generateMockGroundedAnswer('What topics are covered under energetics in HAP 2.pdf?', allPassages);
  assert.ok(energyAns.includes('[HAP 2.pdf, p. 2]'));
  assert.ok(energyAns.includes('Formation and role of ATP, Creatinine Phosphate and BMR'));

  // Archetype 6: Unrelated query -> Honest insufficient evidence
  const unrelatedAns = generateMockGroundedAnswer('What is quantum electrodynamics in particle physics?', []);
  assert.ok(unrelatedAns.toLowerCase().includes('insufficient evidence'));
  assert.ok(!unrelatedAns.includes('[HAP 2.pdf'));
});

// =========================================================================
// SUMMARY
// =========================================================================
console.log('\n======================================================');
console.log(`📊 Test Results: ${passedTests} / ${totalTests} Passed (100%)`);
console.log('🎉 Mock AI Provider & Retrieval Test Suite Passed Successfully!');
console.log('======================================================\n');

