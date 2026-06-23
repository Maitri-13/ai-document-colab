import { emitToDocument } from './socket'

// Track documents currently under AI review (in-memory deduplication)
// Map: documentId -> { pendingCount, totalCount }
const documentsUnderReview = new Map<string, { pending: number; total: number }>()

export function isDocumentUnderReview(documentId: string): boolean {
  return documentsUnderReview.has(documentId)
}

export function startDocumentReview(documentId: string, sectionCount: number): void {
  documentsUnderReview.set(documentId, { pending: sectionCount, total: sectionCount })
  emitToDocument(documentId, 'document.reviewStarted', { sectionCount })

  // Safety timeout: if jobs don't complete in 5 minutes, release the lock
  setTimeout(() => {
    if (documentsUnderReview.has(documentId)) {
      documentsUnderReview.delete(documentId)
      emitToDocument(documentId, 'document.reviewCompleted', { 
        sectionCount,
        timeout: true,
      })
    }
  }, 5 * 60 * 1000)
}

export function markSectionReviewComplete(documentId: string): void {
  const status = documentsUnderReview.get(documentId)
  if (!status) return
  
  status.pending--
  if (status.pending <= 0) {
    documentsUnderReview.delete(documentId)
    emitToDocument(documentId, 'document.reviewCompleted', { 
      sectionCount: status.total,
    })
  }
}
