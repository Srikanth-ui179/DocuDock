/**
 * DocuDock Browser-Local Encrypted Key Vault
 *
 * Implements client-side, zero-knowledge at-rest storage for AI provider API keys.
 *
 * Cryptographic Specifications:
 * - Encryption: AES-GCM 256-bit (AEAD)
 * - Initialization Vector (IV): Fresh random 96-bit (12-byte) per encryption via crypto.getRandomValues
 * - Key Derivation: PBKDF2-HMAC-SHA-256 with fresh 16-byte random salt per encryption
 * - Iterations: 600,000 (OWASP recommended standard)
 * - Storage Engine: IndexedDB (docudock_vault_db)
 * - Zero plaintext persistence: Plaintext keys and vault passwords NEVER touch disk, logs, or network requests.
 *
 * Threat Model & Security Boundaries:
 * - Protects keys at rest against local disk inspection, offline device compromise, and cross-site storage snooping.
 * - Same-Origin In-Memory Limitation: Once the vault is unlocked in an active browser tab, decrypted keys
 *   reside in volatile JavaScript memory. Browser encryption does NOT eliminate risks from same-origin XSS
 *   or malicious browser extensions with script-injection privileges on the origin.
 * - Vault automatically locks on reload and can be explicitly locked at any time to purge memory.
 */

export interface EncryptedVaultRecord {
  provider: string; // 'gemini' | 'openai' | '__vault_canary__'
  ciphertext: string; // Base64
  iv: string; // Base64 (12 bytes)
  salt: string; // Base64 (16 bytes)
  iterations: number; // 600,000
  algorithm: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA-256';
  version: 1;
  createdAt: number;
  updatedAt: number;
}

export type VaultErrorCode =
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'STORAGE_UNAVAILABLE'
  | 'INCORRECT_PASSWORD'
  | 'CORRUPT_CIPHERTEXT'
  | 'NOT_INITIALIZED'
  | 'EMPTY_KEY'
  | 'INVALID_PASSWORD';

export class VaultError extends Error {
  code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export const CANARY_IDENTIFIER = '__vault_canary__';
export const CANARY_PLAINTEXT = 'docudock-vault-v1-canary-token';
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTE_LENGTH = 16;
export const IV_BYTE_LENGTH = 12; // 96 bits standard for AES-GCM
export const DB_NAME = 'docudock_vault_db';
export const DB_VERSION = 1;
export const STORE_NAME = 'vault_records';

// --- Base64 / Binary Conversions (Cross-platform: Browser & Node.js) ---

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Environment & Cryptography Helpers ---

export function getCrypto(): Crypto {
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto as Crypto;
  }
  throw new VaultError(
    'UNSUPPORTED_ENVIRONMENT',
    'Web Crypto API is not available in the current environment.'
  );
}

export function isWebCryptoSupported(): boolean {
  try {
    const c = getCrypto();
    return Boolean(c && c.subtle && typeof c.getRandomValues === 'function');
  } catch {
    return false;
  }
}

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
  subtle?: SubtleCrypto
): Promise<CryptoKey> {
  const cryptoSubtle = subtle || getCrypto().subtle;
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const importedKey = await cryptoSubtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return cryptoSubtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    importedKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // derived key cannot be extracted
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(
  plaintext: string,
  password: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
  subtle?: SubtleCrypto,
  cryptoObj?: Crypto
): Promise<{
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
}> {
  if (!password || password.length < 6) {
    throw new VaultError('INVALID_PASSWORD', 'Vault password must be at least 6 characters.');
  }

  const c = cryptoObj || getCrypto();
  const cryptoSubtle = subtle || c.subtle;

  // Fresh random salt and IV per encryption operation
  const salt = new Uint8Array(SALT_BYTE_LENGTH);
  c.getRandomValues(salt);

  const iv = new Uint8Array(IV_BYTE_LENGTH);
  c.getRandomValues(iv);

  const derivedKey = await deriveKeyFromPassword(password, salt, iterations, cryptoSubtle);
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  const encryptedBuffer = await cryptoSubtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      tagLength: 128,
    },
    derivedKey,
    plaintextBytes
  );

  return {
    ciphertext: uint8ArrayToBase64(new Uint8Array(encryptedBuffer)),
    iv: uint8ArrayToBase64(iv),
    salt: uint8ArrayToBase64(salt),
    iterations,
  };
}

export async function decryptSecret(
  record: { ciphertext: string; iv: string; salt: string; iterations?: number },
  password: string,
  subtle?: SubtleCrypto
): Promise<string> {
  const cryptoSubtle = subtle || getCrypto().subtle;
  const saltBytes = base64ToUint8Array(record.salt);
  const ivBytes = base64ToUint8Array(record.iv);
  const ciphertextBytes = base64ToUint8Array(record.ciphertext);
  const iterations = record.iterations || DEFAULT_PBKDF2_ITERATIONS;

  try {
    const derivedKey = await deriveKeyFromPassword(password, saltBytes, iterations, cryptoSubtle);
    const decryptedBuffer = await cryptoSubtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes as BufferSource,
        tagLength: 128,
      },
      derivedKey,
      ciphertextBytes as BufferSource
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === 'OperationError' ||
        err.message.includes('operation failed') ||
        err.message.includes('decryption failed'))
    ) {
      throw new VaultError(
        'INCORRECT_PASSWORD',
        'Incorrect vault password or cryptographic integrity mismatch.'
      );
    }
    throw new VaultError(
      'CORRUPT_CIPHERTEXT',
      'Corrupt ciphertext or tampered payload: authentication tag mismatch.'
    );
  }
}

// --- Storage Engine (IndexedDB with memory-fallback interface) ---

export interface IVaultStorage {
  get(key: string): Promise<EncryptedVaultRecord | null>;
  set(record: EncryptedVaultRecord): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<EncryptedVaultRecord[]>;
  clear(): Promise<void>;
}

export class IndexedDBVaultStorage implements IVaultStorage {
  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(
          new VaultError(
            'STORAGE_UNAVAILABLE',
            'Browser IndexedDB storage is unavailable or disabled.'
          )
        );
      }

      const req = window.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'provider' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(
          new VaultError(
            'STORAGE_UNAVAILABLE',
            `IndexedDB error: ${req.error?.message || 'Access denied'}`
          )
        );
    });
  }

  async get(key: string): Promise<EncryptedVaultRecord | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => resolve((req.result as EncryptedVaultRecord) || null);
      req.onerror = () => reject(req.error);
    });
  }

  async set(record: EncryptedVaultRecord): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<EncryptedVaultRecord[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve((req.result as EncryptedVaultRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

/**
 * In-memory storage adapter for headless environments, testing, or disabled IndexedDB
 */
export class MemoryVaultStorage implements IVaultStorage {
  private map = new Map<string, EncryptedVaultRecord>();

  async get(key: string): Promise<EncryptedVaultRecord | null> {
    return this.map.get(key) || null;
  }

  async set(record: EncryptedVaultRecord): Promise<void> {
    this.map.set(record.provider, { ...record });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async getAll(): Promise<EncryptedVaultRecord[]> {
    return Array.from(this.map.values());
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

// --- High-Level Vault Manager ---

export class KeyVaultManager {
  private storage: IVaultStorage;

  constructor(storage?: IVaultStorage) {
    if (storage) {
      this.storage = storage;
    } else if (typeof window !== 'undefined' && window.indexedDB) {
      this.storage = new IndexedDBVaultStorage();
    } else {
      this.storage = new MemoryVaultStorage();
    }
  }

  /**
   * Checks if an encrypted vault has already been created/configured in storage.
   */
  async isVaultConfigured(): Promise<boolean> {
    const canary = await this.storage.get(CANARY_IDENTIFIER);
    return canary !== null;
  }

  /**
   * Initializes a new vault with the given password by storing an encrypted canary token.
   */
  async initializeVault(password: string): Promise<void> {
    if (!password || password.length < 6) {
      throw new VaultError('INVALID_PASSWORD', 'Vault password must be at least 6 characters.');
    }

    const encrypted = await encryptSecret(CANARY_PLAINTEXT, password);
    const now = Date.now();
    const record: EncryptedVaultRecord = {
      provider: CANARY_IDENTIFIER,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: encrypted.salt,
      iterations: encrypted.iterations,
      algorithm: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA-256',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.set(record);
  }

  /**
   * Verifies whether the provided password correctly unlocks the vault canary.
   */
  async verifyPassword(password: string): Promise<boolean> {
    const canary = await this.storage.get(CANARY_IDENTIFIER);
    if (!canary) {
      throw new VaultError('NOT_INITIALIZED', 'Vault has not been created yet.');
    }

    try {
      const plaintext = await decryptSecret(canary, password);
      return plaintext === CANARY_PLAINTEXT;
    } catch (err: unknown) {
      if (err instanceof VaultError && err.code === 'INCORRECT_PASSWORD') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Unlocks all provider keys in the vault using the user password.
   * Throws VaultError('INCORRECT_PASSWORD') if password is invalid.
   */
  async unlockAllKeys(password: string): Promise<Record<string, string>> {
    const isConfigured = await this.isVaultConfigured();
    if (!isConfigured) {
      throw new VaultError('NOT_INITIALIZED', 'Vault is not configured.');
    }

    // Step 1: Prove password validity with canary token
    const isPwValid = await this.verifyPassword(password);
    if (!isPwValid) {
      throw new VaultError('INCORRECT_PASSWORD', 'Incorrect vault password. Please try again.');
    }

    // Step 2: Decrypt all provider records
    const allRecords = await this.storage.getAll();
    const decryptedKeys: Record<string, string> = {};

    for (const record of allRecords) {
      if (record.provider === CANARY_IDENTIFIER) continue;
      try {
        const decryptedKey = await decryptSecret(record, password);
        decryptedKeys[record.provider] = decryptedKey;
      } catch {
        // If canary verified but provider record fails, provider record is corrupted
        throw new VaultError(
          'CORRUPT_CIPHERTEXT',
          `Vault record for provider "${record.provider}" is corrupted or has been tampered with.`
        );
      }
    }

    return decryptedKeys;
  }

  /**
   * Encrypts and saves or updates an API key for a specific provider.
   * If the vault is not yet configured, automatically initializes it using the password.
   */
  async saveKey(provider: string, apiKey: string, password: string): Promise<void> {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      throw new VaultError('EMPTY_KEY', 'API key cannot be empty.');
    }
    if (!password || password.length < 6) {
      throw new VaultError('INVALID_PASSWORD', 'Vault password must be at least 6 characters.');
    }

    const isConfigured = await this.isVaultConfigured();
    if (!isConfigured) {
      await this.initializeVault(password);
    } else {
      const isValid = await this.verifyPassword(password);
      if (!isValid) {
        throw new VaultError('INCORRECT_PASSWORD', 'Incorrect vault password.');
      }
    }

    const existing = await this.storage.get(provider);
    const encrypted = await encryptSecret(cleanKey, password);
    const now = Date.now();

    const record: EncryptedVaultRecord = {
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: encrypted.salt,
      iterations: encrypted.iterations,
      algorithm: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA-256',
      version: 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await this.storage.set(record);
  }

  /**
   * Deletes a specific provider key from the encrypted vault.
   */
  async deleteKey(provider: string): Promise<void> {
    await this.storage.delete(provider);
  }

  /**
   * Retrieves non-secret metadata about the vault and saved provider slots.
   */
  async getMetadata(): Promise<{
    isConfigured: boolean;
    savedProviders: Array<{ provider: string; updatedAt: number }>;
  }> {
    const isConfigured = await this.isVaultConfigured();
    if (!isConfigured) {
      return { isConfigured: false, savedProviders: [] };
    }

    const records = await this.storage.getAll();
    const savedProviders = records
      .filter((r) => r.provider !== CANARY_IDENTIFIER)
      .map((r) => ({
        provider: r.provider,
        updatedAt: r.updatedAt,
      }));

    return {
      isConfigured: true,
      savedProviders,
    };
  }

  /**
   * Resets the entire vault, purging all keys and canary tokens from local storage.
   */
  async resetVault(): Promise<void> {
    await this.storage.clear();
  }
}

// Default singleton instance for app-wide use
let defaultVaultManager: KeyVaultManager | null = null;

export function getVaultManager(): KeyVaultManager {
  if (!defaultVaultManager) {
    defaultVaultManager = new KeyVaultManager();
  }
  return defaultVaultManager;
}
