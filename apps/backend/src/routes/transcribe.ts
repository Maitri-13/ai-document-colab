import { FastifyPluginAsync } from 'fastify'
import OpenAI, { toFile } from 'openai'

// POST /transcribe — accepts an audio file (multipart) and returns { text }.
// Uses OpenAI Whisper. Requires OPENAI_API_KEY; without it we return 503 so the
// UI can show a clear "voice not configured" message instead of failing opaquely.
export const transcribeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/transcribe', async (req, reply) => {
    if (!process.env.OPENAI_API_KEY) {
      return reply.status(503).send({
        error: 'Voice transcription is not configured. Set OPENAI_API_KEY on the backend.',
      })
    }

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No audio file uploaded' })

    const buffer = await data.toBuffer()
    if (buffer.length === 0) return reply.status(400).send({ error: 'Empty audio recording' })

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    try {
      const file = await toFile(buffer, data.filename || 'recording.webm', {
        type: data.mimetype || 'audio/webm',
      })
      fastify.log.info(
        { audioBytes: buffer.length, mimetype: data.mimetype, filename: data.filename },
        '[transcribe] received audio',
      )
      const result = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        // Push toward a faithful, word-for-word transcript rather than a
        // cleaned-up paraphrase. temperature:0 is deterministic; the prompt
        // biases Whisper to preserve exact phrasing (a nudge, not a guarantee —
        // Whisper has no strict verbatim mode).
        temperature: 0,
        prompt: 'Transcribe exactly what is said, word for word, including filler words, repetitions, and false starts.',
      })
      fastify.log.info(
        { textLength: (result.text ?? '').length, textPreview: (result.text ?? '').slice(0, 120) },
        '[transcribe] result',
      )
      return { text: result.text ?? '' }
    } catch (err) {
      fastify.log.error(err, 'Whisper transcription failed')
      return reply.status(502).send({ error: 'Transcription failed. Please try again.' })
    }
  })
}
