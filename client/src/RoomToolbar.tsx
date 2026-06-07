import type { Room as RoomRow } from './module_bindings/types';
import { useMedia } from './media';

// Footer toolbar for the build room. Parent (BuildRoom) wires the reducers
// (startBuild / finishBuild / leaveRoom); mic/cam are local (useMedia) so you can
// toggle your camera/microphone from INSIDE the room, not just the lobby.
export default function RoomToolbar({
  room,
  myRole,
  onStart,
  onFinish,
  onLeave,
}: {
  room: RoomRow;
  myRole: string;
  onStart: () => void;
  onFinish: () => void;
  onLeave: () => void;
}) {
  const isHuman = myRole === 'human';
  const { camOn, micOn, toggleCam, toggleMic } = useMedia();

  return (
    <footer className="toolbar">
      <div className="topbar-left">
        <strong>{room.topic}</strong>
        <span className={`badge ${room.status}`}>{room.status}</span>
        <span className={`badge ${room.mode}`}>{room.mode}</span>
      </div>

      <div className="tool-sep" />

      <button className={`tool ${micOn ? '' : 'off'}`} onClick={toggleMic}>
        <span className="ic">{micOn ? '🎙️' : '🔇'}</span> {micOn ? 'Mute' : 'Unmute'}
      </button>
      <button className={`tool ${camOn ? '' : 'off'}`} onClick={toggleCam}>
        <span className="ic">{camOn ? '📹' : '🚫'}</span> {camOn ? 'Cam' : 'Cam off'}
      </button>

      <div className="tool-sep" />

      {room.status === 'lobby' && isHuman && (
        <button className="tool go" onClick={onStart}>
          <span className="ic">▶</span> Start
        </button>
      )}

      {room.status === 'building' && isHuman && (
        <button className="tool" onClick={onFinish}>
          <span className="ic">🏁</span> Finish
        </button>
      )}

      <div className="tool-sep" />

      <button className="tool leave" onClick={onLeave}>
        <span className="ic">📞</span> Leave
      </button>
    </footer>
  );
}
