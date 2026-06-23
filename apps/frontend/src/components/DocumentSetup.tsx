'use client'
import { useCallback, useState } from 'react'
import { Plus, Minus, FileText, Upload, Loader2, X } from 'lucide-react'
import type { Document, DocumentType, Resource } from '../lib/types'
import { api } from '../lib/api'

interface DocumentSetupProps {
  document: Document
  onStarted: () => void
}

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  tech_design_doc: 'Technical Design Doc',
  product_spec: 'Product Spec',
  security_review: 'Security Review',
  plan: 'Project Plan',
  custom: 'Custom',
}

const DOC_TYPE_DESCRIPTIONS: Record<DocumentType, string> = {
  tech_design_doc: 'Architecture, data model, API design, failure modes',
  product_spec: 'User stories, requirements, success metrics',
  security_review: 'Threat model, vulnerabilities, mitigations',
  plan: 'Objectives, milestones, dependencies, risks',
  custom: 'AI generates a custom outline based on your brief',
}

export function DocumentSetup({ document, onStarted }: DocumentSetupProps) {
  const [step, setStep] = useState<'brief' | 'outline' | 'resources'>('brief')
  const [title, setTitle] = useState(document.title)
  const [brief, setBrief] = useState(document.brief)
  const [docType, setDocType] = useState<DocumentType>(document.type)
  const [sections, setSections] = useState<string[]>([])
  const [loadingOutline, setLoadingOutline] = useState(false)
  const [starting, setStarting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [resources, setResources] = useState<Resource[]>(document.resources)

  const handleGetOutline = async () => {
    setLoadingOutline(true)
    try {
      const result = await api.getOutline(document.id)
      setSections(result.sections)
      setStep('outline')
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingOutline(false)
    }
  }

  const handleStart = async () => {
    setStarting(true)
    try {
      await api.confirmOutline(document.id, sections)
      await api.startWriting(document.id)
      onStarted()
    } catch (err) {
      console.error(err)
      setStarting(false)
    }
  }

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      setUploading(true)
      try {
        for (const file of Array.from(files)) {
          await api.uploadResource(document.id, file)
        }
        const fresh = await api.getDocument(document.shareToken)
        setResources(fresh.resources)
      } catch (err) {
        console.error(err)
      } finally {
        setUploading(false)
      }
    },
    [document.id, document.shareToken]
  )

  const handleDeleteResource = async (resourceId: string) => {
    await api.deleteResource(resourceId)
    setResources((prev) => prev.filter((r) => r.id !== resourceId))
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{title || 'New Document'}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {step === 'brief' && 'Step 1 of 3 — Brief'}
          {step === 'outline' && 'Step 2 of 3 — Outline'}
          {step === 'resources' && 'Step 3 of 3 — Resources'}
        </p>
      </div>

      {step === 'brief' && (
        <div className="flex flex-col gap-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Document title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Auth Service Redesign"
              className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Document type</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(DOC_TYPE_LABELS) as DocumentType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setDocType(type)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    docType === type
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-sm font-medium">{DOC_TYPE_LABELS[type]}</div>
                  <div className="mt-0.5 text-xs text-gray-500 line-clamp-2">
                    {DOC_TYPE_DESCRIPTIONS[type]}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Brief
              <span className="ml-1 text-gray-400 font-normal">— context for the AI Author</span>
            </label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe what this document should cover, the target audience, key decisions to address, constraints…"
              rows={6}
              className="w-full resize-none rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <button
            onClick={handleGetOutline}
            disabled={!title.trim() || !brief.trim() || loadingOutline}
            className="flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-6 py-3 font-medium text-white disabled:opacity-40 hover:bg-gray-800"
          >
            {loadingOutline ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating outline…
              </>
            ) : (
              'Generate outline →'
            )}
          </button>
        </div>
      )}

      {step === 'outline' && (
        <div className="flex flex-col gap-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Review and edit the proposed sections. Drag to reorder, click to rename.
              </p>
              <button
                onClick={() => setSections([...sections, 'New Section'])}
                className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                <Plus size={14} /> Add section
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {sections.map((title, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-right text-sm text-gray-400">{i + 1}.</span>
                  <input
                    value={title}
                    onChange={(e) => {
                      const updated = [...sections]
                      updated[i] = e.target.value
                      setSections(updated)
                    }}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <button
                    onClick={() => setSections(sections.filter((_, j) => j !== i))}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <Minus size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('brief')}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('resources')}
              disabled={sections.filter((s) => s.trim()).length === 0}
              className="flex-1 rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white disabled:opacity-40 hover:bg-gray-800"
            >
              Next: Add resources →
            </button>
          </div>
        </div>
      )}

      {step === 'resources' && (
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-3 text-sm text-gray-600">
              Upload reference files (PDF, DOCX, TXT, MD) that the AI Author should read while writing.
              Optional — you can skip and start now.
            </p>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200 px-6 py-10 text-center hover:border-blue-400 hover:bg-blue-50/30">
              <Upload size={24} className="text-gray-400" />
              <div>
                <span className="text-sm font-medium text-gray-700">Click to upload files</span>
                <p className="mt-0.5 text-xs text-gray-400">PDF, DOCX, TXT, MD — up to 20 MB each</p>
              </div>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.markdown"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
            </label>

            {uploading && (
              <div className="mt-3 flex items-center gap-2 text-sm text-blue-600">
                <Loader2 size={14} className="animate-spin" />
                Uploading and extracting text…
              </div>
            )}

            {resources.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {resources.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-gray-400" />
                      <span className="text-sm text-gray-700">{r.source}</span>
                      <span
                        className={`text-xs ${
                          r.status === 'fetched'
                            ? 'text-green-600'
                            : r.status === 'failed'
                            ? 'text-red-500'
                            : 'text-gray-400'
                        }`}
                      >
                        {r.status === 'fetched' ? '✓ Ready' : r.status === 'failed' ? '✗ Failed' : '…'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteResource(r.id)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('outline')}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ← Back
            </button>
            <button
              onClick={handleStart}
              disabled={starting}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white disabled:opacity-40 hover:bg-gray-800"
            >
              {starting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Starting…
                </>
              ) : (
                'Start writing'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
