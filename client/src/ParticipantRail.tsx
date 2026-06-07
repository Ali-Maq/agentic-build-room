import { useMemo } from 'react';
import type { Identity, Infer } from 'spacetimedb';
import { DbConnection } from './module_bindings';
import ParticipantRowSchema from './module_bindings/participant_table';
import AgentRowSchema from './module_bindings/agent_table';
import { useMedia } from './media';
import VideoTile from './VideoTile';

type Participant = Infer<typeof ParticipantRowSchema>;
type Agent = Infer<typeof AgentRowSchema>;

const STATUS_LABEL: Record<string, string> = {
  idle: 'idle',
  thinking: 'thinking',
  writing: 'writing',
  error: 'error',
};

// Left rail: one row per participant. Humans get a small <VideoTile/> (reusing
// the shared local stream from useMedia); agents render a status spinner driven
// by the agent.status subscription. Paired agents are shown nested under their
// human so the human↔agent steering relationship is visible.
export default function ParticipantRail({
  conn,
  participants,
  agents,
  myIdentity,
  roomId,
}: {
  conn: DbConnection;
  participants: Participant[];
  agents: Agent[];
  myIdentity: Identity;
  roomId: bigint;
}) {
  const { stream, camOn, micOn } = useMedia();
  const myHex = myIdentity.toHexString();

  const roster = useMemo(
    () =>
      participants
        .filter((p) => p.roomId === roomId && p.online)
        .sort((a, b) => a.seat - b.seat),
    [participants, roomId]
  );

  const roomAgents = useMemo(
    () => agents.filter((a) => a.roomId === roomId),
    [agents, roomId]
  );

  // Agents paired to a given human identity.
  const agentsForHuman = (hex: string) =>
    roomAgents.filter((a) => a.pairedHuman && a.pairedHuman.toHexString() === hex);

  // Agents with no human pairing (autonomous / race AIs) shown standalone.
  const unpairedAgents = roomAgents.filter((a) => !a.pairedHuman);

  return (
    <aside className="rail">
      <div className="rail-title small muted">Room ({roster.length})</div>

      {roster.map((p) => {
        const hex = p.identity.toHexString();
        const isMe = hex === myHex;
        const isHuman = p.role === 'human';
        const paired = agentsForHuman(hex);
        return (
          <div key={p.id.toString()} className="rail-group">
            <div className="rail-row">
              {isHuman ? (
                <div className="rail-tile">
                  <VideoTile
                    conn={conn}
                    identity={p.identity}
                    name={p.displayName}
                    role={p.role}
                    isMe={isMe}
                    isTurn={false}
                    localStream={isMe ? stream : null}
                    camOn={isMe ? camOn : undefined}
                    micOn={isMe ? micOn : undefined}
                  />
                </div>
              ) : (
                <div className="rail-avatar">{p.role === 'agent' ? '🤖' : '👁'}</div>
              )}
              <div className="rail-info">
                <div className="rail-name">
                  {p.displayName}
                  {isMe && <span className="you-tag">you</span>}
                </div>
                <div className="rail-tags">
                  <span className={`role-pill ${p.role}`}>{p.role}</span>
                  <span className={`online-dot ${p.online ? 'on' : 'off'}`} />
                </div>
              </div>
            </div>

            {paired.map((a) => (
              <AgentRow key={a.id.toString()} agent={a} />
            ))}
          </div>
        );
      })}

      {unpairedAgents.length > 0 && (
        <>
          <div className="rail-title small muted">Agents</div>
          {unpairedAgents.map((a) => (
            <div key={a.id.toString()} className="rail-group">
              <AgentRow agent={a} />
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const busy = agent.status === 'thinking' || agent.status === 'writing';
  return (
    <div className={`rail-agent agent-${agent.status}`}>
      <div className="rail-avatar small">🤖</div>
      <div className="rail-info">
        <div className="rail-name">{agent.displayName}</div>
        <div className="rail-tags">
          <span className="model-badge">{agent.role}</span>
          <span className={`agent-status agent-${agent.status}`}>
            {busy && <span className="agent-spinner" />}
            {STATUS_LABEL[agent.status] ?? agent.status}
          </span>
        </div>
      </div>
    </div>
  );
}
