# CollabDocs

A collaborative document editor where AI is a first-class author — writing, critiquing, and refining documents alongside you. You give a brief, the AI drafts a structured starter document section by section, and from there you edit by hand, talk to the AI by voice or text, request on-demand inline reviews, leave comments, and roll back to any past version.

> Design rationale, tradeoffs, and what I'd build next live in [APPROACH.md](APPROACH.md).

---

## What it does

- **AI Writer** drafts a document from a short brief, one section at a time.
- **AI Reviewer** leaves inline comments on demand that you can apply or reject.
- **Chat** (typed or spoken via the mic) lets you guide the Writer in natural language.
- **Manual editing** with auto-save on every change.
- **Inline comments** for note-keeping and human-to-human collaboration.
- **Version history** — preview any past snapshot, restore it, and branch off with a fresh prompt.
- **Document management** — create, search, share (via token URL), and delete documents.

### The core flow

1. Describe the document you want (type + brief, optionally with uploaded reference files).
2. The AI Writer produces a starter document broken into sections.
3. Review it, edit it manually, or ask the AI (chat/voice) to revise it.
4. Request an AI review → inline comments you can apply or reject.
5. Add your own inline comments for collaborators.
6. Check history and restore a previous snapshot at any time.

---

## Architecture

A two-app monorepo under [apps/](apps/), backed by Postgres, Redis, and a job queue.

```
Next.js frontend ──HTTP──▶ Fastify API ──▶ Postgres (Prisma)
       ▲                       │
       └────── Socket.io ──────┤
                               ▼
                      BullMQ queues (Redis)
                               │
              ┌────────────────┼────────────────┐
         Author worker    Critic worker    Chat worker
          (Claude)          (Claude)        (Claude)
```

- **Frontend** — [apps/frontend/](apps/frontend/): Next.js (App Router) + Tailwind. Connects over Socket.io for live document updates.
- **Backend** — [apps/backend/](apps/backend/): Fastify HTTP API + Socket.io on one server. Three background workers (Author, Critic, Chat) consume BullMQ queues and emit results directly over the same Socket.io server, so there are no cross-service hops.
- **AI agents** — the Author and Critic ([apps/backend/src/agents/](apps/backend/src/agents/)) are independent: they share no memory and both read/write committed document state through the same locking and versioning path.
- **Data model** — Prisma schema in [apps/backend/prisma/schema.prisma](apps/backend/prisma/schema.prisma): documents → sections → comments, plus per-section and whole-document snapshots, activity log, chat history, and resources.

### Key design choices

- **Optimistic locking, not CRDT/OT.** When AI is an author, garbage merged text corrupts its next output. CollabDocs prioritizes semantic coherence — first write wins, the second writer gets a conflict dialog and re-applies against fresh content.
- **No streaming token display.** Tokens stream into a draft area; the finished section appears in one shot. This avoids humans reacting to half-written sentences and keeps it from feeling like a chat.
- **Section-level writes.** Because in-flight text isn't shown, writing section by section keeps time-to-first-content low.
- **BullMQ + Redis** for reliable retries with backoff, per-queue concurrency limits, and job persistence across restarts.

See [APPROACH.md](APPROACH.md) for the full reasoning and tradeoffs.

---

## Tech stack

Next.js · Fastify · Socket.io · Prisma · PostgreSQL · Redis · BullMQ · Anthropic Claude (author/reviewer/chat) · OpenAI Whisper (voice transcription)

---

## Getting started

### Prerequisites

- Docker (for the one-command path) or Node.js + a local Postgres/Redis
- `ANTHROPIC_API_KEY` — required, powers the AI Writer and Reviewer
- `OPENAI_API_KEY` — optional, enables voice input (mic → Whisper transcription)

### Run with Docker (recommended)

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up
```

Starts Postgres, Redis, the backend (port 4000), and the frontend (port 3000). The backend runs `prisma db push` on startup. Then open http://localhost:3000.

To enable voice input, also pass `OPENAI_API_KEY=sk-...`.

### Run without Docker

```bash
cp apps/backend/.env.example apps/backend/.env   # fill in ANTHROPIC_API_KEY

docker compose up postgres redis -d              # or use your own Postgres/Redis

cd apps/backend && npm ci && npx prisma db push && npm run dev
# in a separate terminal:
cd apps/frontend && npm ci && npm run dev
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | AI Writer, Reviewer, and Chat (Claude) |
| `OPENAI_API_KEY` | No | Voice input transcription (OpenAI Whisper) |
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_URL` | Yes | Redis connection for BullMQ |
| `FRONTEND_URL` | No | CORS origin (default `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | No | Backend URL for the frontend (default `http://localhost:4000`) |

See [.env.example](.env.example) and [apps/backend/.env.example](apps/backend/.env.example).

---

## Scripts

Run from the repo root:

| Command | Description |
| --- | --- |
| `npm run dev:backend` | Start the backend in watch mode |
| `npm run dev:frontend` | Start the frontend in watch mode |
| `npm run db:push` | Sync the Prisma schema to the database |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run build:backend` / `build:frontend` | Production builds |
| `npm run test:e2e` | Run Playwright end-to-end tests |

E2E tests live in [tests/e2e/](tests/e2e/); config in [playwright.config.ts](playwright.config.ts).

---

## Deployment

Both apps deploy to Railway via their `Dockerfile` and `railway.toml` ([apps/backend/](apps/backend/), [apps/frontend/](apps/frontend/)). The backend needs `ANTHROPIC_API_KEY`, `DATABASE_URL`, and `REDIS_URL`; the frontend needs `NEXT_PUBLIC_API_URL` pointing at the deployed backend.
