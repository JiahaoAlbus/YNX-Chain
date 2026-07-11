package explorer

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f5f5f7">
  <title>YNX Chain Explorer</title>
  <style>
    :root {
      color-scheme: light;
      --page:#f5f5f7; --surface:#fff; --surface-alt:#fbfbfd; --ink:#1d1d1f;
      --muted:#6e6e73; --faint:#86868b; --line:#d2d2d7; --line-soft:#e8e8ed;
      --blue:#0071e3; --blue-dark:#0058b0; --blue-soft:#eaf4ff; --green:#248a3d;
      --green-soft:#e8f7ec; --amber:#9a6700; --amber-soft:#fff7df; --red:#d70015;
      --shadow:0 2px 8px rgba(0,0,0,.04),0 16px 40px rgba(0,0,0,.06);
    }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; min-width:320px; font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Arial,sans-serif; color:var(--ink); background:var(--page); -webkit-font-smoothing:antialiased; }
    button,input { font:inherit; }
    button { cursor:pointer; }
    a { color:inherit; text-decoration:none; }
    .mono { font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; font-size:.92em; }
    .shell { width:min(1180px,calc(100% - 40px)); margin:0 auto; }

    .nav { position:sticky; top:0; z-index:20; height:54px; border-bottom:1px solid rgba(0,0,0,.08); background:rgba(250,250,252,.82); backdrop-filter:saturate(180%) blur(18px); -webkit-backdrop-filter:saturate(180%) blur(18px); }
    .nav-inner { height:100%; display:flex; align-items:center; gap:28px; }
    .brand { display:flex; align-items:center; gap:10px; font-size:15px; font-weight:650; white-space:nowrap; }
    .brand-mark { display:grid; place-items:center; width:26px; height:26px; border-radius:7px; color:#fff; background:linear-gradient(145deg,#1d1d1f,#505055); font-size:11px; font-weight:750; }
    .nav-links { display:flex; align-items:center; gap:24px; margin-left:auto; color:#424245; font-size:13px; }
    .nav-links a:hover { color:var(--blue); }
    .network-pill { display:flex; align-items:center; gap:7px; padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:rgba(255,255,255,.76); font-size:12px; color:#424245; }
    .pulse { width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 0 3px var(--green-soft); }

    .hero { padding:64px 0 48px; background:var(--surface); border-bottom:1px solid var(--line-soft); }
    .eyebrow { margin:0 0 12px; color:var(--blue); font-size:14px; font-weight:650; }
    h1 { max-width:760px; margin:0; font-size:clamp(38px,6vw,66px); line-height:1.02; font-weight:700; letter-spacing:0; }
    .hero-copy { max-width:690px; margin:18px 0 28px; color:var(--muted); font-size:19px; line-height:1.48; }
    .search { position:relative; max-width:820px; display:flex; align-items:center; gap:10px; }
    .search input { width:100%; height:54px; padding:0 128px 0 18px; border:1px solid var(--line); border-radius:8px; color:var(--ink); background:var(--surface); font-size:16px; outline:none; box-shadow:0 1px 2px rgba(0,0,0,.03); transition:border-color .2s,box-shadow .2s; }
    .search input:focus { border-color:var(--blue); box-shadow:0 0 0 4px rgba(0,113,227,.12); }
    .search button { position:absolute; right:6px; height:42px; padding:0 20px; border:0; border-radius:7px; color:#fff; background:var(--blue); font-weight:600; }
    .search button:hover { background:var(--blue-dark); }
    .hero-meta { display:flex; flex-wrap:wrap; gap:8px 22px; margin-top:20px; color:var(--faint); font-size:12px; }
    .hero-meta span { display:flex; align-items:center; gap:7px; }

    main { padding:34px 0 70px; }
    .status-bar { display:flex; align-items:center; gap:10px; min-height:38px; margin-bottom:24px; color:var(--muted); font-size:13px; }
    .status-bar .state { display:inline-flex; align-items:center; gap:8px; padding:7px 10px; border-radius:7px; background:var(--green-soft); color:var(--green); font-weight:600; }
    .status-bar.warn .state { background:var(--amber-soft); color:var(--amber); }
    .status-bar .refresh { margin-left:auto; border:0; background:transparent; color:var(--blue); padding:7px 0; }

    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:34px; }
    .metric { min-height:126px; padding:20px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); box-shadow:0 1px 2px rgba(0,0,0,.02); }
    .metric-label { color:var(--muted); font-size:13px; }
    .metric-value { margin-top:11px; font-size:30px; line-height:1; font-weight:650; overflow-wrap:anywhere; }
    .metric-foot { margin-top:13px; color:var(--faint); font-size:12px; }
    .metric-foot.good { color:var(--green); }

    .overview { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(280px,.8fr); gap:14px; margin-bottom:42px; }
    .panel { border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); box-shadow:var(--shadow); overflow:hidden; }
    .panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:22px 22px 18px; border-bottom:1px solid var(--line-soft); }
    .panel-head h2,.section-head h2 { margin:0; font-size:20px; line-height:1.2; font-weight:650; }
    .panel-head p,.section-head p { margin:5px 0 0; color:var(--muted); font-size:13px; }
    .activity { height:198px; display:flex; align-items:flex-end; gap:8px; padding:28px 22px 24px; }
    .bar-wrap { flex:1; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; gap:8px; min-width:0; }
    .bar { width:100%; min-height:5px; border-radius:4px 4px 2px 2px; background:var(--blue); opacity:.8; transition:height .35s ease; }
    .bar:hover { opacity:1; }
    .bar-label { color:var(--faint); font-size:10px; white-space:nowrap; }
    .chain-facts { display:grid; padding:8px 22px; }
    .fact { display:grid; grid-template-columns:112px minmax(0,1fr); gap:12px; padding:14px 0; border-bottom:1px solid var(--line-soft); font-size:13px; }
    .fact:last-child { border-bottom:0; }
    .fact dt { color:var(--muted); }
    .fact dd { margin:0; text-align:right; overflow-wrap:anywhere; }

    .section { margin-top:38px; }
    .section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; margin-bottom:14px; }
    .section-link { color:var(--blue); font-size:13px; border:0; background:transparent; padding:4px 0; }
    .table-shell { overflow:auto; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th,td { padding:14px 16px; border-bottom:1px solid var(--line-soft); text-align:left; vertical-align:middle; font-size:13px; }
    tr:last-child td { border-bottom:0; }
    th { color:var(--muted); background:var(--surface-alt); font-size:11px; font-weight:600; text-transform:uppercase; }
    tbody tr { transition:background .15s; }
    tbody tr:hover { background:#f7faff; }
    .link { color:var(--blue); font-weight:550; cursor:pointer; }
    .hash { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .type-tag { display:inline-flex; padding:4px 8px; border-radius:6px; color:#424245; background:#f0f0f2; font-size:11px; font-weight:600; text-transform:capitalize; }
    .amount { font-weight:600; white-space:nowrap; }
    .muted { color:var(--muted); }
    .empty { padding:36px 20px; color:var(--muted); text-align:center; }

    .intelligence { margin:42px 0; }
    .segmented { display:grid; grid-template-columns:1fr 1fr; width:min(360px,100%); padding:3px; border:1px solid var(--line); border-radius:8px; background:#e9e9ed; }
    .segment { min-height:34px; border:0; border-radius:6px; color:var(--muted); background:transparent; font-size:13px; font-weight:600; }
    .segment.active { color:var(--ink); background:var(--surface); box-shadow:0 1px 4px rgba(0,0,0,.12); }
    .intelligence-panel { display:none; margin-top:14px; }
    .intelligence-panel.active { display:block; }
    .validator-state { display:inline-flex; align-items:center; gap:7px; color:var(--green); font-weight:600; }
    .validator-state::before { content:""; width:7px; height:7px; border-radius:50%; background:currentColor; }
    .validator-state.offline { color:var(--amber); }
    .resource-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
    .resource-item { min-height:112px; padding:18px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); }
    .resource-item strong { display:block; margin-top:10px; font-size:24px; font-weight:650; }
    .resource-item small { color:var(--muted); }
    .policy-line { display:flex; flex-wrap:wrap; gap:9px 22px; margin-top:10px; padding:16px 18px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); color:var(--muted); font-size:12px; }
    .policy-line strong { color:var(--ink); font-weight:600; }

    .wallet-band { margin-top:44px; padding:30px; display:flex; align-items:center; justify-content:space-between; gap:24px; border-radius:8px; color:#fff; background:#1d1d1f; }
    .wallet-band h2 { margin:0 0 7px; font-size:22px; }
    .wallet-band p { margin:0; color:#a1a1a6; font-size:14px; }
    .wallet-button { flex:none; height:44px; padding:0 18px; border:0; border-radius:7px; color:#fff; background:var(--blue); font-weight:600; }
    .wallet-button:hover { background:#1685f8; }

    .result-panel { display:none; margin-top:24px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); box-shadow:var(--shadow); overflow:hidden; }
    .result-panel.visible { display:block; }
    .result-grid { display:grid; grid-template-columns:180px minmax(0,1fr); }
    .result-key,.result-value { padding:12px 18px; border-bottom:1px solid var(--line-soft); font-size:13px; overflow-wrap:anywhere; }
    .result-key { color:var(--muted); background:var(--surface-alt); }
    .result-error { padding:24px; color:var(--red); }
    .result-close { border:0; background:transparent; color:var(--blue); padding:4px 0; }

    footer { padding:26px 0 38px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
    .footer-inner { display:flex; justify-content:space-between; gap:20px; }
    .skeleton { position:relative; overflow:hidden; color:transparent!important; background:#ededf0!important; border-radius:4px; }
    .skeleton::after { content:""; position:absolute; inset:0; transform:translateX(-100%); background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent); animation:shimmer 1.4s infinite; }
    @keyframes shimmer { 100% { transform:translateX(100%); } }

    @media (max-width:900px) {
      .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .overview { grid-template-columns:1fr; }
      .nav-links a { display:none; }
      .hero { padding-top:48px; }
    }
    @media (max-width:620px) {
      .shell { width:min(100% - 24px,1180px); }
      .nav-inner { gap:10px; }
      .network-pill { margin-left:auto; }
      .nav-links { margin-left:0; }
      .hero { padding:38px 0 34px; }
      h1 { font-size:40px; }
      .hero-copy { font-size:17px; }
      .search input { height:50px; padding-right:102px; font-size:14px; }
      .search button { height:38px; padding:0 15px; }
      main { padding-top:22px; }
      .metrics { grid-template-columns:1fr 1fr; gap:8px; }
      .metric { min-height:105px; padding:15px; }
      .metric-value { font-size:23px; }
      .panel-head { padding:18px 16px 15px; }
      .activity { padding-left:16px; padding-right:16px; }
      .chain-facts { padding:6px 16px; }
      .fact { grid-template-columns:90px minmax(0,1fr); }
      th,td { padding:12px; }
      .blocks-table { min-width:670px; }
      .tx-table { min-width:820px; }
      .wallet-band { align-items:flex-start; flex-direction:column; padding:24px 20px; }
      .wallet-button { width:100%; }
      .result-grid { grid-template-columns:112px minmax(0,1fr); }
      .resource-metrics { grid-template-columns:1fr 1fr; }
      .footer-inner { flex-direction:column; }
    }
    @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } * { animation:none!important; transition:none!important; } }
  </style>
</head>
<body>
  <nav class="nav" aria-label="Primary navigation">
    <div class="shell nav-inner">
      <a class="brand" href="#top" aria-label="YNX Chain Explorer home"><span class="brand-mark">YNX</span><span>Chain Explorer</span></a>
      <div class="nav-links">
        <a href="#blocks">Blocks</a><a href="#transactions">Transactions</a><a href="#intelligence">Validators & Resources</a>
        <span class="network-pill"><span class="pulse"></span><span id="networkName">Testnet</span></span>
      </div>
    </div>
  </nav>

  <header class="hero" id="top">
    <div class="shell">
      <p class="eyebrow">YNX Testnet</p>
      <h1>See every block.<br>Verify every transaction.</h1>
      <p class="hero-copy">A live, indexer-backed view of YNX Chain activity, validators, accounts, and native YNXT resource economics.</p>
      <form class="search" id="searchForm">
        <input id="searchInput" aria-label="Search the chain" placeholder="Search block, transaction, or address" autocomplete="off" spellcheck="false">
        <button type="submit">Search</button>
      </form>
      <div class="hero-meta"><span><span class="pulse"></span>Live RPC data</span><span id="lastUpdated">Connecting to the network</span><span>Native asset: YNXT</span></div>
      <section class="result-panel" id="resultPanel" aria-live="polite">
        <div class="panel-head"><div><h2 id="resultTitle">Search result</h2><p id="resultSubtitle"></p></div><button class="result-close" id="resultClose" type="button">Close</button></div>
        <div id="resultBody"></div>
      </section>
    </div>
  </header>

  <main>
    <div class="shell">
      <div class="status-bar" id="status"><span class="state"><span class="pulse"></span><span id="statusText">Connecting</span></span><span id="statusDetail">Reading RPC and indexer state</span><button class="refresh" id="refreshButton" type="button">Refresh</button></div>

      <section class="metrics" aria-label="Network metrics">
        <article class="metric"><div class="metric-label">Latest block</div><div class="metric-value skeleton" id="rpcHeight">0000</div><div class="metric-foot" id="blockAge">Waiting for block data</div></article>
        <article class="metric"><div class="metric-label">Transactions indexed</div><div class="metric-value skeleton" id="txCount">0000</div><div class="metric-foot">Verified by the indexer</div></article>
        <article class="metric"><div class="metric-label">Validators</div><div class="metric-value skeleton" id="validatorCount">00</div><div class="metric-foot">Reported by chain RPC</div></article>
        <article class="metric"><div class="metric-label">Indexer sync</div><div class="metric-value skeleton" id="syncValue">0 blocks</div><div class="metric-foot" id="syncState">Checking consistency</div></article>
      </section>

      <section class="overview" id="network">
        <article class="panel">
          <div class="panel-head"><div><h2>Block activity</h2><p>Transactions included in the latest indexed blocks</p></div><span class="muted mono" id="activityTotal">-- txs</span></div>
          <div class="activity" id="activityChart" aria-label="Recent block transaction activity"></div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h2>Network details</h2><p>Current chain configuration</p></div></div>
          <dl class="chain-facts">
            <div class="fact"><dt>Chain ID</dt><dd class="mono" id="chainId">--</dd></div>
            <div class="fact"><dt>Native coin</dt><dd id="nativeCoin">YNXT</dd></div>
            <div class="fact"><dt>Latest hash</dt><dd class="mono hash" id="latestHash">--</dd></div>
            <div class="fact"><dt>Data source</dt><dd id="truthState">RPC + Indexer</dd></div>
          </dl>
        </article>
      </section>

      <section class="intelligence" id="intelligence">
        <div class="section-head"><div><h2>Network intelligence</h2><p>Validator and resource-economy state from live chain APIs</p></div></div>
        <div class="segmented" role="tablist" aria-label="Network intelligence views">
          <button class="segment active" id="validatorsTab" type="button" role="tab" aria-selected="true" aria-controls="validatorsPanel">Validators</button>
          <button class="segment" id="resourcesTab" type="button" role="tab" aria-selected="false" aria-controls="resourcesPanel">Resource economy</button>
        </div>
        <div class="intelligence-panel active" id="validatorsPanel" role="tabpanel" aria-labelledby="validatorsTab">
          <div class="table-shell"><table class="blocks-table"><thead><tr><th style="width:24%">Validator</th><th style="width:22%">Role</th><th style="width:18%">Status</th><th style="width:18%">Voting power</th><th style="width:18%">Observed height</th></tr></thead><tbody id="validatorsBody"><tr><td colspan="5" class="empty">Loading validators...</td></tr></tbody></table></div>
        </div>
        <div class="intelligence-panel" id="resourcesPanel" role="tabpanel" aria-labelledby="resourcesTab">
          <div class="resource-metrics" id="resourceMetrics"><article class="resource-item"><small>Loading resource market</small></article></div>
          <div class="policy-line" id="resourcePolicy"></div>
        </div>
      </section>

      <section class="section" id="blocks">
        <div class="section-head"><div><h2>Latest blocks</h2><p>Most recent blocks observed by the indexer</p></div><button class="section-link" type="button" data-refresh>Update</button></div>
        <div class="table-shell"><table class="blocks-table"><thead><tr><th style="width:14%">Height</th><th style="width:42%">Block hash</th><th style="width:25%">Time</th><th style="width:19%">Transactions</th></tr></thead><tbody id="blocksBody"><tr><td colspan="4" class="empty">Loading blocks...</td></tr></tbody></table></div>
      </section>

      <section class="section" id="transactions">
        <div class="section-head"><div><h2>Latest transactions</h2><p>Transfers and chain actions from indexed blocks</p></div><button class="section-link" type="button" data-refresh>Update</button></div>
        <div class="table-shell"><table class="tx-table"><thead><tr><th style="width:27%">Transaction hash</th><th style="width:13%">Type</th><th style="width:20%">From</th><th style="width:20%">To</th><th style="width:12%">Amount</th><th style="width:8%">Fee</th></tr></thead><tbody id="txsBody"><tr><td colspan="6" class="empty">Loading transactions...</td></tr></tbody></table></div>
      </section>

      <section class="wallet-band">
        <div><h2>Use YNX Testnet in your wallet.</h2><p>Add the verified chain ID, RPC endpoint, YNXT currency, and explorer URL in one step.</p></div>
        <button id="metamaskButton" class="wallet-button" type="button">Add YNX Testnet to MetaMask</button>
      </section>
    </div>
  </main>

  <footer><div class="shell footer-inner"><span>YNX Chain Explorer</span><span>Live testnet data. Mainnet launch is not claimed.</span></div></footer>

  <script>
    const api = '';
    let walletConfig = null;
    let refreshTimer = null;
    let eventSource = null;
    const $ = (id) => document.getElementById(id);
    const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const compact = (value, start = 10, end = 7) => { const text = String(value ?? ''); return text.length > start + end + 3 ? text.slice(0,start) + '...' + text.slice(-end) : text || '--'; };
    const number = (value) => new Intl.NumberFormat('en-US').format(Number(value || 0));
    const relativeTime = (value) => {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
      if (!Number.isFinite(seconds)) return 'Time unavailable';
      if (seconds < 60) return seconds + ' seconds ago';
      if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
      return Math.floor(seconds / 3600) + ' hours ago';
    };
    const exactTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString([], {dateStyle:'medium',timeStyle:'medium'}); };
    async function get(path) {
      const response = await fetch(api + path, {headers:{accept:'application/json'}});
      if (!response.ok) { let detail = ''; try { detail = (await response.json()).error || ''; } catch (_) {} throw new Error(detail || path + ' returned ' + response.status); }
      return response.json();
    }
    function removeSkeletons() { document.querySelectorAll('.skeleton').forEach(node => node.classList.remove('skeleton')); }
    function blockRow(block) {
      const txs = (block.transactions || []).length;
      return '<tr><td><button class="section-link mono" type="button" data-query="' + escapeHTML(block.height) + '">' + escapeHTML(number(block.height)) + '</button></td><td><span class="mono hash" title="' + escapeHTML(block.hash) + '">' + escapeHTML(compact(block.hash,16,10)) + '</span></td><td title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</td><td>' + txs + (txs === 1 ? ' transaction' : ' transactions') + '</td></tr>';
    }
    function txRow(tx) {
      return '<tr><td><button class="section-link mono hash" type="button" data-query="' + escapeHTML(tx.hash) + '" title="' + escapeHTML(tx.hash) + '">' + escapeHTML(compact(tx.hash,13,8)) + '</button></td><td><span class="type-tag">' + escapeHTML(tx.type || 'transaction') + '</span></td><td><button class="section-link mono hash" type="button" data-query="' + escapeHTML(tx.from) + '" title="' + escapeHTML(tx.from) + '">' + escapeHTML(compact(tx.from)) + '</button></td><td><button class="section-link mono hash" type="button" data-query="' + escapeHTML(tx.to) + '" title="' + escapeHTML(tx.to) + '">' + escapeHTML(compact(tx.to)) + '</button></td><td class="amount">' + escapeHTML(number(tx.amount)) + ' YNXT</td><td class="mono">' + escapeHTML(number(tx.fee)) + '</td></tr>';
    }
    function renderActivity(blocks) {
      const recent = blocks.slice().reverse();
      const counts = recent.map(block => (block.transactions || []).length);
      const max = Math.max(1,...counts);
      $('activityTotal').textContent = number(counts.reduce((sum,count) => sum + count,0)) + ' txs';
      $('activityChart').innerHTML = recent.map((block,index) => {
        const height = 8 + Math.round((counts[index] / max) * 82);
        return '<div class="bar-wrap" title="Block ' + escapeHTML(block.height) + ': ' + counts[index] + ' transactions"><div class="bar" style="height:' + height + '%"></div><span class="bar-label">' + escapeHTML(compact(block.height,4,2)) + '</span></div>';
      }).join('') || '<div class="empty">No indexed block activity yet.</div>';
    }
    function renderIntelligence(validatorData, resources) {
      const validators = Array.isArray(validatorData) ? validatorData : (validatorData?.validators || []);
      $('validatorsBody').innerHTML = validators.length ? validators.map(validator => {
        const ready = Boolean(validator.peerReady || validator.active);
        const status = validator.peerStatus || (ready ? 'active' : 'not ready');
        return '<tr><td><strong>' + escapeHTML(validator.moniker || compact(validator.address)) + '</strong><span class="mono hash muted" title="' + escapeHTML(validator.address) + '">' + escapeHTML(compact(validator.address,12,7)) + '</span></td><td>' + escapeHTML(validator.role || 'validator') + '</td><td><span class="validator-state' + (ready ? '' : ' offline') + '">' + escapeHTML(status) + '</span></td><td class="mono">' + escapeHTML(number(validator.votingPower)) + '</td><td class="mono">' + escapeHTML(number(validator.latestHeight)) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="empty">No validator records available.</td></tr>';
      if (!resources || typeof resources !== 'object' || !Object.keys(resources).length) {
        $('resourceMetrics').innerHTML = '<article class="resource-item"><small>Resource analytics temporarily unavailable</small></article>';
        $('resourcePolicy').innerHTML = '';
        return;
      }
      const resourceItems = [
        ['Delegated YNXT',resources.delegatedYnxt],
        ['Rental volume',resources.rentalVolumeYnxt],
        ['Provider income',resources.providerIncomeYnxt],
        ['Protocol fees',resources.protocolFeeYnxt]
      ];
      $('resourceMetrics').innerHTML = resourceItems.map(([label,value]) => '<article class="resource-item"><small>' + escapeHTML(label) + '</small><strong>' + escapeHTML(number(value)) + '</strong><small>YNXT</small></article>').join('');
      $('resourcePolicy').innerHTML = '<span>Policy <strong>' + escapeHTML(resources.policyVersion || '--') + '</strong></span><span>Active delegations <strong>' + escapeHTML(number(resources.activeDelegationCount)) + '</strong></span><span>Rentals <strong>' + escapeHTML(number(resources.resourceRentalCount)) + '</strong></span><span>Evidence <strong class="mono">' + escapeHTML(compact(resources.policyHash,10,7)) + '</strong></span>';
    }
    function bindQueries() { document.querySelectorAll('[data-query]').forEach(button => button.onclick = () => search(button.dataset.query)); }
    function renderDashboard(summary, blocks, transactions, validatorData, resources, source = 'Live stream') {
      walletConfig = summary.wallet;
      $('networkName').textContent = summary.network.name || 'YNX Testnet';
      $('rpcHeight').textContent = number(summary.rpcHeight);
      $('txCount').textContent = number(summary.indexedTxCount);
      $('validatorCount').textContent = number(summary.validatorCount);
      $('syncValue').textContent = number(summary.syncLagBlocks) + (summary.syncLagBlocks === 1 ? ' block' : ' blocks');
      $('syncState').textContent = summary.syncLagBlocks === 0 ? 'Fully synchronized' : 'Indexer catching up';
      $('syncState').className = 'metric-foot' + (summary.syncLagBlocks === 0 ? ' good' : '');
      $('blockAge').textContent = relativeTime(summary.latestBlockTime);
      $('chainId').textContent = summary.network.chainId + ' / ' + summary.wallet.chainIdHex;
      const nativeName = summary.network.nativeCoinName || 'YNX Token';
      $('nativeCoin').textContent = nativeName === 'YNXT' ? 'YNXT' : nativeName + ' (YNXT)';
      $('latestHash').textContent = compact(summary.latestBlockHash,12,9);
      $('latestHash').title = summary.latestBlockHash || '';
      $('truthState').textContent = summary.truthfulStatus === 'rpc-and-indexer-backed' ? 'RPC + Indexer' : summary.truthfulStatus;
      $('lastUpdated').textContent = 'Updated ' + new Date(summary.lastCheckedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
      $('blocksBody').innerHTML = blocks.length ? blocks.map(blockRow).join('') : '<tr><td colspan="4" class="empty">No indexed blocks yet.</td></tr>';
      $('txsBody').innerHTML = transactions.length ? transactions.map(txRow).join('') : '<tr><td colspan="6" class="empty">No indexed transactions yet.</td></tr>';
      renderActivity(blocks);
      renderIntelligence(validatorData, resources);
      bindQueries();
      $('statusText').textContent = summary.ok ? 'Network operational' : 'Upstream degraded';
      $('statusDetail').textContent = summary.ok ? source + ' / RPC and indexer are responding' : (summary.indexerError || 'One or more upstream services are degraded');
      $('status').className = 'status-bar' + (summary.ok ? '' : ' warn');
      removeSkeletons();
      $('refreshButton').disabled = false;
    }
    async function load() {
      $('refreshButton').disabled = true;
      const [summary, blockData, txData, validators, resources] = await Promise.all([get('/api/summary'),get('/api/blocks/latest?limit=12'),get('/api/txs?limit=12'),get('/api/validators'),get('/api/resource-market/analytics')]);
      renderDashboard(summary, blockData.blocks, txData.transactions, validators, resources, 'Manual snapshot');
    }
    function startFallbackPolling() {
      if (refreshTimer) return;
      refreshTimer = window.setInterval(() => load().catch(showLoadError),10000);
    }
    function stopFallbackPolling() {
      if (!refreshTimer) return;
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    function connectLiveStream() {
      if (!window.EventSource) { startFallbackPolling(); return; }
      eventSource = new EventSource('/api/stream');
      eventSource.addEventListener('dashboard', event => {
        try {
          const snapshot = JSON.parse(event.data);
          renderDashboard(snapshot.summary, snapshot.blocks || [], snapshot.transactions || [], snapshot.validators, snapshot.resources, 'Live SSE');
          stopFallbackPolling();
        } catch (error) { showLoadError(error); }
      });
      eventSource.addEventListener('upstream-error', event => {
        try { showLoadError(new Error(JSON.parse(event.data).error || 'Live upstream error')); } catch (_) { showLoadError(new Error('Live upstream error')); }
      });
      eventSource.onerror = () => {
        $('statusText').textContent = 'Reconnecting live data';
        $('statusDetail').textContent = 'Using 10-second snapshot fallback';
        $('status').className = 'status-bar warn';
        startFallbackPolling();
      };
    }
    function flatten(value, prefix = '', rows = []) {
      if (value === null || value === undefined) { rows.push([prefix || 'Value','unavailable']); return rows; }
      if (Array.isArray(value)) { rows.push([prefix || 'Items',value.length ? value.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(', ') : 'None']); return rows; }
      if (typeof value === 'object') { Object.entries(value).forEach(([key,item]) => flatten(item,prefix ? prefix + ' / ' + key : key,rows)); return rows; }
      rows.push([prefix,value]); return rows;
    }
    async function search(query) {
      const q = String(query || $('searchInput').value).trim();
      if (!q) return;
      $('searchInput').value = q;
      $('resultPanel').classList.add('visible');
      $('resultTitle').textContent = 'Searching the chain';
      $('resultSubtitle').textContent = q;
      $('resultBody').innerHTML = '<div class="empty">Resolving live indexer data...</div>';
      $('resultPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
      try {
        const resolved = await get('/api/search?q=' + encodeURIComponent(q));
        const detail = await get(resolved.path);
        $('resultTitle').textContent = resolved.type.charAt(0).toUpperCase() + resolved.type.slice(1);
        $('resultSubtitle').textContent = 'Resolved from live chain data';
        $('resultBody').innerHTML = '<div class="result-grid">' + flatten(detail).map(([key,value]) => '<div class="result-key">' + escapeHTML(key) + '</div><div class="result-value mono">' + escapeHTML(value) + '</div>').join('') + '</div>';
      } catch (error) {
        $('resultTitle').textContent = 'No result found';
        $('resultSubtitle').textContent = q;
        $('resultBody').innerHTML = '<div class="result-error">' + escapeHTML(error.message) + '</div>';
      }
    }
    $('searchForm').onsubmit = event => { event.preventDefault(); search(); };
    $('resultClose').onclick = () => $('resultPanel').classList.remove('visible');
    function selectIntelligence(view) {
      const validatorsSelected = view === 'validators';
      $('validatorsTab').classList.toggle('active',validatorsSelected);
      $('resourcesTab').classList.toggle('active',!validatorsSelected);
      $('validatorsPanel').classList.toggle('active',validatorsSelected);
      $('resourcesPanel').classList.toggle('active',!validatorsSelected);
      $('validatorsTab').setAttribute('aria-selected',String(validatorsSelected));
      $('resourcesTab').setAttribute('aria-selected',String(!validatorsSelected));
    }
    $('validatorsTab').onclick = () => selectIntelligence('validators');
    $('resourcesTab').onclick = () => selectIntelligence('resources');
    $('refreshButton').onclick = () => load().catch(showLoadError);
    document.querySelectorAll('[data-refresh]').forEach(button => button.onclick = () => load().catch(showLoadError));
    $('metamaskButton').onclick = async () => {
      if (!window.ethereum) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Wallet not detected'; $('resultSubtitle').textContent = 'Install or open an EIP-1193 compatible wallet.'; $('resultBody').innerHTML = '<div class="result-error">MetaMask is not available in this browser.</div>'; return; }
      if (!walletConfig) await load();
      try {
        await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:walletConfig.chainIdHex,chainName:walletConfig.chainName,nativeCurrency:{name:walletConfig.nativeCurrencyName,symbol:walletConfig.nativeSymbol,decimals:walletConfig.decimals},rpcUrls:walletConfig.rpcUrls,blockExplorerUrls:walletConfig.blockExplorerUrls}]});
        $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Wallet request sent'; $('resultSubtitle').textContent = 'Confirm YNX Testnet in your wallet.'; $('resultBody').innerHTML = '<div class="empty">Network details were sourced from the live Explorer API.</div>';
      } catch (error) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Wallet request declined'; $('resultBody').innerHTML = '<div class="result-error">' + escapeHTML(error.message) + '</div>'; }
    };
    function showLoadError(error) { $('statusText').textContent = 'Explorer unavailable'; $('statusDetail').textContent = error.message; $('status').className = 'status-bar warn'; $('refreshButton').disabled = false; removeSkeletons(); }
    load().catch(showLoadError);
    connectLiveStream();
    document.addEventListener('visibilitychange',() => { if (!document.hidden) load().catch(showLoadError); });
  </script>
</body>
</html>`
