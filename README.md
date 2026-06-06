# Panel — live group interviews, running entirely inside a database

**Panel** is a real-time group interview room. An **AI panel** runs the session,
multiple candidates join with **live video**, everyone sees the same shared state,
and a human mentor can drop in to co-interview. There is **no application server**
— every participant (human candidates, the human mentor, and the AI panelist) is
just a client subscribing to the same **SpacetimeDB** database. The database *is*
the server.

> **The one-line pitch:** *"This entire experience — presence, turn-taking, the
> interview transcript, the AI's questions and scores, and the live video — is one
> SpacetimeDB module. No web server, no media server, no WebRTC. Humans and the AI
> are symmetric subscribers to the same tables."*

---

## Why this is a real SpacetimeDB app, not a CRUD app with a DB bolted on

| Concern | How Panel does it |
|---|---|
| Shared state | 7 public SpacetimeDB tables are the **single source of truth** |
| Writes | The **only** write path is reducers — clients never mutate tables directly |
| Reads | The whole UI renders **purely from subscriptions** (`useTable`) |
| Presence / turns | `participant.online` + `room.currentTurn`, all in the DB |
| **Live video** | webcam → JPEG bytes → `pushFrame` reducer → `video_frame` table → subscribers render. **Video is relayed through the database** — no media server, no WebRTC |
| Time-based logic | a **scheduled reducer** (`onPhaseTick`) auto-advances stalled turns server-side — no external cron |
| AI | the AI runner is **just another SpacetimeDB client**; it calls the LLM *outside* the (deterministic) reducers and writes results back via reducers |

This directly targets the judging criteria: **heavily real-time**, **clever/novel
use of SpacetimeDB** (video-over-DB + scheduled reducers), and **SpacetimeDB + LLMs**.

## Architecture

```
┌────────────┐   subscribe (live)   ┌──────────────────────────┐
│  Browser   │◄────────────────────►│                          │
│ (candidate)│   reducers (writes)  │      SpacetimeDB         │
└────────────┘                      │     module: "panel"      │
┌────────────┐                      │                          │
│  Browser   │◄────────────────────►│  tables: room,           │
│  (mentor)  │                      │  participant, question,  │
└────────────┘                      │  answer, feedback,       │
┌────────────┐   pushFrame /        │  presence, video_frame   │
│ AI runner  │◄──postQuestion──────►│  + scheduled onPhaseTick │
│ (Node)     │   submitFeedback     │                          │
└─────┬──────┘                      └──────────────────────────┘
      │ LLM call (outside reducers)
      ▼
  Anthropic API
```

- **`server/`** — the SpacetimeDB TypeScript module (tables + reducers). The source of truth.
- **`client/`** — Vite + React app. Zoom-style gallery, renders entirely from subscriptions.
- **`ai-runner/`** — a Node SpacetimeDB client that drives the AI panel (asks questions, scores answers) by calling the Anthropic API and writing back through reducers.

## Live video over a database

`video_frame` holds **one row per participant**, updated in place each frame.
The publisher (`client/src/useWebcamPublish.ts`) is energy-conscious:
publish-on-change (skips near-identical frames), pause-when-hidden, stops when the
camera is off, modest 320×240 @ 8fps. Clients use a **room-scoped subscription**
(`video_frame WHERE roomId = mine`) so no client ever receives another room's frames.

> Honest framing for the demo: we are **not** claiming this beats WebRTC on latency
> or quality. We are demonstrating that **one table + one reducer replaces an entire
> signaling + media stack**, sharing the exact same transport as presence, chat, and AI.

## Run it

See **[SETUP.md](./SETUP.md)** for local dev and the Maincloud deploy steps.

Quick start (local):
```bash
spacetime start --listen-addr 127.0.0.1:3456     # terminal 1
cd server && npm install && spacetime publish panel --server http://127.0.0.1:3456 --yes
spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path .
cd ../client && npm install && npm run dev        # http://localhost:5173
cd ../ai-runner && npm install && cp .env.example .env  # add ANTHROPIC_API_KEY
npm start
```

Open two browser windows, allow the camera, create + join a room, click **Start**.

## Tech

SpacetimeDB 2.4.1 (TypeScript module + TS client SDK) · React 18 + Vite ·
Anthropic API for the AI interviewer/evaluator · Playwright for E2E.

## Status / notes

- **Verified end-to-end with Playwright:** two browser identities join one room and
  each receives the other's webcam frames *relayed through SpacetimeDB* (0 console errors).
- The SpacetimeDB connection is config-only between local and Maincloud
  (`client/src/config.ts` `USE_MAINCLOUD`, `ai-runner` `SPACETIMEDB_URI`).
- Energy (TeV) note: video is the dominant DB workload; throttling + room-scoped
  subscriptions keep it bounded. Measure on Maincloud before relying on full settings.
