# DocuDock — AI Document Research Assistant

DocuDock is a dark, modern, and focused AI document research assistant. It allows users to privately upload PDF documents, extract and chunk text with preserved page numbers, generate vector embeddings, and ask research questions that yield grounded answers with verifiable page-level citations.

---

## Key Features

- **Strict Retrieval-Augmented Generation (RAG)**: Answers are derived exclusively from indexed passages. Claims include citations in `[DocumentName, p. X]` format. If evidence is lacking, the assistant explicitly states it.
- **Interactive Citation Inspector**: Clicking any citation opens a detail view displaying the source excerpt, document name, page number, and semantic similarity score.
- **In-Memory Key Security (Zero Key Storage)**: Provider API keys (Google Gemini / OpenAI) reside exclusively in browser memory. They are **never** persisted to databases, localStorage, cookies, or server logs, and are wiped on disconnect or sign-out.
- **Zero Owner Cost (₹0 Hosting & Inference)**:
  - Free Vercel hosting
  - Free-tier Supabase (PostgreSQL + pgvector + Auth + Storage)
  - Bring-Your-Own-Key (BYOK) for inference and embeddings
- **Dual AI Provider Support**:
  - **Google Gemini**: `gemini-embedding-001` (768-dim embeddings) & `gemini-3.8-flash`
  - **OpenAI**: `text-embedding-3-small` (1536-dim embeddings) & `gpt-4o-mini`
- **Private Storage & Row Level Security (RLS)**: Documents and embeddings are scoped to the authenticated user via PostgreSQL Row Level Security and private Supabase storage policies.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   Browser Client                       │
│  - In-Memory Key Store (ProviderKeyContext)            │
│  - PDF Text Extraction & Page Tracking (unpdf)         │
│  - Semantic Text Chunker (600-800 chars + overlap)     │
│  - Direct Provider Calls (Embeddings & Completions)    │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
  Direct BYOK   │                        │ Supabase Auth (JWT) & RLS
  API Calls     │                        │
┌───────────────▼────────┐      ┌────────▼───────────────┐
│ AI Provider APIs       │      │ Supabase Cloud         │
│ - Google Gemini API    │      │ - Google OAuth         │
│ - OpenAI API           │      │ - Private Storage      │
│                        │      │ - PostgreSQL + pgvector│
└────────────────────────┘      │ - Vector RPC Functions │
                                └────────────────────────┘
```

---

## Setup & Configuration Checklist

### 1. Supabase Project Setup
1. Create a free project at [supabase.com](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase project dashboard.
3. Open `supabase/migrations/20261019000000_init_docudock.sql` from this repository, paste the contents into the SQL Editor, and click **Run**.
   - This enables the `vector` and `uuid-ossp` extensions.
   - Creates the `documents` and `document_chunks` tables with HNSW cosine similarity indexes.
   - Configures strict Row Level Security (RLS) policies.
   - Creates the `documents` storage bucket with owner-scoped policies.
   - Creates the `match_document_chunks_768` and `match_document_chunks_1536` search functions.

### 2. Configure Google OAuth in Supabase
1. In the Supabase Dashboard, go to **Authentication** > **Providers** > **Google**.
2. Follow the Supabase instructions to create OAuth 2.0 Credentials in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
3. Set the **Authorized redirect URI** in Google Cloud Console to:
   ```
   https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
   ```
4. Copy the Client ID and Client Secret into Supabase and toggle Google to **Enabled**.

### 3. Environment Variables
Create a `.env.local` file in the project root (see `.env.example`):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 4. Run Locally
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```
Navigate to `http://localhost:3000`.

---

## Deployment (Vercel)

1. Push this repository to GitHub or import it into [Vercel](https://vercel.com).
2. In the Vercel project settings, add the two environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Under Supabase Dashboard > **Authentication** > **URL Configuration**:
   - Set **Site URL** to `https://your-vercel-deployment.vercel.app`
   - Add `https://your-vercel-deployment.vercel.app/**` to **Redirect URLs**.
4. Deploy the project. The build runs `next build` with TypeScript strict checks.

---

## Usage Workflow

1. **Sign In**: Land on `/login` and sign in using Google OAuth.
2. **Connect AI Key**: In the top-right header, click **Connect AI Key**. Choose Google Gemini or OpenAI and paste your personal API key. Click **Test & Connect** to verify connectivity.
3. **Upload PDF**: In the sidebar, drag and drop or browse for a PDF (up to 10MB).
   - Text is parsed page-by-page.
   - Chunks are vectorized using your active provider key.
   - Embeddings and page references are stored in PostgreSQL with pgvector.
4. **Ask Questions**: Type your research question into the central chat.
   - Your question is embedded and matched against pgvector.
   - Grounded answers are generated with citations like `[Report.pdf, p. 4]`.
   - Click any citation to inspect the retrieved excerpt.

---

## Known Boundaries & Error Handling

- **Scanned PDFs**: Scanned image-only PDFs containing no extractable text are identified immediately during upload, and the user is guided to upload a text-based PDF.
- **File Size Limit**: Uploads are restricted to 10MB to maintain free-tier compatibility.
- **Provider Quota Exceeded**: 429 quota errors from AI providers are caught and displayed clearly with actionable messages.
- **Key Disconnect**: Clicking "Disconnect Key" or signing out instantly purges the API key from browser memory.
