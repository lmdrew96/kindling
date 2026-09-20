# Kindling — UI/UX Audit

**Date:** 2026-09-20 · **Patch:** `major UI/UX audit` · **Scope:** `app/page.tsx`, `app/layout.tsx`, `app/globals.css`

Reviewed through the ND-design lens (ADHD + autism primary), since Kindling's whole premise is executive-function scaffolding. Contrast figures are computed, not estimated.

---

## Executive Summary

The interaction design is genuinely good — capture is one textarea and a `⌘↵`, the empty states teach the mechanic instead of just reporting emptiness, and the tone is warm without being cute. The problems are almost all in the layer underneath: **nothing is reversible, nothing is labeled, every piece of secondary text fails contrast, and the dashboard renders sparks in arbitrary order.**

The single most consequential finding is that **the dashboard doesn't expose the recall algorithm at all.** Kindling's differentiator is that it decides what you should look at; the GUI shows you an unsorted hash dump. The second is that **"Switch token" is a one-click, unconfirmed, unrecoverable data-loss button styled as the least visible element on screen.**

---

## High Priority

### 1. The dashboard has no sort — spark order is arbitrary

**What:** `filtered` (`page.tsx:281`) chains `.filter()` calls over `sparks` and renders the result directly. `sparks` comes from `listSparks` → `Object.values(hgetall)`, so display order is Redis hash iteration order. There is no `.sort()` anywhere in the file.

**Why it matters:** This is the product thesis, unimplemented. The entire value of Kindling over a notes app is the scoring in `scoreSpark()` — age, neglect, underuse. The GUI ignores all of it. A user opening the dashboard sees their sparks in an order that means nothing and will change unpredictably. For an ADHD user, an unordered list of 80 items is the exact thing the tool was supposed to prevent.

**Suggested action:** Sort by recall score by default, with a visible sort control (Recall score / Newest / Oldest / Most neglected). Export `scoreSpark` from `lib/sparks.ts` so the client can rank without a round trip, or return a `score` field from `GET /api/sparks`.

**Effort:** Half-day

---

### 2. "Switch token" is unrecoverable data loss, one click, no confirmation

**What:** `page.tsx:398` — `signOut()` calls `localStorage.removeItem('kindling:token')`. The button (`page.tsx` header) is styled `color: rgba(247,245,250,0.2)`, `background: none`, `border: none` — a 1.84:1 contrast ratio, the least prominent element in the header. There is no confirmation dialog, and the token is never displayed anywhere in the UI.

**Why it matters:** The token *is* the account. There is no recovery, no email, no backup. One misclick on the faintest thing on screen permanently orphans every spark the user has ever captured. This inverts the ND principle exactly backwards — the most destructive action in the app has the lowest friction and the least visibility.

**Suggested action:** Three parts. (a) Confirm before clearing, with the token shown in the dialog and a copy button. (b) Show the token once at generation time with an explicit "save this" step before entering the dashboard. (c) Rename to something literal — "Sign out / switch token" reads as reversible; it isn't.

**Effort:** Half-day · **Related:** the `enable accounts and login` patch supersedes much of this, but (a) and (b) should land regardless since they're cheap and the accounts work is larger.

---

### 3. Nothing is reversible — no undo, and archived sparks have no way back

**What:** `handleArchive` fires immediately on click. The toast (`Archived.`) is `pointer-events-none` and carries no undo affordance. `SparkCard` only renders a Revive button when `spark.status === 'cold'` — **an archived spark has no path back to active anywhere in the GUI.** The data layer supports it (`updateSpark` takes any status); the UI simply never offers it.

**Why it matters:** ND principle #2 — "Undo everything. Fear of making irreversible mistakes increases cognitive load dramatically." Right now every Archive click is a small irreversible commitment, which is exactly the friction that stops people triaging. It also makes the Archived tab a roach motel.

**Suggested action:** Add Undo to the archive toast (extend toast state to carry an action). Add an "Unarchive" button on cards in the Archived tab. Both are small.

**Effort:** Half-day

---

### 4. Archive and revive fail silently and the UI lies about it

**What:** `archiveApi` (`page.tsx:24`) and `reviveApi` (`page.tsx:32`) never check `res.ok` and aren't wrapped in try/catch. `fetchSparks` and `kindleApi` do check. The handlers update local state optimistically with no rollback.

**Why it matters:** If the PATCH fails — offline, bad token, Upstash hiccup — the card visibly moves to Archived, the toast says "Archived.", and on next refresh the spark is back with no explanation. The user is told a change happened that didn't. ND principle #4: "No silent failures. No mystery state."

**Suggested action:** Check `res.ok`, throw, catch in the handler, roll back the optimistic update, and toast the actual failure.

**Effort:** Quick fix

---

### 5. Every piece of secondary text fails WCAG AA contrast

**What:** Computed against the `#1E1830` background:

| Usage | Value | Ratio | AA (4.5) |
|---|---|---|---|
| `⌘↵ to submit` hint | `rgba(247,245,250,0.18)` | **1.72** | ✗ |
| "Switch token", TokenGate "or" | `0.2` | **1.84** | ✗ |
| Empty-state subtext | `0.25` | **2.18** | ✗ |
| Card metadata, tab labels, loading text | `0.3` / `0.35` | **2.59 / 3.05** | ✗ |
| Tag input placeholder | `0.6` | 6.41 | ✓ |
| Empty-state heading | `0.5` | 4.85 | ✓ |
| Tag pill text `#88739E` on its 18% fill | — | **3.28** | ✗ |
| Amber `#DFA649`, teal `#8CBDB9` | — | 7.89 / 8.22 | ✓ |

**Why it matters:** `0.5` is the floor that passes on this background, and almost everything meaningful sits below it. This is not a niche accessibility concern — low-contrast micro-text is a primary complaint from dyslexic and visually fatigued users, and Kindling's audience skews neurodivergent by construction. The card metadata (captured date, surface count) is *information*, not decoration, and it's at 2.59.

**Suggested action:** Raise every text alpha to ≥0.5. Give the tag pill a darker fill or a lighter text color. Bake this into the theme-token work (finding #6) rather than doing it twice — the `replace current theme palette` patch is about to touch all of these anyway.

**Effort:** Quick fix (if folded into the token refactor)

---

### 6. All color is hardcoded inline — there is no theme layer

**What:** `globals.css` is one line (`@import "tailwindcss"`). No `:root`, no CSS custom properties, no Tailwind theme extension. Every color in the app is an inline `style={{ }}` hex or rgba literal, repeated across ~40 sites in `page.tsx`.

**Why it matters:** This is a **blocker for the `replace current theme palette` patch.** Done naively that patch is a 40-site find-and-replace that will drift on the next change, and it would bake the contrast failures in finding #5 straight into the new palette. It also means no dark/light mode, no density preference, and no user theming — all things the ND lens asks for (principle #3: "offer theme customization").

**Suggested action:** Before repainting, extract the palette into CSS custom properties on `:root` in `globals.css` and reference them via Tailwind v4's `@theme`. Then the repaint is a five-line diff and every future one is too.

**Effort:** Half-day · **Ordering:** do this *first*, then apply the new palette.

---

### 7. No labels, no focus indicators, no live region

**What:**
- Every input is placeholder-only. No `<label>`, no `aria-label` — the capture textarea, tag field, search field, and token paste field all rely on placeholder text that vanishes the moment you type.
- Every input sets `outline-none` (`page.tsx:178`, `:321`, `:341`, `:356`) with no `:focus-visible` replacement. **Keyboard users get zero focus indication anywhere in the app.**
- The toast is a plain `<div>` with no `role="status"` / `aria-live="polite"`, so "Spark kindled." is never announced.
- The tab row is three `<button>`s with no `role="tablist"`/`role="tab"`, no `aria-selected`, no arrow-key navigation. Selection is communicated by color alone (amber vs. 0.35 grey) — ND principle #3: "Color as information, not decoration. Never use color as the *sole* indicator of state."

**Why it matters:** `outline-none` with no replacement is the single most common way to make a web app unusable by keyboard, and Kindling is a keyboard-first tool by design (it ships a `⌘↵` shortcut). Placeholder-as-label is a known working-memory tax — the field's purpose disappears exactly when you're mid-thought.

**Suggested action:** `aria-label` on all four inputs; a visible `:focus-visible` ring token; `role="status" aria-live="polite"` on the toast; proper tablist semantics with an underline or weight change in addition to color.

**Effort:** Half-day

---

## Medium Priority

### 8. Tag input has no autocomplete — the taxonomy will fragment

**What:** Tags are entered as free-text comma-separated values (`page.tsx:247`) with no suggestion from tags already in use, no normalization, and no case folding.

**Why it matters:** You will type `writing`, `Writing`, and `write` across three sessions, and `kindling_recall`'s tag filter treats them as three unrelated tags. The MCP `kindling_search` does case-insensitive matching on *content* but exact matching on tags, so the split is invisible until recall silently returns nothing. For ADHD users specifically, "remember the exact tag string you invented four months ago" is precisely the working-memory demand the app exists to remove.

**Suggested action:** Datalist/combobox suggesting existing tags as you type, plus lowercase normalization on write. A `kindling_tags` MCP tool (see the MCP audit) would share the same index.

**Effort:** Half-day

---

### 9. Touch targets are well under the 44px minimum

**What:** Tab buttons are `text-xs px-3 py-1.5` (≈26px tall). Archive/Revive buttons are `text-xs px-2.5 py-1` (≈24px). "Switch token" is bare text. WCAG 2.5.5 asks for 44×44px; Apple's HIG says 44pt, Material says 48dp.

**Why it matters:** Kindling is a capture tool — capture happens on a phone, standing up, mid-thought. These are the conditions under which a 24px target gets mis-tapped, and the mis-tap lands on Archive.

**Suggested action:** Minimum `min-h-11` (44px) on all interactive elements, or increase padding and hit-area via pseudo-elements if the visual size should stay small.

**Effort:** Quick fix

---

### 10. Search is scoped to the current tab; MCP search isn't

**What:** `filtered` applies the status filter *before* the search filter (`page.tsx:281-287`), so searching while on Active cannot find an archived spark. `kindling_search` in MCP searches all statuses.

**Why it matters:** Two surfaces over the same data with different search semantics, and neither says which it's doing. "I know I wrote this down" → search → nothing → conclude it's lost, when it's one tab over. There's also no result count.

**Suggested action:** Search across all statuses and show which tab each hit lives in, or add an explicit "search everywhere" toggle. Show `N results`.

**Effort:** Half-day

---

### 11. A failed load renders as an empty state, not an error

**What:** `load()` catches, toasts "Failed to load sparks — check your connection.", and leaves `sparks` as `[]` with `loading` false. The user sees **"No active sparks yet. Capture something above."**

**Why it matters:** The 2.5s toast disappears and the user is left looking at a confident, friendly message telling them their idea store is empty. That is the worst possible lie for this particular app.

**Suggested action:** A distinct `error` state with the reason and a Retry button. Never render the empty state when the fetch failed.

**Effort:** Quick fix

---

### 12. No keyboard shortcut to reach the capture box

**What:** `⌘↵` submits, but only once focus is already in the textarea. There's no global shortcut to jump there, and no shortcut for anything else.

**Why it matters:** "Capture it before it fades" is the product promise and it currently costs a mouse trip. ND principle #6: "Many ND users develop strong keyboard habits because they're faster than decision-laden mouse navigation."

**Suggested action:** `/` or `c` focuses the capture box from anywhere; `Esc` blurs. Show the hint next to the existing `⌘↵` text. Keep it to two or three shortcuts — a full palette is its own patch.

**Effort:** Quick fix

---

### 13. The capture textarea is a fixed 3 rows with no auto-grow

**What:** `rows={3}`, `resize-none`.

**Why it matters:** Longer captures — the paragraph-shaped thought that's worth keeping — scroll inside a three-line window where you can't see what you wrote. Minor, but it's on the app's single most important input.

**Suggested action:** Auto-grow to a max height.

**Effort:** Quick fix

---

## Low Priority

### 14. Brand fonts aren't loaded

No `next/font`, no `font-family` declaration anywhere — the app renders in the browser default sans. Per the ADHDesigns brand, body should be Raela Grotesque with Kineks Round for display. Worth pairing with the theme-token work.
**Effort:** Quick fix

### 15. Relative dates have no absolute fallback

`daysSince()` gives "3mo ago" with no `title` attribute carrying the real date. Relative-first is the right default for time-blindness, but there should be a way to get the precise date.
**Effort:** Quick fix

### 16. `SparkStatus` is imported and never used

`page.tsx:4`. `type Tab = 'active' | 'cold' | 'archived'` at `page.tsx:209` duplicates it by hand — if `SparkStatus` ever gains a fourth value the two silently diverge. Use `Tab = SparkStatus` or drop the import.
**Effort:** Quick fix

### 17. No `prefers-reduced-motion` handling

Only `transition-opacity` / `transition-colors` are in play so the practical impact is near zero today, but the guard costs one media query and the theme-token work is the natural moment to add it.
**Effort:** Quick fix

---

## Dimension Summary

**UI/UX: 🟡 Adequate — strong interaction instincts, weak foundations.**

The things that are hard to get right (tone, empty states, capture friction, the `⌘↵` affordance) are right. The things that are easy to get right (labels, focus rings, contrast, undo, sort) are missing. That's a good position to be in — the fixes are mostly mechanical and there's no architecture to unwind.

## Strengths worth preserving

- **Empty states teach the mechanic.** "Sparks with no interaction for 180 days move here automatically" explains the system at the moment the user is wondering about it. Keep this pattern everywhere.
- **Capture is genuinely one gesture.** Type, `⌘↵`, refocus, keep going. `kindleRef.current?.focus()` after submit is exactly the right instinct for rapid capture.
- **Warm, literal copy.** "Spark revived — back in the fire." is warm without being cute, and "Gone cold" is a literal description of a real state, not a metaphor the user has to decode.
- **Optimistic updates** keep the UI feeling instant — they just need rollback (finding #4).
