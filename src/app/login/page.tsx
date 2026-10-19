'use client';

import React, { useState, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BookOpen, ShieldCheck, Cpu, Database, AlertCircle, Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Derived configuration state
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isConfigured = Boolean(url && anon && !url.includes('placeholder'));

  // Derived auth error from OAuth redirect
  const authQueryError = searchParams.get('error');
  const errorMessage = submitError || (authQueryError ? `Authentication error: ${authQueryError}. Please verify your Google OAuth credentials.` : null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setSubmitError(null);

    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/auth/callback`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : 'Failed to initialize Google login';
      setSubmitError(msg);
    }
  };

  return (
    <div className="w-full max-w-md relative z-10 space-y-6">
      {/* Logo and Intro */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400 shadow-xl shadow-blue-500/10 mb-1">
          <BookOpen className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">DocuDock</h1>
        <p className="text-sm text-slate-400">
          Intelligent document research with page-level citations and zero-host-cost architecture.
        </p>
      </div>

      {/* Configuration Notice if Supabase not configured */}
      {!isConfigured && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 space-y-2">
          <div className="flex items-center space-x-2 font-semibold text-amber-300">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span>Supabase Setup Required</span>
          </div>
          <p className="text-amber-200/90 leading-relaxed">
            Add your <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{' '}
            <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono">.env.local</code> to activate live Google authentication.
          </p>
        </div>
      )}

      {/* Auth Box */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-2xl backdrop-blur-xl space-y-5">
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-tight">{errorMessage}</span>
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center space-x-3 py-3 px-4 rounded-xl bg-slate-100 hover:bg-white text-slate-900 font-medium text-sm transition-all shadow-lg hover:shadow-slate-100/10 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99] cursor-pointer"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
          )}
          <span>Continue with Google</span>
        </button>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-slate-800 w-full" />
          <span className="bg-slate-900 px-2 text-[10px] text-slate-500 uppercase tracking-wider absolute">
            Guaranteed Privacy
          </span>
        </div>

        {/* Key Value Propositions */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Provider API keys stay purely in browser memory</span>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Private storage with PostgreSQL & pgvector RLS</span>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Google Gemini & OpenAI bring-your-own-key support</span>
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-slate-600">
        DocuDock • Open source document research workspace
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 relative overflow-hidden selection:bg-blue-500/30">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-emerald-600/5 rounded-full blur-[100px] pointer-events-none" />

      <Suspense fallback={<div className="text-slate-400 text-xs">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
