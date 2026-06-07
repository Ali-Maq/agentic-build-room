// Panel — Live Agentic Build Room
// SpacetimeDB module: the shared web artifact (HTML/CSS/JS) IS the database state.
// Humans steer paired AI agents (run by a local Node runner) that mutate that
// state via reducers; every client + a sandboxed live-preview iframe re-render
// from room-scoped subscriptions. Reducers are the ONLY write path and are
// deterministic (no network/clock/random except via ctx) — so the LLM + Hugging
// Face calls live in the runner, never here.

import { schema, table, t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

const LOCK_TTL_MICROS = 30_000_000n; // 30s advisory file-lock expiry

// ---------------------------------------------------------------------------
// Core room/presence (adapted from the interview app)
// ---------------------------------------------------------------------------

const room = table(
  { name: 'room', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    topic: t.string(),
    status: t.string(), // 'lobby' | 'building' | 'grading' | 'done'
    mode: t.string(), // 'build' | 'benchmark' | 'race'
    prompt: t.string(), // free-build prompt OR benchmark prompt shown to all
    startedAt: t.option(t.timestamp()),
    deadlineAt: t.option(t.timestamp()),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

const participant = table(
  { name: 'participant', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    identity: t.identity(),
    displayName: t.string(),
    role: t.string(), // 'human' | 'agent' | 'observer'
    agentModel: t.option(t.string()),
    pairedHuman: t.option(t.identity()),
    seat: t.i32(),
    online: t.bool(),
    joinedAt: t.timestamp(),
  }
);

const presence = table(
  { name: 'presence', public: true },
  {
    identity: t.identity().primaryKey(),
    online: t.bool(),
    lastSeen: t.timestamp(),
  }
);

const videoFrame = table(
  { name: 'video_frame', public: true },
  {
    identity: t.identity().primaryKey(),
    roomId: t.u64().index('btree'),
    data: t.byteArray(),
    seq: t.u64(),
    updatedAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// The shared artifact = DB state
// ---------------------------------------------------------------------------

const artifactFile = table(
  { name: 'artifact_file', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    path: t.string().index('btree'),
    content: t.string(),
    language: t.string(), // 'html'|'css'|'js'|'json'|'md'|'python'
    version: t.u64(),
    ownerRole: t.string(), // soft ownership: 'html'|'css'|'js'|''
    lockedBy: t.option(t.identity()),
    lockedAt: t.option(t.timestamp()),
    deleted: t.bool(),
    lastEditedBy: t.identity(),
    lastEditedByName: t.string(),
    lastEditKind: t.string(), // 'human'|'agent'
    updatedAt: t.timestamp(),
  }
);

const agent = table(
  { name: 'agent', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    identity: t.identity(),
    pairedHuman: t.option(t.identity()),
    team: t.string(), // 'human'|'ai'
    role: t.string(), // 'solver'|'critic'|'verifier'|'judge'
    displayName: t.string(),
    status: t.string(), // 'idle'|'thinking'|'writing'|'error'
    busyIntentId: t.option(t.u64()),
    updatedAt: t.timestamp(),
  }
);

const intent = table(
  { name: 'intent', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    authorIdentity: t.identity(),
    authorName: t.string(),
    targetAgentId: t.u64().index('btree'),
    targetPath: t.option(t.string()),
    text: t.string(),
    status: t.string().index('btree'), // 'pending'|'claimed'|'done'|'error'
    createdAt: t.timestamp(),
  }
);

const activity = table(
  { name: 'activity', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    identity: t.option(t.identity()),
    authorName: t.string(),
    actorKind: t.string(), // 'human'|'agent'|'system'
    kind: t.string(), // 'plan'|'thought'|'edit'|'intent'|'rejected'|'grade'|'system'|'error'
    text: t.string(),
    path: t.option(t.string()),
    intentId: t.option(t.u64()),
    fromVersion: t.option(t.u64()),
    toVersion: t.option(t.u64()),
    createdAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// Benchmark / race
// ---------------------------------------------------------------------------

const benchTask = table(
  { name: 'bench_task', public: false }, // PRIVATE — secrets never reach clients
  {
    roomId: t.u64().primaryKey(),
    datasetId: t.string(),
    config: t.string(),
    split: t.string(),
    rowIndex: t.u64(),
    benchmarkType: t.string(), // 'numeric'|'mc'|'code'|'freeform'
    prompt: t.string(),
    groundTruth: t.string(), // SECRET
    choices: t.string(),
    tests: t.string(), // SECRET
    entryPoint: t.string(),
    gradeUnverified: t.bool(),
    metaJson: t.string(),
    loadedAt: t.timestamp(),
  }
);

const benchPrompt = table(
  { name: 'bench_prompt', public: true }, // public mirror, no answer
  {
    roomId: t.u64().primaryKey(),
    datasetId: t.string(),
    label: t.string(),
    benchmarkType: t.string(),
    prompt: t.string(),
    choices: t.string(),
    entryPoint: t.string(),
    gradeUnverified: t.bool(),
    loadedAt: t.timestamp(),
  }
);

const team = table(
  { name: 'team', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    kind: t.string(), // 'human_agent'|'ai_only'
    label: t.string(),
    createdAt: t.timestamp(),
  }
);

const verdict = table(
  { name: 'verdict', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    teamId: t.u64().index('btree'),
    attempt: t.u32(),
    method: t.string(), // 'unit-test'|'numeric'|'mc'|'llm-judge'
    verified: t.bool(),
    passed: t.bool(),
    passedCount: t.u32(),
    totalCount: t.u32(),
    score: t.f64(),
    stdout: t.string(),
    stderr: t.string(),
    durationMs: t.u32(),
    judgeNotes: t.string(),
    submittedBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

const vote = table(
  { name: 'vote', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    voter: t.identity().index('btree'),
    teamId: t.u64(),
    createdAt: t.timestamp(),
  }
);

const score = table(
  { name: 'score', public: true },
  {
    teamId: t.u64().primaryKey(),
    roomId: t.u64().index('btree'),
    bestScore: t.f64(),
    bestPassed: t.bool(),
    attempts: t.u32(),
    firstPassAttempt: t.option(t.u32()),
    firstPassAtMicros: t.option(t.i64()),
    votes: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const phaseTick = table(
  { name: 'phase_tick', scheduled: (): any => onPhaseTick },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const spacetimedb = schema({
  room,
  participant,
  presence,
  videoFrame,
  artifactFile,
  agent,
  intent,
  activity,
  benchTask,
  benchPrompt,
  team,
  verdict,
  vote,
  score,
  phaseTick,
});
export default spacetimedb;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nameFor(ctx: any, roomId: bigint): string {
  const p = [...ctx.db.participant.roomId.filter(roomId)].find((x: any) => x.identity.equals(ctx.sender));
  if (p) return p.displayName;
  const a = [...ctx.db.agent.roomId.filter(roomId)].find((x: any) => x.identity.equals(ctx.sender));
  return a ? a.displayName : 'someone';
}

function actorKindFor(ctx: any, roomId: bigint): string {
  if ([...ctx.db.agent.roomId.filter(roomId)].some((a: any) => a.identity.equals(ctx.sender))) return 'agent';
  if ([...ctx.db.participant.roomId.filter(roomId)].some((p: any) => p.identity.equals(ctx.sender))) return 'human';
  return 'system';
}

function logActivity(
  ctx: any,
  roomId: bigint,
  kind: string,
  text: string,
  opts: { path?: string; intentId?: bigint; fromVersion?: bigint; toVersion?: bigint } = {}
) {
  ctx.db.activity.insert({
    id: 0n,
    roomId,
    identity: ctx.sender,
    authorName: nameFor(ctx, roomId),
    actorKind: actorKindFor(ctx, roomId),
    kind,
    text,
    path: opts.path,
    intentId: opts.intentId,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    createdAt: ctx.timestamp,
  });
}

function findFile(ctx: any, roomId: bigint, path: string) {
  return [...ctx.db.artifactFile.roomId.filter(roomId)].find((f: any) => f.path === path);
}

function bumpScoreForVerdict(ctx: any, teamId: bigint, roomId: bigint, passed: boolean, sc: number, attempt: number) {
  const existing = ctx.db.score.teamId.find(teamId);
  if (!existing) {
    ctx.db.score.insert({
      teamId,
      roomId,
      bestScore: sc,
      bestPassed: passed,
      attempts: 1,
      firstPassAttempt: passed ? attempt : undefined,
      firstPassAtMicros: passed ? ctx.timestamp.microsSinceUnixEpoch : undefined,
      votes: 0,
      updatedAt: ctx.timestamp,
    });
    return;
  }
  ctx.db.score.teamId.update({
    ...existing,
    bestScore: Math.max(existing.bestScore, sc),
    bestPassed: existing.bestPassed || passed,
    attempts: existing.attempts + 1,
    firstPassAttempt:
      existing.firstPassAttempt ?? (passed ? attempt : undefined),
    firstPassAtMicros:
      existing.firstPassAtMicros ?? (passed ? ctx.timestamp.microsSinceUnixEpoch : undefined),
    updatedAt: ctx.timestamp,
  });
}

function seedArtifact(ctx: any, roomId: bigint) {
  const base = (path: string, language: string, content: string, ownerRole: string) =>
    ctx.db.artifactFile.insert({
      id: 0n,
      roomId,
      path,
      content,
      language,
      version: 1n,
      ownerRole,
      lockedBy: undefined,
      lockedAt: undefined,
      deleted: false,
      lastEditedBy: ctx.sender,
      lastEditedByName: 'system',
      lastEditKind: 'human',
      updatedAt: ctx.timestamp,
    });
  base(
    'index.html',
    'html',
    '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>App</title></head>\n<body>\n  <h1>New build room</h1>\n  <p>Ask your agent to build something.</p>\n</body>\n</html>\n',
    'html'
  );
  base('style.css', 'css', 'body { font-family: system-ui, sans-serif; margin: 2rem; }\n', 'css');
  base('app.js', 'js', "console.log('ready');\n", 'js');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function upsertPresence(ctx: any, online: boolean) {
  const existing = ctx.db.presence.identity.find(ctx.sender);
  if (existing) ctx.db.presence.identity.update({ ...existing, online, lastSeen: ctx.timestamp });
  else ctx.db.presence.insert({ identity: ctx.sender, online, lastSeen: ctx.timestamp });
}

export const init = spacetimedb.init((ctx) => {
  ctx.db.phaseTick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(5_000_000n) });
});

export const onConnect = spacetimedb.clientConnected((ctx) => upsertPresence(ctx, true));

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  upsertPresence(ctx, false);
  for (const p of [...ctx.db.participant.iter()]) {
    if (p.identity.equals(ctx.sender) && p.online) ctx.db.participant.id.update({ ...p, online: false });
  }
  if (ctx.db.videoFrame.identity.find(ctx.sender)) ctx.db.videoFrame.identity.delete(ctx.sender);
});

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

export const createRoom = spacetimedb.reducer(
  { topic: t.string(), displayName: t.string(), mode: t.string(), prompt: t.string() },
  (ctx, { topic, displayName, mode, prompt }) => {
    const created = ctx.db.room.insert({
      id: 0n,
      topic,
      status: 'lobby',
      mode: mode || 'build',
      prompt,
      startedAt: undefined,
      deadlineAt: undefined,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    ctx.db.participant.insert({
      id: 0n,
      roomId: created.id,
      identity: ctx.sender,
      displayName,
      role: 'human',
      agentModel: undefined,
      pairedHuman: undefined,
      seat: 0,
      online: true,
      joinedAt: ctx.timestamp,
    });
    seedArtifact(ctx, created.id);
  }
);

export const joinRoom = spacetimedb.reducer(
  { roomId: t.u64(), displayName: t.string(), role: t.string() },
  (ctx, { roomId, displayName, role }) => {
    if (!ctx.db.room.id.find(roomId)) throw new SenderError('room not found');
    const existing = [...ctx.db.participant.roomId.filter(roomId)].find((p: any) => p.identity.equals(ctx.sender));
    if (existing) {
      ctx.db.participant.id.update({ ...existing, online: true, displayName, role });
      return;
    }
    const seat = [...ctx.db.participant.roomId.filter(roomId)].length;
    ctx.db.participant.insert({
      id: 0n,
      roomId,
      identity: ctx.sender,
      displayName,
      role: role || 'human',
      agentModel: undefined,
      pairedHuman: undefined,
      seat,
      online: true,
      joinedAt: ctx.timestamp,
    });
  }
);

export const leaveRoom = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const me = [...ctx.db.participant.roomId.filter(roomId)].find((p: any) => p.identity.equals(ctx.sender));
  if (me) ctx.db.participant.id.update({ ...me, online: false });
  if (ctx.db.videoFrame.identity.find(ctx.sender)) ctx.db.videoFrame.identity.delete(ctx.sender);
});

export const startBuild = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const r = ctx.db.room.id.find(roomId);
  if (!r) throw new SenderError('room not found');
  ctx.db.room.id.update({ ...r, status: 'building', startedAt: ctx.timestamp });
});

export const finishBuild = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const r = ctx.db.room.id.find(roomId);
  if (!r) throw new SenderError('room not found');
  ctx.db.room.id.update({ ...r, status: r.mode === 'build' ? 'done' : 'grading' });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const registerAgent = spacetimedb.reducer(
  {
    roomId: t.u64(),
    pairedHuman: t.option(t.identity()),
    team: t.string(),
    role: t.string(),
    displayName: t.string(),
  },
  (ctx, { roomId, pairedHuman, team, role, displayName }) => {
    if (!ctx.db.room.id.find(roomId)) throw new SenderError('room not found');
    const existing = [...ctx.db.agent.roomId.filter(roomId)].find((a: any) => a.identity.equals(ctx.sender));
    if (existing) {
      ctx.db.agent.id.update({ ...existing, pairedHuman, team, role, displayName, status: 'idle', updatedAt: ctx.timestamp });
    } else {
      ctx.db.agent.insert({
        id: 0n,
        roomId,
        identity: ctx.sender,
        pairedHuman,
        team,
        role,
        displayName,
        status: 'idle',
        busyIntentId: undefined,
        updatedAt: ctx.timestamp,
      });
    }
    // Mirror as a participant so the rail/preview treat agents uniformly.
    const pExisting = [...ctx.db.participant.roomId.filter(roomId)].find((p: any) => p.identity.equals(ctx.sender));
    if (pExisting) {
      ctx.db.participant.id.update({ ...pExisting, role: 'agent', displayName, agentModel: displayName, pairedHuman, online: true });
    } else {
      const seat = [...ctx.db.participant.roomId.filter(roomId)].length;
      ctx.db.participant.insert({
        id: 0n,
        roomId,
        identity: ctx.sender,
        displayName,
        role: 'agent',
        agentModel: displayName,
        pairedHuman,
        seat,
        online: true,
        joinedAt: ctx.timestamp,
      });
    }
  }
);

export const setAgentStatus = spacetimedb.reducer(
  { agentId: t.u64(), status: t.string(), busyIntentId: t.option(t.u64()) },
  (ctx, { agentId, status, busyIntentId }) => {
    const a = ctx.db.agent.id.find(agentId);
    if (a) ctx.db.agent.id.update({ ...a, status, busyIntentId, updatedAt: ctx.timestamp });
  }
);

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export const submitIntent = spacetimedb.reducer(
  { roomId: t.u64(), targetAgentId: t.u64(), text: t.string(), targetPath: t.option(t.string()) },
  (ctx, { roomId, targetAgentId, text, targetPath }) => {
    if (!ctx.db.room.id.find(roomId)) throw new SenderError('room not found');
    ctx.db.intent.insert({
      id: 0n,
      roomId,
      authorIdentity: ctx.sender,
      authorName: nameFor(ctx, roomId),
      targetAgentId,
      targetPath,
      text,
      status: 'pending',
      createdAt: ctx.timestamp,
    });
    logActivity(ctx, roomId, 'intent', text, { path: targetPath });
  }
);

export const claimIntent = spacetimedb.reducer({ intentId: t.u64() }, (ctx, { intentId }) => {
  const i = ctx.db.intent.id.find(intentId);
  if (!i) throw new SenderError('intent not found');
  if (i.status !== 'pending') throw new SenderError('already claimed');
  ctx.db.intent.id.update({ ...i, status: 'claimed' });
});

export const markIntent = spacetimedb.reducer(
  { intentId: t.u64(), status: t.string() },
  (ctx, { intentId, status }) => {
    const i = ctx.db.intent.id.find(intentId);
    if (i) ctx.db.intent.id.update({ ...i, status });
  }
);

// ---------------------------------------------------------------------------
// File writes — the single artifact write path
// ---------------------------------------------------------------------------

export const writeFile = spacetimedb.reducer(
  {
    roomId: t.u64(),
    path: t.string(),
    content: t.string(),
    language: t.string(),
    baseVersion: t.u64(),
    editKind: t.string(),
    intent: t.string(),
  },
  (ctx, { roomId, path, content, language, baseVersion, editKind }) => {
    const f = findFile(ctx, roomId, path);
    if (!f) {
      ctx.db.artifactFile.insert({
        id: 0n,
        roomId,
        path,
        content,
        language,
        version: 1n,
        ownerRole: '',
        lockedBy: undefined,
        lockedAt: undefined,
        deleted: false,
        lastEditedBy: ctx.sender,
        lastEditedByName: nameFor(ctx, roomId),
        lastEditKind: editKind,
        updatedAt: ctx.timestamp,
      });
      logActivity(ctx, roomId, 'edit', `created ${path}`, { path, fromVersion: 0n, toVersion: 1n });
      return;
    }
    const lockFresh =
      f.lockedBy && f.lockedAt && ctx.timestamp.microsSinceUnixEpoch - f.lockedAt.microsSinceUnixEpoch < LOCK_TTL_MICROS;
    if (lockFresh && !f.lockedBy.equals(ctx.sender)) throw new SenderError('locked');
    if (f.version !== baseVersion) {
      logActivity(ctx, roomId, 'rejected', `stale edit to ${path}`, { path, fromVersion: baseVersion, toVersion: f.version });
      throw new SenderError('stale');
    }
    const toVersion = f.version + 1n;
    ctx.db.artifactFile.id.update({
      ...f,
      content,
      language,
      version: toVersion,
      deleted: false,
      lockedBy: undefined,
      lockedAt: undefined,
      lastEditedBy: ctx.sender,
      lastEditedByName: nameFor(ctx, roomId),
      lastEditKind: editKind,
      updatedAt: ctx.timestamp,
    });
    logActivity(ctx, roomId, 'edit', `edited ${path}`, { path, fromVersion: baseVersion, toVersion });
  }
);

export const claimFile = spacetimedb.reducer(
  { roomId: t.u64(), path: t.string() },
  (ctx, { roomId, path }) => {
    const f = findFile(ctx, roomId, path);
    // No-op for a not-yet-existing file: there's nothing to lock, and inserting
    // an empty v1 placeholder here races the writer's baseVersion read (causing a
    // spurious 'stale' retry) and flashes an empty file. writeFile creates it.
    if (!f) return;
    const lockFresh =
      f.lockedBy && f.lockedAt && ctx.timestamp.microsSinceUnixEpoch - f.lockedAt.microsSinceUnixEpoch < LOCK_TTL_MICROS;
    if (lockFresh && !f.lockedBy.equals(ctx.sender)) throw new SenderError('locked');
    ctx.db.artifactFile.id.update({ ...f, lockedBy: ctx.sender, lockedAt: ctx.timestamp });
  }
);

export const releaseFile = spacetimedb.reducer(
  { roomId: t.u64(), path: t.string() },
  (ctx, { roomId, path }) => {
    const f = findFile(ctx, roomId, path);
    if (f && f.lockedBy && f.lockedBy.equals(ctx.sender)) {
      ctx.db.artifactFile.id.update({ ...f, lockedBy: undefined, lockedAt: undefined });
    }
  }
);

export const setFileOwner = spacetimedb.reducer(
  { roomId: t.u64(), path: t.string(), ownerRole: t.string() },
  (ctx, { roomId, path, ownerRole }) => {
    const f = findFile(ctx, roomId, path);
    if (f) ctx.db.artifactFile.id.update({ ...f, ownerRole });
  }
);

export const deleteFile = spacetimedb.reducer(
  { roomId: t.u64(), path: t.string(), baseVersion: t.u64() },
  (ctx, { roomId, path, baseVersion }) => {
    const f = findFile(ctx, roomId, path);
    if (!f) return;
    if (f.version !== baseVersion) throw new SenderError('stale');
    ctx.db.artifactFile.id.update({ ...f, deleted: true, version: f.version + 1n, updatedAt: ctx.timestamp });
    logActivity(ctx, roomId, 'edit', `deleted ${path}`, { path });
  }
);

export const postActivity = spacetimedb.reducer(
  { roomId: t.u64(), kind: t.string(), text: t.string(), path: t.option(t.string()), intentId: t.option(t.u64()) },
  (ctx, { roomId, kind, text, path, intentId }) => {
    logActivity(ctx, roomId, kind, text, { path, intentId });
  }
);

// ---------------------------------------------------------------------------
// Benchmark / race
// ---------------------------------------------------------------------------

export const loadBenchTask = spacetimedb.reducer(
  {
    roomId: t.u64(),
    datasetId: t.string(),
    config: t.string(),
    split: t.string(),
    rowIndex: t.u64(),
    benchmarkType: t.string(),
    label: t.string(),
    prompt: t.string(),
    groundTruth: t.string(),
    choices: t.string(),
    tests: t.string(),
    entryPoint: t.string(),
    gradeUnverified: t.bool(),
    metaJson: t.string(),
  },
  (ctx, a) => {
    const r = ctx.db.room.id.find(a.roomId);
    if (!r) throw new SenderError('room not found');
    const taskRow = {
      roomId: a.roomId,
      datasetId: a.datasetId,
      config: a.config,
      split: a.split,
      rowIndex: a.rowIndex,
      benchmarkType: a.benchmarkType,
      prompt: a.prompt,
      groundTruth: a.groundTruth,
      choices: a.choices,
      tests: a.tests,
      entryPoint: a.entryPoint,
      gradeUnverified: a.gradeUnverified,
      metaJson: a.metaJson,
      loadedAt: ctx.timestamp,
    };
    if (ctx.db.benchTask.roomId.find(a.roomId)) ctx.db.benchTask.roomId.update(taskRow);
    else ctx.db.benchTask.insert(taskRow);

    const promptRow = {
      roomId: a.roomId,
      datasetId: a.datasetId,
      label: a.label,
      benchmarkType: a.benchmarkType,
      prompt: a.prompt,
      choices: a.choices,
      entryPoint: a.entryPoint,
      gradeUnverified: a.gradeUnverified,
      loadedAt: ctx.timestamp,
    };
    if (ctx.db.benchPrompt.roomId.find(a.roomId)) ctx.db.benchPrompt.roomId.update(promptRow);
    else ctx.db.benchPrompt.insert(promptRow);

    ctx.db.room.id.update({ ...r, mode: r.mode === 'race' ? 'race' : 'benchmark', prompt: a.prompt });
  }
);

export const initRaceTeams = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const r = ctx.db.room.id.find(roomId);
  if (!r) throw new SenderError('room not found');
  const existing = [...ctx.db.team.roomId.filter(roomId)];
  if (existing.length === 0) {
    const tHuman = ctx.db.team.insert({ id: 0n, roomId, kind: 'human_agent', label: 'Team Human+Agent', createdAt: ctx.timestamp });
    const tAi = ctx.db.team.insert({ id: 0n, roomId, kind: 'ai_only', label: 'Team Autonomous AI', createdAt: ctx.timestamp });
    for (const tm of [tHuman, tAi]) {
      ctx.db.score.insert({
        teamId: tm.id,
        roomId,
        bestScore: 0,
        bestPassed: false,
        attempts: 0,
        firstPassAttempt: undefined,
        firstPassAtMicros: undefined,
        votes: 0,
        updatedAt: ctx.timestamp,
      });
    }
  }
  ctx.db.room.id.update({ ...r, mode: 'race' });
});

function normalizeNumeric(s: string): string {
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/g);
  return m ? m[m.length - 1] : s.trim();
}
function normalizeMc(s: string): string {
  const m = s.toUpperCase().match(/[A-D]/);
  return m ? m[0] : s.trim().toUpperCase();
}

export const gradeDeterministic = spacetimedb.reducer(
  { roomId: t.u64(), teamId: t.u64(), candidate: t.string() },
  (ctx, { roomId, teamId, candidate }) => {
    const task = ctx.db.benchTask.roomId.find(roomId);
    if (!task) throw new SenderError('no task');
    let passed = false;
    if (task.benchmarkType === 'numeric') {
      const a = normalizeNumeric(candidate);
      const b = normalizeNumeric(task.groundTruth);
      passed = a === b || Math.abs(Number(a) - Number(b)) < 1e-6;
    } else if (task.benchmarkType === 'mc') {
      passed = normalizeMc(candidate) === normalizeMc(task.groundTruth);
    } else {
      passed = candidate.trim() === task.groundTruth.trim();
    }
    const prevAttempts = [...ctx.db.verdict.teamId.filter(teamId)].reduce((m: number, v: any) => Math.max(m, v.attempt), 0);
    const attempt = prevAttempts + 1;
    const sc = passed ? 1 : 0;
    ctx.db.verdict.insert({
      id: 0n,
      roomId,
      teamId,
      attempt,
      method: task.benchmarkType,
      verified: true,
      passed,
      passedCount: passed ? 1 : 0,
      totalCount: 1,
      score: sc,
      stdout: '',
      stderr: '',
      durationMs: 0,
      judgeNotes: '',
      submittedBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    bumpScoreForVerdict(ctx, teamId, roomId, passed, sc, attempt);
    logActivity(ctx, roomId, 'grade', `${task.benchmarkType} graded: ${passed ? 'PASS' : 'FAIL'}`);
  }
);

export const recordVerdict = spacetimedb.reducer(
  {
    roomId: t.u64(),
    teamId: t.u64(),
    method: t.string(),
    verified: t.bool(),
    passed: t.bool(),
    passedCount: t.u32(),
    totalCount: t.u32(),
    score: t.f64(),
    stdout: t.string(),
    stderr: t.string(),
    durationMs: t.u32(),
    judgeNotes: t.string(),
  },
  (ctx, a) => {
    const prevAttempts = [...ctx.db.verdict.teamId.filter(a.teamId)].reduce((m: number, v: any) => Math.max(m, v.attempt), 0);
    const attempt = prevAttempts + 1;
    ctx.db.verdict.insert({
      id: 0n,
      roomId: a.roomId,
      teamId: a.teamId,
      attempt,
      method: a.method,
      verified: a.verified,
      passed: a.passed,
      passedCount: a.passedCount,
      totalCount: a.totalCount,
      score: a.score,
      stdout: a.stdout.slice(0, 4096),
      stderr: a.stderr.slice(0, 4096),
      durationMs: a.durationMs,
      judgeNotes: a.judgeNotes,
      submittedBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    bumpScoreForVerdict(ctx, a.teamId, a.roomId, a.passed, a.score, attempt);
    logActivity(ctx, a.roomId, 'grade', `${a.method}: ${a.passed ? 'PASS' : 'FAIL'} (${a.passedCount}/${a.totalCount})`);
  }
);

export const castVote = spacetimedb.reducer(
  { roomId: t.u64(), teamId: t.u64() },
  (ctx, { roomId, teamId }) => {
    const existing = [...ctx.db.vote.roomId.filter(roomId)].find((v: any) => v.voter.equals(ctx.sender));
    if (existing) ctx.db.vote.id.update({ ...existing, teamId, createdAt: ctx.timestamp });
    else ctx.db.vote.insert({ id: 0n, roomId, voter: ctx.sender, teamId, createdAt: ctx.timestamp });
    // Recompute denormalized vote counts per team.
    for (const tm of [...ctx.db.team.roomId.filter(roomId)]) {
      const count = [...ctx.db.vote.roomId.filter(roomId)].filter((v: any) => v.teamId === tm.id).length;
      const sc = ctx.db.score.teamId.find(tm.id);
      if (sc) ctx.db.score.teamId.update({ ...sc, votes: count, updatedAt: ctx.timestamp });
    }
  }
);

// ---------------------------------------------------------------------------
// Reused: video relay + heartbeat + scheduled phase transition
// ---------------------------------------------------------------------------

export const pushFrame = spacetimedb.reducer(
  { roomId: t.u64(), data: t.byteArray() },
  (ctx, { roomId, data }) => {
    const existing = ctx.db.videoFrame.identity.find(ctx.sender);
    if (existing) ctx.db.videoFrame.identity.update({ ...existing, roomId, data, seq: existing.seq + 1n, updatedAt: ctx.timestamp });
    else ctx.db.videoFrame.insert({ identity: ctx.sender, roomId, data, seq: 0n, updatedAt: ctx.timestamp });
  }
);

export const heartbeat = spacetimedb.reducer((ctx) => upsertPresence(ctx, true));

export const onPhaseTick = spacetimedb.reducer({ timer: phaseTick.rowType }, (ctx) => {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const r of [...ctx.db.room.iter()]) {
    if (r.status === 'building' && r.deadlineAt && now > r.deadlineAt.microsSinceUnixEpoch) {
      ctx.db.room.id.update({ ...r, status: 'grading' });
    }
  }
});
