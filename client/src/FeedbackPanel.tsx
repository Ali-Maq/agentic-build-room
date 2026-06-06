import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';

// Live scoring for a single answer. Re-renders instantly when the AI runner
// (or a human mentor) writes a feedback row for this answer.
export default function FeedbackPanel({ answerId }: { answerId: bigint }) {
  const [feedback] = useTable(tables.feedback);
  const rows = feedback.filter((f) => f.answerId === answerId);

  if (rows.length === 0) {
    return <div className="feedback pending">scoring…</div>;
  }

  return (
    <div className="feedback">
      {rows.map((f) => (
        <div key={f.id.toString()} className={`fb fb-${f.source}`}>
          <span className="score">{f.score}/10</span>
          <span className="src">{f.source === 'ai' ? '🤖' : '🧑'}</span>
          <span className="notes">{f.notes}</span>
        </div>
      ))}
    </div>
  );
}
