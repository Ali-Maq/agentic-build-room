import { useEffect, useRef, useState } from 'react';
import { assembleDocument, filesSignature } from './assemble';

type PreviewFile = {
  id: bigint;
  version: bigint;
  path: string;
  content: string;
  language: string;
  deleted?: boolean;
};

type PreviewError = { type: string; message: string };

// Rebuild the srcDoc only when the file SIGNATURE (id:version per file) actually
// changes, debounced ~200ms so a flurry of subscription updates collapses into
// one re-render of the (relatively expensive) sandboxed iframe.
function useDebouncedMemo<T>(factory: () => T, key: string, delayMs: number): T {
  const [value, setValue] = useState<T>(factory);
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    const id = setTimeout(() => {
      lastKey.current = key;
      setValue(factory());
    }, delayMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayMs]);
  return value;
}

export default function LivePreview({
  files,
  entry = 'index.html',
}: {
  files: PreviewFile[];
  entry?: string;
}) {
  const sig = filesSignature(files) + '|' + entry;
  const srcDoc = useDebouncedMemo(() => assembleDocument(files, entry), sig, 200);
  const [error, setError] = useState<PreviewError | null>(null);

  // Clear any stale overlay each time we re-render the document.
  useEffect(() => {
    setError(null);
  }, [srcDoc]);

  // The ONLY trusted channel out of the sandboxed (allow-scripts, NOT
  // allow-same-origin) iframe is postMessage tagged with {__preview:true}.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== 'object' || d.__preview !== true) return;
      if (d.type === 'error') {
        setError({ type: 'error', message: String(d.message ?? 'Unknown error') });
      }
      // 'console' messages are non-fatal; we only surface hard errors.
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="preview-pane">
      <div className="preview-head">
        <span className="preview-title">Live preview</span>
        <span className="preview-entry">{entry}</span>
      </div>
      <div className="preview-frame-wrap">
        <iframe
          className="preview-frame"
          title="live-preview"
          // SECURITY: allow-scripts ONLY. NEVER add allow-same-origin — that
          // would let untrusted artifact code reach this app's origin/storage.
          sandbox="allow-scripts"
          srcDoc={srcDoc}
        />
        {error && (
          <div className="preview-error" role="alert">
            <div className="preview-error-title">Runtime error</div>
            <div className="preview-error-msg">{error.message}</div>
            <button className="ghost small" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
