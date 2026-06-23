import { Document, DocumentType, ChatMessage, DocumentActivity, DocumentSnapshotDetail } from './types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when there's an actual JSON body — Fastify's JSON body
  // parser rejects an empty body with Content-Type: application/json (400).
  const headers: Record<string, string> =
    init?.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}

  const res = await fetch(`${BASE}${path}`, {
    headers: { ...headers, ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw Object.assign(new Error(err.error ?? 'Request failed'), { status: res.status, data: err })
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  // Documents
  getDocument: (shareToken: string) => req<Document>(`/api/documents/${shareToken}`),

  createDocument: (data: { title: string; brief: string; type: DocumentType }) =>
    req<Document>('/api/documents', { method: 'POST', body: JSON.stringify(data) }),

  getOutline: (id: string) =>
    req<{ sections: string[]; title: string }>(`/api/documents/${id}/outline`, { method: 'POST' }),

  confirmOutline: (id: string, sections: string[]) =>
    req<Document>(`/api/documents/${id}/confirm-outline`, {
      method: 'POST',
      body: JSON.stringify({ sections }),
    }),

  startWriting: (id: string) =>
    req<{ ok: boolean }>(`/api/documents/${id}/start`, { method: 'POST' }),

  updateDocument: (id: string, data: { title?: string; brief?: string }) =>
    req<Document>(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteDocument: (id: string) =>
    req<void>(`/api/documents/${id}`, { method: 'DELETE' }),

  interruptDocument: (id: string) =>
    req<{ ok: boolean }>(`/api/documents/${id}/interrupt`, { method: 'POST' }),

  restartDocument: (id: string) =>
    req<{ ok: boolean }>(`/api/documents/${id}/restart`, { method: 'POST' }),

  approveDocument: (id: string) =>
    req<{ ok: boolean }>(`/api/documents/${id}/approve`, { method: 'POST' }),

  requestAIReview: (id: string) =>
    req<{ ok: boolean; message: string; sectionCount: number }>(`/api/documents/${id}/request-review`, { method: 'POST' }),

  // Sections
  editSection: (id: string, data: { content: string; version: number; authorLabel?: string }) =>
    req<{ version: number }>(`/api/sections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  approveSection: (id: string, data: { version: number; authorLabel?: string }) =>
    req<{ ok: boolean; version: number }>(`/api/sections/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  reopenSection: (id: string) =>
    req<{ ok: boolean }>(`/api/sections/${id}/reopen`, { method: 'POST' }),

  requestRevision: (id: string, authorLabel?: string) =>
    req<{ ok: boolean }>(`/api/sections/${id}/request-revision`, {
      method: 'POST',
      body: JSON.stringify({ authorLabel: authorLabel ?? 'Human' }),
    }),

  // Comments
  addComment: (sectionId: string, data: { body: string; authorLabel?: string; parentId?: string; anchoredText?: string }) =>
    req(`/api/sections/${sectionId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resolveComment: (commentId: string, resolvedBy?: string) =>
    req(`/api/comments/${commentId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolvedBy: resolvedBy ?? 'Human' }),
    }),

  deleteComment: (commentId: string) =>
    req(`/api/comments/${commentId}`, { method: 'DELETE' }),

  // Resources
  uploadResource: (documentId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return req(`/api/documents/${documentId}/resources`, {
      method: 'POST',
      headers: {},
      body: form,
    })
  },

  deleteResource: (resourceId: string) =>
    req(`/api/resources/${resourceId}`, { method: 'DELETE' }),

  // Chat
  getChatHistory: (shareToken: string) =>
    req<ChatMessage[]>(`/api/documents/${shareToken}/chat`),

  sendChatMessage: (shareToken: string, data: { message: string; authorLabel: string }) =>
    req<{ ok: boolean; messageId: string }>(`/api/documents/${shareToken}/chat`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // History
  getHistory: (shareToken: string) =>
    req<DocumentActivity[]>(`/api/documents/${shareToken}/history`),

  restoreSnapshot: (snapshotId: string, authorLabel: string) =>
    req<{ ok: boolean; version: number }>(`/api/snapshots/${snapshotId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ authorLabel }),
    }),

  // Whole-document snapshots (preview + restore)
  getDocumentSnapshot: (id: string) =>
    req<DocumentSnapshotDetail>(`/api/document-snapshots/${id}`),

  restoreDocumentSnapshot: (id: string, authorLabel: string) =>
    req<{ ok: boolean }>(`/api/document-snapshots/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ authorLabel }),
    }),

  // Voice: send a recorded audio blob, get back the transcript (OpenAI Whisper)
  transcribeAudio: (blob: Blob) => {
    const form = new FormData()
    form.append('file', blob, 'recording.webm')
    return req<{ text: string }>('/api/transcribe', { method: 'POST', headers: {}, body: form })
  },
}
