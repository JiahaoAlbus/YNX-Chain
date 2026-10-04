import { useState } from 'react';
export type SolidityDraft = { name: string; source: string };
type Compilation = { ok: boolean; sourceSha256?: string; compiler?: { version: string; longVersion: string }; artifactHash?: string; contractName?: string; abi?: unknown[]; bytecode?: string; deployedBytecode?: string; diagnostics?: { severity: string; formattedMessage?: string; message: string }[]; deployability?: string };
export function NativeSolidityTools({ draft, onDraft, request, run, busy }: {
  draft: SolidityDraft; onDraft: (value: SolidityDraft) => void;
  request: (path: string, options?: RequestInit) => Promise<any>;
  run: (task: () => Promise<void>) => Promise<void>; busy: boolean;
}) {
  const [result, setResult] = useState<Compilation>();
  const sourceBytes = new TextEncoder().encode(draft.source).length;
  const valid = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(draft.name) && draft.source.trim().length > 0 && sourceBytes <= 65536;
  function change(value: SolidityDraft) { onDraft(value); setResult(undefined); }
  async function compile() {
    setResult(undefined);
    const fresh = await request('context');
    try {
      setResult(await request('chain/compile', { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf, ...draft }) }));
    } catch (cause) {
      const body = (cause as { body?: Compilation }).body;
      if (body?.diagnostics) setResult(body);
      throw cause;
    }
  }
  function download() {
    if (!result?.ok) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...result, source: draft.source }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${result.contractName || draft.name}.ynx-artifact.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <section><h2>Solidity compiler</h2>
    <p>Paste the contract source you want to compile with the reviewed Solidity 0.8.24 compiler. Imports from files or packages are not loaded. Compilation does not execute, sign or deploy the contract.</p>
    <label htmlFor="native-solidity-name">Contract name</label><input id="native-solidity-name" value={draft.name} maxLength={128} disabled={busy} spellCheck={false} onChange={event => change({ ...draft, name: event.target.value })} />
    <label htmlFor="native-solidity-source">Solidity source</label><textarea id="native-solidity-source" value={draft.source} disabled={busy} maxLength={65536} spellCheck={false} rows={12} onChange={event => change({ ...draft, source: event.target.value })} />
    <p>{sourceBytes.toLocaleString()} / 65,536 UTF-8 bytes</p>
    <button disabled={busy || !valid} onClick={() => void run(compile)}>Compile contract</button>
    {result && <article><h3>{result.ok ? 'Compiled artifact' : 'Compiler diagnostics'}</h3>
      {result.diagnostics?.length ? <ul>{result.diagnostics.map((item, index) => <li key={index}><strong>{item.severity}</strong><pre>{item.formattedMessage || item.message}</pre></li>)}</ul> : null}
      {result.ok && <><p>{result.contractName} · Solidity {result.compiler?.longVersion || result.compiler?.version}</p>
        <p>Source digest</p><pre>{result.sourceSha256}</pre><p>Artifact digest</p><pre>{result.artifactHash}</pre>
        <p>{result.deployability}</p><button onClick={download}>Download compiled artifact</button>
        <details><summary>ABI</summary><pre>{JSON.stringify(result.abi, null, 2)}</pre></details>
        <details><summary>Creation bytecode</summary><pre>{result.bytecode}</pre></details>
        <details><summary>Deployed bytecode</summary><pre>{result.deployedBytecode}</pre></details></>}
      <details><summary>Original compiler evidence</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </article>}
  </section>;
}
