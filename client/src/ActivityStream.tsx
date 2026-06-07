import { useEffect, useMemo, useRef } from 'react';
import type { Infer } from 'spacetimedb';
import ActivityRow from './module_bindings/activity_table';
import ParticipantRow from './module_bindings/participant_table';
import AgentRow from './module_bindings/agent_table';

type Activity = Infer<typeof ActivityRow>;
type Participant = Infer<typeof ParticipantRow>;
type Agent = Infer<typeof AgentRow>;

const KIND_ICON: Record<string, string> = {
  plan: '🧭',
  thought: '💭',
  edit: '✏️',
  intent: '📨',
  rejected: '⛔',
  grade: '🏁',
  system: '⚙️',
  error: '⚠️',
};

// Chronological, kind-colored bubbles. Pure read-only render off the
// room-scoped subscription rows passed in by the parent.
export default function ActivityStream({
  activities,
  participants,
  agents,
}: {
  activities: Activity[];
  participants?: Participant[];
  agents?: Agent[];
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Name resolution: prefer the activity's own authorName, then fall back to
  // a matching participant/agent by identity (kept for parity with sibling panes).
  const nameByHex = useMemo(() => {
    const m = new Map<string, string>();
    (participants ?? []).forEach((p) => m.set(p.identity.toHexString(), p.displayName));
    (agents ?? []).forEach((a) => m.set(a.identity.toHexString(), a.displayName));
    return m;
  }, [participants, agents]);

  const ordered = useMemo(
    () =>
      [...activities].sort((a, b) =>
        Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch)
      ),
    [activities]
  );

  // Auto-stick to the bottom as new activity streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ordered.length]);

  return (
    <div className="activity" ref={scrollRef}>
      {ordered.length === 0 && (
        <p className="muted small">Plans, edits and grades will stream here.</p>
      )}
      {ordered.map((a) => {
        const who =
          a.authorName ||
          (a.identity ? nameByHex.get(a.identity.toHexString()) : undefined) ||
          (a.actorKind === 'system' ? 'system' : 'unknown');
        const ts = new Date(Number(a.createdAt.microsSinceUnixEpoch / 1000n));
        const time = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const ver =
          a.toVersion !== undefined
            ? `v${a.fromVersion ?? 0}→v${a.toVersion}`
            : null;
        return (
          <div key={a.id.toString()} className={`act act-${a.kind}`}>
            <div className="act-head">
              <span className="act-ic">{KIND_ICON[a.kind] ?? '•'}</span>
              <span className="act-who">{who}</span>
              <span className={`act-kind-pill act-${a.kind}`}>{a.kind}</span>
              <span className="act-time">{time}</span>
            </div>
            <div className="act-text">{a.text}</div>
            {(a.path || ver) && (
              <div className="act-meta">
                {a.path && <code className="act-path">{a.path}</code>}
                {ver && <span className="act-ver">{ver}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
