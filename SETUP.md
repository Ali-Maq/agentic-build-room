# Build Room — Setup & Run

A live multiplayer software arena on SpacetimeDB. Humans and AI agents collaborate on one shared web app — or
solve a coding benchmark — with a live preview and live grading. **All shared state lives in SpacetimeDB tables;
clients render purely from subscriptions; reducers are the only write path.** The AI lives in a *runner* (a Node
SpacetimeDB client) because reducers can't make network calls — so API keys never touch the database.

```
panel/
  server/      SpacetimeDB module (tables + reducers) — the source of truth
  client/      Vite + React app — the hosted UI
  ai-runner/   Node client: agent-runner (LLM steering) + grader (HumanEval sandbox)
  video/       Remotion submission video
```

**Live app:** https://client-alpha-seven-64.vercel.app · **Module:** `amy-panel` on Maincloud.

---

## 0. Install the SpacetimeDB CLI (run in your terminal — needs a TTY)

```bash
curl -sSf https://install.spacetimedb.com | sh
export PATH="$HOME/.local/bin:$PATH"
spacetime --version
spacetime login          # opens a browser; pick the account with your TeV credits
```

## 1. Local SpacetimeDB (fast dev loop)

```bash
# 3000/3001 are often taken (Docker etc.) — this project uses 3456
spacetime start --listen-addr 127.0.0.1:3456    # leave running
```

## 2. Publish the module + generate bindings

```bash
cd panel/server && npm install
spacetime publish amy-panel --server http://127.0.0.1:3456 --yes
spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path .
```

For local dev set `USE_MAINCLOUD = false` in `client/src/config.ts` (it ships `true` for the hosted build).

## 3. Run the client

```bash
cd ../client && npm install
npm run dev              # http://localhost:5173
```

Pick a **mode** in the lobby — **Free Build**, **Benchmark**, or **Race** — enter a name, create & join. Open a
second window to prove multiplayer (any number of humans can share a room). You can hand-edit files and **Save**
with no AI at all; the live preview updates for everyone.

## 4. Run the AI runner

API keys live only here. **Gemini works out of the box** (`GEMINI_API_KEY`); **Claude via AWS Bedrock** is the
strongest coder (VPN-only). `ROOM_ID` comes from the room you created:

```bash
cd ../ai-runner && npm install
spacetime sql amy-panel --server http://127.0.0.1:3456 "SELECT id, topic, mode FROM room"   # find ROOM_ID
```

**Human-steered build** (your IntentBar unlocks; the agent auto-pairs to you):

```bash
PAIR=auto ROOM_ID=<id> AGENT_ROLES=solver npm run agents
# Claude instead of Gemini:
AWS_PROFILE=mssm-bedrock AWS_REGION=us-east-1 \
SOLVER_PROVIDER=bedrock SOLVER_MODEL=us.anthropic.claude-opus-4-8 \
PAIR=auto ROOM_ID=<id> AGENT_ROLES=solver npm run agents
```

**Autonomous build** (agents build with no human): add `AUTONOMOUS=true`, drop `PAIR=auto`.

**Benchmark (HumanEval, graded by real unit tests)** — two terminals:

```bash
# 1) grader: loads the task + runs the dataset's unit tests in a sandbox (needs python3)
BENCH_ROW_INDEX=0 ROOM_ID=<id> npm run grader
# 2) solver: writes solution.py
AWS_PROFILE=mssm-bedrock AWS_REGION=us-east-1 SOLVER_PROVIDER=bedrock \
SOLVER_MODEL=us.anthropic.claude-opus-4-8 ROOM_ID=<id> AUTONOMOUS=true AGENT_ROLES=solver npm run agents
```

Then click **Finish** in the room → the VerdictCard flips to **PASS, N/N tests, verified**.

## 5. Deploy to Maincloud (the hosted submission)

```bash
# module
cd panel/server && spacetime publish amy-panel --server maincloud --yes
# client (config.ts already has USE_MAINCLOUD=true, MODULE_NAME='amy-panel')
cd ../client && npm run build && npx vercel --prod
```

Run the runner on your laptop pointed at Maincloud (Bedrock/Azure are VPN-only; Gemini works anywhere):

```bash
SPACETIMEDB_URI=wss://maincloud.spacetimedb.com MODULE_NAME=amy-panel \
AWS_PROFILE=mssm-bedrock AWS_REGION=us-east-1 SOLVER_PROVIDER=bedrock \
SOLVER_MODEL=us.anthropic.claude-opus-4-8 PAIR=auto ROOM_ID=<id> AGENT_ROLES=solver npm run agents
```

## Notes

- **LLM keys ≠ SpacetimeDB credits.** TeV pays for database compute/hosting only; the runner calls Gemini / Claude
  (Bedrock) directly. Keys live in the runner's env, never in the DB or the browser.
- **Providers** are pluggable in `ai-runner/llm.ts` (Gemini, Azure GPT-5.4, OpenRouter, Bedrock) via per-role
  `*_PROVIDER` / `*_MODEL` env vars.
- **Feature-by-feature test checklist:** see [FEATURES.md](./FEATURES.md). Race mode's UI works but the full
  two-team race is unproven end-to-end.
