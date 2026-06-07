# Build Room (`amy-panel`) — what it is & how to test every feature

> Honest status doc. Every row says **what works, what it needs, and how to verify it yourself.**
> Nothing here is a promise I can't back up — items that were never run end-to-end are marked **🟡 UNPROVEN**.

---

## 1. What this is (the architecture story — use this for the video)

**The Live Agentic Build Room.** A real-time room where **humans and AI agents collaborate on ONE shared web app** (or solve a coding benchmark), with a **live preview** and **live grading**. The entire app — every file, every keystroke, every agent thought, every vote — is **rows in one SpacetimeDB module**. There is **no application server**.

**The pitch line:** *"The database is the arena. Humans and AI agents are symmetric subscribers mutating the same shared state; the app being built **is** the database, and you watch it materialize live."*

**How it's built (the SpacetimeDB-native architecture):**
- **State = 15 public SpacetimeDB tables** (`artifact_file`, `participant`, `agent`, `intent`, `activity`, `bench_prompt`, `verdict`, `vote`, `score`, …). Secrets (`bench_task` with unit tests / answers) are a **private** table — never sent to clients.
- **Writes = reducers only** (the deterministic module logic). Clients never mutate tables directly.
- **Reads = subscriptions.** The whole UI renders from `useTable(...)`; nothing polls.
- **The AI lives in a "runner"** (a Node SpacetimeDB *client*), because reducers can't make network calls. The runner calls the LLM and writes results back via reducers. **API keys live only in the runner — SpacetimeDB never sees them.**
- **Live preview** = the `artifact_file` rows assembled into a sandboxed `<iframe>` that re-renders on every change.
- **Live grading** = for HumanEval, the runner executes the dataset's real unit tests in a sandboxed Python subprocess → writes a `verdict` row → the UI flips to PASS/FAIL.
- **Multi-model** = the runner routes per agent to Gemini, **Claude (via AWS Bedrock)**, Azure GPT-5.4, or OpenRouter.

**Why it fits the hackathon** (best collaborative/multiplayer app on SpacetimeDB): heavily real-time ✓, SpacetimeDB *meaningfully* used (it's the whole backend + the live medium) ✓, beautiful (Atelier UI) ✓, clever STDB use (the artifact + grading live in the DB) ✓, **SpacetimeDB + LLMs** (multi-model agents) ✓.

---

## 2. Live URLs

| | |
|---|---|
| **App (public)** | https://client-alpha-seven-64.vercel.app |
| **Module** | `amy-panel` on Maincloud — dashboard `https://spacetimedb.com/amy-panel` |

Account: `quidwaiali` (the one with the TeV credits). Client host: Vercel (`ali-maq`).

---

## 3. Room capacity / multiplayer

**No cap in the code.** `joinRoom` assigns the next seat to anyone who joins, and everyone subscribes to the same room state, so **any number of humans can be in one room at once** and all see each other live. Practically, **2–6** looks best in the current layout. Open the URL in several browser windows/people to prove it — each appears in the left rail instantly.

---

## 4. How to run / test

**Hosted (judges' path):** open the app URL → it talks to Maincloud `amy-panel`. The human side works on its own. For the AI side, run the **runner on your laptop** pointed at Maincloud (Bedrock/Claude is VPN-only):

```bash
# get the room id after you create a room in the browser:
spacetime sql amy-panel --server maincloud "SELECT id, topic, mode, status FROM room"

# human-steered agent (your IntentBar unlocks), replace N:
cd panel/ai-runner && rm -f .agent_token_* ; \
SPACETIMEDB_URI=wss://maincloud.spacetimedb.com MODULE_NAME=amy-panel \
AWS_PROFILE=mssm-bedrock AWS_REGION=us-east-1 \
SOLVER_PROVIDER=bedrock SOLVER_MODEL=us.anthropic.claude-opus-4-8 \
PAIR=auto ROOM_ID=N AGENT_ROLES=solver npm run agents
```

**Local dev:** `spacetime start --listen-addr 127.0.0.1:3456`, publish `amy-panel` to that local server, set `USE_MAINCLOUD=false` in `client/src/config.ts`, `npm run dev` in `client/`, and run the same runner with `SPACETIMEDB_URI=ws://127.0.0.1:3456`.

---

## 5. Feature checklist — test each one

Legend: **✅ works** · **⚙️ needs the runner** · **🟡 unproven** (UI works, full flow never run end-to-end)

### Lobby (all ✅ — verified)
| Feature | How to test |
|---|---|
| ✅ Camera preview + **mic/cam toggle** | Open app → preview shows webcam; click 🎙️/📹 to toggle |
| ✅ Name, **Mode picker** (Build/Benchmark/Race), prompt box, HF task picker | Click mode cards → section switches; type name |
| ✅ **Create & join** | Enter name → Create → you land in the room as a participant |
| ✅ **Join** / **Watch** an open room | In a 2nd window, Join (human) or Watch (observer) → you appear in the room live |

### Build loop — works WITHOUT any AI (✅ verified)
| Feature | How to test |
|---|---|
| ✅ **File tree** select | Click a file (`index.html`/`style.css`/`app.js`) → opens in editor |
| ✅ **Edit + Save** a file (`writeFile`) | Edit the textarea → Save → row version bumps, **preview updates live** |
| ✅ **Live preview** (sandboxed iframe) | Edit `index.html` → see it render instantly |
| ✅ **Start / Finish / Leave** | Toolbar buttons change room status / exit |
| ✅ **In-room mic/cam toggle** (just fixed) | Toolbar 🎙️/📹 now toggle from inside the room, not only the lobby |
| ✅ Real-time presence | Other people/agents appear in the left rail with live status |

### Human-steered AI (⚙️ needs the runner — verified working)
| Feature | How to test |
|---|---|
| ⚙️ **IntentBar** (steer your agent) | Start the `PAIR=auto` runner above → IntentBar unlocks → type "add a dark-mode toggle" → your **Claude agent writes the file**, preview updates. *Without a runner the IntentBar is disabled and says so — that's expected, not a bug.* |
| ⚙️ Agent status spinner (thinking/writing) | Visible while the agent works |
| ⚙️ Activity stream (plans, edits, thoughts) | Fills as the agent acts |

### Benchmark mode (⚙️ needs the runner — **verified end-to-end: HumanEval PASS 1/1**)
| Feature | How to test |
|---|---|
| ⚙️ Load a real **HumanEval** task | Create a Benchmark room → run `BENCH_ROW_INDEX=0 ROOM_ID=N … npm run grader` → the **HumanEval prompt appears**, secrets stay server-side |
| ⚙️ Agent writes `solution.py` | Run an autonomous solver → it writes the Python solution |
| ⚙️ **Real unit-test grading** | Click Finish → grader runs the dataset's tests in a sandbox → **VerdictCard: PASS N/N, verified ✓** |

### Race mode (🟡 UNPROVEN end-to-end — UI now navigable after fixes)
| Feature | Status |
|---|---|
| 🟡 **Start race (create teams)** button (just added) | Create a Race room → click "⚔ Start race" → two team columns appear (`initRaceTeams`) |
| 🟡 Two-team side-by-side + previews (preview fallback just fixed) | Columns render; previews show files |
| 🟡 **Vote** for a team (`castVote`) | Vote buttons tally live |
| 🟡 Full human-team-vs-AI-team solve + winner | **Never run end-to-end** — needs one human-paired runner + one autonomous AI runner; treat as experimental |

### Multi-model (✅ verified)
| ✅ Gemini Flash and **Claude Opus 4.8 via AWS Bedrock** both write files | Run with `SOLVER_PROVIDER=bedrock` (Claude) or default (Gemini) |

---

## 6. Known limitations (honest)
- **IntentBar / agents need the local runner** — there's no in-browser way to spawn an agent (by design: the LLM call can't live in a reducer). Hand-editing files works with no runner.
- **Race mode is experimental** — the buttons work now, but a full two-team race was never run start-to-finish.
- **Bedrock/Azure are VPN-only**, so the runner must run on your Mount Sinai-VPN'd laptop during the demo. Gemini works anywhere.
- **TeV energy** — running burns credits; the build room is light, but turn the camera off to conserve (webcam tiles publish frames).
- **SWE-bench** is judge-only (no sandboxed repo) and labeled "NOT TEST-VERIFIED."

---

## 7. The three things proven on camera-able
1. **Collaborative build** — human edits + Claude agent edits, shared live, preview updating.
2. **Human-steered AI** — type intent → Claude Opus 4.8 writes the file.
3. **Benchmark graded live** — HumanEval, real unit tests, verified PASS.

These three already satisfy every bonus category. Record those for the video.
