import { createClient } from '@/lib/supabase/client';
import { AIProvider, Citation, MatchedChunk } from '@/lib/types';
import {
  generateQueryEmbedding,
  generateGroundedAnswer,
  generateBatchedScopeExplanation,
  PROVIDER_OPTIONS,
  ProviderError,
} from '@/lib/ai/providers';
import { getCachedChatModel, isConversationalGreeting } from '@/lib/ai/modelCache';
export { isConversationalGreeting };
import { parseScopeQuery, ScopeQueryIntent } from '@/lib/utils/scopeQueryParser';
import { MOCK_STOP_WORDS, tokenizeWords, filterPassagesByTopic } from '@/lib/ai/mockProvider';

export interface PipelineTimings {
  modelDiscoveryMs: number;
  embeddingMs: number;
  vectorSearchMs: number;
  retrievalTotalMs: number;
  promptConstructionMs: number;
  generationMs: number;
  totalDurationMs: number;
}

export interface RAGQueryOptions {
  filterDocumentIds?: string[];
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  timeoutMs?: number;
}

export interface RAGQueryResult {
  answer: string;
  citations: Citation[];
  matchedChunks: MatchedChunk[];
  insufficientEvidence: boolean;
  timings?: PipelineTimings;
}

/**
 * Handles scope-based explanations and summaries covering physical page ranges
 * (e.g. "explain the first 10 pages", "summarize pages 5-15", "teach me this chapter").
 * Retrieves chunks by document and physical page range rather than semantic similarity alone.
 */
async function executeScopeQuery(
  question: string,
  scopeIntent: ScopeQueryIntent,
  provider: AIProvider,
  apiKey: string,
  supabase: ReturnType<typeof createClient>,
  filterDocumentIds?: string[],
  options?: RAGQueryOptions
): Promise<RAGQueryResult> {
  // 1. Resolve target document
  let targetDoc: { id: string; name: string; page_count: number } | null = null;

  // If a specific document is requested by name in the query:
  if (scopeIntent.targetDocumentName) {
    const cleanTarget = scopeIntent.targetDocumentName.toLowerCase().replace(/\.pdf$/i, '');
    
    // If scope filter is active, check if target document is among selected documents
    if (filterDocumentIds && filterDocumentIds.length > 0) {
      const { data: allowedDocs } = await supabase
        .from('documents')
        .select('id, name, page_count')
        .in('id', filterDocumentIds);

      const matchedAllowed = (allowedDocs || []).find((d) => {
        const cleanDoc = d.name.toLowerCase().replace(/\.pdf$/i, '');
        return (
          d.name.toLowerCase() === scopeIntent.targetDocumentName!.toLowerCase() ||
          cleanDoc === cleanTarget ||
          cleanDoc.includes(cleanTarget) ||
          cleanTarget.includes(cleanDoc)
        );
      });

      if (!matchedAllowed) {
        // Document is not in selected scope
        return {
          answer: `The document **"${scopeIntent.targetDocumentName}"** is not included in your selected document scope. Please select it in the workspace sidebar to query it.`,
          citations: [],
          matchedChunks: [],
          insufficientEvidence: true,
        };
      }
      targetDoc = matchedAllowed;
    } else {
      // No filter: search user's ready documents by name
      const { data: namedDocs } = await supabase
        .from('documents')
        .select('id, name, page_count')
        .eq('status', 'ready');

      const matchedDoc = (namedDocs || []).find((d) => {
        const cleanDoc = d.name.toLowerCase().replace(/\.pdf$/i, '');
        return (
          d.name.toLowerCase() === scopeIntent.targetDocumentName!.toLowerCase() ||
          cleanDoc === cleanTarget ||
          cleanDoc.includes(cleanTarget) ||
          cleanTarget.includes(cleanDoc)
        );
      });

      if (matchedDoc) {
        targetDoc = matchedDoc;
      }
    }
  }

  // If targetDoc not yet resolved and filterDocumentIds is provided, pick the first selected doc
  if (!targetDoc && filterDocumentIds && filterDocumentIds.length > 0) {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, name, page_count')
      .in('id', filterDocumentIds)
      .limit(1);
    if (docs && docs.length > 0) {
      targetDoc = docs[0];
    }
  }

  // Fallback to most recent ready document if no filter or name specified
  if (!targetDoc) {
    const { data: readyDocs } = await supabase
      .from('documents')
      .select('id, name, page_count')
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1);
    if (readyDocs && readyDocs.length > 0) {
      targetDoc = readyDocs[0];
    }
  }

  if (!targetDoc) {
    return {
      answer:
        'No documents are currently ready in your workspace. Please upload and index a PDF first.',
      citations: [],
      matchedChunks: [],
      insufficientEvidence: true,
    };
  }

  const docPageCount = Math.max(1, targetDoc.page_count || 1);
  let startPage = 1;
  let endPage = docPageCount;

  if (scopeIntent.scopeType === 'continuation') {
    startPage = scopeIntent.startPage ? Math.max(1, scopeIntent.startPage) : 5;
    endPage = scopeIntent.endPage ? Math.min(docPageCount, scopeIntent.endPage) : Math.min(docPageCount, startPage + 5);

    if (startPage > docPageCount) {
      return {
        answer: `Cannot continue explanation: page ${startPage} exceeds the total length of **"${targetDoc.name}"** (${docPageCount} pages).`,
        citations: [],
        matchedChunks: [],
        insufficientEvidence: true,
      };
    }
  } else if (scopeIntent.scopeType === 'range' || scopeIntent.scopeType === 'single_page') {
    const rawStart = scopeIntent.startPage || 1;
    const rawEnd = scopeIntent.endPage || docPageCount;
    startPage = Math.min(rawStart, rawEnd);
    endPage = Math.max(rawStart, rawEnd);

    // If requested range is entirely beyond document page count
    if (startPage > docPageCount) {
      return {
        answer: `The requested page range (pages ${startPage}–${endPage}) exceeds the total length of **"${targetDoc.name}"**, which contains ${docPageCount} pages.`,
        citations: [],
        matchedChunks: [],
        insufficientEvidence: true,
      };
    }

    startPage = Math.max(1, startPage);
    endPage = Math.min(docPageCount, endPage);
  }

  // 2. Query document chunks by physical page range
  const { data: chunkRows, error: chunkError } = await supabase
    .from('document_chunks')
    .select('id, document_id, chunk_index, page_number, content')
    .eq('document_id', targetDoc.id)
    .gte('page_number', startPage)
    .lte('page_number', endPage)
    .order('page_number', { ascending: true })
    .order('chunk_index', { ascending: true });

  if (chunkError) {
    throw new Error(`Failed to retrieve document pages: ${chunkError.message}`);
  }

  const chunks = (chunkRows || []) as Array<{
    id: string;
    document_id: string;
    chunk_index: number;
    page_number: number;
    content: string;
  }>;

  // 3. Detect any missing / unextractable pages in the requested range
  const presentPages = new Set(chunks.map((c) => c.page_number));
  const missingPages: number[] = [];
  for (let p = startPage; p <= endPage; p++) {
    if (!presentPages.has(p)) {
      missingPages.push(p);
    }
  }

  if (chunks.length === 0) {
    return {
      answer: `Based on the document **"${targetDoc.name}"**, pages ${startPage}–${endPage} contain no extractable text. (The pages may be blank or contain unrasterized scans without OCR).`,
      citations: [],
      matchedChunks: [],
      insufficientEvidence: true,
    };
  }

  // 4. Generate structured scope explanation
  const pagePassages = chunks.map((c) => ({
    page_number: c.page_number,
    content: c.content,
  }));

  let answer: string;
  try {
    answer = await generateBatchedScopeExplanation(
      provider,
      apiKey,
      question,
      targetDoc.name,
      startPage,
      endPage,
      pagePassages,
      missingPages,
      {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        onProgress: options?.onProgress,
      }
    );
  } catch (err: unknown) {
    if (err instanceof ProviderError) throw err;
    throw new Error(`Explanation generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // 5. Build citations list for all physically processed pages
  const citationsMap = new Map<string, Citation>();
  for (const chunk of chunks) {
    const key = `${targetDoc.id}-${chunk.page_number}`;
    if (!citationsMap.has(key)) {
      citationsMap.set(key, {
        document_id: targetDoc.id,
        document_name: targetDoc.name,
        page_number: chunk.page_number,
        content: chunk.content,
        similarity: 1.0,
      });
    }
  }

  const matchedChunks: MatchedChunk[] = chunks.map((c) => ({
    id: c.id,
    document_id: c.document_id,
    document_name: targetDoc!.name,
    chunk_index: c.chunk_index,
    page_number: c.page_number,
    content: c.content,
    similarity: 1.0,
  }));

  return {
    answer,
    citations: Array.from(citationsMap.values()),
    matchedChunks,
    insufficientEvidence: false,
  };
}

/**
 * Executes full RAG search pipeline:
 * - Detects scope-based / page-range questions ("explain first 10 pages", "pages 5-15", "teach me this chapter")
 *   and retrieves chunks systematically by document and page range.
 * - For focused factual / analytical questions ("What is TCP?"), executes vector similarity search.
 */
export async function executeRAGQuery(
  question: string,
  provider: AIProvider,
  apiKey: string,
  filterDocumentIdsOrOptions?: string[] | RAGQueryOptions,
  legacyOptions?: RAGQueryOptions
): Promise<RAGQueryResult> {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) {
    throw new Error('Please enter a research question.');
  }

  const pipelineStart = Date.now();

  // Fast-path: conversational greetings and generic assistant queries (0ms embeddings / 0ms vector search)
  if (isConversationalGreeting(cleanQuestion)) {
    const totalDurationMs = Date.now() - pipelineStart;
    return {
      answer:
        "Hello! I am DocuDock, your AI document research assistant. I'm ready to search and answer questions based on the documents in your workspace.\n\nHere is how you can use me:\n- **Ask Factual Questions**: Ask specific questions like *\"What is the function of the cerebellum?\"* or *\"How does TCP flow control work?\"*\n- **Scope Summaries**: Ask *\"Summarize the first 10 pages\"* or *\"Explain pages 5-15 of [Document]\"*\n- **Document Navigation**: Click any citation chip `[DocumentName, p. X]` to inspect the exact source page in the document viewer.\n\nMake sure your document is uploaded and selected in the sidebar, and feel free to ask your research questions!",
      citations: [],
      matchedChunks: [],
      insufficientEvidence: false,
      timings: {
        modelDiscoveryMs: 0,
        embeddingMs: 0,
        vectorSearchMs: 0,
        retrievalTotalMs: 0,
        promptConstructionMs: 0,
        generationMs: 0,
        totalDurationMs,
      },
    };
  }

  if (!apiKey.trim()) {
    throw new Error('AI provider API key is not connected. Please connect your API key in Settings.');
  }

  let filterDocumentIds: string[] | undefined;
  let options: RAGQueryOptions | undefined;

  if (Array.isArray(filterDocumentIdsOrOptions)) {
    filterDocumentIds = filterDocumentIdsOrOptions;
    options = legacyOptions;
  } else if (filterDocumentIdsOrOptions && typeof filterDocumentIdsOrOptions === 'object') {
    options = filterDocumentIdsOrOptions;
    filterDocumentIds = options.filterDocumentIds;
  }

  options?.onProgress?.('Resolving document scope...');

  const supabase = createClient();

  // Ensure auth session is valid and fresh
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    throw new Error('Your session has expired. Please refresh the page or sign in again.');
  }

  // Resolve known workspace document names so queries like "What topics does HAP 2.pdf cover..."
  // extract the exact filename without swallowing query prefixes or treating the question as a filename
  let knownDocNames: string[] = [];
  if (filterDocumentIds && filterDocumentIds.length > 0) {
    const { data: allowedDocs } = await supabase
      .from('documents')
      .select('id, name')
      .in('id', filterDocumentIds);
    if (allowedDocs) {
      knownDocNames = allowedDocs.map((d) => d.name);
    }
  } else {
    const { data: readyDocs } = await supabase
      .from('documents')
      .select('id, name')
      .eq('status', 'ready')
      .limit(20);
    if (readyDocs) {
      knownDocNames = readyDocs.map((d) => d.name);
    }
  }

  // Check if the query is asking for a page range or full document explanation
  const scopeIntent = parseScopeQuery(cleanQuestion, knownDocNames);
  if (scopeIntent.isScopeQuery) {
    return await executeScopeQuery(
      cleanQuestion,
      scopeIntent,
      provider,
      apiKey,
      supabase,
      filterDocumentIds,
      options
    );
  }

  // 1. Model Resolution Timing (0ms if already cached for session)
  const modelStart = Date.now();
  let resolvedModel = 'gpt-4o-mini';
  if (provider === 'gemini') {
    resolvedModel = getCachedChatModel('gemini', apiKey) || PROVIDER_OPTIONS.gemini.chatModel || 'gemini-3.8-flash';
  } else if (provider === 'mock') {
    resolvedModel = 'mock-grounded-chat';
  }
  const modelDiscoveryMs = Date.now() - modelStart;

  // 2. Query Embedding Timing
  options?.onProgress?.('Generating question embedding...');
  const embedStart = Date.now();
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateQueryEmbedding(provider, apiKey, cleanQuestion, {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
  } catch (err: unknown) {
    if (err instanceof ProviderError) throw err;
    throw new Error(`Embedding generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
  const embeddingMs = Date.now() - embedStart;

  // 3. Vector Similarity Search Timing
  options?.onProgress?.('Searching document passages...');
  const searchStart = Date.now();
  const rpcName = (provider === 'gemini' || provider === 'mock') ? 'match_document_chunks_768' : 'match_document_chunks_1536';
  
  // If query explicitly names a document (e.g. "According to HAP 2.pdf..."), enforce document scope
  let effectiveFilterIds = filterDocumentIds && filterDocumentIds.length > 0 ? filterDocumentIds : null;
  if (scopeIntent.targetDocumentName) {
    if (filterDocumentIds && filterDocumentIds.length > 0) {
      const { data: allowedDocs } = await supabase
        .from('documents')
        .select('id, name')
        .in('id', filterDocumentIds);

      const cleanTarget = scopeIntent.targetDocumentName.toLowerCase().replace(/\.pdf$/i, '');
      const matchedAllowed = (allowedDocs || []).find((d) => {
        const cleanDoc = d.name.toLowerCase().replace(/\.pdf$/i, '');
        return (
          d.name.toLowerCase() === scopeIntent.targetDocumentName!.toLowerCase() ||
          cleanDoc === cleanTarget ||
          cleanDoc.includes(cleanTarget) ||
          cleanTarget.includes(cleanDoc)
        );
      });

      if (!matchedAllowed) {
        return {
          answer: `The document **"${scopeIntent.targetDocumentName}"** is not included in your selected document scope. Please select it in the workspace sidebar to query it.`,
          citations: [],
          matchedChunks: [],
          insufficientEvidence: true,
        };
      }
      effectiveFilterIds = [matchedAllowed.id];
    } else {
      const cleanTarget = scopeIntent.targetDocumentName.toLowerCase().replace(/\.pdf$/i, '');
      const { data: namedDocs } = await supabase
        .from('documents')
        .select('id, name')
        .eq('status', 'ready');

      const matchedDoc = (namedDocs || []).find((d) => {
        const cleanDoc = d.name.toLowerCase().replace(/\.pdf$/i, '');
        return (
          d.name.toLowerCase() === scopeIntent.targetDocumentName!.toLowerCase() ||
          cleanDoc === cleanTarget ||
          cleanDoc.includes(cleanTarget) ||
          cleanTarget.includes(cleanDoc)
        );
      });

      if (matchedDoc) {
        effectiveFilterIds = [matchedDoc.id];
      }
    }
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(rpcName, {
    query_embedding: queryEmbedding,
    match_threshold: provider === 'mock' ? 0.08 : 0.18,
    match_count: 6,
    filter_document_ids: effectiveFilterIds,
  });

  if (rpcError) {
    throw new Error(`Vector search failed: ${rpcError.message}`);
  }
  const vectorSearchMs = Date.now() - searchStart;
  const retrievalTotalMs = embeddingMs + vectorSearchMs;

  const rawMatches = (rpcData || []) as MatchedChunk[];

  let matches: MatchedChunk[] = [];
  const seenMatches = new Set<string>();
  for (const m of rawMatches) {
    const key = `${m.document_id}-${m.page_number}-${m.chunk_index}`;
    if (!seenMatches.has(key)) {
      seenMatches.add(key);
      matches.push(m);
    }
  }

  // In Mock Provider mode: re-rank matched chunks by query keyword relevance if domain terms exist
  if (provider === 'mock' && matches.length > 0) {
    const queryKeywords = tokenizeWords(cleanQuestion).filter((t) => !MOCK_STOP_WORDS.has(t));
    if (queryKeywords.length > 0) {
      matches.sort((a, b) => {
        let scoreA = a.similarity;
        let scoreB = b.similarity;
        const textA = a.content.toLowerCase();
        const textB = b.content.toLowerCase();
        for (const kw of queryKeywords) {
          const regex = new RegExp(`\\b${kw}\\b`, 'g');
          const countA = (textA.match(regex) || []).length;
          const countB = (textB.match(regex) || []).length;
          scoreA += countA * 0.15 + (textA.includes(kw) ? 0.05 : 0);
          scoreB += countB * 0.15 + (textB.includes(kw) ? 0.05 : 0);
        }
        return scoreB - scoreA;
      });
    }
  }

  // Fallback for Mock Provider when vector similarity returns 0 matches:
  // Inspect direct chunks from candidate documents with stop-word filtered lexical relevance
  const fallbackFilterIds = effectiveFilterIds || filterDocumentIds;
  if (matches.length === 0 && provider === 'mock' && fallbackFilterIds && fallbackFilterIds.length > 0) {
    const { data: fallbackDocs } = await supabase
      .from('documents')
      .select('id, name')
      .in('id', fallbackFilterIds);

    if (fallbackDocs && fallbackDocs.length > 0) {
      const docMap = new Map(fallbackDocs.map((d) => [d.id, d.name]));
      const { data: directChunks } = await supabase
        .from('document_chunks')
        .select('id, document_id, chunk_index, page_number, content')
        .in('document_id', fallbackFilterIds)
        .order('page_number', { ascending: true })
        .order('chunk_index', { ascending: true })
        .limit(20);

      if (directChunks && directChunks.length > 0) {
        const queryTokens = tokenizeWords(cleanQuestion);
        const queryKeywords = queryTokens.filter((t) => !MOCK_STOP_WORDS.has(t));
        const isGeneralQuery =
          queryTokens.some((t) => ['summarize', 'summary', 'overview', 'content', 'contents', 'explain', 'tell'].includes(t)) &&
          queryKeywords.length <= 1;

        const scoredChunks = directChunks.map((c) => {
          const contentLower = c.content.toLowerCase();
          let score = 0;
          for (const token of queryKeywords) {
            const regex = new RegExp(`\\b${token}\\b`, 'g');
            const kwMatches = contentLower.match(regex);
            if (kwMatches) score += kwMatches.length * 2;
            else if (contentLower.includes(token)) score += 0.5;
          }
          return {
            chunk: c,
            score: isGeneralQuery ? 1.0 : score,
          };
        });

        // Filter out zero-score chunks for specific queries and sort by score descending
        const relevantChunks = scoredChunks
          .filter((sc) => sc.score > 0)
          .sort((a, b) => b.score - a.score);

        if (relevantChunks.length > 0) {
          matches = relevantChunks.slice(0, 6).map(({ chunk, score }) => ({
            id: chunk.id,
            document_id: chunk.document_id,
            document_name: docMap.get(chunk.document_id) || 'Document.pdf',
            chunk_index: chunk.chunk_index,
            page_number: chunk.page_number,
            content: chunk.content,
            similarity: isGeneralQuery ? 0.95 : Math.min(1.0, 0.4 + score * 0.1),
          }));
        }
      }
    }
  }

  // If provider is mock, ensure matched chunks contain topic-relevant content and exclude unrelated passages
  if (provider === 'mock' && matches.length > 0) {
    const isGeneralQuery =
      tokenizeWords(cleanQuestion).some((t) =>
        ['summarize', 'summary', 'overview', 'content', 'contents', 'explain', 'teach', 'tell'].includes(t)
      ) && tokenizeWords(cleanQuestion).filter((t) => !MOCK_STOP_WORDS.has(t)).length <= 1;

    if (!isGeneralQuery) {
      matches = filterPassagesByTopic(matches, cleanQuestion);
    }
  }

  // If no relevant evidence exists
  if (matches.length === 0) {
    const totalDurationMs = Date.now() - pipelineStart;
    const timings: PipelineTimings = {
      modelDiscoveryMs,
      embeddingMs,
      vectorSearchMs,
      retrievalTotalMs,
      promptConstructionMs: 0,
      generationMs: 0,
      totalDurationMs,
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DocuDock Diagnostics] Request Timings: ${totalDurationMs}ms (Insufficient Evidence)`);
    }
    return {
      answer:
        'Based on the documents in your workspace, I could not find any relevant passages to answer this question. Please make sure the relevant document is uploaded, fully indexed, or try rephrasing your search query.',
      citations: [],
      matchedChunks: [],
      insufficientEvidence: true,
      timings,
    };
  }

  // 4. Prompt Construction Timing
  const promptStart = Date.now();
  const formattedPassages = matches.map((m) => ({
    document_name: m.document_name,
    page_number: m.page_number,
    content: m.content,
  }));
  const promptConstructionMs = Date.now() - promptStart;

  // 5. Grounded Generation Timing
  options?.onProgress?.('Synthesizing research answer...');
  const genStart = Date.now();
  let answer: string;
  try {
    answer = await generateGroundedAnswer(
      provider,
      apiKey,
      cleanQuestion,
      formattedPassages,
      {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        onProgress: options?.onProgress,
      }
    );
  } catch (err: unknown) {
    if (err instanceof ProviderError) throw err;
    throw new Error(`Answer generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
  const generationMs = Date.now() - genStart;
  const totalDurationMs = Date.now() - pipelineStart;

  const timings: PipelineTimings = {
    modelDiscoveryMs,
    embeddingMs,
    vectorSearchMs,
    retrievalTotalMs,
    promptConstructionMs,
    generationMs,
    totalDurationMs,
  };

  // Development-only diagnostic logging (NO API keys, NO document content, NO user queries logged)
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[DocuDock Diagnostics] Request Timings (${totalDurationMs}ms total): Model=${modelDiscoveryMs}ms (${resolvedModel}) | Retrieval=${retrievalTotalMs}ms (Embed=${embeddingMs}ms, Search=${vectorSearchMs}ms) | Prompt=${promptConstructionMs}ms | Generation=${generationMs}ms`
    );
  }

  // Build citations list from matched passages
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

  const insufficientEvidence = answer
    .toLowerCase()
    .includes('insufficient evidence');
  const citations = insufficientEvidence ? [] : Array.from(citationsMap.values());

  return {
    answer,
    citations,
    matchedChunks: matches,
    insufficientEvidence,
    timings,
  };
}
