# DocuDock — Project Status

## Project Overview
DocuDock is a polished, production-ready AI document research assistant built with Next.js App Router, TypeScript (strict mode), Tailwind CSS, Supabase (Google OAuth, PostgreSQL, Storage), and pgvector.

## Architecture Decisions & Constraints
- **Zero Host Cost (₹0)**: Free-tier Supabase, free Vercel hosting, 100% BYOK (Bring Your Own Key) for AI inference and embeddings.
- **In-Memory Key Security**: AI provider API keys (OpenAI / Google Gemini) reside purely in browser memory during an active session (`ProviderKeyContext`). They are NEVER persisted to localStorage, cookies, database, storage, or server logs.
- **Direct-to-Provider & Authenticated Postgres**: Browser generates embeddings using client-held API keys and communicates directly with Supabase via RLS-protected queries and pgvector similarity search RPCs (`match_document_chunks_768`, `match_document_chunks_1536`).
- **Strict Grounding & Verifiable Citations**: Every answer references `[DocumentName, p. X]`, backed by clickable citations that reveal the source passage and page via the interactive `CitationInspector`.

---

## Phase Checklist & Status: DONE (All 8 Phases Complete)

### Phase 1: Foundation & Project Setup
- [x] Initialized Next.js 16 with App Router, TypeScript, Tailwind CSS, ESLint.
- [x] Dependencies installed: `@supabase/supabase-js`, `@supabase/ssr`, `lucide-react`, `unpdf`.
- [x] Configured environment variable templates (`.env.example`).

### Phase 2: Database, Storage & Authentication Architecture
- [x] SQL migration `supabase/migrations/20261019000000_init_docudock.sql`:
  - `vector` and `uuid-ossp` extensions.
  - `documents` and `document_chunks` tables with HNSW cosine similarity indexes.
  - Row Level Security (RLS) policies for user isolation.
  - Private Supabase Storage bucket `documents` with owner-folder access policies.
  - Vector similarity search RPC functions: `match_document_chunks_768` (Gemini) and `match_document_chunks_1536` (OpenAI).
- [x] Supabase SSR clients: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`.
- [x] Route protection middleware (`src/middleware.ts`) and OAuth callback handler (`src/app/auth/callback/route.ts`).

### Phase 3: Provider Adapter & In-Memory Key Security
- [x] `ProviderKeyContext`: pure in-memory state store with test connection action, auto-disconnect, and sign-out wipe.
- [x] Provider adapter (`src/lib/ai/providers.ts`):
  - Google Gemini: `text-embedding-004` (768-dim) and `gemini-2.5-flash` with strict grounding prompts.
  - OpenAI: `text-embedding-3-small` (1536-dim) and `gpt-4o-mini` with strict grounding prompts.
- [x] Provider settings modal (`src/components/ProviderSettingsModal.tsx`) with live test connection, provider switching, and model details.

### Phase 4: Document Pipeline (PDF Extraction, Chunking, Indexing)
- [x] PDF extractor & chunker (`src/lib/pdf/extractor.ts`):
  - Preserves 1-based page numbers.
  - Generates overlapping chunks (~750 chars with 120 char overlap).
  - Detects scanned/empty PDFs (< 30 characters) and presents an informative notice.
- [x] Document management service (`src/lib/services/documentService.ts`):
  - 10MB file validation & PDF MIME check.
  - Upload to private storage, DB insertion, chunk embedding, and status transitions (`indexing` -> `ready` / `failed`).
  - Cascading deletion (deletes storage file, database row, and chunks).
  - Secure signed URL generator for in-browser PDF viewing.

### Phase 5: Workspace UI & RAG Search Experience
- [x] Refined dark modern research aesthetic with custom scrollbars and subtle borders.
- [x] Header (`src/components/Header.tsx`): provider connection pill, user account, and sign-out action.
- [x] Document sidebar (`src/components/DocumentSidebar.tsx`): drag-and-drop upload, status indicators, scope filter toggles, signed URL viewer, and deletion.
- [x] Central research area (`src/components/ResearchArea.tsx`): conversation stream, empty state with suggested research queries, copy answer action, and clickable citations.
- [x] Citation inspector (`src/components/CitationInspector.tsx`): slide-over panel displaying source document name, page number, similarity match percentage, and exact passage text.
- [x] Login page (`src/app/login/page.tsx`): minimal, dark, Google OAuth flow with setup guidance.

### Phase 6: Verification & Quality Checks
- [x] TypeScript compiler strict check passed (`npx tsc --noEmit` -> 0 errors).
- [x] ESLint passed (`npm run lint` -> 0 errors, 0 warnings).
- [x] Next.js production build passed (`npm run build` -> all static/dynamic routes compiled).
- [x] Comprehensive documentation in `README.md`.
