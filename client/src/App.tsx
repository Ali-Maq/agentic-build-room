import { useEffect, useState } from 'react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import Lobby from './Lobby';
import BuildRoom from './BuildRoom';

export default function App() {
  const { isActive, identity, token, getConnection } = useSpacetimeDB();
  const conn = getConnection() as DbConnection | null;
  const [subscribed, setSubscribed] = useState(false);

  // Persist the auth token so identity is stable across reloads.
  useEffect(() => {
    if (token) localStorage.setItem('auth_token', token);
  }, [token]);

  // Global subscription: only the lightweight tables needed for the lobby and
  // routing. Heavy / per-room data (artifact files, agents, intents, activity,
  // video frames, verdicts, votes) is subscribed room-scoped inside
  // <BuildRoom/> so a client never receives other rooms' data.
  useEffect(() => {
    if (!conn || !isActive) return;
    conn
      .subscriptionBuilder()
      .onApplied(() => setSubscribed(true))
      .subscribe([tables.room, tables.participant, tables.presence]);
  }, [conn, isActive]);

  const [participants] = useTable(tables.participant);

  if (!isActive || !subscribed || !identity) {
    return (
      <div className="center">
        <div className="spinner" />
        <p>Connecting to SpacetimeDB…</p>
      </div>
    );
  }

  // "My room" = the room where I have an online participant row.
  const me = participants.find(
    (p) => p.identity.toHexString() === identity.toHexString() && p.online
  );

  if (!me) {
    return <Lobby conn={conn!} myIdentity={identity} />;
  }

  return (
    <BuildRoom conn={conn!} myIdentity={identity} roomId={me.roomId} myRole={me.role} />
  );
}
