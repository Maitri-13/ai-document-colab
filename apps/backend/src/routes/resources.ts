import { FastifyPluginAsync } from 'fastify'
import { pipeline } from 'stream/promises'
import { Writable } from 'stream'
import { prisma } from '../lib/prisma'
import { emitToDocument } from '../lib/socket'

// pdf-parse v2 uses a class-based API: new PDFParse({ data: buffer }).getText()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse') as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> } }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _mammoth = require('mammoth')
const mammoth: { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> } =
  typeof _mammoth.extractRawText === 'function' ? _mammoth : _mammoth.default

async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase()

  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()
    return result.text
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer })
    return result.value as string
  }

  if (['txt', 'md', 'markdown'].includes(ext ?? '')) {
    return buffer.toString('utf-8')
  }

  return buffer.toString('utf-8')
}

export const resourceRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /documents/:id/resources — list resources for a document
  fastify.get<{ Params: { id: string } }>('/documents/:id/resources', async (req, reply) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })

    const resources = await prisma.resource.findMany({
      where: { documentId: req.params.id },
      orderBy: { createdAt: 'asc' },
    })
    return resources
  })

  // POST /documents/:id/resources — upload a file, extract text, persist
  fastify.post<{ Params: { id: string } }>('/documents/:id/resources', async (req, reply) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })
    if (!['SETUP', 'IN_REVIEW'].includes(doc.state)) {
      return reply.status(409).send({ error: 'Resources can only be uploaded in SETUP or IN_REVIEW' })
    }

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const chunks: Buffer[] = []
    await pipeline(
      data.file,
      new Writable({
        write(chunk, _encoding, cb) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          cb()
        },
      })
    )
    const buffer = Buffer.concat(chunks)

    // Create resource as 'pending' immediately so user sees it appear
    const resource = await prisma.resource.create({
      data: {
        documentId: doc.id,
        type: 'file',
        source: data.filename,
        status: 'pending',
      },
    })

    emitToDocument(doc.id, 'resource.added', { resource })

    // Extract text asynchronously
    try {
      const text = await extractText(data.filename, buffer)
      const updated = await prisma.resource.update({
        where: { id: resource.id },
        data: { content: text, status: 'fetched' },
      })
      emitToDocument(doc.id, 'resource.ready', { resource: updated })
      reply.status(201).send(updated)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Extraction failed'
      const failed = await prisma.resource.update({
        where: { id: resource.id },
        data: { status: 'failed', error: message },
      })
      emitToDocument(doc.id, 'resource.failed', { resource: failed })
      reply.status(422).send({ error: message })
    }
  })

  // DELETE /resources/:id — remove a resource
  fastify.delete<{ Params: { id: string } }>('/resources/:id', async (req, reply) => {
    const resource = await prisma.resource.findUnique({ where: { id: req.params.id } })
    if (!resource) return reply.status(404).send({ error: 'Resource not found' })

    await prisma.resource.delete({ where: { id: req.params.id } })

    emitToDocument(resource.documentId, 'resource.deleted', { resourceId: req.params.id })

    reply.status(204).send()
  })
}
