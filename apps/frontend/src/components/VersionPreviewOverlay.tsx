'use client'
import { useEffect, useState } from 'react'
import { X, RotateCcw, Loader2, Clock } from 'lucide-react'
import type { DocumentSnapshotDetail } from '../lib/types'
import { api } from '../lib/api'

interface VersionPreviewOverlayProps {
  snapshotId: string
  authorLabel: string
  onClose: () => void
  onRestored: () => void
}

export function VersionPreviewOverlay({
  snapshotId,
  authorLabel,
  onClose,
  onRestored,
}: VersionPreviewOverlayProps) {
  const [snapshot, setSnapshot] = useState<DocumentSnapshotDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getDocumentSnapshot(snapshotId)
      .then((s) => { if (!cancelled) setSnapshot(s) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [snapshotId])

  const handleRestore = async () => {
    setRestoring(true)
    try {
      await api.restoreDocumentSnapshot(snapshotId, authorLabel)
      onRestored()
    } catch (e) {
      setError((e as Error).message)
      setRestoring(false)
    }
  }

  const when = snapshot
    ? new Date(snapshot.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : ''
  const sections = snapshot ? [...snapshot.sections].sort((a, b) => a.orderIndex - b.orderIndex) : []

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={restoring ? undefined : onClose}
      />
      <div className="fixed left-1/2 top-1/2 z-[61] flex h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Read-only banner */}
        <div className="flex items-center gap-2.5 border-b border-amber-200 bg-amber-50 px-5 py-3">
          <Clock size={15} className="shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-amber-800">
              Viewing a past version{when ? ` · ${when}` : ''}
            </p>
            <p className="text-[11px] text-amber-600">
              Read-only preview. Restoring brings the whole document back to this state.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={restoring}
            className="rounded-lg p-1.5 text-amber-500 hover:bg-amber-100 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Snapshot body */}
        <div className="flex-1 overflow-y-auto px-10 py-8">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={22} className="animate-spin text-slate-300" />
            </div>
          ) : error ? (
            <p className="text-center text-sm text-red-500">{error}</p>
          ) : snapshot ? (
            <div className="mx-auto max-w-2xl">
              <h1 className="mb-6 font-serif text-[2.2rem] font-bold leading-tight tracking-tight text-slate-900">
                {snapshot.title}
              </h1>
              <hr className="mb-8 border-slate-200" />
              {sections.length === 0 ? (
                <p className="text-slate-400">No sections in this version.</p>
              ) : (
                sections.map((s) => (
                  <div key={s.sectionId} className="mb-8">
                    <h2 className="mb-3 text-[1.1rem] font-bold tracking-tight text-slate-900">{s.title}</h2>
                    {s.content ? (
                      <div
                        className="prose prose-slate max-w-none text-[15px] leading-relaxed text-slate-700 [&_hr]:hidden"
                        dangerouslySetInnerHTML={{ __html: s.content }}
                      />
                    ) : (
                      <p className="text-sm italic text-slate-400">Not written yet at this point in time.</p>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-5 py-3">
          <button
            onClick={onClose}
            disabled={restoring}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleRestore}
            disabled={restoring || loading || !snapshot}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {restoring ? (
              <><Loader2 size={14} className="animate-spin" /> Restoring…</>
            ) : (
              <><RotateCcw size={14} /> Restore this version</>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
