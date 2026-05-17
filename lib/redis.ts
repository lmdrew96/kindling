import { Redis } from '@upstash/redis'

export const redis = Redis.fromEnv()

export const sparkKey = (token: string, id: string) => `k:${token}:spark:${id}`
export const indexKey = (token: string) => `k:${token}:sparks`
