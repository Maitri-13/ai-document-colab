import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { Server as SocketIOServer } from 'socket.io'

import { setIO } from './lib/socket'
import { prisma } from './lib/prisma'
import { startAuthorWorker } from './workers/author.worker'
import { startCriticWorker } from './workers/critic.worker'
import { startChatWorker } from './workers/chat.worker'

import { documentRoutes } from './routes/documents'
import { sectionRoutes } from './routes/sections'
import { commentRoutes } from './routes/comments'
import { resourceRoutes } from './routes/resources'
import { transcribeRoutes } from './routes/transcribe'

const PORT = parseInt(process.env.PORT ?? '4000', 10)
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000'

async function main() {
  const fastify = Fastify({ logger: true })

  await fastify.register(cors, {
    origin: [FRONTEND_URL],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  await fastify.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  })

  await fastify.register(documentRoutes, { prefix: '/api' })
  await fastify.register(sectionRoutes, { prefix: '/api' })
  await fastify.register(commentRoutes, { prefix: '/api' })
  await fastify.register(resourceRoutes, { prefix: '/api' })
  await fastify.register(transcribeRoutes, { prefix: '/api' })

  fastify.get('/health', async () => ({ status: 'ok' }))

  // Socket.io attaches to the same underlying http.Server that Fastify manages.
  // Must call fastify.ready() before accessing fastify.server.
  await fastify.ready()

  const io = new SocketIOServer(fastify.server, {
    cors: { origin: [FRONTEND_URL], credentials: true },
    transports: ['websocket', 'polling'],
  })

  setIO(io)

  io.on('connection', (socket) => {
    fastify.log.info(`[Socket.io] connected: ${socket.id}`)

    socket.on('document:join', async ({ documentId }: { documentId: string }) => {
      socket.join(`document:${documentId}`)
      fastify.log.info(`[Socket.io] ${socket.id} joined document:${documentId}`)

      // Send a full snapshot so reconnecting clients are immediately in sync
      try {
        const document = await prisma.document.findUnique({
          where: { id: documentId },
          include: {
            sections: {
              orderBy: { orderIndex: 'asc' },
              include: {
                comments: {
                  where: { resolved: false },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
            resources: { orderBy: { createdAt: 'asc' } },
          },
        })
        if (document) socket.emit('document.snapshot', document)
      } catch (err) {
        fastify.log.error(err, 'Failed to send document snapshot')
      }
    })

    socket.on('document:leave', ({ documentId }: { documentId: string }) => {
      socket.leave(`document:${documentId}`)
    })

    socket.on('disconnect', () => {
      fastify.log.info(`[Socket.io] disconnected: ${socket.id}`)
    })
  })

  // Start workers after Socket.io is wired so emitToDocument is available
  startAuthorWorker()
  startCriticWorker()
  startChatWorker()

  await fastify.listen({ port: PORT, host: '0.0.0.0' })
}

// Safety net: a stray rejection in a background worker (e.g. a Prisma P2025 when
// a record was deleted mid-job) must not take the HTTP server down. Log and keep
// serving instead of crashing the whole process.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
