# Tradeoffs Log

Open design challenges, options considered, and decisions made.
Decisions column is filled in once resolved.

---

## 1. Concurrent human edits on same section text

**Challenge:** Two humans editing the same OPEN section simultaneously can produce corrupted or lost content without conflict resolution.

| Option | How it works | Tradeoffs | Decision |
|---|---|---|---|
| **Last-write-wins** | Server serializes writes; last one received overwrites. | Simple. Silent data loss — earlier writer loses change with no notification. | Rejected — silent loss is bad UX |
| **OT (Operational Transformation)** | Every edit is an operation; server transforms concurrent ops so both survive. | No data loss. Extremely complex. What Google Docs built over years. | Rejected — out of scope |
| **CRDT (Yjs)** | Each character has a globally unique ID. Concurrent inserts ordered deterministically. | No data loss, battle-tested. If Yjs is in the stack, comes for free. | Keep as option if tech stack includes Yjs |
| **Optimistic locking** | Each edit sent with the document version it was based on. Server rejects stale edits. First write wins; second writer gets error + auto-sync to current state. | Explicit, no silent loss. User is informed and sees current state. Must manually re-apply on top of latest. No OT/CRDT complexity. | **DECIDED** |
| **Cursor presence** | Show where each person's cursor currently is (coloured avatar). Early warning before conflicts happen. | Zero implementation cost. Social deterrent, not a technical guarantee. | **DECIDED — ship alongside optimistic locking** |

**Decision:** Optimistic locking + cursor presence. First write wins. Rejected writer sees error: *"Stale edit — document updated by @bob"* and document auto-syncs. v2: reconciliation prompt ("You tried to change X → Y. Current value is Z. Apply anyway?").

Same model applies to Request Revision and Approve: first action wins. Error messages: *"Someone already requested a revision"* / *"Section already approved"*.

---

## 2. Comment granularity — section-level vs inline text-range

**Challenge:** Should comments be anchored to a section as a whole, or to a specific highlighted text range (like Google Docs)?

| Option | How it works | Tradeoffs | Decision |
|---|---|---|---|
| **Section-level comments** | Comment tied to section container. Thread in sidebar. No text highlighting. | Simple. No staleness problem. Less precise — can't call out a specific sentence. | Rejected — not precise enough |
| **Inline text-range comments** | User highlights text; comment anchored to that character range. Marker inline in text. | Precise and familiar. Hard: anchor must survive edits. Comment orphans when anchored text is deleted. | **DECIDED — with orphan handling** |
| **Hybrid** | Section-level default; inline optional. | Best of both. Doubles implementation surface. | Deferred — do inline first |

**Decision:** Inline text-range comments. Orphan handling: when anchored text is edited or deleted, comment floats and is marked **"Outdated"** (greyed out, badge). Original anchored text stored as snapshot shown on expand. Comment thread remains accessible. Same pattern as GitHub PR comments on edited lines.

Comment stores: `{ anchoredText: "original text snapshot", range: {start, end}, outdated: boolean }`. On any edit overlapping the range → mark `outdated: true`.

---

## 3. Editor rendering during AI streaming

**Challenge:** AI streams tokens at high rate. ProseMirror creates per-token transactions causing jank. But rendering outside the editor requires a transition when section enters OPEN state.

| Option | How it works | Tradeoffs | Decision |
|---|---|---|---|
| **ProseMirror for everything** | Editor always mounted, read-only during DRAFT. Tokens streamed as ProseMirror transactions. | Consistent UX. Risk: 30 tokens/sec = 30 re-renders/sec, cursor instability, plugin overhead. | Rejected — jank risk not worth it |
| **Plain HTML during DRAFT, editor on OPEN** | DRAFT/REVISING: `<div contenteditable="false">`, tokens appended to DOM directly. OPEN: swap to ProseMirror editor. | Smooth streaming (native DOM). Transition flash on swap (~50ms, eliminated by pre-mounting editor hidden). Section locked during DRAFT anyway — no rich interactions needed. | **DECIDED** |

**Decision:** Text is not streamed live into the document. While AI Author is writing, the section shows a progress indicator only (spinner, estimated time, progress bar). Text appears in full on the document once Author finishes the section.

Reasoning: This is a document UX, not a chat UX. Streaming word-by-word adds no operational value — the section is locked for editing anyway. Avoiding live streaming sidesteps all ProseMirror transaction complexity during generation entirely.

Progress indicator UI (while DRAFT):
```
Section: Technical Approach
┌─────────────────────────────────┐
│ ⟳ AI Author is writing...      │
│ ████████░░░░  ~30 sec           │
│ [Preview]  [Cancel]             │
└─────────────────────────────────┘
```
- [Preview]: optional peek at in-progress text (read-only side panel). Not required to wait blind.
- [Cancel]: triggers document-level Interrupt & Restart.
- Once done: full section text appears on document, section transitions to OPEN.

Stale edit re-apply (v1): Alice manually re-applies her change on the now-current text after seeing the stale error. No reconciliation prompt in v1.

**Editor library: TipTap** — best balance of ecosystem, Yjs collaboration (cursor presence), section locking, and React integration. Suggest mode and inline comments are custom TipTap extensions.

---

## 4. Human edit visibility — replace vs suggest mode

**Challenge:** When a human edits AI-authored text in an OPEN section, should it replace text outright or be shown as a tracked proposal?

| Option | How it works | Tradeoffs | Decision |
|---|---|---|---|
| **Direct replace** | Edit replaces text in place. No history of AI original. | Simple. No audit trail. Fits with optimistic locking cleanly. | Rejected — loses AI original |
| **Raw strikethrough** | Deleted text stays as strikethrough; new text inserted alongside. Grey, no colour coding. | Audit trail. Harder to read than coloured version. | Rejected — colour is better |
| **Suggest mode (coloured Track Changes)** | Deletions in red strikethrough, insertions in green. Changes grouped into blocks — consecutive changed words shown as one block (not word-by-word). Reviewer can accept/reject per change block. | Audit trail. "AI is primary author" mental model preserved. Large rewrites shown as one old block struck through + one new block below — readable. | **DECIDED** |

**Decision:** Suggest mode with block-level grouping. Consecutive deleted words = one strikethrough block. Consecutive inserted words = one insertion block. Color preferred over raw strikethrough if UI supports it.

**Behaviour rules:**
- **Author on Request Revision:** Receives (1) the latest clean text — no markup, human edits already incorporated (suggest-mode is a visual layer only; the underlying data is always the current text state) and (2) all comments from AI Critic and humans registered on the server at the moment the button is clicked. Whatever the server has at that instant is the context bundle.
- **On Approve:** Suggest-mode markup collapses — section shows clean final text with no strikethroughs or colour highlighting. Approved state is always clean.
- **On Reopen:** Approved text becomes the new baseline. Old markup does not re-appear — those edits were committed. New edits from this point generate new suggest-mode markup.
- **Optimistic locking + suggest mode:** If two humans edit the same range simultaneously, first write wins. Second writer gets stale error, sees current text, manually re-applies if needed (v1).

---

## 5. Conflict resolution model — OT vs CRDT vs Optimistic Locking

**Challenge:** Multiple humans may edit the same section text simultaneously. Which model handles conflicts correctly for our use case?

**Root cause for this decision:** Collaborative editing is NOT our primary product value. AI authoring and human steering is. Human-to-human concurrent editing is a rare, secondary scenario. The conflict resolution model should match actual conflict rate and document stakes — not the most sophisticated option.

**The canonical example:**
```
Original: "The cache layer is Redis"
Bob replaces "Redis" → "Memcached"
Alice replaces "Redis" → "in-memory Redis cache"

OT result:  "The cache layer is Memcached in-memory Redis cache"  ← semantically corrupt
CRDT result: "The cache layer is Memcached in-memory Redis cache"  ← same corruption
Optimistic locking: Bob's write lands first → accepted. Alice gets error + sees "Memcached". Alice decides.
```

**Additional reason to reject OT/CRDT:** If semantically corrupt text ("Memcached in-memory Redis cache") is fed to the AI Author as context during Request Revision, the model receives malformed input and produces unpredictable output. Silent corruption in an AI-assisted document tool is a compounding failure — the human doesn't catch it, the AI propagates it.

| Option | How it works | Why Rejected / Accepted |
|---|---|---|
| **CRDT (Yjs/Hocuspocus)** | Every character has a unique ID. Concurrent inserts merged deterministically. No server coordination. Both changes always survive. | **Rejected.** Produces semantic corruption silently ("Memcached in-memory Redis cache"). Corrupted text fed to LLM produces unpredictable rewrites. Collaborative editing is not our primary value. Conflict rate is low (AI writes most of the time; sections are LOCKED during generation). |
| **OT (Operational Transformation)** | Operations transformed on the server so both changes survive without data loss. Industry standard (Google Docs). | **Rejected.** Same semantic corruption as CRDT for same-word replacement conflicts — OT doesn't resolve semantic intent, only character positions. Extremely complex to implement correctly (Google spent years; Joseph Gentle, author of ShareJS: "Implementing OT sucks"). We have 1 day. Same LLM corruption risk. |
| **Optimistic Locking** | Each write includes document version. Server accepts first write, rejects stale writes. Rejected writer gets explicit error + auto-sync to current state. | **DECIDED.** Explicit conflict notification is the right UX for consequential documents. No silent corruption. No LLM risk. ~50 lines of server code. Cursor presence reduces conflict frequency. When conflicts occur, human makes a deliberate decision rather than discovering corrupt text later. |

**Decision:** Optimistic locking. First write wins. Second writer gets error popup: *"Stale edit — @bob just changed this."* Document auto-syncs. Writer manually re-applies on current text (v1). Cursor presence is the primary conflict deterrent.

---

## 6. Real-time communication layer

**Challenge:** Need to propagate AI generation events, section state changes, comments, cursor presence, and optimistic locking feedback to all connected clients in real time.

**What we actually need real-time for (from product decisions):**

| Signal | Frequency | Direction |
|---|---|---|
| Generation started / complete | Low (per section) | Server → all clients |
| Section state changes | Low | Server → all clients |
| Comment added | Medium | Server → all clients |
| Cursor presence | High (~50ms) | Client → server → all clients |
| Optimistic lock: accepted / rejected | On conflict | Server → that client only |
| Document auto-sync after stale error | On conflict | Server → that client only |

**Note:** We are NOT streaming tokens live to clients (progress indicator only, text shown on completion). Real-time pressure is lower than a pure streaming product.

| Option | How it works | Tradeoffs | Decision |
|---|---|---|---|
| **SSE + REST** | Server pushes all events via persistent SSE stream. Client sends mutations via REST POST, including cursor position (~every 50ms). | Simple protocol for server push. Cursor presence requires client to POST every 50ms — at 10K daily docs, 2 collaborators, peak concurrent ~1,250 docs: **50,000 REST requests/second** just for cursors. At 2X peak: 100K RPS cursor-only. HTTP header overhead per request is prohibitive. | **Rejected** — cursor math doesn't scale. |
| **Hocuspocus (Yjs WebSocket)** | Purpose-built WebSocket server for Yjs CRDT sync. Cursor presence via Yjs Awareness protocol. Designed to be the persistence layer for Yjs documents. | Cursor presence native. But: (1) CRDT conflict model rejected above — split authority with our Postgres version model. (2) Designed as persistence layer — stores Yjs binary blobs, not queryable rows. (3) Two services: Hocuspocus + main API. AI generation events need cross-service plumbing. | **Rejected** — CRDT model conflict; split authority; two-service complexity. |
| **Liveblocks (managed SaaS)** | Drop-in real-time SDK. Presence + broadcast + CRDT storage. We would use only Presence and Broadcast (skip Storage/CRDT). | Zero infra. Presence and cursors work in an afternoon. Paying for a service and not using its primary feature (Storage). Vendor lock-in. AI generation events injectable via Liveblocks server API. | Viable fallback if build time is critical constraint. |
| **PartyKit (managed WebSocket)** | Managed WebSocket on Cloudflare Durable Objects. Each document = one Durable Object with persistent state + WebSocket connections. Custom conflict resolution logic inside Durable Object. | No CRDT imposed — we control logic. Good fit for our model. Newer, smaller ecosystem, less documentation. Cloudflare deployment model. | Viable. Slightly more complex deployment story. |
| **WebSocket via Socket.io (custom)** | Single bidirectional connection per client per document. One persistent Node.js server handles REST + WebSocket. Documents are Socket.io rooms. | Full control. Cursor presence native (broadcast to room). Optimistic lock feedback immediate on same connection. AI generation events go through same channel. One service, one authority (Postgres). Socket.io handles reconnection, rooms, heartbeat. No CRDT imposed. | **LEADING OPTION** |

**Decision: Socket.io on a single persistent Node.js server.** Documents are rooms. One service, one authority (Postgres), AI orchestration and Socket.io broadcast in the same process — no cross-service plumbing. Scales to ~10K concurrent connections per process; Redis adapter available if horizontal scaling needed later.

---

## 7. Deployment platform

**Challenge:** Fastify + Socket.io requires a persistent server — no serverless. Need WebSocket support, Redis co-location, low operational overhead, and viable cost for a usable product.

**Critical constraint:** Socket.io WebSocket connections must not be interrupted by service sleep/cold starts. Any platform with sleep-on-inactivity behavior is disqualified for the backend.

| Option | WebSocket | Sleep on free tier | Cost estimate | DX | Decision |
|---|---|---|---|---|---|
| **Render** | Works but non-obvious config (reverse proxy headers required — flagged in original risk table) | **Yes — 15 min inactivity → 30–60s cold start.** All Socket.io connections drop. First user after quiet period hits cold start. Unacceptable for a collaborative editor. | $7/mo always-on + $10/mo Redis + $7/mo Postgres = ~$24/mo | Good | **Rejected** — sleep behavior kills Socket.io UX |
| **Railway (everything)** | Works out of the box | No sleep on Hobby plan | ~$5–10/mo total | Excellent | Good option but Next.js loses CDN |
| **Fly.io + Vercel** | Excellent WebSocket support, multi-region | No | ~$10–15/mo | Requires Dockerfile, more config | Overkill for current scale |
| **Vercel (frontend) + Railway (backend) + Neon (DB)** | Railway: works out of the box | No sleep | Vercel: free. Railway Hobby: ~$5–7/mo. Neon: free tier. **Total: ~$5–7/mo** | Excellent across all three | **DECIDED** |

**Decision: Railway for all services + Neon (PostgreSQL)**

- Next.js frontend: Railway service. Loses Vercel CDN — acceptable tradeoff for a document editor where the hot path is dynamic content, not static assets. Browser caches the JS bundle after first load.
- Fastify + Socket.io + BullMQ: Railway service, WebSocket out of the box.
- Redis: Railway add-on, private network to both services (~0.1ms).
- Neon: external managed Postgres, ~5–10ms from Railway. Free tier (0.5GB, no time limit).
- Single platform: one dashboard, one billing, private networking between all services.
- **Cost:** Next.js ~$2–3/mo + Fastify ~$3–5/mo + Redis ~$1–2/mo + Neon free = **~$6–10/month**.
- **For demo/submission:** Railway $5 trial credit (no card required) covers the review period. Neon free. ~$0 to submit.

---

## 8. Database — consistency model and storage choice

**Challenge:** The system must be highly available. Strong consistency (CP) is only required for optimistic locking on human edits. All other reads can be eventually consistent (AP). Database choice must match this split requirement and be justified by load.

**CAP position:** We want AP for ~90% of operations. Only the optimistic lock write (human edit version check + update) and section approval are truly CP. Everything else — reading section content, comments, document metadata, AI generation state — tolerates stale reads.

---

### Load model (basis for all decisions below)

```
Scale assumption: 10K docs created daily, ~2 collaborators per doc, ~1 hour active editing per doc

Peak concurrent docs:
  10K docs × (1 hour / 8 peak hours) = 1,250 concurrent active docs

Peak concurrent users:
  1,250 docs × 2 users = 2,500 concurrent users

CP writes (human edits + approvals, hit Postgres primary):
  2,500 users × 1 edit/minute = 42 edits/second
  Approvals: ~2/second
  Total CP writes: ~45 writes/second on primary

AI generation writes (section content saved after Author finishes):
  10K docs/day × 8 sections = 80K writes/day
  Average: ~1 write/second | Peak (10x): ~10 writes/second
  These are larger writes (~1–2KB text) but infrequent

AP reads (section content, comments, metadata):
  2,500 users × ~1 document open/minute (refresh + new collaborators joining)
  = 42 page loads/second × 4 queries each = ~170 queries/second
  Note: active sessions do NOT poll — Socket.io pushes all updates
  Read load is dominated by document open events, not polling

Redis cache sizing (for AP reads):
  Avg section content: ~1,000 words × 6 bytes = ~6KB
  Avg doc (8 sections): ~48KB
  1,250 concurrent docs: 1,250 × 48KB = ~60MB sections
  Comments: 1,250 docs × 20 comments × 200 bytes = ~5MB
  Total Redis hot data: ~65MB — fits easily in any Redis tier

Redis read capacity:
  Redis handles ~100,000 GET/second on a single node
  Our peak: ~170 reads/second = 0.17% of capacity — no concern

Postgres primary capacity:
  Simple indexed UPDATE: Postgres handles ~5,000–10,000/second
  Our peak CP writes: ~45/second = <1% of primary capacity — no concern
```

---

### Options

| Option | How it works | Load fit | Availability | Decision |
|---|---|---|---|---|
| **Postgres primary only (CP everywhere)** | All reads and writes hit Postgres primary. | 170 reads/second + 45 writes/second on one node — manageable, but couples read availability to primary health. | During primary failover (20–60s): full outage. Users see broken product. | **Rejected** — single point of failure kills availability |
| **Postgres primary + read replicas** | Reads from replicas (eventually consistent). Lock writes to primary. | 170 reads split across replicas. 45 writes to primary. Works. | Reads survive primary failure. Lock writes fail gracefully (~30s window). | Good but adds cost. Redis is faster (0.1ms vs 1–5ms replica reads) and already in stack (BullMQ). |
| **DynamoDB (AP) + conditional writes for locks** | DynamoDB conditional write = optimistic locking. AP by default, strong consistent reads opt-in per call. | Handles our load trivially. | 3-AZ replication, 99.999% SLA. Very high availability. | Complex query model requires GSIs for relational queries. AWS lock-in. Extra cost. Our load doesn't justify the complexity. **Rejected.** |
| **Postgres primary (locks only) + Redis cache (AP reads)** | CP writes (lock check, approval) → Postgres primary. All reads → Redis cache. Cache populated on AI section complete + on comment saved. Fallback: Postgres replica on cache miss. | 45 CP writes/second on Postgres (trivial). 170 reads/second on Redis (trivial, 0.17% capacity). AI writes populate cache directly. | During primary failure: reads continue from Redis, Socket.io stays up, human edits fail with retry. Product remains readable and feels alive. | **DECIDED** |

---

### Decision: Postgres primary (CP locks) + Redis cache (AP reads)

**Justification:**

1. **Load math confirms primary is not the bottleneck.** 45 CP writes/second is <1% of Postgres primary capacity. The primary will never be the scaling constraint at our load.

2. **Redis is already in the stack (BullMQ).** No new infrastructure dependency. 65MB of hot data fits easily. Reads at 0.17% of Redis capacity.

3. **Read latency:** Redis GET ~0.1ms vs Postgres SELECT ~1–5ms. For section content and comments loaded on every document open, this is a real UX difference.

4. **Availability during primary failure:**
   - Reads continue from Redis cache ✓ (document feels alive)
   - Socket.io stays up — in-process, no DB dependency ✓
   - AI generation events still broadcast ✓
   - Human edits fail with "saving..." and BullMQ retry ✗ (only CP operations degrade)
   - Neon primary failover: ~10s (faster than traditional Postgres)

5. **No new infrastructure vs read replicas.** Replicas add cost and config. Redis is already there, faster for reads, and doubles as the availability buffer.

**Cache invalidation rules:**
- Section content: written to Redis when Author finishes (`section.contentReady`). Invalidated on `section.requestRevision` (content will change). TTL: 24h.
- Comments: appended to Redis list on `comment.added`. Invalidated on `section.reopen`. TTL: 24h.
- Document metadata: written on creation. Invalidated on title/state change. TTL: 1h.
- On cache miss: fall back to Postgres replica → re-populate cache.

**What hits Postgres primary (CP only):**
```
UPDATE sections SET content=$1, version=version+1 WHERE id=$2 AND version=$3  -- lock write
UPDATE sections SET state='APPROVED', approved_by=$1 WHERE id=$2              -- approval
```

Everything else reads from Redis or Postgres replica.

---
