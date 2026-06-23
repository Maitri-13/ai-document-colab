import { prisma } from './prisma'

// Capture the entire document (title + every section's content) at this moment
// in time so it can later be previewed and restored as a whole.
export async function createDocumentSnapshot(documentId: string, label: string) {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { sections: { orderBy: { orderIndex: 'asc' } } },
  })

  return prisma.documentSnapshot.create({
    data: {
      documentId,
      title: doc.title,
      label,
      sections: doc.sections.map((s) => ({
        sectionId: s.id,
        title: s.title,
        content: s.content ?? '',
        orderIndex: s.orderIndex,
        state: s.state,
      })),
    },
  })
}
