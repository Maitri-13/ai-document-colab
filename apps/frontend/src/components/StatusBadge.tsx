import type { SectionState, DocumentState } from '../lib/types'

const SECTION_CONFIG: Record<SectionState, { label: string; className: string; pulse?: boolean }> = {
  NOT_STARTED: { label: 'Not started', className: 'bg-gray-100 text-gray-500' },
  DRAFT: { label: 'Drafting…', className: 'bg-blue-100 text-blue-700', pulse: true },
  OPEN: { label: 'Ready for review', className: 'bg-emerald-100 text-emerald-700' },
  QUEUED_FOR_REVISION: { label: 'Revision queued', className: 'bg-yellow-100 text-yellow-700' },
  REVISING: { label: 'Revising…', className: 'bg-orange-100 text-orange-700', pulse: true },
  APPROVED: { label: 'Approved', className: 'bg-emerald-600 text-white' },
  DRAFT_ERROR: { label: 'Draft failed', className: 'bg-red-100 text-red-700' },
}

const DOC_CONFIG: Record<DocumentState, { label: string; className: string }> = {
  SETUP: { label: 'Setup', className: 'bg-gray-100 text-gray-600' },
  GENERATING: { label: 'Generating', className: 'bg-blue-100 text-blue-700' },
  IN_REVIEW: { label: 'In review', className: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'Approved', className: 'bg-emerald-600 text-white' },
  INTERRUPTED: { label: 'Interrupted', className: 'bg-red-100 text-red-600' },
}

export function SectionStateBadge({ state }: { state: SectionState }) {
  const cfg = SECTION_CONFIG[state]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.pulse && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      {cfg.label}
    </span>
  )
}

export function DocumentStateBadge({ state }: { state: DocumentState }) {
  const cfg = DOC_CONFIG[state]
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}
