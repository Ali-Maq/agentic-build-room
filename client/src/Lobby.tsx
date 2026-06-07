import { useEffect, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import type { Identity } from 'spacetimedb';
import { useMedia } from './media';
import { CATALOG, MODES } from './catalog';

const DEFAULT_PROMPT =
  'Build a single-page web app: a tiny kanban board with three columns ' +
  '(Todo / Doing / Done). Cards can be added and dragged. Use index.html, ' +
  'styles.css and app.js. Make it look polished.';

export default function Lobby({
  conn,
  myIdentity,
}: {
  conn: DbConnection;
  myIdentity: Identity;
}) {
  const { stream, camOn, micOn, toggleCam, toggleMic, error } = useMedia();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<string>(MODES[0].key);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [taskIdx, setTaskIdx] = useState(0);
  const [topic, setTopic] = useState('');

  const [rooms] = useTable(tables.room);
  const [participants] = useTable(tables.participant);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const openRooms = rooms.filter((r) => r.status !== 'done');
  const countIn = (roomId: bigint) =>
    participants.filter((p) => p.roomId === roomId && p.online).length;

  const isBuild = mode === 'build';
  const task = CATALOG[taskIdx];

  // Derive the topic + the prompt string we hand to createRoom. For free build
  // the prompt is the user's text; for benchmark/race the prompt encodes the
  // task selection so the runner can call loadBenchTask for it.
  const effectiveTopic = (() => {
    if (topic.trim()) return topic.trim();
    if (isBuild) return prompt.slice(0, 60) || 'Free build';
    return task.label;
  })();

  const effectivePrompt = isBuild
    ? prompt.trim()
    : `${task.dataset}/${task.config}/${task.split} (${task.type}) — ${task.label}`;

  const create = () => {
    if (!name.trim()) return;
    conn.reducers.createRoom({
      topic: effectiveTopic,
      displayName: name.trim(),
      mode,
      prompt: effectivePrompt,
    });
  };

  const join = (roomId: bigint) =>
    name.trim() &&
    conn.reducers.joinRoom({ roomId, displayName: name.trim(), role: 'human' });
  const observe = (roomId: bigint) =>
    name.trim() &&
    conn.reducers.joinRoom({ roomId, displayName: name.trim(), role: 'observer' });

  return (
    <div className="prejoin">
      <div className="prejoin-card lobby-wide">
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
          <h1>Build Room</h1>
          <p className="muted">
            Steer your AI agent. Build one shared web app, live. The database IS
            the artifact.
          </p>

          <label>Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ada Lovelace"
            autoFocus
          />

          {/* ===== Mode picker ===== */}
          <label>Mode</label>
          <div className="mode-picker">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`mode-card ${mode === m.key ? 'on' : ''}`}
                onClick={() => setMode(m.key)}
              >
                <strong>{m.label}</strong>
                <span className="muted small">{m.desc}</span>
              </button>
            ))}
          </div>

          {/* ===== Free build: prompt box ===== */}
          {isBuild && (
            <>
              <label>What should you + your agent build?</label>
              <textarea
                className="prompt-box"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Describe the web app to build…"
              />
            </>
          )}

          {/* ===== Benchmark / race: task picker ===== */}
          {!isBuild && (
            <>
              <label>Task (Hugging Face)</label>
              <select
                value={taskIdx}
                onChange={(e) => setTaskIdx(Number(e.target.value))}
              >
                {CATALOG.map((t, i) => (
                  <option key={t.label} value={i}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="muted small hint">
                ⚡ Start your runner to load this task (it calls{' '}
                <code>loadBenchTask</code>). The lobby only sets the mode + task.
              </p>
            </>
          )}

          <label>Room name (optional)</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={effectiveTopic}
          />

          <button
            className="primary big"
            onClick={create}
            disabled={!name.trim() || (isBuild && !prompt.trim())}
          >
            Create & join ({MODES.find((m) => m.key === mode)?.label})
          </button>

          <div className="rooms">
            <h3>Open rooms</h3>
            {openRooms.length === 0 && (
              <p className="muted small">None yet — start one.</p>
            )}
            {openRooms.map((r) => (
              <div key={r.id.toString()} className="room-chip">
                <div>
                  <strong>{r.topic}</strong>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                  <span className="badge mode-badge">{r.mode}</span>
                  <span className="muted small"> · {countIn(r.id)} in</span>
                </div>
                <div className="chip-actions">
                  <button onClick={() => join(r.id)} disabled={!name.trim()}>
                    Join
                  </button>
                  <button
                    className="ghost"
                    onClick={() => observe(r.id)}
                    disabled={!name.trim()}
                  >
                    Watch
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
