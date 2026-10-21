-- DocuDock Initial Migration
-- PostgreSQL with pgvector, Document management, and RLS policies

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create documents table
CREATE TABLE IF NOT EXISTS public.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    file_path text NOT NULL,
    file_size bigint NOT NULL,
    page_count int DEFAULT 0,
    status text NOT NULL DEFAULT 'indexing' CHECK (status IN ('indexing', 'ready', 'failed')),
    error_message text,
    embedding_provider text NOT NULL CHECK (embedding_provider IN ('gemini', 'openai')),
    embedding_model text NOT NULL,
    chunk_count int DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Create document_chunks table
CREATE TABLE IF NOT EXISTS public.document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chunk_index int NOT NULL,
    page_number int NOT NULL,
    content text NOT NULL,
    embedding_768 vector(768),
    embedding_1536 vector(1536),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Create indexes for performance and security
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON public.document_chunks(user_id);

-- Vector indexes using HNSW (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_chunks_vec_768 ON public.document_chunks USING hnsw (embedding_768 vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_vec_1536 ON public.document_chunks USING hnsw (embedding_1536 vector_cosine_ops);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- 6. Define RLS Policies for documents
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
CREATE POLICY "Users can view own documents"
    ON public.documents FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
CREATE POLICY "Users can insert own documents"
    ON public.documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
CREATE POLICY "Users can update own documents"
    ON public.documents FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can delete own documents"
    ON public.documents FOR DELETE
    USING (auth.uid() = user_id);

-- 7. Define RLS Policies for document_chunks
DROP POLICY IF EXISTS "Users can view own chunks" ON public.document_chunks;
CREATE POLICY "Users can view own chunks"
    ON public.document_chunks FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own chunks" ON public.document_chunks;
CREATE POLICY "Users can insert own chunks"
    ON public.document_chunks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own chunks" ON public.document_chunks;
CREATE POLICY "Users can update own chunks"
    ON public.document_chunks FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own chunks" ON public.document_chunks;
CREATE POLICY "Users can delete own chunks"
    ON public.document_chunks FOR DELETE
    USING (auth.uid() = user_id);

-- 8. Storage bucket creation for documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 10485760, ARRAY['application/pdf']::text[])
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf']::text[];

-- Storage policies: Owner scoped by folder name (user_id/filename.pdf)
DROP POLICY IF EXISTS "Users can upload own documents to storage" ON storage.objects;
CREATE POLICY "Users can upload own documents to storage"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Users can read own documents from storage" ON storage.objects;
CREATE POLICY "Users can read own documents from storage"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Users can update own documents in storage" ON storage.objects;
CREATE POLICY "Users can update own documents in storage"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Users can delete own documents from storage" ON storage.objects;
CREATE POLICY "Users can delete own documents from storage"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- 9. Trigger for automatic updated_at timestamp on documents
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_documents_updated_at ON public.documents;
CREATE TRIGGER set_documents_updated_at
    BEFORE UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 10. RPC Functions for vector retrieval
-- 10a. Vector search for 768 dimensions (Google Gemini gemini-embedding-001)
CREATE OR REPLACE FUNCTION match_document_chunks_768 (
    query_embedding vector(768),
    match_threshold float DEFAULT 0.0,
    match_count int DEFAULT 6,
    filter_document_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    document_name text,
    chunk_index int,
    page_number int,
    content text,
    similarity float
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        d.name AS document_name,
        c.chunk_index,
        c.page_number,
        c.content,
        (1 - (c.embedding_768 <=> query_embedding))::float AS similarity
    FROM public.document_chunks c
    INNER JOIN public.documents d ON c.document_id = d.id
    WHERE c.user_id = auth.uid()
      AND (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
      AND c.embedding_768 IS NOT NULL
      AND (1 - (c.embedding_768 <=> query_embedding)) > match_threshold
    ORDER BY c.embedding_768 <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

-- 9b. Vector search for 1536 dimensions (OpenAI text-embedding-3-small)
CREATE OR REPLACE FUNCTION match_document_chunks_1536 (
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.0,
    match_count int DEFAULT 6,
    filter_document_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    document_name text,
    chunk_index int,
    page_number int,
    content text,
    similarity float
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        d.name AS document_name,
        c.chunk_index,
        c.page_number,
        c.content,
        (1 - (c.embedding_1536 <=> query_embedding))::float AS similarity
    FROM public.document_chunks c
    INNER JOIN public.documents d ON c.document_id = d.id
    WHERE c.user_id = auth.uid()
      AND (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
      AND c.embedding_1536 IS NOT NULL
      AND (1 - (c.embedding_1536 <=> query_embedding)) > match_threshold
    ORDER BY c.embedding_1536 <=> query_embedding ASC
    LIMIT match_count;
END;
$$;
