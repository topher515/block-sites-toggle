#!/usr/bin/env bash
# Deploys the sync worker and writes ../sync.local.json ({ url, token }).
# Idempotent: re-running reuses the database and token.
#
# Needs a one-time `npx wrangler login` (opens a browser).
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")"

# Wrangler needs Node 22+.
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 22 ]; then
  if command -v fnm >/dev/null && [ -z "${BST_REEXEC:-}" ]; then
    exec env BST_REEXEC=1 fnm exec --using=22 "$SELF" "$@"
  fi
  echo "Node 22+ required (found $(node -v 2>/dev/null || echo none))." >&2
  exit 1
fi

[ -d node_modules ] || npm install --silent
W="npx --no-install wrangler"
SYNC_FILE=../sync.local.json
DB_NAME=block-sites-sync

if ! $W whoami 2>&1 | grep -q 'associated with the email'; then
  echo "Not logged in to Cloudflare. Run this once, then re-run deploy:" >&2
  echo "  cd $(pwd) && npx wrangler login" >&2
  exit 1
fi

# 1. D1 database
if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then
  id=$($W d1 list --json 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const db=JSON.parse(s).find(d=>d.name===process.argv[1]); console.log(db?db.uuid:"")})' "$DB_NAME")
  if [ -z "$id" ]; then
    echo "Creating D1 database ${DB_NAME}…"
    $W d1 create "$DB_NAME" >/dev/null
    id=$($W d1 list --json | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        console.log(JSON.parse(s).find(d=>d.name===process.argv[1]).uuid)})' "$DB_NAME")
  fi
  sed -i.bak "s/00000000-0000-0000-0000-000000000000/$id/" wrangler.toml && rm wrangler.toml.bak
  echo "Using D1 database $id"
fi

echo "Applying migrations…"
$W d1 migrations apply "$DB_NAME" --remote

# 2. Worker
echo "Deploying worker…"
# Retry: a brand-new Worker's workers.dev setup sometimes fails right after upload.
for attempt in 1 2 3 4; do
  if out=$($W deploy 2>&1); then break; fi
  if [ "$attempt" = 4 ]; then echo "$out" >&2; exit 1; fi
  echo "Deploy failed (attempt $attempt), retrying in 20s…"
  sleep 20
done
echo "$out" | grep -v '^\s*$' | tail -5
url=$(echo "$out" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
if [ -z "$url" ]; then
  echo "Could not find the workers.dev URL in deploy output." >&2
  exit 1
fi

# 3. Token (reuse the existing one so other devices keep working)
token=""
if [ -f "$SYNC_FILE" ]; then
  token=$(node -p 'require(process.argv[1]).token || ""' "$(cd .. && pwd)/sync.local.json")
fi
if [ -z "$token" ]; then
  token=$(openssl rand -hex 32)
fi
printf '%s' "$token" | $W secret put SYNC_TOKEN >/dev/null

printf '{\n  "url": "%s",\n  "token": "%s"\n}\n' "$url" "$token" > "$SYNC_FILE"
chmod 600 "$SYNC_FILE"
echo "Wrote $(cd .. && pwd)/sync.local.json"

# 4. Check it (secrets can take a few seconds to reach the edge)
for i in 1 2 3 4 5 6; do
  if node smoke-test.mjs "$url" "$token" --read-only >/dev/null 2>&1; then
    echo "Smoke test passed against $url"
    exit 0
  fi
  sleep 5
done
node smoke-test.mjs "$url" "$token" --read-only
