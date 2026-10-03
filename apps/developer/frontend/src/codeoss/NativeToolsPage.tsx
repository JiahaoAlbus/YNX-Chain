import { useEffect, useRef, useState } from 'react';
import './native-tools.css';
import { connectDeveloperWebWallet, restoreDeveloperWebWallet, subscribeDeveloperWebWalletEvents } from '../wallet/safe-authorize-launcher';
import { NativeContractTools } from './NativeContractTools';
import { createRequestEpoch } from './requestEpoch';
type Identity = { csrf: string; account: string; projectId: string; expiresAt: number };
type Proposal = { csrf: string; proposalId: string; prompt: string; context: string; contextBytes: number; wirePrompt?: string; requestBytes?: number; model: string };
type SavedRequest = { id: string; status: string; createdAt: string; updatedAt: string; model: string; prompt?: string; context?: string; text?: string };
export function NativeToolsPage() {
  const sessionId = new URLSearchParams(window.location.search).get('sessionId') || '';
  const requests = useRef(createRequestEpoch()).current, generation = useRef<AbortController | null>(null);
  const walletRequests = useRef(createRequestEpoch()).current, walletCleanup = useRef<(() => void) | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false), [savedRequests, setSavedRequests] = useState<SavedRequest[]>(), [openedRequest, setOpenedRequest] = useState<SavedRequest>();
  const [identity, setIdentity] = useState<Identity>(), [prompt, setPrompt] = useState(''), [context, setContext] = useState(''), [proposal, setProposal] = useState<Proposal>(), [result, setResult] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState<unknown>(), [compiler, setCompiler] = useState<unknown>(), [wallet, setWallet] = useState<unknown>(), [connection, setConnection] = useState(''), [method, setMethod] = useState('eth_blockNumber'), [params, setParams] = useState('[]'), [rpcResult, setRpcResult] = useState<unknown>();
  function retireWallet(message = '') {
    walletRequests.invalidate(); walletCleanup.current?.(); walletCleanup.current = null;
    setConnection(message);
  }
  async function request(path: string, options?: RequestInit) {
    const captured = requests.capture();
    const response = await fetch(`/runtime/native-tools/${path}?sessionId=${encodeURIComponent(sessionId)}`, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' } });
    const value = await response.json();
    if (!requests.current(captured)) throw new Error('This request was retired.');
    if (!response.ok) {
      if (response.status === 401) {
        // Retire data and one-use reviews from the disconnected workspace.
        // Keep only the user's unsent draft for explicit review after sign-in.
        requests.invalidate(); generation.current?.abort(); generation.current = null;
        setGenerating(false); setBusy(false); retireWallet();
        setIdentity(undefined); setProposal(undefined); setResult(''); setWallet(undefined);
        setStatus(undefined); setCompiler(undefined); setRpcResult(undefined);
        setSaved(false); setSavedRequests(undefined); setOpenedRequest(undefined);
        setError(value.error || 'The Wallet project session ended.');
      }
      throw new Error(value.error || 'The tool is unavailable.');
    }
    return value;
  }
  useEffect(() => { const captured = requests.invalidate(); request('context').then(value => { if (requests.current(captured)) setIdentity(value); }).catch(cause => { if (requests.current(captured)) setError(cause.message); }); return () => { requests.invalidate(); walletRequests.invalidate(); walletCleanup.current?.(); walletCleanup.current = null; generation.current?.abort(); generation.current = null; }; }, [sessionId, requests, walletRequests]);
  async function run(task: () => Promise<void>) { const captured = requests.capture(); setBusy(true); setError(''); try { await task(); } catch (cause) { if (requests.current(captured)) setError(cause instanceof Error ? cause.message : String(cause)); } finally { if (requests.current(captured)) setBusy(false); } }
  async function preview() {
    const fresh = await request('context'); setIdentity(fresh);
    setProposal(await request('proposals', { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf, prompt, context }) })); setResult(''); setSaved(false);
  }
  async function approve() {
    if (!proposal) return; const reviewed = proposal; setProposal(undefined);
    const captured = requests.capture(), controller = new AbortController(); generation.current = controller; setGenerating(true);
    try {
      const value = await request('approve', { method: 'POST', signal: controller.signal, body: JSON.stringify({ csrf: reviewed.csrf, proposalId: reviewed.proposalId, approval: 'send-reviewed-context-once' }) });
      if (requests.current(captured)) { setResult(value.text || 'The model returned no text. No changes were applied.'); setSaved(value.saved === true); }
    } finally { if (requests.current(captured)) { generation.current = null; setGenerating(false); } }
  }
  function stopWaiting() {
    requests.invalidate(); generation.current?.abort(); generation.current = null;
    setGenerating(false); setBusy(false); setProposal(undefined);
    setError('Stopped waiting. Context already sent cannot be recalled. No changes were applied; sending again requires a new review.');
  }
  async function deleteSavedRequest() {
    if (!openedRequest || !window.confirm('Delete this saved request and answer from this project? This cannot be undone here.')) return;
    const id = openedRequest.id, fresh = await request('context');
    await request(`ai/conversations/${encodeURIComponent(id)}/delete`, { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf }) });
    setOpenedRequest(undefined); setSavedRequests(value => value?.filter(item => item.id !== id));
  }
  async function reviewWallet() {
    retireWallet();
    const captured = walletRequests.capture(), coreEpoch = requests.capture();
    const current = () => walletRequests.current(captured);
    const core = await request('context');
    if (!current()) return;
    const value = await connectDeveloperWebWallet('ynx-wallet');
    if (!current()) return;
    if (value.status !== 'connected' || !value.providerKind || !value.account) { setConnection(value.detail); return; }
    const account = value.account.toLowerCase(), providerKind = value.providerKind;
    const recheckCore = async () => {
      const latest = await request('context');
      if (latest.account !== core.account || latest.projectId !== core.projectId)
        throw new Error('The Wallet project changed. Reopen its tools before connecting.');
    };
    const changed = () => {
      if (!current()) return;
      retireWallet('The selected Wallet account, network or connection changed. Review the Wallet connection again.');
      const retired = walletRequests.capture();
      void recheckCore().catch(cause => { if (walletRequests.current(retired) && requests.current(coreEpoch)) setError(cause instanceof Error ? cause.message : String(cause)); });
    };
    const unsubscribe = await subscribeDeveloperWebWalletEvents(providerKind, value.connection, next => {
      if (next.status !== 'connected' || next.account?.toLowerCase() !== account) changed();
    });
    if (!current()) { unsubscribe(); return; }
    // Listen before the passive read so a change during subscription discovery
    // cannot preserve the account returned by the original approval.
    const restore = async () => {
      const latest = await restoreDeveloperWebWallet(providerKind);
      if (!current()) return false;
      if (latest.status !== 'connected' || latest.account?.toLowerCase() !== account) { changed(); return false; }
      await recheckCore();
      return current();
    };
    const focus = () => { void restore().catch(cause => {
      if (!current()) return;
      retireWallet('The Wallet connection could not be revalidated. Review it again.');
      setError(cause instanceof Error ? cause.message : String(cause));
    }); };
    window.addEventListener('focus', focus);
    walletCleanup.current = () => { unsubscribe(); window.removeEventListener('focus', focus); };
    try {
      if (await restore()) setConnection(`Wallet approved account ${value.account} on Chain 6423. This connection does not authorize signing or deployment.`);
    } catch (cause) { if (current()) retireWallet(); throw cause; }
  }
  return <main className="ynx-tools-page"><header><img src="/brand/ynx-logo.png" alt="YNX" /><div><h1>YNX Tools</h1><p>Testnet development · Chain 6423</p></div><a href="/">Projects</a></header>
    {!identity ? <section><p>Open these tools from an active Wallet project.</p><a href="/sso/start">Sign in with YNX Wallet</a></section> : <>
      <p className="tools-account">{identity.account} · {identity.projectId}</p>
      {generating && <p role="status">Generating your reviewed plan… <button onClick={stopWaiting}>Stop waiting for AI</button></p>}
      <NativeContractTools request={request} run={run} busy={busy} />
      <section><h2>Chain</h2><p>Query the current Testnet and compiler capabilities. The starter uses read-only RPC and does not sign or deploy.</p><div className="tools-actions"><button disabled={busy} onClick={() => void run(async () => { setStatus(await request('chain/status')); setCompiler(await request('chain/compiler')); })}>Check Testnet</button></div>{status !== undefined && <pre>{JSON.stringify(status, null, 2)}</pre>}{compiler !== undefined && <details><summary>Compiler capabilities</summary><pre>{JSON.stringify(compiler, null, 2)}</pre></details>}<label>Read-only RPC<select value={method} disabled={busy} onChange={event => setMethod(event.target.value)}>{['eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber'].map(item => <option key={item}>{item}</option>)}</select></label><label>Parameters (JSON array)<input value={params} disabled={busy} onChange={event => setParams(event.target.value)} /></label><button disabled={busy} onClick={() => void run(async () => { const fresh = await request('context'); setRpcResult(await request('chain/rpc', { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf, method, params: JSON.parse(params) }) })); })}>Query RPC</button>{rpcResult !== undefined && <pre>{JSON.stringify(rpcResult, null, 2)}</pre>}<p>In the editor, run <strong>YNX: Create Read-only Testnet SDK Starter</strong>, then run the shown Node command in its terminal.</p></section>
      <section><h2>AI development plan</h2><p>Only the text below will be sent to the existing YNX hosted model. Paste a selected editor context or enter a public example; do not include keys or credentials.</p><label htmlFor="native-ai-prompt">Request</label><textarea id="native-ai-prompt" value={prompt} disabled={busy} maxLength={4096} onChange={event => { setPrompt(event.target.value); setProposal(undefined); }} /><label htmlFor="native-ai-context">Selected context</label><textarea id="native-ai-context" value={context} disabled={busy} onChange={event => { setContext(event.target.value); setProposal(undefined); }} placeholder="Use YNX: Copy Selected Context for Review in the editor, then paste here." /><button disabled={busy || prompt.trim().length < 4} onClick={() => void run(preview)}>Preview request</button>
      {proposal && <aside><h3>Approve this request</h3><p>Model {proposal.model} · {proposal.contextBytes} bytes of selected context</p><pre>{proposal.prompt}</pre><details open><summary>Exact context</summary><pre>{proposal.context || '(no context)'}</pre></details>{proposal.wirePrompt && <details><summary>Complete model request · {proposal.requestBytes} / 8000 bytes</summary><pre>{proposal.wirePrompt}</pre></details>}<p>This sends one reviewed request. Earlier requests and project files are not included. The request and completed answer will be saved privately for this project.</p><button disabled={busy} onClick={() => void run(approve)}>Send reviewed context once</button><button disabled={busy} onClick={() => setProposal(undefined)}>Cancel</button></aside>}
      {result && <article><h3>Suggested plan</h3><pre>{result}</pre>{saved && <p>Saved to this project's private AI requests.</p>}<p>No files, commands or transactions were changed. Review a suggested diff in the editor before applying it.</p></article>}
      <details><summary>Saved AI requests</summary><p>Reopen this project's saved requests. Opening a record does not send it to the model.</p><button disabled={busy} onClick={() => void run(async () => { const value = await request('ai/conversations'); setSavedRequests(value.conversations); setOpenedRequest(undefined); })}>Load saved requests</button>{savedRequests?.length === 0 && <p>No saved requests yet.</p>}{savedRequests?.map(item => <p key={item.id}><button disabled={busy} onClick={() => void run(async () => { const value = await request(`ai/conversations/${encodeURIComponent(item.id)}`); setOpenedRequest(value.conversation); })}>Open {new Date(item.createdAt).toLocaleString()} · {item.status}</button></p>)}{openedRequest && <article><h3>Saved request · {openedRequest.status}</h3>{openedRequest.status !== 'generating' && <button disabled={busy} onClick={() => void run(deleteSavedRequest)}>Delete saved request</button>}<pre>{openedRequest.prompt}</pre><details><summary>Reviewed context</summary><pre>{openedRequest.context || '(no context)'}</pre></details>{openedRequest.status === 'completed' ? <pre>{openedRequest.text}</pre> : <p>This request has no saved completed answer. It will not be retried automatically; review a new request to send again.</p>}</article>}</details></section>
      <section><h2>Wallet</h2><p>Signing stays in the Wallet’s separate review. This page does not hold keys, and identity access does not authorize deployment.</p><button disabled={busy} onClick={() => void run(async () => setWallet(await request('wallet/readiness')))}>Check Wallet readiness</button>{wallet !== undefined && <details open><summary>Actual readiness</summary><pre>{JSON.stringify(wallet, null, 2)}</pre></details>}<button disabled={busy} onClick={() => void run(reviewWallet)}>Review YNX Wallet connection</button>{connection && <p>{connection}</p>}<p>Contract deployment is not available for this workspace. No transaction is submitted.</p></section>
    </>}{error && <p role="alert">{error}</p>}<footer>YNX Developer · OpenVSCode Server 1.109.5 · MIT. Extension compatibility depends on its platform and license.</footer></main>;
}
