export type SparkStatus = 'active' | 'cold' | 'archived'

export interface Spark {
  id: string
  /**
   * Short handle for the spark. Optional: sparks captured before this field
   * existed, and short sparks that are their own title, leave it null and fall
   * back to `deriveTitle`.
   */
  title: string | null
  content: string
  tags: string[]
  created_at: number
  last_surfaced_at: number | null
  surface_count: number
  promoted_to: string | null
  promoted_at: number | null
  promoted_notes: string | null
  status: SparkStatus
  cold_at: number | null
}
