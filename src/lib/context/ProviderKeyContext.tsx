'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { AIProvider } from '@/lib/types';
import { testProviderConnection, ProviderError } from '@/lib/ai/providers';
import { invalidateModelCache } from '@/lib/ai/modelCache';
import {
  getVaultManager,
  isWebCryptoSupported,
  VaultError,
} from '@/lib/vault/keyVault';

interface ProviderKeyContextType {
  // Ephemeral In-Memory State
  provider: AIProvider;
  apiKey: string;
  isConnected: boolean;
  isTesting: boolean;
  error: string | null;
  apiKeyInput: string;
  setProvider: (provider: AIProvider) => void;
  setApiKeyInput: (key: string) => void;
  connectKey: (providerToConnect?: AIProvider, keyToConnect?: string) => Promise<boolean>;
  disconnect: () => void;
  clearError: () => void;

  // Browser-Local Encrypted Key Vault State
  isVaultSupported: boolean;
  isVaultConfigured: boolean;
  isVaultLocked: boolean;
  isVaultLoading: boolean;
  vaultSavedProviders: AIProvider[];
  vaultUnlockedKeys: Partial<Record<AIProvider, string>>;

  // Vault Actions
  unlockVault: (password: string) => Promise<boolean>;
  lockVault: () => void;
  saveKeyToVault: (
    providerToSave: AIProvider,
    keyToSave: string,
    password: string
  ) => Promise<boolean>;
  deleteKeyFromVault: (providerToDelete: AIProvider) => Promise<boolean>;
  resetVault: () => Promise<boolean>;
  refreshVaultStatus: () => Promise<void>;
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

  // Encrypted Vault State (At-rest IndexedDB + In-Memory unlocked keys)
  const [isVaultSupported] = useState<boolean>(() => isWebCryptoSupported());
  const [isVaultConfigured, setIsVaultConfigured] = useState<boolean>(false);
  const [isVaultLocked, setIsVaultLocked] = useState<boolean>(true);
  const [isVaultLoading, setIsVaultLoading] = useState<boolean>(false);
  const [vaultSavedProviders, setVaultSavedProviders] = useState<AIProvider[]>([]);
  const [vaultUnlockedKeys, setVaultUnlockedKeys] = useState<Partial<Record<AIProvider, string>>>({});

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const refreshVaultStatus = useCallback(async () => {
    if (!isWebCryptoSupported()) {
      return;
    }
    try {
      const manager = getVaultManager();
      const meta = await manager.getMetadata();
      setIsVaultConfigured(meta.isConfigured);
      setVaultSavedProviders(meta.savedProviders.map((p) => p.provider as AIProvider));
    } catch {
      // Storage unavailable or blocked
      setIsVaultConfigured(false);
      setVaultSavedProviders([]);
    }
  }, []);

  // Check vault status on mount (vault always starts LOCKED on fresh load)
  useEffect(() => {
    let ignore = false;

    if (!isWebCryptoSupported()) {
      return;
    }

    getVaultManager()
      .getMetadata()
      .then((meta) => {
        if (ignore) return;
        setIsVaultConfigured(meta.isConfigured);
        setVaultSavedProviders(meta.savedProviders.map((p) => p.provider as AIProvider));
      })
      .catch(() => {
        if (ignore) return;
        setIsVaultConfigured(false);
        setVaultSavedProviders([]);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const disconnect = useCallback(() => {
    // Explicit purge of active key from memory and invalidate model cache
    invalidateModelCache('gemini');
    setApiKey('');
    setApiKeyInput('');
    setIsConnected(false);
    setError(null);
  }, []);

  const connectKey = useCallback(
    async (providerToConnect?: AIProvider, keyToConnect?: string): Promise<boolean> => {
      const targetProvider = providerToConnect || provider;
      let targetKey = (keyToConnect !== undefined ? keyToConnect : apiKeyInput).trim();
      if (!targetKey && targetProvider === 'mock') {
        targetKey = 'mock-key';
      }

      if (!targetKey) {
        setError('Please enter a valid API key.');
        return false;
      }

      setIsTesting(true);
      setError(null);

      try {
        await testProviderConnection(targetProvider, targetKey);
        setApiKey(targetKey);
        setProviderState(targetProvider);
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

  const setProvider = useCallback(
    (newProvider: AIProvider) => {
      setProviderState(newProvider);
      // Invalidate cache when changing provider
      invalidateModelCache('gemini');

      // If switching provider, check if we have an unlocked key for the new provider
      const unlockedKey = vaultUnlockedKeys[newProvider];
      if (unlockedKey) {
        setApiKeyInput(unlockedKey);
        connectKey(newProvider, unlockedKey);
      } else {
        setIsConnected(false);
        setApiKey('');
        setApiKeyInput('');
        setError(null);
      }
    },
    [vaultUnlockedKeys, connectKey]
  );

  // Vault Operation: Unlock
  const unlockVault = useCallback(
    async (password: string): Promise<boolean> => {
      if (!isWebCryptoSupported()) {
        setError('Web Crypto API is not supported in this browser.');
        return false;
      }
      setIsVaultLoading(true);
      setError(null);

      try {
        const manager = getVaultManager();
        const decrypted = await manager.unlockAllKeys(password);
        setVaultUnlockedKeys(decrypted as Partial<Record<AIProvider, string>>);
        setIsVaultLocked(false);
        setIsVaultLoading(false);

        // If current provider has a key in decrypted vault, connect it automatically
        const currentProviderKey = decrypted[provider];
        if (currentProviderKey) {
          setApiKeyInput(currentProviderKey);
          await connectKey(provider, currentProviderKey);
        }

        return true;
      } catch (err: unknown) {
        setIsVaultLoading(false);
        if (err instanceof VaultError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to unlock key vault.');
        }
        return false;
      }
    },
    [provider, connectKey]
  );

  // Vault Operation: Lock (Purges memory references)
  const lockVault = useCallback(() => {
    // Purge in-memory decrypted keys
    setVaultUnlockedKeys({});
    setIsVaultLocked(true);

    // Disconnect active session key and invalidate cache
    invalidateModelCache('gemini');
    setApiKey('');
    setApiKeyInput('');
    setIsConnected(false);
    setError(null);
  }, []);

  // Vault Operation: Save or Replace Key
  const saveKeyToVault = useCallback(
    async (
      providerToSave: AIProvider,
      keyToSave: string,
      password: string
    ): Promise<boolean> => {
      if (!isWebCryptoSupported()) {
        setError('Web Crypto API is not supported in this browser.');
        return false;
      }
      setIsVaultLoading(true);
      setError(null);

      try {
        const manager = getVaultManager();
        await manager.saveKey(providerToSave, keyToSave, password);

        // Update in-memory state
        setVaultUnlockedKeys((prev) => ({ ...prev, [providerToSave]: keyToSave }));
        setIsVaultConfigured(true);
        setIsVaultLocked(false);
        setIsVaultLoading(false);

        await refreshVaultStatus();

        // Connect the newly saved key if active provider matches
        if (providerToSave === provider) {
          setApiKeyInput(keyToSave);
          await connectKey(providerToSave, keyToSave);
        }

        return true;
      } catch (err: unknown) {
        setIsVaultLoading(false);
        if (err instanceof VaultError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to save API key to vault.');
        }
        return false;
      }
    },
    [provider, connectKey, refreshVaultStatus]
  );

  // Vault Operation: Delete Key
  const deleteKeyFromVault = useCallback(
    async (providerToDelete: AIProvider): Promise<boolean> => {
      try {
        const manager = getVaultManager();
        await manager.deleteKey(providerToDelete);

        // Remove from memory
        setVaultUnlockedKeys((prev) => {
          const next = { ...prev };
          delete next[providerToDelete];
          return next;
        });

        await refreshVaultStatus();

        if (providerToDelete === provider) {
          disconnect();
        }

        return true;
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        }
        return false;
      }
    },
    [provider, disconnect, refreshVaultStatus]
  );

  // Vault Operation: Reset Vault
  const resetVault = useCallback(async (): Promise<boolean> => {
    try {
      const manager = getVaultManager();
      await manager.resetVault();
      setVaultUnlockedKeys({});
      setIsVaultConfigured(false);
      setIsVaultLocked(true);
      setVaultSavedProviders([]);
      disconnect();
      return true;
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
      return false;
    }
  }, [disconnect]);

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
        isVaultSupported,
        isVaultConfigured,
        isVaultLocked,
        isVaultLoading,
        vaultSavedProviders,
        vaultUnlockedKeys,
        unlockVault,
        lockVault,
        saveKeyToVault,
        deleteKeyFromVault,
        resetVault,
        refreshVaultStatus,
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
