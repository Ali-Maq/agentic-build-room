# Panel — Setup & Run

Live group AI interview room on SpacetimeDB. All shared state lives in DB tables;
every client renders purely from subscriptions. An AI runner drives the panel and
fills empty seats, so the demo works with a single human in the room.

```
panel/
  server/      SpacetimeDB module (tables + reducers) — the source of truth
  client/      Vite + React app — what judges see
  ai-runner/   Node client that calls the LLM and writes results back to the DB
```

## 0. Install the SpacetimeDB CLI (run in YOUR terminal — it needs a TTY)

```bash
curl -sSf https://install.spacetimedb.com | sh
# add to PATH for this shell (installer also updates your profile):
export PATH="$HOME/.local/bin:$PATH"
spacetime --version
spacetime login            # opens a browser
```

## 1. Start a local SpacetimeDB (fast dev loop, offline-safe)

```bash
# port 3000/3001 are commonly taken (Docker etc.) — this project uses 3456
spacetime start --listen-addr 127.0.0.1:3456   # leave running in its own terminal
```

## 2. Publish the module + generate client bindings

```bash
cd panel/server
npm install
spacetime publish panel --server http://127.0.0.1:3456 --yes
# regenerate the typed bindings the client & ai-runner import:
spacetime generate --lang typescript \
  --out-dir ../client/src/module_bindings \
  --module-path .
```

> Tip: `spacetime dev --client-lang typescript --module-bindings-path ../client/src/module_bindings`
> auto-rebuilds, republishes, and regenerates bindings on every save.

## 3. Run the React client

```bash
cd ../client
npm install
npm run dev                # http://localhost:5173
```

Open two browser windows → create a room in one, join it in the other. You should
see participants appear instantly in both. **(Milestone 1.)**

## 4. Run the AI runner

```bash
cd ../ai-runner
npm install
cp .env.example .env       # add your ANTHROPIC_API_KEY
npm start
```

The AI auto-joins any open room, asks the first question when the session starts,
scores each answer, and rotates the turn. Click **Start session** in the client.

## Deploying to Maincloud (required for the hosted submission)

The hackathon requires a **hosted, working** demo, so the module must run on
Maincloud (not just local). Redeem credit **LAUNCHPADNYC26** first
(spacetimedb.com/redeem; ~100k TeV covers hosting — note it does NOT cover LLM calls).

1. **Log in** (opens a browser): `spacetime login`
2. **Publish** to Maincloud under a **unique name** (`panel` may be taken on shared
   Maincloud):
   ```bash
   cd server
   spacetime publish panel-<yourhandle> --server maincloud --yes
   ```
3. **Regenerate** bindings against the published module (committed to the repo so it
   builds when cloned):
   ```bash
   spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path .
   ```
4. **Point the client at Maincloud:** in `client/src/config.ts` set
   `USE_MAINCLOUD = true` and `MODULE_NAME = 'panel-<yourhandle>'`.
5. **Host the client:** `cd client && npm run build`, deploy `dist/` to Vercel
   (project root = `client/`, `vercel.json` already provides the SPA rewrite).
   `USE_MAINCLOUD` is compiled into the bundle, so commit it before the build.
6. **Host the AI runner always-on** (it's a daemon — Vercel can't run it). Build the
   Docker image from the `panel/` root and deploy to Railway/Fly/Render:
   ```bash
   docker build -f ai-runner/Dockerfile -t panel-ai .   # run from panel/
   ```
   Set env on the host: `ANTHROPIC_API_KEY`, `SPACETIMEDB_URI=wss://maincloud.spacetimedb.com`,
   `MODULE_NAME=panel-<yourhandle>`. (For judging you can instead just run
   `npm start` in `ai-runner/` on your laptop pointed at Maincloud.)
7. **Verify** the live URL end-to-end before submitting: two windows, camera,
   create + join, Start session, confirm the AI asks/scores and video renders.

## Note on "AI on SpacetimeDB credits"

SpacetimeDB credits (TeV energy) pay for **database compute/hosting**, not LLM
inference — there is no LLM endpoint exposed through them. The AI runner therefore
calls the Anthropic API (`ANTHROPIC_API_KEY`). If event staff confirm an LLM proxy,
point `anthropic` at it via `baseURL` in `ai-runner.ts` — a one-line change.
