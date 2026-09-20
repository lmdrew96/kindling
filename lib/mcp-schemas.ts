import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

/**
 * The validated shape of every MCP tool input.
 *
 * Upstash stores whatever object it is handed, so the storage layer enforces
 * nothing — this module is the only place bad data can be stopped. The
 * `inputSchema` sent to clients is generated from these same schemas, so the
 * declared shape and the enforced shape cannot drift apart.
 */

// ─── Shared pieces ───────────────────────────────────────────────────────────

/** Sparks are always created with uuidv4, so anything else is a malformed call. */
const sparkId = z.string().uuid()

const MAX_LIMIT = 25

/**
 * Clamps rather than rejects. A model asking for 100 results wants "as many as
 * you'll give me", not an error — but an unbounded limit is write amplification
 * in `kindling_recall`, which issues one hset per spark it returns.
 */
const limit = (fallback: number, what: string) =>
  z
    .number()
    .int()
    .positive()
    .optional()
    .transform((v) => Math.min(v ?? fallback, MAX_LIMIT))
    .describe(`Max number of ${what} to return. Default ${fallback}, max ${MAX_LIMIT}.`)

const tagList = (description: string) =>
  z.array(z.string().trim().min(1)).optional().describe(description)

/** Guards against a runaway paste becoming a permanent Redis resident. */
const contentField = z
  .string()
  .trim()
  .min(1, 'content cannot be empty')
  .max(100_000, 'content is too long')

const titleField = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe(
    'Short handle for the spark (≤80 chars is ideal), shown as the card heading in the dashboard. Supply one whenever content runs longer than a couple of sentences — it is what makes a long spark scannable in a list. Omit for one-line captures, which are their own title.'
  )

// ─── Per-tool schemas ────────────────────────────────────────────────────────

export const toolSchemas = {
  kindle: z.object({
    content: contentField.describe('The spark to capture.'),
    title: titleField,
    tags: tagList('Tags to categorize the spark.'),
  }),

  kindling_recall: z.object({
    limit: limit(5, 'sparks'),
    context: z
      .string()
      .optional()
      .describe('Optional context hint about the current session or focus area.'),
    tags: tagList('Filter recall to sparks matching ANY of these tags (e.g. ["substack", "writing"]).'),
  }),

  kindling_promote: z.object({
    spark_id: sparkId.describe('ID of the spark to promote.'),
    target: z
      .string()
      .trim()
      .min(1)
      .describe('Where it was promoted to (e.g. "ControlledChaos", "ThreadBrain", a URL, etc.).'),
    notes: z
      .string()
      .optional()
      .describe('Optional provenance notes (e.g. "became the opening of Vertexism Section V").'),
  }),

  kindling_list: z.object({
    status: z.enum(['active', 'cold', 'archived']).optional().describe('Filter by status.'),
    tag: z.string().trim().min(1).optional().describe('Filter by a specific tag.'),
    promoted: z
      .boolean()
      .optional()
      .describe(
        'true returns only sparks that became something real; false returns only those that did not. Promoted and discarded sparks are both archived, so this is the only way to tell them apart.'
      ),
    limit: limit(MAX_LIMIT, 'sparks'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('Number of sparks to skip, for paging through a large store.'),
  }),

  kindling_search: z.object({
    query: z.string().trim().min(1).optional().describe('Text to search for in spark content.'),
    tags: tagList('Filter to sparks matching ANY of these tags.'),
  }),

  kindling_get: z.object({
    spark_id: sparkId.describe('ID of the spark to inspect.'),
  }),

  kindling_archive: z.object({
    spark_id: sparkId.describe('ID of the spark to archive.'),
  }),

  kindling_dig: z.object({
    limit: limit(5, 'cold sparks'),
  }),

  kindling_update: z.object({
    spark_id: sparkId.describe('ID of the spark to update.'),
    title: titleField.describe('New short handle for the spark (≤80 chars).'),
    content: contentField.optional().describe('New content for the spark.'),
    tags: tagList('New tags for the spark (replaces existing tags).'),
  }),

  kindling_revive: z.object({
    spark_id: sparkId.describe('ID of the cold spark to revive.'),
  }),
} as const

export type ToolName = keyof typeof toolSchemas

export const isToolName = (name: string): name is ToolName => name in toolSchemas

/** JSON Schema for the wire, generated from the schema that is actually enforced. */
export const jsonSchemaFor = (name: ToolName): Record<string, unknown> => {
  const generated = zodToJsonSchema(toolSchemas[name], {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>
  delete generated.$schema
  return generated
}

/** Zod issues rendered as one line a model can act on. */
export const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((i) => {
      const path = i.path.join('.')
      return path ? `${path}: ${i.message}` : i.message
    })
    .join('; ')
