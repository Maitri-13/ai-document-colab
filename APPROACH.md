# CollabDocs — Approach

## What I Built

CollabDocs — a document editor where AI is integrated into every aspect of document building: writing, critiquing, refining, and reiterating. The product prioritizes human-AI interaction and provides value through AI context hygiene. Voice interactions make the experience smooth.

### The core flow

You give a brief context of what document to create, and the AI Writer produces a starter document with a few building blocks. From there, you can:

1. Review the document
2. Edit the document manually
3. Speak with the AI or type a prompt to request updates to the document
4. Request an on-demand AI review. The AI Reviewer leaves inline comments that you can apply or reject
5. Manually select and comment inline for note-keeping or collaborating with other human reviewers
6. Check the history of changes and restore to a previous snapshot on demand
7. Delete the document
8. Share the document
9. Search for a document
10. Visualize all documents created in the left panel

Every change is auto-saved. Chat is the best way to communicate and guide the AI.

---

## Core Insight

Real-time collaborative editors solve the wrong problem for AI-human authoring, optimizing for "everyone's keystrokes survive." But when AI is an author, garbage merged text corrupts the AI's next output. My product prioritizes semantic coherence over lossless merging.

---

## Why This Problem?

This problem is very practical and mirrors exactly how teams work today. The compelling design challenge was making AI a first-class participant in the workspace — not just a one-off text generator, but a continuous collaborator embedded directly into the document's lifecycle. The problem statement was open-ended enough to give me creative freedom in product design and to make architecture decisions that shape the product. It also has a lot of scope for extension — for example, incorporating voice interaction where the user can speak with the AI was a stretch goal, but technically interesting to work on.

---

## Tech Stack

Next.js, Fastify, Prisma, PostgreSQL, Redis, BullMQ, Socket.io, Anthropic Claude, OpenAI Whisper.

---

## Key Decisions and Tradeoffs

### 🔒 Optimistic locking over CRDT/OT

Standard collaborative editing resolves character-level conflicts but not semantic ones. If two people simultaneously revise the same place, CRDT/OT resolves the conflict by letting both changes reflect. No change is lost, and the onus of synchronization and removing garbage text falls on the human. This is because standard document collaboration editors' primary goal is human-human collaboration.

Our use case is different. The main focus is AI-human collaboration, and an incoherent input corrupts the AI's next output. This is why I went with optimistic locking to resolve conflicts (first write wins, second gets a conflict dialog). This way the editor takes control of keeping the AI's context clean.

**Example — CRDT / OT**

1. Original text: "Investment in AI is worthwhile"
2. Alice changes "worthwhile" to "excessive"
3. At the same time, Bob changes "worthwhile" to "marginal"
4. Output merges both in some order: "Investment in AI is excessive marginal". No rejection.

**Example — Optimistic Locking**

1. Original text: "Investment in AI is worthwhile"
2. Alice changes "worthwhile" to "excessive"
3. At the same time, Bob changes "worthwhile" to "marginal"
4. Assuming Bob's changes reach the server first, the output reads "Investment in AI is marginal". Alice gets an error indicating she's updating stale content.

**The honest tradeoff:** this protects coherence at the cost of human-human convenience. Under concurrent edits the second writer loses their work to a conflict dialog and re-applies it against fresh content — friction I deliberately pushed onto the rare case (two humans editing the same span at once) rather than the common case (the AI's next write).

### ⏳ No streaming token display

Showing tokens mid-generation creates a feedback loop: humans comment on half-written sentences, the writer must stop and look at the comment, altering its context. It also makes the experience feel like a chat conversation. Instead, the system streams tokens into a draft area and shows the whole paragraph in one shot on the document. Full text appears on completion; a skeleton shows what is being drafted.

**Example of flow**

1. The AI Writer is drafting content. The user sees "drafting" in the UI. The backend collects the tokens the writer generates and waits for completion before rendering the text on screen.
2. The human can interact with the text once the AI stops working on it actively.

### 📝 Section-level AI writes

Not streaming tokens led to this architectural decision of writing documents in sections rather than all at once. Since we don't show text that is still being streamed, writing the whole document would introduce a significant time to first word (enough to feel broken). Breaking documents into sections reduces this and improves the user experience. The writer writes each section in sequential order.

### 🔌 Socket.io over SSE

SSE would require a new connection per resource per client. Socket.io multiplexes over one WebSocket per client and handles reconnection and room management. Workers emit events directly to the same Socket.io server that handles API requests — no cross-service hops.

### 🤖 Two independent agents — Writer and Reviewer

This decision was made purely for separation of concerns and lower context-switching overhead; each agent is focused on one function. They don't share memory or talk to each other; both read the same document state from Postgres and write back through the same locking and versioning path, so the Reviewer always critiques the committed document, never an in-flight draft.

### 🕓 Version history and snapshot restore

Cooperating with AI means accepting a partial loss of control and the reality of unexpected outputs. To bridge this gap, I built a comprehensive audit trail that logs every change made to the document. I also designed a document-level snapshot restore feature, allowing users to preview past versions, roll back to a preferred point, and seamlessly branch off with a fresh prompt from there.

### ⚙️ BullMQ + Redis over a custom queue

Reliable retry with exponential backoff for LLM failures, concurrency control per queue (Author=3, Critic=10 to avoid hammering Anthropic rate limits), and job persistence across server restarts. A dead worker doesn't lose in-flight work.

---

## What I Intentionally Left Out

1. **Auth.** The name prompt on first visit (stored in localStorage) is intentionally lightweight. My focus is on the collaboration loop, not identity management. In a real environment, employees would access this platform behind a verified network, and their usernames could be derived from their respective logins.
2. **Cursor presence.** Real-time "who's reading where" is left out of V1 scope because the focus of the problem was human-AI collaboration rather than human-human collaboration. I also left it out because the complexity (throttled broadcasts, presence timeouts, UI choreography) outweighed the value it provided. That said, multiple humans can still edit a document — I solve the race condition of edits via optimistic locking.
3. **Chat with AI via comments.** To keep the interface clean, chat and comments have distinct purposes. Comments are for leaving notes for other human reviewers; chat is for conversing with the AI Writer to make updates to the document.
4. **Streaming token display.** As explained above, this is a deliberate product decision to avoid making the experience feel like a chat.
5. **Export (PDF/DOCX).** Out of scope for V1. The document state lives in Postgres and could be rendered server-side, but it isn't a core part of the collaboration loop.
6. **URL/Jira/Confluence resource ingestion.** Only file upload (PDF, DOCX, TXT, MD) is supported. Fetching external URLs adds scraping complexity and rate-limit concerns that aren't load-bearing for the core thesis.

---

## What Breaks First Under Pressure

1. **Single-process workers.** The Author and Critic workers run in the same Node.js process as the Fastify API. Under load, a slow LLM call doesn't block (it's async), but CPU-bound post-processing could. At meaningful scale, workers should move to separate processes or use worker threads.
2. **No rate-limit handling.** If Anthropic throttles, BullMQ retries with backoff but the user sees a stuck spinner with no feedback. The fix is a `rate_limited` socket event with a toast in the UI.
3. **Postgres connection pool.** The default Prisma pool is 10 connections. With many concurrent documents each driving AI reviews and human edits simultaneously, this exhausts fast. PgBouncer or a tuned pool size is the next step.
4. **File upload held in memory.** Uploaded resources are read fully into memory before text extraction. A 20 MB PDF with many concurrent uploads would spike memory. The fix is streaming through a temp file.

---

## What I'd Build Next

1. **Reads from cache.** This is a read-heavy system — more read requests for a document than new documents being written. For V1 I read and write to Postgres. To extend, I'd redirect reads to a Redis cache and keep writes going to Postgres, using each technology for what it's built for.
2. **Better AI output quality.** Add an eval harness scoring drafts on coherence, instruction-adherence, and section-fit, so prompt changes can be measured rather than eyeballed. Tighten the Writer/Reviewer prompts with few-shot examples and structured output to reduce formatting drift.
3. **Cursor presence.** Show who's reading or editing which section in real time for smoother multi-human collaboration.
4. **Comment threads.** Converse with the AI Writer not just through chat but also via manual comments on the document.
5. **URL and Confluence resource ingestion.** Broaden the context the AI Author and Critic can draw on beyond uploaded files.

---

## Local Setup

**Keys needed**

1. Anthropic API key — for the AI Writer and Reviewer
2. OpenAI API key — for voice (I use OpenAI Whisper)

**One command (requires `ANTHROPIC_API_KEY`):**

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up
```

This starts Postgres, Redis, the backend (port 4000), and the frontend (port 3000). The backend runs `prisma db push` on startup.

**To run without Docker:**

```bash
cp apps/backend/.env.example apps/backend/.env
# Fill in ANTHROPIC_API_KEY

docker compose up postgres redis -d

cd apps/backend && npm ci && npx prisma db push && npm run dev
# (separate terminal)
cd apps/frontend && npm ci && npm run dev
```

