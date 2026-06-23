// Returns plain connection options that BullMQ accepts.
// BullMQ bundles its own ioredis version; passing a Redis instance from a
// separately-installed ioredis causes a type mismatch at the class level.
// Using options avoids both the ioredis peer conflict and the type error.
export function getRedisConnection() {
  const url = process.env.REDIS_URL

  if (url) {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      maxRetriesPerRequest: null as unknown as null,
      enableReadyCheck: false,
    }
  }

  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null as unknown as null,
    enableReadyCheck: false,
  }
}
