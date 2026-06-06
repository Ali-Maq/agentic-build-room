import { useEffect, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import type { Identity } from 'spacetimedb';
import { useMedia } from './media';

const SUGGESTED_TOPICS = [
  'Behavioral — leadership & conflict',
  'System design — design a URL shortener',
  'Frontend — React performance',
  'Data structures & algorithms',
  'Product sense — improve a feature',
];

export default function Lobby({
  conn,
}: {
  conn: DbConnection;
  myIdentity: Identity;
}) {
  const { stream, camOn, micOn, toggleCam, toggleMic, error } = useMedia();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState(SUGGESTED_TOPICS[0]);
  const [rooms] = useTable(tables.room);
  const [participants] = useTable(tables.participant);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const openRooms = rooms.filter((r) => r.status !== 'done');
  const countIn = (roomId: bigint) =>
    participants.filter((p) => p.roomId === roomId && p.online).length;

  const create = () => name.trim() && conn.reducers.createRoom({ topic, displayName: name.trim() });
  const join = (roomId: bigint) =>
    name.trim() && conn.reducers.joinRoom({ roomId, displayName: name.trim(), role: 'candidate' });
  const mentor = (roomId: bigint) =>
    name.trim() && conn.reducers.claimMentorSeat({ roomId, displayName: name.trim() });

  return (
    <div className="prejoin">
      <div className="prejoin-card">
        <div className="preview">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ transform: 'scaleX(-1)', display: camOn ? 'block' : 'none' }}
          />
          {!camOn && <div className="preview-off">Camera off</div>}
          {error && <div className="preview-off err">⚠ {error}</div>}
          <div className="preview-controls">
            <button className={micOn ? '' : 'off'} onClick={toggleMic}>
              {micOn ? '🎙️' : '🔇'}
            </button>
            <button className={camOn ? '' : 'off'} onClick={toggleCam}>
              {camOn ? '📹' : '🚫'}
            </button>
          </div>
        </div>

        <div className="prejoin-form">
          <h1>Panel</h1>
          <p className="muted">Live group interviews on a database. Faces, AI panel, real-time.</p>

          <label>Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ada Lovelace"
            autoFocus
          />

          <label>New room topic</label>
          <select value={topic} onChange={(e) => setTopic(e.target.value)}>
            {SUGGESTED_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="primary big" onClick={create} disabled={!name.trim()}>
            Create & join
          </button>

          <div className="rooms">
            <h3>Open rooms</h3>
            {openRooms.length === 0 && <p className="muted small">None yet — start one.</p>}
            {openRooms.map((r) => (
              <div key={r.id.toString()} className="room-chip">
                <div>
                  <strong>{r.topic}</strong>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                  <span className="muted small"> · {countIn(r.id)} in</span>
                </div>
                <div className="chip-actions">
                  <button onClick={() => join(r.id)} disabled={!name.trim()}>
                    Join
                  </button>
                  <button className="ghost" onClick={() => mentor(r.id)} disabled={!name.trim()}>
                    Mentor
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
