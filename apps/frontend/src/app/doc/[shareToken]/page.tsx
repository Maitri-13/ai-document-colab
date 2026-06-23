'use client'
import { use, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useDocument } from '@/hooks/useDocument'
import { DocumentEditor } from '@/components/DocumentEditor'

export default function DocumentPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = use(params)
  const { document, loading, error, connected, criticStatusMap, chatMessages, activities, isReviewing, setIsReviewing } = useDocument(shareToken)

  // No auth in V1 — user enters a display name on first visit, stored in localStorage.
  // In production this would be derived from an auth provider (Clerk / Auth0 / SSO).
  const [authorLabel, setAuthorLabel] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('authorLabel') ?? '' : ''
  )
  const [nameConfirmed, setNameConfirmed] = useState(() =>
    typeof window !== 'undefined' ? !!localStorage.getItem('authorLabel') : false
  )
  const [nameInput, setNameInput] = useState('')

  const confirmName = () => {
    const label = nameInput.trim() || 'Anonymous'
    setAuthorLabel(label)
    setNameConfirmed(true)
    if (typeof window !== 'undefined') localStorage.setItem('authorLabel', label)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (error || !document) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        {error ?? 'Document not found.'}
      </div>
    )
  }

  // SETUP state means the creator hasn't finished the wizard on the home page.
  // Anyone landing here via a shared link before setup completes sees this message.
  if (document.state === 'SETUP') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 text-gray-500">
        <Loader2 size={20} className="animate-spin" />
        <p className="text-sm">Waiting for the document creator to finish setup…</p>
      </div>
    )
  }

  if (!nameConfirmed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-gray-800">Who are you?</h2>
          <p className="mb-5 text-sm text-gray-500">
            Your name appears on comments and approvals.{' '}
            <span className="text-gray-400">(No login required — this is just a display name.)</span>
          </p>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmName()}
            placeholder="Your name"
            className="mb-4 w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            autoFocus
          />
          <button
            onClick={confirmName}
            className="w-full rounded-lg bg-gray-900 py-2.5 font-medium text-white hover:bg-gray-800"
          >
            Enter as {nameInput.trim() || 'Anonymous'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <DocumentEditor
      document={document}
      connected={connected}
      authorLabel={authorLabel}
      criticStatusMap={criticStatusMap}
      chatMessages={chatMessages}
      activities={activities}
      isReviewing={isReviewing}
      setIsReviewing={setIsReviewing}
    />
  )
}
