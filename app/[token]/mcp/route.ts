import { NextRequest, NextResponse } from 'next/server'
import {
  createSpark,
  getSpark,
  updateSpark,
  listSparks,
  archiveSpark,
  reviveSpark,
  recallSparks,
  runDecay,
} from '@/lib/sparks'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── JSON-RPC helpers ────────────────────────────────────────────────────────

const ok = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: '2.0', id, result })

const rpcError = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } })

const text = (content: string) => ({ content: [{ type: 'text', text: content }] })

// ─── Tool schemas ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'kindle',
    description: 'Capture a spark of thought, idea, or insight into Kindling.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The spark to capture.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags to categorize the spark.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'kindling_recall',
    description:
      'Surface sparks that have been waiting longest and are most in need of attention, using the Kindling recall algorithm.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max number of sparks to return. Default 5.',
        },
        context: {
          type: 'string',
          description: 'Optional context hint about the current session or focus area.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter recall to sparks matching ANY of these tags (e.g. ["substack", "writing"]).',
        },
      },
    },
  },
  {
    name: 'kindling_promote',
    description: 'Mark a spark as promoted — moved into a project, task, or note.',
    inputSchema: {
      type: 'object',
      properties: {
        spark_id: { type: 'string', description: 'ID of the spark to promote.' },
        target: {
          type: 'string',
          description: 'Where it was promoted to (e.g. "ControlledChaos", "ThreadBrain", a URL, etc.).',
        },
        notes: {
          type: 'string',
          description: 'Optional provenance notes (e.g. "became the opening of Vertexism Section V").',
        },
      },
      required: ['spark_id', 'target'],
    },
  },
  {
    name: 'kindling_list',
    description: 'List sparks, optionally filtered by status and/or tag.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'cold', 'archived'],
          description: 'Filter by status.',
        },
        tag: { type: 'string', description: 'Filter by a specific tag.' },
        limit: { type: 'number', description: 'Max number of sparks to return.' },
      },
    },
  },
  {
    name: 'kindling_search',
    description: 'Search sparks by content and/or tags. At least one of query or tags is required.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in spark content.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to sparks matching ANY of these tags.',
        },
      },
    },
  },
  {
    name: 'kindling_archive',
    description: 'Archive a spark that is no longer relevant.',
    inputSchema: {
      type: 'object',
      properties: {
        spark_id: { type: 'string', description: 'ID of the spark to archive.' },
      },
      required: ['spark_id'],
    },
  },
  {
    name: 'kindling_dig',
    description: 'Surface cold sparks that have gone quiet — review and decide to revive or archive.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number of cold sparks to return. Default 5.' },
      },
    },
  },
  {
    name: 'kindling_update',
    description: 'Edit the content and/or tags of an existing spark. At least one of content or tags is required.',
    inputSchema: {
      type: 'object',
      properties: {
        spark_id: { type: 'string', description: 'ID of the spark to update.' },
        content: { type: 'string', description: 'New content for the spark.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags for the spark (replaces existing tags).',
        },
      },
      required: ['spark_id'],
    },
  },
  {
    name: 'kindling_revive',
    description: 'Move a cold spark back to active status.',
    inputSchema: {
      type: 'object',
      properties: {
        spark_id: { type: 'string', description: 'ID of the cold spark to revive.' },
      },
      required: ['spark_id'],
    },
  },
]

// ─── Tool handlers ───────────────────────────────────────────────────────────

type ToolArgs = Record<string, unknown>

const formatSpark = (spark: { id: string; content: string; tags: string[]; status: string; surface_count: number; created_at: number }) =>
  `[${spark.id}] (${spark.status}) ${spark.content}${spark.tags.length ? ` [${spark.tags.join(', ')}]` : ''} — surfaced ${spark.surface_count}×`

async function handleToolCall(token: string, name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case 'kindle': {
      const content = args.content as string
      const tags = (args.tags as string[] | undefined) ?? []
      await runDecay(token)
      const spark = await createSpark(token, content, tags)
      return text(`Kindled: [${spark.id}] ${spark.content}`)
    }

    case 'kindling_recall': {
      const limit = typeof args.limit === 'number' ? args.limit : 5
      const tags = args.tags as string[] | undefined
      const sparks = await recallSparks(token, limit, tags)
      if (sparks.length === 0) return text(tags?.length ? `No active sparks matching tags: ${tags.join(', ')}.` : 'No active sparks to recall.')
      const lines = sparks.map(formatSpark).join('\n')
      return text(`Recalled ${sparks.length} spark${sparks.length !== 1 ? 's' : ''}:\n\n${lines}`)
    }

    case 'kindling_promote': {
      const spark_id = args.spark_id as string
      const target = args.target as string
      const notes = args.notes as string | undefined
      const updated = await updateSpark(token, spark_id, {
        promoted_to: target,
        promoted_at: Date.now(),
        promoted_notes: notes ?? null,
        status: 'archived',
      })
      if (!updated) return text(`Spark ${spark_id} not found.`)
      return text(`Promoted [${spark_id}] → ${target}${notes ? `\nNotes: ${notes}` : ''}`)
    }

    case 'kindling_list': {
      const status = args.status as 'active' | 'cold' | 'archived' | undefined
      const tag = args.tag as string | undefined
      const limit = typeof args.limit === 'number' ? args.limit : undefined
      let sparks = await listSparks(token, status)
      if (tag) sparks = sparks.filter((s) => s.tags.includes(tag))
      if (limit) sparks = sparks.slice(0, limit)
      if (sparks.length === 0) return text('No sparks found.')
      return text(sparks.map(formatSpark).join('\n'))
    }

    case 'kindling_search': {
      const query = (args.query as string | undefined)?.toLowerCase()
      const tags = args.tags as string[] | undefined
      if (!query && (!tags || tags.length === 0)) return text('Provide at least one of: query, tags.')
      const all = await listSparks(token)
      const matches = all.filter((s) => {
        const contentOk = query ? s.content.toLowerCase().includes(query) : true
        const tagsOk = tags?.length ? s.tags.some((t) => tags.includes(t)) : true
        if (query && tags?.length) return contentOk && tagsOk
        return query ? contentOk : tagsOk
      })
      if (matches.length === 0) return text('No sparks match that search.')
      return text(matches.map(formatSpark).join('\n'))
    }

    case 'kindling_archive': {
      const spark_id = args.spark_id as string
      const spark = await getSpark(token, spark_id)
      if (!spark) return text(`Spark ${spark_id} not found.`)
      await archiveSpark(token, spark_id)
      return text(`Archived [${spark_id}]`)
    }

    case 'kindling_dig': {
      const limit = typeof args.limit === 'number' ? args.limit : 5
      const cold = await listSparks(token, 'cold')
      const slice = cold.slice(0, limit)
      if (slice.length === 0) return text('No cold sparks. Everything is still warm.')
      return text(`${slice.length} cold spark${slice.length !== 1 ? 's' : ''} waiting:\n\n${slice.map(formatSpark).join('\n')}`)
    }

    case 'kindling_update': {
      const spark_id = args.spark_id as string
      const content = args.content as string | undefined
      const tags = args.tags as string[] | undefined
      if (!content && !tags) return text('Provide at least one of: content, tags.')
      const updates: Partial<import('@/lib/types').Spark> = {}
      if (content) updates.content = content
      if (tags) updates.tags = tags
      const updated = await updateSpark(token, spark_id, updates)
      if (!updated) return text(`Spark ${spark_id} not found.`)
      return text(`Updated [${spark_id}]: ${updated.content}${updated.tags.length ? ` [${updated.tags.join(', ')}]` : ''}`)
    }

    case 'kindling_revive': {
      const spark_id = args.spark_id as string
      const spark = await getSpark(token, spark_id)
      if (!spark) return text(`Spark ${spark_id} not found.`)
      if (spark.status !== 'cold') return text(`Spark ${spark_id} is ${spark.status}, not cold.`)
      await reviveSpark(token, spark_id)
      return text(`Revived [${spark_id}] — back in the fire.`)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token format' }, { status: 404 })
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }
  try {
    body = await req.json()
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  const { id = null, method, params: rpcParams } = body

  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'kindling', version: '0.1.0' },
        })

      case 'notifications/initialized':
        return ok(id, {})

      case 'tools/list':
        return ok(id, { tools: TOOLS })

      case 'tools/call': {
        const { name, arguments: toolArgs } = rpcParams as {
          name: string
          arguments: ToolArgs
        }
        const result = await handleToolCall(token, name, toolArgs ?? {})
        return ok(id, result)
      }

      default:
        return rpcError(id, -32601, `Method not found: ${method ?? '(none)'}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return rpcError(id, -32000, message)
  }
}
