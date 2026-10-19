'use client';

import React from 'react';
import { useProviderKey } from '@/lib/context/ProviderKeyContext';
import { PROVIDER_OPTIONS } from '@/lib/ai/providers';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { BookOpen, LogOut, ShieldCheck, AlertCircle, ChevronDown } from 'lucide-react';

interface HeaderProps {
  userEmail?: string;
  onOpenSettings: () => void;
}

export function Header({ userEmail, onOpenSettings }: HeaderProps) {
  const { provider, isConnected, disconnect } = useProviderKey();
  const router = useRouter();
  const currentProvider = PROVIDER_OPTIONS[provider];

  const handleSignOut = async () => {
    // 1. Purge all in-memory keys
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
      </div>

      <div className="flex items-center space-x-3">
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
