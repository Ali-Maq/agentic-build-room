import { useEffect, useRef, useState } from 'react';

type EditorFile = {
  id: bigint;
  path: string;
  content: string;
  language: string;
  version: bigint;
  lastEditedByName: string;
  lastEditKind: string;
};

export default function CodeEditor({
  file,
  canEdit,
  onSave,
}: {
  file: EditorFile | null;
  canEdit: boolean;
  onSave: (content: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  // The version our draft is based on; if file.version moves past this while we
  // hold unsaved edits, someone (an agent or human) wrote under us -> conflict.
  const baseVersion = useRef<bigint | null>(null);
  const fileId = file?.id ?? null;

  // Reset the draft when switching files, or when the underlying file changes
  // and we have NO unsaved local edits (adopt the new content live).
  useEffect(() => {
    if (!file) {
      setDraft('');
      setDirty(false);
      baseVersion.current = null;
      return;
    }
    if (!dirty) {
      setDraft(file.content);
      baseVersion.current = file.version;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, file?.version, file?.content]);

  const conflict =
    !!file &&
    dirty &&
    baseVersion.current !== null &&
    file.version !== baseVersion.current;

  function save() {
    if (!file || !canEdit) return;
    onSave(draft);
    setDirty(false);
    baseVersion.current = file.version;
  }

  function discard() {
    if (!file) return;
    setDraft(file.content);
    setDirty(false);
    baseVersion.current = file.version;
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    setDirty(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  if (!file) {
    return (
      <div className="editor editor-empty">
        <span className="muted">Select a file to view it.</span>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-head">
        <span className="editor-path">{file.path}</span>
        <span className="editor-lang small muted">{file.language}</span>
        <span className="editor-spacer" />
        <span className="editor-ver small muted">
          v{file.version.toString()}
          {file.lastEditedByName && ` · ${file.lastEditedByName}`}
          {file.lastEditKind === 'agent' && ' (agent)'}
        </span>
        {canEdit && (
          <>
            {dirty && <span className="editor-dirty small">● unsaved</span>}
            <button className="ghost small" disabled={!dirty} onClick={discard}>
              Discard
            </button>
            <button className="primary small" disabled={!dirty} onClick={save}>
              Save (⌘⏎)
            </button>
          </>
        )}
      </div>

      {conflict && (
        <div className="editor-conflict" role="alert">
          This file changed to v{file.version.toString()} while you were editing
          (last by {file.lastEditedByName || 'someone'}). Saving will base your
          write on the latest version. Use Discard to drop your edits and adopt
          theirs.
        </div>
      )}

      <textarea
        className="editor-area"
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        readOnly={!canEdit}
        spellCheck={false}
        wrap="off"
        placeholder={canEdit ? '' : 'Read-only — only humans can hand-edit.'}
      />
    </div>
  );
}
