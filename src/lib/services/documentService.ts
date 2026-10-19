import { createClient } from '@/lib/supabase/client';
import { AIProvider, DocumentRecord } from '@/lib/types';
import { PROVIDER_OPTIONS, generateBatchEmbeddings, ProviderError } from '@/lib/ai/providers';
import { extractAndChunkPDF } from '@/lib/pdf/extractor';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB free-tier limit

export interface IndexProgressCallback {
  (step: 'uploading' | 'extracting' | 'embedding' | 'saving' | 'completed' | 'failed', message?: string): void;
}

export async function fetchUserDocuments(): Promise<DocumentRecord[]> {
  const supabase = createClient();
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

  // 1. Delete file from storage
  if (filePath) {
    const { error: storageError } = await supabase.storage.from('documents').remove([filePath]);
    if (storageError) {
      console.warn('Storage deletion warning:', storageError.message);
    }
  }

  // 2. Delete document row from DB (cascades to document_chunks)
  const { error: dbError } = await supabase.from('documents').delete().eq('id', documentId);
  if (dbError) {
    throw new Error(`Failed to delete document: ${dbError.message}`);
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

    // 6. Generate embeddings using user's in-memory key
    onProgress?.(
      'embedding',
      `Generating ${extraction.chunks.length} embeddings with ${providerOption.name} (${providerOption.embeddingModel})...`
    );

    const chunkTexts = extraction.chunks.map((c) => c.content);
    const embeddings = await generateBatchEmbeddings(provider, apiKey, chunkTexts);

    if (embeddings.length !== extraction.chunks.length) {
      throw new Error(`Embedding count mismatch: expected ${extraction.chunks.length}, got ${embeddings.length}`);
    }

    // 7. Insert chunks into document_chunks in batches of 50
    onProgress?.('saving', 'Storing vector embeddings and page references in pgvector...');
    const batchSize = 50;

    for (let i = 0; i < extraction.chunks.length; i += batchSize) {
      const chunkBatch = extraction.chunks.slice(i, i + batchSize);
      const embeddingBatch = embeddings.slice(i, i + batchSize);

      const rowsToInsert = chunkBatch.map((chunk, idx) => {
        const emb = embeddingBatch[idx];
        return {
          document_id: document.id,
          user_id: user.id,
          chunk_index: chunk.chunkIndex,
          page_number: chunk.pageNumber,
          content: chunk.content,
          embedding_768: provider === 'gemini' ? emb : null,
          embedding_1536: provider === 'openai' ? emb : null,
          metadata: {
            page_number: chunk.pageNumber,
            char_count: chunk.content.length,
          },
        };
      });

      const { error: chunkInsertError } = await supabase
        .from('document_chunks')
        .insert(rowsToInsert);

      if (chunkInsertError) {
        throw new Error(`Error saving chunks to pgvector: ${chunkInsertError.message}`);
      }
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
    const errorMsg =
      err instanceof ProviderError
        ? `Provider Error: ${err.message}`
        : err instanceof Error
        ? err.message
        : 'Unknown error occurred during indexing';

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
