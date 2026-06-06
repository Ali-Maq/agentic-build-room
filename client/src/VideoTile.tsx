import { useEffect, useRef } from 'react';
import { DbConnection } from './module_bindings';
import type { Identity } from 'spacetimedb';

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// A single Zoom-style tile. Self renders the live local stream; everyone else
// renders the latest JPEG frame relayed through the DB.
export default function VideoTile({
  conn,
  identity,
  name,
  role,
  isMe,
  isTurn,
  localStream,
  camOn,
  micOn,
}: {
  conn: DbConnection;
  identity: Identity;
  name: string;
  role: string;
  isMe: boolean;
  isTurn: boolean;
  localStream?: MediaStream | null;
  camOn?: boolean;
  micOn?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastUrl = useRef<string | null>(null);
  const hasFrameRef = useRef(false);

  // Self: attach local stream.
  useEffect(() => {
    if (isMe && videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [isMe, localStream]);

  // Remote: render frames relayed through SpacetimeDB.
  useEffect(() => {
    if (isMe) return;
    const hex = identity.toHexString();

    const paint = (data: Uint8Array) => {
      if (!imgRef.current) return;
      const blob = new Blob([data as unknown as BlobPart], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const prev = lastUrl.current;
      imgRef.current.onload = () => {
        if (prev) URL.revokeObjectURL(prev);
      };
      imgRef.current.src = url;
      lastUrl.current = url;
      hasFrameRef.current = true;
      imgRef.current.style.opacity = '1';
    };

    // Initial frame, if any.
    const existing = conn.db.videoFrame.identity.find(identity);
    if (existing) paint(existing.data);

    const onIns = (_c: any, row: any) => {
      if (row.identity.toHexString() === hex) paint(row.data);
    };
    const onUpd = (_c: any, _old: any, row: any) => {
      if (row.identity.toHexString() === hex) paint(row.data);
    };
    const onDel = (_c: any, row: any) => {
      if (row.identity.toHexString() === hex && imgRef.current) {
        imgRef.current.style.opacity = '0';
        hasFrameRef.current = false;
      }
    };

    conn.db.videoFrame.onInsert(onIns);
    conn.db.videoFrame.onUpdate(onUpd);
    conn.db.videoFrame.onDelete(onDel);
    return () => {
      conn.db.videoFrame.removeOnInsert(onIns);
      conn.db.videoFrame.removeOnUpdate(onUpd);
      conn.db.videoFrame.removeOnDelete(onDel);
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    };
  }, [conn, identity, isMe]);

  const showVideo = isMe ? camOn !== false : true;

  return (
    <div className={`tile role-${role} ${isTurn ? 'speaking' : ''}`}>
      <div className="tile-avatar">{initials(name)}</div>
      {isMe ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="tile-media"
          style={{ display: showVideo ? 'block' : 'none', transform: 'scaleX(-1)' }}
        />
      ) : (
        <img ref={imgRef} className="tile-media" style={{ opacity: 0 }} alt={name} />
      )}

      <div className="tile-bar">
        <span className="tile-name">
          {isMe ? `${name} (you)` : name}
        </span>
        <span className={`tile-role role-pill ${role}`}>{role}</span>
        {isMe && micOn === false && <span className="muted-dot">🔇</span>}
      </div>
      {isTurn && <div className="tile-turn">● answering</div>}
    </div>
  );
}
