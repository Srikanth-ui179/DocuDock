'use client';

import React, { useRef, useState } from 'react';
import { DocumentRecord } from '@/lib/types';
import {
  FileText,
  UploadCloud,
  Trash2,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Check,
  RefreshCw,
} from 'lucide-react';
import { deleteDocument, getDocumentSignedUrl } from '@/lib/services/documentService';

interface DocumentSidebarProps {
  documents: DocumentRecord[];
  selectedDocIds: string[];
  onToggleSelectDoc: (id: string) => void;
  onSelectAllDocs: () => void;
  onClearDocSelection: () => void;
  onUploadFile: (file: File) => Promise<void>;
  onRefresh: () => Promise<void>;
  isUploading: boolean;
  uploadStatusMessage: string;
}

export function DocumentSidebar({
  documents,
  selectedDocIds,
  onToggleSelectDoc,
  onSelectAllDocs,
  onClearDocSelection,
  onUploadFile,
  onRefresh,
  isUploading,
  uploadStatusMessage,
}: DocumentSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUploadFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await onUploadFile(file);
    }
  };

  const handleDelete = async (doc: DocumentRecord) => {
    if (!confirm(`Are you sure you want to delete "${doc.name}"? This will remove all chunks and embeddings.`)) {
      return;
    }
    setDeletingId(doc.id);
    try {
      await deleteDocument(doc.id, doc.file_path);
      await onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenPdf = async (doc: DocumentRecord) => {
    setOpeningId(doc.id);
    try {
      const url = await getDocumentSignedUrl(doc.file_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not open document');
    } finally {
      setOpeningId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <aside className="w-80 border-r border-slate-800/80 bg-slate-950/60 flex flex-col h-full shrink-0">
      {/* Upload Box */}
      <div className="p-4 border-b border-slate-800/80">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/80'
          } ${isUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {isUploading ? (
            <div className="py-2 space-y-2 flex flex-col items-center">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              <p className="text-xs font-medium text-slate-200">Processing Document</p>
              <p className="text-[11px] text-slate-400 max-w-[200px] leading-tight">
                {uploadStatusMessage || 'Indexing in progress...'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 flex flex-col items-center">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-1">
                <UploadCloud className="w-5 h-5" />
              </div>
              <p className="text-xs font-medium text-slate-200">
                <span className="text-blue-400">Click to upload</span> or drag PDF
              </p>
              <p className="text-[10px] text-slate-400">PDF up to 10MB • Text-based</p>
            </div>
          )}
        </div>
      </div>

      {/* Document Controls */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center space-x-1.5">
          <FileText className="w-3.5 h-3.5 text-slate-500" />
          <span className="font-medium text-slate-300">Documents ({documents.length})</span>
        </div>
        <div className="flex items-center space-x-2">
          {documents.length > 0 && (
            <button
              onClick={selectedDocIds.length === documents.length ? onClearDocSelection : onSelectAllDocs}
              className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              {selectedDocIds.length === documents.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          <button
            onClick={onRefresh}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            title="Refresh documents"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Documents List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {documents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-slate-600">
              <FileText className="w-5 h-5" />
            </div>
            <p className="text-xs font-medium text-slate-400">No documents yet</p>
            <p className="text-[11px] text-slate-600 leading-normal">
              Upload a text-based PDF to index passages and start asking research questions.
            </p>
          </div>
        ) : (
          documents.map((doc) => {
            const isSelected = selectedDocIds.includes(doc.id);
            const isReady = doc.status === 'ready';
            const isFailed = doc.status === 'failed';
            const isIndexing = doc.status === 'indexing';

            return (
              <div
                key={doc.id}
                className={`group relative p-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'bg-blue-950/20 border-blue-500/40 shadow-sm'
                    : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80'
                }`}
              >
                {/* Title and Selection */}
                <div className="flex items-start space-x-2.5">
                  <button
                    onClick={() => onToggleSelectDoc(doc.id)}
                    className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'border-slate-700 bg-slate-950/60 hover:border-slate-500 text-transparent'
                    }`}
                    title={isSelected ? 'Remove from search scope' : 'Include in search scope'}
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate leading-snug" title={doc.name}>
                      {doc.name}
                    </p>

                    {/* Metadata & Status */}
                    <div className="flex items-center space-x-2 mt-1.5 text-[11px] text-slate-400">
                      <span>{formatSize(doc.file_size)}</span>
                      <span>•</span>
                      {isReady && <span>{doc.page_count}p</span>}
                      {isReady && <span>•</span>}
                      {isReady && <span>{doc.chunk_count} chunks</span>}

                      {/* Status indicator */}
                      {isReady && (
                        <span className="flex items-center space-x-1 text-emerald-400 ml-auto">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Ready</span>
                        </span>
                      )}
                      {isIndexing && (
                        <span className="flex items-center space-x-1 text-amber-400 ml-auto">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Indexing</span>
                        </span>
                      )}
                      {isFailed && (
                        <span
                          className="flex items-center space-x-1 text-rose-400 ml-auto cursor-help"
                          title={doc.error_message || 'Indexing failed'}
                        >
                          <AlertCircle className="w-3 h-3" />
                          <span>Failed</span>
                        </span>
                      )}
                    </div>

                    {isFailed && doc.error_message && (
                      <p className="mt-1 text-[10px] text-rose-400/90 leading-tight line-clamp-2">
                        {doc.error_message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Hover actions */}
                <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-end space-x-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleOpenPdf(doc)}
                    disabled={openingId === doc.id}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-[11px] flex items-center space-x-1 transition-colors"
                    title="Open document in new tab"
                  >
                    {openingId === doc.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3 h-3" />
                    )}
                    <span>View</span>
                  </button>

                  <button
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-[11px] flex items-center space-x-1 transition-colors"
                    title="Delete document and chunks"
                  >
                    {deletingId === doc.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
