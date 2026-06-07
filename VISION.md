# Cartographer — a live, narrated architecture map for AI-agent coding

> **Git shows you diffs. Cartographer shows you what your *system* became.**
> As Claude Code / Codex edit a codebase, the architecture (high-level + low-level) redraws itself in real time —
> you see which agent or teammate is touching which part, and a voice narrates each structural change.

This is the natural next product after **Build Room**: the same proven idea — *agent activity as live SpacetimeDB
state* — pointed at a sharper, felt pain.

---

## The problem (felt, not hypothetical)
- Agentic coding is **opaque at the system level.** You get a wall of diffs; you don't get "the auth module now
  depends on the queue," or "a new service appeared."
- With **multiple agents (and humans) editing in parallel**, changes interleave and become impossible to audit.
- **Understanding is the premise of reliability.** You can't trust or review what you can't *see the shape of.*
- Today there's no live, shared, architecture-level view of what your AI is doing to your codebase.

## The product (what you experience)
- Open Cartographer next to Claude Code. A **diagram of your system** sits there and **animates as the agent
  works** — nodes (modules/services/files) and edges (imports/calls/data-flow) appear, move, and re-link.
- Each change pulses on the node it touched; **multiple sessions/agents show as different colors** on the same
  shared map.
- A **voice narrates**: "Created `grader.ts`; it now calls the sandbox runner and writes a `verdict` row."
- Scrub the session like a timeline, or **export a Remotion video** of the architecture evolving — perfect for
  PR reviews, standups, and onboarding.

## The unlock (the data source already exists)
You do **not** need to intercept anything live or build a special API:
- **Claude Code persists every session as JSONL** at `~/.claude/projects/<sanitized-cwd>/*.jsonl` — every message
  and **every tool call** (`Edit`/`Write`/`Bash`) with inputs + outputs. Codex keeps comparable session logs.
- **Claude Code hooks** (`PostToolUse`) fire after each edit → a zero-polling live trigger.
- Plus **`git diff`** after each step. Together that's the complete, parseable event stream of "what the agent did."

## Architecture
```
Claude Code hook / JSONL tail  +  git diff           ← the change event stream
        │
        ▼
Extractor  =  tree-sitter / ts-morph (accurate import & call edges, LLD)
              + LLM (HLD grouping into services/domains, + a "what changed" delta)
        │
        ▼
SpacetimeDB  =  live, multiplayer graph state
   tables: node, edge, change_event, session, cursor (who's editing what)
   reducers: upsertNode, upsertEdge, recordChange, … (the only write path)
        │
        ▼
Web client (React Flow + elkjs/dagre auto-layout)  → diagram animates on subscription updates
Remotion  → renders a session "architecture-evolving" video
Azure gpt-4o-mini-tts  → narrates each change_event
```

**Rendering choices (accuracy matters):**
- **Live interactive graph:** React Flow + **elkjs/dagre** layout. Edges derived from real code via
  **tree-sitter / ts-morph** = accurate LLD; LLM clusters them into HLD domains.
- **Fast LLM→diagram for HLD:** **Mermaid** (model emits graph text, auto-layout).
- **Video:** Remotion replays `change_event` rows as an animated, narrated diagram.
- ASCII = stylistic flavor only; not the primary (poor for accurate, dense graphs).

## Why SpacetimeDB is the right spine
- The graph is **continuously mutating shared state with many concurrent writers** (agents + humans) and many
  watchers — exactly its sweet spot. Every node/edge/change is a row; the diagram is "just" a subscription.
- Multiplayer for free: a whole team's agent sessions feed **one shared, live architecture map.**
- The same "the database is the live medium" thesis Build Room proved — now with obvious utility.

## What transfers from Build Room (already built & deployed)
- **SpacetimeDB live-state layer** + the deterministic-reducers/subscriptions pattern.
- **The runner-as-client pattern** → becomes the *ingestor* (tails JSONL + git instead of writing app files).
- **Remotion** project → re-aimed at rendering the evolving diagram.
- **Azure `gpt-4o-mini-tts`** narration (already wired in the provider layer).
- The build room's live **activity stream** is literally a baby version of this.

## MVP milestones (buildable path)
1. **Ingestor:** a `PostToolUse` hook (or JSONL tailer) that captures each edit + `git diff` and posts a
   `change_event` to SpacetimeDB.
2. **Extractor v0:** ts-morph/tree-sitter builds the import graph for a JS/TS repo → `node`/`edge` rows.
3. **Live web map:** React Flow renders the graph from subscriptions; nodes pulse on change.
4. **Narration:** LLM summarizes each change → Azure TTS speaks it.
5. **Multiplayer cursors:** color per session/agent; show "who's editing what."
6. **Remotion replay:** render a session as a narrated architecture video.
7. Language packs beyond TS (Python, Rust) via tree-sitter grammars.

## Positioning
Think **CodeSee / Sourcegraph code maps**, but **real-time, agent-aware, multiplayer, and narrated** — built for
the era where your codebase is edited by a swarm of agents you need to *understand*, not just merge.

---
*Status: vision/roadmap. The runtime spine (SpacetimeDB + Remotion + Azure TTS + the runner→ingestor pattern) is
already proven in this repo's Build Room.*
