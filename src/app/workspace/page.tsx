'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { DocumentSidebar } from '@/components/DocumentSidebar';
import { ResearchArea } from '@/components/ResearchArea';
import { ProviderSettingsModal } from '@/components/ProviderSettingsModal';
import { CitationInspector } from '@/components/CitationInspector';
import { useProviderKey } from '@/lib/context/ProviderKeyContext';
import { createClient } from '@/lib/supabase/client';
import { DocumentRecord, ChatMessage, Citation } from '@/lib/types';
import { fetchUserDocuments, indexDocument } from '@/lib/services/documentService';
import { executeRAGQuery } from '@/lib/services/ragService';

export default function WorkspacePage() {
  const { provider, apiKey, isConnected } = useProviderKey();
  const [userEmail, setUserEmail] = useState<string>('');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState('');
  // Query state
  const [isLoadingQuery, setIsLoadingQuery] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await fetchUserDocuments();
      setDocuments(docs);
    } catch (err: unknown) {
      console.warn('Could not load documents:', err);
    }
  }, []);

  // Load user profile & documents on mount
  useEffect(() => {
    let ignore = false;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!ignore && user?.email) {
        setUserEmail(user.email);
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
    };
  }, []);

  // Document selection toggles
  const handleToggleSelectDoc = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const handleSelectAllDocs = () => {
    setSelectedDocIds(documents.map((d) => d.id));
  };

  const handleClearDocSelection = () => {
    setSelectedDocIds([]);
  };

  // Upload handler
  const handleUploadFile = async (file: File) => {
    if (!isConnected || !apiKey) {
      setIsSettingsOpen(true);
      alert('Please connect your AI provider API key before uploading and indexing documents.');
      return;
    }

    setIsUploading(true);
    setUploadStatusMessage('Starting upload and extraction...');

    try {
      await indexDocument(file, provider, apiKey, (step, message) => {
        setUploadStatusMessage(message || step);
      });
      await loadDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      alert(`Indexing failed: ${msg}`);
      await loadDocuments();
    } finally {
      setIsUploading(false);
      setUploadStatusMessage('');
    }
  };

  // Research Question handler
  const handleSendMessage = async (query: string) => {
    if (!isConnected || !apiKey) {
      setIsSettingsOpen(true);
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoadingQuery(true);

    try {
      const result = await executeRAGQuery(
        query,
        provider,
        apiKey,
        selectedDocIds.length > 0 ? selectedDocIds : undefined
      );

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve answer';
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${msg}. Please check your provider key in Settings or verify your network connection.`,
        timestamp: Date.now(),
        error: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoadingQuery(false);
    }
  };

  const handleClearConversation = () => {
    setMessages([]);
    setActiveCitation(null);
  };

  const readyDocuments = documents.filter((d) => d.status === 'ready');

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Header */}
      <Header userEmail={userEmail} onOpenSettings={() => setIsSettingsOpen(true)} />

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
          onRefresh={loadDocuments}
          isUploading={isUploading}
          uploadStatusMessage={uploadStatusMessage}
        />

        {/* Central Research Area */}
        <ResearchArea
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoadingQuery}
          onClearConversation={handleClearConversation}
          onSelectCitation={(cit) => setActiveCitation(cit)}
          selectedDocCount={selectedDocIds.length}
          totalReadyDocCount={readyDocuments.length}
          isConnected={isConnected}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* Citation Slide-over Inspector */}
        <CitationInspector
          citation={activeCitation}
          onClose={() => setActiveCitation(null)}
        />
      </div>

      {/* Provider Settings Modal */}
      <ProviderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
