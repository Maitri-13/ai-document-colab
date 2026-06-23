import { Queue } from 'bullmq'
import { getRedisConnection } from './redis'

export interface AuthorJob {
  documentId: string
  sectionId: string
  isRevision: boolean
}

export interface CriticJob {
  documentId: string
  sectionId: string
}

export interface ChatJob {
  documentId: string
  chatMessageId: string
  message: string
  authorLabel: string
}

const connection = getRedisConnection()

export const authorQueue = new Queue<AuthorJob>('author', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

export const criticQueue = new Queue<CriticJob>('critic', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

export const chatQueue = new Queue<ChatJob>('chat', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
})
