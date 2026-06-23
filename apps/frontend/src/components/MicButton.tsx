'use client'
import { Mic, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

interface MicButtonProps {
  // Called once with the transcribed text after a recording is processed.
  onTranscript: (text: string) => void
  className?: string
  size?: 'sm' | 'md'
}

// Records audio with MediaRecorder and transcribes it on the backend (OpenAI
// Whisper). This deliberately avoids the browser Web Speech API, which is
// unreliable across machines/browsers — getUserMedia capture works everywhere.
export function MicButton({ onTranscript, className = '', size = 'md' }: MicButtonProps) {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const onTranscriptRef = useRef(onTranscript)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Recording not supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        stopStream()
        // A few seconds of real speech is ~10KB+. Anything this small means the
        // browser captured silence (mic not actually feeding audio to this tab).
        if (blob.size < 2000) {
          setError('No audio detected — check your microphone')
          return
        }
        setTranscribing(true)
        try {
          const { text } = await api.transcribeAudio(blob)
          const clean = text?.trim()
          if (clean) onTranscriptRef.current(clean)
          else setError('No audio detected — check your microphone')
        } catch (err) {
          setError((err as Error).message || 'Transcription failed.')
        } finally {
          setTranscribing(false)
        }
      }

      // Pass a timeslice so audio is flushed periodically rather than only at
      // stop — more reliable data delivery across browsers.
      recorder.start(1000)
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch {
      setError('Microphone access failed. Allow mic permission and try again.')
      stopStream()
    }
  }, [stopStream])

  const stop = useCallback(() => {
    setRecording(false)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleClick = useCallback(() => {
    if (transcribing) return
    if (recording) stop()
    else start()
  }, [recording, transcribing, start, stop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      stopStream()
    }
  }, [stopStream])

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  const iconSize = size === 'sm' ? 14 : 16
  const busy = recording || transcribing

  return (
    <div className={`relative flex items-center gap-2 ${className}`}>
      {/* Error tooltip */}
      {error && (
        <div className="absolute bottom-full right-0 mb-2 w-52 rounded-lg bg-red-500 px-3 py-2 text-[11px] text-white shadow-lg z-50">
          <div className="font-medium">Voice Error</div>
          <div className="mt-0.5 opacity-90">{error}</div>
          <div className="absolute right-3 top-full border-4 border-transparent border-t-red-500" />
        </div>
      )}

      {/* Recording indicator — pure CSS */}
      {recording && (
        <div className="flex items-center gap-0.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-1 animate-pulse rounded-full bg-red-500"
              style={{ height: `${[8, 14, 18, 12, 9][i]}px`, animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      )}

      {/* Mic / record button */}
      <button
        type="button"
        onClick={handleClick}
        disabled={transcribing}
        className={`relative flex shrink-0 items-center justify-center rounded-full transition-all ${
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
        } ${
          recording
            ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
        } ${transcribing ? 'opacity-70' : ''}`}
        title={
          transcribing ? 'Transcribing…' : recording ? 'Click to stop & transcribe' : 'Click to record'
        }
      >
        {transcribing ? <Loader2 size={iconSize} className="animate-spin" /> : <Mic size={iconSize} />}
        {recording && (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-30" />
            <span className="absolute -inset-1 animate-pulse rounded-full border-2 border-red-300 opacity-50" />
          </>
        )}
      </button>

      {/* Status text */}
      {busy && (
        <span className={`text-[11px] font-medium ${recording ? 'text-red-500 animate-pulse' : 'text-slate-400'}`}>
          {recording ? 'Recording…' : 'Transcribing…'}
        </span>
      )}
    </div>
  )
}
