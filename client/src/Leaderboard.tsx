type Score = {
  teamId: bigint;
  roomId: bigint;
  bestScore: number;
  bestPassed: boolean;
  attempts: number;
  firstPassAttempt?: number;
  firstPassAtMicros?: bigint;
  votes: number;
};

type Team = { id: bigint; label: string; kind: string };

/**
 * Leaderboard — ranks teams. Passing teams win over non-passing; among passers,
 * earliest first-pass wins; then more votes; then higher best score.
 * Subscription-driven: pass the live `score` rows (and optional `team` rows for
 * human-readable labels).
 */
export default function Leaderboard({
  scores,
  teams = [],
}: {
  scores: Score[];
  teams?: Team[];
}) {
  const FAR = 9_999_999_999_999_999n;
  const labelFor = (teamId: bigint) =>
    teams.find((t) => t.id === teamId)?.label ?? `Team ${teamId.toString()}`;
  const kindFor = (teamId: bigint) =>
    teams.find((t) => t.id === teamId)?.kind ?? '';

  const ranked = [...scores].sort((a, b) => {
    if (a.bestPassed !== b.bestPassed) return a.bestPassed ? -1 : 1;
    const fa = a.firstPassAtMicros ?? FAR;
    const fb = b.firstPassAtMicros ?? FAR;
    if (fa !== fb) return fa < fb ? -1 : 1;
    if (b.votes !== a.votes) return b.votes - a.votes;
    return b.bestScore - a.bestScore;
  });

  if (ranked.length === 0) {
    return (
      <div className="leaderboard empty muted small">No scores yet.</div>
    );
  }

  return (
    <div className="leaderboard">
      <h3>Leaderboard</h3>
      <ol className="lb-list">
        {ranked.map((s, i) => {
          const kind = kindFor(s.teamId);
          return (
            <li key={s.teamId.toString()} className={`lb-row ${i === 0 ? 'lead' : ''}`}>
              <span className="lb-rank">{i === 0 ? '🏆' : `#${i + 1}`}</span>
              <span className="lb-name">
                {labelFor(s.teamId)}
                {kind && (
                  <span className={`role-pill ${kind === 'ai_only' ? 'agent' : 'human'}`}>
                    {kind === 'ai_only' ? 'AI' : 'H+AI'}
                  </span>
                )}
              </span>
              <span className="lb-stat">
                {s.bestPassed ? (
                  <span className="verdict-pass">✓ passed</span>
                ) : (
                  <span className="muted">{s.bestScore.toFixed(2)}</span>
                )}
              </span>
              <span className="lb-stat muted small">{s.attempts} att</span>
              <span className="lb-stat muted small">👍 {s.votes}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
