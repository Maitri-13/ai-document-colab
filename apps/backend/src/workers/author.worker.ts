import { Worker } from 'bullmq'
import { marked } from 'marked'
import { getRedisConnection } from '../lib/redis'
import { emitToDocument } from '../lib/socket'
import { runAuthor, AuthorInterruptedError } from '../agents/author'
import { prisma } from '../lib/prisma'
import { AuthorJob } from '../lib/queues'
import { registerAbort, clearAbort } from '../lib/interruptRegistry'
import { createActivity } from '../lib/activity'
import { createDocumentSnapshot } from '../lib/documentSnapshot'

export function startAuthorWorker() {
  const worker = new Worker<AuthorJob>(
    'author',
    async (job) => {
      const { documentId, sectionId, isRevision } = job.data
      console.log(`[Author] writing section ${sectionId} (revision=${isRevision})`)

      // Take a snapshot before revision so history is preserved
      if (isRevision) {
        const section = await prisma.section.findUnique({ where: { id: sectionId } })
        if (section?.content) {
          const revCount = await prisma.sectionSnapshot.count({ where: { sectionId } })
          await prisma.sectionSnapshot.create({
            data: {
              sectionId,
              content: section.content,
              version: section.version,
              label: revCount === 0 ? 'initial_draft' : `revision_${revCount}`,
            },
          })
        }
      }

      // Mark DRAFT
      await prisma.section.update({
        where: { id: sectionId },
        data: { state: 'DRAFT' },
      })
      emitToDocument(documentId, 'section.stateChanged', { sectionId, newState: 'DRAFT' })

      // Register abort controller so the interrupt endpoint can cancel this stream
      const ac = registerAbort(documentId)
      let rawText: string
      try {
        rawText = await runAuthor({ documentId, sectionId, isRevision, signal: ac.signal })
      } finally {
        clearAbort(documentId)
      }

      // Convert markdown → HTML so the frontend TipTap editor renders rich text
      const html = await marked.parse(rawText, { async: false }) as string

      // Increment version so SectionCard's version check triggers an editor update on the frontend
      const updated = await prisma.section.update({
        where: { id: sectionId },
        data: { content: html, state: 'OPEN', version: { increment: 1 }, updatedAt: new Date() },
      })

      if (!isRevision) {
        const snapshot = await prisma.sectionSnapshot.create({
          data: {
            sectionId,
            content: html,
            version: updated.version,
            label: 'initial_draft',
          },
        })
        const docSnapshot = await createDocumentSnapshot(
          documentId,
          `After drafting "${updated.title}"`,
        )
        await createActivity({
          documentId,
          role: 'ai',
          actorLabel: 'AI writer',
          type: 'section_drafted',
          body: `Drafted the initial "${updated.title}" from the brief.`,
          sectionId,
          snapshotId: snapshot.id,
          documentSnapshotId: docSnapshot.id,
        })
      }

      emitToDocument(documentId, 'section.contentReady', {
        sectionId,
        text: html,
        newState: 'OPEN',
        version: updated.version,
      })

      // Auto-review removed: the AI Reviewer now runs only when a human clicks
      // "Request AI Review". Once every section has been written, move the
      // document to IN_REVIEW so the UI reflects that generation is complete.
      const doc = await prisma.document.findUniqueOrThrow({
        where: { id: documentId },
        include: { sections: true },
      })
      const allWritten = doc.sections.every((s) =>
        ['OPEN', 'QUEUED_FOR_REVISION', 'REVISING', 'APPROVED'].includes(s.state)
      )
      if (allWritten && doc.state === 'GENERATING') {
        await prisma.document.update({
          where: { id: documentId },
          data: { state: 'IN_REVIEW' },
        })
        emitToDocument(documentId, 'document.stateChanged', { newState: 'IN_REVIEW' })
      }

      console.log(`[Author] section ${sectionId} done`)
    },
    {
      connection: getRedisConnection(),
      concurrency: 1,
    }
  )

  worker.on('failed', async (job, err) => {
    if (!job) return
    const { documentId, sectionId } = job.data

    // The whole handler is wrapped: if the section/document was deleted while the
    // job was in flight (cascade delete → Prisma P2025), these updates throw. As
    // an async event-listener, an uncaught throw here becomes an unhandled
    // rejection that crashes the process. Swallow it — there's nothing to clean up.
    try {
      // Interrupted intentionally — revert to NOT_STARTED so the user sees a clean state
      if (err instanceof AuthorInterruptedError || err.message === 'Author generation was interrupted') {
        await prisma.section.update({ where: { id: sectionId }, data: { state: 'NOT_STARTED' } })
        emitToDocument(documentId, 'section.stateChanged', { sectionId, newState: 'NOT_STARTED' })
        return
      }

      console.error(`[Author] job failed for section ${sectionId}:`, err.message)
      await prisma.section.update({ where: { id: sectionId }, data: { state: 'DRAFT_ERROR' } })
      emitToDocument(documentId, 'section.stateChanged', {
        sectionId,
        newState: 'DRAFT_ERROR',
        error: err.message,
      })
    } catch (cleanupErr) {
      console.error(
        `[Author] failed-handler cleanup skipped for section ${sectionId} (likely deleted):`,
        (cleanupErr as Error).message,
      )
    }
  })

  console.log('[Author worker] started')
  return worker
}
