import { useEffect, useRef, useState } from 'react';
import './native-tools.css';
import { connectDeveloperWebWallet, restoreDeveloperWebWallet, subscribeDeveloperWebWalletEvents } from '../wallet/safe-authorize-launcher';
import { NativeContractTools } from './NativeContractTools';
import { createRequestEpoch } from './requestEpoch';
import { readWorkspaceResponse } from './workspaceResponse';
import { NativeSolidityTools, type SolidityDraft } from './NativeSolidityTools';
type Identity = { csrf: string; account: string; projectId: string; expiresAt: number; sessionExpiresAt?: number };
type EditReview = { summary: string; bundle: unknown };
type Proposal = { csrf: string; proposalId: string; prompt: string; context: string; contextBytes: number; wirePrompt?: string; requestBytes?: number; model: string; mode?: string; expiresAt?: number };
type SavedRequest = { id: string; status: string; createdAt: string; updatedAt: string; model: string; prompt?: string; context?: string; text?: string; edit?: EditReview; editRequiresRecapture?: boolean };
export function NativeToolsPage() {
  const sessionId = new URLSearchParams(window.location.search).get('sessionId') || '';
  const requests = useRef(createRequestEpoch()).current, generation = useRef<AbortController | null>(null);
  const walletRequests = useRef(createRequestEpoch()).current, walletCleanup = useRef<(() => void) | null>(null);
  const activeIdentity = useRef<Identity | undefined>(undefined), working = useRef(false), foregroundCheck = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [solidityDraft, setSolidityDraft] = useState<SolidityDraft>({ name: '', source: '' });
  const [selectedEdit, setSelectedEdit] = useState(false), [editReview, setEditReview] = useState<EditReview>();
  const [saved, setSaved] = useState(false), [savedRequests, setSavedRequests] = useState<SavedRequest[]>(), [openedRequest, setOpenedRequest] = useState<SavedRequest>();
  const [identity, setIdentity] = useState<Identity>(), [prompt, setPrompt] = useState(''), [context, setContext] = useState(''), [proposal, setProposal] = useState<Proposal>(), [result, setResult] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState<unknown>(), [compiler, setCompiler] = useState<unknown>(), [wallet, setWallet] = useState<unknown>(), [connection, setConnection] = useState(''), [method, setMethod] = useState('eth_blockNumber'), [params, setParams] = useState('[]'), [rpcResult, setRpcResult] = useState<unknown>();
  function retireWallet(message = '') {
    walletRequests.invalidate(); walletCleanup.current?.(); walletCleanup.current = null;
    setConnection(message);
  }
  function retire(message: string) {
    requests.invalidate(); activeIdentity.current = undefined; working.current = false;
    generation.current?.abort(); generation.current = null;
    setGenerating(false); setBusy(false); retireWallet();
    setIdentity(undefined); setProposal(undefined); setResult(''); setWallet(undefined);
    setEditReview(undefined); setStatus(undefined); setCompiler(undefined); setRpcResult(undefined);
    setSaved(false); setSavedRequests(undefined); setOpenedRequest(undefined); setError(message);
    // Unsent prompt/context remain the user's draft. A retired answer or review
    // cannot silently become a new project's request.
  }
  function acceptIdentity(value: Identity, verification = false) {
    const deadline = value.sessionExpiresAt ?? value.expiresAt, previous = activeIdentity.current;
    if ((!verification && !value.csrf) || (verification && !previous) || typeof value.account !== 'string' || !value.account || typeof value.projectId !== 'string' || !value.projectId ||
        !Number.isFinite(value.expiresAt) || !Number.isFinite(deadline) || deadline <= Date.now()) {
      retire('The workspace connection could not be verified. Your unsent input is preserved.');
      throw new Error('The workspace connection could not be verified.');
    }
    if (previous && (previous.account !== value.account || previous.projectId !== value.projectId)) {
      retire('The Wallet project changed. Reopen its tools before reviewing another request. Your unsent input is preserved.');
      throw new Error('The Wallet project changed.');
    }
    const accepted = verification ? { ...value, csrf: previous!.csrf } : value;
    activeIdentity.current = accepted; setIdentity(accepted);
  }
  async function request(path: string, options?: RequestInit, verification = false) {
    const captured = requests.capture();
    const response = await fetch(`/runtime/native-tools/${path}?sessionId=${encodeURIComponent(sessionId)}${verification ? '&checkOnly=1' : ''}`, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' } });
    let value;
    try { value = await readWorkspaceResponse(response); }
    catch (cause) {
      // A retired response must not clear a newly admitted workspace, including
      // when the proxy body cannot be decoded. HTTP 401 still ends this session.
      if (!requests.current(captured)) throw new Error('This request was retired.');
      if (response.status === 401) retire('The Wallet project session ended. Your unsent input is preserved.');
      throw cause;
    }
    if (!requests.current(captured)) throw new Error('This request was retired.');
    if (!response.ok) {
      if (response.status === 401) {
        // Retire data and one-use reviews from the disconnected workspace.
        // Keep only the user's unsent draft for explicit review after sign-in.
        retire(value.error || 'The Wallet project session ended.');
      }
      throw Object.assign(new Error(value.error || 'The tool is unavailable.'), { status: response.status, body: value });
    }
    if (path === 'context') acceptIdentity(value, verification);
    return value;
  }
  useEffect(() => { const captured = requests.invalidate(); request('context').then(value => { if (requests.current(captured)) setIdentity(value); }).catch(cause => { if (requests.current(captured)) setError(cause.message); }); return () => { requests.invalidate(); walletRequests.invalidate(); walletCleanup.current?.(); walletCleanup.current = null; generation.current?.abort(); generation.current = null; }; }, [sessionId, requests, walletRequests]);
  useEffect(() => {
    if (!identity) return;
    const deadline = identity.sessionExpiresAt ?? identity.expiresAt;
    let timer: number;
    const expire = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) retire('The Wallet project session ended. Your unsent input is preserved.');
      else timer = window.setTimeout(expire, Math.min(remaining, 2147483647));
    };
    expire();
    const check = () => {
      if (document.visibilityState === 'hidden' || foregroundCheck.current || !activeIdentity.current) return;
      foregroundCheck.current = true; const captured = requests.capture();
      void request('context', undefined, true).catch(cause => {
        if (requests.current(captured)) retire(cause instanceof Error ? cause.message : 'The workspace connection could not be verified.');
      }).finally(() => { foregroundCheck.current = false; });
    };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [identity, requests]);
  useEffect(() => {
    if (!proposal?.expiresAt) return;
    const timer = window.setTimeout(() => { setProposal(undefined); setError('This request review expired. Preview it again before sending.'); }, Math.max(0, proposal.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [proposal]);
  async function run(task: () => Promise<void>) { if (working.current) return; working.current = true; const captured = requests.capture(); setBusy(true); setError(''); try { await task(); } catch (cause) { if (requests.current(captured)) setError(cause instanceof Error ? cause.message : String(cause)); } finally { if (requests.current(captured)) { working.current = false; setBusy(false); } } }
  async function preview() {
    const fresh = await request('context');
    setProposal(await request('proposals', { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf, prompt, context, ...(selectedEdit ? { mode: 'selected-edit' } : {}) }) })); setResult(''); setEditReview(undefined); setSaved(false);
  }
  async function approve() {
    if (!proposal) return; const reviewed = proposal; setProposal(undefined);
    const captured = requests.capture(), controller = new AbortController(); generation.current = controller; setGenerating(true);
    try {
      const value = await request('approve', { method: 'POST', signal: controller.signal, body: JSON.stringify({ csrf: reviewed.csrf, proposalId: reviewed.proposalId, approval: 'send-reviewed-context-once' }) });
      if (requests.current(captured)) { setResult(value.text || 'The model returned no text. No changes were applied.'); setEditReview(value.edit); setSaved(value.saved === true); }
    } finally { if (requests.current(captured)) { generation.current = null; setGenerating(false); } }
  }
  function stopWaiting() {
    requests.invalidate(); generation.current?.abort(); generation.current = null;
    working.current = false;
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
      const latest = await request('context', undefined, true);
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
  return <main className="ynx-tools-page"><header><img src="/brand/ynx-logo.png" alt="YNX" /><div><h1>YNX Tools</h1><p>Testnet development · Chain 6423</p></div>{identity && (identity.sessionExpiresAt ?? identity.expiresAt) > Date.now() && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId) && <a href={`/sso/core-open?sessionId=${sessionId}`}>Return to editor</a>}<a href="/projects">Projects</a></header>
    {!identity ? <section><p>Open these tools from an active Wallet project.</p><button disabled={busy} onClick={() => void run(async () => { await request('context'); })}>Refresh workspace connection</button><a href="/sso/start">Sign in with YNX Wallet</a></section> : <>
      <p className="tools-account">{identity.account} · {identity.projectId}</p>
      {generating && <p role="status">Generating your reviewed plan… <button onClick={stopWaiting}>Stop waiting for AI</button></p>}
      <NativeContractTools request={request} run={run} busy={busy} />
      <NativeSolidityTools draft={solidityDraft} onDraft={setSolidityDraft} request={request} run={run} busy={busy} />
      <section><h2>Chain</h2><p>Query the current Testnet and compiler capabilities. The starter uses read-only RPC and does not sign or deploy.</p><div className="tools-actions"><button disabled={busy} onClick={() => void run(async () => { setStatus(await request('chain/status')); setCompiler(await request('chain/compiler')); })}>Check Testnet</button></div>{status !== undefined && <pre>{JSON.stringify(status, null, 2)}</pre>}{compiler !== undefined && <details><summary>Compiler capabilities</summary><pre>{JSON.stringify(compiler, null, 2)}</pre></details>}<label>Read-only RPC<select value={method} disabled={busy} onChange={event => setMethod(event.target.value)}>{['eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber'].map(item => <option key={item}>{item}</option>)}</select></label><label>Parameters (JSON array)<input value={params} disabled={busy} onChange={event => setParams(event.target.value)} /></label><button disabled={busy} onClick={() => void run(async () => { const fresh = await request('context'); setRpcResult(await request('chain/rpc', { method: 'POST', body: JSON.stringify({ csrf: fresh.csrf, method, params: JSON.parse(params) }) })); })}>Query RPC</button>{rpcResult !== undefined && <pre>{JSON.stringify(rpcResult, null, 2)}</pre>}<p>In the editor, run <strong>YNX: Create Read-only Testnet SDK Starter</strong>, then run the shown Node command in its terminal.</p></section>
      <section><h2>AI development plan</h2><p>Only the text below will be sent to the existing YNX hosted model. Paste a selected editor context or enter a public example; do not include keys or credentials.</p><label htmlFor="native-ai-mode">Review mode</label><select id="native-ai-mode" disabled={busy} value={selectedEdit ? "selected-edit" : "plan"} onChange={event => { setSelectedEdit(event.target.value === "selected-edit"); setProposal(undefined); setEditReview(undefined); setResult(''); }}><option value="plan">Development plan</option><option value="selected-edit">Selected text replacement</option></select>{selectedEdit && <p>Copy a unique passage with <strong>YNX: Copy Selected Context for Review</strong> and paste its complete JSON below. The suggested edit is exported for editor diff review; it cannot apply itself.</p>}<label htmlFor="native-ai-prompt">Request</label><textarea id="native-ai-prompt" value={prompt} disabled={busy} maxLength={4096} onChange={event => { setPrompt(event.target.value); setProposal(undefined); }} /><label htmlFor="native-ai-context">Selected context</label><textarea id="native-ai-context" value={context} disabled={busy} onChange={event => { setContext(event.target.value); setProposal(undefined); }} placeholder="Use YNX: Copy Selected Context for Review in the editor, then paste here." /><button disabled={busy || prompt.trim().length < 4} onClick={() => void run(preview)}>Preview request</button>
      {proposal && <aside><h3>Approve this request</h3><p>Model {proposal.model} · {proposal.contextBytes} bytes of selected context</p><pre>{proposal.prompt}</pre><details open><summary>Exact context</summary><pre>{proposal.context || '(no context)'}</pre></details>{proposal.wirePrompt && <details><summary>Complete model request · {proposal.requestBytes} / 8000 bytes</summary><pre>{proposal.wirePrompt}</pre></details>}<p>This sends one reviewed request. Earlier requests and project files are not included. The request and completed answer will be saved privately for this project.</p><button disabled={busy} onClick={() => void run(approve)}>Send reviewed context once</button><button disabled={busy} onClick={() => setProposal(undefined)}>Cancel</button></aside>}
      {result && <article><h3>{editReview ? 'Suggested replacement' : 'Suggested plan'}</h3>{editReview && <EditBundle review={editReview} />}<pre>{result}</pre>{saved && <p>Saved to this project's private AI requests.</p>}<p>No files, commands or transactions were changed. Review a suggested diff in the editor before applying it.</p></article>}
      <details><summary>Saved AI requests</summary><p>Reopen this project's saved requests. Opening a record does not send it to the model.</p><button disabled={busy} onClick={() => void run(async () => { const value = await request('ai/conversations'); setSavedRequests(value.conversations); setOpenedRequest(undefined); })}>Load saved requests</button>{savedRequests?.length === 0 && <p>No saved requests yet.</p>}{savedRequests?.map(item => <p key={item.id}><button disabled={busy} onClick={() => void run(async () => { const value = await request(`ai/conversations/${encodeURIComponent(item.id)}`); setOpenedRequest(value.conversation); })}>Open {new Date(item.createdAt).toLocaleString()} · {item.status}</button></p>)}{openedRequest && <article><h3>Saved request · {openedRequest.status}</h3>{openedRequest.editRequiresRecapture && <p>This saved suggestion has no valid edit review for this editor session. Its text remains available; copy and review a fresh selection before creating a new editor change bundle.</p>}{openedRequest.status !== 'generating' && <button disabled={busy} onClick={() => void run(deleteSavedRequest)}>Delete saved request</button>}<pre>{openedRequest.prompt}</pre><details><summary>Reviewed context</summary><pre>{openedRequest.context || '(no context)'}</pre></details>{openedRequest.status === 'completed' ? <><pre>{openedRequest.text}</pre>{openedRequest.edit && <EditBundle review={openedRequest.edit} />}</> : <p>This request has no saved completed answer. It will not be retried automatically; review a new request to send again.</p>}</article>}</details></section>
      <section><h2>Wallet</h2><p>Signing stays in the Wallet’s separate review. This page does not hold keys, and identity access does not authorize deployment.</p><button disabled={busy} onClick={() => void run(async () => setWallet(await request('wallet/readiness')))}>Check Wallet readiness</button>{wallet !== undefined && <details open><summary>Actual readiness</summary><pre>{JSON.stringify(wallet, null, 2)}</pre></details>}<button disabled={busy} onClick={() => void run(reviewWallet)}>Review YNX Wallet connection</button>{connection && <p>{connection}</p>}<p>Contract deployment is not available for this workspace. No transaction is submitted.</p></section>
    </>}{error && <p role="alert">{error}</p>}<footer>YNX Developer</footer></main>;
}

function EditBundle({ review }: { review: EditReview }) {
  const [copyStatus, setCopyStatus] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(JSON.stringify(review.bundle)); setCopyStatus('Review bundle copied. Paste it into YNX: Apply Reviewed Text Changes.'); }
    catch { setCopyStatus('Clipboard is unavailable. Download the bundle and copy its JSON into the editor review command.'); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(review.bundle, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ynx-reviewed-text.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <aside><h4>{review.summary}</h4><p>Copy the review bundle, then paste it into <strong>YNX: Apply Reviewed Text Changes</strong>. The editor shows the diff and checks the original document version, digest, unique selection and workspace path before asking to apply. Save the file after reviewing the change.</p><details open><summary>Exact editor review bundle</summary><pre>{JSON.stringify(review.bundle, null, 2)}</pre></details><button onClick={() => void copy()}>Copy editor review bundle</button><button onClick={download}>Download editor review bundle</button>{copyStatus && <p role="status">{copyStatus}</p>}</aside>;
}
