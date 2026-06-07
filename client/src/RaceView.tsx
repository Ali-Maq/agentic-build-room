import { useMemo } from 'react';
import { DbConnection } from './module_bindings';
import type { Identity } from 'spacetimedb';
import ActivityStream from './ActivityStream';
import LivePreview from './LivePreview';
import VerdictCard from './VerdictCard';
import VoteBar from './VoteBar';

// Minimal structural row types (avoid coupling to generated type names).
type Team = { id: bigint; roomId: bigint; kind: string; label: string };
type ArtifactFile = {
  id: bigint;
  roomId: bigint;
  path: string;
  content: string;
  language: string;
  version: bigint;
  ownerRole: string;
  deleted: boolean;
};
type Activity = { id: bigint; roomId: bigint; createdAt: { microsSinceUnixEpoch: bigint } };
type Verdict = {
  id: bigint;
  roomId: bigint;
  teamId: bigint;
  verified: boolean;
  passed: boolean;
  passedCount: number;
  totalCount: number;
  method: string;
  score: number;
  attempt: number;
  durationMs: number;
  judgeNotes: string;
  stdout: string;
  stderr: string;
  createdAt: { microsSinceUnixEpoch: bigint };
};
type Score = {
  teamId: bigint;
  roomId: bigint;
  bestPassed: boolean;
  bestScore: number;
  votes: number;
  firstPassAtMicros?: bigint;
};
type Participant = { id: bigint; roomId: bigint; displayName: string; role: string };
type Agent = { id: bigint; roomId: bigint; displayName: string; team: string; role: string };

export default function RaceView({
  conn,
  myIdentity,
  roomId,
  room,
  teams,
  files,
  activities,
  verdicts,
  scores,
  participants,
  agents,
}: {
  conn: DbConnection;
  myIdentity: Identity;
  roomId: bigint;
  room?: { mode: string; status: string };
  teams: Team[];
  files: ArtifactFile[];
  activities: Activity[];
  verdicts: Verdict[];
  scores: Score[];
  participants: Participant[];
  agents: Agent[];
}) {
  // Order columns: human+agent team first, then ai_only.
  const ordered = useMemo(() => {
    const order: Record<string, number> = { human_agent: 0, ai_only: 1 };
    return [...teams]
      .filter((t) => t.roomId === roomId)
      .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  }, [teams, roomId]);

  const latestVerdictFor = (teamId: bigint): Verdict | undefined =>
    verdicts
      .filter((v) => v.teamId === teamId)
      .sort(
        (a, b) =>
          Number(
            b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch
          )
      )[0];

  const scoreFor = (teamId: bigint) => scores.find((s) => s.teamId === teamId);

  // Winner: passed teams win over non-passed; among passed, earliest first pass;
  // tie-break by votes then score. Only declared once room is graded/done.
  const winner = useMemo(() => {
    if (!room || (room.status !== 'grading' && room.status !== 'done')) return undefined;
    const ranked = ordered
      .map((t) => ({ team: t, score: scoreFor(t.id) }))
      .filter((x) => x.score)
      .sort((a, b) => {
        const sa = a.score!;
        const sb = b.score!;
        if (sa.bestPassed !== sb.bestPassed) return sa.bestPassed ? -1 : 1;
        const fa = sa.firstPassAtMicros ?? 9_999_999_999_999_999n;
        const fb = sb.firstPassAtMicros ?? 9_999_999_999_999_999n;
        if (fa !== fb) return fa < fb ? -1 : 1;
        if (sb.votes !== sa.votes) return sb.votes - sa.votes;
        return sb.bestScore - sa.bestScore;
      });
    return ranked[0]?.team;
  }, [ordered, scores, room]);

  // Is this a code/test benchmark room (show verdict) vs free build (show preview)?
  const showVerdict = (latest?: Verdict) => !!latest;

  return (
    <div className="race-wrap">
      {winner && (
        <div className="race-winner">
          🏆 Winner: <strong>{winner.label}</strong>
        </div>
      )}
      <div className="race-grid">
        {ordered.map((team) => {
          // Files for this team are tagged by ownerRole matching the team kind.
          // human_agent -> 'human' files; ai_only -> 'ai' files. Fall back to all.
          const teamRole = team.kind === 'ai_only' ? 'ai' : 'human';
          const owned = files.filter(
            (f) => f.roomId === roomId && !f.deleted && f.ownerRole === teamRole
          );
          // Fall back to all room files when nothing is tagged by ownerRole
          // (the build loop doesn't tag files per team), so the preview renders.
          const teamFiles = owned.length
            ? owned
            : files.filter((f) => f.roomId === roomId && !f.deleted);
          const teamAgents = agents.filter(
            (a) =>
              a.roomId === roomId &&
              (team.kind === 'ai_only' ? a.team === 'ai' : a.team === 'human')
          );
          const teamActivities = activities.filter(
            (a: any) => a.teamId === team.id || a.team === team.kind
          );
          // ActivityStream filters by participants/agents; if no per-row team tag
          // exists, pass all activities (the stream is shared) but scope agents.
          const streamActivities =
            teamActivities.length > 0 ? teamActivities : activities;

          const latest = latestVerdictFor(team.id);
          const sc = scoreFor(team.id);

          return (
            <section
              key={team.id.toString()}
              className={`race-col ${winner?.id === team.id ? 'is-winner' : ''}`}
            >
              <header className="race-col-head">
                <span className={`role-pill ${team.kind === 'ai_only' ? 'agent' : 'human'}`}>
                  {team.kind === 'ai_only' ? 'AI ONLY' : 'HUMAN + AI'}
                </span>
                <strong>{team.label}</strong>
                {sc && (
                  <span className="muted small">
                    {sc.bestPassed ? '✓ passing' : `score ${sc.bestScore.toFixed(2)}`}
                  </span>
                )}
              </header>

              <div className="race-preview">
                {showVerdict(latest) ? (
                  <VerdictCard verdict={latest} />
                ) : (
                  <LivePreview files={teamFiles} entry="index.html" />
                )}
              </div>

              <div className="race-activity">
                <ActivityStream
                  activities={streamActivities as any}
                  participants={participants as any}
                  agents={teamAgents as any}
                />
              </div>

              <VoteBar
                conn={conn}
                roomId={roomId}
                teamId={team.id}
                score={sc as any}
                label={team.kind === 'ai_only' ? 'AI team' : 'Our team'}
              />
            </section>
          );
        })}

        {ordered.length === 0 && (
          <div className="race-empty muted">
            <p>No teams yet — create the two race teams to begin.</p>
            <button className="primary" onClick={() => conn.reducers.initRaceTeams({ roomId })}>
              ⚔ Start race (create teams)
            </button>
            <p className="small">
              Then start a human-paired runner and an autonomous AI runner to fill them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
