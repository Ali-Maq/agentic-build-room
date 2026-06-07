// Panel — Grader
// ----------------------------------------------------------------------------
// Turns a team's candidate submission into a verdict. Three lanes, by benchmark
// type, chosen so each verdict carries an honest "verified?" badge:
//
//   code  && !gradeUnverified -> runUnitTests(): execute candidate + the dataset
//                                unit tests in a sandboxed python child process,
//                                then recordVerdict(verified:true, 'unit-test').
//   code  &&  gradeUnverified -> llmJudge(): no executable harness (e.g. SWE-bench
//                                needs a repo+Docker) -> recordVerdict(
//                                verified:false, 'llm-judge').
//   numeric | mc              -> gradeDeterministic(reducer): exact-match grading
//                                lives in the module (deterministic), so we just
//                                forward the candidate to the reducer.
//   freeform                  -> llmJudge(verified:false).
//
// The python sandbox is the load-bearing safety piece: mkdtemp -> write
// prompt+candidate+tests+check(entryPoint) -> spawn /bin/sh -c
// 'ulimit -t 5; exec python3 candidate.py' with a wall-clock timeout, SIGKILL,
// and env:{PATH} ONLY (NO API keys), then rmSync the dir no matter what.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { generate, ROSTER } from './llm';

export type BenchmarkType = 'numeric' | 'mc' | 'code' | 'freeform';

export type GradeInput = {
  roomId: bigint;
  teamId: bigint;
  candidate: string; // the team's answer (code, number, letter, or prose)
  benchmarkType: BenchmarkType;
  prompt: string;
  groundTruth?: string;
  tests?: string; // code: the dataset's unit-test source
  entryPoint?: string; // code: the function name under test
  gradeUnverified?: boolean; // code: true => cannot run tests, judge only
  choices?: string[]; // mc
};

export type GradeResult = {
  method: 'unit-test' | 'numeric' | 'mc' | 'llm-judge';
  verified: boolean;
  passed: boolean;
  passedCount: number;
  totalCount: number;
  score: number; // 0..1
  stdout: string;
  stderr: string;
  durationMs: number;
  judgeNotes: string;
  deterministic: boolean; // true => caller should use gradeDeterministic reducer
};

const TIMEOUT_MS = Number(process.env.GRADE_TIMEOUT_MS ?? 6000);

// ---------------------------------------------------------------------------
// Top-level dispatcher.
// ---------------------------------------------------------------------------
export async function grade(input: GradeInput): Promise<GradeResult> {
  switch (input.benchmarkType) {
    case 'code':
      if (input.gradeUnverified) return llmJudge(input);
      // No executable tests available -> can't verify; fall back to the judge.
      if (!input.tests || !input.tests.trim()) {
        const r = await llmJudge(input);
        r.judgeNotes = `[no unit tests available — judged, not test-verified] ${r.judgeNotes}`;
        return r;
      }
      return runUnitTests(input);
    case 'numeric':
    case 'mc':
      // Exact-match grading is deterministic and lives in the reducer; the
      // grader-runner forwards the candidate via gradeDeterministic().
      return {
        method: input.benchmarkType,
        verified: true,
        passed: false,
        passedCount: 0,
        totalCount: 1,
        score: 0,
        stdout: '',
        stderr: '',
        durationMs: 0,
        judgeNotes: 'graded deterministically by the module reducer',
        deterministic: true,
      };
    case 'freeform':
    default:
      return llmJudge(input);
  }
}

// ---------------------------------------------------------------------------
// Sandboxed python unit-test execution (verified lane).
// ---------------------------------------------------------------------------
export async function runUnitTests(input: GradeInput): Promise<GradeResult> {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-grade-'));
  try {
    const program = buildPythonHarness(input);
    fs.writeFileSync(path.join(dir, 'candidate.py'), program, 'utf8');

    const { code, stdout, stderr, timedOut } = await runPython(dir);
    const durationMs = Date.now() - started;

    // Harness prints a final JSON line: {"passed":n,"total":m,"ok":bool}.
    const summary = parseSummary(stdout);
    let passedCount = summary?.passed ?? 0;
    let totalCount = summary?.total ?? 0;
    let passed = !!summary?.ok && !timedOut && code === 0;

    if (timedOut) {
      passed = false;
      if (totalCount === 0) totalCount = 1;
    }
    // If the harness never printed a summary (crash/syntax error), it's a fail.
    if (!summary) {
      passed = false;
      if (totalCount === 0) totalCount = 1;
    }
    const score = totalCount > 0 ? passedCount / totalCount : passed ? 1 : 0;

    return {
      method: 'unit-test',
      verified: true,
      passed,
      passedCount,
      totalCount,
      score,
      stdout: cap(stdout, 4000),
      stderr: cap((timedOut ? `[timeout after ${TIMEOUT_MS}ms]\n` : '') + stderr, 4000),
      durationMs,
      judgeNotes: '',
      deterministic: false,
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

// The dataset's `tests` source defines check(<entryPoint>). We append a tiny
// driver that imports nothing external, runs check(), counts asserts, and prints
// a machine-readable summary. The candidate code is prepended verbatim.
function buildPythonHarness(input: GradeInput): string {
  const entry = (input.entryPoint || '').trim() || 'solution';
  const tests = input.tests || '';
  // The HumanEval-style `prompt` is the function signature/docstring stub; the
  // candidate is expected to be the full function body/definition. Concatenate
  // prompt + candidate so a model that returned only the body still defines the
  // function. If the candidate already defines `entry`, the prompt stub is a
  // harmless redefinition shadowed below; to be safe we run candidate alone if
  // it already contains a `def <entry>`.
  const candidate = input.candidate || '';
  const candidateDefinesEntry = new RegExp(`def\\s+${escapeRe(entry)}\\b`).test(candidate);
  const body = candidateDefinesEntry ? candidate : `${input.prompt}\n${candidate}`;

  return [
    '# --- candidate (untrusted) ---',
    body,
    '',
    '# --- dataset tests ---',
    tests,
    '',
    '# --- driver ---',
    'import json, sys, traceback',
    'def __run():',
    '    passed = 0',
    '    total = 0',
    '    ok = True',
    '    try:',
    `        check(${entry})`,
    '        # If check() used asserts and did not raise, treat as 1/1.',
    '        passed = 1; total = 1',
    '    except AssertionError as e:',
    '        ok = False; total = 1; passed = 0',
    '        traceback.print_exc()',
    '    except Exception as e:',
    '        ok = False; total = 1; passed = 0',
    '        traceback.print_exc()',
    '    print(json.dumps({"passed": passed, "total": total, "ok": ok}))',
    'if __name__ == "__main__":',
    '    __run()',
    '',
  ].join('\n');
}

function runPython(
  dir: string
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    // ulimit -t 5 caps CPU seconds inside the shell; the outer timeout caps wall
    // clock. env is PATH-only so leaked secrets can never reach untrusted code.
    const child = spawn('/bin/sh', ['-c', 'ulimit -t 5; exec python3 candidate.py'], {
      cwd: dir,
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => (stderr += `\n[spawn error] ${e.message}`));
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL') timedOut = true;
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function parseSummary(stdout: string): { passed: number; total: number; ok: boolean } | undefined {
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (!s.startsWith('{')) continue;
    try {
      const j = JSON.parse(s);
      if (typeof j.passed === 'number' && typeof j.total === 'number') {
        return { passed: j.passed, total: j.total, ok: !!j.ok };
      }
    } catch {}
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// LLM judge (unverified lane: code-needs-repo, freeform).
// ---------------------------------------------------------------------------
export async function llmJudge(input: GradeInput): Promise<GradeResult> {
  const started = Date.now();
  const roster = ROSTER['judge'] ?? ROSTER['solver'];
  const refBlock = input.groundTruth
    ? `\nREFERENCE / GROUND TRUTH (may be a patch or canonical answer):\n${input.groundTruth}\n`
    : '';
  const system =
    'You are a strict, fair grader. You CANNOT execute code. Judge whether the ' +
    'candidate answer correctly and completely satisfies the task. Be skeptical: ' +
    'plausible-looking but wrong answers fail. Respond with ONLY JSON: ' +
    '{"passed": <bool>, "score": <0..1 number>, "notes": "<one or two sentences>"}.';
  const user =
    `TASK:\n${input.prompt}\n${refBlock}\nCANDIDATE ANSWER:\n${input.candidate}\n`;

  let passed = false;
  let score = 0;
  let notes = '';
  try {
    const res = await generate({
      provider: roster.provider,
      model: roster.model,
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0,
      maxOutputTokens: 512,
      jsonSchema: {
        type: 'object',
        properties: {
          passed: { type: 'boolean' },
          score: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['passed', 'score', 'notes'],
      },
    });
    const j = res.json ?? {};
    passed = !!j.passed;
    score = clamp01(Number(j.score));
    notes = String(j.notes ?? '');
  } catch (e: any) {
    notes = `judge error: ${e?.message ?? e}`;
  }

  return {
    method: 'llm-judge',
    verified: false, // an LLM opinion is NOT test-verified
    passed,
    passedCount: passed ? 1 : 0,
    totalCount: 1,
    score,
    stdout: '',
    stderr: '',
    durationMs: Date.now() - started,
    judgeNotes: notes,
    deterministic: false,
  };
}

// ---------------------------------------------------------------------------
function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s;
}
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
