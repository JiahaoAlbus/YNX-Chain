import { FormEvent, useEffect, useMemo, useState } from 'react';
import { loadEvidence, sourceLinks, universalSearch } from './api';
import { connectLiveData } from './live';
import { arrayFrom, type Availability, type Block, type DashboardSnapshot, type Transaction, type Validator } from './types';

const sections = ['Overview', 'Blocks', 'Transactions', 'Accounts', 'Contracts', 'Validators', 'Resources', 'Tokens', 'Governance', 'Trust', 'Analytics'];
const statusText: Record<Availability, string> = {
  connecting: 'Connecting', live: 'Live', polling: 'Polling fallback', stale: 'Stale', 'catching-up': 'Indexer catching up', unavailable: 'Upstream unavailable'
};

function short(value?: string, size = 9) { return value ? `${value.slice(0, size)}…${value.slice(-5)}` : '—'; }
function number(value?: number) { return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : 'Unavailable'; }

export function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>();
  const [availability, setAvailability] = useState<Availability>('connecting');
  const [statusDetail, setStatusDetail] = useState('Opening the canonical Explorer event stream.');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ loading?: boolean; error?: string; data?: unknown }>({});
  const [selected, setSelected] = useState<{ kind: string; id: string }>();
  const [evidence, setEvidence] = useState<Array<{url: string; status: number; body: unknown}>>([]);
  const [evidenceError, setEvidenceError] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiState, setAiState] = useState<'preview'|'streaming'|'review'|'rejected'>('preview');
  const [aiOutput, setAiOutput] = useState('');

  useEffect(() => connectLiveData({
    onSnapshot: setSnapshot,
    onStatus: (status, detail) => { setAvailability(status); if (detail) setStatusDetail(detail); }
  }), []);

  useEffect(() => {
    if (!selected) return;
    setEvidence([]); setEvidenceError('');
    loadEvidence(selected.kind, selected.id).then(setEvidence).catch(error => setEvidenceError(error.message));
  }, [selected]);

  const blocks = arrayFrom<Block>(snapshot?.blocks, ['blocks']);
  const transactions = arrayFrom<Transaction>(snapshot?.transactions, ['transactions', 'txs']);
  const validators = arrayFrom<Validator>(snapshot?.validators, ['validators']);
  const summary = snapshot?.summary;
  const indexedLag = Math.max(0, Number(summary?.latestHeight ?? 0) - Number(summary?.indexedHeight ?? summary?.latestHeight ?? 0));

  const nav = useMemo(() => sections.map(section => <a key={section} href={`#${section.toLowerCase()}`}>{section}</a>), []);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearch({ loading: true });
    try { setSearch({ data: await universalSearch(query) }); }
    catch (error) { setSearch({ error: error instanceof Error ? error.message : 'Search failed' }); }
  }

  function openEvidence(kind: string, id?: string) { if (id) { setSelected({ kind, id }); setAiOpen(false); } }

  async function runAI() {
    if (!selected || !evidence.length) return;
    setAiState('streaming'); setAiOutput('');
    const context = evidence.filter(item => item.status >= 200 && item.status < 300).map(item => ({ source: item.url, body: item.body }));
    try {
      const boundedContext = JSON.stringify(context).slice(0, 6_000);
      const response = await fetch(`/ai-gateway/ai/stream?session=explorer-public-explain&q=${encodeURIComponent(`Explain this ${selected.kind} using only the supplied source evidence and cite each source URL: ${boundedContext}`)}`);
      if (!response.ok || !response.body) throw new Error(`Provider unavailable (${response.status})`);
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const frame of buffer.split('\n\n').slice(0, -1)) {
          const type = frame.match(/^event: (.+)$/m)?.[1]; const data = frame.match(/^data: (.+)$/m)?.[1];
          if (type === 'token' && data) { try { const parsed = JSON.parse(data); setAiOutput(out => out + (parsed.token ?? parsed.content ?? data)); } catch { setAiOutput(out => out + data); } }
        }
        buffer = buffer.includes('\n\n') ? buffer.slice(buffer.lastIndexOf('\n\n') + 2) : buffer;
      }
      setAiState('review');
    } catch (error) { setAiOutput(error instanceof Error ? error.message : 'AI provider unavailable'); setAiState('review'); }
  }

  return <div className="explorer-app">
    <header className="topbar">
      <a className="brand" href="#overview" aria-label="YNX Explorer home"><span className="brand-mark">Y</span><span>YNX <b>Explorer</b></span></a>
      <nav aria-label="Explorer sections">{nav}</nav>
      <a className="monitor-link" href="http://127.0.0.1:4674">Operator Monitor ↗</a>
    </header>

    <main>
      <section className="hero" id="overview">
        <div className="hero-copy"><p className="eyebrow">Public testnet evidence desk</p><h1>Every claim should resolve to a source.</h1><p>Live RPC and Indexer records, presented with explicit freshness and verification paths.</p></div>
        <form className="search" role="search" onSubmit={submitSearch}>
          <label htmlFor="universal-search">Search height, transaction, ynx1 / 0x account, contract or Trust record</label>
          <div><input id="universal-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search canonical chain evidence"/><button>Verify</button></div>
        </form>
      </section>

      <section className={`source-state ${availability}`} aria-live="polite">
        <span className="pulse" aria-hidden="true"/><strong>{statusText[availability]}</strong><span>{statusDetail}</span><span className="source-time">Lag {indexedLag} block{indexedLag === 1 ? '' : 's'}</span>
      </section>

      {search.loading && <div className="notice">Searching the canonical Explorer…</div>}
      {search.error && <div className="notice error" role="alert">{search.error} <button onClick={submitSearch as never}>Retry</button></div>}
      {search.data !== undefined && <section className="search-result"><div><p className="eyebrow">Verified search result</p><h2>Canonical response</h2></div><pre>{JSON.stringify(search.data, null, 2)}</pre></section>}

      <section className="metrics" aria-label="Network summary">
        <article><span>Latest source block</span><strong>{number(summary?.latestHeight)}</strong><small>RPC source height</small></article>
        <article><span>Indexed height</span><strong>{number(summary?.indexedHeight)}</strong><small>{indexedLag ? `${indexedLag} behind source` : 'Caught up'}</small></article>
        <article><span>Indexed transactions</span><strong>{number(summary?.indexedTxCount)}</strong><small>No estimated TPS</small></article>
        <article><span>Network</span><strong>{summary?.network ?? 'Unavailable'}</strong><small>Chain ID {summary?.chainId ?? 'unavailable'}</small></article>
      </section>

      <div className="evidence-grid">
        <section className="panel" id="blocks"><div className="panel-head"><div><p className="eyebrow">Live finality ledger</p><h2>Blocks</h2></div><a href="/api/blocks/latest">Raw source ↗</a></div>
          {blocks.length ? <div className="dense-list">{blocks.slice(0, 8).map(block => <button key={block.hash ?? block.height} onClick={() => openEvidence('block', String(block.height))}><strong>#{block.height}</strong><span>{short(block.hash)}</span><time>{block.timestamp || 'Timestamp unavailable'}</time></button>)}</div> : <Empty label="No indexed blocks returned"/>}
        </section>
        <section className="panel" id="transactions"><div className="panel-head"><div><p className="eyebrow">Indexed activity</p><h2>Transactions</h2></div><a href="/api/txs">Raw source ↗</a></div>
          {transactions.length ? <div className="dense-list txs">{transactions.slice(0, 10).map(tx => <button key={tx.hash} onClick={() => openEvidence('transaction', tx.hash)}><strong>{short(tx.hash, 12)}</strong><span>{tx.type ?? 'Type unavailable'}</span><span>{short(tx.from)} → {short(tx.to)}</span></button>)}</div> : <Empty label="No indexed transactions returned"/>}
        </section>
      </div>

      <section className="domain-strip" aria-label="Explorer domains">
        <Domain id="accounts" title="Accounts" text="Canonical balances and native/EVM address equivalence." source="/api/accounts/{address}" />
        <Domain id="contracts" title="Contracts" text="Runtime identity, receipt and source-match evidence." source="/chain/ide/contracts/{address}" />
        <Domain id="resources" title="Resources" text="Real bandwidth, energy, delegation and sponsor evidence." source="/api/resource-market/analytics" />
        <Domain id="tokens" title="Tokens" text="YNXT native metadata only; no invented market price." source="/api/tokens/YNXT" />
        <Domain id="governance" title="Governance" text="Proposal state from the chain API; empty is valid." source="/chain/governance/proposals" />
        <Domain id="trust" title="Trust" text="Trace and correction evidence without hidden scoring." source="/chain/trust" />
      </section>

      <section className="validators panel" id="validators"><div className="panel-head"><div><p className="eyebrow">Declared and observed state</p><h2>Validators</h2></div><a href="/api/validators">Raw source ↗</a></div>
        {validators.length ? <table><thead><tr><th>Validator</th><th>Address</th><th>Voting power</th><th>Peer evidence</th></tr></thead><tbody>{validators.map(v => <tr key={v.address}><td>{v.moniker ?? 'Unnamed'}</td><td>{short(v.address, 14)}</td><td>{number(v.votingPower)}</td><td>{v.peerReady === undefined ? 'Unavailable' : v.peerReady ? 'Observed ready' : 'Not ready'}</td></tr>)}</tbody></table> : <Empty label="Validator endpoint returned no records"/>}
      </section>

      <section className="analytics" id="analytics"><div><p className="eyebrow">Truthful analytics</p><h2>Coverage, not market theater.</h2><p>YNX Explorer deliberately omits price, market cap, inferred uptime and extrapolated TPS until authoritative sources exist.</p></div><div className="source-list">{sourceLinks(snapshot).map(link => <a key={link.href} href={link.href}>{link.label}<span>↗</span></a>)}</div></section>
    </main>

    {selected && <aside className="drawer" aria-label="Evidence detail"><button className="drawer-close" onClick={() => setSelected(undefined)} aria-label="Close detail">×</button><p className="eyebrow">Source verification</p><h2>{selected.kind} · {short(selected.id, 16)}</h2>
      {evidenceError && <div className="notice error" role="alert">{evidenceError}</div>}
      {!evidence.length && !evidenceError && <div className="notice">Loading authoritative evidence…</div>}
      {evidence.map(item => <article className="evidence" key={item.url}><a href={item.url}>{item.url} ↗</a><span className={item.status < 300 ? 'verified' : 'failed'}>HTTP {item.status}</span><pre>{JSON.stringify(item.body, null, 2)}</pre></article>)}
      {evidence.length > 0 && <button className="ai-button" onClick={() => { setAiOpen(true); setAiState('preview'); }}>Explain with YNX AI</button>}
      {aiOpen && <section className="ai-workflow"><p className="eyebrow">Permissioned explanation</p><h3>Evidence-only context preview</h3><p>The selected public record and listed source URLs will be sent. No wallet, contacts, keys or private history are included.</p><dl><dt>Provider</dt><dd>YNX AI Gateway</dd><dt>Estimated resource</dt><dd>One bounded explanation request</dd><dt>Action authority</dt><dd>Read-only; cannot change chain or operations state</dd></dl>
        {aiState === 'preview' && <div className="actions"><button onClick={runAI}>Allow once & stream</button><button className="quiet" onClick={() => setAiOpen(false)}>Reject</button></div>}
        {aiState === 'streaming' && <div className="notice">Streaming provider-backed explanation… <button onClick={() => { setAiState('rejected'); setAiOutput('Request cancelled by the reviewer.'); }}>Cancel</button></div>}
        {(aiState === 'review' || aiState === 'rejected') && <div className="ai-result"><pre>{aiOutput}</pre><p>Review only. Follow the cited source links before relying on this explanation.</p><div className="actions"><button onClick={() => setAiState('preview')}>Retry</button><button className="quiet" onClick={() => setAiOpen(false)}>Reject result</button></div></div>}
      </section>}
    </aside>}
    <footer><span>YNX Explorer</span><span>Public testnet · live evidence only · {summary?.build?.release ?? 'release unavailable'}</span></footer>
  </div>;
}

function Empty({ label }: { label: string }) { return <div className="empty"><strong>{label}</strong><span>Empty and unavailable states are shown without synthetic records.</span></div>; }
function Domain({ id, title, text, source }: { id: string; title: string; text: string; source: string }) { return <article id={id}><span className="domain-index">0{sections.indexOf(title)}</span><h3>{title}</h3><p>{text}</p><code>{source}</code></article>; }
