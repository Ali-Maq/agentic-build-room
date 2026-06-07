import { useState } from 'react';
import type { Identity } from 'spacetimedb';
import { DbConnection } from './module_bindings';

// Humans steer their paired agent: submitIntent -> the runner claims it and
// writes files. Cmd/Ctrl+Enter sends. targetPath is optional (the currently
// selected file), passed through as a string or undefined.
export default function IntentBar({
  conn,
  roomId,
  myIdentity,
  myAgentId,
  selectedPath,
  disabled,
}: {
  conn: DbConnection;
  roomId: bigint;
  myIdentity: Identity;
  myAgentId?: bigint;
  selectedPath?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');

  const hasAgent = myAgentId !== undefined;
  const blocked = !!disabled || !hasAgent;

  const send = () => {
    const body = text.trim();
    if (blocked || !body || myAgentId === undefined) return;
    conn.reducers.submitIntent({
      roomId,
      targetAgentId: myAgentId,
      text: body,
      targetPath: selectedPath ?? undefined,
    });
    setText('');
  };

  const placeholder = !hasAgent
    ? 'No paired agent — start your runner to steer one.'
    : selectedPath
    ? `Tell your agent what to do with ${selectedPath}…`
    : 'Tell your agent what to build…';

  return (
    <div className="intentbar">
      <div className="intentbar-row">
        <textarea
          value={text}
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="primary" onClick={send} disabled={blocked || !text.trim()}>
          Send ⌘↵
        </button>
      </div>
      <div className="intentbar-meta small muted">
        {selectedPath ? (
          <>
            target <code className="act-path">{selectedPath}</code>
          </>
        ) : (
          <span>no file selected · agent picks the path</span>
        )}
      </div>
    </div>
  );
}
