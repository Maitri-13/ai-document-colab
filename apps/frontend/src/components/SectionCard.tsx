'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { marked } from 'marked'
import { Check, Loader2, GitMerge, RefreshCw, PenLine, MessageSquarePlus } from 'lucide-react'
import type { Section } from '../lib/types'
import { api } from '../lib/api'

interface CommentAnchor {
  id: string
  text: string
}

interface SectionCardProps {
  section: Section
  authorLabel: string
  onSavingChange?: (saving: boolean) => void
  onEditorReady?: (applyFn: (selected: string, replacement: string) => void) => void
  onInlineComment?: (sectionId: string, selectedText: string) => void
  focusedCommentId?: string | null
  onHighlightClick?: (commentId: string) => void
  onHighlightHover?: (commentId: string | null) => void
}

function toEditorHTML(content: string | null): string {
  if (!content) return ''
  const trimmed = content.trimStart()
  if (trimmed.startsWith('<')) return content
  return marked.parse(content, { async: false }) as string
}

const commentHighlightKey = new PluginKey<DecorationSet>('commentHighlight')

/**
 * Build a flat string of document text and a position map.
 * The map tracks the document position corresponding to each character index.
 */
function extractTextWithPositions(doc: Parameters<typeof DecorationSet.create>[0]): { text: string; posMap: number[] } {
  let text = ''
  const posMap: number[] = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i)
        text += node.text[i]
      }
    }
  })
  return { text, posMap }
}

function buildDecorationSet(
  doc: Parameters<typeof DecorationSet.create>[0],
  anchors: CommentAnchor[],
  focusedId: string | null
): DecorationSet {
  if (!anchors.length) return DecorationSet.empty

  const { text: docText, posMap } = extractTextWithPositions(doc)
  const decos: Decoration[] = []

  anchors.forEach(({ id, text: searchText }) => {
    if (!searchText) return
    let idx = 0
    while ((idx = docText.indexOf(searchText, idx)) !== -1) {
      const from = posMap[idx]
      const to = posMap[idx + searchText.length - 1] + 1
      const isFocused = id === focusedId
      decos.push(
        Decoration.inline(from, to, {
          class: isFocused ? 'comment-anchor-highlight comment-anchor-focused' : 'comment-anchor-highlight',
          'data-comment-id': id,
        })
      )
      idx += searchText.length
    }
  })

  return DecorationSet.create(doc, decos)
}

interface HighlightPluginState {
  anchors: CommentAnchor[]
  focusedId: string | null
}

function makeHighlightExtension(stateRef: { current: HighlightPluginState }) {
  return Extension.create({
    name: 'commentHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: commentHighlightKey,
          state: {
            init(_, state) {
              return buildDecorationSet(state.doc, stateRef.current.anchors, stateRef.current.focusedId)
            },
            apply(tr, old) {
              if (tr.getMeta(commentHighlightKey)) {
                return buildDecorationSet(tr.doc, stateRef.current.anchors, stateRef.current.focusedId)
              }
              return tr.docChanged ? old.map(tr.mapping, tr.doc) : old
            },
          },
          props: {
            decorations(state) {
              return this.getState(state)
            },
          },
        }),
      ]
    },
  })
}

export function SectionCard({
  section,
  authorLabel,
  onSavingChange,
  onEditorReady,
  onInlineComment,
  focusedCommentId,
  onHighlightClick,
  onHighlightHover,
}: SectionCardProps) {
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [versionConflict, setVersionConflict] = useState<{
    currentVersion: number
    currentContent: string
  } | null>(null)
  const contentVersionRef = useRef(section.version)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const editorWrapperRef = useRef<HTMLDivElement>(null)
  const [selectionTooltip, setSelectionTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  // Ref holding comment anchors and focused state — updated without recreating the editor
  const highlightStateRef = useRef<HighlightPluginState>({ anchors: [], focusedId: null })
  const HighlightExt = useMemo(() => makeHighlightExtension(highlightStateRef), [])

  const isEditable = ['OPEN', 'QUEUED_FOR_REVISION'].includes(section.state)
  const isDrafting = section.state === 'DRAFT' || section.state === 'REVISING'
  const isNotStarted = section.state === 'NOT_STARTED'
  const isApproved = section.state === 'APPROVED'

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Section content will appear here…' }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      HighlightExt,
    ],
    content: toEditorHTML(section.content),
    editable: isEditable,
    onUpdate: ({ editor }) => {
      // Only autosave genuine human edits. Programmatic doc changes (AI content
      // load via setContent, setEditable toggling on draft completion, conflict
      // resolution, restore) all happen while the editor is NOT focused — saving
      // on those records a phantom "human edited" activity. Using the live
      // editor.isFocused / isEditable also avoids stale-closure bugs.
      if (!editor.isEditable || !editor.isFocused) return
      setAutoSaveStatus('idle')
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(() => { handleSave() }, 1500)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (section.version > contentVersionRef.current && !editor.isFocused) {
      // emitUpdate:false — this is a programmatic load of AI/remote content, not a
      // human edit. Without it, onUpdate fires → autosave → a phantom
      // "human edited" activity is recorded right after the AI draft.
      editor.commands.setContent(toEditorHTML(section.content), { emitUpdate: false })
      contentVersionRef.current = section.version
    }
  }, [section.version, section.content, editor])

  useEffect(() => {
    if (!editor) return
    // emitUpdate:false — toggling editability must not fire onUpdate (TipTap v3
    // emits 'update' from setEditable by default), which would otherwise trigger
    // a phantom autosave when a section flips to editable after the AI draft.
    editor.setEditable(isEditable, false)
  }, [isEditable, editor])

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  // Keep highlight ref in sync with unresolved anchored comments
  useEffect(() => {
    highlightStateRef.current.anchors = section.comments
      .filter((c) => !c.resolved && c.anchoredText)
      .map((c) => ({ id: c.id, text: c.anchoredText! }))
    if (editor?.view) {
      editor.view.dispatch(editor.view.state.tr.setMeta(commentHighlightKey, true))
    }
  }, [section.comments, editor])

  // Update focused comment highlight when focusedCommentId changes
  useEffect(() => {
    highlightStateRef.current.focusedId = focusedCommentId ?? null
    if (editor?.view) {
      editor.view.dispatch(editor.view.state.tr.setMeta(commentHighlightKey, true))
    }
  }, [focusedCommentId, editor])

  // Handle clicks on highlighted text to focus the corresponding comment
  const handleEditorClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      const highlight = target.closest('[data-comment-id]') as HTMLElement | null
      if (highlight && onHighlightClick) {
        const commentId = highlight.dataset.commentId
        if (commentId) onHighlightClick(commentId)
      }
    },
    [onHighlightClick]
  )

  // Handle mouse enter/leave on highlights for hover effect
  const handleEditorMouseOver = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      const highlight = target.closest('[data-comment-id]') as HTMLElement | null
      if (highlight && onHighlightHover) {
        onHighlightHover(highlight.dataset.commentId ?? null)
      }
    },
    [onHighlightHover]
  )

  const handleEditorMouseOut = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      const highlight = target.closest('[data-comment-id]') as HTMLElement | null
      if (highlight && onHighlightHover) {
        onHighlightHover(null)
      }
    },
    [onHighlightHover]
  )

  // Register the apply-replacement function with the parent so CommentsPanel can call it
  useEffect(() => {
    if (!editor || !onEditorReady) return
    onEditorReady((selected, replacement) => {
      const { state } = editor
      let from = -1
      let to = -1
      state.doc.descendants((node, pos) => {
        if (from !== -1 || !node.isText || !node.text) return
        const idx = node.text.indexOf(selected)
        if (idx !== -1) {
          from = pos + idx
          to = from + selected.length
        }
      })
      if (from !== -1) {
        editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, replacement).run()
      }
    })
  }, [editor, onEditorReady])

  // Detect text selections inside the editor and show a floating "comment" tooltip
  const handleMouseUp = useCallback(() => {
    if (!onInlineComment) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) { setSelectionTooltip(null); return }
    const text = sel.toString().trim()
    if (!text || !editorWrapperRef.current?.contains(sel.anchorNode)) {
      setSelectionTooltip(null)
      return
    }
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setSelectionTooltip({ text, x: rect.left + rect.width / 2, y: rect.top - 8 })
  }, [onInlineComment])

  const handleSave = useCallback(async () => {
    if (!editor) return
    const content = editor.getHTML()
    if (!content || content === '<p></p>') return
    setAutoSaveStatus('saving')
    onSavingChange?.(true)
    try {
      const result = await api.editSection(section.id, {
        content,
        version: contentVersionRef.current,
        authorLabel,
      })
      contentVersionRef.current = result.version
      setAutoSaveStatus('saved')
      onSavingChange?.(false)
      setTimeout(() => setAutoSaveStatus('idle'), 2000)
    } catch (err: unknown) {
      const e = err as { status?: number; data?: { currentVersion: number; currentContent: string } }
      if (e.status === 409 && e.data?.currentVersion !== undefined) {
        setVersionConflict({
          currentVersion: e.data.currentVersion,
          currentContent: e.data.currentContent,
        })
      }
      setAutoSaveStatus('error')
      onSavingChange?.(false)
      setTimeout(() => setAutoSaveStatus('idle'), 3000)
    }
  }, [editor, section.id, authorLabel])

  const handleConflictAcceptRemote = () => {
    if (!editor || !versionConflict) return
    editor.commands.setContent(toEditorHTML(versionConflict.currentContent), { emitUpdate: false })
    contentVersionRef.current = versionConflict.currentVersion
    setVersionConflict(null)
  }

  const handleConflictKeepMine = () => {
    if (!versionConflict) return
    contentVersionRef.current = versionConflict.currentVersion
    setVersionConflict(null)
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => { handleSave() }, 300)
  }

  return (
    <div className="py-9" onMouseUp={handleMouseUp}>
      {/* Floating "add inline comment" tooltip — appears above text selection */}
      {selectionTooltip && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: selectionTooltip.x, top: selectionTooltip.y }}
          onMouseUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const text = selectionTooltip.text
              setSelectionTooltip(null)
              window.getSelection()?.removeAllRanges()
              onInlineComment?.(section.id, text)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[12px] font-medium text-white shadow-lg hover:bg-slate-700"
          >
            <MessageSquarePlus size={12} /> Comment
          </button>
          <div className="mx-auto mt-0.5 h-1.5 w-1.5 rotate-45 bg-slate-800" />
        </div>
      )}

      {/* Section heading */}
      <div className="mb-4 flex items-baseline gap-2.5">
        <h2
          className={`text-[1.1rem] font-bold leading-snug tracking-tight ${
            isNotStarted ? 'text-slate-400' : isApproved ? 'text-slate-700' : 'text-slate-900'
          }`}
        >
          {section.title}
        </h2>
        {(section.state === 'DRAFT' || section.state === 'REVISING') && (
          <span className="flex items-center gap-1 text-xs text-blue-500">
            <Loader2 size={11} className="animate-spin" />
            {section.state === 'REVISING' ? 'Revising…' : 'Drafting…'}
          </span>
        )}
        {isApproved && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check size={12} />
            {section.approvedBy}
          </span>
        )}
        {section.state === 'DRAFT_ERROR' && (
          <span className="text-xs text-red-500">Draft failed</span>
        )}
      </div>

      {/* Drafting skeleton */}
      {isDrafting && !section.content && (
        <div className="space-y-2.5 py-1">
          {[0.75, 1, 0.85, 0.65, 1, 0.8].map((w, i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-slate-100"
              style={{ width: `${w * 100}%` }}
            />
          ))}
        </div>
      )}

      {/* Not started placeholder */}
      {isNotStarted && (
        <p className="text-sm italic text-slate-400">
          Queued — will start once the previous section is complete.
        </p>
      )}

      {/* Editor */}
      {!isDrafting && !isNotStarted && (
        <>
          {versionConflict && (
            <div className="mb-4 overflow-hidden rounded-xl border border-orange-200 shadow-sm">
              <div className="flex items-center gap-2 bg-orange-500 px-4 py-2.5 text-white">
                <GitMerge size={14} />
                <span className="text-sm font-semibold">
                  Someone else saved this section first
                </span>
              </div>
              <div className="bg-orange-50 px-4 py-3">
                <p className="mb-3 text-sm text-orange-800">Choose how to resolve:</p>
                <div className="mb-3 max-h-28 overflow-y-auto rounded-lg border border-orange-200 bg-white px-3 py-2">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-500">
                    Their version
                  </p>
                  <p className="text-sm text-gray-700">
                    {versionConflict.currentContent?.slice(0, 200)}
                    {(versionConflict.currentContent?.length ?? 0) > 200 ? '…' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleConflictAcceptRemote}
                    className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
                  >
                    <RefreshCw size={11} /> Use their version
                  </button>
                  <button
                    onClick={handleConflictKeepMine}
                    className="flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100"
                  >
                    <PenLine size={11} /> Keep my edits & overwrite
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            ref={editorWrapperRef}
            className="prose prose-slate max-w-none text-[15px] leading-relaxed text-slate-700 [&_hr]:hidden"
            onClick={handleEditorClick}
            onMouseOver={handleEditorMouseOver}
            onMouseOut={handleEditorMouseOut}
          >
            <EditorContent editor={editor} />
          </div>

          {isEditable && (
            <div className="mt-2 flex justify-end text-xs text-slate-400">
              {autoSaveStatus === 'saving' && (
                <span className="flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Saving…
                </span>
              )}
              {autoSaveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-emerald-500">
                  <Check size={11} /> Saved
                </span>
              )}
              {autoSaveStatus === 'error' && !versionConflict && (
                <span className="text-red-400">Save failed — try again</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
