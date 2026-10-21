import type { Conversation, ChatMessage, Citation } from '@/lib/types';

export const CONVERSATIONS_STORAGE_KEY_PREFIX = 'docudock_conversations_';
export const ACTIVE_CONV_STORAGE_KEY_PREFIX = 'docudock_active_conv_';
export const LEGACY_CHAT_KEY_PREFIX = 'docudock_chat_history_';
export const LEGACY_SELECTED_DOCS_KEY_PREFIX = 'docudock_selected_docs_';

/**
 * Normalizes a citation object to ensure all required fields are present and valid.
 * Fixes missing similarity (avoiding NaN%), missing document_ids, and ensures positive page numbers.
 */
export function normalizeCitation(raw: unknown, docNameFallback = 'Document'): Citation {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  let pageNum = 1;
  if (typeof r.page_number === 'number' && !isNaN(r.page_number) && r.page_number > 0) {
    pageNum = r.page_number;
  } else if (typeof r.page_number === 'string') {
    const parsed = parseInt(r.page_number, 10);
    if (!isNaN(parsed) && parsed > 0) pageNum = parsed;
  }

  const rawSim = typeof r.similarity === 'number' && !isNaN(r.similarity) ? r.similarity : 1.0;
  const similarity = Math.max(0, Math.min(1, rawSim));

  return {
    document_id: typeof r.document_id === 'string' ? r.document_id : '',
    document_name: typeof r.document_name === 'string' && r.document_name ? r.document_name : docNameFallback,
    page_number: pageNum,
    content: typeof r.content === 'string' && r.content ? r.content : `Referenced passage on page ${pageNum}`,
    similarity,
  };
}

/**
 * Extracts citations from text matching [DocumentName, p. X] tokens.
 * Useful for older conversations where messages contain inline tokens but citations array was omitted.
 */
export function extractCitationsFromText(text: string): Citation[] {
  if (!text) return [];
  const regex = /\[([^\]]+?),\s*p\.\s*(\d+)\]/g;
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const docName = match[1].trim();
    const pageNum = parseInt(match[2], 10) || 1;
    const key = `${docName.toLowerCase()}-${pageNum}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        document_id: '',
        document_name: docName,
        page_number: pageNum,
        content: `Source reference from answer: [${match[0]}]`,
        similarity: 1.0,
      });
    }
  }

  return citations;
}

/**
 * Normalizes an array of messages to guarantee valid citations on load and restore.
 */
export function normalizeConversationMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;

    let citations = msg.citations;
    if (Array.isArray(citations) && citations.length > 0) {
      citations = citations.map((c) => normalizeCitation(c));
    } else {
      const extracted = extractCitationsFromText(msg.content);
      if (extracted.length > 0) {
        citations = extracted;
      }
    }

    return {
      ...msg,
      citations: citations && citations.length > 0 ? citations : undefined,
    };
  });
}

function getStorageSafe(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch (err) {
    console.warn('localStorage is not available:', err);
    return null;
  }
}

/**
 * Generates an intuitive title based on the first query text.
 */
export function generateConversationTitle(firstQuery: string): string {
  const clean = firstQuery.trim().replace(/\s+/g, ' ');
  if (!clean) return 'New Conversation';
  if (clean.length <= 40) return clean;
  return clean.slice(0, 37) + '...';
}

/**
 * Creates a brand new conversation object.
 */
export function createNewConversationObject(
  selectedDocIds: string[] = [],
  title = 'New Conversation'
): Conversation {
  const now = Date.now();
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `conv_${now}_${Math.random().toString(36).substring(2, 9)}`;
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    selectedDocIds: [...selectedDocIds],
    messages: [],
  };
}

/**
 * Loads all conversations for the given authenticated user.
 * Automatically migrates legacy single-array chat history if found.
 */
export function loadUserConversations(userId: string): {
  conversations: Conversation[];
  activeConversationId: string;
} {
  const storage = getStorageSafe();
  if (!storage || !userId) {
    const fallback = createNewConversationObject();
    return { conversations: [fallback], activeConversationId: fallback.id };
  }

  const convsKey = `${CONVERSATIONS_STORAGE_KEY_PREFIX}${userId}`;
  const activeKey = `${ACTIVE_CONV_STORAGE_KEY_PREFIX}${userId}`;
  const rawConvs = storage.getItem(convsKey);

  let conversations: Conversation[] = [];

  if (rawConvs) {
    try {
      const parsed = JSON.parse(rawConvs);
      if (Array.isArray(parsed)) {
        conversations = parsed
          .filter(
            (c) => c && typeof c === 'object' && typeof c.id === 'string' && Array.isArray(c.messages)
          )
          .map((c) => ({
            ...c,
            messages: normalizeConversationMessages(c.messages),
          }));
      }
    } catch (e) {
      console.warn('Failed to parse conversations from localStorage, checking legacy or creating fresh:', e);
    }
  }

  // Check legacy migration if no valid conversations were found
  if (conversations.length === 0) {
    const legacyChatRaw = storage.getItem(`${LEGACY_CHAT_KEY_PREFIX}${userId}`);
    const legacySelectedDocsRaw = storage.getItem(`${LEGACY_SELECTED_DOCS_KEY_PREFIX}${userId}`);

    let legacyMessages: ChatMessage[] = [];
    let legacySelectedDocs: string[] = [];

    if (legacyChatRaw) {
      try {
        const parsed = JSON.parse(legacyChatRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          legacyMessages = parsed;
        }
      } catch (e) {
        console.warn('Failed to parse legacy chat history:', e);
      }
    }

    if (legacySelectedDocsRaw) {
      try {
        const parsed = JSON.parse(legacySelectedDocsRaw);
        if (Array.isArray(parsed)) {
          legacySelectedDocs = parsed;
        }
      } catch (e) {
        console.warn('Failed to parse legacy selected docs:', e);
      }
    }

    if (legacyMessages.length > 0) {
      const normalizedLegacy = normalizeConversationMessages(legacyMessages);
      const firstUserMsg = normalizedLegacy.find((m) => m.role === 'user');
      const title = firstUserMsg ? generateConversationTitle(firstUserMsg.content) : 'Previous Research';
      const migratedConv: Conversation = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `migrated_${Date.now()}`,
        title,
        createdAt: normalizedLegacy[0]?.timestamp || Date.now(),
        updatedAt: normalizedLegacy[normalizedLegacy.length - 1]?.timestamp || Date.now(),
        selectedDocIds: legacySelectedDocs,
        messages: normalizedLegacy,
      };
      conversations = [migratedConv];
      saveUserConversations(userId, conversations);
      saveActiveConversationId(userId, migratedConv.id);
      return { conversations, activeConversationId: migratedConv.id };
    }

    // Nothing exists yet -> initialize fresh conversation
    const fresh = createNewConversationObject(legacySelectedDocs);
    conversations = [fresh];
    saveUserConversations(userId, conversations);
    saveActiveConversationId(userId, fresh.id);
    return { conversations, activeConversationId: fresh.id };
  }

  // Sort by updatedAt descending
  conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // Determine active conversation ID
  const savedActiveId = storage.getItem(activeKey);
  const activeExists = conversations.some((c) => c.id === savedActiveId);
  const activeConversationId = activeExists && savedActiveId ? savedActiveId : conversations[0].id;

  if (activeConversationId !== savedActiveId) {
    saveActiveConversationId(userId, activeConversationId);
  }

  return { conversations, activeConversationId };
}

/**
 * Saves the conversations list for a user.
 */
export function saveUserConversations(userId: string, conversations: Conversation[]): void {
  const storage = getStorageSafe();
  if (!storage || !userId) return;
  try {
    storage.setItem(`${CONVERSATIONS_STORAGE_KEY_PREFIX}${userId}`, JSON.stringify(conversations));
  } catch (e) {
    console.warn('Failed to persist conversations to localStorage:', e);
  }
}

/**
 * Saves active conversation ID.
 */
export function saveActiveConversationId(userId: string, activeId: string): void {
  const storage = getStorageSafe();
  if (!storage || !userId) return;
  try {
    storage.setItem(`${ACTIVE_CONV_STORAGE_KEY_PREFIX}${userId}`, activeId);
  } catch (e) {
    console.warn('Failed to persist active conversation ID to localStorage:', e);
  }
}

/**
 * Adds a new conversation, persists it, and returns the updated state.
 */
export function createAndSaveConversation(
  userId: string,
  existingConversations: Conversation[],
  currentSelectedDocIds: string[] = []
): {
  updatedConversations: Conversation[];
  newConversation: Conversation;
} {
  const newConv = createNewConversationObject(currentSelectedDocIds);
  const updatedConversations = [newConv, ...existingConversations];
  saveUserConversations(userId, updatedConversations);
  saveActiveConversationId(userId, newConv.id);
  return { updatedConversations, newConversation: newConv };
}

/**
 * Updates messages and selected doc IDs for an active conversation and persists immediately.
 */
export function updateActiveConversation(
  userId: string,
  conversations: Conversation[],
  activeId: string,
  messages: ChatMessage[],
  selectedDocIds: string[]
): Conversation[] {
  const now = Date.now();
  const updated = conversations.map((conv) => {
    if (conv.id !== activeId) return conv;

    let title = conv.title;
    // Auto-generate title if this is the first user query and title is default
    if ((title === 'New Conversation' || !title) && messages.length > 0) {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      if (firstUserMsg) {
        title = generateConversationTitle(firstUserMsg.content);
      }
    }

    const normalizedMessages = normalizeConversationMessages(messages);

    return {
      ...conv,
      title,
      messages: normalizedMessages,
      selectedDocIds: [...selectedDocIds],
      updatedAt: now,
    };
  });

  saveUserConversations(userId, updated);
  return updated;
}

/**
 * Renames a conversation.
 */
export function renameUserConversation(
  userId: string,
  conversations: Conversation[],
  convId: string,
  newTitle: string
): Conversation[] {
  const cleanTitle = newTitle.trim() || 'Untitled Conversation';
  const updated = conversations.map((conv) => {
    if (conv.id !== convId) return conv;
    return { ...conv, title: cleanTitle, updatedAt: Date.now() };
  });

  saveUserConversations(userId, updated);
  return updated;
}

/**
 * Deletes a conversation. If the active conversation was deleted, picks a new active ID.
 */
export function deleteUserConversation(
  userId: string,
  conversations: Conversation[],
  convIdToDelete: string,
  currentActiveId: string,
  currentSelectedDocIds: string[] = []
): {
  updatedConversations: Conversation[];
  nextActiveId: string;
} {
  const remaining = conversations.filter((c) => c.id !== convIdToDelete);

  if (remaining.length === 0) {
    // If all deleted, automatically spawn a fresh conversation
    const fresh = createNewConversationObject(currentSelectedDocIds);
    const updatedConversations = [fresh];
    saveUserConversations(userId, updatedConversations);
    saveActiveConversationId(userId, fresh.id);
    return { updatedConversations, nextActiveId: fresh.id };
  }

  let nextActiveId = currentActiveId;
  if (currentActiveId === convIdToDelete) {
    nextActiveId = remaining[0].id;
    saveActiveConversationId(userId, nextActiveId);
  }

  saveUserConversations(userId, remaining);
  return { updatedConversations: remaining, nextActiveId };
}
