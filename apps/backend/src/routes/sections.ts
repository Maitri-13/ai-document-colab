import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authorQueue } from '../lib/queues'
import { emitToDocument } from '../lib/socket'
import { createActivity } from '../lib/activity'
import { createDocumentSnapshot } from '../lib/documentSnapshot'

const EditSectionSchema = z.object({
  content: z.string().min(1),
  version: z.number().int().min(0),
  authorLabel: z.string().min(1).max(100).default('Human'),
})

const RequestRevisionSchema = z.object({
  authorLabel: z.string().min(1).max(100).default('Human'),
})

const ApproveSectionSchema = z.object({
  version: z.number().int().min(0),
  authorLabel: z.string().min(1).max(100).default('Human'),
})

export const sectionRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /sections/:id/snapshots — fetch revision history
  fastify.get<{ Params: { id: string } }>('/sections/:id/snapshots', async (req, reply) => {
    const snapshots = await prisma.sectionSnapshot.findMany({
      where: { sectionId: req.params.id },
      orderBy: { createdAt: 'asc' },
    })
    return snapshots
  })

  // PATCH /sections/:id — human edits section content (optimistic lock)
  fastify.patch<{ Params: { id: string } }>('/sections/:id', async (req, reply) => {
    const body = EditSectionSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.format() })

    const section = await prisma.section.findUnique({ where: { id: req.params.id } })
    if (!section) return reply.status(404).send({ error: 'Section not found' })

    if (!['OPEN', 'QUEUED_FOR_REVISION'].includes(section.state)) {
      return reply.status(409).send({
        error: `Section is in state ${section.state} and cannot be edited`,
      })
    }

    // Optimistic lock check
    if (section.version !== body.data.version) {
      const fresh = await prisma.section.findUniqueOrThrow({ where: { id: req.params.id } })
      return reply.status(409).send({
        error: 'Version conflict — another edit was saved first',
        currentVersion: fresh.version,
        currentContent: fresh.content,
      })
    }

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: section.documentId },
    })

    const updated = await prisma.section.update({
      where: { id: req.params.id },
      data: {
        content: body.data.content,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })

    emitToDocument(document.id, 'section.contentUpdated', {
      sectionId: section.id,
      content: body.data.content,
      version: updated.version,
      authorLabel: body.data.authorLabel,
    })

    // Debounce: log at most one section_edited activity per user per section per 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    const recentEdit = await prisma.documentActivity.findFirst({
      where: {
        documentId: document.id,
        sectionId: section.id,
        type: 'section_edited',
        actorLabel: body.data.authorLabel,
        createdAt: { gte: fiveMinAgo },
      },
    })
    if (!recentEdit) {
      const docSnapshot = await createDocumentSnapshot(document.id, `After ${body.data.authorLabel} edited "${section.title}"`)
      await createActivity({
        documentId: document.id,
        role: 'human',
        actorLabel: body.data.authorLabel,
        type: 'section_edited',
        body: `Edited "${section.title}".`,
        sectionId: section.id,
        documentSnapshotId: docSnapshot.id,
      })
    }

    return { version: updated.version }
  })

  // POST /sections/:id/approve — approve section (optimistic lock, first to approve wins)
  fastify.post<{ Params: { id: string } }>('/sections/:id/approve', async (req, reply) => {
    const body = ApproveSectionSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.format() })

    const section = await prisma.section.findUnique({ where: { id: req.params.id } })
    if (!section) return reply.status(404).send({ error: 'Section not found' })

    if (section.state === 'APPROVED') {
      return reply.status(409).send({
        error: 'Section already approved',
        approvedBy: section.approvedBy,
        approvedAt: section.approvedAt,
      })
    }

    if (!['OPEN', 'QUEUED_FOR_REVISION'].includes(section.state)) {
      return reply.status(409).send({
        error: `Section is in state ${section.state} and cannot be approved`,
      })
    }

    // Optimistic lock — reject stale versions
    if (section.version !== body.data.version) {
      const fresh = await prisma.section.findUniqueOrThrow({ where: { id: req.params.id } })
      return reply.status(409).send({
        error: 'Version conflict — content changed since you loaded it',
        currentVersion: fresh.version,
        currentContent: fresh.content,
      })
    }

    const now = new Date()
    const updated = await prisma.section.update({
      where: { id: req.params.id },
      data: {
        state: 'APPROVED',
        approvedBy: body.data.authorLabel,
        approvedAt: now,
        version: { increment: 1 },
      },
    })

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: section.documentId },
      include: { sections: true },
    })

    emitToDocument(document.id, 'section.stateChanged', {
      sectionId: section.id,
      newState: 'APPROVED',
      approvedBy: body.data.authorLabel,
      version: updated.version,
    })

    // Check if all sections approved → auto-move document to IN_REVIEW if not already
    const allApproved = document.sections.every(
      (s) => s.id === section.id || s.state === 'APPROVED'
    )
    if (allApproved && document.state === 'IN_REVIEW') {
      emitToDocument(document.id, 'document.allSectionsApproved', {})
    }

    return { ok: true, version: updated.version }
  })

  // POST /sections/:id/reopen — un-approve an approved section
  fastify.post<{ Params: { id: string } }>('/sections/:id/reopen', async (req, reply) => {
    const section = await prisma.section.findUnique({ where: { id: req.params.id } })
    if (!section) return reply.status(404).send({ error: 'Section not found' })
    if (section.state !== 'APPROVED') {
      return reply.status(409).send({ error: 'Section is not APPROVED' })
    }

    const updated = await prisma.section.update({
      where: { id: req.params.id },
      data: { state: 'OPEN', approvedBy: null, approvedAt: null },
    })

    emitToDocument(section.documentId, 'section.stateChanged', {
      sectionId: section.id,
      newState: 'OPEN',
      version: updated.version,
    })

    // If the document was fully approved, un-approve it back to IN_REVIEW
    const doc = await prisma.document.findUnique({ where: { id: section.documentId } })
    if (doc?.state === 'APPROVED') {
      await prisma.document.update({
        where: { id: section.documentId },
        data: { state: 'IN_REVIEW' },
      })
      emitToDocument(section.documentId, 'document.stateChanged', { newState: 'IN_REVIEW' })
    }

    return { ok: true }
  })

  // POST /sections/:id/request-revision — human triggers revision loop
  fastify.post<{ Params: { id: string } }>(
    '/sections/:id/request-revision',
    async (req, reply) => {
      const body = RequestRevisionSchema.safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: body.error.format() })

      const section = await prisma.section.findUnique({ where: { id: req.params.id } })
      if (!section) return reply.status(404).send({ error: 'Section not found' })

      if (!['OPEN', 'QUEUED_FOR_REVISION'].includes(section.state)) {
        return reply.status(409).send({
          error: `Section is in state ${section.state} and cannot be sent for revision`,
        })
      }

      await prisma.section.update({
        where: { id: req.params.id },
        data: { state: 'REVISING' },
      })

      emitToDocument(section.documentId, 'section.stateChanged', {
        sectionId: section.id,
        newState: 'REVISING',
        requestedBy: body.data.authorLabel,
      })

      await authorQueue.add(
        'revise-section',
        { documentId: section.documentId, sectionId: section.id, isRevision: true },
        { jobId: `author_revision_${section.id}_${Date.now()}` }
      )

      return { ok: true }
    }
  )

  // POST /snapshots/:snapshotId/restore — restore a section to a saved snapshot
  fastify.post<{ Params: { snapshotId: string } }>(
    '/snapshots/:snapshotId/restore',
    async (req, reply) => {
      const body = z.object({ authorLabel: z.string().default('You') }).safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: body.error.format() })

      const snapshot = await prisma.sectionSnapshot.findUnique({ where: { id: req.params.snapshotId } })
      if (!snapshot) return reply.status(404).send({ error: 'Snapshot not found' })

      const section = await prisma.section.findUniqueOrThrow({ where: { id: snapshot.sectionId } })

      const updated = await prisma.section.update({
        where: { id: section.id },
        data: { content: snapshot.content, version: { increment: 1 }, updatedAt: new Date() },
      })

      // Create a new snapshot recording this restore point
      const snapCount = await prisma.sectionSnapshot.count({ where: { sectionId: section.id } })
      const newSnapshot = await prisma.sectionSnapshot.create({
        data: {
          sectionId: section.id,
          content: snapshot.content,
          version: updated.version,
          label: `restore_from_${snapshot.label}`,
        },
      })

      emitToDocument(section.documentId, 'section.contentReady', {
        sectionId: section.id,
        text: snapshot.content,
        newState: section.state,
        version: updated.version,
      })

      await createActivity({
        documentId: section.documentId,
        role: 'human',
        actorLabel: body.data.authorLabel,
        type: 'section_restored',
        body: `Restored "${section.title}" to an earlier version (${snapshot.label}).`,
        sectionId: section.id,
        snapshotId: newSnapshot.id,
      })

      return { ok: true, version: updated.version }
    }
  )
}
