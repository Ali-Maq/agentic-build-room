import { useEffect, useState } from 'react';

// Dependency-free countup/down timer. Parent passes micros (bigint) from the
// room's startedAt/deadlineAt timestamps, so this stays binding-independent.
export default function Timer({
  startedAtMicros,
  deadlineAtMicros,
  status,
}: {
  startedAtMicros: bigint | null;
  deadlineAtMicros?: bigint | null;
  status: string;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (status !== 'building' || !startedAtMicros || !now) return null;

  const startedMs = Number(startedAtMicros / 1000n);
  if (deadlineAtMicros) {
    const endMs = Number(deadlineAtMicros / 1000n);
    const left = Math.max(0, Math.floor((endMs - now) / 1000));
    return <span className="timer">⏳ {fmt(left)}</span>;
  }
  const elapsed = Math.max(0, Math.floor((now - startedMs) / 1000));
  return <span className="timer">⏱ {fmt(elapsed)}</span>;
}

function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
