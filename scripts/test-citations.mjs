/**
 * Comprehensive Citation Audit and Regression Suite for DocuDock.
 * Tests:
 * 1. Malformed / legacy citation metadata normalization (preventing NaN%, missing IDs, corrupted page numbers).
 * 2. Citation extraction and recovery for old conversation messages where citations array was omitted.
 * 3. Disambiguation in multi-document scenarios (preventing wrong document citation matching).
 * 4. Graceful handling of deleted or missing documents (never opening unrelated documents).
 * 5. Multi-conversation switching and page refresh persistence.
 * 6. Physical PDF page navigation target URL generation (#page=X).
 */

import assert from 'node:assert/strict';
import {
  normalizeCitation,
  extractCitationsFromText,
  normalizeConversationMessages,
  loadUserConversations,
  saveUserConversations,
  saveActiveConversationId,
  updateActiveConversation,
} from '../src/lib/utils/conversationStorage.ts';

import { findMatchedDocument, buildPdfTargetUrl, docNameMatches } from '../src/lib/utils/citationUtils.ts';

console.log('🧪 Starting DocuDock Citation Regression & Audit Test Suite...\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n${err.stack}`);
  }
}

// Mock localStorage for node environment
class MockLocalStorage {
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

const mockStorage = new MockLocalStorage();
globalThis.window = { localStorage: mockStorage };

// =========================================================================
// TEST 1: Malformed & Legacy Citation Normalization (Self-Healing)
// =========================================================================
console.log('--- Test Suite 1: Malformed & Legacy Citation Normalization ---');

runTest('Handles missing similarity without producing NaN%', () => {
  const legacyCitation = {
    document_id: 'doc-123',
    document_name: 'Ch3_Transport_Layer.pdf',
    page_number: 14,
    content: 'TCP congestion control mechanisms...',
    // similarity is undefined or null in older data
  };

  const normalized = normalizeCitation(legacyCitation);
  assert.equal(normalized.similarity, 1.0, 'Default similarity should be 1.0');
  assert(!isNaN(normalized.similarity), 'Similarity must not be NaN');

  const similarityPercent = Math.round(normalized.similarity * 100);
  assert.equal(similarityPercent, 100);
  assert(!isNaN(similarityPercent), 'Percentage must be a valid number');
});

runTest('Handles corrupted or string page numbers safely', () => {
  const citationWithStringPage = {
    document_name: 'Ch3_Transport_Layer.pdf',
    page_number: '28',
    similarity: 0.88,
  };

  const normalized = normalizeCitation(citationWithStringPage);
  assert.equal(typeof normalized.page_number, 'number');
  assert.equal(normalized.page_number, 28);

  const citationWithInvalidPage = {
    document_name: 'Ch3_Transport_Layer.pdf',
    page_number: -5,
  };
  const normalizedFallback = normalizeCitation(citationWithInvalidPage);
  assert.equal(normalizedFallback.page_number, 1, 'Corrupted page number should safely fall back to 1');
});

runTest('Clamps similarity between 0 and 1', () => {
  const highSim = normalizeCitation({ similarity: 1.5 });
  assert.equal(highSim.similarity, 1.0);

  const lowSim = normalizeCitation({ similarity: -0.2 });
  assert.equal(lowSim.similarity, 0.0);
});

// =========================================================================
// TEST 2: Inline Citation Extraction & Recovery for Old Messages
// =========================================================================
console.log('\n--- Test Suite 2: Inline Citation Recovery from Older Messages ---');

runTest('Reconstructs missing citations array from answer content', () => {
  const assistantContent = `
    UDP is an unreliable, connectionless protocol [Ch3_Transport_Layer.pdf, p. 4].
    In contrast, TCP provides reliable data transfer using sequence numbers and ACKs [Ch3_Transport_Layer.pdf, p. 12].
    Congestion control operates using additive-increase multiplicative-decrease [Ch3_Transport_Layer.pdf, p. 55].
  `;

  const extracted = extractCitationsFromText(assistantContent);
  assert.equal(extracted.length, 3, 'Should extract 3 distinct citations');
  assert.equal(extracted[0].document_name, 'Ch3_Transport_Layer.pdf');
  assert.equal(extracted[0].page_number, 4);
  assert.equal(extracted[1].page_number, 12);
  assert.equal(extracted[2].page_number, 55);

  const oldMessage = {
    id: 'msg-old',
    role: 'assistant',
    content: assistantContent,
    timestamp: Date.now() - 50000,
    // citations array was omitted
  };

  const normalizedMsgs = normalizeConversationMessages([oldMessage]);
  assert(Array.isArray(normalizedMsgs[0].citations), 'citations array should be auto-reconstructed');
  assert.equal(normalizedMsgs[0].citations.length, 3);
});

// =========================================================================
// TEST 3: Multi-Document Citation Disambiguation
// =========================================================================
console.log('\n--- Test Suite 3: Multi-Document Citation Disambiguation ---');

runTest('Disambiguates citations across different documents on the same page', () => {
  const citations = [
    {
      document_id: 'doc-transport',
      document_name: 'Ch3_Transport_Layer.pdf',
      page_number: 10,
      content: 'Transport Layer passage on page 10',
      similarity: 0.95,
    },
    {
      document_id: 'doc-network',
      document_name: 'Ch4_Network_Layer.pdf',
      page_number: 10,
      content: 'Network Layer routing principles on page 10',
      similarity: 0.91,
    },
  ];

  // Helper matching function mirroring FormattedAnswer
  function resolveCitation(tokenText, cits) {
    const pageMatch = tokenText.match(/p\.\s*(\d+)/i);
    const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : null;
    const docNamePart = tokenText.replace(/,\s*p\.\s*\d+/i, '').trim();

    let matched = cits?.find((c) => {
      const pageMatches = pageNum !== null ? c.page_number === pageNum : true;
      const nameMatches = docNamePart ? docNameMatches(c.document_name, docNamePart) : true;
      return pageMatches && nameMatches;
    });

    if (!matched && pageNum !== null) {
      matched = cits?.find((c) => c.page_number === pageNum && (!docNamePart || docNameMatches(c.document_name, docNamePart)));
    }

    return matched || {
      document_id: '',
      document_name: docNamePart || 'Document',
      page_number: pageNum || 1,
      content: `Source reference from response: [${tokenText}]`,
      similarity: 1.0,
    };
  }

  // Token 1: explicitly asks for Network layer page 10
  const matchNetwork = resolveCitation('Ch4_Network_Layer.pdf, p. 10', citations);
  assert.equal(matchNetwork.document_id, 'doc-network', 'Must match Network layer, NOT citations[0]');
  assert.equal(matchNetwork.page_number, 10);

  // Token 2: explicitly asks for Transport layer page 10
  const matchTransport = resolveCitation('Ch3_Transport_Layer.pdf, p. 10', citations);
  assert.equal(matchTransport.document_id, 'doc-transport', 'Must match Transport layer');
  assert.equal(matchTransport.page_number, 10);

  // Token 3: token references page 99 which is not in citations
  const matchUnknown = resolveCitation('Ch3_Transport_Layer.pdf, p. 99', citations);
  assert.equal(matchUnknown.page_number, 99, 'Must not jump to citations[0] page 10');
  assert.equal(matchUnknown.document_name, 'Ch3_Transport_Layer.pdf');
});

// =========================================================================
// TEST 4: Document Lookup & Graceful Handling of Missing / Deleted Documents
// =========================================================================
console.log('\n--- Test Suite 4: Document Lookup & Missing / Deleted Documents ---');

runTest('Finds active workspace document by ID, exact name, or base name', () => {
  const activeDocuments = [
    {
      id: 'doc-transport-uuid',
      name: 'Ch3_Transport_Layer.pdf',
      file_path: 'user-1/Ch3_Transport_Layer.pdf',
      status: 'ready',
    },
    {
      id: 'doc-notes-uuid',
      name: 'LectureNotes.pdf',
      file_path: 'user-1/LectureNotes.pdf',
      status: 'ready',
    },
  ];

  // Match by ID
  const matchById = findMatchedDocument(
    { document_id: 'doc-transport-uuid', document_name: 'Whatever', page_number: 5 },
    activeDocuments
  );
  assert.equal(matchById?.id, 'doc-transport-uuid');

  // Match by Name when ID is blank (legacy citation)
  const matchByName = findMatchedDocument(
    { document_id: '', document_name: 'Ch3_Transport_Layer.pdf', page_number: 12 },
    activeDocuments
  );
  assert.equal(matchByName?.id, 'doc-transport-uuid');

  // Match by Base Name without .pdf
  const matchByBase = findMatchedDocument(
    { document_id: '', document_name: 'Ch3_Transport_Layer', page_number: 12 },
    activeDocuments
  );
  assert.equal(matchByBase?.id, 'doc-transport-uuid');
});

runTest('Gracefully returns null when document was deleted or is missing (never opens unrelated document)', () => {
  const activeDocuments = [
    {
      id: 'doc-remaining',
      name: 'ExistingDocument.pdf',
      file_path: 'user-1/ExistingDocument.pdf',
      status: 'ready',
    },
  ];

  // Old citation referencing a deleted PDF
  const deletedDocCitation = {
    document_id: 'doc-deleted-uuid',
    document_name: 'OldDeletedPaper.pdf',
    page_number: 4,
    content: 'Passage preserved in chat history...',
    similarity: 0.9,
  };

  const matched = findMatchedDocument(deletedDocCitation, activeDocuments);
  assert.equal(matched, null, 'Must return null for deleted document; never open ExistingDocument.pdf!');
});

// =========================================================================
// TEST 5: Multi-Conversation Switching & Page Refresh Persistence
// =========================================================================
console.log('\n--- Test Suite 5: Multi-Conversation Switching & Page Refresh ---');

runTest('Preserves citations across conversation switching and page refresh', () => {
  mockStorage.clear();
  const userId = 'user_audit_test_1';

  // Seed two conversations:
  // Conv 1: Transport Layer discussion with citations
  // Conv 2: Architecture discussion with citations
  const initialConversations = [
    {
      id: 'conv-1',
      title: 'Transport Layer Analysis',
      createdAt: 1000,
      updatedAt: 2000,
      selectedDocIds: ['doc-transport-uuid'],
      messages: [
        {
          id: 'msg-u1',
          role: 'user',
          content: 'What does TCP do?',
          timestamp: 1001,
        },
        {
          id: 'msg-a1',
          role: 'assistant',
          content: 'TCP provides reliable, ordered data stream service [Ch3_Transport_Layer.pdf, p. 12].',
          citations: [
            {
              document_id: 'doc-transport-uuid',
              document_name: 'Ch3_Transport_Layer.pdf',
              page_number: 12,
              content: 'TCP provides reliable logical communication...',
              similarity: 0.96,
            },
          ],
          timestamp: 1002,
        },
      ],
    },
    {
      id: 'conv-2',
      title: 'Legacy Chat with Corrupted Citations',
      createdAt: 3000,
      updatedAt: 4000,
      selectedDocIds: ['doc-arch-uuid'],
      messages: [
        {
          id: 'msg-u2',
          role: 'user',
          content: 'Explain layering',
          timestamp: 3001,
        },
        {
          id: 'msg-a2',
          role: 'assistant',
          content: 'Layering provides modular architecture [SystemDesign.pdf, p. 3].',
          // Malformed legacy citation: no similarity, string page number
          citations: [
            {
              document_id: '',
              document_name: 'SystemDesign.pdf',
              page_number: '3',
              content: 'Modular system design principles...',
            },
          ],
          timestamp: 3002,
        },
      ],
    },
  ];

  // 1. Save conversations
  saveUserConversations(userId, initialConversations);
  saveActiveConversationId(userId, 'conv-1');

  // 2. Simulate Page Refresh: loadUserConversations(userId)
  const restored = loadUserConversations(userId);
  assert.equal(restored.conversations.length, 2, 'Must restore both conversations');
  assert.equal(restored.activeConversationId, 'conv-1', 'Active conversation must be preserved');

  // Verify Conv 1 citation
  const conv1 = restored.conversations.find((c) => c.id === 'conv-1');
  const cit1 = conv1.messages[1].citations[0];
  assert.equal(cit1.page_number, 12);
  assert.equal(cit1.document_id, 'doc-transport-uuid');
  assert.equal(cit1.similarity, 0.96);

  // Verify Conv 2 citation was self-healed on load
  const conv2 = restored.conversations.find((c) => c.id === 'conv-2');
  const cit2 = conv2.messages[1].citations[0];
  assert.equal(cit2.page_number, 3, 'Page number parsed to number');
  assert.equal(cit2.similarity, 1.0, 'Missing similarity healed to 1.0 (no NaN)');

  // 3. Simulate Switching to Conv 2
  saveActiveConversationId(userId, 'conv-2');
  const afterSwitch = loadUserConversations(userId);
  assert.equal(afterSwitch.activeConversationId, 'conv-2', 'Active conversation switched to conv-2');

  // 4. Update Conv 2 and verify citations remain intact
  const updatedConvs = updateActiveConversation(
    userId,
    afterSwitch.conversations,
    'conv-2',
    conv2.messages,
    ['doc-arch-uuid']
  );
  assert.equal(updatedConvs.length, 2);
  const reloaded = loadUserConversations(userId);
  assert.equal(reloaded.conversations.find((c) => c.id === 'conv-2').messages[1].citations[0].page_number, 3);
});

// =========================================================================
// TEST 6: Physical PDF Page Navigation URL Generation
// =========================================================================
console.log('\n--- Test Suite 6: Physical PDF Page Navigation URL Generation ---');

runTest('Generates correct URL targeting physical PDF page (#page=X)', () => {
  const baseSignedUrl = 'https://supabase.project.co/storage/v1/object/sign/documents/user/Ch3.pdf?token=abc123xyz';

  const urlPage12 = buildPdfTargetUrl(baseSignedUrl, 12);
  assert.equal(urlPage12, `${baseSignedUrl}#page=12`);

  const urlPage1 = buildPdfTargetUrl(baseSignedUrl, 1);
  assert.equal(urlPage1, `${baseSignedUrl}#page=1`);

  const urlPageDefault = buildPdfTargetUrl(baseSignedUrl, 0);
  assert.equal(urlPageDefault, baseSignedUrl);
});

console.log(`\n======================================================`);
console.log(`🏁 Test Summary: ${passedTests} / ${totalTests} Passed`);
if (passedTests === totalTests) {
  console.log(`🎉 ALL CITATION TESTS PASSED SUCCESSFULLY!`);
  process.exit(0);
} else {
  console.error(`💥 ${totalTests - passedTests} TESTS FAILED!`);
  process.exit(1);
}
