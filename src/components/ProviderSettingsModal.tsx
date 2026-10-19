'use client';

import React, { useState } from 'react';
import { useProviderKey } from '@/lib/context/ProviderKeyContext';
import { PROVIDER_OPTIONS } from '@/lib/ai/providers';
import { AIProvider } from '@/lib/types';
import {
  X,
  Key,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
  Cpu,
} from 'lucide-react';

interface ProviderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProviderSettingsModal({ isOpen, onClose }: ProviderSettingsModalProps) {
  const {
    provider,
    apiKeyInput,
    setApiKeyInput,
    isConnected,
    isTesting,
    error,
    setProvider,
    connectKey,
    disconnect,
    clearError,
  } = useProviderKey();

  const [showKey, setShowKey] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentOption = PROVIDER_OPTIONS[provider];

  const handleProviderSelect = (p: AIProvider) => {
    setSuccessMessage(null);
    clearError();
    setProvider(p);
  };

  const handleTestAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    clearError();

    const ok = await connectKey();
    if (ok) {
      setSuccessMessage(`Successfully connected to ${currentOption.name}! In-memory session is active.`);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setSuccessMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">AI Provider Settings</h2>
              <p className="text-xs text-slate-400">Bring Your Own Key (BYOK)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Strict Security Notice */}
          <div className="flex items-start space-x-3 p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/20 text-xs text-blue-300">
            <ShieldAlert className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-blue-200">Zero Persistent Storage Security</p>
              <p className="text-blue-300/80 leading-relaxed">
                Your API key stays exclusively in temporary browser memory. It is never written to disk, databases,
                cookies, localStorage, or server logs, and is wiped immediately on disconnect or sign-out.
              </p>
            </div>
          </div>

          {/* Provider Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">Select Provider</label>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(PROVIDER_OPTIONS) as AIProvider[]).map((pKey) => {
                const opt = PROVIDER_OPTIONS[pKey];
                const isSelected = provider === pKey;
                return (
                  <button
                    key={pKey}
                    type="button"
                    onClick={() => handleProviderSelect(pKey)}
                    className={`flex flex-col p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-blue-600/10 border-blue-500 text-slate-100'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-xs font-semibold">{opt.name}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </div>
                    <span className="text-[11px] text-slate-400 leading-tight">
                      {opt.embeddingDim}-dim embeddings
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider Model Details */}
          <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Cpu className="w-3.5 h-3.5 text-slate-500" />
                <span>Embedding Model:</span>
              </span>
              <span className="font-mono text-slate-200">
                {currentOption.embeddingModel} ({currentOption.embeddingDim} dims)
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Cpu className="w-3.5 h-3.5 text-slate-500" />
                <span>Chat Reasoning Model:</span>
              </span>
              <span className="font-mono text-slate-200">{currentOption.chatModel}</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleTestAndConnect} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-300">{currentOption.name} API Key</label>
                <a
                  href={currentOption.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value);
                    clearError();
                    setSuccessMessage(null);
                  }}
                  placeholder={
                    provider === 'gemini'
                      ? 'AIzaSy...'
                      : 'sk-proj-...'
                  }
                  className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-start space-x-2 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-tight">{error}</span>
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="flex items-start space-x-2 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="leading-tight">{successMessage}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              {isConnected ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 border border-rose-500/20 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Disconnect Key</span>
                </button>
              ) : (
                <span className="text-[11px] text-slate-500">Not currently connected</span>
              )}

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  Done
                </button>
                <button
                  type="submit"
                  disabled={isTesting || !apiKeyInput.trim()}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:pointer-events-none transition-colors shadow-lg shadow-blue-600/20"
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <span>Test & Connect</span>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
