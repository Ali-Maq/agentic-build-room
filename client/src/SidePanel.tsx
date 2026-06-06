import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import type { Identity } from 'spacetimedb';

type Tab = 'interview' | 'people';

export default function SidePanel({
  conn,
  myIdentity,
  roomId,
  isMyTurn,
}: {
  conn: DbConnection;
  myIdentity: Identity;
  roomId: bigint;
  isMyTurn: boolean;
}) {
  const [tab, setTab] = useState<Tab>('interview');
  const [draft, setDraft] = useState('');
  const [rooms] = useTable(tables.room);
  const [participants] = useTable(tables.participant);
  const [questions] = useTable(tables.question);
  const [answers] = useTable(tables.answer);
  const [feedback] = useTable(tables.feedback);

  const room = rooms.find((r) => r.id === roomId);
  const seats = participants
    .filter((p) => p.roomId === roomId && p.online)
    .sort((a, b) => a.seat - b.seat);

  const roomQuestions = useMemo(
    () =>
      questions
        .filter((q) => q.roomId === roomId)
        .sort((a, b) =>
          Number(a.askedAt.microsSinceUnixEpoch - b.askedAt.microsSinceUnixEpoch)
        ),
    [questions, roomId]
  );

  const currentQ = room?.currentQuestionId
    ? roomQuestions.find((q) => q.id === room.currentQuestionId)
    : undefined;

  const nameFor = (id: Identity) =>
    seats.find((p) => p.identity.toHexString() === id.toHexString())?.displayName ??
    id.toHexString().slice(0, 6);

  const submit = () => {
    if (!currentQ || !draft.trim()) return;
    conn.reducers.submitAnswer({ questionId: currentQ.id, text: draft.trim() });
    setDraft('');
  };

  return (
    <div className="panel">
      <div className="panel-tabs">
        <button className={tab === 'interview' ? 'on' : ''} onClick={() => setTab('interview')}>
          Interview
        </button>
        <button className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>
          People ({seats.length})
        </button>
      </div>

      {tab === 'people' && (
        <ul className="people">
          {seats.map((p) => (
            <li key={p.id.toString()}>
              <span className={`role-pill ${p.role}`}>{p.role}</span>
              <span>{p.displayName}</span>
              {p.identity.toHexString() === myIdentity.toHexString() && (
                <span className="you-tag">you</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'interview' && (
        <>
          <div className="panel-scroll">
            {roomQuestions.length === 0 && (
              <p className="muted small">
                The AI panel will post the first question when the session starts.
              </p>
            )}
            {roomQuestions.map((q) => {
              const qAnswers = answers
                .filter((a) => a.questionId === q.id)
                .sort((a, b) =>
                  Number(
                    a.submittedAt.microsSinceUnixEpoch - b.submittedAt.microsSinceUnixEpoch
                  )
                );
              return (
                <div key={q.id.toString()} className="qa">
                  <div className={`bubble q from-${q.source}`}>
                    <span className="who">{q.source === 'ai' ? '🤖 AI Panel' : '🧑 Mentor'}</span>
                    {q.text}
                  </div>
                  {qAnswers.map((a) => {
                    const fbs = feedback.filter((f) => f.answerId === a.id);
                    return (
                      <div key={a.id.toString()} className="bubble a">
                        <span className="who">{nameFor(a.identity)}</span>
                        {a.text}
                        {fbs.map((f) => (
                          <div key={f.id.toString()} className={`fb fb-${f.source}`}>
                            <b>{f.score}/10</b> {f.source === 'ai' ? '🤖' : '🧑'} {f.notes}
                          </div>
                        ))}
                        {fbs.length === 0 && <div className="fb pending">scoring…</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {room?.status === 'active' && currentQ && (
            <div className="answer-bar">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={isMyTurn ? 'Type your answer…' : 'Anyone may answer…'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                }}
              />
              <button className="primary" onClick={submit} disabled={!draft.trim()}>
                Send
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
