// Panel — AI Runner
// A standalone SpacetimeDB *client* that logs in as an AI identity, subscribes
// to room state, and reacts:
//   • a room goes 'active'        -> generate & post the first question
//   • a candidate submits answer  -> score it (LLM) -> advance turn -> next question
//
// Reducers can't make network calls (they must stay deterministic), so the LLM
// lives out here. The database stays the single source of truth; the AI is just
// another subscriber that happens to think.

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import { DbConnection, tables } from '../client/src/module_bindings';

const URI = process.env.SPACETIMEDB_URI ?? 'ws://127.0.0.1:3456';
const MODULE = process.env.MODULE_NAME ?? 'panel';
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
const AI_NAME = process.env.AI_NAME ?? 'AI Panel';
const TOKEN_FILE = new URL('./.ai_token', import.meta.url);

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// ---------------------------------------------------------------------------
// LLM helpers — both forced to return strict JSON that maps 1:1 to table rows.
// ---------------------------------------------------------------------------

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in model output: ' + text);
  return JSON.parse(match[0]);
}

async function nextQuestion(topic: string, transcript: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      'You are a sharp, fair technical interviewer running a live group panel. ' +
      'Ask ONE focused question that builds on the conversation so far. Keep it concise. ' +
      'Respond with ONLY JSON: {"question": "..."}',
    messages: [
      {
        role: 'user',
        content: `Topic: ${topic}\n\nTranscript so far:\n${transcript || '(none yet)'}\n\nGive the next question.`,
      },
    ],
  });
  const text = msg.content.map((b) => ('text' in b ? b.text : '')).join('');
  return extractJson(text).question;
}

async function evaluate(
  topic: string,
  question: string,
  answer: string
): Promise<{ score: number; notes: string }> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      'You are an interview evaluator. Score the candidate answer 0-10 and give one ' +
      'short, specific, constructive sentence. Respond with ONLY JSON: ' +
      '{"score": <0-10 integer>, "notes": "..."}',
    messages: [
      {
        role: 'user',
        content: `Topic: ${topic}\nQuestion: ${question}\nAnswer: ${answer}`,
      },
    ],
  });
  const text = msg.content.map((b) => ('text' in b ? b.text : '')).join('');
  const out = extractJson(text);
  const score = Math.max(0, Math.min(10, Math.round(Number(out.score) || 0)));
  return { score, notes: String(out.notes ?? '') };
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const savedToken = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : undefined;

const processedAnswers = new Set<string>();
const joinedRooms = new Set<string>();
const busyRooms = new Set<string>();

const conn = DbConnection.builder()
  .withUri(URI)
  .withDatabaseName(MODULE)
  .withToken(savedToken || undefined)
  .onConnect((ctx: any, _identity: any, token: string) => {
    if (token) fs.writeFileSync(TOKEN_FILE, token);
    console.log(`[ai] connected to ${MODULE} @ ${URI} (model: ${MODEL})`);
    ctx.subscriptionBuilder()
      .onApplied(() => console.log('[ai] subscription applied — watching rooms'))
      .subscribe([
        tables.room,
        tables.participant,
        tables.question,
        tables.answer,
      ]);
  })
  .onConnectError((_ctx: any, err: any) => console.error('[ai] connect error', err))
  .build();

function transcriptFor(roomId: bigint): string {
  const qs = [...conn.db.question.iter()]
    .filter((q: any) => q.roomId === roomId)
    .sort((a: any, b: any) =>
      Number(a.askedAt.microsSinceUnixEpoch - b.askedAt.microsSinceUnixEpoch)
    );
  const lines: string[] = [];
  for (const q of qs) {
    lines.push(`Q: ${q.text}`);
    for (const a of [...conn.db.answer.iter()].filter((a: any) => a.questionId === q.id)) {
      lines.push(`A: ${a.text}`);
    }
  }
  return lines.join('\n');
}

function topicFor(roomId: bigint): string {
  return conn.db.room.id.find(roomId)?.topic ?? 'general interview';
}

// Make sure the AI has a seat in any non-finished room.
function ensureJoined(room: any) {
  const key = room.id.toString();
  if (joinedRooms.has(key) || room.status === 'done') return;
  joinedRooms.add(key);
  console.log(`[ai] joining room ${key} — "${room.topic}"`);
  conn.reducers.joinRoom({ roomId: room.id, displayName: AI_NAME, role: 'ai' });
}

// When a room becomes active with no question yet, kick off the panel.
async function maybeAskFirst(room: any) {
  if (room.status !== 'active' || room.currentQuestionId) return;
  const key = room.id.toString();
  if (busyRooms.has(key)) return;
  busyRooms.add(key);
  try {
    const q = await nextQuestion(room.topic, transcriptFor(room.id));
    conn.reducers.postQuestion({ roomId: room.id, text: q, source: 'ai' });
    console.log(`[ai] room ${key} first question: ${q}`);
  } catch (e) {
    console.error('[ai] first-question error', e);
  } finally {
    busyRooms.delete(key);
  }
}

conn.db.room.onInsert((_ctx: any, room: any) => {
  ensureJoined(room);
  void maybeAskFirst(room);
});
conn.db.room.onUpdate((_ctx: any, _old: any, room: any) => {
  ensureJoined(room);
  void maybeAskFirst(room);
});

// The core loop: score each new answer, then drive to the next question.
conn.db.answer.onInsert(async (_ctx: any, answer: any) => {
  const key = answer.id.toString();
  if (processedAnswers.has(key)) return;
  processedAnswers.add(key);

  const room = conn.db.room.id.find(answer.roomId);
  const question = conn.db.question.id.find(answer.questionId);
  if (!room || !question) return;

  const roomKey = room.id.toString();
  while (busyRooms.has(roomKey)) await new Promise((r) => setTimeout(r, 50));
  busyRooms.add(roomKey);
  try {
    const fb = await evaluate(topicFor(room.id), question.text, answer.text);
    conn.reducers.submitFeedback({
      answerId: answer.id,
      score: fb.score,
      notes: fb.notes,
      source: 'ai',
    });
    console.log(`[ai] scored answer ${key}: ${fb.score}/10`);

    // Rotate to the next candidate and ask the next question.
    conn.reducers.advanceTurn({ roomId: room.id });
    const q = await nextQuestion(topicFor(room.id), transcriptFor(room.id));
    conn.reducers.postQuestion({ roomId: room.id, text: q, source: 'ai' });
    console.log(`[ai] next question: ${q}`);
  } catch (e) {
    console.error('[ai] answer-loop error', e);
  } finally {
    busyRooms.delete(roomKey);
  }
});

process.on('SIGINT', () => {
  console.log('\n[ai] shutting down');
  process.exit(0);
});
