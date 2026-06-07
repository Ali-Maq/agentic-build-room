// Pure, unit-testable assembly of the shared artifact files into ONE HTML
// document for the sandboxed live-preview iframe. No SpacetimeDB imports — the
// grader can import this too to render the exact same bytes.

export type FileLike = { path: string; content: string; language: string; deleted?: boolean };

// CSP makes the artifact hermetic: no network egress (default-src 'none'),
// inline styles/scripts allowed (we inline everything), data: images ok.
const CSP =
  '<meta http-equiv="Content-Security-Policy" ' +
  "content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;\">";

// Captures errors inside the iframe and posts them to the parent (the ONLY
// cross-frame channel). allow-scripts iframes can postMessage but cannot read
// the parent, so the {__preview:true} marker is sufficient to trust it.
const ERROR_TRAP = `<script>(function(){
  function send(t,m){try{parent.postMessage({__preview:true,type:t,message:String(m)},'*')}catch(e){}}
  window.addEventListener('error',function(e){send('error',(e.message||'')+' @ '+(e.filename||'')+':'+(e.lineno||''))});
  window.addEventListener('unhandledrejection',function(e){send('error','Unhandled rejection: '+(e.reason&&e.reason.message||e.reason))});
  var _ce=console.error;console.error=function(){send('console',[].slice.call(arguments).join(' '));_ce.apply(console,arguments)};
})();</script>`;

const EMPTY_DOC =
  '<!doctype html><html><head></head><body><p style="font:14px sans-serif;color:#888;padding:24px">' +
  'No index.html yet — your agent will create one.</p></body></html>';

function injectBeforeClose(doc: string, tag: 'head' | 'body', fragment: string): string {
  const close = `</${tag}>`;
  const idx = doc.toLowerCase().lastIndexOf(close);
  if (idx === -1) return doc + fragment; // tag missing → append at end
  return doc.slice(0, idx) + fragment + doc.slice(idx);
}

function injectAfterOpenHead(doc: string, fragment: string): string {
  const m = doc.toLowerCase().indexOf('<head>');
  if (m === -1) {
    // no <head> → put one right after <html> or at the start
    const h = doc.toLowerCase().indexOf('<html');
    if (h === -1) return `<head>${fragment}</head>` + doc;
    const end = doc.indexOf('>', h);
    return doc.slice(0, end + 1) + `<head>${fragment}</head>` + doc.slice(end + 1);
  }
  const end = m + '<head>'.length;
  return doc.slice(0, end) + fragment + doc.slice(end);
}

export function assembleDocument(files: FileLike[], entry = 'index.html'): string {
  const live = files.filter((f) => !f.deleted);
  const html = live.find((f) => f.path === entry) ?? live.find((f) => f.language === 'html');
  const css = live.filter((f) => f.language === 'css').sort((a, b) => a.path.localeCompare(b.path));
  const js = live.filter((f) => f.language === 'js').sort((a, b) => a.path.localeCompare(b.path));

  let doc = html?.content ?? EMPTY_DOC;

  // Head: CSP + error trap FIRST, then styles.
  doc = injectAfterOpenHead(doc, CSP + ERROR_TRAP);
  for (const c of css) {
    doc = injectBeforeClose(doc, 'head', `\n<style data-src="${escapeAttr(c.path)}">\n${c.content}\n</style>`);
  }
  // Body: scripts before </body>.
  for (const j of js) {
    doc = injectBeforeClose(doc, 'body', `\n<script data-src="${escapeAttr(j.path)}">\n${j.content}\n</script>`);
  }
  return doc;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

// Cheap signature so the preview only rebuilds when content actually changed.
export function filesSignature(files: { id: bigint; version: bigint }[]): string {
  return files.map((f) => `${f.id}:${f.version}`).join(',');
}

export function langFromPath(path: string): string {
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'js';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'md';
  if (path.endsWith('.py')) return 'python';
  return 'js';
}
