import { NextRequest, NextResponse } from 'next/server'
import {
  createSpark,
  getSpark,
  updateSpark,
  listSparks,
  archiveSpark,
  archiveSparks,
  deleteSpark,
  removeTag,
  renameTag,
  reviveSpark,
  recallSparks,
  runDecay,
} from '@/lib/sparks'
import { toJson, toMarkdown } from '@/lib/export'
import { getPrefs, setPrefs } from '@/lib/prefs'
import {
  contentExtent,
  displayTitle,
  isLongContent,
  computeStats,
  findDuplicatePairs,
  findNearest,
  fuzzyMatches,
  hasAnyTag,
  hasTag,
  isPromoted,
  normalizeTag,
  relativeAge,
  tagCounts,
} from '@/lib/spark-utils'
import type { Spark } from '@/lib/types'
import { version as KINDLING_VERSION } from '@/package.json'
import { z } from 'zod'
import {
  formatZodError,
  isToolName,
  jsonSchemaFor,
  toolSchemas,
  type ToolName,
} from '@/lib/mcp-schemas'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Protocol versions ───────────────────────────────────────────────────────

/**
 * Newest last. Per the lifecycle spec a server MUST echo the client's requested
 * version when it supports it, and otherwise MUST respond with another version
 * it supports (SHOULD be its latest) — it does not error. Extend this list as
 * revisions land; nothing else needs to change.
 */
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
] as const

const LATEST_PROTOCOL_VERSION =
  SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1]

const negotiateVersion = (requested: unknown): string =>
  typeof requested === 'string' &&
  (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION

// ─── JSON-RPC helpers ────────────────────────────────────────────────────────

const ok = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: '2.0', id, result })

const rpcError = (id: unknown, code: number, message: string, data?: unknown) =>
  NextResponse.json({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  })

/** A successful tool result. */
const text = (content: string) => ({ content: [{ type: 'text', text: content }] })

/**
 * A failed tool result. Tool *execution* failures belong in the result with
 * isError set — not as JSON-RPC errors, which are reserved for protocol-level
 * problems. The flag is what lets the model notice it failed and self-correct;
 * the human-readable text stays exactly as it was.
 */
const errText = (content: string) => ({
  content: [{ type: 'text', text: content }],
  isError: true,
})

// ─── Tool definitions ────────────────────────────────────────────────────────

/**
 * Descriptions live here; the parameter shapes live in lib/mcp-schemas.ts and
 * the wire `inputSchema` is generated from them, so a parameter cannot be
 * advertised without also being enforced.
 */
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  kindle:
    "Capture a spark — an idea, an aside, a half-formed thought — so it isn't lost when the conversation moves on.\n\n" +
    'FIRE THIS PROACTIVELY, without being asked. That is the whole point of Kindling: a notes app already handles "save this for me". What it cannot do is notice. When the user says something idea-shaped in passing and then moves on, capture it and mention in one short line that you did.\n\n' +
    'Spark-shaped (capture these):\n' +
    '  · "honestly the onboarding should probably just be three screens" — said mid-debugging, then dropped\n' +
    '  · "there\'s a whole essay in how ADHD tooling assumes you remember to open it"\n' +
    '  · "someone should build X" / "it\'d be cool if Y" / "I keep coming back to Z"\n' +
    '  · a connection the user draws between two projects and doesn\'t follow up on\n\n' +
    'NOT spark-shaped (do not capture these):\n' +
    '  · concrete actionable work — "fix the timezone bug", "add a dark mode toggle". That is a task, and it belongs in a task tracker, not here. A spark is something to think about, not something to do.\n' +
    '  · facts about the user or the project. Those belong in a memory/context store.\n' +
    '  · anything the user is already actively working on in this session.\n\n' +
    'Supply a `title` whenever content runs past a couple of sentences — it is what keeps a long spark scannable in a list. Capture one thought per spark; two ideas are two sparks. Tag generously, since tags are how recall gets filtered later.',

  kindling_recall:
    'Surface the sparks most in need of attention, ranked by the Kindling algorithm — how old they are, how long they have been neglected, and how rarely they have been shown.\n\n' +
    'OFFER THIS UNPROMPTED at the natural moments:\n' +
    '  · at the start of a working session, before diving into whatever was asked\n' +
    '  · when the topic changes to an area the user has sparks about (pass `tags` to scope it)\n' +
    '  · whenever the user asks "what should I work on", "what am I forgetting", or wonders what to write about\n' +
    '  · when the current work rhymes with something they captured months ago\n\n' +
    'Recall is a mutating read: showing a spark resets its clock, which is what stops the same five surfacing forever. So recall when it is genuinely useful, not reflexively every turn. Follow it with kindling_promote when a surfaced spark visibly becomes something, or kindling_archive when the user says it is no longer interesting.',

  kindling_promote:
    'Record that a spark became something real — it turned into a project, a task, a draft, a decision, a section of a document.\n\n' +
    'FIRE THIS whenever you watch that happen. If a spark surfaced by kindling_recall visibly turns into work during the session, promote it without being asked — it is the only evidence the system is doing its job, and an un-promoted spark that became something is indistinguishable from one that was abandoned.\n\n' +
    'Write real `notes`. "became the opening of Vertexism Section V" is worth reading in six months; "used it" is not. Promoting also archives the spark, so it stops competing in recall.',

  kindling_get:
    'Inspect one spark in full — its whole content, every timestamp, and its promotion provenance if it has any.\n\n' +
    'Use it to drill into something kindling_recall, kindling_list or kindling_search returned as a one-liner: those show the title plus a size hint rather than the whole body, so this is how you actually read a long spark.',

  kindling_list:
    'List sparks, filtered by status and/or tag. The plain inventory view — use it when the user wants to see what is there rather than be told what matters. Use kindling_recall instead when the question is "what should I look at?", and kindling_search when they half-remember something specific.\n\n' +
    'Returns a page at a time with a running "showing N of M"; pass `offset` to continue.',

  kindling_search:
    'Find a spark the user half-remembers, by text in its content and/or by tags. At least one of query or tags is required.\n\n' +
    'Reach for this the moment the user says "I know I wrote something about…" or "didn\'t I have an idea about…" — searching is cheaper than making them reconstruct it. Searches every status, so it finds archived and cold sparks too. Matching is substring, so try a shorter and more distinctive fragment before concluding nothing is there.',

  kindling_export:
    'Export the whole corpus as markdown or JSON — every spark, with tags, timestamps and promotion provenance.\n\n' +
    'Offer it whenever the user talks about backing up, moving their notes elsewhere, or worries about losing things. Accounts are optional in Kindling, so for many users one token in one browser is still the only handle on everything they have captured, and a copy elsewhere is genuinely valuable. markdown pastes into a note; json round-trips exactly.',

  kindling_batch_archive:
    'Archive many sparks in one call.\n\n' +
    'Use it for the end of a kindling_dig triage session, or whenever the user has decided about several sparks at once. Archiving one at a time is the executive-function tax the app exists to reduce, reproduced inside the app. Reversible — kindling_update can set any of them back to active.',

  kindling_delete:
    'Permanently delete a spark. There is no undo and no trash.\n\n' +
    'Only ever call this when the user has explicitly asked to delete something — a stray capture, something they would rather not have written down. For everything else use kindling_archive, which is reversible and keeps it out of recall just as effectively. If they said "get rid of this", ask which they mean before calling.',

  kindling_find_duplicates:
    'Find sparks that are probably the same recurring thought captured more than once.\n\n' +
    'Useful during a cleanup pass, or when recall keeps surfacing variations of one idea. Each duplicate scores independently, so a thought the user keeps having crowds out everything else. Merge the pair with kindling_update and archive the loser.',

  kindling_snooze:
    'Hold a spark out of recall for a while — "not now, ask me in a month".\n\n' +
    'The third option the lifecycle was missing. Without it the only ways to respond to a spark you are not ready for are to let it keep surfacing, or to archive it, which reads as rejection. Use it when the user says "not yet", "remind me later", or "after I ship X". Snoozed sparks are still active and are exempt from going cold while they wait.',

  kindling_set_standing:
    'Mark a spark as a standing intention, exempt from the decay clock forever — or put it back on the clock.\n\n' +
    'Some sparks are not perishable ideas but ongoing commitments: "keep writing the newsletter", "learn Romanian properly". Those should never go cold just because nobody touched them for six months. Use this when the user describes something as ongoing or evergreen rather than as an idea they might act on.',

  kindling_settings:
    'Read or change how long a spark sits untouched before it goes cold (default 180 days).\n\n' +
    'Call with no arguments to read the current setting. 180 days is a big assumption to make on someone\'s behalf — a user capturing fast-moving work may want 60, someone keeping long-horizon ideas may want 365. The same number also sets how quickly neglect accumulates in the recall ranking, so a spark reaches full neglect score exactly as it goes cold.',

  kindling_stats:
    'Counts by status, promotion rate, capture cadence, and the oldest and most neglected active sparks.\n\n' +
    'Good for answering "how am I doing with this" or opening a review session. The promotion rate is the number worth caring about — it is the share of concluded sparks that became something real rather than being let go.',

  kindling_tags:
    'Every tag in use, with how many sparks carry each.\n\n' +
    'Check this before inventing a new tag, and use it to spot fragmentation — "writing", "Writing" and "write" as three separate tags means recall filtered by any one of them silently misses the others.',

  kindling_rename_tag:
    'Rename a tag across every spark that carries it — and merge two tags by renaming one into the other.\n\n' +
    'Tag normalization only stops NEW fragmentation; it does nothing about the variants already in the store. This is the repair tool. Reach for it when kindling_tags shows the same idea split across "writing", "Writing" and "write", or when the user says a tag should have been called something else.\n\n' +
    'A plain rename into an unused name is freely reversible — rename it back. A MERGE is not, because afterwards there is no way to tell which sparks originally carried which tag, so `confirm_merge` is required and should only be set after the user has agreed to it. Check kindling_tags first so you can tell them how many sparks each side has.',

  kindling_remove_tag:
    'Strip a tag from every spark carrying it, leaving the sparks themselves untouched.\n\n' +
    'This is the tool for a tag that should never have existed — a typo the user does not want merged anywhere, a scheme they have abandoned, a label that stopped meaning anything. Renaming it into another tag is NOT the same thing: that merges, and leaves the sparks carrying a tag the user did not ask for.\n\n' +
    'Unlike a merge this is cleanly reversible, because nothing is conflated — the sparks that lost the tag are reported back, and kindling_update can put it back on exactly those. Still requires `confirm`, since one call can touch every spark in the store: check kindling_tags first and tell the user the count.',

  kindling_archive:
    'Archive a spark that is no longer relevant, so it stops competing for attention in recall.\n\n' +
    'Use it when the user says an idea is dead, done, or no longer interesting. Prefer kindling_promote when the spark became something — promote also archives, but keeps the provenance. Archiving is reversible, so it is the safe way to clear noise.',

  kindling_dig:
    'Surface cold sparks — the ones untouched for so long they fell out of active rotation — for triage.\n\n' +
    'This is a ritual, not a lookup: dig up a handful, walk them with the user one at a time, and for each either kindling_revive it (still interesting, back into rotation) or kindling_archive it (let it go). Suggest it when the user has time and no urgent task, when they ask what has gone stale, or when recall keeps returning the same few sparks because everything else has gone cold. Going through a cold pile is also the cheapest way to find something worth writing about.',

  kindling_update:
    'Edit a spark\'s title, content, or tags. At least one of them is required.\n\n' +
    'Use it to sharpen a spark the user is actively thinking about — a better title, a detail they just added out loud, a tag that would make it findable later.\n\n' +
    '`tags` MERGES into the existing tags by default, so you can add one without knowing the rest. Pass tag_mode "replace" only when you mean to overwrite them all, and remove_tags to drop specific ones.',

  kindling_revive:
    'Move a cold spark back to active, resetting its decay clock so it can surface in recall again.\n\n' +
    'The positive half of the kindling_dig triage ritual — the user says "oh, I still want to do that" and this puts it back in the fire. Only works on cold sparks; use kindling_update on an archived one.',
}

const TOOLS = (Object.keys(TOOL_DESCRIPTIONS) as ToolName[]).map((name) => ({
  name,
  description: TOOL_DESCRIPTIONS[name],
  inputSchema: jsonSchemaFor(name),
}))

// ─── Tool handlers ───────────────────────────────────────────────────────────

type ToolArgs = Record<string, unknown>

/** The validated shape of a given tool's arguments. */
type Args<T extends ToolName> = z.infer<(typeof toolSchemas)[T]>

/**
 * One line per spark, for list output. Shows the title rather than the whole
 * body — a long spark would otherwise dump thousands of characters into the
 * model's context for every row. kindling_get returns the full record.
 *
 * surface_count alone is nearly meaningless: "surfaced 3x" reads identically
 * whether the last one was yesterday or eight months ago, so the date goes
 * with it.
 */
const formatSpark = (spark: Spark): string => {
  const tags = spark.tags ?? []
  const meta = [`captured ${relativeAge(spark.created_at)}`]
  if (spark.surface_count > 0) {
    const last = spark.last_surfaced_at ? `, last ${relativeAge(spark.last_surfaced_at)}` : ''
    meta.push(`surfaced ${spark.surface_count}x${last}`)
  }
  if (spark.promoted_to) {
    meta.push(`promoted to ${spark.promoted_to}${spark.promoted_at ? ` ${relativeAge(spark.promoted_at)}` : ''}`)
  }

  const extent = isLongContent(spark.content) ? ` (${contentExtent(spark.content)})` : ''
  return (
    `[${spark.id}] (${spark.status}) ${displayTitle(spark)}${extent}` +
    `${tags.length ? ` [${tags.join(', ')}]` : ''} — ${meta.join(' · ')}`
  )
}

/** The whole record, for inspecting a single spark. */
const formatSparkVerbose = (spark: Spark): string => {
  const tags = spark.tags ?? []
  const lines = [
    `[${spark.id}] (${spark.status})`,
    `Title: ${displayTitle(spark)}${spark.title ? '' : ' (derived from content)'}`,
    '',
    spark.content,
    '',
    `Tags: ${tags.length ? tags.join(', ') : '(none)'}`,
    `Captured: ${relativeAge(spark.created_at)}`,
    spark.last_surfaced_at
      ? `Last surfaced: ${relativeAge(spark.last_surfaced_at)} (${spark.surface_count}x total)`
      : `Never surfaced`,
  ]
  if (spark.cold_at) lines.push(`Went cold: ${relativeAge(spark.cold_at)}`)
  if (spark.promoted_to) {
    lines.push(
      `Promoted to: ${spark.promoted_to}${spark.promoted_at ? ` (${relativeAge(spark.promoted_at)})` : ''}`
    )
    if (spark.promoted_notes) lines.push(`Provenance: ${spark.promoted_notes}`)
  }
  return lines.join('\n')
}

async function handleToolCall(token: string, name: string, rawArgs: ToolArgs): Promise<unknown> {
  if (!isToolName(name)) throw new Error(`Unknown tool: ${name}`)

  // The single validation boundary. Upstash enforces no schema of its own, so
  // anything that gets past here is what ends up stored forever.
  const parsed = toolSchemas[name].safeParse(rawArgs)
  if (!parsed.success) {
    return errText(`Invalid arguments for ${name} — ${formatZodError(parsed.error)}`)
  }

  switch (name) {
    case 'kindle': {
      const { content, title, tags, allow_duplicate } = parsed.data as Args<'kindle'>
      await runDecay(token)

      // The same recurring thought captured three times becomes three sparks
      // that then compete against each other in recall.
      if (!allow_duplicate) {
        const live = (await listSparks(token)).filter((s) => s.status !== 'archived')
        const hit = findNearest(live, content)
        if (hit?.exact) {
          return text(
            `Already kindled — [${hit.spark.id}] ${displayTitle(hit.spark)} has the same content ` +
              `(captured ${relativeAge(hit.spark.created_at)}). Nothing new was written. ` +
              `Pass allow_duplicate: true if you meant to capture it again.`
          )
        }
        if (hit) {
          const spark = await createSpark(token, content, tags ?? [], title ?? null)
          return text(
            `Kindled: [${spark.id}] ${displayTitle(spark)}\n\n` +
              `Heads up — this looks like [${hit.spark.id}] ${displayTitle(hit.spark)} ` +
              `(${Math.round(hit.score * 100)}% similar, captured ${relativeAge(hit.spark.created_at)}). ` +
              `Both are kept; merge them with kindling_update and kindling_archive if they are the same thought.`
          )
        }
      }

      const spark = await createSpark(token, content, tags ?? [], title ?? null)
      return text(`Kindled: [${spark.id}] ${displayTitle(spark)}`)
    }

    case 'kindling_recall': {
      const { limit, tags, context } = parsed.data as Args<'kindling_recall'>
      const sparks = await recallSparks(token, limit, tags, context)
      if (sparks.length === 0) {
        return text(
          tags?.length
            ? `No active sparks matching tags: ${tags.join(', ')}.`
            : 'No active sparks to recall.'
        )
      }
      const lines = sparks.map(formatSpark).join('\n')
      return text(`Recalled ${sparks.length} spark${sparks.length !== 1 ? 's' : ''}:\n\n${lines}`)
    }

    case 'kindling_promote': {
      const { spark_id, target, notes } = parsed.data as Args<'kindling_promote'>
      const updated = await updateSpark(token, spark_id, {
        promoted_to: target,
        promoted_at: Date.now(),
        promoted_notes: notes ?? null,
        status: 'archived',
      })
      if (!updated) return errText(`Spark ${spark_id} not found.`)
      return text(
        `Promoted [${spark_id}] ${displayTitle(updated)} → ${target}` +
          `${notes ? `\nProvenance: ${notes}` : ''}`
      )
    }

    case 'kindling_list': {
      const { status, tag, limit, offset, promoted } = parsed.data as Args<'kindling_list'>
      let sparks = await listSparks(token, status)
      if (tag) sparks = sparks.filter((s) => hasTag(s, tag))
      if (promoted !== undefined) sparks = sparks.filter((s) => isPromoted(s) === promoted)

      const total = sparks.length
      const page = sparks.slice(offset, offset + limit)
      if (page.length === 0) {
        return text(total === 0 ? 'No sparks found.' : `No sparks at offset ${offset} (${total} total).`)
      }

      const shown = `Showing ${offset + 1}–${offset + page.length} of ${total}`
      return text(`${shown}:\n\n${page.map(formatSpark).join('\n')}`)
    }

    case 'kindling_search': {
      const { query: rawQuery, tags } = parsed.data as Args<'kindling_search'>
      const query = rawQuery?.toLowerCase()
      if (!query && (!tags || tags.length === 0))
        return errText('Provide at least one of: query, tags.')
      const all = await listSparks(token)
      const tagsOk = (s: Spark) => (tags?.length ? hasAnyTag(s, tags) : true)
      const exactOk = (s: Spark) =>
        query
          ? `${s.title ?? ''} ${s.content}`.toLowerCase().includes(query)
          : true

      let matches = all.filter((s) => exactOk(s) && tagsOk(s))
      let fuzzy = false

      // Only fall back to fuzzy when exact finds nothing, so a good query is
      // never diluted by near-misses.
      if (matches.length === 0 && query) {
        matches = all.filter((s) => fuzzyMatches(s, query) && tagsOk(s))
        fuzzy = matches.length > 0
      }

      if (matches.length === 0) return text('No sparks match that search.')
      const header = fuzzy
        ? `No exact match, but ${matches.length} close one${matches.length === 1 ? '' : 's'}:\n\n`
        : ''
      return text(header + matches.map(formatSpark).join('\n'))
    }

    case 'kindling_get': {
      const { spark_id } = parsed.data as Args<'kindling_get'>
      const spark = await getSpark(token, spark_id)
      if (!spark) return errText(`Spark ${spark_id} not found.`)
      return text(formatSparkVerbose(spark))
    }

    case 'kindling_export': {
      const { format, status } = parsed.data as Args<'kindling_export'>
      const sparks = await listSparks(token, status)
      if (sparks.length === 0) return text('Nothing to export — no sparks yet.')
      return text(format === 'json' ? toJson(sparks) : toMarkdown(sparks))
    }

    case 'kindling_find_duplicates': {
      const { threshold } = parsed.data as Args<'kindling_find_duplicates'>
      const live = (await listSparks(token)).filter((s) => s.status !== 'archived')
      const pairs = findDuplicatePairs(live, threshold).slice(0, 25)
      if (pairs.length === 0) return text('No duplicates found.')
      return text(
        `${pairs.length} likely duplicate pair${pairs.length === 1 ? '' : 's'}:\n\n` +
          pairs
            .map(
              ({ a, b, score }) =>
                `${Math.round(score * 100)}% — [${a.id}] ${displayTitle(a)}\n` +
                `      vs [${b.id}] ${displayTitle(b)}`
            )
            .join('\n\n')
      )
    }

    case 'kindling_snooze': {
      const { spark_id, days } = parsed.data as Args<'kindling_snooze'>
      const spark = await getSpark(token, spark_id)
      if (!spark) return errText(`Spark ${spark_id} not found.`)
      const until = Date.now() + days * 86_400_000
      await updateSpark(token, spark_id, { snooze_until: until, status: 'active', cold_at: null })
      return text(
        `Snoozed [${spark_id}] ${displayTitle(spark)} for ${days} day${days === 1 ? '' : 's'} — ` +
          `back in recall on ${new Date(until).toISOString().slice(0, 10)}.`
      )
    }

    case 'kindling_set_standing': {
      const { spark_id, standing } = parsed.data as Args<'kindling_set_standing'>
      const spark = await getSpark(token, spark_id)
      if (!spark) return errText(`Spark ${spark_id} not found.`)
      await updateSpark(token, spark_id, {
        standing,
        // Coming back on the clock from cold would be surprising; reviving is
        // an explicit act, so only clear cold when marking standing.
        ...(standing && spark.status === 'cold' ? { status: 'active' as const, cold_at: null } : {}),
      })
      if (standing) {
        return text(
          `[${spark_id}] ${displayTitle(spark)} is now a standing spark — it will never go cold.`
        )
      }
      const { decayThresholdDays } = await getPrefs(token)
      return text(
        `[${spark_id}] ${displayTitle(spark)} is back on the ${decayThresholdDays}-day decay clock.`
      )
    }

    case 'kindling_settings': {
      const { decay_days } = parsed.data as Args<'kindling_settings'>
      const prefs = decay_days === undefined
        ? await getPrefs(token)
        : await setPrefs(token, { decayThresholdDays: decay_days })
      return text(
        `${decay_days === undefined ? 'Current settings' : 'Updated'} — sparks go cold after ` +
          `${prefs.decayThresholdDays} days without interaction. ` +
          `That same window sets how fast neglect builds in the recall ranking.`
      )
    }

    case 'kindling_stats': {
      const all = await listSparks(token)
      if (all.length === 0) return text('No sparks yet — nothing to report.')
      const st = computeStats(all)
      const lines = [
        `${st.total} spark${st.total === 1 ? '' : 's'} total`,
        `  active ${st.active} · cold ${st.cold} · archived ${st.archived} · promoted ${st.promoted}`,
        '',
        st.promotionRate !== null
          ? `Promotion rate: ${Math.round(st.promotionRate * 100)}% of concluded sparks became something.`
          : 'Promotion rate: nothing concluded yet.',
        `Captured: ${st.capturedLast7} in the last week, ${st.capturedLast30} in the last 30 days.`,
        `${st.neverSurfaced} active spark${st.neverSurfaced === 1 ? '' : 's'} never surfaced. ${st.untagged} untagged.`,
      ]
      if (st.oldestActive) {
        lines.push('', `Oldest active: ${displayTitle(st.oldestActive)} (${relativeAge(st.oldestActive.created_at)})`)
      }
      if (st.mostNeglected) {
        const touched = st.mostNeglected.last_surfaced_at ?? st.mostNeglected.created_at
        lines.push(`Most neglected: ${displayTitle(st.mostNeglected)} (untouched ${relativeAge(touched)})`)
      }
      return text(lines.join('\n'))
    }

    case 'kindling_tags': {
      const all = await listSparks(token)
      const counts = tagCounts(all)
      if (counts.length === 0) return text('No tags in use yet.')
      return text(
        `${counts.length} tag${counts.length === 1 ? '' : 's'} in use:\n` +
          counts.map((t) => `  ${t.tag} (${t.count})`).join('\n')
      )
    }

    case 'kindling_rename_tag': {
      const { from, to, confirm_merge } = parsed.data as Args<'kindling_rename_tag'>

      // Tags are stored folded, so "zine" -> "ZINE" is a no-op. Catching it
      // here stops it being reported as an irreversible merge with itself.
      if (normalizeTag(from) === normalizeTag(to)) {
        return errText(
          `"${from}" and "${to}" are the same tag — tags are stored lowercase, so there is nothing to change.`
        )
      }

      const all = await listSparks(token)

      const carriers = all.filter((s) => hasTag(s, from))
      if (carriers.length === 0) {
        return errText(
          `No sparks carry the tag "${from}". Call kindling_tags to see what is actually in use.`
        )
      }

      // A merge is irreversible: afterwards nothing records which sparks came
      // from which tag. So it needs the same explicit consent as a delete.
      const existing = all.filter((s) => hasTag(s, to))
      if (existing.length > 0 && !confirm_merge) {
        return errText(
          `"${to}" is already in use on ${existing.length} spark${existing.length === 1 ? '' : 's'}, ` +
            `so renaming "${from}" (${carriers.length} spark${carriers.length === 1 ? '' : 's'}) into it is a MERGE. ` +
            `That cannot be cleanly undone — afterwards there is no record of which spark had which tag. ` +
            `Tell the user those counts, and call again with confirm_merge: true if they want it.`
        )
      }

      const { changed, merged } = await renameTag(token, from, to)
      if (changed.length === 0) {
        return errText(`Nothing changed — "${from}" and "${to}" may already be the same tag.`)
      }

      return text(
        `${merged ? 'Merged' : 'Renamed'} "${from}" → "${to}" across ${changed.length} ` +
          `spark${changed.length === 1 ? '' : 's'}.` +
          (merged
            ? ' The two tags are now one; this cannot be undone.'
            : ` Reverse it by renaming "${to}" back to "${from}".`)
      )
    }

    case 'kindling_batch_archive': {
      const { spark_ids } = parsed.data as Args<'kindling_batch_archive'>
      const archived = await archiveSparks(token, spark_ids)
      if (archived.length === 0) {
        return errText('Nothing archived — those ids are unknown or already archived.')
      }
      const skipped = spark_ids.length - archived.length
      return text(
        `Archived ${archived.length} spark${archived.length === 1 ? '' : 's'}.` +
          (skipped > 0 ? ` ${skipped} skipped (unknown or already archived).` : '')
      )
    }

    case 'kindling_delete': {
      const { spark_id } = parsed.data as Args<'kindling_delete'>
      const spark = await getSpark(token, spark_id)
      if (!spark) return errText(`Spark ${spark_id} not found.`)
      const title = displayTitle(spark)
      const removed = await deleteSpark(token, spark_id)
      if (!removed) return errText(`Spark ${spark_id} could not be deleted.`)
      return text(`Deleted [${spark_id}] ${title}. This cannot be undone.`)
    }

    case 'kindling_remove_tag': {
      const { tag, confirm } = parsed.data as Args<'kindling_remove_tag'>

      const all = await listSparks(token)
      const carriers = all.filter((s) => hasTag(s, tag))
      if (carriers.length === 0) {
        return errText(
          `No sparks carry the tag "${tag}". Call kindling_tags to see what is actually in use.`
        )
      }

      // One call can touch the whole store, so the count goes to the user
      // before the write happens, not after.
      if (!confirm) {
        return errText(
          `"${normalizeTag(tag)}" is on ${carriers.length} spark${carriers.length === 1 ? '' : 's'}. ` +
            `Removing it strips the tag from all of them in one pass. Tell the user that count, ` +
            `and call again with confirm: true if they want it. The sparks themselves are not touched, ` +
            `and the change can be reversed afterwards.`
        )
      }

      const changed = await removeTag(token, tag)
      if (changed.length === 0) {
        return errText(`Nothing changed — "${tag}" does not appear to be in use.`)
      }

      return text(
        `Removed "${normalizeTag(tag)}" from ${changed.length} spark${changed.length === 1 ? '' : 's'}.\n\n` +
          `Reversible: kindling_update with tags ["${normalizeTag(tag)}"] puts it back on any of ` +
          `these ids.\n` +
          changed.map((id) => `  ${id}`).join('\n')
      )
    }

    case 'kindling_archive': {
      const { spark_id } = parsed.data as Args<'kindling_archive'>
      const spark = await getSpark(token, spark_id)
      if (!spark) return errText(`Spark ${spark_id} not found.`)
      await archiveSpark(token, spark_id)
      return text(`Archived [${spark_id}]`)
    }

    case 'kindling_dig': {
      const { limit } = parsed.data as Args<'kindling_dig'>
      const cold = await listSparks(token, 'cold')
      const slice = cold.slice(0, limit)
      if (slice.length === 0) return text('No cold sparks. Everything is still warm.')
      return text(
        `${slice.length} cold spark${slice.length !== 1 ? 's' : ''} waiting:\n\n${slice
          .map(formatSpark)
          .join('\n')}`
      )
    }

    case 'kindling_update': {
      const { spark_id, title, content, tags, tag_mode, remove_tags } =
        parsed.data as Args<'kindling_update'>
      if (!content && !tags && !title && !remove_tags)
        return errText('Provide at least one of: title, content, tags, remove_tags.')

      const existing = await getSpark(token, spark_id)
      if (!existing) return errText(`Spark ${spark_id} not found.`)

      // Merge by default: replacing requires the caller to already know every
      // tag the spark carries, and a wrong guess used to drop the rest silently.
      let nextTags: string[] | undefined
      if (tags || remove_tags) {
        const base =
          tag_mode === 'replace' ? (tags ?? []) : [...(existing.tags ?? []), ...(tags ?? [])]
        const removed = new Set(remove_tags ?? [])
        nextTags = Array.from(new Set(base)).filter((t) => !removed.has(t))
      }

      const updated = await updateSpark(token, spark_id, {
        ...(title ? { title } : {}),
        ...(content ? { content } : {}),
        ...(nextTags ? { tags: nextTags } : {}),
      })
      if (!updated) return errText(`Spark ${spark_id} not found.`)
      const updatedTags = updated.tags ?? []
      return text(
        `Updated [${spark_id}]: ${displayTitle(updated)}${
          updatedTags.length ? ` [${updatedTags.join(', ')}]` : ''
        }`
      )
    }

    case 'kindling_revive': {
      const { spark_id } = parsed.data as Args<'kindling_revive'>
      const spark = await getSpark(token, spark_id)
      if (!spark) return errText(`Spark ${spark_id} not found.`)
      if (spark.status !== 'cold')
        return errText(`Spark ${spark_id} is ${spark.status}, not cold.`)
      await reviveSpark(token, spark_id)
      return text(`Revived [${spark_id}] — back in the fire.`)
    }
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

  // Clients negotiating over HTTP echo the agreed version back on every
  // request. An unsupported one is a 400, per the transport spec.
  const headerVersion = req.headers.get('mcp-protocol-version')
  if (
    headerVersion &&
    !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(headerVersion)
  ) {
    return NextResponse.json(
      {
        error: 'Unsupported MCP-Protocol-Version',
        supported: SUPPORTED_PROTOCOL_VERSIONS,
        requested: headerVersion,
      },
      { status: 400 }
    )
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }
  try {
    body = await req.json()
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  const { method, params: rpcParams } = body
  const id = body.id ?? null

  // A notification carries no id and MUST NOT be answered with a response
  // body. That covers notifications/initialized and any future one.
  const isNotification = body.id === undefined || method?.startsWith('notifications/')
  if (isNotification) return new NextResponse(null, { status: 202 })

  try {
    switch (method) {
      case 'initialize': {
        const requested = (rpcParams as { protocolVersion?: unknown } | undefined)
          ?.protocolVersion
        return ok(id, {
          protocolVersion: negotiateVersion(requested),
          capabilities: { tools: {} },
          // Read from package.json so it cannot drift from the release.
          serverInfo: { name: 'kindling', version: KINDLING_VERSION },
        })
      }

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

/**
 * Kindling is stateless POST-only — there is no SSE stream to open. Clients
 * that probe for one get an explicit explanation rather than the framework's
 * bare 405.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: 'Method not allowed',
      message:
        'The Kindling MCP endpoint is stateless and accepts JSON-RPC over POST only. There is no SSE stream to subscribe to.',
      supported: SUPPORTED_PROTOCOL_VERSIONS,
    },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
