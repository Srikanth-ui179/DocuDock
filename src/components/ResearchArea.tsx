'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Citation } from '@/lib/types';
import {
  Send,
  Loader2,
  Sparkles,
  BookOpen,
  Copy,
  Check,
  AlertCircle,
  RotateCcw,
  Layers,
  ChevronRight,
} from 'lucide-react';

interface ResearchAreaProps {
  messages: ChatMessage[];
  onSendMessage: (query: string) => Promise<void>;
  isLoading: boolean;
  onClearConversation: () => void;
  onSelectCitation: (citation: Citation) => void;
  selectedDocCount: number;
  totalReadyDocCount: number;
  isConnected: boolean;
  onOpenSettings: () => void;
}

export function ResearchArea({
  messages,
  onSendMessage,
  isLoading,
  onClearConversation,
  onSelectCitation,
  selectedDocCount,
  totalReadyDocCount,
  isConnected,
  onOpenSettings,
}: ResearchAreaProps) {
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const query = input;
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await onSendMessage(query);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const samplePrompts = [
    'Summarize the core findings and conclusions across the documents.',
    'What methodologies, data, or technical frameworks are detailed?',
    'What were the primary limitations, risks, or caveats mentioned?',
  ];

  // Helper to parse text and highlight [DocName, p. X] as clickable buttons
  const renderMessageContent = (content: string, citations?: Citation[]) => {
    // Regex matches [DocumentName.pdf, p. 3] or [DocumentName, p. 3]
    const citationRegex = /\[([^\]]+?,\s*p\.\s*\d+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index));
      }

      const citationText = match[1]; // e.g. "Doc.pdf, p. 3"
      const matchedCitation = citations?.find((c) => {
        return citationText.toLowerCase().includes(`p. ${c.page_number}`) ||
               citationText.toLowerCase().includes(`p.${c.page_number}`);
      }) || (citations && citations[0]);

      parts.push(
        <button
          key={match.index}
          onClick={() => matchedCitation && onSelectCitation(matchedCitation)}
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-medium bg-blue-950/70 text-blue-300 border border-blue-500/30 hover:bg-blue-900/60 transition-colors align-baseline"
          title="Click to view source passage"
        >
          <span>[{citationText}]</span>
        </button>
      );

      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    return (
      <div className="whitespace-pre-wrap leading-relaxed text-sm text-slate-200 selection:bg-blue-500/30">
        {parts.map((p, idx) => (typeof p === 'string' ? <span key={idx}>{p}</span> : p))}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-slate-950/40 relative">
      {/* Top Scope & Action Bar */}
      <div className="h-10 px-6 border-b border-slate-800/60 bg-slate-900/30 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center space-x-2">
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          <span>
            {selectedDocCount > 0 ? (
              <span>
                Search Scope: <strong className="text-slate-200">{selectedDocCount}</strong> of {totalReadyDocCount} document(s)
              </span>
            ) : totalReadyDocCount > 0 ? (
              <span>
                Search Scope: <strong className="text-slate-200">All {totalReadyDocCount}</strong> document(s)
              </span>
            ) : (
              <span className="text-slate-500">No documents ready for search</span>
            )}
          </span>
        </div>

        {messages.length > 0 && (
          <button
            onClick={onClearConversation}
            className="flex items-center space-x-1 text-slate-400 hover:text-slate-200 transition-colors"
            title="Clear research conversation"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Clear Thread</span>
          </button>
        )}
      </div>

      {/* Conversation Thread */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full max-w-2xl mx-auto flex flex-col items-center justify-center text-center py-12 space-y-6">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shadow-lg shadow-blue-500/5">
              <Sparkles className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h1 className="text-lg font-semibold text-slate-100">AI Document Research Assistant</h1>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                Ask targeted questions about your uploaded PDFs. Every response is strictly grounded in retrieved vector passages with verifiable page-level citations.
              </p>
            </div>

            {/* Quick Prompts */}
            <div className="w-full space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Suggested queries</p>
              <div className="grid grid-cols-1 gap-2 text-left">
                {samplePrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(prompt);
                      textareaRef.current?.focus();
                    }}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-slate-100 flex items-center justify-between transition-colors group"
                  >
                    <span>{prompt}</span>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {/* Message Bubble */}
              <div
                className={`max-w-3xl rounded-2xl px-5 py-4 border ${
                  msg.role === 'user'
                    ? 'bg-blue-600/15 border-blue-500/30 text-slate-100'
                    : 'bg-slate-900/80 border-slate-800/80 text-slate-200 shadow-xl'
                }`}
              >
                {/* Author Badge */}
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800/60 text-[11px] text-slate-400">
                  <span className="font-semibold uppercase tracking-wider">
                    {msg.role === 'user' ? 'Research Question' : 'Grounded Finding'}
                  </span>
                  {msg.role === 'assistant' && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="flex items-center space-x-1 hover:text-slate-200 transition-colors"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Body */}
                {renderMessageContent(msg.content, msg.citations)}

                {/* Citation Chips Tray */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-800/60 space-y-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                      Cited Sources ({msg.citations.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.citations.map((c, idx) => (
                        <button
                          key={idx}
                          onClick={() => onSelectCitation(c)}
                          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-blue-500/40 text-[11px] text-slate-300 hover:text-blue-300 transition-all"
                          title="View source context"
                        >
                          <BookOpen className="w-3 h-3 text-blue-400" />
                          <span className="truncate max-w-[180px]">{c.document_name}</span>
                          <span className="text-blue-400 font-medium">p. {c.page_number}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex flex-col items-start">
            <div className="max-w-md rounded-2xl p-4 bg-slate-900/60 border border-slate-800 text-slate-300 flex items-center space-x-3 shadow-lg">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              <div className="text-xs space-y-0.5">
                <p className="font-medium text-slate-200">Researching Documents</p>
                <p className="text-slate-500 text-[11px]">Searching pgvector embeddings & formulating answer...</p>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-4 md:p-6 border-t border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto space-y-2">
          {!isConnected && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-amber-950/30 border border-amber-500/20 text-xs text-amber-300">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>AI Provider key not connected in memory. Connect your key to search and answer questions.</span>
              </div>
              <button
                onClick={onOpenSettings}
                className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-medium text-xs transition-colors shrink-0"
              >
                Connect Key
              </button>
            </div>
          )}

          <div className="relative flex items-end rounded-2xl bg-slate-900/90 border border-slate-800 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all shadow-xl">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={
                totalReadyDocCount === 0
                  ? 'Upload a PDF to begin research...'
                  : 'Ask a grounded question about your documents...'
              }
              className="flex-1 max-h-40 min-h-[48px] py-3.5 pl-4 pr-12 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none leading-relaxed"
            />
            <button
              onClick={() => handleSubmit()}
              disabled={isLoading || !input.trim() || !isConnected}
              className="absolute right-2.5 bottom-2.5 p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-30 disabled:pointer-events-none transition-colors shadow-md shadow-blue-600/20"
              title="Send question (Enter)"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
            <span>Press Enter to submit, Shift+Enter for new line</span>
            <span>Zero-owner-cost • Bring Your Own Key</span>
          </div>
        </div>
      </div>
    </div>
  );
}
