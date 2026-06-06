import { useEffect, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import type { Identity } from 'spacetimedb';
import { useMedia } from './media';
import { useWebcamPublish } from './useWebcamPublish';
import VideoTile from './VideoTile';
import SidePanel from './SidePanel';

export default function Room({
  conn,
  myIdentity,
  roomId,
  myRole,
}: {
  conn: DbConnection;
  myIdentity: Identity;
  roomId: bigint;
  myRole: string;
}) {
  const { stream, camOn, micOn, toggleCam, toggleMic } = useMedia();
  const [rooms] = useTable(tables.room);
  const [participants] = useTable(tables.participant);
  const [panelOpen, setPanelOpen] = useState(true);
  const [now, setNow] = useState(0);

  // Room-scoped subscription: only THIS room's video frames, Q&A and feedback.
  // Bounds video fan-out to the local room (no cross-room frame egress).
  useEffect(() => {
    const handle = conn
      .subscriptionBuilder()
      .subscribe([
        tables.videoFrame.where((r) => r.roomId.eq(roomId)),
        tables.question.where((r) => r.roomId.eq(roomId)),
        tables.answer.where((r) => r.roomId.eq(roomId)),
        tables.feedback.where((r) => r.roomId.eq(roomId)),
      ]);
    return () => handle.unsubscribe();
  }, [conn, roomId]);

  // Relay our webcam through the database.
  useWebcamPublish(conn, roomId, stream, camOn);

  const room = rooms.find((r) => r.id === roomId);
  const seats = participants
    .filter((p) => p.roomId === roomId && p.online)
    .sort((a, b) => a.seat - b.seat);

  const isMyTurn =
    !!room?.currentTurn && room.currentTurn.toHexString() === myIdentity.toHexString();

  // Session timer.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const startedMs = room ? Number(room.createdAt.microsSinceUnixEpoch / 1000n) : 0;
  const elapsed = room?.status === 'active' && now ? Math.max(0, Math.floor((now - startedMs) / 1000)) : 0;
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  const aiPresent = seats.some((p) => p.role === 'ai');
  const cols = Math.ceil(Math.sqrt(Math.max(1, seats.length)));

  return (
    <div className="meeting">
      <header className="topbar">
        <div className="topbar-left">
          <span className="rec-dot" />
          <strong>{room?.topic}</strong>
          <span className={`badge ${room?.status}`}>{room?.status}</span>
        </div>
        <div className="topbar-right">
          {room?.status === 'active' && <span className="timer">⏱ {mmss}</span>}
          {!aiPresent && <span className="warn small">AI panel offline</span>}
        </div>
      </header>

      <div className="meeting-body">
        <main className="gallery" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {seats.map((p) => {
            const isMe = p.identity.toHexString() === myIdentity.toHexString();
            const isTurn =
              !!room?.currentTurn &&
              p.identity.toHexString() === room.currentTurn.toHexString();
            return (
              <VideoTile
                key={p.id.toString()}
                conn={conn}
                identity={p.identity}
                name={p.displayName}
                role={p.role}
                isMe={isMe}
                isTurn={isTurn}
                localStream={isMe ? stream : null}
                camOn={isMe ? camOn : undefined}
                micOn={isMe ? micOn : undefined}
              />
            );
          })}
        </main>

        {panelOpen && (
          <SidePanel conn={conn} myIdentity={myIdentity} roomId={roomId} isMyTurn={isMyTurn} />
        )}
      </div>

      <footer className="toolbar">
        <button className={`tool ${micOn ? '' : 'off'}`} onClick={toggleMic}>
          <span className="ic">{micOn ? '🎙️' : '🔇'}</span>
          {micOn ? 'Mute' : 'Unmute'}
        </button>
        <button className={`tool ${camOn ? '' : 'off'}`} onClick={toggleCam}>
          <span className="ic">{camOn ? '📹' : '🚫'}</span>
          {camOn ? 'Stop video' : 'Start video'}
        </button>

        <div className="tool-sep" />

        {room?.status === 'lobby' && (
          <button className="tool go" onClick={() => conn.reducers.startSession({ roomId })}>
            <span className="ic">▶</span> Start
          </button>
        )}
        {room?.status === 'active' && (myRole === 'mentor' || isMyTurn) && (
          <button className="tool" onClick={() => conn.reducers.advanceTurn({ roomId })}>
            <span className="ic">⏭️</span> Next
          </button>
        )}
        <button className={`tool ${panelOpen ? 'on' : ''}`} onClick={() => setPanelOpen((o) => !o)}>
          <span className="ic">💬</span> Panel
        </button>

        <div className="tool-sep" />

        <button className="tool leave" onClick={() => conn.reducers.leaveRoom({ roomId })}>
          <span className="ic">📞</span> Leave
        </button>
      </footer>
    </div>
  );
}
