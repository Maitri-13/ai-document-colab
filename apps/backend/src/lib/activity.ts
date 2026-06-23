import { prisma } from './prisma'
import { emitToDocument } from './socket'

interface ActivityInput {
  documentId: string
  role: 'human' | 'ai'
  actorLabel: string
  type: string
  body: string
  sectionId?: string | null
  snapshotId?: string | null
  documentSnapshotId?: string | null
}

export async function createActivity(input: ActivityInput) {
  const activity = await prisma.documentActivity.create({
    data: {
      documentId: input.documentId,
      role: input.role,
      actorLabel: input.actorLabel,
      type: input.type,
      body: input.body,
      sectionId: input.sectionId ?? null,
      snapshotId: input.snapshotId ?? null,
      documentSnapshotId: input.documentSnapshotId ?? null,
    },
  })
  emitToDocument(input.documentId, 'activity.added', { activity })
  return activity
}
