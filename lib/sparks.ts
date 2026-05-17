import { v4 as uuidv4 } from 'uuid'
import { redis, indexKey } from './redis'
import type { Spark, SparkStatus } from './types'

const DAY_MS = 1000 * 60 * 60 * 24
const DECAY_THRESHOLD_DAYS = 180

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const createSpark = async (
  token: string,
  content: string,
  tags: string[] = []
): Promise<Spark> => {
  const spark: Spark = {
    id: uuidv4(),
    content,
    tags,
    created_at: Date.now(),
    last_surfaced_at: null,
    surface_count: 0,
    promoted_to: null,
    promoted_at: null,
    promoted_notes: null,
    status: 'active',
    cold_at: null,
  }
  await redis.hset(indexKey(token), { [spark.id]: spark })
  return spark
}

export const getSpark = async (token: string, id: string): Promise<Spark | null> => {
  return redis.hget<Spark>(indexKey(token), id)
}

export const updateSpark = async (
  token: string,
  id: string,
  updates: Partial<Spark>
): Promise<Spark | null> => {
  const existing = await getSpark(token, id)
  if (!existing) return null
  const updated: Spark = { ...existing, ...updates, id }
  await redis.hset(indexKey(token), { [id]: updated })
  return updated
}

export const listSparks = async (token: string, status?: SparkStatus): Promise<Spark[]> => {
  const all = await redis.hgetall<Record<string, Spark>>(indexKey(token))
  if (!all) return []
  const sparks = Object.values(all).filter((s): s is Spark => s !== null)
  return status ? sparks.filter((s) => s.status === status) : sparks
}

export const archiveSpark = async (token: string, id: string): Promise<Spark | null> => {
  return updateSpark(token, id, { status: 'archived' })
}

export const reviveSpark = async (token: string, id: string): Promise<Spark | null> => {
  return updateSpark(token, id, { status: 'active', cold_at: null })
}

// ─── Recall algorithm ────────────────────────────────────────────────────────

const scoreSpark = (spark: Spark): number => {
  const now = Date.now()

  const daysSinceCreated = (now - spark.created_at) / DAY_MS
  const ageScore = Math.min(daysSinceCreated / 365, 1) * 40

  const lastInteraction = spark.last_surfaced_at ?? spark.created_at
  const daysSinceInteraction = (now - lastInteraction) / DAY_MS
  const neglectScore = Math.min(daysSinceInteraction / DECAY_THRESHOLD_DAYS, 1) * 40

  // approaches 20 when surface_count=0, halves with each surface
  const unusedScore = (1 / (spark.surface_count + 1)) * 20

  return ageScore + neglectScore + unusedScore
}

export const recallSparks = async (
  token: string,
  limit: number = 5,
  tags?: string[]
): Promise<Spark[]> => {
  await runDecay(token)

  let active = await listSparks(token, 'active')
  if (tags && tags.length > 0) {
    active = active.filter((s) => (s.tags ?? []).some((t) => tags.includes(t)))
  }
  if (active.length === 0) return []

  const scored = active
    .map((spark) => ({ spark, score: scoreSpark(spark) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const now = Date.now()
  await Promise.all(
    scored.map(({ spark }) =>
      updateSpark(token, spark.id, {
        last_surfaced_at: now,
        surface_count: spark.surface_count + 1,
      })
    )
  )

  return scored.map(({ spark }) => spark)
}

// ─── Auto-decay ──────────────────────────────────────────────────────────────

export const runDecay = async (token: string): Promise<void> => {
  const active = await listSparks(token, 'active')
  if (active.length === 0) return

  const now = Date.now()
  const threshold = DECAY_THRESHOLD_DAYS * DAY_MS

  await Promise.all(
    active
      .filter((spark) => {
        const lastInteraction = spark.last_surfaced_at ?? spark.created_at
        return now - lastInteraction >= threshold
      })
      .map((spark) =>
        updateSpark(token, spark.id, { status: 'cold', cold_at: now })
      )
  )
}
