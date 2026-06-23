// Shared in-memory abort registry.
// The HTTP server and BullMQ workers run in the same Node.js process (started
// together in index.ts), so this Map is shared across both without Redis.

const registry = new Map<string, AbortController>()

export function registerAbort(documentId: string): AbortController {
  const existing = registry.get(documentId)
  if (existing) existing.abort() // clean up stale controller if any
  const ac = new AbortController()
  registry.set(documentId, ac)
  return ac
}

export function abortDocument(documentId: string): void {
  const ac = registry.get(documentId)
  if (ac) {
    ac.abort()
    registry.delete(documentId)
  }
}

export function clearAbort(documentId: string): void {
  registry.delete(documentId)
}
