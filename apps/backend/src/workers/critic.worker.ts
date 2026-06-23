import { Worker } from 'bullmq'
import { getRedisConnection } from '../lib/redis'
import { emitToDocument } from '../lib/socket'
import { runCritic } from '../agents/critic'
import { prisma } from '../lib/prisma'
import { CriticJob } from '../lib/queues'
import { markSectionReviewComplete } from '../lib/reviewTracker'

export function startCriticWorker() {
  const worker = new Worker<CriticJob>(
    'critic',
    async (job) => {
      const { documentId, sectionId } = job.data
      console.log(`[Critic] reviewing section ${sectionId}`)

      emitToDocument(documentId, 'section.criticStarted', { sectionId })

      // Clear previous unresolved AI critic comments before creating new ones so
      // re-reviews don't produce duplicate feedback for already-dismissed items.
      await prisma.comment.deleteMany({
        where: { sectionId, authorType: 'ai_critic', resolved: false },
      })

      const comments = await runCritic({ documentId, sectionId })

      // Create individually to get real UUIDs back (createMany doesn't return records)
      const saved = comments.length > 0
        ? await Promise.all(
            comments.map((c) =>
              prisma.comment.create({
                data: {
                  sectionId,
                  authorType: 'ai_critic',
                  authorLabel: 'Reviewer',
                  body: c.body,
                  anchoredText: c.anchoredText ?? null,
                  replacementText: c.replacementText ?? null,
                },
              })
            )
          )
        : []

      // Replace (not append) the section's AI critic comments on the frontend
      emitToDocument(documentId, 'section.criticReviewed', {
        sectionId,
        commentCount: saved.length,
        comments: saved,
      })

      // Check if entire document is now fully reviewed (all sections OPEN or better)
      const document = await prisma.document.findUniqueOrThrow({
        where: { id: documentId },
        include: { sections: true },
      })

      const allReady = document.sections.every((s) =>
        ['OPEN', 'QUEUED_FOR_REVISION', 'REVISING', 'APPROVED'].includes(s.state)
      )

      if (allReady && document.state === 'GENERATING') {
        await prisma.document.update({
          where: { id: documentId },
          data: { state: 'IN_REVIEW' },
        })
        emitToDocument(documentId, 'document.stateChanged', { newState: 'IN_REVIEW' })
      }

      console.log(`[Critic] section ${sectionId} reviewed — ${comments.length} comment(s)`)
      
      // Mark this section as complete for the review tracker
      markSectionReviewComplete(documentId)
    },
    {
      connection: getRedisConnection(),
      concurrency: 10,
    }
  )

  worker.on('failed', (job, err) => {
    if (!job) return
    console.error(`[Critic] job failed for section ${job.data.sectionId}:`, err.message)
    // Still mark as complete to avoid blocking the review
    markSectionReviewComplete(job.data.documentId)
  })

  console.log('[Critic worker] started')
  return worker
}
