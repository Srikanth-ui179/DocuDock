import { createClient } from '@/lib/supabase/client';
import { AIProvider, Citation, MatchedChunk } from '@/lib/types';
import { generateQueryEmbedding, generateGroundedAnswer, ProviderError } from '@/lib/ai/providers';

export interface RAGQueryResult {
  answer: string;
  citations: Citation[];
  matchedChunks: MatchedChunk[];
  insufficientEvidence: boolean;
}

/**
 * Executes full RAG search pipeline:
 * 1. Embeds question using in-memory provider API key
 * 2. Queries pgvector via Supabase RPC with owner RLS
 * 3. Prompts LLM for strictly grounded answer with citations
 */
export async function executeRAGQuery(
  question: string,
  provider: AIProvider,
  apiKey: string,
  filterDocumentIds?: string[]
): Promise<RAGQueryResult> {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) {
    throw new Error('Please enter a research question.');
  }

  if (!apiKey.trim()) {
    throw new Error('AI provider API key is not connected. Please connect your API key in Settings.');
  }

  const supabase = createClient();

  // 1. Generate query embedding
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateQueryEmbedding(provider, apiKey, cleanQuestion);
  } catch (err: unknown) {
    if (err instanceof ProviderError) throw err;
    throw new Error(`Embedding generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // 2. Perform vector similarity search in PostgreSQL via pgvector RPC
  const rpcName = provider === 'gemini' ? 'match_document_chunks_768' : 'match_document_chunks_1536';
  const filterIds = filterDocumentIds && filterDocumentIds.length > 0 ? filterDocumentIds : null;

  const { data: rpcData, error: rpcError } = await supabase.rpc(rpcName, {
    query_embedding: queryEmbedding,
    match_threshold: 0.15,
    match_count: 6,
    filter_document_ids: filterIds,
  });

  if (rpcError) {
    throw new Error(`Vector search failed: ${rpcError.message}`);
  }

  const matches = (rpcData || []) as MatchedChunk[];

  // 3. Check if any relevant evidence exists
  if (matches.length === 0) {
    return {
      answer:
        'Based on the documents in your workspace, I could not find any relevant passages to answer this question. Please make sure the relevant document is uploaded, fully indexed, or try rephrasing your search query.',
      citations: [],
      matchedChunks: [],
      insufficientEvidence: true,
    };
  }

  // 4. Generate grounded answer
  let answer: string;
  try {
    answer = await generateGroundedAnswer(
      provider,
      apiKey,
      cleanQuestion,
      matches.map((m) => ({
        document_name: m.document_name,
        page_number: m.page_number,
        content: m.content,
      }))
    );
  } catch (err: unknown) {
    if (err instanceof ProviderError) throw err;
    throw new Error(`Answer generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // 5. Build citations list from matched passages
  const citationsMap = new Map<string, Citation>();

  for (const match of matches) {
    const key = `${match.document_id}-${match.page_number}`;
    if (!citationsMap.has(key)) {
      citationsMap.set(key, {
        document_id: match.document_id,
        document_name: match.document_name,
        page_number: match.page_number,
        content: match.content,
        similarity: match.similarity,
      });
    }
  }

  const citations = Array.from(citationsMap.values());
  const insufficientEvidence = answer
    .toLowerCase()
    .includes('insufficient evidence');

  return {
    answer,
    citations,
    matchedChunks: matches,
    insufficientEvidence,
  };
}
