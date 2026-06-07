// Client-side mirror of the Hugging Face benchmark catalog (ai-runner/hf.ts).
// Used by the Lobby task picker. The actual fetch happens in the runner; the
// client just lets the user pick which task to load.

export type BenchmarkType = 'numeric' | 'mc' | 'code' | 'freeform';

export const CATALOG: { label: string; dataset: string; config: string; split: string; type: BenchmarkType }[] = [
  { label: 'GSM8K (grade-school math)', dataset: 'openai/gsm8k', config: 'main', split: 'test', type: 'numeric' },
  { label: 'MMLU — Anatomy', dataset: 'cais/mmlu', config: 'anatomy', split: 'test', type: 'mc' },
  { label: 'MMLU — College CS', dataset: 'cais/mmlu', config: 'college_computer_science', split: 'test', type: 'mc' },
  { label: 'HumanEval (code, test-graded)', dataset: 'openai/openai_humaneval', config: 'openai_humaneval', split: 'test', type: 'code' },
  { label: 'SWE-bench Verified (code, judge-only)', dataset: 'princeton-nlp/SWE-bench_Verified', config: 'default', split: 'test', type: 'code' },
];

export const MODES: { key: string; label: string; desc: string }[] = [
  { key: 'build', label: 'Free Build', desc: 'Humans + agents build a web app from a prompt, live.' },
  { key: 'benchmark', label: 'Benchmark', desc: 'Solve a real Hugging Face task; graded live.' },
  { key: 'race', label: 'Race', desc: 'Human+agent team vs autonomous AI team on the same task.' },
];
