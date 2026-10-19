'use client';

import React from 'react';
import { Citation } from '@/lib/types';
import { X, FileText, Bookmark, Percent } from 'lucide-react';

interface CitationInspectorProps {
  citation: Citation | null;
  onClose: () => void;
}

export function CitationInspector({ citation, onClose }: CitationInspectorProps) {
  if (!citation) return null;

  const similarityPercent = Math.round(Math.max(0, Math.min(100, citation.similarity * 100)));

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
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Document Info Card */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-start space-x-2">
            <FileText className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-100 truncate" title={citation.document_name}>
                {citation.document_name}
              </p>
              <div className="flex items-center space-x-2 mt-1 text-[11px] text-slate-400">
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
        </div>

        {/* Source Text Passage */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Retrieved Passage
          </label>
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap selection:bg-blue-500/30">
            {citation.content}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/30 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
        >
          Close Inspector
        </button>
      </div>
    </div>
  );
}
