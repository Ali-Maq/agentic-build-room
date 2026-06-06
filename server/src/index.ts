// Panel — Live Group AI Interview Room
// SpacetimeDB module: ALL shared room state lives here. Every client renders
// purely from subscriptions to these tables. Reducers are the only write path
// and are fully deterministic (no network/clock/random except via ctx).

import { schema, table, t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

// ---------------------------------------------------------------------------
// Tables (all public so clients can subscribe directly)
// ---------------------------------------------------------------------------

const room = table(
  { name: 'room', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    topic: t.string(),
    status: t.string(), // 'lobby' | 'active' | 'done'
    currentQuestionId: t.option(t.u64()),
    currentTurn: t.option(t.identity()),
    turnStartedAt: t.option(t.timestamp()), // for the scheduled auto-advance
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
    role: t.string(), // 'candidate' | 'mentor' | 'ai'
    seat: t.i32(),
    online: t.bool(),
    joinedAt: t.timestamp(),
  }
);

const question = table(
  { name: 'question', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    text: t.string(),
    source: t.string(), // 'ai' | 'mentor'
    askedAt: t.timestamp(),
  }
);

const answer = table(
  { name: 'answer', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    questionId: t.u64().index('btree'),
    roomId: t.u64().index('btree'),
    identity: t.identity(),
    text: t.string(),
    submittedAt: t.timestamp(),
  }
);

const feedback = table(
  { name: 'feedback', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    answerId: t.u64().index('btree'),
    roomId: t.u64().index('btree'),
    score: t.i32(), // 0..10
    notes: t.string(),
    source: t.string(), // 'ai' | 'mentor'
    createdAt: t.timestamp(),
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

// Live video relayed THROUGH the database — no WebRTC, no media server.
// One row per sender, updated in place each frame to keep the table tiny;
// every subscriber gets the new JPEG bytes pushed instantly.
const videoFrame = table(
  { name: 'video_frame', public: true },
  {
    identity: t.identity().primaryKey(),
    roomId: t.u64().index('btree'),
    data: t.byteArray(), // JPEG-encoded frame
    seq: t.u64(),
    updatedAt: t.timestamp(),
  }
);

// Scheduled table: drives a periodic server-side "tick" so turn rotation has a
// DB-native fallback even if no client (or the AI runner) is driving it. This is
// SpacetimeDB's signature scheduled-reducer feature — time-based logic INSIDE the
// database, no external cron/process.
const phaseTick = table(
  {
    name: 'phase_tick',
    scheduled: (): any => onPhaseTick, // (): any => breaks the circular dep
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const spacetimedb = schema({
  room,
  participant,
  question,
  answer,
  feedback,
  presence,
  videoFrame,
  phaseTick,
});
export default spacetimedb;

const TURN_TIMEOUT_MICROS = 90_000_000n; // 90s

// Start the heartbeat once, at module init.
export const init = spacetimedb.init((ctx) => {
  ctx.db.phaseTick.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(10_000_000n), // every 10s
  });
});

// Auto-advance any active room whose current turn has stalled past the timeout.
export const onPhaseTick = spacetimedb.reducer(
  { timer: phaseTick.rowType },
  (ctx) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;
    for (const r of [...ctx.db.room.iter()]) {
      if (r.status !== 'active' || !r.turnStartedAt) continue;
      if (now - r.turnStartedAt.microsSinceUnixEpoch <= TURN_TIMEOUT_MICROS) continue;
      const candidates = [...ctx.db.participant.roomId.filter(r.id)]
        .filter((p: any) => p.role === 'candidate' && p.online)
        .sort((a: any, b: any) => a.seat - b.seat);
      if (!candidates.length) {
        ctx.db.room.id.update({ ...r, currentTurn: undefined, turnStartedAt: ctx.timestamp });
        continue;
      }
      let nextIdx = 0;
      if (r.currentTurn) {
        const cur = candidates.findIndex((p: any) => p.identity.equals(r.currentTurn));
        nextIdx = cur === -1 ? 0 : (cur + 1) % candidates.length;
      }
      ctx.db.room.id.update({
        ...r,
        currentTurn: candidates[nextIdx].identity,
        turnStartedAt: ctx.timestamp,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function participantsInRoom(ctx: any, roomId: bigint) {
  return [...ctx.db.participant.roomId.filter(roomId)];
}

function findMyParticipant(ctx: any, roomId: bigint) {
  return participantsInRoom(ctx, roomId).find((p: any) => p.identity.equals(ctx.sender));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function upsertPresence(ctx: any, online: boolean) {
  const existing = ctx.db.presence.identity.find(ctx.sender);
  if (existing) {
    ctx.db.presence.identity.update({ ...existing, online, lastSeen: ctx.timestamp });
  } else {
    ctx.db.presence.insert({ identity: ctx.sender, online, lastSeen: ctx.timestamp });
  }
}

export const onConnect = spacetimedb.clientConnected((ctx) => {
  upsertPresence(ctx, true);
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  upsertPresence(ctx, false);
  // Mark this identity offline in any room they were in.
  for (const p of [...ctx.db.participant.iter()]) {
    if (p.identity.equals(ctx.sender) && p.online) {
      ctx.db.participant.id.update({ ...p, online: false });
    }
  }
  // Stop relaying their video.
  if (ctx.db.videoFrame.identity.find(ctx.sender)) {
    ctx.db.videoFrame.identity.delete(ctx.sender);
  }
});

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

// Create a room AND seat the creator (so the client can locate "my room" by
// querying participant where identity == me — reducers can't return values).
export const createRoom = spacetimedb.reducer(
  { topic: t.string(), displayName: t.string() },
  (ctx, { topic, displayName }) => {
    const created = ctx.db.room.insert({
      id: 0n,
      topic,
      status: 'lobby',
      currentQuestionId: undefined,
      currentTurn: undefined,
      turnStartedAt: undefined,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    ctx.db.participant.insert({
      id: 0n,
      roomId: created.id,
      identity: ctx.sender,
      displayName,
      role: 'candidate',
      seat: 0,
      online: true,
      joinedAt: ctx.timestamp,
    });
  }
);

export const joinRoom = spacetimedb.reducer(
  { roomId: t.u64(), displayName: t.string(), role: t.string() },
  (ctx, { roomId, displayName, role }) => {
    if (!ctx.db.room.id.find(roomId)) throw new SenderError('room not found');
    const existing = findMyParticipant(ctx, roomId);
    if (existing) {
      ctx.db.participant.id.update({ ...existing, online: true, displayName, role });
      return;
    }
    const seat = participantsInRoom(ctx, roomId).length;
    ctx.db.participant.insert({
      id: 0n,
      roomId,
      identity: ctx.sender,
      displayName,
      role,
      seat,
      online: true,
      joinedAt: ctx.timestamp,
    });
  }
);

export const leaveRoom = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const me = findMyParticipant(ctx, roomId);
  if (me) ctx.db.participant.id.update({ ...me, online: false });
  if (ctx.db.videoFrame.identity.find(ctx.sender)) {
    ctx.db.videoFrame.identity.delete(ctx.sender);
  }
});

// Publish one webcam frame (JPEG bytes). Upserts the sender's single row so the
// table stays at one row per participant; subscribers get an onUpdate per frame.
export const pushFrame = spacetimedb.reducer(
  { roomId: t.u64(), data: t.byteArray() },
  (ctx, { roomId, data }) => {
    const existing = ctx.db.videoFrame.identity.find(ctx.sender);
    if (existing) {
      ctx.db.videoFrame.identity.update({
        ...existing,
        roomId,
        data,
        seq: existing.seq + 1n,
        updatedAt: ctx.timestamp,
      });
    } else {
      ctx.db.videoFrame.insert({
        identity: ctx.sender,
        roomId,
        data,
        seq: 0n,
        updatedAt: ctx.timestamp,
      });
    }
  }
);

// A human mentor drops into an existing session.
export const claimMentorSeat = spacetimedb.reducer(
  { roomId: t.u64(), displayName: t.string() },
  (ctx, { roomId, displayName }) => {
    if (!ctx.db.room.id.find(roomId)) throw new SenderError('room not found');
    const me = findMyParticipant(ctx, roomId);
    if (me) {
      ctx.db.participant.id.update({ ...me, role: 'mentor', online: true, displayName });
      return;
    }
    const seat = participantsInRoom(ctx, roomId).length;
    ctx.db.participant.insert({
      id: 0n, roomId, identity: ctx.sender, displayName,
      role: 'mentor', seat, online: true, joinedAt: ctx.timestamp,
    });
  }
);

export const startSession = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const r = ctx.db.room.id.find(roomId);
  if (!r) throw new SenderError('room not found');
  const candidates = participantsInRoom(ctx, roomId)
    .filter((p: any) => p.role === 'candidate' && p.online)
    .sort((a: any, b: any) => a.seat - b.seat);
  ctx.db.room.id.update({
    ...r,
    status: 'active',
    currentTurn: candidates.length ? candidates[0].identity : undefined,
    turnStartedAt: ctx.timestamp,
  });
});

// Written by the AI runner (source 'ai') or a human mentor (source 'mentor').
export const postQuestion = spacetimedb.reducer(
  { roomId: t.u64(), text: t.string(), source: t.string() },
  (ctx, { roomId, text, source }) => {
    const r = ctx.db.room.id.find(roomId);
    if (!r) throw new SenderError('room not found');
    const q = ctx.db.question.insert({
      id: 0n, roomId, text, source, askedAt: ctx.timestamp,
    });
    ctx.db.room.id.update({ ...r, currentQuestionId: q.id, turnStartedAt: ctx.timestamp });
  }
);

export const submitAnswer = spacetimedb.reducer(
  { questionId: t.u64(), text: t.string() },
  (ctx, { questionId, text }) => {
    const q = ctx.db.question.id.find(questionId);
    if (!q) throw new SenderError('question not found');
    ctx.db.answer.insert({
      id: 0n, questionId, roomId: q.roomId,
      identity: ctx.sender, text, submittedAt: ctx.timestamp,
    });
  }
);

export const submitFeedback = spacetimedb.reducer(
  { answerId: t.u64(), score: t.i32(), notes: t.string(), source: t.string() },
  (ctx, { answerId, score, notes, source }) => {
    const a = ctx.db.answer.id.find(answerId);
    if (!a) throw new SenderError('answer not found');
    ctx.db.feedback.insert({
      id: 0n, answerId, roomId: a.roomId, score, notes, source, createdAt: ctx.timestamp,
    });
  }
);

// Rotate the active turn to the next online candidate by seat order.
export const advanceTurn = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const r = ctx.db.room.id.find(roomId);
  if (!r) throw new SenderError('room not found');
  const candidates = participantsInRoom(ctx, roomId)
    .filter((p: any) => p.role === 'candidate' && p.online)
    .sort((a: any, b: any) => a.seat - b.seat);
  if (!candidates.length) {
    ctx.db.room.id.update({ ...r, currentTurn: undefined, turnStartedAt: ctx.timestamp });
    return;
  }
  let nextIdx = 0;
  if (r.currentTurn) {
    const curIdx = candidates.findIndex((p: any) => p.identity.equals(r.currentTurn));
    nextIdx = curIdx === -1 ? 0 : (curIdx + 1) % candidates.length;
  }
  ctx.db.room.id.update({
    ...r,
    currentTurn: candidates[nextIdx].identity,
    turnStartedAt: ctx.timestamp,
  });
});

export const heartbeat = spacetimedb.reducer((ctx) => {
  upsertPresence(ctx, true);
});
