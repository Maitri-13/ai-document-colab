'use client'
import { X, Eye } from 'lucide-react'
import type { DocumentActivity } from '../lib/types'
import { Avatar } from './Avatar'

interface HistoryPanelProps {
  activities: DocumentActivity[]
  onClose: () => void
  onPreview: (documentSnapshotId: string) => void
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function groupByDate(activities: DocumentActivity[]): [string, DocumentActivity[]][] {
  const map = new Map<string, DocumentActivity[]>()
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86_400_000).toDateString()

  for (const a of activities) {
    const d = new Date(a.createdAt).toDateString()
    const label =
      d === today
        ? 'Today'
        : d === yesterday
        ? 'Yesterday'
        : new Date(a.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(a)
  }

  return Array.from(map.entries())
}

function ActivityRow({
  activity,
  isFirst,
  onPreview,
}: {
  activity: DocumentActivity
  isFirst: boolean
  onPreview: (documentSnapshotId: string) => void
}) {
  const isAI = activity.role === 'ai'
  // Any activity that captured a whole-document snapshot can be previewed/restored.
  const canPreview = !!activity.documentSnapshotId

  return (
    <div className="flex gap-3 px-5 py-3.5">
      <div className="mt-0.5 shrink-0">
        <Avatar name={activity.actorLabel} ai={isAI} size="sm" />
      </div>

      <div className="min-w-0 flex-1">
        {/* Name row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-semibold text-slate-800">{activity.actorLabel}</span>
          {isAI && (
            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              AI
            </span>
          )}
          {isFirst && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              Current
            </span>
          )}
          <span className="ml-auto text-[11px] text-slate-400">{formatTime(activity.createdAt)}</span>
        </div>

        {/* Body */}
        <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{activity.body}</p>

        {/* Preview the whole document as of this checkpoint */}
        {canPreview && (
          <button
            onClick={() => onPreview(activity.documentSnapshotId!)}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <Eye size={11} />
            View this version
          </button>
        )}
      </div>
    </div>
  )
}

export function HistoryPanel({ activities, onClose, onPreview }: HistoryPanelProps) {
  const groups = groupByDate(activities)
  const firstId = activities[0]?.id

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-40 flex h-full w-[400px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-800">Version history</h2>
            <p className="text-[12px] text-slate-400">Every edit, by people and AI</p>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto">
          {activities.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-slate-400">
              No activity yet. Start writing to build a history.
            </p>
          ) : (
            groups.map(([label, items]) => (
              <div key={label}>
                <div className="sticky top-0 bg-white/95 px-5 py-2 backdrop-blur-sm">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {label}
                  </span>
                </div>
                {items.map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    isFirst={activity.id === firstId}
                    onPreview={onPreview}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
