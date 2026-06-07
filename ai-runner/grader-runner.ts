// Panel — Grader Runner (thin entrypoint)
// ----------------------------------------------------------------------------
// A SpacetimeDB *client* that, when a room enters 'grading' (after finishBuild),
// reads the bench prompt + each team's candidate, grades via ./grader, and
// records a verdict. Deterministic types (numeric/mc) are forwarded to the
// gradeDeterministic reducer; code/freeform are graded here (sandboxed tests or
// LLM judge) and pushed via recordVerdict.
//
// API keys live ONLY here (and in agent-runner) — never in the browser/reducers.
//
// Run:  npm run grader   (scripts.grader = tsx grader-runner.ts)

import 'dotenv/config';
import fs from 'node:fs';
import { DbConnection, tables } from '../client/src/module_bindings';
import { grade, type BenchmarkType, type GradeInput } from './grader';
import { CATALOG, pickQuestion, type Split } from './hf';

const URI = process.env.SPACETIMEDB_URI ?? 'ws://127.0.0.1:3456';
const MODULE = process.env.MODULE_NAME ?? 'panel';
const ROOM_ID = process.env.ROOM_ID ? BigInt(process.env.ROOM_ID) : undefined;
const TOKEN_FILE = new URL('./.grader_token', import.meta.url);

// Code unit tests + hidden ground truth are NOT persisted in the public
// bench_prompt row (they'd leak the answer). For verified code grading the
// grader re-fetches them from Hugging Face by the same row coordinates. The
// operator supplies the coordinates the agents were given via env; we fall back
// to the CATALOG entry for the dataset when only some are set.
const BENCH_CONFIG = process.env.BENCH_CONFIG;
const BENCH_SPLIT = process.env.BENCH_SPLIT;
const BENCH_ROW_INDEX =
  process.env.BENCH_ROW_INDEX !== undefined && process.env.BENCH_ROW_INDEX !== ''
    ? Number(process.env.BENCH_ROW_INDEX)
    : undefined;
const BENCH_DATASET = process.env.BENCH_DATASET; // explicit dataset id (else CATALOG default)

// The HF Question loaded for this room. Cached in-process so grading reuses the
// EXACT row (tests + ground truth) we loaded — no re-fetch / row-index mismatch,
// and the secret tests/answer never touch a client subscription.
let cachedQuestion: any;
let taskLoadAttempted = false;

if (!ROOM_ID) {
  console.error('[grader] ROOM_ID is required (set it in .env)');
  process.exit(1);
}

// rooms we've already graded this run (status -> grading edge), and (team)
// candidates we've already submitted a verdict for (to avoid duplicates).
const gradedRooms = new Set<string>();
const gradedTeams = new Set<string>();
let myIdentity: any;

const saved = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : undefined;

const conn: any = DbConnection.builder()
  .withUri(URI)
  .withDatabaseName(MODULE)
  .withToken(saved || undefined)
  .onConnect((ctx: any, identity: any, token: string) => {
    if (token) fs.writeFileSync(TOKEN_FILE, token);
    myIdentity = identity;
    console.log(`[grader] connected to ${MODULE} @ ${URI} (room ${ROOM_ID})`);
    const rid = ROOM_ID!;
    ctx
      .subscriptionBuilder()
      .onApplied(() => {
        console.log('[grader] subscription applied — watching for grading');
        const room = [...conn.db.room.iter()].find((r: any) => r.id === rid);
        if (room) {
          void loadTaskIfNeeded(room);
          void onRoom(room);
        }
      })
      .subscribe([
        // room's PK is `id` (small table) — subscribe to all, filter locally.
        tables.room,
        tables.artifactFile.where((r: any) => r.roomId.eq(rid)),
        tables.benchPrompt.where((r: any) => r.roomId.eq(rid)),
        tables.team.where((r: any) => r.roomId.eq(rid)),
        tables.verdict.where((r: any) => r.roomId.eq(rid)),
        tables.score.where((r: any) => r.roomId.eq(rid)),
      ]);

    conn.db.room.onUpdate((_c: any, _o: any, room: any) => {
      void loadTaskIfNeeded(room);
      void onRoom(room);
    });
    conn.db.room.onInsert((_c: any, room: any) => {
      void loadTaskIfNeeded(room);
      void onRoom(room);
    });
  })
  .onConnectError((_ctx: any, err: any) => console.error('[grader] connect error', err))
  .onDisconnect(() => console.log('[grader] disconnected'))
  .build();

// Populate the benchmark question for the room (once). This is what makes the
// UI show the task AND lets agents see it — without it, bench_prompt is empty
// and there's nothing to grade. Secret tests/ground-truth go into the PRIVATE
// bench_task table (never a client subscription) and are cached here in-process.
async function loadTaskIfNeeded(room: any) {
  if (room.id !== ROOM_ID) return;
  if (room.mode !== 'benchmark' && room.mode !== 'race') return;
  if (taskLoadAttempted) return;
  if ([...conn.db.benchPrompt.iter()].some((b: any) => b.roomId === ROOM_ID)) return; // already loaded
  taskLoadAttempted = true;

  const cat =
    (BENCH_DATASET ? CATALOG.find((c) => c.dataset === BENCH_DATASET) : undefined) ??
    CATALOG.find((c) => c.type === 'code') ?? // default: HumanEval (test-verified)
    CATALOG[0];
  const dataset = BENCH_DATASET ?? cat.dataset;
  const config = BENCH_CONFIG ?? cat.config;
  const split = BENCH_SPLIT ?? cat.split;
  try {
    console.log(`[grader] loading task ${dataset}/${config}/${split} from Hugging Face…`);
    const q = await pickQuestion({ dataset, config, split }, BENCH_ROW_INDEX);
    cachedQuestion = q;
    conn.reducers.loadBenchTask({
      roomId: ROOM_ID!,
      datasetId: q.datasetId,
      config: q.config,
      split: q.split,
      rowIndex: BigInt(q.rowIndex ?? 0),
      benchmarkType: q.benchmarkType,
      label: cat.label ?? q.datasetId,
      prompt: q.prompt,
      groundTruth: q.groundTruth ?? '',
      choices: JSON.stringify(q.choices ?? []),
      tests: q.tests ?? '',
      entryPoint: q.entryPoint ?? '',
      gradeUnverified: !!(q.meta && (q.meta as any).gradeUnverified),
      metaJson: JSON.stringify(q.meta ?? {}),
    });
    console.log(
      `[grader] loadBenchTask ok: type=${q.benchmarkType} entry=${q.entryPoint || '-'} ` +
        `"${(q.prompt || '').slice(0, 70).replace(/\n/g, ' ')}…"`
    );
  } catch (e) {
    taskLoadAttempted = false; // allow a retry on the next room event
    console.error('[grader] loadTask failed', e);
  }
}

async function onRoom(room: any) {
  if (room.id !== ROOM_ID) return;
  if (room.status !== 'grading') return;
  const key = room.id.toString();
  if (gradedRooms.has(key)) return;
  gradedRooms.add(key);
  try {
    await gradeRoom(room);
  } catch (e) {
    console.error('[grader] gradeRoom error', e);
    gradedRooms.delete(key); // allow a retry if grading re-triggers
  }
}

async function gradeRoom(room: any) {
  const bench = [...conn.db.benchPrompt.iter()].find((b: any) => b.roomId === ROOM_ID);
  if (!bench) {
    console.log('[grader] no benchPrompt loaded for this room — nothing to grade');
    return;
  }
  const benchmarkType = (bench.benchmarkType as BenchmarkType) ?? 'freeform';
  const choices = parseChoices(bench.choices);

  // For verified code grading (and judge references) we need the dataset's unit
  // tests / ground truth, which are not in the public row — re-fetch from HF.
  let tests: string | undefined;
  let groundTruth: string | undefined;
  const needsFetch =
    (benchmarkType === 'code' && !bench.gradeUnverified) || benchmarkType === 'freeform';
  if (needsFetch) {
    // Prefer the in-process cached row we loaded (exact same question + secret
    // tests); only re-fetch if this grader didn't load the task itself.
    const fetched = cachedQuestion
      ? { tests: cachedQuestion.tests, groundTruth: cachedQuestion.groundTruth }
      : await fetchTask(bench.datasetId);
    if (fetched) {
      tests = fetched.tests;
      groundTruth = fetched.groundTruth;
    } else if (benchmarkType === 'code' && !bench.gradeUnverified) {
      console.warn(
        '[grader] could not fetch dataset tests — verified code grading will fail; ' +
          'set BENCH_CONFIG/BENCH_SPLIT/BENCH_ROW_INDEX to match the loaded task'
      );
    }
  }

  const teams = [...conn.db.team.iter()].filter((t: any) => t.roomId === ROOM_ID);
  // Build mode has no teams -> grade the single shared artifact set once.
  const targets: { teamId: bigint; kind?: string; label: string }[] = teams.length
    ? teams.map((t: any) => ({ teamId: t.id, kind: t.kind, label: t.label }))
    : [{ teamId: 0n, label: 'submission' }];

  for (const target of targets) {
    const tkey = `${ROOM_ID}:${target.teamId}`;
    if (gradedTeams.has(tkey)) continue;
    gradedTeams.add(tkey);

    const candidate = candidateFor(bench, target.kind);
    console.log(
      `[grader] grading team ${target.teamId} (${target.label}) type=${benchmarkType} ` +
        `len=${candidate.length}`
    );

    const input: GradeInput = {
      roomId: ROOM_ID!,
      teamId: target.teamId,
      candidate,
      benchmarkType,
      prompt: bench.prompt,
      groundTruth,
      tests,
      entryPoint: bench.entryPoint || undefined,
      gradeUnverified: !!bench.gradeUnverified,
      choices,
    };

    const result = await grade(input);

    if (result.deterministic) {
      // numeric / mc: the module owns exact-match grading.
      console.log(`[grader] -> gradeDeterministic team ${target.teamId}`);
      conn.reducers.gradeDeterministic({
        roomId: ROOM_ID!,
        teamId: target.teamId,
        candidate,
      });
      continue;
    }

    console.log(
      `[grader] -> recordVerdict team ${target.teamId}: ${result.passed ? 'PASS' : 'FAIL'} ` +
        `(${result.passedCount}/${result.totalCount}, ${result.method}, verified=${result.verified})`
    );
    conn.reducers.recordVerdict({
      roomId: ROOM_ID!,
      teamId: target.teamId,
      method: result.method,
      verified: result.verified,
      passed: result.passed,
      passedCount: result.passedCount,
      totalCount: result.totalCount,
      score: result.score,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      judgeNotes: result.judgeNotes,
    });
  }
  console.log('[grader] done grading room', ROOM_ID?.toString());
}

// Pick the candidate text for a team. For code benchmarks we prefer the file
// whose contents define the bench entry point (or any .py / solution file);
// otherwise we concatenate the team's owned files. In race mode files are
// partitioned by ownerRole == team kind; in build/benchmark mode there is one
// shared set (kind undefined) so we use everything.
function candidateFor(bench: any, teamKind?: string): string {
  let files = [...conn.db.artifactFile.iter()].filter(
    (f: any) => f.roomId === ROOM_ID && !f.deleted
  );
  if (teamKind) {
    const owned = files.filter((f: any) => ownerMatchesTeam(f.ownerRole, teamKind));
    if (owned.length) files = owned;
  }
  if (!files.length) return '';

  const entry = (bench.entryPoint || '').trim();
  if (bench.benchmarkType === 'code') {
    // 1) a file that actually defines the entry point
    if (entry) {
      const def = files.find((f: any) =>
        new RegExp(`def\\s+${escapeRe(entry)}\\b`).test(f.content)
      );
      if (def) return def.content;
    }
    // 2) any python file (largest wins)
    const py = files
      .filter((f: any) => f.path.endsWith('.py') || f.language === 'python')
      .sort((a: any, b: any) => b.content.length - a.content.length);
    if (py.length) return py[0].content;
    // 3) a solution-ish file
    const sol = files.find((f: any) => /solution|answer|main/i.test(f.path));
    if (sol) return sol.content;
  }
  // freeform/default: concatenate all files in path order.
  return files
    .sort((a: any, b: any) => a.path.localeCompare(b.path))
    .map((f: any) => `# ${f.path}\n${f.content}`)
    .join('\n\n');
}

function ownerMatchesTeam(ownerRole: string, teamKind: string): boolean {
  const o = (ownerRole || '').toLowerCase();
  const k = (teamKind || '').toLowerCase();
  if (k.includes('ai')) return o.includes('ai') || o.includes('agent');
  if (k.includes('human')) return o.includes('human');
  return o === k;
}

// Re-fetch the loaded benchmark row from HF to recover tests + ground truth.
// Coordinates come from env (preferred — exact same row the agents saw) or the
// CATALOG entry for this datasetId.
async function fetchTask(
  datasetId: string
): Promise<{ tests?: string; groundTruth?: string } | undefined> {
  const cat = CATALOG.find((c) => c.dataset === datasetId);
  const config = BENCH_CONFIG ?? cat?.config;
  const split = BENCH_SPLIT ?? cat?.split;
  if (!config || !split) return undefined;
  const s: Split = { dataset: datasetId, config, split };
  try {
    const q = await pickQuestion(s, BENCH_ROW_INDEX);
    return { tests: q.tests, groundTruth: q.groundTruth };
  } catch (e) {
    console.error('[grader] HF fetch failed', e);
    return undefined;
  }
}

function parseChoices(raw: string): string[] | undefined {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map(String);
  } catch {}
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

process.on('SIGINT', () => {
  console.log('\n[grader] shutting down');
  process.exit(0);
});
