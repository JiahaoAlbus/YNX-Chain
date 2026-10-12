import { useState } from 'react';
type Contract = { address: string; artifactKind?: string; runtimeMode?: string; limitations?: string[]; functions?: { name: string; signature: string; stateMutability: string }[] };
type CallResult = { executionStatus: string; artifactKind: string; runtimeMode: string; returnValue: string; limitations: string[] };
export function NativeContractTools({ request, run, busy }: {
  request: (path: string, options?: RequestInit) => Promise<any>;
  run: (task: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [address, setAddress] = useState(''), [contract, setContract] = useState<Contract>(),
    [functionName, setFunction] = useState(''), [calldata, setCalldata] = useState(''), [result, setResult] = useState<CallResult>();
  const validAddress = /^0x[0-9a-f]{40}$/.test(address);
  const functions = Array.isArray(contract?.functions) ? contract.functions.filter(row => row.stateMutability === 'pure' || row.stateMutability === 'view') : [];
  const target = calldata || functionName;
  const validCall = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(target) || /^0x(?:[0-9a-f]{2}){4,4096}$/.test(target);
  const inspect = async () => {
    setContract(undefined); setResult(undefined); setFunction(''); setCalldata('');
    const value = await request(`chain/contracts/${address}`); setContract(value.artifact);
  };
  const call = async () => {
    setResult(undefined); const fresh = await request('context');
    const value = await request('chain/contracts/call', { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf, address, function: target }) }); setResult(value.result);
  };
  return <section><h2>Contract inspector</h2><p>Inspect an existing Testnet contract and call its supported pure/view functions. Results include the current runtime's execution mode and limits.</p>
    <label>Contract address<input value={address} disabled={busy} maxLength={42} autoComplete="off" spellCheck={false} placeholder="0x…" onChange={event => { setAddress(event.target.value.trim().toLowerCase()); setContract(undefined); setResult(undefined); setFunction(''); setCalldata(''); }} /></label>
    <button disabled={busy || !validAddress} onClick={() => void run(inspect)}>Inspect contract</button>
    {contract && <><p>Artifact: {contract.artifactKind || 'not reported'} · Runtime: {contract.runtimeMode || 'not reported'}</p>
      {contract.limitations?.length ? <details open><summary>Reported contract limits</summary><ul>{contract.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}
      <label>Pure/view function<select value={functionName} disabled={busy} onChange={event => { setFunction(event.target.value); setCalldata(''); setResult(undefined); }}><option value="">Choose a function</option>{functions.map(row => <option key={row.signature} value={row.name}>{row.signature}</option>)}</select></label>
      <label>ABI calldata (optional)<input value={calldata} disabled={busy} maxLength={8194} spellCheck={false} placeholder="Selector and encoded arguments, 0x…" onChange={event => { setCalldata(event.target.value.trim().toLowerCase()); setResult(undefined); }} /></label>
      <p>Functions with arguments require ABI calldata. Unsupported calls are rejected; no transaction or signature is requested.</p>
      <button disabled={busy || !validCall} onClick={() => void run(call)}>Call read-only function</button>
      <details><summary>Original contract evidence</summary><pre>{JSON.stringify(contract, null, 2)}</pre></details></>}
    {result && <article><h3>Call result</h3><p>Execution: {result.executionStatus} · {result.artifactKind} · {result.runtimeMode}</p><pre>{result.returnValue}</pre>{result.limitations.length > 0 && <ul>{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}<details><summary>Original call evidence</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></article>}
  </section>;
}
