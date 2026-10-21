import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Module-level singleton instance for browser environment
let browserClient: SupabaseClient | undefined;

/**
 * Returns a Supabase client configured for the browser.
 * Reuses a single client instance in the browser to prevent multiple concurrent
 * token refresh tickers, race conditions, or uncoordinated cookie writes.
 */
export function createClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase URL or Anon Key is missing. Check your environment variables.');
  }

  // If executing in a non-browser environment (SSR/build), return a fresh client
  if (typeof window === 'undefined') {
    return createBrowserClient(
      supabaseUrl || 'https://placeholder-url.supabase.co',
      supabaseAnonKey || 'placeholder-anon-key'
    );
  }

  // In the browser, maintain a single client instance
  if (!browserClient) {
    browserClient = createBrowserClient(
      supabaseUrl || 'https://placeholder-url.supabase.co',
      supabaseAnonKey || 'placeholder-anon-key',
      {
        isSingleton: true,
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  return browserClient;
}
