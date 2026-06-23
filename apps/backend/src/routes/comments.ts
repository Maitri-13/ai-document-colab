import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { emitToDocument } from '../lib/socket'
import { createActivity } from '../lib/activity'

const CreateCommentSchema = z.object({
  body: z.string().min(1).max(2000),
  authorLabel: z.string().min(1).max(100).default('Human'),
  parentId: z.string().uuid().optional(),
  anchoredText: z.string().max(1000).optional(),
})

const ResolveCommentSchema = z.object({
  resolvedBy: z.string().min(1).max(100).default('Human'),
})

export const commentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /sections/:sectionId/comments — list all unresolved comments for a section
  fastify.get<{ Params: { sectionId: string } }>(
    '/sections/:sectionId/comments',
    async (req, reply) => {
      const section = await prisma.section.findUnique({ where: { id: req.params.sectionId } })
      if (!section) return reply.status(404).send({ error: 'Section not found' })

      const comments = await prisma.comment.findMany({
        where: { sectionId: req.params.sectionId, resolved: false },
        orderBy: { createdAt: 'asc' },
      })
      return comments
    }
  )

  // POST /sections/:sectionId/comments — add human comment
  fastify.post<{ Params: { sectionId: string } }>(
    '/sections/:sectionId/comments',
    async (req, reply) => {
      const body = CreateCommentSchema.safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: body.error.format() })

      const section = await prisma.section.findUnique({ where: { id: req.params.sectionId } })
      if (!section) return reply.status(404).send({ error: 'Section not found' })

      // Validate parent comment belongs to same section
      if (body.data.parentId) {
        const parent = await prisma.comment.findUnique({ where: { id: body.data.parentId } })
        if (!parent || parent.sectionId !== req.params.sectionId) {
          return reply.status(400).send({ error: 'Parent comment not found in this section' })
        }
      }

      const comment = await prisma.comment.create({
        data: {
          sectionId: req.params.sectionId,
          parentId: body.data.parentId,
          authorType: 'human',
          authorLabel: body.data.authorLabel,
          body: body.data.body,
          anchoredText: body.data.anchoredText ?? null,
        },
      })

      const document = await prisma.document.findUniqueOrThrow({
        where: { id: section.documentId },
      })

      emitToDocument(document.id, 'section.commentAdded', {
        sectionId: req.params.sectionId,
        comment,
      })

      await createActivity({
        documentId: document.id,
        role: 'human',
        actorLabel: body.data.authorLabel,
        type: 'comment_added',
        body: `Commented on "${section.title}".`,
        sectionId: section.id,
      })

      reply.status(201).send(comment)
    }
  )

  // PATCH /comments/:id/resolve — resolve a comment
  fastify.patch<{ Params: { id: string } }>('/comments/:id/resolve', async (req, reply) => {
    const body = ResolveCommentSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.format() })

    const comment = await prisma.comment.findUnique({ where: { id: req.params.id } })
    if (!comment) return reply.status(404).send({ error: 'Comment not found' })
    if (comment.resolved) return reply.status(409).send({ error: 'Comment already resolved' })

    const now = new Date()
    const updated = await prisma.comment.update({
      where: { id: req.params.id },
      data: { resolved: true, resolvedBy: body.data.resolvedBy, resolvedAt: now },
    })

    const section = await prisma.section.findUniqueOrThrow({ where: { id: comment.sectionId } })
    emitToDocument(section.documentId, 'section.commentResolved', {
      sectionId: comment.sectionId,
      commentId: req.params.id,
      resolvedBy: body.data.resolvedBy,
    })

    return updated
  })

  // DELETE /comments/:id — delete a human comment (AI critic comments cannot be deleted)
  fastify.delete<{ Params: { id: string } }>('/comments/:id', async (req, reply) => {
    const comment = await prisma.comment.findUnique({ where: { id: req.params.id } })
    if (!comment) return reply.status(404).send({ error: 'Comment not found' })
    if (comment.authorType === 'ai_critic') {
      return reply.status(403).send({ error: 'AI Critic comments cannot be deleted' })
    }

    await prisma.comment.delete({ where: { id: req.params.id } })

    const section = await prisma.section.findUniqueOrThrow({ where: { id: comment.sectionId } })
    emitToDocument(section.documentId, 'section.commentDeleted', {
      sectionId: comment.sectionId,
      commentId: req.params.id,
    })

    reply.status(204).send()
  })
}
