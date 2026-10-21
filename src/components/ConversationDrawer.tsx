'use client';

import React, { useState } from 'react';
import { Conversation } from '@/lib/types';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Clock,
  Layers,
} from 'lucide-react';

interface ConversationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onDeleteConversation: (id: string) => void;
}

export function ConversationDrawer({
  isOpen,
  onClose,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
}: ConversationDrawerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartRename = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
    setConfirmDeleteId(null);
  };

  const handleSaveRename = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRenameConversation(convId, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    if (confirmDeleteId === convId) {
      onDeleteConversation(convId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(convId);
      setEditingId(null);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Slide-out Sidebar Panel */}
      <div className="relative w-80 max-w-[85vw] bg-slate-900 border-r border-slate-800 flex flex-col h-full shadow-2xl z-50 animate-in slide-in-from-left duration-200">
        {/* Header */}
        <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-100">Chat History</h2>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {conversations.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-md hover:bg-slate-800 transition-colors"
            title="Close history"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Button: New Conversation */}
        <div className="p-3 border-b border-slate-800/80">
          <button
            onClick={() => {
              onNewConversation();
              onClose();
            }}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Research Chat</span>
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const isEditing = editingId === conv.id;
            const isConfirmingDelete = confirmDeleteId === conv.id;

            return (
              <div
                key={conv.id}
                onClick={() => {
                  if (!isEditing && !isConfirmingDelete) {
                    onSelectConversation(conv.id);
                    onClose();
                  }
                }}
                className={`group relative flex flex-col rounded-lg p-2.5 cursor-pointer text-xs transition-colors border ${
                  isActive
                    ? 'bg-blue-950/40 border-blue-500/40 text-blue-100'
                    : 'bg-slate-900/60 hover:bg-slate-800/60 border-transparent hover:border-slate-800 text-slate-300'
                }`}
              >
                {/* Title or Inline Edit */}
                {isEditing ? (
                  <div className="flex items-center space-x-1.5 mb-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(e as unknown as React.MouseEvent, conv.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="flex-1 bg-slate-950 border border-blue-500 rounded px-2 py-1 text-xs text-slate-100 focus:outline-hidden"
                    />
                    <button
                      onClick={(e) => handleSaveRename(e, conv.id)}
                      className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 rounded"
                      title="Save title"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleCancelRename}
                      className="p-1 text-slate-400 hover:text-slate-300 hover:bg-slate-800 rounded"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium truncate pr-2" title={conv.title}>
                      {conv.title}
                    </span>

                    {/* Action buttons on hover */}
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleStartRename(e, conv)}
                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                        title="Rename conversation"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(e, conv.id)}
                        className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded transition-colors"
                        title="Delete conversation"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Confirm Delete Banner */}
                {isConfirmingDelete && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="my-1.5 p-2 bg-rose-950/60 border border-rose-500/40 rounded flex flex-col space-y-1.5 text-rose-200 animate-in fade-in duration-150"
                  >
                    <span className="text-[11px] leading-tight">Delete this entire conversation?</span>
                    <div className="flex items-center space-x-2 justify-end">
                      <button
                        onClick={handleCancelDelete}
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(e, conv.id)}
                        className="px-2 py-0.5 rounded bg-rose-600 text-white font-medium text-[10px] hover:bg-rose-500"
                      >
                        Confirm Delete
                      </button>
                    </div>
                  </div>
                )}

                {/* Metadata Row: message count, timestamp, selected doc count */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                  <div className="flex items-center space-x-2">
                    <span>{conv.messages.length} msg{conv.messages.length === 1 ? '' : 's'}</span>
                    {conv.selectedDocIds && conv.selectedDocIds.length > 0 && (
                      <span className="flex items-center space-x-0.5 text-blue-400/80">
                        <Layers className="w-2.5 h-2.5" />
                        <span>{conv.selectedDocIds.length} doc{conv.selectedDocIds.length === 1 ? '' : 's'}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-1 text-slate-400">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{formatTimestamp(conv.updatedAt || conv.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
