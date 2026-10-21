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
- **Browser-Local Encrypted Key Vault (Web Crypto API & IndexedDB)**:
  - **Cryptographic Specifications**:
    - **Encryption**: AES-GCM (256-bit) authenticated encryption with associated data (AEAD).
    - **Initialization Vector (IV)**: Fresh cryptographically random 96-bit (12-byte) IV for every encryption via `crypto.getRandomValues`. Zero IV reuse or replay vulnerability.
    - **Key Derivation (KDF)**: PBKDF2-HMAC-SHA-256 with fresh random 16-byte (128-bit) salt per record and **600,000 iterations** (OWASP recommended standard for PBKDF2 in modern browsers).
    - **Non-Extractable Keys**: Derived `CryptoKey` objects are instantiated with `extractable: false`, preventing in-memory export.
    - **Storage**: IndexedDB (`docudock_vault_db`), storing exclusively ciphertext, IV, salt, iterations, and non-secret metadata (createdAt, updatedAt, algorithm, kdf, version).
    - **Zero Remote Storage / Zero Plaintext Persistence**: Plaintext keys and vault passwords NEVER touch disk, logs, cookies, local/session storage, or network requests.
  - **Provider Isolation**:
    - Gemini and OpenAI keys are managed independently with clear UI provider labels. Users can store both, update either individually, or delete selectively.
  - **Lifecycle & Security State Management**:
    - **Startup**: Vault is strictly **LOCKED** on application load and page reload. No decrypted keys exist in React state until the user enters their password.
    - **Unlocked**: Keys reside strictly in volatile JavaScript memory while unlocked.
    - **Locking**: 1-click Lock button in the Header and Provider Settings immediately purges decrypted keys, resets active API keys, marks provider disconnected, and invalidates model caches.
    - **Sign-Out**: Signing out automatically locks the vault and purges all memory keys before ending the Supabase session.
  - **Honest Threat Model & Security Boundaries**:
    - **At-Rest Protection**: Protects stored credentials against offline device theft, local disk forensics, unencrypted browser profile backups, and unauthorized physical access to the device.
    - **Direct Provider Routing**: API calls route directly from the browser to Google AI Studio or OpenAI; credentials never route through DocuDock servers or Supabase.
    - **In-Memory Limitations & Honest Boundary**: When the vault is unlocked in an active browser tab, decrypted keys reside in JavaScript memory. Browser-local encryption **cannot** protect against malicious browser extensions with script injection permissions on the origin, or same-origin Cross-Site Scripting (XSS) vulnerabilities while the tab is active. Users are advised to lock the vault when not actively researching.
  - **Offline Key Vault Test Suite (`scripts/test-key-vault.mjs` / `npm run test:vault`)**:
    - **15/15 tests passing (100%)**.
    - Verifies round trips, unique IV/salt generation, 600,000 PBKDF2 iterations execution, incorrect password rejection, bit-tampering AEAD rejection, corrupted IV rejection, storage serialization zero-plaintext assertions, multi-provider lifecycle, and memory purge.

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
- **AI Provider Integrations, Quota Resilience & Provider Hardening**:
  - Direct browser REST requests to Gemini and OpenAI with intelligent error handling, exponential backoff (with 15–30% jitter), and parsing of Google's RPC `RetryInfo` / HTTP `Retry-After` headers.
  - **Dynamic Model Discovery, Proactive Binding & Auto-Failover (`discoverAndVerifyGeminiChatModel`)**: Direct metadata query against `v1beta/models` eliminates guessing without firing pre-query test generation pings. Automatically binds verified working models (`gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`, etc.).
  - **HTTP 404/503 Resilience & Model Failover**: If a selected model encounters a 404 (model deprecated or unavailable) or 503 (model overloaded), the system invalidates the model cache and executes a dynamic multi-attempt failover to alternative preferred candidates, while displaying sanitized provider error details without key exposure.
  - **Provider Reliability & Fault Tolerance (`scripts/test-provider-reliability.mjs` / `npm run test:reliability`)**:
    - **42/42 tests passing (100%)**.
    - **Capability & Modality-Based Model Filtering (`isCompatibleGeminiTextModel` & `isCompatibleGeminiEmbeddingModel`)**: Strictly validates `supportedGenerationMethods` (`generateContent` vs `embedContent`) and declared output modalities (`TEXT` vs `AUDIO`/`IMAGE`), completely isolating text generation from embedding, TTS (e.g. `gemini-2.5-flash-preview-tts`, `gemini-3.8-flash-tts`), live streaming (`gemini-3.8-live`), transcribe (`gemini-3.5-transcribe`), image generation (`gemini-3.1-flash-image`), video (`gemini-omni-1.1-flash`), and embedding-only models.
    - **HTTP 503 Overload Resilience, Bounded Jittered Backoff & Overload Cooldown Cache (`modelCache.ts` & `providers.ts`)**:
      - Incorporates bounded single-retry exponential backoff with 15–30% random jitter (`maxOverloadRetries = 1`) on HTTP 503 `UNAVAILABLE` before failing over, allowing momentary blips to recover without burning model failover quota.
      - Maintains an in-memory negative cooldown tracker (`recordOverloadedModel(model, cooldownMs)` with default 3-minute TTL) across model families and their aliases (`2.5-flash`, `2.0-flash`, `1.5-flash`, etc.).
      - Prevents the "dead-model retry loop": when a model encounters 503, clicking "Retry Query" or submitting subsequent questions immediately skips the overloaded model family in favor of healthy alternatives (`gemini-2.0-flash`, `gemini-1.5-flash`), rather than repeatedly discovering and selecting the same overloaded model.
      - Strictly bounds multi-model failover to `maxFailovers = 2` (maximum 3 distinct models attempted).
      - If all available Gemini models are simultaneously overloaded upstream, presents an honest, transparent capacity error message explaining that Google AI Studio servers are experiencing high demand across all attempted models without leaking secrets.
    - **Idempotent Error Classification & Zero-Nesting UI Formatting (`classifyProviderError` & `extractCleanProviderDetails`)**: Sanitizes error messages and strips nested template wrappers so provider errors display once cleanly without repeated duplicate parentheses, preserving useful HTTP status and model details while ensuring zero API key exposure.
    - Explicit detection and handling of 11 distinct error categories (`invalid_key`, `overloaded`, `rate_limit`, `quota_exhausted`, `blocked`, `empty`, `not_found`, `server_error`, `network`, `timeout`, `generic`), including modality mismatch classification as `switch_model`.
    - Granular discrimination between transient rate limits (HTTP 429) and hard quota exhaustion (daily project limit reached / `limit 0`); hard exhaustion terminates immediately without useless retry delays.
    - Safety policy and prompt blocking: checks `promptFeedback.blockReason` and candidate finish reasons (`SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, and OpenAI `content_filter`) before extracting text, preventing false `"Gemini did not return any text response"` errors.
    - Multi-part content concatenation prevents dropping non-zero text parts, and filters internal model thinking tokens (`thought: true`).
    - Zero-leak API key sanitization (`sanitizeErrorMessage`): strips Google `AIzaSy...`, OpenAI `sk-...`, URL query parameter `?key=...`, and `Bearer ...` tokens from all UI banners, database error messages, and error logs.
    - Smart manual retry: dedupes queries, strips failed error cards, and prevents duplicate user questions.
    - Production lockdown: Mock provider is strictly blocked when `process.env.NODE_ENV === 'production'`.
  - **Distinct UI Error Rendering**: API errors and model errors are styled in high-visibility alert cards with distinct action buttons (Retry Query, Update API Key, Check Quota Dashboard).
  - Resolved Gemini free tier rate limit (`embed_content_free_tier_requests` 100/min quota) by switching to controlled batch embedding (`batchEmbedContents`, batch size 20, 650ms inter-batch pacing).
  - Fully resumable document indexing: preserves valid embeddings already in pgvector, only requests missing chunk embeddings, and inserts incrementally in batches of 20.
  - Safe duplicate and storage management: 1-click **"Clean Duplicates"** button in sidebar header cleans stale duplicate entries without affecting the Ready document or its Supabase Storage binary.
- **Repeatable RAG Evaluation Suite (`scripts/eval-rag.mjs` / `npm run test:rag`)**:
  - 20 benchmark test cases spanning: Factual Recall, Cross-Page Synthesis, Numerical Calculations, Unanswerable Questions (Abstention), False Premises (Refutation), and Confusable Concepts.
  - Verifies citations against raw extracted chunk text from physical PDF pages.
  - **100% Pass Rate (20/20 test cases passing)**.
  - Suppressed misleading citation chips on `insufficientEvidence` responses so empty/abstaining queries do not present irrelevant sources.
- **AI Answer Readability & Mathematical Formatting (`src/components/FormattedAnswer.tsx`)**:
  - High-fidelity Markdown rendering: hierarchical headings (`#`, `##`, `###`), structured lists, blockquotes, inline formatting, and dark-themed responsive tables.
  - Proper mathematical expression rendering using KaTeX: handles display math (`$$...$$`, `\[...\]`) and inline math (`$...$`, `\(...\)`).
  - Graceful plain-text fallback engine (`latexToPlainTextFallback`): transforms LaTeX commands into readable expressions (e.g. `Alpha = (1 / 8) = 0.125`) if KaTeX parsing fails or is malformed.
  - Structured numerical solutions: clear separation of Given Data / Retrieved Facts, Assumptions, Step-by-Step Derivation (Formula, Substitution, Calculation, Final Answer), and Conclusion.
  - Descriptive variable labels: replaces raw acronyms with human-friendly labels (e.g., **Previous Estimated RTT** alongside $ERTT_{prev}$).
  - Fully interactive citation buttons (`[DocName, p. X]`) with hover tooltips and integrated source-inspector panel trigger.
  - Fenced code blocks with language badges and 1-click clipboard copying.
  - Dedicated formatting validation suite (`scripts/test-formatting.mjs` / `npm run test:formatting`): **7/7 tests passed**.

---

- **Live PostgreSQL & pgvector**: **Verified live against Supabase**. Tables `documents` and `document_chunks`, HNSW cosine distance indexes, and vector RPC functions `match_document_chunks_768` and `match_document_chunks_1536` are active and operational.
- **Live Private Storage**: **Verified live against Supabase**. Bucket `documents` is active, private (`public = false`), enforces 10MB limit and `application/pdf`, with 4 owner-scoped RLS policies.
- **Live Google OAuth Handshake**: **Verified live**. Calling Supabase OAuth initiates a 302 redirect directly to `https://accounts.google.com/o/oauth2/v2/auth`.
- **Live Development Server & Route Protection**: **Verified live**. Next.js App Router server is running on `http://localhost:3000`. Unauthenticated requests to `/` and `/workspace` cleanly redirect to `/login` with HTTP 307.

---

## 2. Pending Actions at Runtime

- **User Google Account Consent**: Complete the browser-based Google account selection once at `http://localhost:3000/login`.
- **User AI Provider API Key**: Provide personal Google AI Studio or OpenAI API key in the workspace settings modal to index documents and generate grounded answers.

---

## 3. Known Limitations

1. **Scanned & Image-Based PDFs**: DocuDoc does not include OCR for scanned or image-only PDFs. PDFs without extractable text are rejected with an explicit notice to upload a text-based document.
2. **File Size Limit**: Uploads are capped at 10MB to maintain free-tier compatibility on Supabase Storage.
3. **Session Volatility vs. Vault Storage**: In pure ephemeral BYOK mode, refreshing or closing the browser tab requires re-entering the key. Users who prefer persistent security can store their keys in the browser-local AES-256-GCM Encrypted Key Vault, which safely persists encrypted credentials across reloads and only requires entering their local vault password upon opening DocuDock.
4. **Cross-Model Indexing**: Chunks embedded with Gemini (768-dim) cannot be queried using an OpenAI key (1536-dim); users must re-index documents if they switch providers.
5. **Gemini Free-Tier Rate Limits on Large PDFs**: The Google AI Studio free tier limits `embed_content` to 100 requests/minute. Large PDFs (>100 chunks) automatically pace batches with backoff pauses.

---

## 4. Current Setup Status

1. **Supabase Database & Storage**: Configured and verified.
2. **Google OAuth**: Configured and verified.
3. **Local Environment**: `.env.local` configured.
4. **Dev Server**: Running at `http://localhost:3000`.
5. **Production Deployment**: Live at `https://docudock.vercel.app` (Vercel Hobby Free Tier).

