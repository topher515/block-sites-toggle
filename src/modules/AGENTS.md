# Writing a mode

A **mode** is what the blocked page shows instead of the site. Each folder here with an `index.js` is registered automatically by `build.js`. Folders starting with `_` are skipped.

Start with `make new-module NAME=<dir> TITLE="<Title>"`, which copies `_template/`.

## Contract

`index.js` default-exports a mode object, or an array of them (see `flashcards/`, one mode per deck):

```js
export default {
  id: 'fitness',            // stable forever: events and settings are keyed by it
  title: 'Fitness 💪',
  description: 'One line for the options page.',
  order: 10,                // position in the mode list (focus is 0)
  category: 'physical',     // optional: 'physical' | 'memorization' (core/modes.js CATEGORIES), for the popup flip
  aliases: ['old-id'],      // optional: ids this mode used to have, so a saved choice still finds it
  defaultSettings: { ... }, // merged under the user's saved settings

  async mount(el, ctx) {},          // required: render into el on the blocked page
  async mountSettings(el, ctx) {},  // optional: custom settings UI (default: JSON editor)
  async summary(ctx) {},            // optional: one line for the toolbar popup
};
```

## `ctx`

| Member | Use |
|---|---|
| `ctx.settings` | Merged settings for this mode |
| `ctx.saveSettings(patch)` / `ctx.replaceSettings(obj)` | Persist settings (synced, last write wins) |
| `ctx.log(type, data)` | Append an event; returns it (with `id`) |
| `ctx.undo(eventId)` | Append an `undo` event that cancels an earlier one |
| `ctx.events({ type, since })` | This mode's events from all devices, undo applied, oldest first |
| `ctx.eventsOf(modeId)` | Another namespace's events (e.g. `'core'` for `blocked_visit`) |
| `ctx.logIn(modeId, type, data)` | Append to another namespace (Memorization logs each deck in its own) |
| `ctx.stats` | `tally(events, valueFn, now)` → `{ today, week, ever }`, `startOfDay`, `countBy`, `effective` |
| `ctx.blocked` | `{ url, host }` of the blocked page, or `null` |
| `ctx.assetUrl(rel)` | URL of a file in this mode's folder (CSS, JSON, SVG) |
| `ctx.now()` | Current time |

Helpers: `../../core/dom.js` has `h(tag, attrs, ...children)`, `useCss(url)` and `fmt(n)`.

## Rules

- **Store events, not counters.** Every number on screen is derived from `ctx.events()`. That is what makes sync between computers conflict-free. Never mutate or delete events; use `ctx.undo`.
- Keep `data` small (under 8 KB), and keep event `type` names stable. Old events are reinterpreted by new code.
- **No remote code.** MV3 bans it. Ship assets in the folder and load them with `ctx.assetUrl`.
- Use the CSS tokens from `src/ui.css` (`--panel`, `--accent`, `--good`, `--bad`, `--muted`, ...) so light and dark mode both work.
- Build DOM with `h()`, not `innerHTML`, for anything containing user or deck text.
- Put pure logic (scoring, scheduling, matching) in its own file and test it in `test/*.test.mjs` (`make test`).

## Flashcard decks

A new deck is not a new module. All decks feed the one **Memorization** mode (`flashcards/`), which keeps a single spaced-repetition queue across the decks turned on in its settings. Each deck's answers are logged in its own namespace, `flashcards-<deck id>`.

Add `flashcards/decks/<id>/deck.json` (and optionally `render.js` for a custom picture), then add an entry to `flashcards/decks.js`. See `decks/africa/` or `decks/states/` for map decks (both use `flashcards/map.js`). A deck built from settings instead of a file (the phone number, which must never be committed: the repo is public) uses `cards(settings)`; see the `phone` entry.
