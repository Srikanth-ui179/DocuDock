import { createClient } from '@/lib/supabase/client';
import { AIProvider, DocumentRecord } from '@/lib/types';
import { PROVIDER_OPTIONS, generateBatchEmbeddings, ProviderError } from '@/lib/ai/providers';
import { sanitizeErrorMessage } from '@/lib/ai/modelCache';
import { extractAndChunkPDF } from '@/lib/pdf/extractor';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB free-tier limit

export interface IndexProgressCallback {
  (step: 'uploading' | 'extracting' | 'embedding' | 'saving' | 'completed' | 'failed', message?: string): void;
}

export async function fetchUserDocuments(): Promise<DocumentRecord[]> {
  const supabase = createClient();
  await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load documents: ${error.message}`);
  }

  return (data || []) as DocumentRecord[];
}

export async function deleteDocument(documentId: string, filePath: string): Promise<void> {
  const supabase = createClient();

  // 1. Delete document row from DB first (cascades to document_chunks)
  const { error: dbError } = await supabase.from('documents').delete().eq('id', documentId);
  if (dbError) {
    throw new Error(`Failed to delete document: ${dbError.message}`);
  }

  // 2. Only remove file from storage if no other document references the same file_path
  if (filePath) {
    const { data: sharingDocs } = await supabase
      .from('documents')
      .select('id')
      .eq('file_path', filePath);

    if (!sharingDocs || sharingDocs.length === 0) {
      const { error: storageError } = await supabase.storage.from('documents').remove([filePath]);
      if (storageError) {
        console.warn('Storage deletion warning:', storageError.message);
      }
    }
  }
}

export async function getDocumentSignedUrl(filePath: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(filePath, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not generate signed URL: ${error?.message || 'Unknown error'}`);
  }
  return data.signedUrl;
}

export async function retryDocumentIndexing(
  documentId: string,
  provider: AIProvider,
  apiKey: string,
  onProgress?: IndexProgressCallback
): Promise<DocumentRecord> {
  const supabase = createClient();

  if (!apiKey.trim()) {
    throw new Error('Please connect your AI provider API key before indexing documents.');
  }

  // 1. Fetch document record
  const { data: docData, error: fetchError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (fetchError || !docData) {
    throw new Error(`Document record not found: ${fetchError?.message || 'Unknown error'}`);
  }

  const document = docData as DocumentRecord;
  const providerOption = PROVIDER_OPTIONS[provider];

  // 2. Download the existing PDF binary from private Storage
  onProgress?.('uploading', 'Retrieving PDF from private storage...');
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from('documents')
    .download(document.file_path);

  if (downloadError || !fileBlob) {
    throw new Error(`Failed to load file from storage: ${downloadError?.message || 'Storage error'}`);
  }

  // 3. Mark document as 'indexing' without deleting existing valid chunks immediately (resumable)
  await supabase
    .from('documents')
    .update({
      status: 'indexing',
      embedding_provider: provider,
      embedding_model: providerOption.embeddingModel,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId);

  try {
    // 4. Extract text & chunks
    onProgress?.('extracting', 'Extracting page text and building semantic chunks...');
    const buffer = await fileBlob.arrayBuffer();
    const extraction = await extractAndChunkPDF(buffer);

    if (extraction.isScannedOrEmpty || extraction.chunks.length === 0) {
      const emptyMsg =
        'No extractable text found in this PDF. It appears to be scanned or image-based. Scanned-PDF OCR is not supported; please upload a text-based PDF.';
      await supabase
        .from('documents')
        .update({ status: 'failed', error_message: emptyMsg })
        .eq('id', documentId);
      throw new Error(emptyMsg);
    }

    // 5. Check if any chunks already exist in DB for this document (e.g. from a partially completed run)
    const { data: existingChunks } = await supabase
      .from('document_chunks')
      .select('chunk_index')
      .eq('document_id', documentId);

    const existingChunkIndices = new Set(
      (existingChunks || []).map((c: { chunk_index: number }) => c.chunk_index)
    );

    // Identify which chunks are missing
    const missingChunks = extraction.chunks.filter((c) => !existingChunkIndices.has(c.chunkIndex));

    if (missingChunks.length === 0 && existingChunkIndices.size === extraction.chunks.length) {
      // All chunks are already indexed! Finalize document status.
      onProgress?.('completed', 'All chunks already embedded! Document ready.');
      const { data: finalizedDoc } = await supabase
        .from('documents')
        .update({
          status: 'ready',
          page_count: extraction.totalPages,
          chunk_count: extraction.chunks.length,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', document.id)
        .select()
        .single();
      return (finalizedDoc || document) as DocumentRecord;
    }

    onProgress?.(
      'embedding',
      missingChunks.length < extraction.chunks.length
        ? `Resuming: ${existingChunkIndices.size} chunks already saved. Embedding remaining ${missingChunks.length} chunks...`
        : `Generating ${extraction.chunks.length} embeddings with ${providerOption.name} (${providerOption.embeddingModel})...`
    );

    // Embed and insert in incremental batches of 20 to preserve progress
    const batchSize = provider === 'gemini' ? 20 : (provider === 'mock' ? 100 : 50);

    for (let i = 0; i < missingChunks.length; i += batchSize) {
      const currentBatch = missingChunks.slice(i, i + batchSize);
      const batchTexts = currentBatch.map((c) => c.content);

      onProgress?.(
        'embedding',
        `Embedding batch ${Math.floor(i / batchSize) + 1} (${i + 1}-${i + currentBatch.length} of ${missingChunks.length} remaining chunks)...`
      );

      const batchEmbeddings = await generateBatchEmbeddings(provider, apiKey, batchTexts);

      if (batchEmbeddings.length !== currentBatch.length) {
        throw new Error(`Embedding count mismatch: expected ${currentBatch.length}, got ${batchEmbeddings.length}`);
      }

      onProgress?.('saving', `Saving chunks ${i + 1}-${i + currentBatch.length} to pgvector...`);

      const rowsToInsert = currentBatch.map((chunk, idx) => {
        const emb = batchEmbeddings[idx];
        return {
          document_id: document.id,
          user_id: document.user_id,
          chunk_index: chunk.chunkIndex,
          page_number: chunk.pageNumber,
          content: chunk.content,
          embedding_768: provider === 'gemini' || provider === 'mock' ? emb : null,
          embedding_1536: provider === 'openai' ? emb : null,
          metadata: {
            page_number: chunk.pageNumber,
            char_count: chunk.content.length,
          },
        };
      });

      const { error: insertError } = await supabase.from('document_chunks').insert(rowsToInsert);
      if (insertError) {
        throw new Error(`Error saving chunks to pgvector: ${insertError.message}`);
      }

      // Update chunk_count on document as progress marker
      const currentSavedCount = existingChunkIndices.size + i + currentBatch.length;
      await supabase
        .from('documents')
        .update({
          chunk_count: currentSavedCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', document.id);
    }

    // 7. Update document status to ready
    const { data: updatedDoc, error: updateError } = await supabase
      .from('documents')
      .update({
        status: 'ready',
        page_count: extraction.totalPages,
        chunk_count: extraction.chunks.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', document.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to finalize document status: ${updateError.message}`);
    }

    onProgress?.('completed', 'Document indexed and ready for research!');
    return updatedDoc as DocumentRecord;
  } catch (err: unknown) {
    const rawError =
      err instanceof ProviderError
        ? `Provider Error: ${err.message}`
        : err instanceof Error
        ? err.message
        : 'Unknown error occurred during indexing';
    const errorMsg = sanitizeErrorMessage(rawError, apiKey);

    await supabase
      .from('documents')
      .update({
        status: 'failed',
        error_message: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', document.id);

    onProgress?.('failed', errorMsg);
    throw new Error(errorMsg);
  }
}

export async function indexDocument(
  file: File,
  provider: AIProvider,
  apiKey: string,
  onProgress?: IndexProgressCallback
): Promise<DocumentRecord> {
  const supabase = createClient();

  // 1. Client-side validations
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error('Only PDF documents are supported.');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds the 10MB limit (size: ${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
  }

  if (!apiKey.trim()) {
    throw new Error('Please connect your AI provider API key before indexing documents.');
  }

  // 2. Ensure user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User authentication session not found. Please log in.');
  }

  const providerOption = PROVIDER_OPTIONS[provider];
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `${user.id}/${Date.now()}-${safeName}`;

  onProgress?.('uploading', 'Uploading PDF to secure private storage...');

  // 3. Upload to private storage
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // 4. Create document row in DB with status 'indexing'
  const { data: docData, error: insertError } = await supabase
    .from('documents')
    .insert({
      user_id: user.id,
      name: file.name,
      file_path: storagePath,
      file_size: file.size,
      status: 'indexing',
      embedding_provider: provider,
      embedding_model: providerOption.embeddingModel,
    })
    .select()
    .single();

  if (insertError || !docData) {
    // Attempt cleanup if DB insert fails
    await supabase.storage.from('documents').remove([storagePath]);
    throw new Error(`Failed to create document record: ${insertError?.message || 'Database error'}`);
  }

  const document = docData as DocumentRecord;

  try {
    // 5. Extract text and page numbers
    onProgress?.('extracting', 'Extracting page text and building semantic chunks...');
    const buffer = await file.arrayBuffer();
    const extraction = await extractAndChunkPDF(buffer);

    if (extraction.isScannedOrEmpty || extraction.chunks.length === 0) {
      const emptyMsg =
        'No extractable text found in this PDF. It appears to be scanned or image-based. Scanned-PDF OCR is not supported; please upload a text-based PDF.';
      await supabase
        .from('documents')
        .update({ status: 'failed', error_message: emptyMsg })
        .eq('id', document.id);
      throw new Error(emptyMsg);
    }

    // 6. Generate embeddings and save chunks incrementally
    onProgress?.(
      'embedding',
      `Generating ${extraction.chunks.length} embeddings with ${providerOption.name} (${providerOption.embeddingModel})...`
    );

    const batchSize = provider === 'gemini' ? 20 : (provider === 'mock' ? 100 : 50);

    for (let i = 0; i < extraction.chunks.length; i += batchSize) {
      const currentBatch = extraction.chunks.slice(i, i + batchSize);
      const batchTexts = currentBatch.map((c) => c.content);

      onProgress?.(
        'embedding',
        `Embedding batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(extraction.chunks.length / batchSize)} (${i + 1}-${i + currentBatch.length} of ${extraction.chunks.length} chunks)...`
      );

      const batchEmbeddings = await generateBatchEmbeddings(provider, apiKey, batchTexts);

      if (batchEmbeddings.length !== currentBatch.length) {
        throw new Error(`Embedding count mismatch: expected ${currentBatch.length}, got ${batchEmbeddings.length}`);
      }

      onProgress?.('saving', `Saving chunks ${i + 1}-${i + currentBatch.length} to pgvector...`);

      const rowsToInsert = currentBatch.map((chunk, idx) => {
        const emb = batchEmbeddings[idx];
        return {
          document_id: document.id,
          user_id: user.id,
          chunk_index: chunk.chunkIndex,
          page_number: chunk.pageNumber,
          content: chunk.content,
          embedding_768: provider === 'gemini' || provider === 'mock' ? emb : null,
          embedding_1536: provider === 'openai' ? emb : null,
          metadata: {
            page_number: chunk.pageNumber,
            char_count: chunk.content.length,
          },
        };
      });

      const { error: chunkInsertError } = await supabase.from('document_chunks').insert(rowsToInsert);
      if (chunkInsertError) {
        throw new Error(`Error saving chunks to pgvector: ${chunkInsertError.message}`);
      }

      // Update chunk_count as progress marker
      await supabase
        .from('documents')
        .update({
          chunk_count: i + currentBatch.length,
          updated_at: new Date().toISOString(),
        })
        .eq('id', document.id);
    }

    // 8. Update document status to ready
    const { data: updatedDoc, error: updateError } = await supabase
      .from('documents')
      .update({
        status: 'ready',
        page_count: extraction.totalPages,
        chunk_count: extraction.chunks.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', document.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to finalize document status: ${updateError.message}`);
    }

    onProgress?.('completed', 'Document indexed and ready for research!');
    return updatedDoc as DocumentRecord;
  } catch (err: unknown) {
    const rawError =
      err instanceof ProviderError
        ? `Provider Error: ${err.message}`
        : err instanceof Error
        ? err.message
        : 'Unknown error occurred during indexing';
    const errorMsg = sanitizeErrorMessage(rawError, apiKey);

    // Mark document as failed in DB
    await supabase
      .from('documents')
      .update({
        status: 'failed',
        error_message: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', document.id);

    onProgress?.('failed', errorMsg);
    throw new Error(errorMsg);
  }
}
