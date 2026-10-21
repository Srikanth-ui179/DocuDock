'use client';

import React, { useState } from 'react';
import { Citation, DocumentRecord } from '@/lib/types';
import {
  X,
  FileText,
  Bookmark,
  Percent,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

import { findMatchedDocument } from '@/lib/utils/citationUtils';

interface CitationInspectorProps {
  citation: Citation | null;
  onClose: () => void;
  documents?: DocumentRecord[];
  onOpenDocument?: (doc: DocumentRecord, pageNumber: number) => Promise<void> | void;
}

export function CitationInspector({
  citation,
  onClose,
  documents,
  onOpenDocument,
}: CitationInspectorProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  if (!citation) return null;

  // Safe similarity percent without NaN
  const rawSim =
    typeof citation.similarity === 'number' && !isNaN(citation.similarity)
      ? citation.similarity
      : 1.0;
  const similarityPercent = Math.round(Math.max(0, Math.min(100, rawSim * 100)));

  const matchedDoc = findMatchedDocument(citation, documents);
  const isDocAvailable = Boolean(matchedDoc);

  const handleOpenDoc = async () => {
    if (!matchedDoc || !onOpenDocument) return;
    setIsOpening(true);
    setOpenError(null);
    try {
      await onOpenDocument(matchedDoc, citation.page_number);
    } catch (err: unknown) {
      setOpenError(err instanceof Error ? err.message : 'Could not open document at this page');
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-96 bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center space-x-2 text-slate-200">
          <Bookmark className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Source Citation Details
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title="Close Inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Document Info Card */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
          <div className="flex items-start space-x-2.5">
            <FileText className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p
                className="text-xs font-semibold text-slate-100 truncate"
                title={citation.document_name}
              >
                {citation.document_name}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11px] text-slate-400">
                <span className="px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-500/30 font-medium">
                  Page {citation.page_number}
                </span>
                <span className="flex items-center space-x-0.5 text-slate-400">
                  <Percent className="w-3 h-3 text-slate-500" />
                  <span>{similarityPercent}% match</span>
                </span>
              </div>
            </div>
          </div>

          {/* Document availability status indicator */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
            {isDocAvailable ? (
              <span className="inline-flex items-center text-emerald-400 space-x-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Document active in workspace</span>
              </span>
            ) : (
              <span className="inline-flex items-center text-amber-400 space-x-1">
                <AlertTriangle className="w-3 h-3" />
                <span>Document not in workspace</span>
              </span>
            )}
          </div>
        </div>

        {/* Action Button: Open PDF at Page X if available */}
        {isDocAvailable && onOpenDocument ? (
          <div className="space-y-1.5">
            <button
              onClick={handleOpenDoc}
              disabled={isOpening}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800/60 text-white text-xs font-semibold shadow-lg shadow-blue-950/40 transition-colors cursor-pointer"
            >
              {isOpening ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Opening PDF...</span>
                </>
              ) : (
                <>
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Document (Page {citation.page_number})</span>
                </>
              )}
            </button>
            {openError && <p className="text-[11px] text-rose-400 mt-1">{openError}</p>}
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs leading-relaxed space-y-1">
            <div className="flex items-center space-x-1.5 font-medium text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Document File Unavailable</span>
            </div>
            <p className="text-[11px] text-amber-200/90">
              This document is no longer active in your workspace (it may have been deleted). The
              passage preserved in your chat history is displayed below. Unrelated documents will
              never be opened.
            </p>
          </div>
        )}

        {/* Source Text Passage */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Retrieved Passage
          </label>
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap selection:bg-blue-500/30">
            {citation.content || '(Passage text unavailable)'}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/30 flex items-center justify-between">
        {isDocAvailable && onOpenDocument && (
          <button
            onClick={handleOpenDoc}
            disabled={isOpening}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open Page {citation.page_number}</span>
          </button>
        )}
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors ml-auto cursor-pointer"
        >
          Close Inspector
        </button>
      </div>
    </div>
  );
}

