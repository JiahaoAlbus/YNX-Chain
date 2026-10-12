import { useEffect, useRef, useState } from 'react';
import { solidityDiagnosticsBundle, type CompilerDiagnostic } from './solidityDiagnostics';
import { createRequestEpoch } from './requestEpoch';
import { parseSoliditySnapshot, type SoliditySnapshot } from './soliditySnapshot';
export type SolidityDraft = { name: string; source: string; snapshotText?: string };
type Compilation = { ok: boolean; sourceSha256?: string; sourceDigests?: Record<string, string>; compiler?: { version: string; longVersion: string }; artifactHash?: string; contractName?: string; abi?: unknown[]; bytecode?: string; deployedBytecode?: string; diagnostics?: CompilerDiagnostic[]; deployability?: string };
export function NativeSolidityTools({ draft, onDraft, request, run, busy }: {
  draft: SolidityDraft; onDraft: (value: SolidityDraft) => void;
  request: (path: string, options?: RequestInit) => Promise<any>;
  run: (task: () => Promise<void>) => Promise<void>; busy: boolean;
}) {
  const reviews = useRef(createRequestEpoch()).current;
  useEffect(() => () => { reviews.invalidate(); }, [reviews]);
  const [copiedProject, setCopiedProject] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [result, setResult] = useState<Compilation>();
  const [projectMode, setProjectMode] = useState(false), [snapshot, setSnapshot] = useState<SoliditySnapshot>();
  useEffect(() => { if (window.location.hash === '#compile') document.getElementById('compile')?.scrollIntoView(); }, []);
  const sourceBytes = new TextEncoder().encode(draft.source).length;
  const valid = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(draft.name) && (projectMode ? Boolean(snapshot) : draft.source.trim().length > 0 && sourceBytes <= 65536);
  function change(value: SolidityDraft) { onDraft(value); setResult(undefined); }
  async function compile() {
    setCopyStatus(''); setResult(undefined);
    const fresh = await request('context');
    try {
      setResult(await request('chain/compile', { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf, name: draft.name, ...(projectMode ? { snapshot } : { source: draft.source }) }) }));
    } catch (cause) {
      const body = (cause as { body?: Compilation }).body;
      if (body?.diagnostics) setResult(body);
      throw cause;
    }
  }
  async function reviewSnapshot() {
    const captured = reviews.capture();
    const value = await parseSoliditySnapshot(draft.snapshotText || '', new URLSearchParams(window.location.search).get('sessionId') || '');
    if (!reviews.current(captured)) return;
    setSnapshot(value); setCopiedProject(false); setResult(undefined);
  }
  async function useCopiedProject() {
    const captured = reviews.capture();
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch { throw new Error('Clipboard access is unavailable. Paste the project snapshot copied by the editor below.'); }
    if (!reviews.current(captured)) return;
    const value = await parseSoliditySnapshot(text, new URLSearchParams(window.location.search).get('sessionId') || '');
    if (!reviews.current(captured)) return;
    onDraft({ ...draft, snapshotText: JSON.stringify(value) });
    setProjectMode(true); setSnapshot(value); setCopiedProject(true); setResult(undefined);
  }
  async function copyDiagnostics() {
    if (!snapshot || !result?.diagnostics) return;
    const captured = reviews.capture(), bundle = solidityDiagnosticsBundle(snapshot, result.diagnostics);
    try { await navigator.clipboard.writeText(JSON.stringify(bundle)); }
    catch { throw new Error('Clipboard access is unavailable. The compiler messages remain below.'); }
    if (reviews.current(captured)) setCopyStatus(`${bundle.diagnostics.length} source diagnostic(s) copied. ${result.diagnostics.length - bundle.diagnostics.length} message(s) have no source location and remain here.`);
  }
  function download() {
    if (!result?.ok) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...result, ...(projectMode ? { snapshot } : { source: draft.source }) }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${result.contractName || draft.name}.ynx-artifact.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <section id="compile"><h2>Solidity compiler</h2>
    <p>Compile with the reviewed Solidity 0.8.24 compiler. Project imports are resolved only from the reviewed snapshot. Compilation does not execute, sign or deploy the contract.</p>
    <label htmlFor="native-solidity-mode">Source input</label><select id="native-solidity-mode" disabled={busy} value={projectMode ? 'project' : 'single'} onChange={event => { reviews.invalidate(); setProjectMode(event.target.value === 'project'); setSnapshot(undefined); setCopiedProject(false); setResult(undefined); }}><option value="single">Single source</option><option value="project">Editor project snapshot</option></select>
    <label htmlFor="native-solidity-name">Contract name</label><input id="native-solidity-name" value={draft.name} maxLength={128} disabled={busy} spellCheck={false} onChange={event => change({ ...draft, name: event.target.value })} />
    <button disabled={busy} onClick={() => void run(useCopiedProject)}>Use copied project sources</button>
    {projectMode ? <><p>Run <strong>YNX: Compile Solidity Project</strong> in the editor, then choose <strong>Use copied project sources</strong> here or paste its snapshot below. Review the exact files before compiling. Unsaved editor text is included.</p>
      <details open={!copiedProject}><summary>Project details and manual paste</summary><label htmlFor="native-solidity-snapshot">Project source snapshot</label><textarea id="native-solidity-snapshot" value={draft.snapshotText || ''} disabled={busy} maxLength={524288} spellCheck={false} rows={8} onChange={event => { reviews.invalidate(); onDraft({ ...draft, snapshotText: event.target.value }); setSnapshot(undefined); setCopiedProject(false); setResult(undefined); }} />
      <button disabled={busy || !draft.snapshotText?.trim()} onClick={() => void run(reviewSnapshot)}>Review project sources</button></details>
      {snapshot && <aside aria-label="Reviewed Solidity project"><h3>Reviewed project sources</h3><p>Entry: {snapshot.entryPath} · {Object.keys(snapshot.sources).length} file(s)</p>{Object.entries(snapshot.sources).map(([path, row]) => <details key={path} open={copiedProject && path === snapshot.entryPath}><summary>{path} · document version {row.documentVersion}</summary><pre>{row.content}</pre><details><summary>Source digest</summary><pre>{row.sha256}</pre></details></details>)}</aside>}
    </> : <><label htmlFor="native-solidity-source">Solidity source</label><textarea id="native-solidity-source" value={draft.source} disabled={busy} maxLength={65536} spellCheck={false} rows={12} onChange={event => change({ ...draft, source: event.target.value })} /><p>{sourceBytes.toLocaleString()} / 65,536 UTF-8 bytes</p></>}
    <button disabled={busy || !valid} onClick={() => void run(compile)}>Compile contract</button>
    {result && <article><h3>{result.ok ? 'Compiled artifact' : 'Compiler diagnostics'}</h3>
      {result.diagnostics?.length ? <ul>{result.diagnostics.map((item, index) => <li key={index}><strong>{item.severity}</strong><pre>{item.formattedMessage || item.message}</pre></li>)}</ul> : null}
      {projectMode && snapshot && result.diagnostics && <aside><p>Copy source diagnostics, then run <strong>YNX: Import Solidity Compiler Diagnostics</strong> in the editor. Open Problems to jump to the source locations. Changed sources require a new compilation.</p><button disabled={busy} onClick={() => void run(copyDiagnostics)}>Copy diagnostics for editor</button>{copyStatus && <p role="status">{copyStatus}</p>}</aside>}
      {result.ok && <><p>{result.contractName} · Solidity {result.compiler?.longVersion || result.compiler?.version}</p>
        <p>Source digest</p><pre>{result.sourceSha256}</pre><p>Artifact digest</p><pre>{result.artifactHash}</pre>
        {result.sourceDigests && <details><summary>All source digests</summary><pre>{JSON.stringify(result.sourceDigests, null, 2)}</pre></details>}
        <p>{result.deployability}</p><button onClick={download}>Download compiled artifact</button>
        <details><summary>ABI</summary><pre>{JSON.stringify(result.abi, null, 2)}</pre></details>
        <details><summary>Creation bytecode</summary><pre>{result.bytecode}</pre></details>
        <details><summary>Deployed bytecode</summary><pre>{result.deployedBytecode}</pre></details></>}
      <details><summary>Original compiler evidence</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </article>}
  </section>;
}
