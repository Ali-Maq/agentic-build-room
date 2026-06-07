// Structural type so BOTH the full generated verdict row (BuildRoom) and the
// race's local verdict shape (RaceView) satisfy it without coupling to the
// generated type name.
type Verdict = {
  verified: boolean;
  passed: boolean;
  method: string;
  score: number;
  passedCount: number;
  totalCount: number;
  attempt: number;
  durationMs: number;
  judgeNotes: string;
  stdout: string;
  stderr: string;
  createdAt: { microsSinceUnixEpoch: bigint };
};

const METHOD_LABEL: Record<string, string> = {
  'unit-test': 'Unit tests',
  numeric: 'Numeric check',
  mc: 'Multiple choice',
  'llm-judge': 'LLM judge',
};

// Shown in place of the live preview for code/benchmark rooms. Pass/fail summary
// driven by the verdict subscription. When the verdict is unverified (e.g. an
// LLM judge instead of real unit tests) it renders the amber 'NOT TEST-VERIFIED'
// state so unverified scores are never mistaken for verified ones.
export default function VerdictCard({ verdict }: { verdict?: Verdict }) {
  if (!verdict) {
    return (
      <div className="verdict pending">
        <div className="verdict-head">No verdict yet</div>
        <p className="muted small">
          Run the grader (or finish the build) to evaluate the artifact.
        </p>
      </div>
    );
  }

  const state = !verdict.verified ? 'unverified' : verdict.passed ? 'pass' : 'fail';
  const method = METHOD_LABEL[verdict.method] ?? verdict.method;
  const ts = new Date(Number(verdict.createdAt.microsSinceUnixEpoch / 1000n));

  return (
    <div className={`verdict ${state}`}>
      <div className="verdict-head">
        <span className="verdict-icon">
          {state === 'pass' ? '✓' : state === 'fail' ? '✗' : '⚠'}
        </span>
        <span className="verdict-title">
          {state === 'pass' ? 'PASS' : state === 'fail' ? 'FAIL' : 'GRADED'}
        </span>
        <span className="verdict-method">{method}</span>
      </div>

      {!verdict.verified && (
        <div className="grade-pill unverified verdict-banner">NOT TEST-VERIFIED</div>
      )}

      {verdict.totalCount > 0 && (
        <div className="verdict-tests">
          <strong>
            {verdict.passedCount}/{verdict.totalCount}
          </strong>{' '}
          tests passed
        </div>
      )}

      {Number.isFinite(verdict.score) && (
        <div className="verdict-score small muted">score {verdict.score.toFixed(3)}</div>
      )}

      {verdict.judgeNotes && (
        <div className="verdict-notes small">{verdict.judgeNotes}</div>
      )}

      {verdict.stderr && (
        <pre className="verdict-out err">{verdict.stderr}</pre>
      )}
      {verdict.stdout && !verdict.stderr && (
        <pre className="verdict-out">{verdict.stdout}</pre>
      )}

      <div className="verdict-foot small muted">
        attempt {verdict.attempt}
        {verdict.durationMs > 0 && ` · ${verdict.durationMs}ms`}
        {' · '}
        {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
