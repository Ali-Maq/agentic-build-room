// Panel — Agent Runner
// ----------------------------------------------------------------------------
// One Node process hosts N AI agents. Each agent is its own SpacetimeDB *client*
// (own DbConnection + own persisted token file ./.agent_token_<key>). Reducers
// stay deterministic and can't call the network, so the LLM lives out here; the
// database is the single source of truth and each agent is just a subscriber
// that happens to think.
//
// CORE LOOP (driven by intent.onInsert, room-scoped subscription):
//   intent for me & pending -> claimIntent -> setAgentStatus('thinking') +
//   postActivity('plan') -> read current files -> generate({json}) -> claimFile
//   -> re-read baseVersion -> setAgentStatus('writing') -> writeFile(editKind
//   'agent') -> postActivity('edit') -> markIntent('done') -> setAgentStatus
//   ('idle'). On a 'stale' SenderError we re-read the version and retry once.
//
// Autonomous / race mode: same loop, but we seed one bootstrap intent per ai
// agent (no human). A per-agent round cap + a process-wide token budget keep it
// from looping forever.
//
// Run:  npm run agents      (scripts.agents = tsx agent-runner.ts)

import 'dotenv/config';
import fs from 'node:fs';
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../client/src/module_bindings';
import { generate, ROSTER, type Provider } from './llm';
import { langFromPath } from '../client/src/assemble';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const URI = process.env.SPACETIMEDB_URI ?? 'ws://127.0.0.1:3456';
const MODULE = process.env.MODULE_NAME ?? 'panel';
const ROOM_ID = process.env.ROOM_ID ? BigInt(process.env.ROOM_ID) : undefined;
const PAIR = process.env.PAIR?.trim(); // 'auto' | <human hex> -> one human-steered agent
const AUTONOMOUS = /^(1|true|yes)$/i.test(process.env.AUTONOMOUS ?? '');
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS ?? 8);
const TOKEN_BUDGET = Number(process.env.TOKEN_BUDGET ?? 200_000);
const BOOTSTRAP_PROMPT =
  process.env.BOOTSTRAP_PROMPT ??
  'Bootstrap the shared web app: create index.html with a clean layout, ' +
    'plus styles.css and app.js. Make it actually run in the live preview.';

if (!ROOM_ID) {
  console.error('[agents] ROOM_ID is required (set it in .env)');
  process.exit(1);
}

type AgentSpec = {
  key: string; // stable -> token filename + ROSTER fallback
  role: string; // ROSTER key
  team: 'human' | 'ai';
  displayName: string;
  pairedHuman?: string; // hex identity
  provider?: Provider;
  model?: string;
};

function loadSpecs(): AgentSpec[] {
  // PAIR mode: host ONE agent steered by a human (that human's IntentBar lights
  // up). PAIR=auto pairs to the first online human in the room; PAIR=<hex> pins it.
  if (PAIR) {
    const role = process.env.AGENT_ROLES?.split(',')[0]?.trim() || 'solver';
    const roster = ROSTER[role] ?? ROSTER['solver'];
    return [
      normalizeSpec({
        key: 'human-agent',
        role,
        team: 'human',
        displayName: `${role} (${roster?.model ?? 'gemini'})`,
        pairedHuman: PAIR,
      }),
    ];
  }
  const raw = process.env.AGENTS_JSON?.trim();
  if (raw) {
    try {
      const arr = JSON.parse(raw) as AgentSpec[];
      if (Array.isArray(arr) && arr.length) return arr.map(normalizeSpec);
    } catch (e) {
      console.error('[agents] bad AGENTS_JSON:', e);
    }
  }
  const roles = (process.env.AGENT_ROLES ?? 'solver')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return roles.map((role, i) =>
    normalizeSpec({
      key: role || `agent${i}`,
      role: role || 'solver',
      team: 'ai',
      displayName: `${role} (${ROSTER[role]?.model ?? 'gemini'})`,
    })
  );
}

function normalizeSpec(s: AgentSpec): AgentSpec {
  const roster = ROSTER[s.role] ?? ROSTER['solver'];
  return {
    key: s.key,
    role: s.role,
    team: s.team ?? 'ai',
    displayName: s.displayName ?? `${s.role} (${roster?.model ?? 'gemini'})`,
    pairedHuman: s.pairedHuman,
    provider: s.provider,
    model: s.model,
  };
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

const CODER_SYSTEM =
  'You are an elite full-stack coding agent collaborating with humans and other ' +
  'agents on ONE shared web app stored in a live database. Every file you write ' +
  'renders immediately in a sandboxed iframe preview, so the app must actually ' +
  'run with no build step (plain HTML/CSS/JS, no imports of local files unless ' +
  'they are assembled inline). When given an instruction, choose the single most ' +
  'impactful file to create or modify and return its COMPLETE new contents — ' +
  'never a diff, never a partial file, never "...". Keep the existing structure ' +
  'and other files working. Be concise and ship working code.';

// Used when the room is a CODE benchmark (e.g. HumanEval): the artifact is a
// program graded by real unit tests, not a web app.
const CODE_SOLVER_SYSTEM =
  'You are an elite competitive programmer. You are given a programming task ' +
  '(typically a Python function signature + docstring). Implement the COMPLETE, ' +
  'correct solution that will pass hidden unit tests. Return exactly ONE file ' +
  'named "solution.py" whose contents define the required function (include the ' +
  'full `def`, the body, and any needed imports). Do NOT write HTML/CSS/JS, do ' +
  'NOT add explanations. Return JSON {path:"solution.py", fullContent:<python>, summary}.';

const FILE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    fullContent: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['path', 'fullContent', 'summary'],
} as const;

// ---------------------------------------------------------------------------
// One hosted agent
// ---------------------------------------------------------------------------

let tokensUsed = 0; // process-wide rough budget (chars/4 heuristic per gen)

class HostedAgent {
  spec: AgentSpec;
  conn: any;
  myIdentity: any;
  myAgentId: bigint | undefined;
  ready = false;
  private registering = false; // guards against duplicate in-flight registerAgent

  private processed = new Set<string>(); // intent ids handled
  private queue: any[] = []; // pending intent rows
  private inFlight = false;
  private rounds = 0;
  private bootstrapped = false;
  private thoughtBuf: string[] = [];
  private thoughtTimer: NodeJS.Timeout | undefined;

  constructor(spec: AgentSpec) {
    this.spec = spec;
  }

  private tokenFile() {
    return new URL(`./.agent_token_${this.spec.key}`, import.meta.url);
  }

  connect() {
    const tf = this.tokenFile();
    const saved = fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : undefined;
    this.conn = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(MODULE)
      .withToken(saved || undefined)
      .onConnect((ctx: any, identity: any, token: string) => {
        if (token) fs.writeFileSync(tf, token);
        this.myIdentity = identity;
        console.log(
          `[${this.spec.key}] connected as ${identity.toHexString().slice(0, 12)}… ` +
            `(role=${this.spec.role}, team=${this.spec.team})`
        );
        this.subscribe(ctx);
      })
      .onConnectError((_ctx: any, err: any) =>
        console.error(`[${this.spec.key}] connect error`, err)
      )
      .onDisconnect(() => console.log(`[${this.spec.key}] disconnected`))
      .build();
  }

  private subscribe(ctx: any) {
    const rid = ROOM_ID!;
    ctx
      .subscriptionBuilder()
      .onApplied(() => {
        console.log(`[${this.spec.key}] subscription applied`);
        this.register();
        // Drain any intents that already existed before we connected.
        for (const it of [...this.conn.db.intent.iter()]) this.onIntent(it);
      })
      .subscribe([
        // room's PK is `id` (small table) — subscribe to all, filter locally.
        tables.room,
        tables.participant.where((r: any) => r.roomId.eq(rid)),
        tables.artifactFile.where((r: any) => r.roomId.eq(rid)),
        tables.agent.where((r: any) => r.roomId.eq(rid)),
        tables.intent.where((r: any) => r.roomId.eq(rid)),
        tables.activity.where((r: any) => r.roomId.eq(rid)),
        tables.benchPrompt.where((r: any) => r.roomId.eq(rid)),
        tables.team.where((r: any) => r.roomId.eq(rid)),
      ]);

    this.conn.db.intent.onInsert((_c: any, it: any) => this.onIntent(it));
    this.conn.db.intent.onUpdate((_c: any, _o: any, it: any) => this.onIntent(it));
    // Re-discover our agent row (id is assigned by the reducer) as it appears.
    this.conn.db.agent.onInsert((_c: any, a: any) => this.adoptAgent(a));
    this.conn.db.agent.onUpdate((_c: any, _o: any, a: any) => this.adoptAgent(a));
    // A human joining lets a PAIR=auto agent resolve its pairing and register.
    this.conn.db.participant.onInsert((_c: any, _p: any) => { if (!this.ready) this.register(); });
    this.conn.db.participant.onUpdate((_c: any, _o: any, _p: any) => { if (!this.ready) this.register(); });
    // When the grader loads the benchmark task, an autonomous agent can start.
    this.conn.db.benchPrompt.onInsert((_c: any, _b: any) => this.maybeBootstrap());
  }

  private register() {
    // Register if our row is missing OR its label is stale (e.g. we reused a
    // token file but switched provider/model), so the UI model badge is correct.
    const existing = this.findMyAgent();
    if (existing && existing.displayName === this.spec.displayName) {
      this.adoptAgent(existing);
      return;
    }
    // Resolve pairing. 'auto' waits until a human is actually in the room.
    let paired: any = undefined;
    if (this.spec.pairedHuman === 'auto') {
      const human = this.firstHuman();
      if (!human) {
        console.log(`[${this.spec.key}] waiting for a human in room ${ROOM_ID} to pair…`);
        return;
      }
      paired = human.identity;
      console.log(`[${this.spec.key}] auto-pairing to ${human.displayName}`);
    } else if (this.spec.pairedHuman) {
      paired = identityFromHex(this.spec.pairedHuman);
    }
    if (this.registering) return; // a registerAgent is already in flight
    this.registering = true;
    console.log(`[${this.spec.key}] registerAgent "${this.spec.displayName}"`);
    this.conn.reducers.registerAgent({
      roomId: ROOM_ID!,
      pairedHuman: paired,
      team: this.spec.team,
      role: this.spec.role,
      displayName: this.spec.displayName,
    });
  }

  private firstHuman() {
    return [...this.conn.db.participant.iter()].find(
      (p: any) => p.roomId === ROOM_ID && p.role === 'human' && p.online
    );
  }

  private findMyAgent() {
    if (!this.myIdentity) return undefined;
    const meHex = this.myIdentity.toHexString();
    return [...this.conn.db.agent.iter()].find(
      (a: any) => a.roomId === ROOM_ID && a.identity.toHexString() === meHex
    );
  }

  private adoptAgent(a: any) {
    if (!this.myIdentity || !a) return;
    if (a.roomId !== ROOM_ID) return;
    if (a.identity.toHexString() !== this.myIdentity.toHexString()) return;
    const wasReady = this.ready;
    this.myAgentId = a.id;
    this.ready = true;
    this.registering = false; // our row landed; allow future re-register if needed
    if (!wasReady) {
      console.log(`[${this.spec.key}] agentId=${a.id}`);
      this.maybeBootstrap();
      // Pick up any pending intents already targeted at us.
      for (const it of [...this.conn.db.intent.iter()]) this.onIntent(it);
    }
  }

  // Autonomous/race: seed exactly one bootstrap intent for ai-team agents so the
  // build kicks off with no human in the loop.
  private maybeBootstrap() {
    if (!AUTONOMOUS || this.bootstrapped) return;
    if (this.spec.team !== 'ai') return;
    if (!this.ready || this.myAgentId === undefined) return;
    // In a benchmark/race room, wait for the grader to load the task (benchPrompt)
    // before solving — otherwise we'd build a web app instead of the solution.
    const room = [...this.conn.db.room.iter()].find((r: any) => r.id === ROOM_ID);
    if (room && (room.mode === 'benchmark' || room.mode === 'race') && !this.benchType()) {
      console.log(`[${this.spec.key}] waiting for the benchmark task to load…`);
      return;
    }
    this.bootstrapped = true;
    const text =
      this.benchType() === 'code'
        ? 'Implement the solution for the given task in solution.py so every unit test passes.'
        : BOOTSTRAP_PROMPT;
    console.log(`[${this.spec.key}] seeding bootstrap intent`);
    this.conn.reducers.submitIntent({
      roomId: ROOM_ID!,
      targetAgentId: this.myAgentId!,
      text,
      targetPath: undefined,
    });
  }

  // ---- intent handling --------------------------------------------------
  private onIntent(it: any) {
    if (!this.ready || this.myAgentId === undefined) return;
    if (it.roomId !== ROOM_ID) return;
    if (it.targetAgentId !== this.myAgentId) return;
    if (it.status !== 'pending') return;
    const key = it.id.toString();
    if (this.processed.has(key)) return;
    if (this.queue.some((q) => q.id === it.id)) return;
    if (this.inFlight) {
      this.queue.push(it);
      return;
    }
    void this.handle(it);
  }

  private next() {
    const it = this.queue.shift();
    if (it) void this.handle(it);
  }

  private async handle(it: any) {
    const key = it.id.toString();
    if (this.processed.has(key)) return this.next();
    this.processed.add(key);
    this.inFlight = true;

    if (this.rounds >= MAX_ROUNDS) {
      console.log(`[${this.spec.key}] round cap (${MAX_ROUNDS}) hit — skip intent ${key}`);
      this.safeMark(it.id, 'done');
      this.inFlight = false;
      return this.next();
    }
    if (tokensUsed >= TOKEN_BUDGET) {
      console.log(`[${this.spec.key}] token budget exhausted — skip intent ${key}`);
      this.safeMark(it.id, 'done');
      this.inFlight = false;
      return this.next();
    }
    this.rounds++;

    try {
      this.conn.reducers.claimIntent({ intentId: it.id });
      this.setStatus('thinking', it.id);
      this.conn.reducers.postActivity({
        roomId: ROOM_ID!,
        kind: 'plan',
        text: `Working on: ${truncate(it.text, 240)}`,
        path: it.targetPath ?? undefined,
        intentId: it.id,
      });

      const files = this.currentFiles();
      const bundle = buildBundle(it, files, this.roomPrompt());

      const roster = ROSTER[this.spec.role] ?? ROSTER['solver'];
      // NB: no onDelta here — with a JSON-schema response the stream would be raw
      // JSON fragments, not readable reasoning, so we keep the activity feed clean.
      const res = await generate({
        provider: this.spec.provider ?? roster.provider,
        model: this.spec.model ?? roster.model,
        system: this.benchType() === 'code' ? CODE_SOLVER_SYSTEM : CODER_SYSTEM,
        messages: [{ role: 'user', content: bundle }],
        temperature: 0.3,
        maxOutputTokens: 8192,
        jsonSchema: FILE_SCHEMA,
      });
      tokensUsed += Math.ceil((res.text.length || 0) / 4);

      const out = res.json ?? safeParse(res.text);
      if (!out || !out.path || typeof out.fullContent !== 'string') {
        throw new Error('model returned no usable {path, fullContent}');
      }
      const path = String(out.path).trim();
      const summary = String(out.summary ?? 'updated file');

      // Surface a short reasoning bubble (batched ~400ms) before we write.
      this.bufferThought(`Plan for ${path}: ${summary}`, it.id);

      // Soft lock so concurrent agents/humans see who is editing.
      this.conn.reducers.claimFile({ roomId: ROOM_ID!, path });
      this.setStatus('writing', it.id);

      await this.writeWithRetry(path, out.fullContent, it.text);

      this.conn.reducers.postActivity({
        roomId: ROOM_ID!,
        kind: 'edit',
        text: truncate(summary, 280),
        path,
        intentId: it.id,
      });
      this.conn.reducers.releaseFile({ roomId: ROOM_ID!, path });
      this.conn.reducers.markIntent({ intentId: it.id, status: 'done' });
      this.setStatus('idle', undefined);
      console.log(`[${this.spec.key}] wrote ${path} (intent ${key})`);
    } catch (e: any) {
      console.error(`[${this.spec.key}] intent ${key} failed:`, e?.message ?? e);
      this.conn.reducers.postActivity({
        roomId: ROOM_ID!,
        kind: 'error',
        text: `Failed: ${truncate(String(e?.message ?? e), 240)}`,
        path: it.targetPath ?? undefined,
        intentId: it.id,
      });
      this.safeMark(it.id, 'error');
      this.setStatus('error', undefined);
    } finally {
      this.flushThoughts(it.id);
      this.inFlight = false;
      this.next();
    }
  }

  // writeFile with optimistic-concurrency retry. Reducer calls in this SDK
  // return a Promise that REJECTS with a SenderError (carrying the module's
  // error string) on failure — so on a 'stale' base version we re-read the
  // latest version and try once more.
  private async writeWithRetry(path: string, content: string, intentText: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = this.fileByPath(path);
      const baseVersion: bigint = cur?.version ?? 0n;
      const language = langFromPath(path);
      try {
        await this.conn.reducers.writeFile({
          roomId: ROOM_ID!,
          path,
          content,
          language,
          baseVersion,
          editKind: 'agent',
          intent: intentText,
        });
        return;
      } catch (e: any) {
        const msg = String(e?.message ?? e).toLowerCase();
        if (attempt === 0 && (msg.includes('stale') || msg.includes('version') || msg.includes('conflict'))) {
          console.log(`[${this.spec.key}] stale write on ${path} — re-reading & retrying`);
          await sleep(150); // let the newer row land in the local cache
          continue;
        }
        throw e;
      }
    }
  }

  private safeMark(intentId: bigint, status: string) {
    try {
      this.conn.reducers.markIntent({ intentId, status });
    } catch (e) {
      console.error(`[${this.spec.key}] markIntent failed`, e);
    }
  }

  private setStatus(status: string, busyIntentId: bigint | undefined) {
    if (this.myAgentId === undefined) return;
    try {
      this.conn.reducers.setAgentStatus({
        agentId: this.myAgentId,
        status,
        busyIntentId,
      });
    } catch (e) {
      console.error(`[${this.spec.key}] setAgentStatus failed`, e);
    }
  }

  // Batch streamed reasoning into ~400ms 'thought' activity bubbles.
  private bufferThought(chunk: string, intentId: bigint) {
    this.thoughtBuf.push(chunk);
    if (this.thoughtTimer) return;
    this.thoughtTimer = setTimeout(() => this.flushThoughts(intentId), 400);
  }

  private flushThoughts(intentId: bigint) {
    if (this.thoughtTimer) {
      clearTimeout(this.thoughtTimer);
      this.thoughtTimer = undefined;
    }
    const text = this.thoughtBuf.join('').trim();
    this.thoughtBuf = [];
    if (!text) return;
    try {
      this.conn.reducers.postActivity({
        roomId: ROOM_ID!,
        kind: 'thought',
        text: truncate(text, 400),
        path: undefined,
        intentId,
      });
    } catch {}
  }

  // ---- read helpers -----------------------------------------------------
  private currentFiles() {
    return [...this.conn.db.artifactFile.iter()]
      .filter((f: any) => f.roomId === ROOM_ID && !f.deleted)
      .sort((a: any, b: any) => a.path.localeCompare(b.path));
  }

  private fileByPath(path: string) {
    return [...this.conn.db.artifactFile.iter()].find(
      (f: any) => f.roomId === ROOM_ID && f.path === path && !f.deleted
    );
  }

  private roomPrompt(): string {
    const room = [...this.conn.db.room.iter()].find((r: any) => r.id === ROOM_ID);
    const bench = [...this.conn.db.benchPrompt.iter()].find((b: any) => b.roomId === ROOM_ID);
    return bench?.prompt || room?.prompt || room?.topic || '';
  }

  // The benchmark type of this room, if it's a benchmark/race room (else undefined).
  private benchType(): string | undefined {
    return [...this.conn.db.benchPrompt.iter()].find((b: any) => b.roomId === ROOM_ID)?.benchmarkType;
  }
}

// ---------------------------------------------------------------------------
// Bundle builder — what the model actually sees.
// ---------------------------------------------------------------------------
function buildBundle(it: any, files: any[], goal: string): string {
  const fileBlocks = files.length
    ? files
        .map(
          (f) =>
            `--- FILE: ${f.path} (v${f.version}, ${f.language}) ---\n${f.content}`
        )
        .join('\n\n')
    : '(no files yet — this is a fresh project)';
  const target = it.targetPath ? `\nTARGET FILE: ${it.targetPath}` : '';
  return [
    goal ? `PROJECT GOAL:\n${goal}\n` : '',
    `CURRENT FILES IN THE SHARED APP:\n${fileBlocks}\n`,
    `INSTRUCTION FROM ${it.authorName || 'a teammate'}:${target}\n${it.text}\n`,
    'Return JSON {path, fullContent, summary}. fullContent is the COMPLETE new ' +
      'file (no diffs, no ellipses). Pick the one file that best satisfies the ' +
      'instruction. summary is one short sentence describing what you changed.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return undefined;
}
// Build an Identity from a hex string (for pairedHuman wiring).
function identityFromHex(hex: string): any {
  try {
    return Identity.fromString(hex);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
const specs = loadSpecs();
console.log(
  `[agents] room=${ROOM_ID} autonomous=${AUTONOMOUS} hosting ${specs.length} agent(s): ` +
    specs.map((s) => `${s.key}:${s.role}/${s.team}`).join(', ')
);

const agents = specs.map((s) => new HostedAgent(s));
for (const a of agents) a.connect();

process.on('SIGINT', () => {
  console.log('\n[agents] shutting down');
  process.exit(0);
});
