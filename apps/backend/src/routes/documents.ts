import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma'
import { authorQueue, chatQueue, criticQueue } from '../lib/queues'
import { emitToDocument } from '../lib/socket'
import { DocumentType } from '@prisma/client'
import { abortDocument } from '../lib/interruptRegistry'
import { createActivity } from '../lib/activity'
import { createDocumentSnapshot } from '../lib/documentSnapshot'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PREDEFINED_OUTLINES: Record<DocumentType, string[]> = {
  tech_design_doc: [
    'Overview',
    'Proposed Architecture',
    'Data Model',
    // 'API Design',
    // 'Failure Modes & Mitigations'
  ],
  product_spec: [
    'Overview',
    // 'Problem Statement',
    // 'User Stories',
    // 'Requirements',
    // 'Timeline'
  ],
  security_review: [
    'Scope',
    // 'Threat Model',
    // 'Attack Surface',
    // 'Identified Vulnerabilities',
    // 'Risk Assessment',
    // 'Proposed Mitigations'
  ],
  plan: [
    // 'Background',
    // 'Objectives',
    // 'Stakeholders & Roles',
    // // 'Milestones & Deliverables',
    // 'Resource Plan'
  ],
  custom: [],
}

// Generate a concise document title from the brief AND a SHORT starter outline.
// The title is AI-derived (not a copy of the brief). The outline is intentionally
// small (2-3 sections) — the rest of the document is built collaboratively via chat.
async function generateTitleAndOutline(
  brief: string,
): Promise<{ title: string; sections: string[] }> {
  const fallback = { title: 'Untitled document', sections: ['Overview', 'Details'] }
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system:
      'You structure documents. Given a brief, return ONLY a JSON object of the form ' +
      '{"title": string, "sections": string[]}. ' +
      'The title is a concise, descriptive document title (max ~8 words) derived from the brief — NOT a copy of the brief. ' +
      'The sections array is a SHORT starter outline of just 2-3 core section titles; the rest of the document will be built collaboratively later. ' +
      'Return ONLY the JSON object, no other text.',
    messages: [
      {
        role: 'user',
        content: `Brief:\n${brief}\n\nReturn {"title": ..., "sections": [...2-3 section titles...]}.`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return fallback
  try {
    const parsed = JSON.parse(match[0]) as { title?: string; sections?: string[] }
    const sections = (parsed.sections ?? [])
      .filter((s) => typeof s === 'string' && s.trim().length > 0)
      .slice(0, 3)
    return {
      title: (parsed.title?.trim() || fallback.title).slice(0, 200),
      sections: sections.length > 0 ? sections : fallback.sections,
    }
  } catch {
    return fallback
  }
}

const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  brief: z.string().min(1).max(5000),
  type: z.enum(['tech_design_doc', 'product_spec', 'security_review', 'plan', 'custom']),
})

const UpdateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  brief: z.string().min(1).max(5000).optional(),
})

const SetOutlineSchema = z.object({
  sections: z.array(z.string().min(1).max(200)).min(1).max(20),
})

export const documentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /documents/:shareToken — load document by share token
  fastify.get<{ Params: { shareToken: string } }>(
    '/documents/:shareToken',
    async (req, reply) => {
      const doc = await prisma.document.findUnique({
        where: { shareToken: req.params.shareToken },
        include: {
          sections: {
            orderBy: { orderIndex: 'asc' },
            include: {
              comments: {
                where: { resolved: false },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
          resources: { orderBy: { createdAt: 'asc' } },
        },
      })
      if (!doc) return reply.status(404).send({ error: 'Document not found' })
      return doc
    }
  )

  // POST /documents — create document (SETUP state)
  fastify.post('/documents', async (req, reply) => {
    const body = CreateDocumentSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.format() })

    const doc = await prisma.document.create({
      data: {
        title: body.data.title,
        brief: body.data.brief,
        type: body.data.type,
        state: 'SETUP',
        shareToken: randomUUID(),
      },
    })

    reply.status(201).send(doc)
  })

  // PATCH /documents/:id — update title (any state) or brief (SETUP only)
  fastify.patch<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const body = UpdateDocumentSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.format() })

    const doc = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })

    // Brief can only change during setup; title can change at any time
    if (body.data.brief && doc.state !== 'SETUP') {
      return reply.status(409).send({ error: 'Brief can only be edited during SETUP' })
    }

    const updated = await prisma.document.update({
      where: { id: req.params.id },
      data: body.data,
    })
    return updated
  })

  // POST /documents/:id/outline — AI generates or returns predefined outline
  // Returns suggested section titles; does NOT commit them to DB yet
  fastify.post<{ Params: { id: string } }>('/documents/:id/outline', async (req, reply) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    if (doc.state !== 'SETUP') {
      return reply.status(409).send({ error: 'Outline can only be generated during SETUP' })
    }

    let sections: string[]
    let title = doc.title
    if (doc.type === 'custom') {
      // AI derives both the document title and a short starter outline from the brief.
      const result = await generateTitleAndOutline(doc.brief)
      sections = result.sections
      title = result.title
      await prisma.document.update({ where: { id: doc.id }, data: { title } })
    } else {
      sections = PREDEFINED_OUTLINES[doc.type]
    }

    return { sections, title }
  })

  // POST /documents/:id/confirm-outline — commit outline, create Section rows
  fastify.post<{ Params: { id: string } }>('/documents/:id/confirm-outline', async (req, reply) => {
    const body = SetOutlineSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.format() })

    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { sections: true },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    if (doc.state !== 'SETUP') {
      return reply.status(409).send({ error: 'Outline can only be confirmed during SETUP' })
    }

    // Delete any previously confirmed sections (allow re-confirmation)
    if (doc.sections.length > 0) {
      await prisma.section.deleteMany({ where: { documentId: doc.id } })
    }

    await prisma.section.createMany({
      data: body.data.sections.map((title, i) => ({
        documentId: doc.id,
        title,
        state: 'NOT_STARTED',
        orderIndex: i,
        version: 0,
      })),
    })

    const updated = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
      include: { sections: { orderBy: { orderIndex: 'asc' } } },
    })

    return updated
  })

  // POST /documents/:id/start — begin writing (SETUP → GENERATING, queue all sections)
  fastify.post<{ Params: { id: string } }>('/documents/:id/start', async (req, reply) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { sections: { orderBy: { orderIndex: 'asc' } } },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    if (doc.state !== 'SETUP') {
      return reply.status(409).send({ error: 'Document is not in SETUP state' })
    }
    if (doc.sections.length === 0) {
      return reply.status(409).send({ error: 'Confirm an outline before starting' })
    }

    await prisma.document.update({
      where: { id: doc.id },
      data: { state: 'GENERATING' },
    })

    // Queue sections sequentially — Author writes one at a time but BullMQ concurrency=3
    // allows parallelism. Each section gets its own job; Author fetches prior sections
    // from DB at execution time so ordering is naturally maintained.
    for (const section of doc.sections) {
      await authorQueue.add(
        'write-section',
        { documentId: doc.id, sectionId: section.id, isRevision: false },
        { jobId: `author_${section.id}` }
      )
    }

    emitToDocument(doc.id, 'document.stateChanged', { newState: 'GENERATING' })

    return { ok: true }
  })

  // POST /documents/:id/interrupt — stop all pending generation
  fastify.post<{ Params: { id: string } }>('/documents/:id/interrupt', async (req, reply) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { sections: true },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    if (!['GENERATING', 'IN_REVIEW'].includes(doc.state)) {
      return reply.status(409).send({ error: 'Document is not in a cancellable state' })
    }

    // Remove queued jobs for NOT_STARTED sections
    const { Queue } = await import('bullmq')
    const { getRedisConnection } = await import('../lib/redis')
    const aQueue = new Queue('author', { connection: getRedisConnection() })
    for (const section of doc.sections) {
      if (section.state === 'NOT_STARTED') {
        await aQueue.remove(`author_${section.id}`)
      }
    }

    // Abort any currently streaming author job for this document
    abortDocument(doc.id)

    // Mark document INTERRUPTED
    await prisma.document.update({ where: { id: doc.id }, data: { state: 'INTERRUPTED' } })

    emitToDocument(doc.id, 'document.stateChanged', { newState: 'INTERRUPTED' })

    return { ok: true }
  })

  // POST /documents/:id/restart — re-queue unfinished sections
  fastify.post<{ Params: { id: string } }>('/documents/:id/restart', async (req, reply) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { sections: { orderBy: { orderIndex: 'asc' } } },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    if (doc.state !== 'INTERRUPTED') {
      return reply.status(409).send({ error: 'Document is not INTERRUPTED' })
    }

    await prisma.document.update({ where: { id: doc.id }, data: { state: 'GENERATING' } })

    const unfinished = doc.sections.filter((s) =>
      ['NOT_STARTED', 'DRAFT_ERROR'].includes(s.state)
    )

    for (const section of unfinished) {
      await authorQueue.add(
        'write-section',
        { documentId: doc.id, sectionId: section.id, isRevision: false },
        { jobId: `author_${section.id}` }
      )
    }

    emitToDocument(doc.id, 'document.stateChanged', { newState: 'GENERATING' })

    return { ok: true }
  })

  // GET /documents/:shareToken/chat — fetch chat history
  fastify.get<{ Params: { shareToken: string } }>(
    '/documents/:shareToken/chat',
    async (req, reply) => {
      const doc = await prisma.document.findUnique({ where: { shareToken: req.params.shareToken } })
      if (!doc) return reply.status(404).send({ error: 'Document not found' })
      const messages = await prisma.documentChat.findMany({
        where: { documentId: doc.id },
        orderBy: { createdAt: 'asc' },
      })
      return messages
    }
  )

  // POST /documents/:shareToken/chat — send a human message, queue processing
  fastify.post<{ Params: { shareToken: string } }>(
    '/documents/:shareToken/chat',
    async (req, reply) => {
      const body = z.object({ message: z.string().min(1).max(2000), authorLabel: z.string() })
        .safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: body.error.format() })

      const doc = await prisma.document.findUnique({ where: { shareToken: req.params.shareToken } })
      if (!doc) return reply.status(404).send({ error: 'Document not found' })

      const humanMsg = await prisma.documentChat.create({
        data: { documentId: doc.id, role: 'human', body: body.data.message },
      })

      emitToDocument(doc.id, 'chat.message', { message: humanMsg })

      await chatQueue.add('process-chat', {
        documentId: doc.id,
        chatMessageId: humanMsg.id,
        message: body.data.message,
        authorLabel: body.data.authorLabel,
      })

      return { ok: true, messageId: humanMsg.id }
    }
  )

  // GET /documents/:shareToken/history — activity log for the history panel
  fastify.get<{ Params: { shareToken: string } }>(
    '/documents/:shareToken/history',
    async (req, reply) => {
      const doc = await prisma.document.findUnique({ where: { shareToken: req.params.shareToken } })
      if (!doc) return reply.status(404).send({ error: 'Document not found' })
      const activities = await prisma.documentActivity.findMany({
        where: { documentId: doc.id },
        orderBy: { createdAt: 'desc' },
      })
      return activities
    }
  )

  // POST /documents/:id/approve — approve entire document
  fastify.post<{ Params: { id: string } }>('/documents/:id/approve', async (req, reply) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { sections: true },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    if (doc.state !== 'IN_REVIEW') {
      return reply.status(409).send({ error: 'Document is not in IN_REVIEW state' })
    }

    const unapproved = doc.sections.filter((s) => s.state !== 'APPROVED')
    if (unapproved.length > 0) {
      return reply.status(409).send({
        error: 'All sections must be approved before approving the document',
        unapprovedSectionIds: unapproved.map((s) => s.id),
      })
    }

    await prisma.document.update({ where: { id: doc.id }, data: { state: 'APPROVED' } })
    emitToDocument(doc.id, 'document.stateChanged', { newState: 'APPROVED' })

    return { ok: true }
  })

  // POST /documents/:id/request-review — trigger AI review for all sections
  fastify.post<{ Params: { id: string } }>('/documents/:id/request-review', async (req, reply) => {
    const { isDocumentUnderReview, startDocumentReview } = await import('../lib/reviewTracker')
    const docId = req.params.id

    // Dedupe: if already reviewing, drop the request
    if (isDocumentUnderReview(docId)) {
      return reply.status(409).send({ 
        error: 'Review already in progress',
        reviewing: true,
      })
    }

    const doc = await prisma.document.findUnique({
      where: { id: docId },
      include: { sections: true },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })

    // Queue critic jobs for all sections that have content
    const sectionsWithContent = doc.sections.filter(s => s.content && s.content.trim().length > 0)
    
    if (sectionsWithContent.length === 0) {
      return reply.status(400).send({ error: 'No sections with content to review' })
    }

    // Mark document as under review and emit start event
    startDocumentReview(docId, sectionsWithContent.length)

    // Queue all critic jobs
    for (const section of sectionsWithContent) {
      await criticQueue.add(`critic-${section.id}-${Date.now()}`, {
        documentId: doc.id,
        sectionId: section.id,
      })
    }

    return { 
      ok: true, 
      message: `AI review requested for ${sectionsWithContent.length} section(s)`,
      sectionCount: sectionsWithContent.length,
    }
  })

  // GET /document-snapshots/:id — fetch a whole-document snapshot for preview
  fastify.get<{ Params: { id: string } }>('/document-snapshots/:id', async (req, reply) => {
    const snap = await prisma.documentSnapshot.findUnique({ where: { id: req.params.id } })
    if (!snap) return reply.status(404).send({ error: 'Snapshot not found' })
    return snap
  })

  // POST /document-snapshots/:id/restore — restore the whole document to this snapshot
  fastify.post<{ Params: { id: string } }>('/document-snapshots/:id/restore', async (req, reply) => {
    const body = z.object({ authorLabel: z.string().default('You') }).safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.format() })

    const snap = await prisma.documentSnapshot.findUnique({ where: { id: req.params.id } })
    if (!snap) return reply.status(404).send({ error: 'Snapshot not found' })

    const document = await prisma.document.findUnique({
      where: { id: snap.documentId },
      include: { sections: true },
    })
    if (!document) return reply.status(404).send({ error: 'Document not found' })

    const snapSections = snap.sections as Array<{
      sectionId: string
      title: string
      content: string
      orderIndex: number
      state?: string
    }>

    // Restore the title.
    if (snap.title && snap.title !== document.title) {
      await prisma.document.update({ where: { id: document.id }, data: { title: snap.title } })
      emitToDocument(document.id, 'document.titleChanged', { title: snap.title })
    }

    // Restore each section that still exists (matched by id). Sections added after
    // the snapshot are left untouched.
    for (const ss of snapSections) {
      const live = document.sections.find((s) => s.id === ss.sectionId)
      if (!live) continue
      const updated = await prisma.section.update({
        where: { id: live.id },
        data: { content: ss.content, version: { increment: 1 }, updatedAt: new Date() },
      })
      emitToDocument(document.id, 'section.contentReady', {
        sectionId: live.id,
        text: ss.content,
        newState: live.state,
        version: updated.version,
      })
    }

    // Record the restore as a new checkpoint so it is itself reversible.
    const newSnapshot = await createDocumentSnapshot(
      document.id,
      `Restored to version from ${new Date(snap.createdAt).toISOString()}`,
    )
    await createActivity({
      documentId: document.id,
      role: 'human',
      actorLabel: body.data.authorLabel,
      type: 'document_restored',
      body: `Restored the whole document to an earlier version.`,
      documentSnapshotId: newSnapshot.id,
    })

    return { ok: true }
  })

  // DELETE /documents/:id — permanently delete document and all related data (cascades via FK)
  fastify.delete<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    await prisma.document.delete({ where: { id: req.params.id } })
    return reply.status(204).send()
  })
}
