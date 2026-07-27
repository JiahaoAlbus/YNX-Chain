import { FormEvent, useEffect, useMemo, useState } from 'react';
import { loadBlockPage, loadEvidence, loadTransactionPage, sourceLinks, universalSearch, type BlockPage as BlockCursorPage, type TransactionPage as TransactionCursorPage } from './api';
import { connectLiveData } from './live';
import { pathForSelection, selectionFromSearchResult, selectionFromURL, type EvidenceSelection, type SearchResult } from './routing';
import { arrayFrom, summaryChainID, summaryLatestHeight, summaryNetworkName, type Availability, type Block, type DashboardSnapshot, type Transaction, type Validator } from './types';
import { localeNames, locales, type Locale, useI18n } from './i18n';

const sections = ['Overview', 'Blocks', 'Transactions', 'Accounts', 'Contracts', 'Validators', 'Resources', 'Tokens', 'Governance', 'Trust', 'Analytics'];
function short(value?: string, size = 9) { return value ? `${value.slice(0, size)}…${value.slice(-5)}` : '—'; }

export function App() {
  const { locale, aiLanguage, setLocale, setAILanguage, t, number:formatNumber, date:formatDate } = useI18n();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>();
  const [availability, setAvailability] = useState<Availability>('connecting');
  const [statusDetail, setStatusDetail] = useState('Opening the canonical Explorer event stream.');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ loading?: boolean; error?: string; data?: SearchResult }>({});
  const [selected, setSelectedState] = useState<EvidenceSelection|undefined>(() => selectionFromURL(new URL(location.href)));
  const [evidence, setEvidence] = useState<Array<{url: string; status: number; body: unknown}>>([]);
  const [evidenceError, setEvidenceError] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiState, setAiState] = useState<'preview'|'streaming'|'review'|'rejected'>('preview');
  const [aiOutput, setAiOutput] = useState('');
  const pageSize = 5;
  const [blockPages, setBlockPages] = useState<BlockCursorPage[]>([]);
  const [blockPageIndex, setBlockPageIndex] = useState(0);
  const [blockPageState, setBlockPageState] = useState<{ loading?: boolean; error?: string }>({});
  const [transactionPages, setTransactionPages] = useState<TransactionCursorPage[]>([]);
  const [transactionPageIndex, setTransactionPageIndex] = useState(0);
  const [transactionPageState, setTransactionPageState] = useState<{ loading?: boolean; error?: string }>({});
  const [online,setOnline]=useState(navigator.onLine);const[installPrompt,setInstallPrompt]=useState<Event&{prompt():Promise<void>}|null>(null);

  useEffect(() => connectLiveData({
    onSnapshot: setSnapshot,
    onStatus: (status, detail) => { setAvailability(status); if (detail) setStatusDetail(detail); }
  }), []);
  useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false),install=(event:Event)=>{event.preventDefault();setInstallPrompt(event as Event&{prompt():Promise<void>})};addEventListener('online',on);addEventListener('offline',off);addEventListener('beforeinstallprompt',install);return()=>{removeEventListener('online',on);removeEventListener('offline',off);removeEventListener('beforeinstallprompt',install)}},[]);
  useEffect(() => {
    const restore = () => setSelectedState(selectionFromURL(new URL(location.href)));
    addEventListener('popstate', restore);
    return () => removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setEvidence([]); setEvidenceError('');
    loadEvidence(selected.kind, selected.id).then(setEvidence).catch(error => setEvidenceError(error.message));
  }, [selected]);

  const snapshotBlocks = arrayFrom<Block>(snapshot?.blocks, ['blocks']);
  const snapshotTransactions = arrayFrom<Transaction>(snapshot?.transactions, ['transactions', 'txs']);
  const validators = arrayFrom<Validator>(snapshot?.validators, ['validators']);
  const summary = snapshot?.summary;
  const latestHeight = summaryLatestHeight(summary);
  const networkName = summaryNetworkName(summary);
  const chainID = summaryChainID(summary);
  const indexedLag = summary?.syncLagBlocks ?? Math.max(0, Number(latestHeight ?? 0) - Number(summary?.indexedHeight ?? latestHeight ?? 0));
  const statusText:Record<Availability,string>={connecting:t('connecting'),live:t('live'),polling:t('polling'),stale:t('stale'),'catching-up':t('catchingUp'),unavailable:t('unavailable')};
  const currentBlockPage = blockPages[blockPageIndex];
  const currentTransactionPage = transactionPages[transactionPageIndex];
  const displayedBlocks = currentBlockPage?.blocks ?? (blockPageIndex === 0 ? snapshotBlocks.slice(0, pageSize) : []);
  const displayedTransactions = currentTransactionPage?.transactions ?? (transactionPageIndex === 0 ? snapshotTransactions.slice(0, pageSize) : []);

  useEffect(() => {
    if (blockPageIndex !== 0) return;
    void refreshBlockPage();
  }, [latestHeight, blockPageIndex]);

  useEffect(() => {
    if (transactionPageIndex !== 0) return;
    void refreshTransactionPage();
  }, [summary?.indexedTxCount, transactionPageIndex]);

  const nav = useMemo(() => sections.map(section => <a key={section} href={`#${section.toLowerCase()}`}>{section}</a>), []);

  async function refreshBlockPage() {
    setBlockPageState({ loading: true });
    try {
      const page = await loadBlockPage('', pageSize);
      setBlockPages([page]);
      setBlockPageState({});
    } catch (error) {
      setBlockPageState({ error: error instanceof Error ? error.message : 'Block source unavailable' });
    }
  }

  async function refreshTransactionPage() {
    setTransactionPageState({ loading: true });
    try {
      const page = await loadTransactionPage('', pageSize);
      setTransactionPages([page]);
      setTransactionPageState({});
    } catch (error) {
      setTransactionPageState({ error: error instanceof Error ? error.message : 'Transaction source unavailable' });
    }
  }

  async function nextBlockPage() {
    const current = blockPages[blockPageIndex];
    if (!current?.nextCursor || blockPageState.loading) return;
    if (blockPages[blockPageIndex + 1]) {
      setBlockPageIndex(blockPageIndex + 1);
      return;
    }
    setBlockPageState({ loading: true });
    try {
      const page = await loadBlockPage(current.nextCursor, pageSize);
      setBlockPages(previous => [...previous.slice(0, blockPageIndex + 1), page]);
      setBlockPageIndex(blockPageIndex + 1);
      setBlockPageState({});
    } catch (error) {
      setBlockPageState({ error: error instanceof Error ? error.message : 'Block cursor rejected' });
    }
  }

  async function nextTransactionPage() {
    const current = transactionPages[transactionPageIndex];
    if (!current?.nextCursor || transactionPageState.loading) return;
    if (transactionPages[transactionPageIndex + 1]) {
      setTransactionPageIndex(transactionPageIndex + 1);
      return;
    }
    setTransactionPageState({ loading: true });
    try {
      const page = await loadTransactionPage(current.nextCursor, pageSize);
      setTransactionPages(previous => [...previous.slice(0, transactionPageIndex + 1), page]);
      setTransactionPageIndex(transactionPageIndex + 1);
      setTransactionPageState({});
    } catch (error) {
      setTransactionPageState({ error: error instanceof Error ? error.message : 'Transaction cursor rejected' });
    }
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearch({ loading: true });
    try {
      const data = await universalSearch(query);
      setSearch({ data });
      const resolved = selectionFromSearchResult(data);
      if (resolved) setSelected(resolved);
    }
    catch (error) { setSearch({ error: error instanceof Error ? error.message : 'Search failed' }); }
  }

  function setSelected(next?:EvidenceSelection){setSelectedState(next);history.pushState({},'',next?pathForSelection(next):'/')}
  function openEvidence(kind: EvidenceSelection['kind'], id?: string) { if (id) { setSelected({ kind, id }); setAiOpen(false); } }

  async function runAI() {
    if (!selected || !evidence.length) return;
    setAiState('streaming'); setAiOutput('');
    const context = evidence.filter(item => item.status >= 200 && item.status < 300).map(item => ({ source: item.url, body: item.body }));
    try {
      const boundedContext = JSON.stringify(context).slice(0, 6_000);
      const response = await fetch(`/ai-gateway/ai/stream?session=explorer-public-explain&q=${encodeURIComponent(`Respond in ${localeNames[aiLanguage]}. Explain this ${selected.kind} using only the supplied source evidence and cite each source URL: ${boundedContext}`)}`);
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
      <div className="locale-controls"><label>{t('language')}<select aria-label={t('language')} value={locale} onChange={e=>setLocale(e.target.value as Locale)}>{locales.map(code=><option key={code} value={code}>{localeNames[code]}</option>)}</select></label><label>{t('aiLanguage')}<select aria-label={t('aiLanguage')} value={aiLanguage} onChange={e=>setAILanguage(e.target.value as Locale)}>{locales.map(code=><option key={code} value={code}>{localeNames[code]}</option>)}</select></label></div>
      {installPrompt&&<button className="install-button" onClick={()=>installPrompt.prompt()}>{t('install')}</button>}
      <a className="monitor-link" href="http://127.0.0.1:4674">Operator Monitor ↗</a>
    </header>

    <main>
      <section className="hero" id="overview">
        <div className="hero-copy"><p className="eyebrow">{t('tagline')}</p><h1>{t('headline')}</h1><p>{t('description')}</p></div>
        <form className="search" role="search" onSubmit={submitSearch}>
          <label htmlFor="universal-search">{t('searchLabel')}</label>
          <div><input id="universal-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchPlaceholder')}/><button>{t('verify')}</button></div>
        </form>
      </section>
      {!online&&<div className="offline-banner" role="alert">{t('offline')}</div>}

      <section className={`source-state ${availability}`} aria-live="polite">
        <span className="pulse" aria-hidden="true"/><strong>{statusText[availability]}</strong><span>{statusDetail}</span><span className="source-time">Lag {indexedLag} block{indexedLag === 1 ? '' : 's'}</span>
      </section>

      {search.loading && <div className="notice">Searching the canonical Explorer…</div>}
      {search.error && <div className="notice error" role="alert">{search.error} <button onClick={submitSearch as never}>Retry</button></div>}
      {search.data !== undefined && <section className="search-result"><div><p className="eyebrow">Verified search result</p><h2>Canonical response</h2></div><pre>{JSON.stringify(search.data, null, 2)}</pre></section>}

      <section className="metrics" aria-label="Network summary">
        <article><span>{t('latestBlock')}</span><strong>{typeof latestHeight==='number'?formatNumber(latestHeight):t('unavailable')}</strong><small>RPC source height</small></article>
        <article><span>{t('indexedHeight')}</span><strong>{typeof summary?.indexedHeight==='number'?formatNumber(summary.indexedHeight):t('unavailable')}</strong><small>{indexedLag ? `${formatNumber(indexedLag)} behind source` : 'Caught up'}</small></article>
        <article><span>{t('indexedTransactions')}</span><strong>{typeof summary?.indexedTxCount==='number'?formatNumber(summary.indexedTxCount):t('unavailable')}</strong><small>No estimated TPS</small></article>
        <article><span>{t('network')}</span><strong>{networkName ?? t('unavailable')}</strong><small>Chain ID {chainID ?? t('unavailable')}</small></article>
      </section>

      <div className="evidence-grid">
        <section className="panel" id="blocks"><div className="panel-head"><div><p className="eyebrow">Live finality ledger</p><h2>Blocks</h2></div><a href="/api/blocks/latest">Raw source ↗</a></div>
          {blockPageState.error && <div className="notice error" role="alert">{blockPageState.error} <button onClick={refreshBlockPage}>Retry</button></div>}
          {displayedBlocks.length ? <><div className="dense-list">{displayedBlocks.map(block => <button key={block.hash ?? block.height} onClick={() => openEvidence('block', String(block.height))}><strong>#{block.height}</strong><span>{short(block.hash)}</span><time>{block.timestamp?formatDate(block.timestamp):'Timestamp unavailable'}</time></button>)}</div><CursorPagination page={blockPageIndex} loading={Boolean(blockPageState.loading)} hasNext={Boolean(currentBlockPage?.nextCursor)} onPrevious={()=>setBlockPageIndex(page => Math.max(0, page - 1))} onNext={nextBlockPage} previous={t('previous')} next={t('next')} pageLabel={t('page')}/></> : blockPageState.loading ? <div className="notice">Loading authoritative blocks…</div> : <Empty label="No indexed blocks returned"/>}
        </section>
        <section className="panel" id="transactions"><div className="panel-head"><div><p className="eyebrow">Indexed activity</p><h2>Transactions</h2></div><a href="/api/txs">Raw source ↗</a></div>
          {transactionPageState.error && <div className="notice error" role="alert">{transactionPageState.error} <button onClick={refreshTransactionPage}>Retry</button></div>}
          {displayedTransactions.length ? <><div className="dense-list txs">{displayedTransactions.map(tx => <button key={tx.hash} onClick={() => openEvidence('transaction', tx.hash)}><strong>{short(tx.hash, 12)}</strong><span>{tx.type ?? 'Type unavailable'}</span><span>{short(tx.from)} → {short(tx.to)}</span></button>)}</div><CursorPagination page={transactionPageIndex} loading={Boolean(transactionPageState.loading)} hasNext={Boolean(currentTransactionPage?.nextCursor)} onPrevious={()=>setTransactionPageIndex(page => Math.max(0, page - 1))} onNext={nextTransactionPage} previous={t('previous')} next={t('next')} pageLabel={t('page')}/></> : transactionPageState.loading ? <div className="notice">Loading authoritative transactions…</div> : <Empty label="No indexed transactions returned"/>}
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
        {validators.length ? <table><thead><tr><th>Validator</th><th>Address</th><th>Voting power</th><th>Peer evidence</th></tr></thead><tbody>{validators.map(v => <tr key={v.address}><td>{v.moniker ?? 'Unnamed'}</td><td>{short(v.address, 14)}</td><td>{v.votingPower===undefined?'Unavailable':formatNumber(v.votingPower)}</td><td>{v.peerReady === undefined ? 'Unavailable' : v.peerReady ? 'Observed ready' : 'Not ready'}</td></tr>)}</tbody></table> : <Empty label="Validator endpoint returned no records"/>}
      </section>

      <section className="analytics" id="analytics"><div><p className="eyebrow">Truthful analytics</p><h2>Coverage, not market theater.</h2><p>YNX Explorer deliberately omits price, market cap, inferred uptime and extrapolated TPS until authoritative sources exist.</p></div><div className="source-list">{sourceLinks(snapshot).map(link => <a key={link.href} href={link.href}>{link.label}<span>↗</span></a>)}</div></section>
    </main>

    {selected && <aside className="drawer" aria-label="Evidence detail"><button className="drawer-close" onClick={() => setSelected(undefined)} aria-label="Close detail">×</button><p className="eyebrow">Source verification</p><h2>{selected.kind} · {short(selected.id, 16)}</h2>
      {evidenceError && <div className="notice error" role="alert">{evidenceError}</div>}
      {!evidence.length && !evidenceError && <div className="notice">Loading authoritative evidence…</div>}
      {evidence.map(item => <article className="evidence" key={item.url}><a href={item.url}>{item.url} ↗</a><span className={item.status < 300 ? 'verified' : 'failed'}>HTTP {item.status}</span><pre>{JSON.stringify(item.body, null, 2)}</pre></article>)}
      {evidence.length > 0 && <button className="ai-button" onClick={() => { setAiOpen(true); setAiState('preview'); }}>{t('explain')}</button>}
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
function CursorPagination({page,loading,hasNext,onPrevious,onNext,previous,next,pageLabel}:{page:number;loading:boolean;hasNext:boolean;onPrevious:()=>void;onNext:()=>void;previous:string;next:string;pageLabel:string}){return <div className="pagination" aria-label={`${pageLabel} ${page+1}`}><button disabled={page===0||loading} onClick={onPrevious}>{previous}</button><span>{pageLabel} {page+1}</span><button disabled={!hasNext||loading} onClick={onNext}>{loading?'…':next}</button></div>}
