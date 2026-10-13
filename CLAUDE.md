# block-sites-toggle

Unpacked Chrome MV3 extension (no Web Store build) plus a Cloudflare Worker for sync. Plain JS ES modules, no bundler, no framework.

- New modes / flashcard decks: follow `src/modules/AGENTS.md`.
- `make build` then reload the extension at chrome://extensions. `make test` for unit tests.
- Worker: `worker/` (Node 22+ for wrangler; `worker/.node-version`). `make worker-dev` / `make worker-test` locally, `make worker-deploy` to Cloudflare.
- Design and rationale: `docs/modes-plan.md`.
