'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Share2, Plus, ChevronDown, ChevronRight, Sparkles, Search, Trash2, Bot } from 'lucide-react'
import type { Document, ChatMessage, DocumentActivity } from '../lib/types'
import type { CriticStatus } from '../hooks/useDocument'
import { api } from '../lib/api'

import { SectionCard } from './SectionCard'
import { SectionSidebar } from './SectionSidebar'
import { DocumentCommentsPanel } from './DocumentCommentsPanel'
import { ChatWidget } from './ChatWidget'
import { HistoryPanel } from './HistoryPanel'
import { VersionPreviewOverlay } from './VersionPreviewOverlay'

interface DocHistoryEntry {
  shareToken: string
  title: string
  createdAt: string
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.includes(q)) return true
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

interface DocumentEditorProps {
  document: Document
  connected: boolean
  authorLabel: string
  criticStatusMap: Record<string, CriticStatus>
  chatMessages: ChatMessage[]
  activities: DocumentActivity[]
  isReviewing: boolean
  setIsReviewing: (reviewing: boolean) => void
}

export function DocumentEditor({
  document,
  authorLabel,
  criticStatusMap,
  chatMessages,
  activities,
  isReviewing,
  setIsReviewing,
}: DocumentEditorProps) {
  const applyFnMap = useRef<Map<string, (selected: string, replacement: string) => void>>(new Map())
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null)
  const mainContentRef = useRef<HTMLDivElement>(null)
  
  // Pending comment state - when user selects text and clicks "Comment"
  const [pendingComment, setPendingComment] = useState<{ sectionId: string; anchoredText: string } | null>(null)

  const [copied, setCopied] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [previewSnapshotId, setPreviewSnapshotId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savingCountRef = useRef(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const [docTitle, setDocTitle] = useState(document.title)
  const [history, setHistory] = useState<DocHistoryEntry[]>([])
  const [docsCollapsed, setDocsCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('collabdocs_history')
      if (raw) setHistory(JSON.parse(raw) as DocHistoryEntry[])
    } catch {}
  }, [])

  // Keep the title in sync when it changes remotely (e.g. the AI writer renames
  // the document via chat, arriving over the document.titleChanged socket event).
  useEffect(() => {
    setDocTitle(document.title)
  }, [document.title])

  const handleSavingChange = useCallback((saving: boolean) => {
    if (saving) {
      savingCountRef.current++
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      setSaveStatus('saving')
    } else {
      savingCountRef.current = Math.max(0, savingCountRef.current - 1)
      if (savingCountRef.current === 0) {
        saveTimeoutRef.current = setTimeout(() => setSaveStatus('saved'), 200)
      }
    }
  }, [])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.deleteDocument(document.id)
      try {
        const raw = localStorage.getItem('collabdocs_history')
        if (raw) {
          const history = JSON.parse(raw) as Array<{ shareToken: string }>
          localStorage.setItem(
            'collabdocs_history',
            JSON.stringify(history.filter((e) => e.shareToken !== document.shareToken))
          )
        }
      } catch {}
      window.location.href = '/'
    } catch (err) {
      console.error('Delete failed:', err)
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleTitleBlur = async (e: React.FocusEvent<HTMLHeadingElement>) => {
    const newTitle = e.currentTarget.textContent?.trim() || document.title
    if (newTitle === docTitle) return
    setDocTitle(newTitle)
    try {
      await api.updateDocument(document.id, { title: newTitle })
      setHistory((prev) =>
        prev.map((entry) =>
          entry.shareToken === document.shareToken ? { ...entry, title: newTitle } : entry
        )
      )
      try {
        const raw = localStorage.getItem('collabdocs_history')
        if (raw) {
          const stored = JSON.parse(raw) as DocHistoryEntry[]
          localStorage.setItem(
            'collabdocs_history',
            JSON.stringify(
              stored.map((e) =>
                e.shareToken === document.shareToken ? { ...e, title: newTitle } : e
              )
            )
          )
        }
      } catch {}
    } catch (err) {
      console.error('Title update failed:', err)
      e.currentTarget.textContent = docTitle
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLHeadingElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  const handleCopyLink = () => {
    if (typeof window === 'undefined') return
    navigator.clipboard.writeText(`${window.location.origin}/doc/${document.shareToken}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRequestAIReview = async () => {
    if (isReviewing) return // Already reviewing
    setIsReviewing(true)
    try {
      await api.requestAIReview(document.id)
      // isReviewing will be set to false by the socket event (document.reviewCompleted)
    } catch (err: unknown) {
      const error = err as { status?: number }
      // If 409, it means review is already in progress - that's fine
      if (error.status !== 409) {
        console.error('Failed to request AI review:', err)
        setIsReviewing(false)
      }
    }
  }

  const handleApplyFromComment = (sectionId: string, selected: string, replacement: string) => {
    const applyFn = applyFnMap.current.get(sectionId)
    if (applyFn) applyFn(selected, replacement)
  }

  const handleInlineComment = (sectionId: string, selectedText: string) => {
    // Set pending comment - the comments panel will show an input card
    setPendingComment({ sectionId, anchoredText: selectedText })
  }

  const handleSubmitPendingComment = async (body: string) => {
    if (!pendingComment) return
    
    try {
      await api.addComment(pendingComment.sectionId, {
        body,
        authorLabel,
        anchoredText: pendingComment.anchoredText,
      })
      setPendingComment(null)
    } catch (err) {
      console.error('Failed to create comment:', err)
    }
  }

  const handleCancelPendingComment = () => {
    setPendingComment(null)
  }

  const completionPct =
    document.sections.length === 0
      ? 0
      : Math.round(
          (document.sections.filter((s) =>
            ['OPEN', 'APPROVED', 'QUEUED_FOR_REVISION', 'REVISING'].includes(s.state)
          ).length /
            document.sections.length) *
            100
        )

  const filteredHistory = searchQuery
    ? history.filter((e) => fuzzyMatch(searchQuery, e.title))
    : history

  return (
    <div className="flex min-h-screen bg-slate-100">

      {/* Left sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2.5">
          <div className="relative flex-1">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs…"
              className="w-full rounded-md border border-slate-200 bg-slate-50 py-1 pl-6 pr-2 text-[12px] text-slate-700 placeholder-slate-400 focus:border-slate-300 focus:outline-none"
            />
          </div>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title="New document"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
          >
            <Plus size={13} />
          </a>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <div className="mb-1">
            <button
              onClick={() => setDocsCollapsed((c) => !c)}
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
            >
              {docsCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              Documents
            </button>

            {!docsCollapsed && (
              filteredHistory.length === 0 ? (
                <p className="px-2 py-4 text-[11px] text-slate-400">
                  {searchQuery ? 'No matching docs.' : 'No documents yet.'}
                </p>
              ) : (
                <div className="mt-0.5">
                  {filteredHistory.map((entry) => {
                    const isCurrent = entry.shareToken === document.shareToken
                    return (
                      <a
                        key={entry.shareToken}
                        href={`/doc/${entry.shareToken}`}
                        target={isCurrent ? undefined : '_blank'}
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors ${
                          isCurrent
                            ? 'bg-slate-100 font-medium text-slate-800'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Sparkles size={11} className="shrink-0 text-violet-400" />
                        <span className="truncate">{entry.title}</span>
                      </a>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </nav>
      </aside>

      {/* Main area with document and comments */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Toolbar */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-6 py-2.5">
            <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-slate-400">
              <span className="shrink-0">Documents</span>
              <span className="shrink-0">/</span>
              <span className="truncate font-medium text-slate-700">{docTitle}</span>
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              {saveStatus === 'saving' && (
                <span className="text-xs text-slate-400">Saving…</span>
              )}
              {saveStatus === 'saved' && (
                <span className="text-xs font-medium text-emerald-500">✓ Saved</span>
              )}

              <button
                onClick={handleRequestAIReview}
                disabled={isReviewing}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <Bot size={14} />
                {isReviewing ? 'Reviewing…' : 'Request AI Review'}
              </button>

              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  showHistory
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <History size={14} /> History
              </button>

              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <Share2 size={14} /> {copied ? 'Copied!' : 'Share'}
              </button>

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                title="Delete document"
              >
                <Trash2 size={14} />
              </button>

            </div>
          </div>

          {['GENERATING', 'IN_REVIEW'].includes(document.state) && (
            <div className="h-0.5 bg-slate-100">
              <div
                className="h-full bg-blue-500 transition-all duration-700"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          )}
        </header>

        {/* Document body with comments panel */}
        <main className="flex flex-1 gap-0 overflow-hidden">
          {/* Document content */}
          <div ref={mainContentRef} className="flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto max-w-3xl rounded-lg bg-white shadow-sm">
              {/* Title */}
              <div className="px-14 pb-4 pt-12">
                <h1
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={handleTitleBlur}
                  onKeyDown={handleTitleKeyDown}
                  className="font-serif text-[2.6rem] font-bold leading-tight tracking-tight text-slate-900 outline-none focus:opacity-80"
                >
                  {docTitle}
                </h1>
                <hr className="mt-6 border-slate-200" />
              </div>

              {/* Sections */}
              {document.sections.length === 0 ? (
                <div className="py-24 text-center text-slate-400">No sections yet.</div>
              ) : (
                document.sections.map((section) => (
                  <div key={section.id} className="px-14">
                    <SectionCard
                      section={section}
                      authorLabel={authorLabel}
                      onSavingChange={handleSavingChange}
                      onEditorReady={(fn) => applyFnMap.current.set(section.id, fn)}
                      onInlineComment={handleInlineComment}
                      focusedCommentId={focusedCommentId}
                      onHighlightClick={(commentId) => setFocusedCommentId(commentId)}
                      onHighlightHover={(commentId) => setFocusedCommentId(commentId)}
                    />
                    {/* Critic status inline */}
                    <SectionSidebar section={section} criticStatus={criticStatusMap[section.id]} />
                  </div>
                ))
              )}

              {/* Bottom padding */}
              <div className="pb-12" />
            </div>
          </div>

          {/* Comments panel - always visible on the right */}
          <aside className="w-80 shrink-0 border-l border-slate-200 bg-slate-50 overflow-y-auto">
            <div className="sticky top-0 bg-slate-50 px-4 py-3 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-700">Comments</h3>
            </div>
            <div className="px-2 py-2">
              <DocumentCommentsPanel
                sections={document.sections}
                authorLabel={authorLabel}
                onApply={handleApplyFromComment}
                focusedCommentId={focusedCommentId}
                onCommentHover={(id) => setFocusedCommentId(id)}
                onCommentClick={(id) => setFocusedCommentId(id)}
                containerRef={mainContentRef}
                pendingComment={pendingComment}
                onSubmitPendingComment={handleSubmitPendingComment}
                onCancelPendingComment={handleCancelPendingComment}
              />
            </div>
          </aside>
        </main>
      </div>

      {/* Version history panel */}
      {showHistory && (
        <HistoryPanel
          activities={activities}
          onClose={() => setShowHistory(false)}
          onPreview={(snapshotId) => { setShowHistory(false); setPreviewSnapshotId(snapshotId) }}
        />
      )}

      {/* Whole-document point-in-time preview + restore */}
      {previewSnapshotId && (
        <VersionPreviewOverlay
          snapshotId={previewSnapshotId}
          authorLabel={authorLabel}
          onClose={() => setPreviewSnapshotId(null)}
          onRestored={() => setPreviewSnapshotId(null)}
        />
      )}

      {/* Floating chat widget */}
      <ChatWidget
        shareToken={document.shareToken}
        authorLabel={authorLabel}
        messages={chatMessages}
      />

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => !deleting && setShowDeleteConfirm(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100">
                <Trash2 size={16} className="text-red-600" />
              </div>
              <h2 className="text-[15px] font-semibold text-slate-800">Delete document?</h2>
            </div>
            <p className="mb-5 mt-2 text-sm text-slate-500">
              <span className="font-medium text-slate-700">{docTitle}</span> and all its
              version history will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Yes, delete permanently'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
