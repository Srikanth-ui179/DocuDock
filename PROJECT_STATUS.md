# DocuDock — Implementation Review & Project Status

**Date of Review**: 2026-10-19  
**Product**: DocuDock — AI Document Research Assistant  
**Architecture**: Next.js App Router (Turbopack), TypeScript strict mode, Tailwind CSS v4, Supabase (OAuth, PostgreSQL, Storage, pgvector), BYOK In-Memory AI Inference.

---

## 1. Verified Functionality (Code-Level & Build Verified)

- **Static Analysis & Build Quality**:
  - `npm run lint` (ESLint 9): **Passed with 0 errors and 0 warnings**.
  - `npx tsc --noEmit` (TypeScript strict mode): **Passed with 0 errors**.
  - `npm run build` (Next.js 16.4.2 production bundle): **Compiled and generated all static and dynamic routes cleanly in ~1.3s**.
- **Auth & Protected Routes Architecture**:
  - Route protection middleware (`src/lib/supabase/middleware.ts` and `src/middleware.ts`) protects `/workspace` and redirects unauthenticated traffic to `/login` using secure `supabase.auth.getUser()`.
  - Refreshed session cookies are preserved across redirects.
  - Supabase OAuth exchange endpoint (`src/app/auth/callback/route.ts`) parses authentication codes and establishes user sessions.
- **In-Memory Key Security & Zero Persistence**:
  - Provider keys reside purely within React component state in `ProviderKeyContext.tsx`.
  - Audited codebase: zero occurrences of `localStorage`, `sessionStorage`, cookies, server files, or application logs storing or logging provider API keys.
  - Keys are explicitly purged on disconnect and sign-out.
- **Database Schema & Vector Architecture**:
  - `supabase/migrations/20261019000000_init_docudock.sql` defines:
    - `vector` and `uuid-ossp` extensions.
    - `documents` and `document_chunks` with HNSW cosine distance indexing (`vector_cosine_ops`).
    - Multi-provider vector columns: `embedding_768` (Google Gemini) and `embedding_1536` (OpenAI).
    - Idempotent `DROP POLICY IF EXISTS` and RLS policies ensuring users can only read, write, or delete their own rows (`auth.uid() = user_id`).
    - Private `documents` storage bucket with owner-isolated policies (`(storage.foldername(name))[1] = auth.uid()::text`).
    - Vector similarity RPCs `match_document_chunks_768` and `match_document_chunks_1536` using `SECURITY INVOKER` to guarantee RLS enforcement.
- **PDF Extraction & Chunking**:
  - Serverless/browser compatible page extraction via `unpdf`.
  - Preserves 1-based page numbers across chunks.
  - Automatic scanned/empty PDF detection (< 30 characters).
  - Semantic sliding-window chunking (600–800 characters with 120 character overlap).
- **AI Provider Integrations**:
  - Direct browser REST requests to Gemini and OpenAI with error handling for quota limits (HTTP 429) and invalid keys (HTTP 401/403).
  - Explicit model alignment: Google Gemini uses active `gemini-embedding-001` with `outputDimensionality: 768` and `gemini-2.5-flash`; OpenAI uses `text-embedding-3-small` (1536-dim) and `gpt-4o-mini`.

---

## 2. Unverified Integrations (Pending External Credentials)

The following integrations are implemented in code but have **not** been run against live third-party cloud services because external credentials have not yet been provided:
- **Live Supabase Google OAuth**: Requires active `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and Google Cloud OAuth client credentials in Supabase.
- **Live PostgreSQL / pgvector Storage**: Requires applying the migration script to an active Supabase database.
- **Live OpenAI / Google Gemini API Calls**: Requires entering a valid user API key into the in-memory settings modal in a running browser session.

---

## 3. Known Limitations

1. **Scanned & Image-Based PDFs**: DocuDoc does not include OCR for scanned or image-only PDFs. PDFs without extractable text are rejected with an explicit notice to upload a text-based document.
2. **File Size Limit**: Uploads are capped at 10MB to maintain free-tier compatibility on Supabase Storage.
3. **Session Volatility**: Because provider keys are held in volatile browser memory for security, refreshing or closing the browser tab requires re-entering the API key.
4. **Cross-Model Indexing**: Chunks embedded with Gemini (768-dim) cannot be queried using an OpenAI key (1536-dim); users must re-index documents if they switch providers.

---

## 4. Remaining Manual Setup Steps

To activate live testing, complete these steps:

1. **Apply Migration to Supabase**:
   - Go to your [Supabase Dashboard](https://supabase.com/dashboard) > **SQL Editor**.
   - Paste and run `supabase/migrations/20261019000000_init_docudock.sql`.
2. **Enable Google OAuth Provider**:
   - In Supabase Dashboard > **Authentication** > **Providers**, enable **Google**.
   - Enter your Google OAuth Client ID and Secret from Google Cloud Console.
   - Add redirect URL: `https://<your-supabase-project-id>.supabase.co/auth/v1/callback`.
3. **Configure Local Environment**:
   - Create a `.env.local` file in the project root:
     ```env
     NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
     ```
4. **Run and Verify**:
   - Execute `npm run dev`.
   - Open `http://localhost:3000` to complete the sign-in and document research workflow.
