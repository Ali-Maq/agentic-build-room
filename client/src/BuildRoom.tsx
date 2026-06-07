import { useEffect, useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import type { Identity } from 'spacetimedb';
import { useMedia } from './media';
import { useWebcamPublish } from './useWebcamPublish';
import TaskHeader from './TaskHeader';
import ParticipantRail from './ParticipantRail';
import FileTree from './FileTree';
import CodeEditor from './CodeEditor';
import IntentBar from './IntentBar';
import ActivityStream from './ActivityStream';
import LivePreview from './LivePreview';
import VerdictCard from './VerdictCard';
import RoomToolbar from './RoomToolbar';
import RaceView from './RaceView';

// Integration spine for the Live Agentic Build Room. Owns the ROOM-SCOPED
// subscription (so a client only ever receives this room's heavy data),
// resolves the human's paired agent, and composes every pane. Branches on
// room.mode: 'race' -> two-column RaceView, otherwise the 3-pane build layout.
export default function BuildRoom({
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
  const { stream, camOn } = useMedia();

  // Light tables come from the global subscription in App.tsx.
  const [rooms] = useTable(tables.room);
  const [participants] = useTable(tables.participant);

  // Heavy / per-room tables come from the room-scoped subscription below.
  const [allFiles] = useTable(tables.artifactFile);
  const [allAgents] = useTable(tables.agent);
  const [allIntents] = useTable(tables.intent);
  const [allActivities] = useTable(tables.activity);
  const [allBenchPrompts] = useTable(tables.benchPrompt);
  const [allTeams] = useTable(tables.team);
  const [allVerdicts] = useTable(tables.verdict);
  const [allVotes] = useTable(tables.vote);
  const [allScores] = useTable(tables.score);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Room-scoped subscription. Bounds every heavy table to THIS room so we never
  // egress another room's artifact bytes, video frames, activity, etc.
  useEffect(() => {
    const handle = conn.subscriptionBuilder().subscribe([
      tables.artifactFile.where((r) => r.roomId.eq(roomId)),
      tables.agent.where((r) => r.roomId.eq(roomId)),
      tables.intent.where((r) => r.roomId.eq(roomId)),
      tables.activity.where((r) => r.roomId.eq(roomId)),
      tables.benchPrompt.where((r) => r.roomId.eq(roomId)),
      tables.team.where((r) => r.roomId.eq(roomId)),
      tables.verdict.where((r) => r.roomId.eq(roomId)),
      tables.vote.where((r) => r.roomId.eq(roomId)),
      tables.score.where((r) => r.roomId.eq(roomId)),
      tables.videoFrame.where((r) => r.roomId.eq(roomId)),
    ]);
    return () => handle.unsubscribe();
  }, [conn, roomId]);

  // Relay our webcam through the database (room-scoped frames only).
  useWebcamPublish(conn, roomId, stream, camOn);

  const room = rooms.find((r) => r.id === roomId);

  // Scope rows to this room (subscription already filters, but defend against
  // any stale cross-room rows still cached client-side).
  const files = useMemo(
    () => allFiles.filter((f) => f.roomId === roomId),
    [allFiles, roomId]
  );
  const agents = useMemo(
    () => allAgents.filter((a) => a.roomId === roomId),
    [allAgents, roomId]
  );
  const intents = useMemo(
    () => allIntents.filter((i) => i.roomId === roomId),
    [allIntents, roomId]
  );
  const activities = useMemo(
    () =>
      allActivities
        .filter((a) => a.roomId === roomId)
        .sort((a, b) =>
          a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : 1
        ),
    [allActivities, roomId]
  );
  const roomParticipants = useMemo(
    () => participants.filter((p) => p.roomId === roomId),
    [participants, roomId]
  );
  const teams = useMemo(() => allTeams.filter((t) => t.roomId === roomId), [allTeams, roomId]);
  const verdicts = useMemo(
    () => allVerdicts.filter((v) => v.roomId === roomId),
    [allVerdicts, roomId]
  );
  const votes = useMemo(() => allVotes.filter((v) => v.roomId === roomId), [allVotes, roomId]);
  const scores = useMemo(() => allScores.filter((s) => s.roomId === roomId), [allScores, roomId]);

  const benchPrompt = useMemo(
    () => allBenchPrompts.find((b) => b.roomId === roomId),
    [allBenchPrompts, roomId]
  );

  // My paired agent = the agent row whose pairedHuman === my identity. May be
  // undefined until a runner registers the agent for this human.
  const myHex = myIdentity.toHexString();
  const myAgent = useMemo(
    () => agents.find((a) => a.pairedHuman != null && a.pairedHuman.toHexString() === myHex),
    [agents, myHex]
  );
  const myAgentId: bigint | undefined = myAgent?.id;

  // Latest verdict overall (used for the header grade pill).
  const latestVerdict = useMemo(() => {
    if (verdicts.length === 0) return undefined;
    return [...verdicts].sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
    )[0];
  }, [verdicts]);

  // Default the editor selection to the first live file once we have data.
  useEffect(() => {
    if (selectedPath != null) return;
    const live = files.filter((f) => !f.deleted).sort((a, b) => a.path.localeCompare(b.path));
    if (live.length > 0) setSelectedPath(live[0].path);
  }, [files, selectedPath]);

  if (!room) {
    return (
      <div className="center">
        <div className="spinner" />
        <p>Loading room…</p>
      </div>
    );
  }

  const isCodeBenchmark = benchPrompt?.benchmarkType === 'code';
  const selectedFile = files.find((f) => f.path === selectedPath && !f.deleted);
  const canEdit = myRole === 'human';

  // RACE mode: two-column head-to-head view owns its own layout.
  if (room.mode === 'race') {
    return (
      <div className="buildroom buildroom--race">
        <TaskHeader room={room} benchPrompt={benchPrompt} latestVerdict={latestVerdict} />
        <RaceView
          conn={conn}
          myIdentity={myIdentity}
          roomId={roomId}
          room={room}
          teams={teams}
          files={files}
          activities={activities}
          participants={roomParticipants}
          agents={agents}
          verdicts={verdicts}
          scores={scores}
        />
        <RoomToolbar
          room={room}
          myRole={myRole}
          onStart={() => conn.reducers.startBuild({ roomId })}
          onFinish={() => conn.reducers.finishBuild({ roomId })}
          onLeave={() => conn.reducers.leaveRoom({ roomId })}
        />
      </div>
    );
  }

  // BUILD / BENCHMARK mode: top header, 3-pane body, footer toolbar.
  return (
    <div className="buildroom">
      <TaskHeader room={room} benchPrompt={benchPrompt} latestVerdict={latestVerdict} />

      <div className="buildroom-body">
        <ParticipantRail
          conn={conn}
          participants={roomParticipants}
          agents={agents}
          myIdentity={myIdentity}
          roomId={roomId}
        />

        <div className="buildroom-center">
          <FileTree files={files} selectedPath={selectedPath} onSelect={setSelectedPath} />
          <CodeEditor
            file={selectedFile ?? null}
            canEdit={canEdit}
            onSave={(content) => {
              if (!selectedFile) return;
              conn.reducers.writeFile({
                roomId,
                path: selectedFile.path,
                content,
                language: selectedFile.language,
                baseVersion: selectedFile.version,
                editKind: 'human',
                intent: '',
              });
            }}
          />
          <IntentBar
            conn={conn}
            roomId={roomId}
            myIdentity={myIdentity}
            myAgentId={myAgentId}
            selectedPath={selectedPath ?? undefined}
            disabled={myAgentId == null}
          />
          <ActivityStream
            activities={activities}
            participants={roomParticipants}
            agents={agents}
          />
        </div>

        <div className="preview-pane">
          {isCodeBenchmark ? (
            <VerdictCard verdict={latestVerdict} />
          ) : (
            <LivePreview files={files} entry={benchPrompt?.entryPoint || 'index.html'} />
          )}
        </div>
      </div>

      <RoomToolbar
        room={room}
        myRole={myRole}
        onStart={() => conn.reducers.startBuild({ roomId })}
        onFinish={() => conn.reducers.finishBuild({ roomId })}
        onLeave={() => conn.reducers.leaveRoom({ roomId })}
      />
    </div>
  );
}
