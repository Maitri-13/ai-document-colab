'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Check, X, Sparkles, Wand2, MessageSquare, CheckCircle } from 'lucide-react'
import type { Comment, Section } from '../lib/types'
import { api } from '../lib/api'
import { Avatar, timeAgo } from './Avatar'

interface DocumentCommentsPanelProps {
  sections: Section[]
  authorLabel: string
  onApply?: (sectionId: string, selected: string, replacement: string) => void
  focusedCommentId?: string | null
  onCommentHover?: (commentId: string | null) => void
  onCommentClick?: (commentId: string) => void
  containerRef: React.RefObject<HTMLElement | null>
  pendingComment?: { sectionId: string; anchoredText: string } | null
  onSubmitPendingComment?: (body: string) => void
  onCancelPendingComment?: () => void
}

interface PositionedComment {
  comment: Comment
  sectionId: string
  top: number
}

function CommentCard({
  comment,
  sectionId,
  authorLabel,
  onResolve,
  onReply,
  onApply,
  isFocused,
  onHover,
  onClick,
  style,
}: {
  comment: Comment
  sectionId: string
  authorLabel: string
  onResolve: (id: string) => void
  onReply: (sectionId: string, parentId: string, body: string) => void
  onApply?: (sectionId: string, selected: string, replacement: string) => void
  isFocused?: boolean
  onHover?: (commentId: string | null) => void
  onClick?: (commentId: string) => void
  style?: React.CSSProperties
}) {
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)

  const isCritic = comment.authorType === 'ai_critic'
  const isHuman = comment.authorType === 'human'
  const displayName = isCritic ? 'Reviewer' : comment.authorLabel
  const hasAnchor = !!comment.anchoredText

  const handleApply = () => {
    if (!comment.anchoredText || !comment.replacementText || !onApply) return
    setApplying(true)
    onApply(sectionId, comment.anchoredText, comment.replacementText)
    setTimeout(() => { setApplying(false); setApplied(true) }, 300)
  }

  const handleSubmitReply = async () => {
    if (!replyText.trim()) return
    setSubmittingReply(true)
    try {
      await onReply(sectionId, comment.id, replyText.trim())
      setReplyText('')
      setShowReplyInput(false)
    } finally {
      setSubmittingReply(false)
    }
  }

  const handleReplyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmitReply()
    }
    if (e.key === 'Escape') {
      setShowReplyInput(false)
      setReplyText('')
    }
  }

  useEffect(() => {
    if (showReplyInput && replyInputRef.current) {
      replyInputRef.current.focus()
    }
  }, [showReplyInput])

  return (
    <div
      style={style}
      className={`absolute left-0 right-0 rounded-xl border bg-white shadow-sm transition-all duration-150 ${
        isCritic ? 'border-violet-200' : 'border-slate-200'
      } ${isFocused ? 'ring-2 ring-yellow-400 ring-offset-1 z-20' : 'z-10'} ${hasAnchor ? 'cursor-pointer' : ''}`}
      onMouseEnter={() => hasAnchor && onHover?.(comment.id)}
      onMouseLeave={() => hasAnchor && onHover?.(null)}
      onClick={() => hasAnchor && onClick?.(comment.id)}
    >
      {/* Header */}
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <Avatar name={displayName} ai={isCritic} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold text-slate-800">{displayName}</span>
            {isCritic && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                <Sparkles size={7} />
                AI
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400">{timeAgo(comment.createdAt)}</p>
        </div>

        {/* Close button for AI comments only */}
        {isCritic && (
          <button
            onClick={(e) => { e.stopPropagation(); onResolve(comment.id) }}
            className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Body - truncated */}
      <div className="px-3 pb-2 pt-1.5">
        <p className="line-clamp-3 text-[12px] leading-relaxed text-slate-700">{comment.body}</p>
      </div>

      {/* Replacement suggestion (AI critic only) */}
      {isCritic && comment.replacementText && (
        <div className="mx-3 mb-2.5 rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-2">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-violet-400">Suggested fix</p>
          <p className="line-clamp-2 text-[11px] leading-snug text-violet-800">{comment.replacementText}</p>
          {!applied ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleApply() }}
              disabled={applying}
              className="mt-1.5 flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Wand2 size={9} />
              {applying ? 'Applying…' : 'Apply'}
            </button>
          ) : (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-500">
              <Check size={9} /> Applied
            </p>
          )}
        </div>
      )}

      {/* Replies section */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mx-3 mb-2 border-l-2 border-slate-200 pl-2.5">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="mb-2 last:mb-0">
              <div className="flex items-center gap-1.5">
                <Avatar name={reply.authorLabel} size="xs" />
                <span className="text-[11px] font-semibold text-slate-700">{reply.authorLabel}</span>
                <span className="text-[10px] text-slate-400">{timeAgo(reply.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{reply.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input for human comments */}
      {isHuman && showReplyInput && (
        <div className="mx-3 mb-2.5" onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={replyInputRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleReplyKeyDown}
            placeholder="Write a reply..."
            className="w-full resize-none rounded border border-slate-200 px-2 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            rows={2}
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              onClick={() => { setShowReplyInput(false); setReplyText('') }}
              className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitReply}
              disabled={!replyText.trim() || submittingReply}
              className="rounded bg-blue-500 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {submittingReply ? 'Sending...' : 'Reply'}
            </button>
          </div>
        </div>
      )}

      {/* Action buttons for human comments */}
      {isHuman && !showReplyInput && (
        <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); setShowReplyInput(true) }}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
          >
            <MessageSquare size={11} /> Reply
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onResolve(comment.id) }}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-emerald-50 hover:text-emerald-600"
          >
            <CheckCircle size={11} /> Resolve
          </button>
        </div>
      )}
    </div>
  )
}

export function DocumentCommentsPanel({
  sections,
  authorLabel,
  onApply,
  focusedCommentId,
  onCommentHover,
  onCommentClick,
  containerRef,
  pendingComment,
  onSubmitPendingComment,
  onCancelPendingComment,
}: DocumentCommentsPanelProps) {
  const [positionedComments, setPositionedComments] = useState<PositionedComment[]>([])
  const [pendingCommentText, setPendingCommentText] = useState('')
  // Optimistic dismiss: IDs dismissed locally but not yet confirmed via socket event
  const [locallyDismissed, setLocallyDismissed] = useState<Set<string>>(new Set())
  const pendingInputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Gather all unresolved top-level comments and nest replies - memoized to prevent infinite loops
  const allComments = useMemo(() => {
    const comments: { comment: Comment; sectionId: string }[] = []

    for (const section of sections) {
      // Create a map of all comments by id for quick lookup
      const commentMap = new Map<string, Comment>()
      for (const c of section.comments) {
        commentMap.set(c.id, { ...c, replies: [] })
      }

      // Attach replies to their parents
      for (const c of section.comments) {
        if (c.parentId && commentMap.has(c.parentId)) {
          const parent = commentMap.get(c.parentId)!
          if (!c.resolved) {
            parent.replies = parent.replies || []
            parent.replies.push(commentMap.get(c.id)!)
          }
        }
      }

      // Only include top-level comments (no parentId) that are not resolved and not optimistically dismissed
      for (const c of section.comments) {
        if (!c.parentId && !c.resolved && !locallyDismissed.has(c.id)) {
          comments.push({ comment: commentMap.get(c.id)!, sectionId: section.id })
        }
      }
    }
    return comments
  }, [sections, locallyDismissed])

  // Keep a ref so calculatePositions always sees the latest allComments without
  // needing it as a dependency (which would cause scroll listeners to be torn
  // down and re-added on every comment change, creating the timer-reset race).
  const allCommentsRef = useRef(allComments)
  useEffect(() => { allCommentsRef.current = allComments }, [allComments])

  // Stable positioning function — only recreated when containerRef changes
  const calculatePositions = useCallback(() => {
    if (!containerRef.current || !panelRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const scrollTop = containerRef.current.scrollTop || 0
    const comments = allCommentsRef.current

    const positioned: PositionedComment[] = []

    // Split comments into those whose anchor highlight is currently rendered
    // (positioned next to their text) and "orphans" — unanchored comments, or
    // anchored ones whose highlight isn't painted yet / no longer matches the
    // text. Orphans are NEVER dropped; they're stacked below the anchored cards
    // so comments don't vanish when an anchor can't be resolved.
    const anchored: { comment: Comment; sectionId: string; naturalTop: number }[] = []
    const orphans: { comment: Comment; sectionId: string }[] = []

    for (const { comment, sectionId } of comments) {
      if (comment.anchoredText) {
        const highlight = containerRef.current?.querySelector(`[data-comment-id="${comment.id}"]`)
        if (highlight) {
          const rect = highlight.getBoundingClientRect()
          anchored.push({ comment, sectionId, naturalTop: rect.top - containerRect.top + scrollTop })
          continue
        }
      }
      orphans.push({ comment, sectionId })
    }

    anchored.sort((a, b) => a.naturalTop - b.naturalTop)

    // Position cards top-to-bottom, never overlapping the previous one.
    const CARD_HEIGHT = 140
    const GAP = 8
    let lastBottom = 0

    for (const { comment, sectionId, naturalTop } of anchored) {
      const finalTop = Math.max(naturalTop, lastBottom + GAP)
      lastBottom = finalTop + CARD_HEIGHT
      positioned.push({ comment, sectionId, top: finalTop })
    }

    for (const { comment, sectionId } of orphans) {
      const finalTop = lastBottom + GAP
      lastBottom = finalTop + CARD_HEIGHT
      positioned.push({ comment, sectionId, top: finalTop })
    }

    setPositionedComments(positioned)
  }, [containerRef])

  // Signature of rendered section content. When content arrives after reload the
  // editor paints comment highlights a frame later, so we must recompute
  // positions then — not only when the comment list itself changes.
  const contentSignature = useMemo(
    () => sections.map((s) => `${s.id}:${s.content?.length ?? 0}:${s.version}`).join('|'),
    [sections]
  )

  // Recalculate after comments or content change. Two passes (immediate-ish +
  // delayed) cover TipTap's asynchronous decoration paint without resetting the
  // scroll listeners.
  useEffect(() => {
    const t1 = setTimeout(calculatePositions, 50)
    const t2 = setTimeout(calculatePositions, 300)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [allComments, contentSignature, calculatePositions])

  // Stable scroll/resize listeners — only re-setup when containerRef changes
  useEffect(() => {
    const container = containerRef.current
    if (container) {
      container.addEventListener('scroll', calculatePositions)
      window.addEventListener('resize', calculatePositions)
    }
    return () => {
      if (container) container.removeEventListener('scroll', calculatePositions)
      window.removeEventListener('resize', calculatePositions)
    }
  }, [calculatePositions, containerRef])

  // Focus the pending comment input when it appears
  useEffect(() => {
    if (pendingComment && pendingInputRef.current) {
      pendingInputRef.current.focus()
    }
    // Reset text when pending comment changes
    setPendingCommentText('')
  }, [pendingComment])

  const handleResolve = (id: string) => {
    // Optimistically hide before the round-trip so the dismiss feels instant and
    // a snapshot arriving mid-flight can't make the comment flicker back.
    setLocallyDismissed((prev) => new Set([...prev, id]))
    api.resolveComment(id, authorLabel).catch(console.error)
  }

  const handleReply = async (sectionId: string, parentId: string, body: string) => {
    try {
      await api.addComment(sectionId, {
        body,
        authorLabel,
        parentId,
      })
    } catch (err) {
      console.error('Failed to add reply:', err)
    }
  }

  const handleSubmitPending = () => {
    if (pendingCommentText.trim() && onSubmitPendingComment) {
      onSubmitPendingComment(pendingCommentText.trim())
      setPendingCommentText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmitPending()
    }
    if (e.key === 'Escape') {
      onCancelPendingComment?.()
    }
  }

  return (
    <div ref={panelRef} className="relative min-h-full">
      {/* Pending comment input card */}
      {pendingComment && (
        <div className="mx-2 mb-3 rounded-lg border-2 border-blue-300 bg-white p-3 shadow-md">
          <div className="mb-2 text-[11px] text-slate-500">
            Commenting on: <span className="font-medium text-slate-700">"{pendingComment.anchoredText.slice(0, 60)}{pendingComment.anchoredText.length > 60 ? '...' : ''}"</span>
          </div>
          <textarea
            ref={pendingInputRef}
            value={pendingCommentText}
            onChange={(e) => setPendingCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add your comment..."
            className="w-full resize-none rounded border border-slate-200 px-2 py-1.5 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            rows={2}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={onCancelPendingComment}
              className="rounded px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitPending}
              disabled={!pendingCommentText.trim()}
              className="rounded bg-blue-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>
      )}

      {/* Existing comments */}
      {allComments.length === 0 && !pendingComment ? (
        <div className="px-4 py-8 text-center text-[12px] text-slate-400">
          No comments yet
        </div>
      ) : (
        positionedComments.map(({ comment, sectionId, top }) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            sectionId={sectionId}
            authorLabel={authorLabel}
            onResolve={handleResolve}
            onReply={handleReply}
            onApply={onApply}
            isFocused={focusedCommentId === comment.id}
            onHover={onCommentHover}
            onClick={onCommentClick}
            style={{ top: `${top}px` }}
          />
        ))
      )}
    </div>
  )
}
