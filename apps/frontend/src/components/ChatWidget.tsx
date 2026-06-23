'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Minus, Send } from 'lucide-react'
import type { ChatMessage } from '../lib/types'
import { api } from '../lib/api'
import { Avatar } from './Avatar'
import { MicButton } from './MicButton'

interface ChatWidgetProps {
  shareToken: string
  authorLabel: string
  messages: ChatMessage[]
}

export function ChatWidget({ shareToken, authorLabel, messages }: ChatWidgetProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Page-load timestamp: only messages created after this should auto-open the
  // chat. Using a count baseline instead would falsely trigger on reload, when
  // historical messages hydrate asynchronously after mount.
  const mountTimeRef = useRef(Date.now())

  // Scroll to bottom whenever messages change or panel opens
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  // Auto-open only when a NEW AI message arrives after page load (created later
  // than mount), so reloads with existing AI history stay collapsed.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'ai' && new Date(last.createdAt).getTime() > mountTimeRef.current) {
      setOpen(true)
    }
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    try {
      await api.sendChatMessage(shareToken, { message: text, authorLabel })
    } catch (err) {
      console.error(err)
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const unread = !open && messages.some((m) => m.role === 'ai')

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Chat panel */}
      {open && (
        <div className="flex w-[360px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <Avatar name="AI writer" ai size="sm" />
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-slate-800">AI writer</p>
              <p className="text-[11px] text-slate-400">Editing with you · this doc</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <Minus size={14} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex max-h-[380px] flex-col gap-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="text-center text-[12px] text-slate-400">
                Ask the AI writer to edit any part of the document.
              </p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.role === 'human' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {msg.role === 'ai' && <Avatar name="AI writer" ai size="sm" />}
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === 'human'
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {msg.body}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-2.5">
                <Avatar name="AI writer" ai size="sm" />
                <div className="flex items-center gap-1.5 rounded-2xl bg-slate-100 px-3.5 py-2.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 px-3 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Ask the AI writer to edit this doc…"
                rows={2}
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-0"
              />
              <MicButton
                onTranscript={(t) => setInput((prev) => (prev ? `${prev} ${t}` : t))}
                size="sm"
                className="mb-0.5"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-30"
              >
                <Send size={14} />
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">Enter to send · Shift+Enter for newline · Click mic for voice</p>
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 shadow-lg hover:bg-slate-700"
      >
        <Avatar name="AI writer" ai size="sm" />
        {unread && (
          <span className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-full bg-violet-500 ring-2 ring-white" />
        )}
      </button>
    </div>
  )
}
