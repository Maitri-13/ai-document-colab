import { Worker } from 'bullmq'
import Anthropic from '@anthropic-ai/sdk'
import { marked } from 'marked'
import { getRedisConnection } from '../lib/redis'
import { emitToDocument } from '../lib/socket'
import { runAuthor } from '../agents/author'
import { prisma } from '../lib/prisma'
import { ChatJob } from '../lib/queues'
import { createActivity } from '../lib/activity'
import { createDocumentSnapshot } from '../lib/documentSnapshot'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Detect whether the human is asking to rename the whole DOCUMENT (its title),
// as opposed to editing section content. Returns the new title, or null.
async function detectTitleChange(
  currentTitle: string,
  message: string,
): Promise<string | null> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system:
      'You decide whether a user instruction is asking to rename/retitle the DOCUMENT itself (its overall title) — not edit a section\'s content. ' +
      'If it is a title/rename request, return ONLY {"title": "<the new document title>"}. ' +
      'If it is anything else, return {"title": null}. Return ONLY JSON.',
    messages: [
      {
        role: 'user',
        content: `Current document title: "${currentTitle}"\nInstruction: "${message}"`,
      },
    ],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { title?: string | null }
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    return title ? title.slice(0, 200) : null
  } catch {
    return null
  }
}

// Ask the LLM which section(s) to target based on the human message
async function routeToSections(
  sectionTitles: string[],
  message: string,
): Promise<string[]> {
  const list = sectionTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system:
      'You help route document edit requests to the right sections. Given a list of section titles and a human instruction, return a JSON array of the section title(s) that should be updated. Return ONLY a JSON array of strings, nothing else.',
    messages: [
      {
        role: 'user',
        content: `Sections:\n${list}\n\nInstruction: "${message}"\n\nReturn a JSON array of section titles to update.`,
      },
    ],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return [sectionTitles[0]]
  try {
    return JSON.parse(match[0]) as string[]
  } catch {
    return [sectionTitles[0]]
  }
}

export function startChatWorker() {
  const worker = new Worker<ChatJob>(
    'chat',
    async (job) => {
      const { documentId, message, authorLabel } = job.data

      console.log(`[Chat] processing message for document ${documentId}: "${message}"`)

      // Load document with sections
      const document = await prisma.document.findUniqueOrThrow({
        where: { id: documentId },
        include: {
          sections: { orderBy: { orderIndex: 'asc' } },
        },
      })

      // Title-change requests are handled here (the title is in the AI writer's
      // edit scope), short-circuiting before section routing.
      let newTitle: string | null = null
      try {
        newTitle = await detectTitleChange(document.title, message)
      } catch (err) {
        console.error('[Chat] detectTitleChange failed:', err)
      }
      if (newTitle && newTitle !== document.title) {
        await prisma.document.update({
          where: { id: documentId },
          data: { title: newTitle },
        })
        emitToDocument(documentId, 'document.titleChanged', { title: newTitle })
        const titleSnapshot = await createDocumentSnapshot(documentId, `Renamed to "${newTitle}"`)
        await createActivity({
          documentId,
          role: 'ai',
          actorLabel: 'AI writer',
          type: 'title_changed',
          body: `Renamed the document to "${newTitle}".`,
          documentSnapshotId: titleSnapshot.id,
        })
        const aiMsg = await prisma.documentChat.create({
          data: { documentId, role: 'ai', body: `Done — I renamed the document to "${newTitle}".` },
        })
        emitToDocument(documentId, 'chat.message', { message: aiMsg })
        return
      }

      const editableSections = document.sections.filter((s) =>
        ['OPEN', 'APPROVED', 'NOT_STARTED', 'DRAFT_ERROR'].includes(s.state)
      )

      if (editableSections.length === 0) {
        // Respond that we can't edit yet
        const aiMsg = await prisma.documentChat.create({
          data: {
            documentId,
            role: 'ai',
            body: "I can't make edits right now — the document is still being generated or all sections are locked. Please wait for generation to finish.",
          },
        })
        emitToDocument(documentId, 'chat.message', { message: aiMsg })
        return
      }

      const sectionTitles = editableSections.map((s) => s.title)
      // Bug fix #3: wrap routing in try/catch so a failed Anthropic call doesn't kill the whole job
      let targetTitles: string[] = []
      try {
        targetTitles = await routeToSections(sectionTitles, message)
      } catch (err) {
        console.error('[Chat] routeToSections failed, defaulting to first section:', err)
        targetTitles = [sectionTitles[0]]
      }

      const targetsToUpdate = editableSections.filter((s) =>
        targetTitles.some(
          (t) => t.toLowerCase().trim() === s.title.toLowerCase().trim()
        )
      )

      // If routing found nothing, fall back to first editable section (not ALL — avoids mass rewrites)
      const sections = targetsToUpdate.length > 0 ? targetsToUpdate : [editableSections[0]]

      const updatedNames: string[] = []

      for (const section of sections) {
        // Mark as revising
        await prisma.section.update({
          where: { id: section.id },
          data: { state: 'REVISING' },
        })
        emitToDocument(documentId, 'section.stateChanged', {
          sectionId: section.id,
          newState: 'REVISING',
        })

        try {
          const rawText = await runAuthor({
            documentId,
            sectionId: section.id,
            isRevision: true,
            chatInstruction: message,
          })

          const html = (await marked.parse(rawText, { async: false })) as string

          // Bug #1: increment version so SectionCard's version check fires and updates the editor
          const updated = await prisma.section.update({
            where: { id: section.id },
            data: { content: html, state: 'OPEN', version: { increment: 1 }, updatedAt: new Date() },
          })

          // Save revision snapshot and log activity
          const revCount = await prisma.sectionSnapshot.count({ where: { sectionId: section.id } })
          const snapshot = await prisma.sectionSnapshot.create({
            data: {
              sectionId: section.id,
              content: html,
              version: updated.version,
              label: `chat_revision_${revCount + 1}`,
            },
          })
          const docSnapshot = await createDocumentSnapshot(
            documentId,
            `After revising "${section.title}"`,
          )
          await createActivity({
            documentId,
            role: 'ai',
            actorLabel: 'AI writer',
            type: 'section_revised',
            body: `Revised "${section.title}" based on your instructions.`,
            sectionId: section.id,
            snapshotId: snapshot.id,
            documentSnapshotId: docSnapshot.id,
          })

          // Bug #2: carry version so useDocument updates section.version → SectionCard useEffect re-runs
          emitToDocument(documentId, 'section.contentReady', {
            sectionId: section.id,
            text: html,
            newState: 'OPEN',
            version: updated.version,
          })

          updatedNames.push(section.title)
        } catch (err) {
          console.error(`[Chat] failed to revise section ${section.id}:`, err)
          await prisma.section.update({
            where: { id: section.id },
            data: { state: 'OPEN' },
          })
          emitToDocument(documentId, 'section.stateChanged', {
            sectionId: section.id,
            newState: 'OPEN',
          })
        }
      }

      // Post AI reply to chat
      const replyBody =
        updatedNames.length > 0
          ? `Done — I updated ${updatedNames.map((n) => `"${n}"`).join(' and ')} based on your instruction.`
          : "I wasn't able to update any sections. Please try rephrasing your instruction."

      const aiMsg = await prisma.documentChat.create({
        data: { documentId, role: 'ai', body: replyBody },
      })

      emitToDocument(documentId, 'chat.message', { message: aiMsg })
      console.log(`[Chat] done for document ${documentId}`)
    },
    {
      connection: getRedisConnection(),
      concurrency: 1,
    }
  )

  worker.on('failed', (job, err) => {
    console.error(`[Chat] job failed:`, err.message)
  })

  console.log('[Chat worker] started')
  return worker
}
