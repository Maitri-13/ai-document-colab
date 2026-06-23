import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma'
import { DocumentType } from '@prisma/client'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export class AuthorInterruptedError extends Error {
  constructor() {
    super('Author generation was interrupted')
    this.name = 'AuthorInterruptedError'
  }
}

interface AuthorContext {
  documentId: string
  sectionId: string
  isRevision: boolean
  signal?: AbortSignal
  chatInstruction?: string // human chat message overrides comment-based revision context
}

async function buildContext(ctx: AuthorContext) {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: ctx.documentId },
    include: {
      resources: { where: { status: 'fetched' } },
      sections: { orderBy: { orderIndex: 'asc' } },
    },
  })

  const currentSection = document.sections.find((s) => s.id === ctx.sectionId)
  if (!currentSection) throw new Error(`Section ${ctx.sectionId} not found`)

  // All prior sections that already have content (for coherence)
  const priorSections = document.sections
    .filter((s) => s.orderIndex < currentSection.orderIndex && s.content)
    .map((s) => `## ${s.title}\n\n${s.content}`)
    .join('\n\n---\n\n')

  // All sections in the outline (for structure awareness)
  const outline = document.sections
    .map((s) => `${s.orderIndex + 1}. ${s.title}`)
    .join('\n')

  // Resources
  const resourceContext = document.resources
    .map((r) => `--- Resource: ${r.source} ---\n${r.content}`)
    .join('\n\n')

  // Comments (for revisions) — skip if a direct chat instruction is provided
  let commentContext = ''
  if (ctx.isRevision && !ctx.chatInstruction) {
    const comments = await prisma.comment.findMany({
      where: { sectionId: ctx.sectionId, resolved: false },
      orderBy: [{ authorType: 'asc' }, { createdAt: 'asc' }],
    })

    const humanComments = comments.filter((c) => c.authorType === 'human')
    const criticComments = comments.filter((c) => c.authorType === 'ai_critic')

    if (humanComments.length > 0) {
      commentContext += '\n\nHUMAN INSTRUCTIONS — follow these strictly:\n'
      commentContext += humanComments.map((c) => `- ${c.authorLabel}: ${c.body}`).join('\n')
    }
    if (criticComments.length > 0) {
      commentContext += '\n\nAI CRITIC OBSERVATIONS — use as supporting context:\n'
      commentContext += criticComments.map((c) => `- ${c.body}`).join('\n')
    }
  } else if (ctx.chatInstruction) {
    commentContext = `\n\nDIRECT INSTRUCTION FROM HUMAN — follow this exactly:\n${ctx.chatInstruction}`
  }

  return {
    document,
    currentSection,
    priorSections,
    outline,
    resourceContext,
    commentContext,
  }
}

function getDocumentTypeLabel(type: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    tech_design_doc: 'Technical Design Document',
    product_spec: 'Product Specification',
    security_review: 'Security Review',
    plan: 'Project Plan',
    custom: 'Document',
  }
  return labels[type]
}

export async function runAuthor(ctx: AuthorContext): Promise<string> {
  const { document, currentSection, priorSections, outline, resourceContext, commentContext } =
    await buildContext(ctx)

  const docTypeLabel = getDocumentTypeLabel(document.type)
  const action = ctx.isRevision ? 'revise' : 'write'

  const systemPrompt = `You are an expert technical writer. You ${action} sections of ${docTypeLabel}s with clarity and precision.

Be concise. Write only what adds value — no filler, no restating the brief, no hedging or throat-clearing, no generic background. Prefer short paragraphs and bullet points over long prose. Aim for roughly 100–180 words per section, shorter when the topic is simple. Every sentence should carry specific, actionable information.

Use markdown formatting (headers, bullet points, code blocks where appropriate). Output ONLY the section content. Do not include the section title as a header. Do not add preamble or closing remarks.`

  const userPrompt = `Document: "${document.title}"
Type: ${docTypeLabel}

Brief:
${document.brief}

${resourceContext ? `Reference Materials:\n${resourceContext}\n` : ''}

Full Document Outline:
${outline}

${priorSections ? `Previously Written Sections:\n${priorSections}\n` : ''}

${ctx.isRevision ? `Current section content to revise:\n${currentSection.content}\n${commentContext}\n` : ''}

Now ${action} the section: "${currentSection.title}"

${ctx.isRevision ? 'Revise the section addressing the feedback above. Keep it concise.' : 'Write this section concisely — only what matters.'}`

  let fullText = ''

  const stream = anthropic.messages.stream(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
    { signal: ctx.signal },
  )

  try {
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text
      }
    }
  } catch (err) {
    if (ctx.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new AuthorInterruptedError()
    }
    throw err
  }

  if (ctx.signal?.aborted) throw new AuthorInterruptedError()

  return fullText.trim()
}
