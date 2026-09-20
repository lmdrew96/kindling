# Kindling — Features Audit

**Date:** 2026-09-20 · **Patch:** `major features audit` · **Scope:** whole app — `lib/sparks.ts`, `app/[token]/mcp/route.ts`, `app/api/sparks/route.ts`, `app/page.tsx`

---

## Executive Summary

Kindling does the two things it promises — capture and resurface — and the decay/recall machinery underneath is well-shaped. The gaps cluster in three places: **the payoff is invisible, the GUI is a strict subset of the MCP surface, and there's no way to get your data out.**

The headline finding is that promotion — which the product treats as the whole point — is **write-only**. Three fields record it, one tool sets it, and nothing anywhere ever reads it back. You can tell Kindling that a spark became something real, and Kindling will never mention it again.

---

## High Priority

### 1. Promotion data is write-only — the payoff is invisible

**What:** `kindling_promote` writes `promoted_to`, `promoted_at`, and `promoted_notes`, then sets status to `archived`. Nothing reads those fields. Not `formatSpark` (which renders id/status/content/tags/surface_count only), not `kindling_list`, not `kindling_search`, not the GUI. There is no tool or view that answers "what have I actually shipped out of my sparks?"

**Why it matters:** This is the difference between an idea graveyard and an idea *pipeline*. The promotion record is the one piece of evidence that the system works, and it's unreachable. It's also the strongest possible motivation loop — ND principle #7, "help users see their own growth and patterns" — and it's sitting fully populated in Redis, unused. A promoted spark and a discarded spark are also indistinguishable in the Archived tab, because both are just `status: 'archived'`.

**Suggested action:** A "Promoted" view (GUI) and a `kindling_promoted` tool or a `promoted` filter on `kindling_list`, both surfacing target + notes + date. Distinguish promoted from discarded visually. Include `promoted_to` in `formatSpark` when present.

**Effort:** Half-day

---

### 2. No export — the entire corpus is trapped behind one UUID

**What:** There is no export of any kind. No JSON dump, no download, no backup, no `kindling_export`. The only copy of your sparks lives in one Upstash hash addressed by a UUID kept in one browser's `localStorage`.

**Why it matters:** Combined with the UI/UX audit's finding #2 (one-click unconfirmed token clearing, no recovery), this is the highest-consequence gap in the product. A cleared `localStorage`, a lost token, or an Upstash billing lapse is total, silent, unrecoverable loss of everything the user has captured — for a tool explicitly positioned as a second brain.

**Suggested action:** `GET /api/sparks?token=…&format=json` download button in the dashboard, plus a `kindling_export` MCP tool. Markdown export is a nice second format since the destination is usually a note.

**Effort:** Quick fix (JSON) / Half-day (with Markdown + GUI)

---

### 3. The GUI is a strict subset of MCP — five operations have no interface

**What:** Parity table:

| Operation | MCP | GUI |
|---|---|---|
| Capture | `kindle` | ✓ |
| List / filter by status | `kindling_list` | ✓ (tabs) |
| Search | `kindling_search` | ✓ (current tab only) |
| Archive | `kindling_archive` | ✓ |
| Revive | `kindling_revive` | ✓ (cold only) |
| **Recall (scored)** | `kindling_recall` | ✗ |
| **Promote** | `kindling_promote` | ✗ |
| **Edit content/tags** | `kindling_update` | ✗ |
| **Dig (cold triage)** | `kindling_dig` | ~ (tab exists, no triage flow) |
| **Unarchive** | (via `kindling_update`) | ✗ |

**Why it matters:** The dashboard is the surface you use when you *don't* have Claude open — phone, quick capture, weekly review. Right now you can't fix a typo in something you captured, can't promote, and can't ask "what should I look at?" without opening an MCP client. The two most valuable verbs in the product are Claude-only.

**Suggested action:** Add Promote (with target + notes), inline Edit, and a Recall action to the dashboard. These are the three that matter; unarchive comes free with the UI/UX undo work.

**Effort:** Multi-day

---

### 4. No onboarding — "Copy MCP URL" with nowhere to paste it

**What:** TokenGate → generate → dashboard. No explanation of what a spark is, what "cold" means, what promote is for, or what to do with the MCP URL the header offers to copy. The `⌘↵` hint is the only instruction in the app.

**Why it matters:** The MCP connection is the entire reason Kindling exists rather than being a notes app, and the product hands you a URL with zero context. A user who doesn't already know what MCP is has no path forward. ND anti-pattern #9 is ambiguous empty states; this is its onboarding equivalent.

**Suggested action:** A one-screen "connect to Claude" panel behind the Copy MCP URL button, with the `claude mcp add` command and the Settings → Connectors path. Not a forced tour (anti-pattern #8) — a dismissible panel and a persistent Help link.

**Effort:** Half-day

---

## Medium Priority

### 5. No bulk actions

Archiving thirty stale sparks is thirty individual clicks, each with its own 2.5s toast. This is precisely the executive-function tax the app exists to reduce, reproduced inside the app. Needs multi-select + bulk archive/tag, and a `kindling_batch_archive` on the MCP side (Tangle already has `note_batch_resolve` as precedent).
**Effort:** Half-day

### 6. No snooze — the only verbs are surface, archive, or wait 180 days

The lifecycle offers no way to say "not now, ask me in a month." Your options are to let it stay active and keep surfacing, archive it (which reads as rejection), or let it rot to cold. A `snooze_until` field plus exclusion from recall while snoozed would fill the gap — and it maps onto how people actually triage.
**Effort:** Half-day

### 7. Decay threshold is a hardcoded constant

`DECAY_THRESHOLD_DAYS = 180` in `lib/sparks.ts`, shared by both decay and the neglect score. 180 days is a big assumption to make on the user's behalf, and there's no per-user preference infrastructure at all. ND principle #1 says smart defaults over blank slates — 180 is a fine default, it just shouldn't be the only option.
**Effort:** Half-day (requires a preferences store, which doesn't exist yet)

### 8. No stats view

No count of sparks by status, no promotion rate, no "oldest active spark," no capture streak. Cheap to compute (it's one `hgetall` the app already does) and it's the view that makes the system feel alive rather than like a dropbox. Tangle has `note_stats` as precedent.
**Effort:** Quick fix

### 9. No delete — archive is the only removal

Everything is soft. There's no way to actually remove a spark you regret capturing. Worth having, with a confirmation, distinct from archive.
**Effort:** Quick fix

### 10. `last_surfaced_at` is recorded but barely surfaced

`formatSpark` shows `surface_count` ("surfaced 3×") but never *when*. "Surfaced 3× · last 2 weeks ago" is a materially different signal from "surfaced 3× · last 8 months ago," and the data is already there.
**Effort:** Quick fix

---

## Low Priority

### 11. No spark linking or clustering

Two related sparks captured six months apart have no way to become one thing. This is where Kindling would eventually earn "second brain" rather than "idea inbox," but it's a real feature with real design questions — not a quick add.
**Effort:** Major project

### 12. No duplicate detection on capture

`kindle` writes unconditionally. Capture the same recurring thought across three sessions and you get three sparks competing in recall. Tangle's `note_find_duplicates` is the precedent.
**Effort:** Half-day

### 13. No per-spark decay exemption

Everything is on the same 180-day clock. Some sparks are evergreen — a standing intention rather than a perishable idea. Tangle solved this with a `standing: true` flag; the same concept applies here.
**Effort:** Quick fix

---

## Dimension Summary

**Features: 🟡 Adequate — the loop closes, but the last step is invisible.**

Capture works, decay works, recall works. The system successfully gets ideas in and successfully decides what to show you. What it doesn't do is show you that any of it mattered, let you get your data back out, or let you do half of it without Claude open.

## Strengths worth preserving

- **Lazy decay is the right call.** No cron, no worker, no scheduled job — the store self-maintains on use, and a dormant token costs nothing. This is a genuinely elegant piece of design and it should survive any future refactor.
- **The three-status lifecycle is the right shape.** Active / cold / archived with automatic movement between them captures how ideas actually behave, and `cold` as a distinct state (rather than just "old") is what makes the triage ritual possible.
- **Recall as a mutating operation.** Treating "I showed you this" as an interaction that resets the clock is subtle and correct — it's what stops the same five sparks surfacing forever.
- **Promotion records provenance, not just completion.** `promoted_notes` ("became the opening of Vertexism Section V") is a lovely idea. It just needs somewhere to be read.
