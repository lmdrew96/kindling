import { v4 as uuidv4 } from 'uuid'
import { redis, indexKey } from './redis'
import type { Spark, SparkStatus } from './types'
import {
  DAY_MS,
  canGoCold,
  contextBonus,
  contextWords,
  hasAnyTag,
  isSnoozed,
  normalizeTags,
  scoreSpark,
} from './spark-utils'
import { getPrefs } from './prefs'

export { scoreSpark }

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const createSpark = async (
  token: string,
  content: string,
  tags: string[] = [],
  title: string | null = null
): Promise<Spark> => {
  const spark: Spark = {
    id: uuidv4(),
    title: title?.trim() || null,
    content,
    tags: normalizeTags(tags),
    created_at: Date.now(),
    last_surfaced_at: null,
    surface_count: 0,
    promoted_to: null,
    promoted_at: null,
    promoted_notes: null,
    status: 'active',
    cold_at: null,
    snooze_until: null,
    standing: false,
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

/**
 * Archive many sparks in one round trip. The per-spark path is a hgetall plus
 * an hset each, so triaging thirty stale sparks used to be sixty calls.
 * Returns the ids that actually moved — a caller can use them to undo.
 */
export const archiveSparks = async (token: string, ids: string[]): Promise<string[]> => {
  const all = await redis.hgetall<Record<string, Spark>>(indexKey(token))
  if (!all) return []

  const updates: Record<string, Spark> = {}
  for (const id of ids) {
    const spark = all[id]
    if (!spark || spark.status === 'archived') continue
    updates[id] = { ...spark, status: 'archived' }
  }

  const changed = Object.keys(updates)
  if (changed.length > 0) await redis.hset(indexKey(token), updates)
  return changed
}

/**
 * Permanently remove a spark. Everything else in Kindling is soft; this is the
 * one operation with no way back, which is why nothing calls it without an
 * explicit confirmation from the user.
 */
export const deleteSpark = async (token: string, id: string): Promise<boolean> => {
  const removed = await redis.hdel(indexKey(token), id)
  return removed > 0
}

// ─── Recall algorithm ────────────────────────────────────────────────────────

export const recallSparks = async (
  token: string,
  limit: number = 5,
  tags?: string[],
  context?: string
): Promise<Spark[]> => {
  await runDecay(token)
  const { decayThresholdDays } = await getPrefs(token)
  const nowMs = Date.now()

  let active = await listSparks(token, 'active')
  // Snoozed sparks are still active — they just asked not to be asked yet.
  active = active.filter((s) => !isSnoozed(s, nowMs))
  if (tags && tags.length > 0) {
    active = active.filter((s) => hasAnyTag(s, tags))
  }
  if (active.length === 0) return []

  // A context hint biases the ranking toward what the user is working on now,
  // without overriding age and neglect.
  const words = context ? contextWords(context) : []
  const scored = active
    .map((spark) => ({
      spark,
      score: scoreSpark(spark, nowMs, decayThresholdDays) + contextBonus(spark, words),
    }))
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
  const { decayThresholdDays } = await getPrefs(token)
  const threshold = decayThresholdDays * DAY_MS

  await Promise.all(
    active
      // Standing sparks and snoozed ones are exempt from the clock entirely.
      .filter((spark) => canGoCold(spark, now))
      .filter((spark) => {
        const lastInteraction = spark.last_surfaced_at ?? spark.created_at
        return now - lastInteraction >= threshold
      })
      .map((spark) =>
        updateSpark(token, spark.id, { status: 'cold', cold_at: now })
      )
  )
}
