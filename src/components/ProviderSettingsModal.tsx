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
  Lock,
  Unlock,
  ShieldCheck,
  Info,
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
    isVaultSupported,
    isVaultConfigured,
    isVaultLocked,
    isVaultLoading,
    vaultSavedProviders,
    unlockVault,
    lockVault,
    saveKeyToVault,
    deleteKeyFromVault,
    resetVault,
  } = useProviderKey();

  const [showKey, setShowKey] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Vault form state
  const [vaultPassword, setVaultPassword] = useState('');
  const [showVaultPassword, setShowVaultPassword] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [showThreatModel, setShowThreatModel] = useState(false);

  if (!isOpen) return null;

  const currentOption = PROVIDER_OPTIONS[provider];
  const isCurrentProviderInVault = vaultSavedProviders.includes(provider);

  const handleProviderSelect = (p: AIProvider) => {
    setSuccessMessage(null);
    clearError();
    setProvider(p);
  };

  const handleTestAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    clearError();

    const effectiveKey = apiKeyInput.trim() || (provider === 'mock' ? 'mock-key' : '');
    if (provider === 'mock' && !apiKeyInput.trim()) {
      setApiKeyInput('mock-key');
    }

    const ok = await connectKey(provider, effectiveKey);
    if (ok) {
      setSuccessMessage(
        provider === 'mock'
          ? 'Mock AI session connected! Zero-cost simulated responses are enabled for development.'
          : `Successfully connected to ${currentOption.name}! In-memory session is active.`
      );
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setSuccessMessage(null);
  };

  const handleUnlockVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    clearError();

    if (!vaultPassword) return;

    const ok = await unlockVault(vaultPassword);
    if (ok) {
      setSuccessMessage('Encrypted key vault unlocked! Saved keys decrypted into memory.');
      setVaultPassword('');
    }
  };

  const handleLockVault = () => {
    lockVault();
    setSuccessMessage('Vault locked. All decrypted keys purged from memory.');
    clearError();
  };

  const handleSaveToVault = async () => {
    setSuccessMessage(null);
    clearError();

    const keyToSave = apiKeyInput.trim();
    if (!keyToSave) {
      return;
    }

    if (!vaultPassword || vaultPassword.length < 6) {
      return;
    }

    const ok = await saveKeyToVault(provider, keyToSave, vaultPassword);
    if (ok) {
      setSuccessMessage(
        `Successfully encrypted and saved ${currentOption.name} key to browser vault!`
      );
      setVaultPassword('');
    }
  };

  const handleDeleteFromVault = async () => {
    setSuccessMessage(null);
    clearError();

    const ok = await deleteKeyFromVault(provider);
    if (ok) {
      setSuccessMessage(`Removed ${currentOption.name} key from encrypted vault.`);
    }
  };

  const handleResetVault = async () => {
    setSuccessMessage(null);
    clearError();

    const ok = await resetVault();
    if (ok) {
      setIsResetConfirmOpen(false);
      setVaultPassword('');
      setSuccessMessage('Encrypted vault was completely reset.');
    }
  };

  const availableProviders = (Object.keys(PROVIDER_OPTIONS) as AIProvider[]).filter(
    (pKey) => pKey !== 'mock' || process.env.NODE_ENV !== 'production'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">AI Provider & Encrypted Vault</h2>
              <p className="text-xs text-slate-400">Bring Your Own Key (BYOK) • Zero Remote Storage</p>
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
        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Provider Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-300">Select Provider</label>
              <span className="text-[11px] text-slate-500 font-mono">
                {isVaultConfigured
                  ? isVaultLocked
                    ? '🔒 Vault Locked'
                    : '🔓 Vault Unlocked'
                  : 'Vault Unconfigured'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {availableProviders.map((pKey) => {
                const opt = PROVIDER_OPTIONS[pKey];
                const isSelected = provider === pKey;
                const isSavedInVault = vaultSavedProviders.includes(pKey);

                return (
                  <button
                    key={pKey}
                    type="button"
                    onClick={() => handleProviderSelect(pKey)}
                    className={`flex flex-col p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-blue-600/10 border-blue-500 text-slate-100 ring-1 ring-blue-500/30'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-xs font-semibold">{opt.name}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px]">
                      <span className="text-slate-400">
                        {pKey === 'mock' ? 'Offline dev' : `${opt.embeddingDim} dims`}
                      </span>
                      {isSavedInVault && (
                        <span
                          className="flex items-center space-x-1 text-[10px] text-emerald-400 font-medium"
                          title="Key is saved in browser encrypted vault"
                        >
                          <Lock className="w-2.5 h-2.5" />
                          <span>Saved</span>
                        </span>
                      )}
                    </div>
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

          {/* API Key Form */}
          <form onSubmit={handleTestAndConnect} className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  {currentOption.name} {provider === 'mock' ? 'Simulation Directives' : 'API Key'}
                </label>
                {currentOption.keyUrl ? (
                  <a
                    href={currentOption.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    <span>Get {currentOption.name} Key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-[11px] text-emerald-400 font-medium">Offline Dev • Zero Cost</span>
                )}
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
                      : provider === 'openai'
                      ? 'sk-proj-...'
                      : 'mock-key'
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

            {/* Test & Connect Buttons */}
            <div className="flex items-center justify-between pt-1">
              {isConnected ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 border border-rose-500/20 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Disconnect Session</span>
                </button>
              ) : (
                <span className="text-[11px] text-slate-500">Not connected in session</span>
              )}

              <button
                type="submit"
                disabled={isTesting || !apiKeyInput.trim()}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:pointer-events-none transition-colors shadow-lg shadow-blue-600/20"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <span>Test & Connect Session</span>
                )}
              </button>
            </div>
          </form>

          {/* ---------------- Encrypted Key Vault Card ---------------- */}
          {isVaultSupported && provider !== 'mock' && (
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <div className="flex items-center space-x-2">
                  <div
                    className={`p-1.5 rounded-lg border ${
                      isVaultLocked
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}
                  >
                    {isVaultLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-200">
                      Encrypted Key Vault (AES-256-GCM)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {isVaultConfigured
                        ? isVaultLocked
                          ? `Locked • ${vaultSavedProviders.length} key${
                              vaultSavedProviders.length === 1 ? '' : 's'
                            } safely encrypted at rest`
                          : 'Unlocked • Decrypted strictly in browser memory'
                        : 'Not configured • Protect your keys with zero remote storage'}
                    </p>
                  </div>
                </div>

                {isVaultConfigured && !isVaultLocked && (
                  <button
                    type="button"
                    onClick={handleLockVault}
                    className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-amber-300 bg-amber-950/40 border border-amber-500/30 hover:bg-amber-900/40 transition-colors"
                  >
                    <Lock className="w-3 h-3" />
                    <span>Lock Vault</span>
                  </button>
                )}
              </div>

              {/* Case 1: Vault is Locked -> Prompt for Password to Unlock */}
              {isVaultConfigured && isVaultLocked && (
                <form onSubmit={handleUnlockVault} className="space-y-2.5">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Enter your vault password to decrypt and connect your saved keys in memory.
                  </p>
                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1">
                      <input
                        type={showVaultPassword ? 'text' : 'password'}
                        value={vaultPassword}
                        onChange={(e) => {
                          setVaultPassword(e.target.value);
                          clearError();
                        }}
                        placeholder="Enter vault password..."
                        className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowVaultPassword(!showVaultPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showVaultPassword ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isVaultLoading || !vaultPassword}
                      className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors"
                    >
                      {isVaultLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                      <span>Unlock</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Case 2: Vault is Unlocked or Unconfigured -> Provide Save/Update/Delete options */}
              {(!isVaultConfigured || !isVaultLocked) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">
                      {isCurrentProviderInVault
                        ? `Replace saved ${currentOption.name} key`
                        : `Save ${currentOption.name} key to vault`}
                    </span>
                    {isCurrentProviderInVault && (
                      <button
                        type="button"
                        onClick={handleDeleteFromVault}
                        className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline"
                      >
                        Delete from Vault
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type={showVaultPassword ? 'text' : 'password'}
                        value={vaultPassword}
                        onChange={(e) => {
                          setVaultPassword(e.target.value);
                          clearError();
                        }}
                        placeholder={
                          isVaultConfigured
                            ? 'Enter vault password to confirm save...'
                            : 'Set new vault password (min 6 chars)...'
                        }
                        className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowVaultPassword(!showVaultPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showVaultPassword ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveToVault}
                      disabled={
                        isVaultLoading ||
                        !apiKeyInput.trim() ||
                        !vaultPassword ||
                        vaultPassword.length < 6
                      }
                      className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 disabled:opacity-50 transition-colors"
                    >
                      {isVaultLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Encrypting (PBKDF2-SHA-256)...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                          <span>
                            {isCurrentProviderInVault
                              ? `Update Encrypted ${currentOption.name} Key`
                              : `Save & Encrypt ${currentOption.name} Key`}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Reset Vault Option */}
              {isVaultConfigured && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Forgot password?</span>
                  {!isResetConfirmOpen ? (
                    <button
                      type="button"
                      onClick={() => setIsResetConfirmOpen(true)}
                      className="text-rose-400 hover:text-rose-300 hover:underline"
                    >
                      Reset Vault
                    </button>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <span className="text-rose-400">Clear all encrypted keys?</span>
                      <button
                        type="button"
                        onClick={handleResetVault}
                        className="px-2 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-500 font-medium"
                      >
                        Yes, Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsResetConfirmOpen(false)}
                        className="text-slate-400 hover:text-slate-200"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Feedback Messages */}
          {error && (
            <div className="flex items-start space-x-2 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-tight">{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-start space-x-2 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="leading-tight">{successMessage}</span>
            </div>
          )}

          {/* Honest Threat Model & Security Notice */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90 text-xs text-slate-400 space-y-2">
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setShowThreatModel(!showThreatModel)}
            >
              <div className="flex items-center space-x-2 text-slate-300 font-medium">
                <ShieldAlert className="w-4 h-4 text-blue-400" />
                <span>Security Architecture & Threat Model</span>
              </div>
              <button
                type="button"
                className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center space-x-1"
              >
                <Info className="w-3 h-3" />
                <span>{showThreatModel ? 'Hide Details' : 'View Security Guarantees'}</span>
              </button>
            </div>

            {showThreatModel ? (
              <div className="space-y-2 text-[11px] text-slate-400 leading-relaxed pt-2 border-t border-slate-800">
                <p>
                  <strong className="text-slate-200">Zero-Knowledge Storage:</strong> Plaintext API keys and
                  vault passwords are <span className="text-emerald-400">never sent to DocuDock servers</span>,
                  Supabase, or remote telemetry. All AI calls route directly from your browser to Google or OpenAI.
                </p>
                <p>
                  <strong className="text-slate-200">At-Rest Protection:</strong> Keys in the vault are encrypted
                  using AES-GCM (256-bit) with fresh random 96-bit IVs and PBKDF2-HMAC-SHA-256 (600,000 iterations).
                </p>
                <p>
                  <strong className="text-slate-200">Browser Security Boundaries:</strong> Decrypted keys live strictly
                  in temporary JavaScript memory while the vault is unlocked. Browser encryption protects against
                  offline disk inspection, but{' '}
                  <span className="text-amber-300">
                    cannot prevent memory access by malicious browser extensions or same-origin XSS vulnerabilities
                  </span>{' '}
                  while unlocked. Always lock the vault when you finish your session.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Direct browser-to-provider routing. Zero plaintext keys on disk.
                Lock the vault anytime to purge all in-memory keys.
              </p>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
