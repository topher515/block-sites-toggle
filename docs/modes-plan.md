# Plan: Modes (focus, fitness, flashcards) and sync

Status (2026-10-12): phases 0–4 are built and tested. Sync uses the Cloudflare Worker (decided after this plan was written, which originally proposed a GitHub repo). Phase 5 extras are not built yet. Code is the source of truth. This doc is the rationale.

## The idea

Today a blocked site redirects to a static "Stay focused" page. Change that page into a small **activity host**. It shows whichever **mode** is active, and the mode gives you something useful to do while you wait (for an agent, a build, etc.):

- **Focus**: the current page, plus "you've been bounced 9 times today (reddit ×6, HN ×3)".
- **Fitness**: "Do 10 push-ups." Tap to log them. Shows totals for today, the last 7 days, and ever.
- **Flashcards**: one card per visit, such as an African country highlighted on a map, answered by multiple choice, and by typing once you know it.

Modes are plug-in modules. A new one is a folder with one file that follows a small contract, so an agent can write it from a one-line request.

Two separate settings, both in the popup:

| Setting | Question it answers | Exists today? |
|---|---|---|
| Block sections (`life`, `work`) | *Which* sites are blocked | Yes |
| Mode | *What you see* instead | New |

## 1. Mode switching

- The popup shows the current mode as read-only text: `Mode: Fitness 💪 · change…`.
- "change…" opens the **options page** (`options.html`), which lists the modes with their settings. This makes switching a deliberate two-step action without hiding it.
- Later idea: a **Mix** mode that picks a random enabled mode on each visit, so the redirect page doesn't go stale.

## 2. Module contract

```js
// src/modules/fitness/index.js
export default {
  id: 'fitness',                 // stable; used as the event namespace
  title: 'Fitness 💪',
  description: 'Log push-ups and pull-ups instead of scrolling.',
  defaultSettings: {
    exercises: [
      { id: 'pushup', label: 'Push-ups', step: 1 },
      { id: 'pullup', label: 'Pull-ups', step: 1 },
    ],
  },

  // Required. Draw into `el` on the blocked page. May return a cleanup fn.
  mount(el, ctx) {},

  // Optional. Settings UI on the options page (otherwise a JSON editor is shown).
  mountSettings(el, ctx) {},

  // Optional. One line for the popup, e.g. "140 push-ups this week".
  summary(ctx) {},
};
```

`ctx`, the only API a module gets:

| Member | Purpose |
|---|---|
| `ctx.settings` / `ctx.saveSettings(patch)` | This module's settings (merged over `defaultSettings`) |
| `ctx.log(type, data)` | Append an event, auto-namespaced to the module |
| `ctx.events({ type?, since? })` | Read this module's events (all devices, once synced) |
| `ctx.stats.count(events, { since })` | Helpers for today / 7 days / ever |
| `ctx.blocked` | `{ url, host }` of the page you tried to open |
| `ctx.now()` | Clock (injectable for tests) |

Rules for module authors (written into `src/modules/AGENTS.md`):

- No remote code: MV3 forbids it. Assets live in the module folder.
- Store **events, not counters**. Derive every number from the event log.
- Keep pure logic (scoring, scheduling) in its own file with `node --test` tests.
- `make new-module NAME=foo` copies `src/modules/_template/`.

**Registry**: `build.js` scans `src/modules/*/index.js`, generates `modules/registry.js`, and copies the folders into `build/`. You add a module by dropping in a folder, with no central list to edit.

## 3. Data model: an append-only event log

Everything a module records is an event:

```json
{ "id": "01J9Z…(ulid)", "ts": 1760300000000, "device": "mbp-home-3f2a",
  "module": "fitness", "type": "reps", "data": { "exercise": "pushup", "n": 10 } }
```

Other examples:
- `core / blocked_visit { host }`: drives Focus mode's bounce counts.
- `flashcards / review { deck, card, result: "right"|"wrong"|"dunno", how: "mc"|"typed" }`.
- `<any> / undo { target: <event id> }`: corrects a mistaken tap without mutating history.

Why this shape:
- **Sync with no merge conflicts.** The log is a grow-only set keyed by id, so merging two devices is a union.
- **Derived state can't drift.** Totals and even spaced-repetition schedules are recomputed by replaying events. If the logic changes, history is reinterpreted instead of migrated.
- **Small.** About 120 bytes per event. Even 100 events a day is around 4 MB a year.

Settings are separate: one small document per module, last-write-wins by `updatedAt`.

Local storage is IndexedDB (or `chrome.storage.local` with `unlimitedStorage` to begin with), behind `core/store.js`, so that choice can change later.

## 4. Modules

### Focus
The current page, plus today's bounce count by host from `blocked_visit` events. This needs the blocked URL (see §6).

### Fitness
- A big `+1` button per exercise (step set in settings), plus a custom amount and undo.
- Three numbers per exercise: **today**, **last 7 days**, **ever**. Optional daily goal with a progress bar, and optionally a streak.
- Counting is self-reported taps. Camera rep counting (MediaPipe pose, run locally) is possible later but heavy, so it isn't in v1.

### Flashcards: one engine, many decks
This settles the "one module per deck?" question. Build **one engine** and treat **decks as data**, each with an optional custom renderer. Each deck shows up as its own entry in the mode list ("Flashcards: Africa", "Flashcards: Spanish"), so from your side they feel like separate modules. They share scheduling, progression, and stats.

```
src/modules/flashcards/
  index.js          engine: picks card, runs quiz, logs reviews
  srs.js            Leitner scheduling (pure, tested)
  match.js          typed-answer matching (accents, aliases, 1-typo tolerance)
  decks/
    africa/
      deck.json     [{ id: "KE", answer: "Kenya", aliases: [], group: "East" }, …]
      map.svg       one <path id="KE"> per country
      render.js     highlights the card's country on the map
    spanish-verbs/
      deck.json     text-only decks need no render.js
```

**Progression** (per card, derived from `review` events):
- Leitner boxes 0–4. Correct moves a card up a box, wrong drops it to 0. Higher boxes come due less often.
- Boxes 0–1 are **multiple choice** (4 options). Boxes 2+ are **typed**. This is your "upgrade to typing", done per card, so you type Kenya long before you type Eswatini.
- Every card has an **"I don't know"** button, in both multiple-choice and typed modes. It reveals the answer, sends the card back to box 0 like a wrong answer, and is logged as `result: "dunno"`, separately from a wrong guess, so stats can tell "never seen it" apart from "confused it with Burundi".
- Distractors come from the same region (`group`), so a wrong answer is plausible: Rwanda vs Burundi, not Rwanda vs Morocco.
- Typed answers are forgiving: case- and accent-insensitive, aliases ("Ivory Coast" = "Côte d'Ivoire", "DRC"), Levenshtein ≤ 1.
- After answering, it shows the right answer on the map for a second, then offers "another?". One card per visit is the default, so a quick check costs about 10 seconds.

**Africa map asset**: generate it once from **Natural Earth** (public domain) using mapshaper or d3-geo, and commit `map.svg` with ISO-coded path ids. Small island states (Cabo Verde, Comoros, Mauritius, São Tomé, Seychelles) get circle markers or they're invisible. Western Sahara: decide whether to include it or leave it out. I'd draw it but not quiz it.

## 5. Sync between your two computers

Every action writes an event **locally** right away (IndexedDB, instant, works offline). Sync is a separate, batched step: the service worker wakes on a `chrome.alarms` timer every 15 min (and on **Sync now**), pushes any unsent events in batches, then pulls everything newer than its cursor. One tap does **not** mean one network call.

Expected volume: a busy day is maybe 30–60 events (~5 KB).

**Backend: Cloudflare Worker + D1** (`worker/`). We considered `chrome.storage.sync` (too small for the log, needs the same Google account) and a GitHub repo as storage (no server, but it uses git as a database). The worker is the "real database" version and is also the multi-user path.

```
POST /v1/events     { events }            INSERT OR IGNORE by (user_id, id), so retries are safe
GET  /v1/events?after=<seq>&limit=<n>     server-assigned seq is the cursor, so clock skew doesn't matter
GET  /v1/settings / PUT /v1/settings      last-write-wins by updatedAt, enforced in SQL
```

Auth is one bearer token (`SYNC_TOKEN` secret). Rows carry a `user_id` (always `'me'` today), so per-user tokens can be added later without a migration.

## 6. Core changes needed first

1. **Pass the blocked URL to the page.** Static rules can't build an extension URL, so move to **dynamic DNR rules** that the service worker registers from `chrome.runtime.getURL('blocked.html')` with `regexSubstitution: …?from=\\0`.
2. **Runtime config.** With dynamic rules, the block lists can live in storage and be edited on the options page. `config.json` becomes just the defaults on first run, and nobody needs to rebuild to change a site list. This is the prerequisite for anyone else using the extension.
3. Add a background service worker (rules, sync alarm, `blocked_visit` logging).
4. Change the popup and blocked page to ES modules (`<script type="module">`). Keep plain JS with no framework and no bundler, matching the repo today.

## 7. If other people want it

- **Programmers (near term):** fork, `make build`, load unpacked, `make worker-deploy` into their own free Cloudflare account. Ten minutes, and each user's data is in their own D1. New modules are a PR or a local agent request, and the module contract plus `AGENTS.md` is what makes that easy.
- **Chrome Web Store (later):** requires §6.2 (no build-time config). MV3 bans remote code, so **modules ship with releases**. But **decks are data**, so a deck could be fetched from a URL (a "deck gallery"). That's a good extension point for non-programmers.
- **Hosted sync (much later):** add sign-in and map tokens to `user_id` in the same worker. The schema already has the column. At about 4 MB per user per year, D1 is cheap.

## 8. Build order

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Core: service worker, dynamic rules with `?from=`, event store, module host, registry generation, options page, **Focus** mode | Today's behavior and bounce counts work, and you can switch modes |
| 1 | **Fitness** | Push-ups and pull-ups logged, today/7d/ever shown, undo works |
| 2 | **Flashcards** engine + **Africa** deck, multiple choice | Map highlights, regional distractors, reviews logged |
| 3 | Typed answers + Leitner progression | Cards graduate to typing |
| 4 | **Cloudflare Worker sync** | Push-ups on one machine show up on the other |
| 5 | Mix mode, streaks, camera rep counting | Not built yet (`make new-module` and popup summaries are done) |

Each phase is independently useful. Phase 0 is the only large refactor, and it's the part that makes everything after it a "drop in a folder" job.

## Open questions

1. **Unlocking as a reward** ("10 push-ups = 5 min of reddit"): not built. We're leaning away from it, because the point is to replace the habit and not bargain with it, but it isn't ruled out. If it's ever added, it should be an opt-in setting on a mode.
2. Should Fitness stay tap-only for now, with camera counting as a someday item?
