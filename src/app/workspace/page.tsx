'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { DocumentSidebar } from '@/components/DocumentSidebar';
import { ResearchArea } from '@/components/ResearchArea';
import { ProviderSettingsModal } from '@/components/ProviderSettingsModal';
import { CitationInspector } from '@/components/CitationInspector';
import { useProviderKey } from '@/lib/context/ProviderKeyContext';
import { createClient } from '@/lib/supabase/client';
import { DocumentRecord, ChatMessage, Citation, Conversation } from '@/lib/types';
import { fetchUserDocuments, indexDocument, retryDocumentIndexing, getDocumentSignedUrl } from '@/lib/services/documentService';
import { executeRAGQuery } from '@/lib/services/ragService';
import { ProviderError } from '@/lib/ai/providers';
import { classifyProviderError } from '@/lib/ai/modelCache';
import {
  loadUserConversations,
  createAndSaveConversation,
  updateActiveConversation,
  renameUserConversation,
  deleteUserConversation,
  saveActiveConversationId,
} from '@/lib/utils/conversationStorage';
import { ConversationDrawer } from '@/components/ConversationDrawer';
import { parseScopeQuery } from '@/lib/utils/scopeQueryParser';

export default function WorkspacePage() {
  const router = useRouter();
  const { provider, apiKey, isConnected } = useProviderKey();
  const [userId, setUserId] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  
  // Multi-conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [workspaceBanner, setWorkspaceBanner] = useState<{ type: 'error' | 'info'; message: string } | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState('');
  // Query state
  const [isLoadingQuery, setIsLoadingQuery] = useState(false);
  const [loadingStatusMessage, setLoadingStatusMessage] = useState<string>('');
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // Active conversation helper
  const activeConversation = conversations.find((c) => c.id === activeConversationId) || conversations[0];
  const messages = activeConversation?.messages || [];

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await fetchUserDocuments();
      setDocuments(docs);
    } catch (err: unknown) {
      console.warn('Could not load documents:', err);
    }
  }, []);

  // 1. Initial auth check, profile loading, document fetch, and chat history restoration
  useEffect(() => {
    let ignore = false;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (ignore) return;
      if (user) {
        setUserId(user.id);
        if (user.email) setUserEmail(user.email);

        // Restore conversations for this authenticated user (with automatic legacy migration)
        try {
          const { conversations: loadedConvs, activeConversationId: initialActiveId } = loadUserConversations(user.id);
          setConversations(loadedConvs);
          setActiveConversationId(initialActiveId);
          const currentActive = loadedConvs.find((c) => c.id === initialActiveId);
          if (currentActive?.selectedDocIds) {
            setSelectedDocIds(currentActive.selectedDocIds);
          }
        } catch (e) {
          console.warn('Failed to load user conversations from storage', e);
        }
      }
    });

    // 2. Active auth state listener: coordinates token refreshes and sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (ignore) return;
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session?.user) {
          setUserId(session.user.id);
          if (session.user.email) setUserEmail(session.user.email);
        }
      } else if (event === 'SIGNED_OUT') {
        setUserId('');
        setUserEmail('');
        router.push('/login');
      }
    });

    fetchUserDocuments()
      .then((docs) => {
        if (!ignore) {
          setDocuments(docs);
        }
      })
      .catch((err: unknown) => {
        console.warn('Could not load documents:', err);
      });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, [router]);

  // Handle switching active conversation
  const handleSelectConversation = (convId: string) => {
    const target = conversations.find((c) => c.id === convId);
    if (!target) return;
    setActiveConversationId(convId);
    if (userId) {
      saveActiveConversationId(userId, convId);
    }
    // Restore associated document selection for this conversation
    if (target.selectedDocIds) {
      setSelectedDocIds(target.selectedDocIds);
    }
    setActiveCitation(null);
  };

  // Handle creating a new conversation
  const handleNewConversation = () => {
    if (!userId) return;
    const { updatedConversations, newConversation } = createAndSaveConversation(
      userId,
      conversations,
      selectedDocIds
    );
    setConversations(updatedConversations);
    setActiveConversationId(newConversation.id);
    setActiveCitation(null);
  };

  // Handle renaming a conversation
  const handleRenameConversation = (convId: string, newTitle: string) => {
    if (!userId) return;
    const updated = renameUserConversation(userId, conversations, convId, newTitle);
    setConversations(updated);
  };

  // Handle deleting a conversation
  const handleDeleteConversation = (convId: string) => {
    if (!userId) return;
    const { updatedConversations, nextActiveId } = deleteUserConversation(
      userId,
      conversations,
      convId,
      activeConversationId,
      selectedDocIds
    );
    setConversations(updatedConversations);
    setActiveConversationId(nextActiveId);
    const nextActive = updatedConversations.find((c) => c.id === nextActiveId);
    if (nextActive?.selectedDocIds) {
      setSelectedDocIds(nextActive.selectedDocIds);
    }
    setActiveCitation(null);
  };

  // Keep active conversation's selectedDocIds in sync when user toggles checkboxes
  const handleToggleSelectDoc = (id: string) => {
    const updated = selectedDocIds.includes(id)
      ? selectedDocIds.filter((d) => d !== id)
      : [...selectedDocIds, id];
    setSelectedDocIds(updated);
    if (userId && activeConversationId) {
      const updatedConvs = updateActiveConversation(
        userId,
        conversations,
        activeConversationId,
        messages,
        updated
      );
      setConversations(updatedConvs);
    }
  };

  const handleSelectAllDocs = () => {
    const updated = documents.map((d) => d.id);
    setSelectedDocIds(updated);
    if (userId && activeConversationId) {
      const updatedConvs = updateActiveConversation(
        userId,
        conversations,
        activeConversationId,
        messages,
        updated
      );
      setConversations(updatedConvs);
    }
  };

  const handleClearDocSelection = () => {
    setSelectedDocIds([]);
    if (userId && activeConversationId) {
      const updatedConvs = updateActiveConversation(
        userId,
        conversations,
        activeConversationId,
        messages,
        []
      );
      setConversations(updatedConvs);
    }
  };

  // Upload handler
  const handleUploadFile = async (file: File) => {
    if (!isConnected || !apiKey) {
      setIsSettingsOpen(true);
      setWorkspaceBanner({
        type: 'error',
        message: 'Please connect your AI provider API key in Settings before uploading documents.',
      });
      return;
    }

    setWorkspaceBanner(null);
    setIsUploading(true);
    setUploadStatusMessage('Starting upload and extraction...');

    try {
      await indexDocument(file, provider, apiKey, (step, message) => {
        setUploadStatusMessage(message || step);
      });
      await loadDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setWorkspaceBanner({
        type: 'error',
        message: `Indexing failed: ${msg}`,
      });
      await loadDocuments();
    } finally {
      setIsUploading(false);
      setUploadStatusMessage('');
    }
  };

  // Retry document indexing handler (uses existing uploaded file from storage)
  const handleRetryDocument = async (doc: DocumentRecord) => {
    if (!isConnected || !apiKey) {
      setIsSettingsOpen(true);
      setWorkspaceBanner({
        type: 'error',
        message: 'Please connect your AI provider API key in Settings before retrying indexing.',
      });
      return;
    }

    setWorkspaceBanner(null);
    setIsUploading(true);
    setUploadStatusMessage(`Retrying indexing for "${doc.name}"...`);

    try {
      await retryDocumentIndexing(doc.id, provider, apiKey, (step, message) => {
        setUploadStatusMessage(message || step);
      });
      await loadDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry failed';
      setWorkspaceBanner({
        type: 'error',
        message: `Retry indexing failed: ${msg}`,
      });
      await loadDocuments();
    } finally {
      setIsUploading(false);
      setUploadStatusMessage('');
    }
  };

  // Research Question handler
  const handleSendMessage = async (
    query: string,
    options?: { isRetry?: boolean; failedMessageId?: string }
  ) => {
    // Prevent duplicate submissions while a request is already running
    if (isLoadingQuery) return;

    if (!isConnected || !apiKey) {
      setIsSettingsOpen(true);
      return;
    }

    let baseMessages = messages;

    // If retrying a failed message, remove the old error card first
    if (options?.isRetry && options.failedMessageId) {
      baseMessages = messages.filter((m) => m.id !== options.failedMessageId);
    }

    // Check if the previous message is already the user query (prevents duplicate user messages on retry)
    const lastMsg = baseMessages[baseMessages.length - 1];
    const isUserQueryAlreadyPresent =
      options?.isRetry && lastMsg?.role === 'user' && lastMsg.content.trim() === query.trim();

    let newMessagesWithUser: ChatMessage[];
    if (isUserQueryAlreadyPresent) {
      newMessagesWithUser = baseMessages;
    } else {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
        timestamp: Date.now(),
      };
      newMessagesWithUser = [...baseMessages, userMessage];
    }

    if (userId && activeConversationId) {
      const updatedConvs = updateActiveConversation(
        userId,
        conversations,
        activeConversationId,
        newMessagesWithUser,
        selectedDocIds
      );
      setConversations(updatedConvs);
    }
    setIsLoadingQuery(true);

    // Cancel any previous active query before starting a new one
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort(new Error('Cancelled by new request'));
    }
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    // Query-adaptive timeouts: allocate generous budget for multi-page scope summaries
    const isScope = parseScopeQuery(query).isScopeQuery;
    const overallDeadlineMs = isScope ? 120000 : 45000;
    const perAttemptTimeoutMs = isScope ? 45000 : 25000;

    // Timeout safety: guarantees loading indicator never hangs indefinitely
    const timeoutTimer = setTimeout(() => {
      abortController.abort(new Error('Request timed out waiting for the AI response. Please click Retry.'));
    }, overallDeadlineMs);

    try {
      const result = await executeRAGQuery(
        query,
        provider,
        apiKey,
        {
          filterDocumentIds: selectedDocIds.length > 0 ? selectedDocIds : undefined,
          signal: abortController.signal,
          timeoutMs: perAttemptTimeoutMs,
          onProgress: (status) => setLoadingStatusMessage(status),
        }
      );

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        timestamp: Date.now(),
      };

      const finalMessages = [...newMessagesWithUser, assistantMessage];
      if (userId && activeConversationId) {
        const updatedConvs = updateActiveConversation(
          userId,
          conversations,
          activeConversationId,
          finalMessages,
          selectedDocIds
        );
        setConversations(updatedConvs);
      }
    } catch (err: unknown) {
      const errClassification = classifyProviderError(
        err instanceof ProviderError ? err.statusCode : undefined,
        err instanceof ProviderError
          ? (err.rawDetails || err.message)
          : err instanceof Error
          ? err.message
          : String(err)
      );

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: errClassification.userMessage,
        timestamp: Date.now(),
        error: true,
        errorType: errClassification.kind,
        retryQuery: query,
      };
      const finalMessages = [...newMessagesWithUser, errorMessage];
      if (userId && activeConversationId) {
        const updatedConvs = updateActiveConversation(
          userId,
          conversations,
          activeConversationId,
          finalMessages,
          selectedDocIds
        );
        setConversations(updatedConvs);
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      setLoadingStatusMessage('');
      setIsLoadingQuery(false);
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
    }
  };

  const handleClearConversation = () => {
    setActiveCitation(null);
    if (userId && activeConversationId) {
      const updatedConvs = updateActiveConversation(
        userId,
        conversations,
        activeConversationId,
        [],
        selectedDocIds
      );
      setConversations(updatedConvs);
    }
  };

  const handleOpenDocumentPage = async (doc: DocumentRecord, pageNumber: number) => {
    try {
      const url = await getDocumentSignedUrl(doc.file_path);
      const targetUrl = pageNumber > 0 ? `${url}#page=${pageNumber}` : url;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      console.error('Could not generate signed URL for document page:', err);
      throw err;
    }
  };

  const readyDocuments = documents.filter((d) => d.status === 'ready');

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Header */}
      <Header
        userEmail={userEmail}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHistory={() => setIsHistoryDrawerOpen(true)}
        conversationCount={conversations.length}
      />

      {/* Global Workspace Notification Banner */}
      {workspaceBanner && (
        <div
          className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
            workspaceBanner.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/30 text-rose-300'
              : 'bg-blue-950/80 border-blue-500/30 text-blue-300'
          }`}
        >
          <span>{workspaceBanner.message}</span>
          <button
            onClick={() => setWorkspaceBanner(null)}
            className="text-xs font-bold hover:opacity-75 ml-3"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Document Sidebar */}
        <DocumentSidebar
          documents={documents}
          selectedDocIds={selectedDocIds}
          onToggleSelectDoc={handleToggleSelectDoc}
          onSelectAllDocs={handleSelectAllDocs}
          onClearDocSelection={handleClearDocSelection}
          onUploadFile={handleUploadFile}
          onRetryDocument={handleRetryDocument}
          onRefresh={loadDocuments}
          isUploading={isUploading}
          uploadStatusMessage={uploadStatusMessage}
        />

        {/* Central Research Area */}
        <ResearchArea
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoadingQuery}
          loadingStatusMessage={loadingStatusMessage}
          onClearConversation={handleClearConversation}
          onSelectCitation={(cit) => setActiveCitation(cit)}
          selectedDocCount={selectedDocIds.length}
          totalReadyDocCount={readyDocuments.length}
          isConnected={isConnected}
          provider={provider}
          onOpenSettings={() => setIsSettingsOpen(true)}
          conversationTitle={activeConversation?.title}
          onOpenHistory={() => setIsHistoryDrawerOpen(true)}
          onNewConversation={handleNewConversation}
        />

        {/* Citation Slide-over Inspector */}
        <CitationInspector
          citation={activeCitation}
          onClose={() => setActiveCitation(null)}
          documents={documents}
          onOpenDocument={handleOpenDocumentPage}
        />
      </div>

      {/* Conversation Drawer / History Sidebar Modal */}
      <ConversationDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* Provider Settings Modal */}
      <ProviderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
