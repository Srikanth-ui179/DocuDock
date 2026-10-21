import type { AIProvider, ProviderErrorType } from '../types';

export type ProviderErrorKind = ProviderErrorType;

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  isRetryable: boolean;
  userMessage: string;
  suggestedAction: 'retry' | 'switch_model' | 'reconnect_key' | 'check_network' | 'none';
  sanitizedDetails?: string;
}

export const KNOWN_VALID_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-001',
  'gemini-3.8-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.5-flash-latest',
  'gemini-3.5-flash-001',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash-lite-latest',
  'gemini-3.5-flash-lite-001',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-latest',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-1.5-pro-001',
  'gemini-1.5-pro-002',
];

export const GEMINI_TEXT_MODEL_PREFERENCE_HIERARCHY = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
];

export const GEMINI_EMBEDDING_MODEL_PREFERENCE_HIERARCHY = [
  'text-embedding-004',
  'gemini-embedding-001',
  'embedding-001',
];

/**
 * Returns all direct alias and versioned variants for a model family.
 * Ensures that if an overloaded or unavailable model fails,
 * failover excludes all variants of the same family rather than hitting the same backend cluster.
 */
export function getGeminiModelFamilyAliases(model: string): string[] {
  const clean = model.trim().replace(/^models\//, '').toLowerCase();
  if (clean.includes('3.8-flash')) {
    return [
      'gemini-3.8-flash',
      'gemini-3.8-flash-latest',
      'gemini-3.8-flash-001',
    ];
  }
  if (clean.includes('3.5-flash-lite')) {
    return [
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash-lite-latest',
      'gemini-3.5-flash-lite-001',
    ];
  }
  if (clean.includes('3.5-flash')) {
    return [
      'gemini-3.5-flash',
      'gemini-3.5-flash-latest',
      'gemini-3.5-flash-001',
    ];
  }
  if (clean.includes('3.1-flash-lite')) {
    return [
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite-latest',
    ];
  }
  if (clean.includes('2.5-flash')) {
    return [
      'gemini-2.5-flash',
      'gemini-2.5-flash-latest',
      'gemini-2.5-flash-preview',
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.5-flash-preview-09-2025',
      'gemini-2.5-flash-001',
    ];
  }
  if (clean.includes('2.0-flash-lite')) {
    return [
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash-lite-001',
      'gemini-2.0-flash-lite-preview',
      'gemini-2.0-flash-lite-preview-02-05',
    ];
  }
  if (clean.includes('2.0-flash')) {
    return [
      'gemini-2.0-flash',
      'gemini-2.0-flash-001',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-latest',
    ];
  }
  if (clean.includes('1.5-flash-8b')) {
    return [
      'gemini-1.5-flash-8b',
      'gemini-1.5-flash-8b-latest',
      'gemini-1.5-flash-8b-001',
    ];
  }
  if (clean.includes('1.5-flash')) {
    return [
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-001',
      'gemini-1.5-flash-002',
    ];
  }
  if (clean.includes('2.5-pro')) {
    return [
      'gemini-2.5-pro',
      'gemini-2.5-pro-latest',
      'gemini-2.5-pro-preview',
      'gemini-2.5-pro-preview-05-06',
    ];
  }
  if (clean.includes('1.5-pro')) {
    return [
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro-001',
      'gemini-1.5-pro-002',
    ];
  }
  return [clean];
}

// In-memory negative cache tracking models that recently returned HTTP 503 / overloaded
const overloadedModelCooldowns = new Map<string, number>();
export const DEFAULT_OVERLOAD_COOLDOWN_MS = 60_000; // 60 seconds

export function recordOverloadedModel(model: string, cooldownMs = DEFAULT_OVERLOAD_COOLDOWN_MS): void {
  const clean = model.trim().replace(/^models\//, '').toLowerCase();
  const expiresAt = Date.now() + cooldownMs;
  for (const alias of getGeminiModelFamilyAliases(clean)) {
    overloadedModelCooldowns.set(alias.toLowerCase(), expiresAt);
  }
}

export function isModelOverloaded(model: string): boolean {
  const clean = model.trim().replace(/^models\//, '').toLowerCase();
  const expiresAt = overloadedModelCooldowns.get(clean);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    overloadedModelCooldowns.delete(clean);
    return false;
  }
  return true;
}

export function getCurrentlyOverloadedModels(): string[] {
  const now = Date.now();
  const result: string[] = [];
  for (const [model, expiresAt] of overloadedModelCooldowns.entries()) {
    if (now <= expiresAt) {
      result.push(model);
    } else {
      overloadedModelCooldowns.delete(model);
    }
  }
  return result;
}

export function clearOverloadedModels(): void {
  overloadedModelCooldowns.clear();
}

// In-memory negative cache tracking models that are unavailable for this API key / session (HTTP 404, deprecated, or restricted access)
const unavailableModels = new Set<string>();

export function recordUnavailableModel(model: string): void {
  const clean = model.trim().replace(/^models\//, '').toLowerCase();
  unavailableModels.add(clean);
  for (const alias of getGeminiModelFamilyAliases(clean)) {
    unavailableModels.add(alias.toLowerCase());
  }
}

export function isModelUnavailable(model: string): boolean {
  const clean = model.trim().replace(/^models\//, '').toLowerCase();
  return unavailableModels.has(clean);
}

export function clearUnavailableModels(): void {
  unavailableModels.clear();
}

export function getCurrentlyUnavailableModels(): string[] {
  return Array.from(unavailableModels);
}

export interface GeminiModelMetadata {
  name: string;
  baseModelId?: string;
  version?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  outputModalities?: string[];
  responseModalities?: string[];
  supportedOutputModalities?: string[];
  supportedResponseModalities?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/**
 * Evaluates whether a Gemini model supports standard text generation,
 * validating both capability metadata (supportedGenerationMethods, output modalities)
 * and model naming patterns.
 *
 * Strictly excludes:
 * - Text-To-Speech (TTS), speech, or audio-output models (e.g. gemini-2.5-flash-preview-tts)
 * - Audio-only or realtime bidirectional streaming audio models
 * - Embedding-only models (e.g. text-embedding-004, gemini-embedding-001)
 * - Image-only or video generation models (e.g. imagen, veo)
 * - Deprecated or 1.0 models
 */
export function isCompatibleGeminiTextModel(
  modelOrName: string | GeminiModelMetadata,
  metadata?: Partial<GeminiModelMetadata>
): boolean {
  const modelName = typeof modelOrName === 'string' ? modelOrName : modelOrName?.name;
  const meta: Partial<GeminiModelMetadata> =
    typeof modelOrName === 'string' ? (metadata || {}) : (modelOrName || {});

  if (!modelName || typeof modelName !== 'string') return false;
  const clean = modelName.trim().replace(/^models\//, '');
  const cleanLower = clean.toLowerCase();

  // 1. Validate capability metadata if available
  // If supportedGenerationMethods is present, it MUST include 'generateContent'
  if (meta.supportedGenerationMethods && Array.isArray(meta.supportedGenerationMethods)) {
    if (!meta.supportedGenerationMethods.includes('generateContent')) {
      return false;
    }
  }

  // Inspect output/response modalities if declared in metadata
  const declaredOutputModalities =
    meta.outputModalities ||
    meta.responseModalities ||
    meta.supportedOutputModalities ||
    meta.supportedResponseModalities;

  if (Array.isArray(declaredOutputModalities) && declaredOutputModalities.length > 0) {
    const normalized = declaredOutputModalities.map((m) => String(m).trim().toUpperCase());
    // If output modalities are declared, TEXT must be present
    if (!normalized.includes('TEXT')) {
      return false;
    }
    // If output modalities only consist of non-text formats (AUDIO, IMAGE, VIDEO), reject
    if (normalized.every((m) => m === 'AUDIO' || m === 'IMAGE' || m === 'VIDEO')) {
      return false;
    }
  }

  // 2. Reject incompatible model types by identifier patterns
  // Check for audio, speech, TTS, voice, realtime, live, transcribe
  if (
    cleanLower.includes('tts') ||
    cleanLower.includes('audio') ||
    cleanLower.includes('speech') ||
    cleanLower.includes('voice') ||
    cleanLower.includes('realtime') ||
    cleanLower.includes('live') ||
    cleanLower.includes('transcribe')
  ) {
    return false;
  }

  // Check for embedding / retrieval
  if (
    cleanLower.includes('embedding') ||
    cleanLower.includes('embed') ||
    cleanLower.includes('gecko') ||
    cleanLower.includes('aqa') ||
    cleanLower.includes('retrieval')
  ) {
    return false;
  }

  // Check for image / video generation
  if (
    cleanLower.includes('imagen') ||
    cleanLower.includes('veo') ||
    cleanLower.includes('image') ||
    cleanLower.includes('video') ||
    cleanLower.includes('omni')
  ) {
    return false;
  }

  // Check for deprecated or legacy 1.0
  if (cleanLower.includes('deprecated') || cleanLower.includes('1.0')) {
    return false;
  }

  // Reject legacy/restricted 2.5 models that Google blocks for new users (returns 404)
  if (
    cleanLower.includes('2.5') ||
    cleanLower.includes('customtools')
  ) {
    return false;
  }

  // 3. Known valid text generation models
  if (KNOWN_VALID_GEMINI_MODELS.map((m) => m.toLowerCase()).includes(cleanLower)) {
    return true;
  }

  // 4. Dynamic active general Gemini text models
  if (cleanLower.startsWith('gemini-')) {
    return true;
  }

  return false;
}

/**
 * Evaluates whether a Gemini model is a dedicated embedding model,
 * validating both capability metadata and naming conventions.
 */
export function isCompatibleGeminiEmbeddingModel(
  modelOrName: string | GeminiModelMetadata,
  metadata?: Partial<GeminiModelMetadata>
): boolean {
  const modelName = typeof modelOrName === 'string' ? modelOrName : modelOrName?.name;
  const meta: Partial<GeminiModelMetadata> =
    typeof modelOrName === 'string' ? (metadata || {}) : (modelOrName || {});

  if (!modelName || typeof modelName !== 'string') return false;
  const clean = modelName.trim().replace(/^models\//, '');
  const cleanLower = clean.toLowerCase();

  // If supportedGenerationMethods is present, it MUST include embedContent or batchEmbedContents
  if (meta.supportedGenerationMethods && Array.isArray(meta.supportedGenerationMethods)) {
    const hasEmbed =
      meta.supportedGenerationMethods.includes('embedContent') ||
      meta.supportedGenerationMethods.includes('batchEmbedContents');
    if (!hasEmbed) {
      return false;
    }
  }

  // Must not be a chat / generation-only or audio/tts/live/image/video model
  if (
    cleanLower.includes('tts') ||
    cleanLower.includes('audio') ||
    cleanLower.includes('speech') ||
    cleanLower.includes('voice') ||
    cleanLower.includes('realtime') ||
    cleanLower.includes('live') ||
    cleanLower.includes('transcribe') ||
    cleanLower.includes('imagen') ||
    cleanLower.includes('veo') ||
    cleanLower.includes('image') ||
    cleanLower.includes('video') ||
    cleanLower.includes('omni')
  ) {
    return false;
  }

  // Must match embedding model patterns
  if (
    cleanLower.includes('embedding') ||
    cleanLower.includes('embed') ||
    cleanLower.includes('gecko')
  ) {
    return true;
  }

  return false;
}

/**
 * Validates that a model ID is a supported, known-active text model for Gemini.
 */
export function isSupportedGeminiModel(modelName: string): boolean {
  return isCompatibleGeminiTextModel(modelName);
}

/**
 * Strips API keys and sensitive tokens from error messages and logs.
 */
export function sanitizeErrorMessage(message: string, apiKey?: string): string {
  let clean = message || '';
  if (apiKey && apiKey.length > 6) {
    clean = clean.replaceAll(apiKey, '[REDACTED_API_KEY]');
  }
  // Sanitize query parameter keys: ?key=... or &key=...
  clean = clean.replace(/([?&]key=)[^& \t\r\n"'>]+/gi, '$1[REDACTED_API_KEY]');
  // Sanitize Authorization header tokens: Bearer ...
  clean = clean.replace(/(Bearer\s+)[^ \t\r\n"'>]+/gi, '$1[REDACTED_API_KEY]');
  // Sanitize standard Google AI Studio keys (AIza...)
  clean = clean.replace(/AIza[A-Za-z0-9_-]{30,40}/g, '[REDACTED_API_KEY]');
  // Sanitize standard OpenAI keys (sk-...)
  clean = clean.replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  return clean;
}

/**
 * Creates a lightweight non-reversible hash of an API key for safe caching.
 * NEVER stores or exposes the raw API key.
 */
export function hashApiKey(apiKey: string): string {
  const clean = apiKey.trim();
  if (!clean) return 'empty';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  const prefix = clean.slice(0, 3);
  const suffix = clean.slice(-3);
  return `fp_${prefix}_${Math.abs(hash).toString(36)}_${suffix}`;
}

const SESSION_STORAGE_KEY = 'docudock_verified_chat_model_cache';

// In-memory cache for fastest access within the same tab lifecycle
const inMemoryModelCache = new Map<string, { model: string; timestamp: number }>();

function getSessionStorageSafe(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Retrieves the cached working chat model for the current browser session and key.
 * Verifies that the model is actually supported before returning.
 */
export function getCachedChatModel(provider: AIProvider, apiKey: string): string | null {
  if (provider !== 'gemini') return null;
  const fp = hashApiKey(apiKey);

  // 1. Check in-memory cache
  const mem = inMemoryModelCache.get(fp);
  if (mem && mem.model) {
    if (isSupportedGeminiModel(mem.model) && !isModelUnavailable(mem.model)) {
      return mem.model;
    }
    // Stale/unsupported/unavailable model in cache, purge it
    inMemoryModelCache.delete(fp);
  }

  // 2. Check sessionStorage
  const storage = getSessionStorageSafe();
  if (storage) {
    try {
      const raw = storage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed[fp]?.model) {
          const model = parsed[fp].model;
          if (isSupportedGeminiModel(model) && !isModelUnavailable(model)) {
            inMemoryModelCache.set(fp, { model, timestamp: parsed[fp].timestamp || Date.now() });
            return model;
          }
          // Unsupported/unavailable model stored, remove this key entry
          delete parsed[fp];
          storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(parsed));
        }
      }
    } catch {
      // ignore parsing error
    }
  }

  return null;
}

/**
 * Caches a verified working chat model for this session and key fingerprint.
 */
export function setCachedChatModel(provider: AIProvider, apiKey: string, model: string): void {
  if (provider !== 'gemini' || !model || !isSupportedGeminiModel(model) || isModelUnavailable(model)) return;
  const fp = hashApiKey(apiKey);
  const now = Date.now();

  inMemoryModelCache.set(fp, { model, timestamp: now });

  const storage = getSessionStorageSafe();
  if (storage) {
    try {
      let store: Record<string, { model: string; timestamp: number }> = {};
      const raw = storage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        store = JSON.parse(raw) || {};
      }
      store[fp] = { model, timestamp: now };
      storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(store));
    } catch {
      // ignore storage error
    }
  }
}

/**
 * Invalidates the cached model for a provider/key when a model fails or key changes.
 */
export function invalidateModelCache(provider: AIProvider, apiKey?: string): void {
  if (provider !== 'gemini') return;

  if (apiKey) {
    const fp = hashApiKey(apiKey);
    inMemoryModelCache.delete(fp);
    invalidateDiscoveredModelsCache(fp);
    const storage = getSessionStorageSafe();
    if (storage) {
      try {
        const raw = storage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
          const store = JSON.parse(raw) || {};
          delete store[fp];
          storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(store));
        }
      } catch {
        // ignore
      }
    }
  } else {
    inMemoryModelCache.clear();
    clearDiscoveredModelsCache();
    clearUnavailableModels();
    const storage = getSessionStorageSafe();
    if (storage) {
      try {
        storage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Strips repeated error wrappers and extracts clean raw provider detail.
 * Ensures classifyProviderError is 100% idempotent and avoids nested duplicate messages.
 */
export function extractCleanProviderDetails(rawMessage: string): string {
  if (!rawMessage) return '';
  let clean = rawMessage.trim();

  // If this message already contains an earlier wrapped user message,
  // extract the nested detail from parentheses if present.
  const parenthesizedDetailMatch = clean.match(/(?:from the provider|API version|this API key|text generation responses|HTTP \d+)\s*\(([^()]+)\)/i);
  if (parenthesizedDetailMatch && parenthesizedDetailMatch[1]) {
    clean = parenthesizedDetailMatch[1].trim();
  }

  // Strip known boilerplate prefixes/suffixes if present
  clean = clean.replace(/^This model is currently experiencing high demand from the provider/i, '');
  clean = clean.replace(/Please click Retry to send the request again or try an alternative model\.?$/i, '');
  clean = clean.replace(/^The requested model was not found or is no longer available for this API version/i, '');
  clean = clean.replace(/^The requested model \([^()]+\) is not accessible for this API key/i, '');
  clean = clean.replace(/Re-discovering an active model for your key\.\.\.?\s*Please click Retry if the issue persists or choose another model\.?$/i, '');
  clean = clean.replace(/^The selected AI model does not support text generation responses/i, '');
  clean = clean.replace(/Re-discovering a compatible text model\.\.\.?\s*Please click Retry or select a standard text generation model\.?$/i, '');

  clean = clean.trim();
  while (clean.startsWith('(') && clean.endsWith(')')) {
    clean = clean.slice(1, -1).trim();
  }

  const lower = clean.toLowerCase();
  if (
    !clean ||
    lower === '503' ||
    lower === 'http 503' ||
    lower === '404' ||
    lower === 'http 404' ||
    lower === 'service unavailable'
  ) {
    return '';
  }

  return clean;
}

/**
 * Classifies HTTP status codes and error messages into distinct operational categories.
 * Provides clear, actionable messages that never falsely claim keys are invalid.
 */
export function classifyProviderError(
  errorOrStatusCode?: number | unknown,
  rawMessage = ''
): ProviderErrorClassification {
  const safeMessage = sanitizeErrorMessage(rawMessage);
  let statusCode: number | undefined;
  let msg = '';

  if (typeof errorOrStatusCode === 'number') {
    statusCode = errorOrStatusCode;
    msg = safeMessage.toLowerCase();
  } else if (errorOrStatusCode instanceof Error) {
    statusCode = (errorOrStatusCode as { statusCode?: number }).statusCode;
    msg = `${sanitizeErrorMessage(errorOrStatusCode.message)} ${safeMessage}`.toLowerCase();
  } else if (typeof errorOrStatusCode === 'string') {
    msg = `${sanitizeErrorMessage(errorOrStatusCode)} ${safeMessage}`.toLowerCase();
  } else {
    msg = safeMessage.toLowerCase();
  }

  // 1. Invalid / Unauthorized Key (401, 403, or specific API key phrases)
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('invalid api key') ||
    msg.includes('permission denied') ||
    msg.includes('unauthorized') ||
    (msg.includes('400') && (msg.includes('api key') || msg.includes('key')))
  ) {
    return {
      kind: 'invalid_key',
      isRetryable: false,
      userMessage: 'Your AI provider API key is invalid or unauthorized. Please verify your selected provider and enter a valid API key in Settings.',
      suggestedAction: 'reconnect_key',
      sanitizedDetails: safeMessage,
    };
  }

  // 2. High Demand / Overloaded Model (Gemini 503 / 429 with specific high-demand phrases)
  if (
    msg.includes('high demand') ||
    msg.includes('currently experiencing high demand') ||
    msg.includes('model is overloaded') ||
    msg.includes('service unavailable') ||
    msg.includes('temporarily unavailable') ||
    statusCode === 503
  ) {
    const cleanDetail = extractCleanProviderDetails(safeMessage);
    const detailSuffix = cleanDetail ? ` (${cleanDetail})` : '';
    return {
      kind: 'overloaded',
      isRetryable: true,
      userMessage: `This model is currently experiencing high demand from the provider${detailSuffix}. Please click Retry to send the request again or try an alternative model.`,
      suggestedAction: 'switch_model',
      sanitizedDetails: cleanDetail || safeMessage,
    };
  }

  // 3. Quota Exhaustion (hard 429 quota exhaustion)
  if (
    msg.includes('quota exceeded') ||
    msg.includes('quota exhausted') ||
    msg.includes('quota has been exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('exhausted resource') ||
    msg.includes('insufficient_quota') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('check quota') ||
    msg.includes('rate limit exceeded')
  ) {
    return {
      kind: 'quota_exhausted',
      isRetryable: false,
      userMessage: 'Your AI provider quota has been exhausted. Please verify your account usage and plan limits in Google AI Studio or OpenAI dashboard, or wait before retrying.',
      suggestedAction: 'retry',
      sanitizedDetails: safeMessage,
    };
  }

  // 4. Rate Limit (transient 429 rate limit)
  if (statusCode === 429 || msg.includes('429') || msg.includes('too many requests')) {
    return {
      kind: 'rate_limit',
      isRetryable: true,
      userMessage: 'Provider rate limit reached (429). Please wait a moment before trying again, or check your rate limits in your provider dashboard.',
      suggestedAction: 'retry',
      sanitizedDetails: safeMessage,
    };
  }

  // 5. Safety / Policy / Blocked
  if (
    msg.includes('safety') ||
    msg.includes('recitation') ||
    msg.includes('blocklist') ||
    msg.includes('prohibited_content') ||
    msg.includes('content safety') ||
    msg.includes('content_filter') ||
    msg.includes('spii') ||
    msg.includes('blocked the prompt') ||
    msg.includes('policy filter')
  ) {
    return {
      kind: 'blocked',
      isRetryable: false,
      userMessage: 'The AI model blocked this response due to content safety or policy restrictions. Please try rephrasing your research question or selecting another document passage.',
      suggestedAction: 'none',
      sanitizedDetails: safeMessage,
    };
  }

  // 6. Empty / No Usable Answer
  if (
    msg.includes('empty response') ||
    msg.includes('empty model response') ||
    msg.includes('empty text') ||
    msg.includes('empty parts') ||
    msg.includes('empty embedding') ||
    msg.includes('no text') ||
    msg.includes('no text response') ||
    msg.includes('no candidates') ||
    msg.includes('no response candidates') ||
    msg.includes('no message content') ||
    msg.includes('returned no completion') ||
    msg.includes('returned no response') ||
    msg.includes('returned no values') ||
    msg.includes('no values')
  ) {
    return {
      kind: 'empty',
      isRetryable: true,
      userMessage: 'The model completed the request but returned an empty response. Please try rephrasing your question or selecting another document.',
      suggestedAction: 'retry',
      sanitizedDetails: safeMessage,
    };
  }

  // 6b. Model Incompatible Modality / Capability Mismatch (e.g. TTS or Audio model used for text generation)
  if (
    msg.includes('combination of response modalities') ||
    msg.includes('response modalities') ||
    (msg.includes('modality') && msg.includes('not supported'))
  ) {
    const cleanDetail = extractCleanProviderDetails(safeMessage);
    const detailSuffix = cleanDetail ? ` (${cleanDetail})` : '';
    return {
      kind: 'not_found',
      isRetryable: true,
      userMessage: `The selected AI model does not support text generation responses${detailSuffix}. Re-discovering a compatible text model... Please click Retry or select a standard text generation model.`,
      suggestedAction: 'switch_model',
      sanitizedDetails: cleanDetail || safeMessage,
    };
  }

  // 7. Model Not Found / Deprecated (404)
  if (
    statusCode === 404 ||
    msg.includes('not found') ||
    msg.includes('no longer available') ||
    msg.includes('not available to new users') ||
    msg.includes('is not accessible for this api key')
  ) {
    const cleanDetail = extractCleanProviderDetails(safeMessage);
    const detailSuffix = cleanDetail ? ` (${cleanDetail})` : '';
    return {
      kind: 'not_found',
      isRetryable: true,
      userMessage: `The requested model was not found or is no longer available for this API version${detailSuffix}. Re-discovering an active model for your key... Please click Retry if the issue persists or choose another model.`,
      suggestedAction: 'switch_model',
      sanitizedDetails: cleanDetail || safeMessage,
    };
  }

  // 8. Server Error (5xx)
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      kind: 'server_error',
      isRetryable: true,
      userMessage: `The AI provider returned an internal server error (HTTP ${statusCode}). Please click Retry in a few moments.`,
      suggestedAction: 'retry',
      sanitizedDetails: safeMessage,
    };
  }

  // 9. Network / Abort / Timeout
  const isTimeout = msg.includes('timeout') || msg.includes('timed out') || msg.includes('timed-out');
  if (
    statusCode === 0 ||
    msg.includes('abort') ||
    isTimeout ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('econnrefused')
  ) {
    return {
      kind: isTimeout ? 'timeout' : 'network',
      isRetryable: true,
      userMessage: isTimeout
        ? 'Request timed out waiting for the AI response. Please click Retry.'
        : 'Network connection issue communicating with the AI provider. Please verify your connection and click Retry.',
      suggestedAction: 'check_network',
      sanitizedDetails: safeMessage,
    };
  }

  return {
    kind: 'generic',
    isRetryable: true,
    userMessage: safeMessage || msg || 'An unexpected error occurred while communicating with the AI provider.',
    suggestedAction: 'retry',
    sanitizedDetails: safeMessage,
  };
}

// =========================================================================
// Timeout & Cancellation Utilities
// =========================================================================

/**
 * Creates a combined AbortSignal with a per-attempt timeout and optional parent signal.
 * Ensures that hanging HTTP requests abort cleanly without dangling forever.
 */
export function withTimeoutSignal(
  parentSignal?: AbortSignal,
  timeoutMs = 15000
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason || new Error('Request was aborted'));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

// =========================================================================
// Discovered Models In-Memory Cache (TTL 10 min)
// =========================================================================

const discoveredModelsCache = new Map<string, { models: GeminiModelMetadata[]; timestamp: number }>();
export const DISCOVERED_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

export function getCachedDiscoveredModels(keyFingerprint: string): GeminiModelMetadata[] | null {
  const entry = discoveredModelsCache.get(keyFingerprint);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > DISCOVERED_MODELS_CACHE_TTL_MS) {
    discoveredModelsCache.delete(keyFingerprint);
    return null;
  }
  return entry.models;
}

export function setCachedDiscoveredModels(keyFingerprint: string, models: GeminiModelMetadata[]): void {
  discoveredModelsCache.set(keyFingerprint, { models, timestamp: Date.now() });
}

export function clearDiscoveredModelsCache(): void {
  discoveredModelsCache.clear();
}

export function invalidateDiscoveredModelsCache(keyFingerprint: string): void {
  discoveredModelsCache.delete(keyFingerprint);
}

// =========================================================================
// Query Embedding In-Memory Cache (TTL 10 min, max 50 items)
// =========================================================================

const queryEmbeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
export const QUERY_EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
export const MAX_QUERY_EMBEDDING_CACHE_SIZE = 50;

export function getCachedQueryEmbedding(provider: AIProvider, query: string): number[] | null {
  const key = `${provider}:${query.trim().toLowerCase()}`;
  const entry = queryEmbeddingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > QUERY_EMBEDDING_CACHE_TTL_MS) {
    queryEmbeddingCache.delete(key);
    return null;
  }
  return entry.embedding;
}

export function setCachedQueryEmbedding(provider: AIProvider, query: string, embedding: number[]): void {
  const key = `${provider}:${query.trim().toLowerCase()}`;
  if (queryEmbeddingCache.size >= MAX_QUERY_EMBEDDING_CACHE_SIZE) {
    const oldestKey = queryEmbeddingCache.keys().next().value;
    if (oldestKey) queryEmbeddingCache.delete(oldestKey);
  }
  queryEmbeddingCache.set(key, { embedding, timestamp: Date.now() });
}

export function clearQueryEmbeddingCache(): void {
  queryEmbeddingCache.clear();
}

// =========================================================================
// Conversational Intent Fast-Path
// =========================================================================

/**
 * Detects conversational greetings and generic platform assistant questions
 * (e.g. "hello", "hi", "hey", "who are you", "what can you do", "help").
 * Avoids unnecessary embedding generation, pgvector searches, and heavy LLM prompts
 * for non-document conversational queries, responding instantly (< 5ms).
 * Strictly returns false for substantive research questions (e.g. "whats cerebellum", "what is TCP?").
 */
export function isConversationalGreeting(query: string): boolean {
  const clean = query
    .trim()
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, '')
    .trim();

  if (!clean) return false;

  const exactGreetings = new Set([
    'hi',
    'hello',
    'hey',
    'hey there',
    'hi there',
    'hello there',
    'good morning',
    'good afternoon',
    'good evening',
    'greetings',
    'howdy',
    'hola',
    'who are you',
    'what are you',
    'what can you do',
    'what is this',
    'what is docudock',
    'help',
    'how does this work',
    'how do you work',
    'how are you',
    'what do you do',
  ]);

  if (exactGreetings.has(clean)) return true;

  if (/^(hi|hello|hey)(\s+(there|docudock|assistant|bot))?$/i.test(clean)) {
    return true;
  }

  return false;
}

