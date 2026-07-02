# مساعد إجابات الواجبات — Homework Answer Assistant

A full-stack Next.js 16 web application that helps university students find answers to homework questions. Students type, paste, upload an image, or upload a PDF; the system searches approved course-file answers first, then falls back to a clearly-labelled AI-generated answer. No student accounts required.

---

## Key Features

| Area | Details |
|---|---|
| **Student flow** | Category → Specialization (CCI only) → Level → Course → Assignment → Question |
| **Input methods** | Free text, image upload / Ctrl+V paste (PNG/JPG/WEBP), PDF drag-and-drop |
| **Multi-question** | Splits, numbers, and answers every question separately |
| **Search** | Hybrid: exact + keyword (Jaccard) + fuzzy (Levenshtein) + semantic (pgvector in production) |
| **Fallback** | AI-generated answer when no approved match meets the confidence threshold |
| **Languages** | Arabic-first RTL + English LTR toggle, saved in localStorage |
| **Themes** | Light / dark mode, saved in localStorage |
| **Admin dashboard** | Stats, Categories, Specializations, Levels, Courses, Assignments, Files, Q/A Review, AI Review |
| **Demo Mode** | Runs fully offline — no API keys needed |
| **Security** | IP rate-limiting, MIME/size/page-count validation, private storage, RLS, service-role key never exposed to browser |

---

## Tech Stack

- **Framework** — Next.js 16 App Router, TypeScript
- **Styling** — Tailwind CSS v4, custom CSS-variable design tokens
- **Database / Auth / Storage** — Supabase (PostgreSQL + pgvector + Auth + private Storage)
- **Search** — In-process hybrid (Levenshtein + Jaccard) for demo; `match_questions()` SQL function with pgvector for production
- **AI** — Anthropic Claude (model strings configurable via env vars; swap-able provider layer)
- **Markdown** — react-markdown, remark-gfm, remark-math, rehype-katex, react-syntax-highlighter
- **Validation** — Zod
- **i18n** — Lightweight custom context provider (AR + EN JSON dictionaries)
- **Icons** — lucide-react

---

## Project Structure

```
homework-assistant/
├── src/
│   ├── app/
│   │   ├── page.tsx                              # Homepage — category cards
│   │   ├── category/[slug]/page.tsx              # Specializations or direct courses
│   │   ├── specialization/[specId]/page.tsx      # Academic levels
│   │   ├── level/[levelId]/page.tsx              # Courses for a level
│   │   ├── course/[courseId]/page.tsx            # Assignments for a course
│   │   ├── assignment/[assignmentId]/page.tsx    # Question input + results
│   │   ├── admin/
│   │   │   ├── login/page.tsx
│   │   │   ├── page.tsx                          # Redirects to dashboard
│   │   │   └── (protected)/
│   │   │       ├── layout.tsx                    # Session guard
│   │   │       ├── dashboard / categories / specializations
│   │   │       ├── levels / courses / assignments
│   │   │       ├── files / questions-review / ai-review
│   │   └── api/
│   │       ├── config/route.ts
│   │       ├── search/route.ts                   # Main student endpoint
│   │       └── admin/  (categories, courses, files, questions, ai-answers, stats …)
│   ├── components/
│   │   ├── admin/admin-shell.tsx
│   │   ├── providers/  (ThemeProvider, LocaleProvider)
│   │   └── shared/  (breadcrumbs, markdown-answer, result-card, processing-steps …)
│   ├── lib/
│   │   ├── admin-auth.ts     # Session helpers (Supabase + demo cookie)
│   │   ├── admin-store.ts    # In-memory store (demo mode)
│   │   ├── ai.ts             # AI provider abstraction
│   │   ├── config.ts         # Environment variable access
│   │   ├── demo-data.ts      # Seed data
│   │   ├── extract.ts        # PDF / image text extraction
│   │   ├── i18n/             # AR + EN dictionaries + provider
│   │   ├── question-splitter.ts
│   │   ├── rate-limit.ts
│   │   ├── search.ts         # Hybrid search engine
│   │   ├── supabase/         # Browser + server clients
│   │   └── types.ts
│   └── middleware.ts         # /admin route protection
├── supabase/
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   ├── 0002_rls_policies.sql
│   │   └── 0003_search_function.sql
│   └── seed/seed.sql
├── .env.example
├── .gitignore
└── README.md
```

---

## Local Setup (Demo Mode — no external services)

```bash
cd homework-assistant
npm install
cp .env.example .env.local
# Keep DEMO_MODE=true, leave Supabase/AI_API_KEY empty
npm run dev
```

Open **http://localhost:3000**.

**Demo admin credentials:**

| Field | Value |
|---|---|
| URL | http://localhost:3000/admin/login |
| Email | `admin@example.com` |
| Password | `ChangeMe123!` |

Change these via `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env.local`.

---

## Supabase Setup (Production)

1. Create a project at https://supabase.com.
2. Copy credentials from **Settings → API** into `.env.local`.
3. Run migrations in order (Supabase SQL Editor or CLI):
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_rls_policies.sql`
   - `supabase/migrations/0003_search_function.sql`
4. Run the seed: `supabase/seed/seed.sql`
5. Set `DEMO_MODE=false`.

**Supabase CLI:**
```bash
supabase link --project-ref YOUR_REF
supabase db push
psql "$(supabase db connection-string)" -f supabase/seed/seed.sql
```

---

## Creating the Admin Account

### With Supabase Auth

1. Dashboard → **Authentication → Users → Invite user** → enter admin email.
2. After the user accepts, add them to the `admins` table:

```sql
insert into public.admins (id, email, full_name)
values (
  (select id from auth.users where email = 'owner@example.com'),
  'owner@example.com',
  'Owner'
);
```

### Demo Mode

Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env.local`. Use a strong password for any internet-facing deployment.

---

## AI API Key Setup

```env
# .env.local
AI_API_KEY=sk-ant-...
AI_ANSWER_MODEL=claude-sonnet-4-6
AI_VISION_MODEL=claude-sonnet-4-6
DEMO_MODE=false
```

To swap AI providers, edit `src/lib/ai.ts` and `src/lib/extract.ts` — all prompts and HTTP calls are isolated there.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEMO_MODE` | No | auto | `true` forces demo mode; auto-enabled when `AI_API_KEY` is empty |
| `NEXT_PUBLIC_SUPABASE_URL` | Prod | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod | — | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod | — | **Server-only** secret — never prefix `NEXT_PUBLIC_` |
| `ADMIN_EMAIL` | Demo | `admin@example.com` | Demo-mode admin email |
| `ADMIN_PASSWORD` | Demo | `ChangeMe123!` | Demo-mode admin password |
| `AI_API_KEY` | Prod | — | **Server-only** AI provider key |
| `AI_ANSWER_MODEL` | No | `claude-sonnet-4-6` | Answer generation model |
| `AI_VISION_MODEL` | No | `claude-sonnet-4-6` | PDF/image OCR model |
| `AI_EMBEDDING_MODEL` | No | `text-embedding-3-small` | Embedding model |
| `MAX_UPLOAD_SIZE_MB` | No | `15` | Max upload in MB |
| `MAX_PDF_PAGES` | No | `10` | Max PDF pages |
| `MAX_QUESTIONS_PER_REQUEST` | No | `10` | Max questions per submission |
| `RATE_LIMIT_COUNT` | No | `20` | Requests per window |
| `RATE_LIMIT_WINDOW_SECONDS` | No | `600` | Rate-limit window (seconds) |
| `SEARCH_CONFIDENCE_THRESHOLD` | No | `0.78` | Min score to use an approved answer |
| `AI_TIMEOUT_MS` | No | `30000` | AI request timeout |
| `FILE_PROCESSING_TIMEOUT_MS` | No | `60000` | File processing timeout |

---

## Running Migrations & Seeding

```bash
# Supabase CLI
supabase db push

# Manual (Supabase SQL Editor — run in order)
# 1. supabase/migrations/0001_initial_schema.sql
# 2. supabase/migrations/0002_rls_policies.sql
# 3. supabase/migrations/0003_search_function.sql
# 4. supabase/seed/seed.sql  (optional demo data)
```

---

## How to Test the Website

### Student flow (approved answer)
1. http://localhost:3000 → College of Computing and Informatics
2. Information Technology → Level 4 → Computer Networks → Assignment 2
3. Type: `What is the difference between TCP and UDP?`
4. Click **Find the Answer** → verify **Approved Answer** badge.

### Student flow (AI fallback)
1. Same path, type: `Explain the concept of routing`
2. Verify **AI-Generated Answer** badge + disclaimer.

### Multi-question
1. Type multiple numbered questions and verify separate result cards.

### Image input
1. Screenshot a question, paste with Ctrl+V in the Image tab.

### PDF input
1. Drag any PDF onto the PDF drop zone.

### Admin
1. http://localhost:3000/admin/login → sign in.
2. Dashboard: verify stat cards.
3. Files → select Computer Networks / Assignment 2 → upload a PDF.
4. Questions Review → edit and click **Publish All**.
5. AI Review → approve a pending AI answer.
6. Student side: search again — approved answer should now appear.

### RTL / LTR
Click **AR / EN** — layout flips, all text switches.

### Dark mode
Click the sun/moon icon — all pages render cleanly.

---

## Deploying to Vercel

1. Push to GitHub.
2. Import at https://vercel.com.
3. Add all env vars from `.env.example` (use real production values).
4. Set `DEMO_MODE=false`.
5. Deploy.

**Production upgrades needed before scaling:**
- Replace `src/lib/admin-store.ts` → Supabase queries (schema ready in migrations).
- Replace `src/lib/rate-limit.ts` → Upstash Redis for multi-instance rate limiting.
- Upgrade file upload flow → Supabase Storage pre-signed URLs for large PDFs.

---

## Known Limitations

| Limitation | Workaround |
|---|---|
| In-memory store resets on server restart (demo) | Configure Supabase |
| Rate limiter is per-process | Upstash Redis for multi-instance |
| Embeddings skipped in demo mode | Add Supabase + AI embedding key for full semantic search |
| Admin sidebar hidden on mobile | Hamburger drawer can be added in `admin-shell.tsx` |
| No admin password reset UI | Use Supabase Auth Dashboard "Send magic link" |

---

## Production Supabase Integration (v2)

### What changed from the demo-only version

| Area | v1 (demo-only) | v2 (production-ready) |
|---|---|---|
| Data layer | Static imports from `demo-data.ts` | Repository pattern — `DemoRepo` or `SupabaseRepo` via `getPublicRepo()` / `getAdminRepo()` |
| Admin API security | Middleware only | `requireAdmin(role)` guard on **every** route — returns HTTP 401/403 |
| Admin roles | Single admin | owner / editor / reviewer / viewer with role-gated CRUD |
| File upload | JSON metadata only | Real `multipart/form-data` → private Supabase Storage bucket |
| PDF processing | Placeholder stub | Text extraction (pdf-parse) → AI Q/A split → OCR fallback for scanned PDFs |
| Embeddings | Single `AI_API_KEY` for everything | Separate `EMBEDDING_API_KEY` (OpenAI-compatible) + safe trigram fallback |
| Rate limiting | In-memory only | Upstash Redis when `UPSTASH_REDIS_REST_URL` is set, in-memory fallback |
| Search | In-process hybrid only | In-process for demo; `match_questions()` pgvector + trigram for Supabase |
| Audit log | None | `audit_log` table; all admin writes are logged |

### New environment variables

```env
EMBEDDING_API_KEY=          # OpenAI or compatible; leave empty → trigram fallback
EMBEDDING_MODEL=text-embedding-3-small
UPSTASH_REDIS_REST_URL=     # optional; enables multi-instance rate limiting
UPSTASH_REDIS_REST_TOKEN=
```

### Creating the first Owner account (Supabase)

```bash
# 1. Invite via Supabase Dashboard → Authentication → Users → Invite user
# 2. User accepts invite and sets password
# 3. Run the promotion script:
psql "$DATABASE_URL" -v email="owner@example.com" -f supabase/create_owner.sql
```

### Migration order

```
0001_initial_schema.sql
0002_rls_policies.sql
0003_search_function.sql
0004_admin_roles_audit.sql   ← new
supabase/create_owner.sql    ← run once per project
```
