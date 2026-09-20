# Kindling — MCP Tools Audit

**Date:** 2026-09-20 · **Patch:** `mcp tools audit` · **Scope:** `app/[token]/mcp/route.ts`, `lib/sparks.ts`

Protocol claims in this document were verified against the current MCP specification (`2026-07-28`) rather than asserted from memory.

---

## Executive Summary

The server is a clean, dependency-free JSON-RPC implementation and the nine tools cover the lifecycle sensibly. Three things hold it back:

1. **No input validation.** `zod` is installed and entirely unused; every handler casts `args.x as string`. A malformed call writes corrupt data to Redis rather than erroring.
2. **The protocol is two years stale and violates the spec in two places.** Version is hardcoded to `2024-11-05` with no negotiation, tool errors don't set `isError`, and `notifications/initialized` sends a response it must not send.
3. **The tool descriptions don't tell the model when to act.** This is the highest-leverage fix in the document — Kindling's entire value over a notes app is Claude noticing a spark unprompted, and nothing in the schema invites that.

Sibling precedent: **Tangle** solves several of these already (`note_get`, `note_stats`, `note_find_duplicates`, `note_batch_resolve`, `standing`). Where a gap has a Tangle equivalent, it's noted.

---

## High Priority

### 1. No input validation — `zod` is installed and unused

**What:** Every handler casts blindly:

```ts
const content = args.content as string       // kindle
const spark_id = args.spark_id as string     // promote/archive/update/revive
```

`zod ^3.24.4` is in `dependencies` and imported nowhere in the codebase.

**Why it matters:** `inputSchema` declares `required: ['content']`, but nothing enforces it — the schema is advisory to the client, not binding on the server. A client that omits `content` writes `{ content: undefined }` into the Redis hash. That spark then renders as `Kindled: [uuid] undefined`, counts toward recall, and persists forever with no way to distinguish it from a real capture. `getSpark(token, undefined)` similarly becomes `hget(key, undefined)`.

**Why it matters more here than usual:** Kindling's storage has no schema enforcement of its own — Upstash takes whatever object you hand it. The MCP boundary is the *only* place bad data can be stopped.

**Suggested action:** One zod schema per tool, parsed at the top of `handleToolCall`, returning a spec-compliant error result (see finding #2) on failure. Derive `inputSchema` from the zod schemas with `zod-to-json-schema` so the two can't drift.

**Effort:** Half-day

---

### 2. Three protocol-compliance gaps

**What:** Verified against the `2026-07-28` spec:

| Issue | Current | Spec |
|---|---|---|
| **Version negotiation** | `initialize` ignores `params.protocolVersion` and always returns `2024-11-05` | A server MUST echo the requested version when it supports it, and otherwise MUST respond with another version it supports (SHOULD be its latest). Kindling ignores the request entirely. |
| **Tool errors** | Every failure returns plain `text()` — "Spark abc not found." is structurally identical to success | Tool execution errors must set `isError: true` in the result, which is what lets the model recognize and self-correct. Protocol errors (unknown tool, malformed request) stay as JSON-RPC errors. |
| **Notifications** | `notifications/initialized` returns `ok(id, {})` | "The receiver **must not** send a response to a notification, and notifications must not include an ID field." Should return `202`/empty body. |

**Why it matters:** The version pin is the practical one — `2024-11-05` is two years and several revisions old, and a client negotiating a newer version gets silently handed an old one with no signal. The `isError` gap is the one that affects answer quality: right now a model that calls `kindling_promote` with a bad ID is told "Spark abc not found." in the same channel as a success, and has no structural cue that it failed. Newer spec revisions also add fields to the tool result shape (e.g. `resultType`) worth reviewing while in there.

**Suggested action:** Negotiate the version against a supported list; add `isError: true` to all failure paths while keeping the human-readable text (the readable text is a genuine strength — don't replace it, just flag it); return an empty 202 for notifications.

**Correction (2026-09-20, applied in v0.3.1):** an earlier draft of this finding cited `-32022 UnsupportedProtocolVersionError` as the required response to an unsupported version. That is wrong. The lifecycle spec defines the error case as `-32602` with `data.supported` / `data.requested`, and — more importantly — reserves it for versions the server cannot work with at all. The normal rule is to respond with a version the server *does* support rather than to error, which is what Kindling now does. The spec revision was also checked: the newest published at the time of implementation is `2025-11-25`, not the `2026-07-28` this document's header claims.

**Effort:** Half-day

---

### 3. Tool descriptions don't tell the model *when* to use them

**What:** Current descriptions are accurate but purely definitional:

> `kindle` — "Capture a spark of thought, idea, or insight into Kindling."

Nothing tells the model to act proactively, what qualifies as spark-shaped, or how these tools relate to each other.

**Why it matters:** **This is the highest-leverage change in this audit.** Kindling's differentiator over any notes app is that Claude notices a stray idea mid-conversation and captures it without being asked. That behavior lives entirely in the tool description, and right now nothing invites it — so `kindle` only fires when the user explicitly says "save this," which is the one case where a notes app would have worked fine.

Compare Tangle's framing, which tells the model to capture as it works, gives concrete examples of a good capture, and sets capture discipline (terse, one thought each, don't log facts). That framing is why Tangle gets used passively and Kindling doesn't.

**Suggested action:** Rewrite all nine descriptions to include trigger conditions and relationships. `kindle` should say to fire proactively on idea-shaped asides, with two or three concrete examples and an explicit "don't capture concrete actionable work — that's a task, not a spark." `kindling_recall` should say when to offer it unprompted (start of a session, topic change). `kindling_promote` should say to fire whenever a recalled spark visibly becomes something.

**Effort:** Quick fix · **Impact:** disproportionately large

---

## Medium Priority

### 4. `formatSpark` is lossy — the model never sees the interesting fields

**What:** Every tool returns the same one-line rendering:

```
[<id>] (<status>) <content> [tags] — surfaced 3×
```

It omits `created_at`, `last_surfaced_at`, `promoted_to`, `promoted_at`, `promoted_notes`, and `cold_at`. Six of the eleven fields on `Spark` never reach the model through any tool.

**Why it matters:** The model can't answer "what did I promote last month," "how long has this been sitting," or "when did I last see this" — not because the data is missing but because the formatter drops it. `surface_count` without `last_surfaced_at` is nearly meaningless: "surfaced 3×" reads identically whether the last time was yesterday or eight months ago.

**Suggested action:** Add relative dates ("captured 4mo ago · last surfaced 3w ago") and include `promoted_to`/`promoted_notes` whenever present. Keep the one-line shape for list output; add a verbose form for single-spark output (finding #5).

**Effort:** Quick fix

### 5. No `kindling_get` — you can't inspect one spark

**What:** There is no tool to fetch a single spark by ID with full metadata. `getSpark()` exists in `lib/sparks.ts` and is used internally by `kindling_archive` and `kindling_revive`, but is never exposed.

**Why it matters:** After `kindling_recall` returns five one-liners, there's no way to drill into one. The model has an ID and no way to use it except to mutate. Tangle exposes `note_get` for exactly this.

**Suggested action:** `kindling_get(spark_id)` returning the full record including promotion provenance and all timestamps.

**Effort:** Quick fix

### 6. `limit` is unbounded and `kindling_list` has no pagination

**What:** `kindling_recall` accepts any `limit` — `limit: 10000` scores every active spark and then issues an `updateSpark` write for every one of them (each a separate `hset`). `kindling_list` accepts a `limit` but has no offset and no total count, and with none supplied returns **every** spark.

**Why it matters:** A 500-spark store dumps 500 lines into the model's context on a bare `kindling_list` call. The unbounded recall is worse — it's a write amplification, since `recallSparks` fires a `Promise.all` of individual writes proportional to `limit`.

**Suggested action:** Clamp `limit` to a sane max (25?) in both tools. Add `offset` and a "showing N of M" line to `kindling_list`.

**Effort:** Quick fix

### 7. Search is substring-only — a typo returns nothing

**What:** `kindling_search` does `s.content.toLowerCase().includes(query)`. No fuzzy matching, no stemming, no tolerance for near-misses. Tag matching is exact and case-sensitive.

**Why it matters:** The core use case is "I half-remember writing something about X." Substring matching requires you to reproduce your own phrasing exactly — the precise working-memory demand the product exists to remove. Case-sensitive tag matching compounds the tag-fragmentation problem from the UI/UX audit (finding #8 there): a spark tagged `Writing` is invisible to a search for `writing`.

**Suggested action:** Case-fold tags on both write and compare. Add fuzzy content matching (a small Levenshtein or trigram pass over the already-in-memory array — no index needed at this scale).

**Effort:** Half-day

### 8. No `kindling_stats`

No tool reports counts by status, promotion rate, oldest active spark, or capture cadence. It's one `hgetall` the app already performs. Tangle has `note_stats`; the same shape applies.
**Effort:** Quick fix

### 9. No batch operations

`kindling_archive` handles one ID. Triaging a cold pile means N round trips, each a full `hgetall` + `hset`. Tangle has `note_batch_resolve` as precedent.
**Suggested action:** `kindling_batch_archive(spark_ids[])`.
**Effort:** Quick fix

### 10. `kindling_update` replaces tags wholesale with no add/remove mode

**What:** `tags` overwrites the existing array entirely.

**Why it matters:** Adding one tag requires the model to already know all existing tags, which means a prior `kindling_list` or `kindling_get` call — and if it guesses wrong it silently destroys the others. There's no error, just quiet data loss.

**Suggested action:** Add `add_tags` / `remove_tags` alongside the replacing `tags`, or a `tag_mode: 'replace' | 'merge'` parameter defaulting to merge.

**Effort:** Quick fix

---

## Low Priority

### 11. `kindling_recall`'s `context` parameter does nothing

It's declared in `inputSchema` with a description promising it hints at "the current session or focus area," and no handler code reads it. A model passing it reasonably expects an effect. Either wire it (bias scoring toward tag/content overlap with the hint) or remove it — an inert documented parameter is worse than an absent one.
**Effort:** Quick fix (remove) / Half-day (implement)

### 12. No duplicate detection on `kindle`

Capture writes unconditionally. The same recurring thought captured across three sessions becomes three sparks that then compete against each other in recall. Tangle's `note_find_duplicates` (and its `deduped` flag on capture) is the precedent.
**Effort:** Half-day

### 13. No tag management tools

Can't list all tags in use, can't rename a tag across sparks, can't merge two. The tag fragmentation this enables has no remedy once it happens. A `kindling_tags` (list with counts) is the cheap half; rename/merge is the useful half.
**Effort:** Half-day

### 14. No per-spark decay exemption

Every spark is on the same 180-day clock. Some are standing intentions rather than perishable ideas. Tangle models this with `standing: true`; the same flag would work here and would need to be honored in both `runDecay` and `scoreSpark`.
**Effort:** Quick fix

### 15. No `GET` handler on the MCP route

Clients probing for an SSE stream get a bare 405 from Next.js. Stateless POST-only is a legitimate and good choice for this server — but an explicit 405 with a JSON body explaining the transport is friendlier than the framework default.
**Effort:** Quick fix

---

## Dimension Summary

**MCP: 🟡 Adequate — well-shaped tools, unguarded boundary, stale protocol.**

The nine tools map cleanly onto the domain and the text-first return format is a real strength that shouldn't be traded away for structured JSON. What's missing is the defensive layer (validation, clamping, error signaling) and the persuasive layer (descriptions that make the model act). The first is correctness; the second is the difference between a server that gets used and one that sits connected and idle.

## Strengths worth preserving

- **Human-readable text results.** "No cold sparks. Everything is still warm." is better for the model *and* the user than a JSON blob. Add `isError` as a structural flag alongside it — don't replace it.
- **Hand-rolled JSON-RPC with no SDK.** ~90 lines, zero dependencies, trivially readable. For a nine-tool server this is the right call and the reason the protocol fixes above are each a few lines rather than an SDK upgrade.
- **Stateless POST-only.** No session store, no SSE bookkeeping, no cleanup. Fits serverless perfectly.
- **Decay runs inside the tools.** `kindle` and `kindling_recall` both call `runDecay` first, so the store self-maintains with no scheduler. Genuinely elegant.
- **Token-scoped at the route level.** Every handler takes `token` as its first argument and every Redis key derives from it — there's no code path that could read across namespaces.
