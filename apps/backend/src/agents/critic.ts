import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma'
import { DocumentType } from '@prisma/client'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface CriticContext {
  documentId: string
  sectionId: string
}

interface CriticComment {
  body: string
  anchoredText: string | null   // verbatim text excerpt being critiqued (null = whole section)
  replacementText: string | null // suggested drop-in fix the author can apply with one click
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

export async function runCritic(ctx: CriticContext): Promise<CriticComment[]> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: ctx.documentId },
  })

  const section = await prisma.section.findUniqueOrThrow({
    where: { id: ctx.sectionId },
    include: { comments: { orderBy: { createdAt: 'asc' } } },
  })

  if (!section.content) return []

  const docTypeLabel = getDocumentTypeLabel(document.type)

  // Separate active and resolved comments
  const activeComments = section.comments.filter(c => !c.resolved)
  const resolvedComments = section.comments.filter(c => c.resolved)

  let existingBlock = ''
  if (activeComments.length > 0) {
    existingBlock += `\nActive comments on this section (DO NOT repeat or rephrase these):\n${activeComments.map((c, i) => `${i + 1}. ${c.body}`).join('\n')}\n`
  }
  if (resolvedComments.length > 0) {
    existingBlock += `\nPreviously resolved comments (these were already addressed or rejected — DO NOT raise these issues again):\n${resolvedComments.map((c, i) => `${i + 1}. ${c.body}`).join('\n')}\n`
  }

  const systemPrompt = `You are a critical reviewer of ${docTypeLabel}s. Your job is to identify specific, actionable issues in a document section.

Focus on:
- Unstated or untested assumptions
- Missing edge cases or failure modes
- Contradictions or ambiguities
- Underspecified requirements or designs
- Missing key information for the intended audience

Rules:
- Do NOT repeat or rephrase issues already raised in existing comments.
- Do NOT comment on style, grammar, or tone unless it causes confusion.
- Do NOT be vague — every comment must identify a specific problem.
- Do NOT praise — only flag issues.
- Be concise: 1 sentence max for "body".
- Prefer comments that anchor to a specific phrase in the content ("anchoredText") and offer a concrete drop-in fix ("replacementText"). This lets the author apply the fix with one click.
- If no new issues exist beyond what is already commented, return an empty array.

Respond ONLY with a JSON array — no markdown, no explanation:
[{
  "body": "one-sentence critique",
  "anchoredText": "exact verbatim phrase from the content (or section title if commenting on the whole section)",
  "replacementText": "drop-in replacement for anchoredText, or null if no direct fix to suggest"
}]`

  const userPrompt = `Document: "${document.title}" (${docTypeLabel})

Brief: ${document.brief}

Section to review: "${section.title}"

Content:
${section.content}
${existingBlock}
Return a JSON array of NEW critique comments. Maximum 2 — only the most impactful. Each must include "anchoredText" (verbatim phrase from the content, or the section title "${section.title}" if the whole section needs work) and "replacementText" where a concrete fix is possible. If no new issues, return [].`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    // Extract JSON from the response (may have surrounding text)
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    return JSON.parse(jsonMatch[0]) as CriticComment[]
  } catch {
    console.error('[Critic] Failed to parse response:', text)
    return []
  }
}
