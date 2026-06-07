import { useEffect, useRef, useState } from 'react';

type TreeFile = {
  id: bigint;
  path: string;
  version: bigint;
  language: string;
  deleted: boolean;
  lastEditedByName: string;
  lastEditKind: string;
};

export default function FileTree({
  files,
  selectedPath,
  onSelect,
}: {
  files: TreeFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const live = files
    .filter((f) => !f.deleted)
    .sort((a, b) => a.path.localeCompare(b.path));

  // Flash a row briefly when its version bumps (someone just edited it).
  const prevVersions = useRef<Map<string, bigint>>(new Map());
  const [flashing, setFlashing] = useState<Set<string>>(new Set());

  useEffect(() => {
    const changed: string[] = [];
    const next = new Map<string, bigint>();
    for (const f of live) {
      next.set(f.path, f.version);
      const prev = prevVersions.current.get(f.path);
      if (prev !== undefined && prev !== f.version) changed.push(f.path);
    }
    prevVersions.current = next;
    if (changed.length === 0) return;
    setFlashing((s) => {
      const merged = new Set(s);
      changed.forEach((p) => merged.add(p));
      return merged;
    });
    const id = setTimeout(() => {
      setFlashing((s) => {
        const pruned = new Set(s);
        changed.forEach((p) => pruned.delete(p));
        return pruned;
      });
    }, 900);
    return () => clearTimeout(id);
    // Re-run whenever the set of file/version pairs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.map((f) => `${f.path}:${f.version}`).join(',')]);

  return (
    <div className="filetree">
      <div className="filetree-head">Files</div>
      {live.length === 0 ? (
        <div className="filetree-empty muted small">No files yet</div>
      ) : (
        <ul className="filetree-list">
          {live.map((f) => {
            const isSel = f.path === selectedPath;
            const isFlash = flashing.has(f.path);
            return (
              <li
                key={f.id.toString()}
                className={`filetree-row${isSel ? ' selected' : ''}${
                  isFlash ? ' flash' : ''
                }`}
                onClick={() => onSelect(f.path)}
                title={`${f.path} (v${f.version.toString()}) — last edit by ${
                  f.lastEditedByName || 'unknown'
                }`}
              >
                <span className="filetree-name">
                  <span className={`file-dot lang-${f.language}`} />
                  {f.path}
                </span>
                <span className="filetree-meta small muted">
                  <span className="filetree-ver">v{f.version.toString()}</span>
                  {f.lastEditedByName && (
                    <span className="filetree-by">{f.lastEditedByName}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
