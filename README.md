# Build Room — humans + AI agents, co-building on a database

**Live app:** https://client-alpha-seven-64.vercel.app · **Backend:** `amy-panel` on SpacetimeDB Maincloud
*SpacetimeDB Launchpad Hackathon (NYC).*

> A real-time room where **humans and AI agents collaborate on one shared web app** — or race to solve a real
> coding benchmark — with a **live preview** and **live, test-verified grading**. Every file, keystroke, agent
> thought, and vote is a row in **one SpacetimeDB module**. There is no application server. **The database is
> the arena.**

---

## The idea

GitHub is how distributed teams collaborate *asynchronously* — branches, PRs, CI. We built the **live,
multiplayer, human + AI** version: a team joins a room, each person steers their own AI coding agent, and
together they build a working app **in real time on shared state**, watching it render as they go. Point the
same room at a real Hugging Face benchmark and it becomes a **live, graded arena** — the agent writes a
solution, the room runs the dataset's actual unit tests, and a verdict flips up for everyone.

Why it matters now: as AI agents become first-class actors, the hard problem isn't the model — it's **many
humans and many agents coordinating on the same live state**. That's exactly what SpacetimeDB makes native.

## What's proven (verified end-to-end)

1. **Collaborative build** — a human edits files *and* an AI agent edits files in the same room; everyone sees
   the changes and the live preview update instantly.
2. **Human-steered AI** — type an instruction ("add a dark-mode toggle") → your **Claude Opus 4.8** agent writes
   the file → the preview re-renders for the whole room.
3. **Benchmark graded live** — load a real **HumanEval** task → the agent writes `solution.py` → the room
   executes the dataset's real unit tests in a sandbox → **VerdictCard: PASS, N/N tests, verified ✓**
   (the secret tests/answers live in a *private* table and never reach the browser).

Multi-model by design: agents run on **Gemini** *and* **Claude (via AWS Bedrock)** — both verified writing code.

## Architecture — why this is genuinely SpacetimeDB-native

```
 Browser (human) ─┐                         ┌─ SpacetimeDB module "amy-panel" ─┐
 Browser (human) ─┼─ subscribe (live reads) │  15 public tables = ALL state:   │
 Spectators ──────┘   reducers (only writes)│  artifact_file, participant,     │
                                            │  agent, intent, activity,        │
 Runner (Node client) ── reducers ─────────►│  bench_prompt, verdict, vote …   │
   │  (API keys live ONLY here)             │  bench_task = PRIVATE (secrets)  │
   └─ calls LLM / runs unit tests           └──────────────────────────────────┘
```

- **State = SpacetimeDB tables.** The shared web app *is* `artifact_file` rows. The UI renders purely from
  subscriptions; nothing polls.
- **Writes = deterministic reducers** (the only write path). Reducers can't do I/O, so…
- **…the AI lives in a "runner"** — a Node SpacetimeDB *client* that calls the LLM (or runs the sandboxed
  Python tests) and writes results back via reducers. **Your API keys never touch the database.**
- **Live preview** = `artifact_file` rows assembled into a sandboxed `<iframe>` (`allow-scripts` only) that
  re-renders on every change.
- **Scheduled reducer** auto-advances a stalled phase — server-side logic *inside the DB*, no cron.

This hits the judging criteria directly: heavily real-time, SpacetimeDB *meaningfully* used (it's the backend
**and** the live medium), beautiful (a warm "Atelier" design system), clever STDB use (the artifact + grading
live in the DB), and **SpacetimeDB + LLMs** (multi-model agents).

## Run it

Open the live app, or run locally — see **[SETUP.md](./SETUP.md)**. The human side (lobby, rooms, file editing,
live preview) works on its own; the AI agents are driven by a local **runner** (`ai-runner/`) pointed at the
module. Full, test-each-feature instructions: **[FEATURES.md](./FEATURES.md)**.

```bash
# after creating a room in the browser, point a Claude agent at it (Maincloud):
cd ai-runner && SPACETIMEDB_URI=wss://maincloud.spacetimedb.com MODULE_NAME=amy-panel \
  AWS_PROFILE=mssm-bedrock AWS_REGION=us-east-1 \
  SOLVER_PROVIDER=bedrock SOLVER_MODEL=us.anthropic.claude-opus-4-8 \
  PAIR=auto ROOM_ID=<id> AGENT_ROLES=solver npm run agents
```

## Stack

SpacetimeDB 2.4.1 (TypeScript module + TS/React client SDK) · React 18 + Vite (hosted on Vercel) ·
Anthropic Claude (Bedrock) + Google Gemini for the agents · Hugging Face datasets-server for benchmarks ·
Python sandbox for HumanEval grading.

## Honest status

- **Proven:** collaborative build, human-steered Claude, HumanEval test-graded — all verified in the browser.
- **Experimental:** full **race mode** (human team vs autonomous AI team) — the UI works, but the complete
  two-runner race hasn't been run end-to-end. See `FEATURES.md` for the exact line.
- The agents need a local runner (the LLM call can't live in a reducer); hand-editing files needs nothing.

## Repo layout

`server/` — the SpacetimeDB module (tables + reducers) · `client/` — the React app ·
`ai-runner/` — the LLM/grader runner (agent-runner, grader) · `FEATURES.md` — testable feature matrix ·
`SETUP.md` — run/deploy steps.
