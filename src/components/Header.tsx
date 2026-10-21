'use client';

import React from 'react';
import { useProviderKey } from '@/lib/context/ProviderKeyContext';
import { useTheme } from '@/lib/context/ThemeContext';
import { PROVIDER_OPTIONS } from '@/lib/ai/providers';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  LogOut,
  ShieldCheck,
  AlertCircle,
  ChevronDown,
  MessageSquare,
  Lock,
  Unlock,
} from 'lucide-react';

interface HeaderProps {
  userEmail?: string;
  onOpenSettings: () => void;
  onOpenHistory?: () => void;
  conversationCount?: number;
}

export function Header({ userEmail, onOpenSettings, onOpenHistory, conversationCount }: HeaderProps) {
  const {
    provider,
    isConnected,
    disconnect,
    isVaultConfigured,
    isVaultLocked,
    lockVault,
  } = useProviderKey();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const currentProvider = PROVIDER_OPTIONS[provider];

  const handleSignOut = async () => {
    // 1. Purge all in-memory keys and lock vault
    lockVault();
    disconnect();
    // 2. Sign out of Supabase
    const supabase = createClient();
    await supabase.auth.signOut();
    // 3. Redirect to login
    router.push('/login');
    router.refresh();
  };

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0">
      <div className="flex items-center space-x-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 text-blue-400">
          <BookOpen className="w-4 h-4" />
        </div>
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-slate-100 tracking-tight text-base">DocuDock</span>
          <span className="text-[11px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
            Workspace
          </span>
        </div>

        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="flex items-center space-x-1.5 ml-3 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors"
            title="Open Chat History"
          >
            <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
            <span>Chats</span>
            {typeof conversationCount === 'number' && conversationCount > 0 && (
              <span className="px-1.5 py-0.2 bg-slate-800 text-[10px] rounded-full text-slate-400 border border-slate-700">
                {conversationCount}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="flex items-center space-x-2.5">
        {/* Light/Dark Theme Toggle Emoji Button */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 transition-colors cursor-pointer select-none active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shrink-0"
        >
          <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
        </button>

        {/* Encrypted Vault Status Quick Control */}
        {isVaultConfigured && (
          <button
            type="button"
            onClick={isVaultLocked ? onOpenSettings : lockVault}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isVaultLocked
                ? 'bg-amber-950/30 border-amber-500/30 text-amber-300 hover:bg-amber-900/40'
                : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40'
            }`}
            title={
              isVaultLocked
                ? 'Encrypted Vault is Locked (Click to open settings and unlock)'
                : 'Encrypted Vault is Unlocked (Click to lock immediately and purge keys)'
            }
          >
            {isVaultLocked ? (
              <Lock className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Unlock className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="hidden md:inline">{isVaultLocked ? 'Vault Locked' : 'Vault Unlocked'}</span>
          </button>
        )}

        {/* Provider Status Pill */}
        <button
          onClick={onOpenSettings}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isConnected
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40 hover:border-emerald-500/50'
              : 'bg-amber-950/40 border-amber-500/30 text-amber-300 hover:bg-amber-900/40 hover:border-amber-500/50'
          }`}
          title="Configure AI Provider Key (In-Memory Only)"
        >
          {isConnected ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>{currentProvider.name}</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Connect AI Key</span>
            </>
          )}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>

        {/* User Account & Sign Out */}
        {userEmail && (
          <div className="hidden sm:flex items-center pl-2 border-l border-slate-800 text-xs text-slate-400 space-x-2">
            <span className="truncate max-w-[150px]">{userEmail}</span>
          </div>
        )}

        <button
          onClick={handleSignOut}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
          title="Sign out & wipe in-memory session keys"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
