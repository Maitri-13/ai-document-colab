'use client'
import { Loader2 } from 'lucide-react'
import type { Section } from '../lib/types'
import type { CriticStatus } from '../hooks/useDocument'

interface SectionSidebarProps {
  section: Section
  criticStatus?: CriticStatus
}

export function SectionSidebar({ section, criticStatus }: SectionSidebarProps) {
  const isDrafting = section.state === 'DRAFT' || section.state === 'REVISING'
  const isNotStarted = section.state === 'NOT_STARTED'

  const unresolvedCritic = section.comments.filter((c) => !c.resolved && c.authorType === 'ai_critic')

  if (isDrafting || isNotStarted) {
    return <div className="py-10" />
  }

  return (
    <div className="py-10">
      {criticStatus === 'reviewing' && (
        <div className="flex items-center gap-1.5 text-xs text-violet-500">
          <Loader2 size={11} className="animate-spin" />
          AI reviewing…
        </div>
      )}
      {criticStatus === 'reviewed' && unresolvedCritic.length === 0 && (
        <p className="text-[11px] text-slate-400">AI review complete</p>
      )}
    </div>
  )
}
