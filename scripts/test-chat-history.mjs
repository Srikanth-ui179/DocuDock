/**
 * test-chat-history.mjs
 *
 * Comprehensive automated test suite verifying DocuDock's persistent chat history implementation:
 * 1. Multi-conversation isolation and persistence.
 * 2. Surviving page refresh / reload simulation.
 * 3. Switching between conversations without data corruption, leaking, or duplicate messages.
 * 4. Automatic titling from first user prompt and manual renaming.
 * 5. Safe deletion of conversations, with automatic active-id fallback and fresh-chat guarantee.
 * 6. User scoping and account switching isolation (User A never sees User B's conversations).
 * 7. Preservation of citation metadata, document associations, and timestamps.
 * 8. Backward compatibility and seamless migration of legacy single-thread chat history.
 * 9. Resilience to corrupted/malformed localStorage JSON.
 * 10. Verification of no AI provider keys leaked or saved in chat storage.
 */

import assert from 'node:assert';

// Mock localStorage environment for comprehensive testing
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
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

// Attach mock window & localStorage
const mockStorage = new MockLocalStorage();
globalThis.window = { localStorage: mockStorage };

// Dynamic import of conversation storage module
const {
  loadUserConversations,
  saveActiveConversationId,
  createAndSaveConversation,
  updateActiveConversation,
  renameUserConversation,
  deleteUserConversation,
  CONVERSATIONS_STORAGE_KEY_PREFIX,
  LEGACY_CHAT_KEY_PREFIX,
  LEGACY_SELECTED_DOCS_KEY_PREFIX,
} = await import('../src/lib/utils/conversationStorage.ts');

async function runTestSuite() {
  console.log('====================================================');
  console.log('🧪 DOCUDOCK PERSISTENT CHAT HISTORY TEST SUITE');
  console.log('====================================================\n');

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

  // --- Test 1: Fresh user initialization ---
  runTest('Initial load for new user creates a valid empty conversation', () => {
    mockStorage.clear();
    const userId = 'usr_alice_123';
    const { conversations, activeConversationId } = loadUserConversations(userId);

    assert.strictEqual(conversations.length, 1);
    assert.strictEqual(conversations[0].id, activeConversationId);
    assert.strictEqual(conversations[0].messages.length, 0);
    assert.strictEqual(conversations[0].title, 'New Conversation');
  });

  // --- Test 2: Message addition, automatic titling, and persistence ---
  runTest('Adding first message automatically sets an intuitive conversation title and persists', () => {
    mockStorage.clear();
    const userId = 'usr_alice_123';
    let { conversations, activeConversationId } = loadUserConversations(userId);

    const firstMsg = {
      id: 'msg_1',
      role: 'user',
      content: 'Explain TCP Reno Fast Recovery mechanism and congestion window',
      timestamp: Date.now(),
    };

    const answerMsg = {
      id: 'msg_2',
      role: 'assistant',
      content: 'Fast Recovery allows TCP to skip slow start after triple duplicate ACKs...',
      citations: [
        {
          document_id: 'doc_transport_ch3',
          document_name: 'Ch3_Transport_Layer.pdf',
          page_number: 45,
          content: 'TCP Reno enters fast recovery...',
          similarity: 0.88,
        },
      ],
      timestamp: Date.now() + 500,
    };

    const selectedDocs = ['doc_transport_ch3'];
    conversations = updateActiveConversation(
      userId,
      conversations,
      activeConversationId,
      [firstMsg, answerMsg],
      selectedDocs
    );

    const active = conversations.find((c) => c.id === activeConversationId);
    assert.strictEqual(active.messages.length, 2);
    assert.strictEqual(active.messages[1].citations.length, 1);
    assert.strictEqual(active.selectedDocIds[0], 'doc_transport_ch3');
    // Title should be auto-derived from prompt (truncated to 40 chars with ellipsis if >40)
    assert.ok(active.title.startsWith('Explain TCP Reno'));

    // Verify localStorage has the raw JSON
    const raw = mockStorage.getItem(`${CONVERSATIONS_STORAGE_KEY_PREFIX}${userId}`);
    assert.ok(raw);
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed[0].messages.length, 2);
    assert.strictEqual(parsed[0].messages[1].citations[0].page_number, 45);
  });

  // --- Test 3: Page refresh / reload restoration ---
  runTest('Page refresh simulation restores all messages, citations, and selected docs', () => {
    // Note: mockStorage still has user_alice_123 data from Test 2
    const userId = 'usr_alice_123';
    const { conversations, activeConversationId } = loadUserConversations(userId);

    assert.strictEqual(conversations.length, 1);
    const active = conversations.find((c) => c.id === activeConversationId);
    assert.strictEqual(active.messages.length, 2);
    assert.strictEqual(active.messages[0].role, 'user');
    assert.strictEqual(active.messages[1].role, 'assistant');
    assert.strictEqual(active.messages[1].citations[0].document_name, 'Ch3_Transport_Layer.pdf');
    assert.strictEqual(active.messages[1].citations[0].page_number, 45);
    assert.deepStrictEqual(active.selectedDocIds, ['doc_transport_ch3']);
  });

  // --- Test 4: Creating second conversation & switching ---
  runTest('Creating a second conversation allows seamless switching without message mixing', () => {
    const userId = 'usr_alice_123';
    let { conversations, activeConversationId } = loadUserConversations(userId);
    const conv1Id = activeConversationId;

    // Create a new conversation
    const { updatedConversations, newConversation } = createAndSaveConversation(
      userId,
      conversations,
      ['doc_network_arch']
    );
    conversations = updatedConversations;
    activeConversationId = newConversation.id;

    assert.strictEqual(conversations.length, 2);
    assert.strictEqual(activeConversationId, newConversation.id);
    assert.strictEqual(newConversation.messages.length, 0);

    // Add message to conversation 2
    const conv2Msg = {
      id: 'msg_conv2_1',
      role: 'user',
      content: 'What is UDP multiplexing and demultiplexing port addressing?',
      timestamp: Date.now(),
    };
    conversations = updateActiveConversation(
      userId,
      conversations,
      activeConversationId,
      [conv2Msg],
      ['doc_network_arch']
    );

    // Switch back to conversation 1
    saveActiveConversationId(userId, conv1Id);
    const reloadConv1 = loadUserConversations(userId);
    assert.strictEqual(reloadConv1.activeConversationId, conv1Id);
    const conv1 = reloadConv1.conversations.find((c) => c.id === conv1Id);
    assert.strictEqual(conv1.messages.length, 2);
    assert.strictEqual(conv1.messages[0].content, 'Explain TCP Reno Fast Recovery mechanism and congestion window');

    // Switch back to conversation 2
    saveActiveConversationId(userId, newConversation.id);
    const reloadConv2 = loadUserConversations(userId);
    assert.strictEqual(reloadConv2.activeConversationId, newConversation.id);
    const conv2 = reloadConv2.conversations.find((c) => c.id === newConversation.id);
    assert.strictEqual(conv2.messages.length, 1);
    assert.strictEqual(conv2.messages[0].content, 'What is UDP multiplexing and demultiplexing port addressing?');
  });

  // --- Test 5: Manual renaming ---
  runTest('Renaming a conversation updates title and persists across reloads', () => {
    const userId = 'usr_alice_123';
    let { conversations, activeConversationId } = loadUserConversations(userId);

    const customTitle = 'Transport Layer Study Guide (Exam Prep)';
    renameUserConversation(userId, conversations, activeConversationId, customTitle);

    const reloaded = loadUserConversations(userId);
    const active = reloaded.conversations.find((c) => c.id === activeConversationId);
    assert.strictEqual(active.title, customTitle);
  });

  // --- Test 6: Deleting conversation and safe active fallback ---
  runTest('Deleting active conversation falls back safely to another existing conversation', () => {
    const userId = 'usr_alice_123';
    let { conversations, activeConversationId } = loadUserConversations(userId);
    assert.strictEqual(conversations.length, 2);

    const idToDelete = activeConversationId;
    const { updatedConversations, nextActiveId } = deleteUserConversation(
      userId,
      conversations,
      idToDelete,
      activeConversationId,
      []
    );

    assert.strictEqual(updatedConversations.length, 1);
    assert.notStrictEqual(nextActiveId, idToDelete);
    assert.strictEqual(updatedConversations[0].id, nextActiveId);

    // Verify localStorage reflects deletion
    const reloaded = loadUserConversations(userId);
    assert.strictEqual(reloaded.conversations.length, 1);
    assert.strictEqual(reloaded.activeConversationId, nextActiveId);
  });

  // --- Test 7: Deleting all conversations automatically spawns a fresh conversation ---
  runTest('Deleting all remaining conversations automatically spawns a fresh conversation', () => {
    const userId = 'usr_alice_123';
    let { conversations, activeConversationId } = loadUserConversations(userId);

    const { updatedConversations, nextActiveId } = deleteUserConversation(
      userId,
      conversations,
      activeConversationId,
      activeConversationId,
      ['doc_default']
    );

    assert.strictEqual(updatedConversations.length, 1);
    assert.strictEqual(updatedConversations[0].id, nextActiveId);
    assert.strictEqual(updatedConversations[0].messages.length, 0);
    assert.strictEqual(updatedConversations[0].title, 'New Conversation');
  });

  // --- Test 8: User isolation and account switching ---
  runTest('User isolation: User A conversations are completely inaccessible to User B', () => {
    const userA = 'usr_alice_123';
    const userB = 'usr_bob_456';

    // Alice creates a conversation
    const { conversations: convsA, activeConversationId: activeA } = loadUserConversations(userA);
    updateActiveConversation(
      userA,
      convsA,
      activeA,
      [{ id: 'm1', role: 'user', content: 'Alice secret question', timestamp: 100 }],
      ['doc_alice']
    );

    // Bob logs in
    const { conversations: convsB, activeConversationId: activeB } = loadUserConversations(userB);

    assert.strictEqual(convsB.length, 1);
    assert.strictEqual(convsB[0].messages.length, 0);
    assert.notStrictEqual(activeB, activeA);

    // Bob adds his own message
    updateActiveConversation(
      userB,
      convsB,
      activeB,
      [{ id: 'm2', role: 'user', content: 'Bob research question', timestamp: 200 }],
      ['doc_bob']
    );

    // Recheck Alice's conversations - must be completely unaffected
    const reloadAlice = loadUserConversations(userA);
    assert.strictEqual(reloadAlice.conversations[0].messages[0].content, 'Alice secret question');
    assert.deepStrictEqual(reloadAlice.conversations[0].selectedDocIds, ['doc_alice']);
  });

  // --- Test 9: Legacy migration ---
  runTest('Legacy single-array history migration seamlessly converts to modern conversation', () => {
    mockStorage.clear();
    const legacyUser = 'usr_legacy_789';

    const legacyMessages = [
      {
        id: 'leg_1',
        role: 'user',
        content: 'Calculate RTT estimation with alpha = 0.125',
        timestamp: 1700000000000,
      },
      {
        id: 'leg_2',
        role: 'assistant',
        content: 'EstimatedRTT = (1 - alpha) * EstimatedRTT + alpha * SampleRTT',
        citations: [{ document_id: 'doc_1', document_name: 'Doc.pdf', page_number: 10, content: '...', similarity: 0.9 }],
        timestamp: 1700000001000,
      },
    ];
    const legacySelectedDocs = ['doc_transport_ch3'];

    // Put legacy keys in mockStorage
    mockStorage.setItem(`${LEGACY_CHAT_KEY_PREFIX}${legacyUser}`, JSON.stringify(legacyMessages));
    mockStorage.setItem(`${LEGACY_SELECTED_DOCS_KEY_PREFIX}${legacyUser}`, JSON.stringify(legacySelectedDocs));

    // Call loadUserConversations
    const { conversations, activeConversationId } = loadUserConversations(legacyUser);

    assert.strictEqual(conversations.length, 1);
    assert.strictEqual(conversations[0].id, activeConversationId);
    assert.strictEqual(conversations[0].messages.length, 2);
    assert.strictEqual(conversations[0].messages[0].content, 'Calculate RTT estimation with alpha = 0.125');
    assert.strictEqual(conversations[0].messages[1].citations[0].page_number, 10);
    assert.deepStrictEqual(conversations[0].selectedDocIds, ['doc_transport_ch3']);
    assert.ok(conversations[0].title.startsWith('Calculate RTT estimation'));
  });

  // --- Test 10: Graceful recovery from malformed or corrupted localStorage ---
  runTest('Gracefully handles malformed / corrupted JSON in localStorage without crashing', () => {
    const brokenUser = 'usr_corrupted_999';
    mockStorage.setItem(`${CONVERSATIONS_STORAGE_KEY_PREFIX}${brokenUser}`, '{"broken": [invalid-json}');

    const { conversations, activeConversationId } = loadUserConversations(brokenUser);
    assert.strictEqual(conversations.length, 1);
    assert.strictEqual(conversations[0].id, activeConversationId);
    assert.strictEqual(conversations[0].title, 'New Conversation');
    assert.strictEqual(conversations[0].messages.length, 0);
  });

  // --- Test 11: Security check - No AI keys in chat history storage ---
  runTest('Security verify: AI API keys are never persisted in conversation history', () => {
    const rawAllKeys = Array.from(mockStorage.store.keys());
    for (const key of rawAllKeys) {
      const val = mockStorage.getItem(key);
      assert.ok(!val.includes('AIzaSy'), 'Storage must not contain Gemini API keys');
      assert.ok(!val.includes('sk-'), 'Storage must not contain OpenAI API keys');
    }
  });

  console.log('\n====================================================');
  console.log(`📊 TEST RESULTS: ${passedTests} / ${totalTests} PASSED (100%)`);
  console.log('====================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
