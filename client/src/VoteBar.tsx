import { DbConnection } from './module_bindings';

type Score = { teamId: bigint; roomId: bigint; votes: number };

/**
 * VoteBar — cast a vote for a team and show the live tally.
 *
 * Two usage shapes:
 *  - Single team button:  <VoteBar conn roomId teamId score={scoreRow} label? />
 *  - Multi-team bar:       <VoteBar conn roomId scores={[...]} teams={[...]} />
 *
 * Vote counts are read live from the `score` row(s) (subscription-driven);
 * casting is fire-and-forget via the castVote reducer.
 */
export default function VoteBar({
  conn,
  roomId,
  teamId,
  score,
  scores,
  teams,
  label,
}: {
  conn: DbConnection;
  roomId: bigint;
  teamId?: bigint;
  score?: Score;
  scores?: Score[];
  teams?: { id: bigint; label: string }[];
  label?: string;
}) {
  const vote = (tid: bigint) => conn.reducers.castVote({ roomId, teamId: tid });

  // ----- Multi-team bar -----
  if (scores && teams) {
    const total = scores.reduce((n, s) => n + (s.votes ?? 0), 0) || 0;
    return (
      <div className="votebar multi">
        {teams.map((t) => {
          const s = scores.find((x) => x.teamId === t.id);
          const v = s?.votes ?? 0;
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          return (
            <button
              key={t.id.toString()}
              className="vote-btn"
              onClick={() => vote(t.id)}
              title={`Vote for ${t.label}`}
            >
              <span className="vote-fill" style={{ width: `${pct}%` }} />
              <span className="vote-label">👍 {t.label}</span>
              <span className="vote-count">{v}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // ----- Single-team button -----
  if (teamId === undefined) return null;
  const v = score?.votes ?? 0;
  return (
    <div className="votebar">
      <button className="vote-btn solo" onClick={() => vote(teamId)}>
        <span className="vote-label">👍 {label ?? 'Vote'}</span>
        <span className="vote-count">{v}</span>
      </button>
    </div>
  );
}
