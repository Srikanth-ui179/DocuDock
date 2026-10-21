export type AIProvider = 'gemini' | 'openai' | 'mock';

export interface DocumentRecord {
  id: string;
  user_id: string;
  name: string;
  file_path: string;
  file_size: number;
  page_count: number;
  status: 'indexing' | 'ready' | 'failed';
  error_message: string | null;
  embedding_provider: AIProvider;
  embedding_model: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentChunkRecord {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  page_number: number;
  content: string;
  embedding_768?: number[];
  embedding_1536?: number[];
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface MatchedChunk {
  id: string;
  document_id: string;
  document_name: string;
  chunk_index: number;
  page_number: number;
  content: string;
  similarity: number;
}

export interface Citation {
  document_id: string;
  document_name: string;
  page_number: number;
  content: string;
  similarity: number;
}

export type ProviderErrorType =
  | 'invalid_key'
  | 'overloaded'
  | 'rate_limit'
  | 'quota_exhausted'
  | 'blocked'
  | 'empty'
  | 'not_found'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'generic';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  timestamp: number;
  error?: boolean;
  errorType?: ProviderErrorType;
  retryQuery?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  selectedDocIds: string[];
  messages: ChatMessage[];
}

export interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  embeddingModel: string;
  chatModel: string;
  embeddingDimension: 768 | 1536;
}

export interface ProviderOption {
  id: AIProvider;
  name: string;
  description: string;
  embeddingModel: string;
  embeddingDim: 768 | 1536;
  chatModel: string;
  keyUrl: string;
}

export interface LLMGenerationResult {
  text: string;
  finishReason: string;
  isTruncated: boolean;
}

export class ProviderError extends Error {
  statusCode?: number;
  provider?: AIProvider;
  rawDetails?: string;

  constructor(message: string, statusCode?: number, provider?: AIProvider, rawDetails?: string) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.provider = provider;
    this.rawDetails = rawDetails;
  }
}
