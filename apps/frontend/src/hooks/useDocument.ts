'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket } from './useSocket'
import { api } from '../lib/api'
import type { Document, Section, Comment, Resource, ChatMessage, DocumentActivity } from '../lib/types'

export type CriticStatus = 'reviewing' | 'reviewed'

export function useDocument(shareToken: string) {
  const [document, setDocument] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [criticStatusMap, setCriticStatusMap] = useState<Record<string, CriticStatus>>({})
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [activities, setActivities] = useState<DocumentActivity[]>([])
  const [isReviewing, setIsReviewing] = useState(false)
  const { socket, connected } = useSocket()
  const documentIdRef = useRef<string | null>(null)

  // Initial load
  useEffect(() => {
    setLoading(true)
    api
      .getDocument(shareToken)
      .then((doc) => {
        setDocument(doc)
        documentIdRef.current = doc.id
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))

    api.getChatHistory(shareToken).then(setChatMessages).catch(() => {})
    api.getHistory(shareToken).then(setActivities).catch(() => {})
  }, [shareToken])

  // Join socket room once we have documentId and are connected
  useEffect(() => {
    if (!documentIdRef.current || !connected) return
    socket.emit('document:join', { documentId: documentIdRef.current })
    return () => {
      socket.emit('document:leave', { documentId: documentIdRef.current })
    }
  }, [socket, connected, documentIdRef.current]) // eslint-disable-line

  // Re-join and sync on reconnect
  useEffect(() => {
    if (!connected || !documentIdRef.current) return
    socket.emit('document:join', { documentId: documentIdRef.current })
  }, [connected, socket])

  // Socket events
  useEffect(() => {
    const updateSection = (sectionId: string, updater: (s: Section) => Section) => {
      setDocument((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          sections: prev.sections.map((s) => (s.id === sectionId ? updater(s) : s)),
        }
      })
    }

    socket.on('document.snapshot', (doc: Document) => {
      setDocument(doc)
      documentIdRef.current = doc.id
    })

    socket.on('document.stateChanged', ({ newState }: { newState: Document['state'] }) => {
      setDocument((prev) => (prev ? { ...prev, state: newState } : prev))
    })

    socket.on('document.titleChanged', ({ title }: { title: string }) => {
      setDocument((prev) => (prev ? { ...prev, title } : prev))
    })

    socket.on(
      'section.stateChanged',
      ({
        sectionId,
        newState,
        approvedBy,
        version,
      }: {
        sectionId: string
        newState: Section['state']
        approvedBy?: string
        version?: number
      }) => {
        updateSection(sectionId, (s) => ({
          ...s,
          state: newState,
          ...(approvedBy ? { approvedBy } : {}),
          ...(version !== undefined ? { version } : {}),
        }))
      }
    )

    socket.on(
      'section.contentReady',
      ({ sectionId, text, newState, version }: { sectionId: string; text: string; newState: Section['state']; version?: number }) => {
        updateSection(sectionId, (s) => ({
          ...s,
          content: text,
          state: newState,
          ...(version !== undefined ? { version } : {}),
        }))
      }
    )

    socket.on(
      'section.contentUpdated',
      ({
        sectionId,
        content,
        version,
      }: {
        sectionId: string
        content: string
        version: number
      }) => {
        updateSection(sectionId, (s) => ({ ...s, content, version }))
      }
    )

    socket.on('section.criticStarted', ({ sectionId }: { sectionId: string }) => {
      setCriticStatusMap((prev) => ({ ...prev, [sectionId]: 'reviewing' }))
    })

    socket.on(
      'section.criticReviewed',
      ({ sectionId, comments }: { sectionId: string; commentCount: number; comments: Comment[] }) => {
        updateSection(sectionId, (s) => ({
          ...s,
          // Replace AI critic comments so re-reviews don't stack duplicates
          comments: [...s.comments.filter((c) => c.authorType !== 'ai_critic'), ...comments],
        }))
        setCriticStatusMap((prev) => ({ ...prev, [sectionId]: 'reviewed' }))
      }
    )

    socket.on('section.commentAdded', ({ sectionId, comment }: { sectionId: string; comment: Comment }) => {
      updateSection(sectionId, (s) => ({ ...s, comments: [...s.comments, comment] }))
    })

    socket.on('section.commentResolved', ({ sectionId, commentId }: { sectionId: string; commentId: string }) => {
      updateSection(sectionId, (s) => ({
        ...s,
        comments: s.comments.filter((c) => c.id !== commentId),
      }))
    })

    socket.on('section.commentDeleted', ({ sectionId, commentId }: { sectionId: string; commentId: string }) => {
      updateSection(sectionId, (s) => ({
        ...s,
        comments: s.comments.filter((c) => c.id !== commentId),
      }))
    })

    socket.on('resource.added', ({ resource }: { resource: Resource }) => {
      setDocument((prev) =>
        prev ? { ...prev, resources: [...prev.resources, resource] } : prev
      )
    })

    socket.on('resource.ready', ({ resource }: { resource: Resource }) => {
      setDocument((prev) =>
        prev
          ? { ...prev, resources: prev.resources.map((r) => (r.id === resource.id ? resource : r)) }
          : prev
      )
    })

    socket.on('resource.failed', ({ resource }: { resource: Resource }) => {
      setDocument((prev) =>
        prev
          ? { ...prev, resources: prev.resources.map((r) => (r.id === resource.id ? resource : r)) }
          : prev
      )
    })

    socket.on('resource.deleted', ({ resourceId }: { resourceId: string }) => {
      setDocument((prev) =>
        prev ? { ...prev, resources: prev.resources.filter((r) => r.id !== resourceId) } : prev
      )
    })

    socket.on('chat.message', ({ message }: { message: ChatMessage }) => {
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev
        return [...prev, message]
      })
    })

    socket.on('activity.added', ({ activity }: { activity: DocumentActivity }) => {
      setActivities((prev) => {
        if (prev.some((a) => a.id === activity.id)) return prev
        return [activity, ...prev] // newest first
      })
    })

    socket.on('document.reviewStarted', () => {
      setIsReviewing(true)
    })

    socket.on('document.reviewCompleted', () => {
      setIsReviewing(false)
    })

    return () => {
      socket.off('document.snapshot')
      socket.off('document.stateChanged')
      socket.off('document.titleChanged')
      socket.off('section.stateChanged')
      socket.off('section.contentReady')
      socket.off('section.contentUpdated')
      socket.off('section.criticStarted')
      socket.off('section.criticReviewed')
      socket.off('section.commentAdded')
      socket.off('section.commentResolved')
      socket.off('section.commentDeleted')
      socket.off('resource.added')
      socket.off('resource.ready')
      socket.off('resource.failed')
      socket.off('resource.deleted')
      socket.off('chat.message')
      socket.off('activity.added')
      socket.off('document.reviewStarted')
      socket.off('document.reviewCompleted')
    }
  }, [socket])

  // Actions that update local state optimistically
  const optimisticallyUpdateSection = useCallback((sectionId: string, patch: Partial<Section>) => {
    setDocument((prev) =>
      prev
        ? { ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) }
        : prev
    )
  }, [])

  const refreshDocument = useCallback(async () => {
    if (!shareToken) return
    const doc = await api.getDocument(shareToken)
    setDocument(doc)
  }, [shareToken])

  return {
    document,
    loading,
    error,
    connected,
    criticStatusMap,
    chatMessages,
    setChatMessages,
    activities,
    setActivities,
    optimisticallyUpdateSection,
    refreshDocument,
    setDocument,
    isReviewing,
    setIsReviewing,
  }
}
