export type SparkStatus = 'active' | 'cold' | 'archived'

export interface Spark {
  id: string
  content: string
  tags: string[]
  created_at: number
  last_surfaced_at: number | null
  surface_count: number
  promoted_to: string | null
  promoted_at: number | null
  status: SparkStatus
  cold_at: number | null
}
