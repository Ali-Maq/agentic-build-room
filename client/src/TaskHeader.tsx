import type { Infer } from 'spacetimedb';
import RoomRow from './module_bindings/room_table';
import BenchPromptRow from './module_bindings/bench_prompt_table';
import VerdictRow from './module_bindings/verdict_table';
import Timer from './Timer';

type Room = Infer<typeof RoomRow>;
type BenchPrompt = Infer<typeof BenchPromptRow>;
type Verdict = Infer<typeof VerdictRow>;

// Top bar of a build room: topic + prompt, mode/status badges, the shared
// <Timer/>, and a grade pill. The grade pill turns amber and reads
// 'NOT TEST-VERIFIED' whenever the latest verdict exists but isn't verified.
export default function TaskHeader({
  room,
  benchPrompt,
  latestVerdict,
}: {
  room: Room;
  benchPrompt?: BenchPrompt;
  latestVerdict?: Verdict;
}) {
  const startedMicros = room.startedAt ? room.startedAt.microsSinceUnixEpoch : null;
  const deadlineMicros = room.deadlineAt ? room.deadlineAt.microsSinceUnixEpoch : null;

  const promptText = benchPrompt?.prompt || room.prompt;
  const taskLabel = benchPrompt?.label;

  return (
    <header className="task-header">
      <div className="task-header-main">
        <div className="task-header-top">
          <strong className="task-topic">{room.topic}</strong>
          <span className={`badge mode-${room.mode}`}>{room.mode}</span>
          <span className={`badge ${room.status}`}>{room.status}</span>
          {benchPrompt && (
            <span className="badge bench">{benchPrompt.benchmarkType}</span>
          )}
          <Timer
            startedAtMicros={startedMicros}
            deadlineAtMicros={deadlineMicros}
            status={room.status === 'building' ? 'building' : room.status}
          />
        </div>
        {(taskLabel || promptText) && (
          <div className="task-prompt small muted">
            {taskLabel && <span className="task-label">{taskLabel}: </span>}
            {promptText}
          </div>
        )}
      </div>

      {latestVerdict && (
        <GradePill verdict={latestVerdict} />
      )}
    </header>
  );
}

function GradePill({ verdict }: { verdict: Verdict }) {
  if (!verdict.verified) {
    return (
      <span className="grade-pill unverified" title="Graded without running unit tests">
        NOT TEST-VERIFIED
      </span>
    );
  }
  const cls = verdict.passed ? 'pass' : 'fail';
  const detail =
    verdict.totalCount > 0
      ? `${verdict.passedCount}/${verdict.totalCount}`
      : verdict.passed
      ? 'passed'
      : 'failed';
  return (
    <span className={`grade-pill ${cls}`}>
      {verdict.passed ? '✓' : '✗'} {detail}
    </span>
  );
}
