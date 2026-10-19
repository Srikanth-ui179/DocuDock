'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AIProvider } from '@/lib/types';
import { testProviderConnection, ProviderError } from '@/lib/ai/providers';

interface ProviderKeyContextType {
  provider: AIProvider;
  apiKey: string;
  isConnected: boolean;
  isTesting: boolean;
  error: string | null;
  setProvider: (provider: AIProvider) => void;
  setApiKeyInput: (key: string) => void;
  apiKeyInput: string;
  connectKey: (providerToConnect?: AIProvider, keyToConnect?: string) => Promise<boolean>;
  disconnect: () => void;
  clearError: () => void;
}

const ProviderKeyContext = createContext<ProviderKeyContextType | undefined>(undefined);

export function ProviderKeyProvider({ children }: { children: ReactNode }) {
  // Pure in-memory state: Never synced to localStorage, sessionStorage, cookies, or remote DB
  const [provider, setProviderState] = useState<AIProvider>('gemini');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const setProvider = useCallback((newProvider: AIProvider) => {
    setProviderState(newProvider);
    // If switching provider, reset connection status so user connects the new key
    if (newProvider !== provider) {
      setIsConnected(false);
      setApiKey('');
      setApiKeyInput('');
      setError(null);
    }
  }, [provider]);

  const disconnect = useCallback(() => {
    // Explicit purge from memory
    setApiKey('');
    setApiKeyInput('');
    setIsConnected(false);
    setError(null);
  }, []);

  const connectKey = useCallback(
    async (providerToConnect?: AIProvider, keyToConnect?: string): Promise<boolean> => {
      const activeProvider = providerToConnect || provider;
      const targetKey = (keyToConnect !== undefined ? keyToConnect : apiKeyInput).trim();

      if (!targetKey) {
        setError('Please enter a valid API key.');
        return false;
      }

      setIsTesting(true);
      setError(null);

      try {
        await testProviderConnection(activeProvider, targetKey);
        setApiKey(targetKey);
        setProviderState(activeProvider);
        setIsConnected(true);
        setIsTesting(false);
        return true;
      } catch (err: unknown) {
        setIsConnected(false);
        setIsTesting(false);
        if (err instanceof ProviderError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to verify API key. Please check key validity and network connection.');
        }
        return false;
      }
    },
    [provider, apiKeyInput]
  );

  return (
    <ProviderKeyContext.Provider
      value={{
        provider,
        apiKey,
        apiKeyInput,
        setApiKeyInput,
        isConnected,
        isTesting,
        error,
        setProvider,
        connectKey,
        disconnect,
        clearError,
      }}
    >
      {children}
    </ProviderKeyContext.Provider>
  );
}

export function useProviderKey() {
  const context = useContext(ProviderKeyContext);
  if (!context) {
    throw new Error('useProviderKey must be used within a ProviderKeyProvider');
  }
  return context;
}
