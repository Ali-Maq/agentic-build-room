// Hugging Face benchmark integration — anonymous-first (no token needed for
// public datasets). Lets a user pick ANY benchmark + ANY question and fetch it
// live via the datasets-server REST API, WITHOUT downloading the dataset.
//
// All of this runs in the RUNNER (a SpacetimeDB client), never in a reducer.
//
// VERIFY ON DAY 1 (30s, once Bash/classifier is back): the per-dataset field
// names below are from HF schemas/docs; confirm with a real /rows curl, e.g.
//   curl 'https://datasets-server.huggingface.co/rows?dataset=openai/gsm8k&config=main&split=test&offset=0&length=1'

const DS = 'https://datasets-server.huggingface.co';
const HUB = 'https://huggingface.co/api';

function auth(): Record<string, string> {
  const t = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
  return t ? { authorization: `Bearer ${t}` } : {};
}

export type DatasetInfo = { id: string; downloads: number; likes: number; tags: string[] };
export type Split = { dataset: string; config: string; split: string };
export type RowsResp = {
  features: { name: string; type: any }[];
  rows: { row_idx: number; row: Record<string, any> }[];
  num_rows_total: number;
  partial: boolean;
};

export type BenchmarkType = 'numeric' | 'mc' | 'code' | 'freeform';
export type Question = {
  datasetId: string; config: string; split: string; rowIndex: number;
  benchmarkType: BenchmarkType;
  prompt: string;            // what we show both sides
  groundTruth: string;       // hidden answer (kept server-side / public:false)
  choices?: string[];        // for mc
  tests?: string;            // for code (unit tests to execute)
  entryPoint?: string;       // for code (function name)
  meta?: Record<string, any>;
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: auth() });
  if (!res.ok) throw new Error(`HF ${res.status} ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Discover benchmarks (fuzzy search on dataset id; sorted by downloads).
export async function listDatasets(search: string, limit = 25): Promise<DatasetInfo[]> {
  const u = `${HUB}/datasets?search=${encodeURIComponent(search)}&sort=downloads&direction=-1&limit=${limit}&full=true`;
  const arr = await getJson(u);
  return arr.map((d: any) => ({
    id: d.id, downloads: d.downloads ?? 0, likes: d.likes ?? 0, tags: d.tags ?? [],
  }));
}

// Capability probe: viewer=false && preview=false => gated/unavailable.
export async function isValid(dataset: string): Promise<{ viewer: boolean; preview: boolean; search: boolean; filter: boolean }> {
  return getJson(`${DS}/is-valid?dataset=${encodeURIComponent(dataset)}`);
}

export async function splits(dataset: string): Promise<Split[]> {
  const j = await getJson(`${DS}/splits?dataset=${encodeURIComponent(dataset)}`);
  return j.splits ?? [];
}

export async function fetchRows(dataset: string, config: string, split: string, offset: number, length = 1): Promise<RowsResp> {
  const u = `${DS}/rows?dataset=${encodeURIComponent(dataset)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}&offset=${offset}&length=${Math.min(length, 100)}`;
  return getJson(u);
}

export async function numRows(dataset: string, config: string, split: string): Promise<number> {
  const head = await fetchRows(dataset, config, split, 0, 1);
  return head.num_rows_total;
}

// ---- Per-dataset adapters: row -> {prompt, groundTruth, type, ...} ---------
// Keyed by dataset id; falls back to a heuristic field scan for unknown datasets.
type Adapter = (row: Record<string, any>, config: string) => Omit<Question, 'datasetId' | 'config' | 'split' | 'rowIndex'>;

const ADAPTERS: Record<string, Adapter> = {
  // GSM8K: numeric. answer field ends with "#### <int>".
  'openai/gsm8k': (r) => {
    const a = String(r.answer ?? '');
    const gt = (a.match(/####\s*(-?[\d,]+)/)?.[1] ?? a).replace(/,/g, '').trim();
    return { benchmarkType: 'numeric', prompt: String(r.question ?? ''), groundTruth: gt, meta: { fullAnswer: a } };
  },
  'gsm8k': (r) => ADAPTERS['openai/gsm8k'](r, 'main'),

  // MMLU: multiple choice. answer is an int index 0-3 into choices[4].
  'cais/mmlu': (r) => {
    const choices: string[] = r.choices ?? [];
    const idx = typeof r.answer === 'number' ? r.answer : Number(r.answer);
    const letter = ['A', 'B', 'C', 'D'][idx] ?? String(r.answer);
    const prompt = `${r.question}\n\n${choices.map((c, i) => `${['A', 'B', 'C', 'D'][i]}. ${c}`).join('\n')}`;
    return { benchmarkType: 'mc', prompt, groundTruth: letter, choices, meta: { answerIndex: idx } };
  },

  // HumanEval: code. CAN be graded live by executing candidate + tests (sandboxed).
  'openai/openai_humaneval': (r) => ({
    benchmarkType: 'code',
    prompt: String(r.prompt ?? ''),
    groundTruth: String(r.canonical_solution ?? ''),
    tests: String(r.test ?? ''),
    entryPoint: String(r.entry_point ?? ''),
    meta: { taskId: r.task_id },
  }),
  'openai_humaneval': (r) => ADAPTERS['openai/openai_humaneval'](r, 'openai_humaneval'),

  // SWE-bench: code, but real grading needs repo+Docker -> judge-only (badge).
  'princeton-nlp/SWE-bench_Verified': (r) => ({
    benchmarkType: 'code',
    prompt: String(r.problem_statement ?? ''),
    groundTruth: String(r.patch ?? ''),
    meta: { repo: r.repo, base_commit: r.base_commit, instance_id: r.instance_id, gradeUnverified: true },
  }),
};

function heuristic(row: Record<string, any>): Omit<Question, 'datasetId' | 'config' | 'split' | 'rowIndex'> {
  const keys = Object.keys(row);
  const qk = keys.find((k) => /question|problem|prompt|input|query/i.test(k)) ?? keys[0];
  const ak = keys.find((k) => /answer|label|solution|target|output/i.test(k));
  return {
    benchmarkType: 'freeform',
    prompt: String(row[qk] ?? ''),
    groundTruth: ak ? String(row[ak]) : '',
    meta: { heuristic: true, fields: keys },
  };
}

export function extractQuestion(s: Split, rowIndex: number, row: Record<string, any>): Question {
  const adapter = ADAPTERS[s.dataset];
  const base = adapter ? adapter(row, s.config) : heuristic(row);
  return { datasetId: s.dataset, config: s.config, split: s.split, rowIndex, ...base };
}

// Convenience: fetch one (optionally random) question from a split.
export async function pickQuestion(s: Split, rowIndex?: number): Promise<Question> {
  const total = await numRows(s.dataset, s.config, s.split);
  const idx = rowIndex ?? Math.floor((total - 1) * fraction());
  const resp = await fetchRows(s.dataset, s.config, s.split, idx, 1);
  return extractQuestion(s, idx, resp.rows[0]?.row ?? {});
}

// Deterministic-ish spread without Math.random at import time; good enough for picks.
let _n = 7;
function fraction(): number { _n = (_n * 1103515245 + 12345) & 0x7fffffff; return (_n % 1000) / 1000; }

// Curated launch catalog (public/ungated, no token needed).
export const CATALOG: { label: string; dataset: string; config: string; split: string; type: BenchmarkType }[] = [
  { label: 'GSM8K (grade-school math)', dataset: 'openai/gsm8k', config: 'main', split: 'test', type: 'numeric' },
  { label: 'MMLU — Anatomy', dataset: 'cais/mmlu', config: 'anatomy', split: 'test', type: 'mc' },
  { label: 'MMLU — College CS', dataset: 'cais/mmlu', config: 'college_computer_science', split: 'test', type: 'mc' },
  { label: 'HumanEval (code, test-graded)', dataset: 'openai/openai_humaneval', config: 'openai_humaneval', split: 'test', type: 'code' },
  { label: 'SWE-bench Verified (code, judge-only)', dataset: 'princeton-nlp/SWE-bench_Verified', config: 'default', split: 'test', type: 'code' },
];
