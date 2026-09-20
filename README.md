# Kindling

A remote MCP server for capturing sparks of thought — and surfacing them again before they go cold.

Kindling is an idea inbox with a memory. You capture a half-formed thought mid-conversation (a phrase, a project seed, a link, a "what if"), and it sits in a store that actively works against forgetting: a recall algorithm resurfaces whatever has waited longest and been touched least, and anything untouched for 180 days quietly goes cold so you can triage it deliberately instead of letting it rot silently.

It runs as a Next.js app that serves two things from one deployment:

- **An MCP server** at `/{token}/mcp` — nine tools Claude (or any MCP client) can call to kindle, recall, promote, search, and prune sparks.
- **A web dashboard** at `/` — a browser GUI over the same data, for when you'd rather see everything at once than ask for it.

---

## Table of Contents

- [Core Concepts](#core-concepts)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Tokens and the Security Model](#tokens-and-the-security-model)
- [Connecting to Claude](#connecting-to-claude)
- [MCP Tools Reference](#mcp-tools-reference)
- [The Recall Algorithm](#the-recall-algorithm)
- [Decay: How Sparks Go Cold](#decay-how-sparks-go-cold)
- [Data Model](#data-model)
- [Storage Layout](#storage-layout)
- [HTTP API Reference](#http-api-reference)
- [MCP Protocol Details](#mcp-protocol-details)
- [Web Dashboard](#web-dashboard)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Known Gaps](#known-gaps)

---

## Core Concepts

### Sparks

A **spark** is one captured thought. It has content, optional tags, and a lifecycle's worth of metadata: when it was created, when it was last surfaced, how many times it's been surfaced, and — if it ever became something real — where it went.

### The three statuses

| Status | Meaning | How it gets there |
|---|---|---|
| `active` | Live and eligible for recall | Default on capture; also via `kindling_revive` |
| `cold` | Untouched for 180+ days — needs triage | Automatically, via decay |
| `archived` | Done with it — either used or discarded | Via `kindling_archive` or `kindling_promote` |

### Promotion

When a spark actually becomes something — a task in ControlledChaos, a paragraph in an essay, a new repo — you **promote** it. That archives the spark but records where it went and why, so the store keeps a provenance trail rather than just a graveyard. Promotion is the point; capture is just the setup.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript (strict)
- **Runtime:** Node.js (routes pin `runtime = 'nodejs'`)
- **UI:** React 19 + Tailwind CSS v4
- **Storage:** Upstash Redis (REST — no persistent connections, so it works on serverless)
- **Protocol:** MCP over JSON-RPC 2.0, hand-rolled (no MCP SDK dependency)
- **IDs:** `uuid` v4

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- An [Upstash Redis](https://upstash.com/) database (the free tier is plenty — Kindling stores one hash per token)

### Installation

```bash
git clone https://github.com/lmdrew96/kindling.git
cd kindling
pnpm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in your Upstash credentials:

```bash
cp .env.example .env.local
```

| Variable | Description | Required |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | REST endpoint for your Upstash Redis database | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | REST auth token for that database | Yes |

Both are read by `Redis.fromEnv()` in `lib/redis.ts`. There are no other environment variables — the app has no auth provider, no API keys, and no external services beyond Redis.

### Running Locally

```bash
pnpm dev          # http://localhost:3000
```

Open the dashboard, click **Get my Kindling URL →** to mint a token, then use **Copy MCP URL** to get your local endpoint (`http://localhost:3000/{token}/mcp`).

---

## Tokens and the Security Model

Kindling has **no accounts and no login.** A token is a v4 UUID that acts as both your identity and your namespace — every spark is stored under a key derived from it.

**How a token comes into existence:** the dashboard generates one client-side with `crypto.randomUUID()` and stores it in `localStorage` under `kindling:token`. Nothing is registered server-side. Any syntactically valid UUID is accepted by the server and simply addresses an empty (or existing) namespace.

That has some direct consequences worth being clear-eyed about:

- **The token is a bearer secret.** Anyone who has your URL has full read/write access to your sparks. Treat the MCP URL like a password, not like a username.
- **There is no recovery.** Lose the token and you lose the namespace. The dashboard's **Switch token** button clears `localStorage` — copy the token somewhere durable before you use it.
- **Namespaces are isolated but not authenticated.** A token guarantees your data doesn't collide with anyone else's; it doesn't prove anyone is who they say they are.
- **The URL path contains the secret.** Path segments show up in server access logs and browser history more readily than headers do.

This is a deliberate trade for a single-user personal tool where the friction of OAuth would kill the capture habit. If Kindling ever becomes multi-tenant in a real sense, this is the first thing that needs to change.

The token format is validated against a strict UUID regex on every request. Malformed tokens get a `404` on the MCP route and a `400` on the REST API.

---

## Connecting to Claude

Kindling is a **remote** MCP server — there's nothing to install locally. Add it as a custom connector using your full endpoint URL:

```
https://your-deployment.example.com/{your-token}/mcp
```

**In Claude (web/desktop):** Settings → Connectors → Add custom connector → paste the URL. No auth configuration is needed; the token in the path does the work.

**In Claude Code:**

```bash
claude mcp add --transport http kindling https://your-deployment.example.com/{your-token}/mcp
```

Once connected, the nine `kindle` / `kindling_*` tools become available. The dashboard's **Copy MCP URL** button builds the correct URL for whatever origin you're on, so use that rather than assembling it by hand.

---

## MCP Tools Reference

All nine tools operate within the namespace of the token in the request path. Every tool returns MCP text content — a human-readable string, not structured JSON.

Sparks are rendered in responses with a consistent one-line format:

```
[<uuid>] (<status>) <content> [tag1, tag2] — surfaced 3×
```

---

### `kindle`

Capture a spark — an idea, an aside, a half-formed thought — so it isn't lost when the conversation moves on. The description shipped to clients asks the model to fire this **proactively** on idea-shaped asides rather than waiting to be told to save something; that framing is the whole difference between Kindling and a notes app.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | The spark to capture (trimmed; 1–100,000 chars) |
| `title` | string | No | Short handle shown as the card heading. Supply one for anything longer than a couple of sentences; derived from the first line when omitted |
| `tags` | string[] | No | Tags to categorize the spark (defaults to `[]`) |

Creates the spark with status `active`, `surface_count` of 0, and no surfacing history. Also runs a decay pass first, so capturing something is an opportunity for the store to notice what's gone stale.

**Returns:** `Kindled: [<id>] <title>`

---

### `kindling_recall`

Surface sparks that have been waiting longest and are most in need of attention, using the [recall algorithm](#the-recall-algorithm).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | No | Max sparks to return (default `5`, clamped to `25`) |
| `context` | string | No | Context hint about the current session or focus area |
| `tags` | string[] | No | Filter to sparks matching **any** of these tags |

Only considers `active` sparks. Runs decay first, scores every candidate, returns the top `limit`, and then — importantly — **marks each returned spark as surfaced**, bumping `surface_count` and resetting `last_surfaced_at` to now. Recalling a spark therefore lowers its future score and resets its 180-day decay clock.

**Note:** `context` is accepted for the model's benefit as a conversational hint; it does not currently affect scoring or filtering.

**Returns:** `Recalled N sparks:` followed by one formatted line per spark, or a message noting nothing active matched.

---

### `kindling_promote`

Mark a spark as promoted — moved into a project, task, or note.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `spark_id` | string | Yes | ID of the spark to promote |
| `target` | string | Yes | Where it went (e.g. `"ControlledChaos"`, `"ThreadBrain"`, a URL) |
| `notes` | string | No | Provenance notes (e.g. `"became the opening of Vertexism Section V"`) |

Sets `promoted_to`, `promoted_at`, and `promoted_notes`, and moves the spark to `archived`. Promotion is a terminal state — the spark leaves the recall pool but keeps its full history.

**Returns:** `Promoted [<id>] → <target>` plus notes if provided, or a not-found message.

---

### `kindling_list`

List sparks, optionally filtered by status and/or tag.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `status` | `"active"` \| `"cold"` \| `"archived"` | No | Filter by status (omit for all) |
| `tag` | string | No | Filter to sparks carrying this exact tag |
| `limit` | number | No | Max sparks to return |

Returns one page at a time with a running `Showing N–M of T` header; pass `offset` to continue through a large store. `limit` defaults to `25` and is clamped there.

Unlike `kindling_recall`, listing is **passive** — it does not mark anything as surfaced or affect scoring. Use it when you want to look without disturbing the decay clock.

**Returns:** One formatted line per spark, or `No sparks found.`

---

### `kindling_search`

Search sparks by content and/or tags. At least one of `query` or `tags` is required.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | No\* | Case-insensitive substring match against spark content |
| `tags` | string[] | No\* | Match sparks carrying **any** of these tags |

\* At least one must be provided, or the tool returns `Provide at least one of: query, tags.`

Searches across **all** statuses, including archived and cold. When both `query` and `tags` are given, they're combined with AND — content must match *and* at least one tag must match.

**Returns:** One formatted line per match, or `No sparks match that search.`

---

### `kindling_archive`

Archive a spark that is no longer relevant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `spark_id` | string | Yes | ID of the spark to archive |

The discard path, as opposed to `kindling_promote`'s success path. Sets status to `archived` without recording a target. Verifies the spark exists first.

**Returns:** `Archived [<id>]` or a not-found message.

---

### `kindling_dig`

Surface cold sparks that have gone quiet — review and decide to revive or archive.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | No | Max cold sparks to return (default `5`) |

The triage ritual for the cold pile. Returns cold sparks **without** marking them surfaced, so digging through them doesn't distort anything — you decide explicitly with `kindling_revive` or `kindling_archive`.

**Returns:** `N cold sparks waiting:` plus formatted lines, or `No cold sparks. Everything is still warm.`

---

### `kindling_update`

Edit the content and/or tags of an existing spark.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `spark_id` | string | Yes | ID of the spark to update |
| `content` | string | No\* | New content (replaces existing) |
| `tags` | string[] | No\* | New tags — **replaces** the existing array, it does not merge |

\* At least one must be provided, or the tool returns `Provide at least one of: content, tags.`

Timestamps, surface count, and status are untouched — this is a pure edit, not an interaction.

**Returns:** `Updated [<id>]: <content> [tags]` or a not-found message.

---

### `kindling_revive`

Move a cold spark back to active status.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `spark_id` | string | Yes | ID of the cold spark to revive |

Sets status back to `active` and clears `cold_at`. Refuses sparks that aren't currently cold, reporting their actual status instead.

**Note:** reviving does **not** reset `last_surfaced_at`. A spark that went cold from neglect comes back with its neglect intact, which means it scores near the top of the next recall — by design. Reviving is a statement that it still matters, so Kindling puts it back in front of you promptly.

**Returns:** `Revived [<id>] — back in the fire.`

---

## The Recall Algorithm

`kindling_recall` scores every active spark out of 100 and returns the highest scorers. The scoring lives in `scoreSpark()` in `lib/spark-utils.ts` (re-exported from `lib/sparks.ts`), so the dashboard and the MCP server rank by the same function and has three components:

### Age — up to 40 points

```
min(daysSinceCreated / 365, 1) × 40
```

Linear ramp from 0 at creation to the full 40 points at one year old, flat after that. Old ideas earn attention just by surviving.

### Neglect — up to 40 points

```
min(daysSinceLastInteraction / 180, 1) × 40
```

Measured from `last_surfaced_at`, falling back to `created_at` for sparks never surfaced. Maxes out at the 180-day decay threshold — which means a spark hits full neglect score right as it's about to go cold.

### Underuse — up to 20 points

```
(1 / (surface_count + 1)) × 20
```

20 points when never surfaced, 10 after one surfacing, ~6.7 after two, and so on. A harmonic decay that keeps demoting sparks you've already seen without ever silencing them entirely.

### Why this shape

The three terms answer three different questions — *is this old?*, *have I ignored it lately?*, and *have I looked at it before?* — and they're deliberately weighted so that neither raw age nor pure novelty dominates. An old spark you keep recalling and doing nothing about slowly sinks; a recent spark you've never looked at floats. Age and neglect carry equal weight because "I wrote this two years ago" and "I haven't thought about this in six months" are genuinely different signals.

**The side effect is the point:** recall mutates. Every returned spark gets `surface_count + 1` and `last_surfaced_at = now`, which simultaneously lowers its score and restarts its decay clock. Recall isn't a read — it's an interaction, and Kindling treats it as one.

---

## Decay: How Sparks Go Cold

`runDecay()` sweeps active sparks and moves any that haven't been interacted with in **180 days** to `cold`, stamping `cold_at`. "Interacted with" means `last_surfaced_at`, falling back to `created_at`.

Decay runs lazily rather than on a schedule — there's no cron. It fires at the start of `kindle` and `kindling_recall`, which means the store self-maintains on use. A dormant token accumulates nothing; the moment you touch it, the ledger catches up.

Cold sparks are out of the recall pool but fully intact. `kindling_dig` is the designated way to review them, and `kindling_revive` brings one back.

The threshold is `DECAY_THRESHOLD_DAYS` at the top of `lib/sparks.ts` — a single constant, shared by both decay and the neglect score.

---

## Data Model

Defined in `lib/types.ts`:

```ts
type SparkStatus = 'active' | 'cold' | 'archived'

interface Spark {
  id: string                       // uuid v4
  title: string | null             // short handle; derived from content when null
  content: string                  // the captured thought
  tags: string[]                   // free-form, no taxonomy enforced
  created_at: number               // epoch ms
  last_surfaced_at: number | null   // epoch ms; null until first recall
  surface_count: number            // times returned by kindling_recall
  promoted_to: string | null        // target, if promoted
  promoted_at: number | null        // epoch ms, if promoted
  promoted_notes: string | null     // provenance notes, if provided
  status: SparkStatus
  cold_at: number | null            // epoch ms when decay moved it to cold
}
```

All timestamps are epoch milliseconds (`Date.now()`), so there's no timezone handling anywhere in the store — formatting into local time is the display layer's job.

---

## Storage Layout

Everything for one token lives in a **single Redis hash**, keyed by spark ID:

```
k:{token}:sparks        # hash: { [sparkId]: Spark }
```

`lib/redis.ts` also exports a `sparkKey(token, id)` helper producing `k:{token}:spark:{id}`, but the current implementation doesn't use it — the single-hash layout won out.

This means reads are one `HGETALL` and every filter (by status, tag, or text) happens in application memory. That's fine and fast at personal scale — hundreds or low thousands of sparks — and it keeps the whole thing dependency-light. It's also the first thing that would need rethinking at a scale Kindling isn't trying to reach.

Upstash's REST client auto-serializes on write and auto-deserializes on read, so `Spark` objects are stored and retrieved directly with no manual `JSON.stringify` / `JSON.parse`.

---

## HTTP API Reference

`/api/sparks` backs the web dashboard. It's a plain REST surface; the token travels as a query parameter and is UUID-validated on every method.

### `GET /api/sparks?token={token}&status={status}`

Returns a JSON array of sparks. `status` is optional — omit it for all statuses.

**Responses:** `200` with `Spark[]` · `400` if the token is missing or malformed

### `POST /api/sparks?token={token}`

```json
{ "content": "the spark text", "tags": ["optional", "tags"] }
```

Content is trimmed and must be non-empty. Tags default to `[]`.

**Responses:** `201` with the created `Spark` · `400` on bad token or empty content

### `PATCH /api/sparks?token={token}&id={sparkId}`

Body is a partial `Spark` — the fields in it are merged over the existing record. The dashboard uses this for archive (`{"status":"archived"}`) and revive (`{"status":"active","cold_at":null}`).

**Responses:** `200` with the updated `Spark` · `400` on bad token or missing `id` · `404` if the spark doesn't exist

**Note:** this endpoint merges whatever fields you send without validating them against the `Spark` shape. It's built for the dashboard's two known operations; treat it as an internal API rather than a public one.

---

## MCP Protocol Details

The MCP server at `app/[token]/mcp/route.ts` is a hand-written JSON-RPC 2.0 implementation — no MCP SDK dependency.

- **Transport:** HTTP POST only. There's no SSE stream and no `GET` handler — each request is self-contained and stateless.
- **Protocol version:** negotiated — `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25` (latest offered when the client asks for something unsupported)
- **Server info:** `{ name: "kindling", version: "0.6.0" }`
- **Capabilities:** `{ tools: {} }` — tools only; no resources, prompts, or sampling.

### Supported methods

| Method | Behavior |
|---|---|
| `initialize` | Returns protocol version, capabilities, and server info |
| `notifications/initialized` | Acknowledged with an empty result |
| `tools/list` | Returns all nine tool definitions with JSON Schema |
| `tools/call` | Dispatches to the named handler; returns MCP text content |

### Error codes

| Code | Meaning |
|---|---|
| `-32700` | Parse error — the request body wasn't valid JSON |
| `-32601` | Method not found |
| `-32000` | Internal error — thrown by a tool handler (including unknown tool names) |

A malformed token short-circuits before any JSON-RPC handling and returns a plain `404` with `{ "error": "Invalid token format" }`.

**Design note:** tool-level problems (spark not found, missing arguments) come back as ordinary text results rather than JSON-RPC errors. That's intentional — the model reads "Spark abc not found." and can respond to it conversationally, where a protocol error would surface as a tool failure.

---

## Web Dashboard

A single-page client component at `app/page.tsx`. All color comes from theme tokens defined in `app/globals.css` — the component contains no hardcoded color values.

**Palette:** Eventide Lilac `#4C3E70` (cards), the same deepened ~30% to `#352B4E` (page), Light Marigold `#F0BC3E` (primary/CTA), Aqua Whisper `#309FAF` (cold sparks), Aqua Gleam `#0A3D46` (tag pills), Plush Topaz `#A87324` (hover/pressed gold). The foreground ramp is ADHDesigns Bone `#EDE6D2` mixed toward the card color.

The page is a deepened lilac rather than the palette color itself because pure `#4C3E70` as a full-page background leaves almost no contrast headroom — marigold on cards falls to 4.63 and no Aqua Whisper tint clears AA. Deepening the page and promoting `#4C3E70` to the card surface restores the ramp, and puts the named purple on every card rather than only on tag pills.

Every pairing is contrast-checked and the ratios are documented inline in `globals.css` as "on page / on card". The card is the lighter of the two, so it's the binding constraint and every text token is verified against it. Two limits the token names encode: Plush Topaz fails as text on either surface, so it's fill-and-border only; Aqua Whisper is 3.01 on a card — fine for icons, borders and large text but not small text, which is why `--color-cold-text` exists as a lightened tint (4.80).

Type is Raela Grotesque for body and Kineks Round for display, loaded from `branding/fonts/` via `next/font/local`.

**Token gate** — first visit offers two paths: generate a fresh token, or paste an existing one to load a namespace on another device. Either way it's persisted to `localStorage` and the gate doesn't reappear.

**Dashboard**

- **Kindle input** — textarea plus comma-separated tags field. `⌘↵` / `Ctrl+↵` submits and refocuses for rapid-fire capture.
- **Search** — client-side filter across content and tags within the active tab.
- **Tabs** — Active / Cold / Archived, each with a live count.
- **Spark cards** — content, tag pills, relative capture age, surface count, and a cold indicator. Archive on anything not already archived; Revive on cold sparks.
- **Copy MCP URL** — builds the connector URL from the current origin.
- **Switch token** — clears `localStorage` and returns to the gate.
- **Toasts** — transient confirmations, auto-dismissing after 2.5s.

Empty states are per-tab and explain the mechanic rather than just stating emptiness ("Sparks with no interaction for 180 days move here automatically").

Dashboard mutations are optimistic — local state updates immediately and the request goes out behind it.

---

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start the Next.js dev server on port 3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Next.js linting |
| `pnpm type-check` | `tsc --noEmit` — strict type check, no emit |

---

## Deployment

Built for Vercel. There's no `vercel.json` and no custom config — the defaults work.

1. Import the repo into Vercel.
2. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as environment variables (Production, Preview, and Development as needed).
3. Deploy.

The MCP endpoint is then live at `https://<your-domain>/{token}/mcp`. The dashboard falls back to `https://kindling.adhdesigns.dev` when building the MCP URL during server-side render, so change that literal in `app/page.tsx` if you deploy elsewhere.

Both routes pin `export const runtime = 'nodejs'` — they use the `uuid` package and Upstash's Node client rather than edge-compatible equivalents, so don't switch them to the edge runtime without swapping those out.

No cron job or background worker is needed. Decay is lazy and runs on use.

---

## Project Structure

```
kindling/
├── app/
│   ├── [token]/mcp/route.ts   # MCP server — JSON-RPC, tool schemas, handlers
│   ├── api/sparks/route.ts    # REST API backing the dashboard
│   ├── page.tsx               # Token gate + dashboard (client component)
│   ├── layout.tsx             # Root layout and metadata
│   └── globals.css            # Tailwind v4 @theme — all color/type tokens
├── branding/fonts/            # Raela Grotesque + Kineks Round (local fonts)
├── lib/
│   ├── sparks.ts              # CRUD, recall scoring, decay — the core logic
│   ├── redis.ts               # Upstash client + key helpers
│   └── types.ts               # Spark and SparkStatus
├── .env.example
├── next.config.ts
└── tsconfig.json
```

The whole system is a little over 1,000 lines. `lib/sparks.ts` is where the behavior lives — if you're changing how Kindling thinks, it's almost certainly in there.

---

## Known Gaps

Honest notes on the current state:

- **`zod` is an unused dependency.** Tool arguments are cast from `Record<string, unknown>` rather than parsed, so malformed arguments from an MCP client fail at use rather than at the boundary.
- **`sparkKey()` in `lib/redis.ts` is dead code** — a leftover from a per-key storage design that the single-hash layout replaced.
- **`kindling_recall`'s `context` parameter is decorative.** It's in the schema and accepted, but nothing reads it.
- **No pagination anywhere.** Every list operation loads the full hash into memory.
- **No rate limiting** on either the MCP or REST surface.
- **`PATCH /api/sparks` doesn't validate its body** against the `Spark` shape — see the note in the [HTTP API Reference](#http-api-reference).

---

Part of the [ADHDesigns](https://adhdesigns.dev) ecosystem.
