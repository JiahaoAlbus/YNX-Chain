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
    .shell { width:min(1320px,calc(100% - 40px)); margin:0 auto; }

    .nav { position:sticky; top:0; z-index:20; height:54px; border-bottom:1px solid rgba(0,0,0,.08); background:rgba(250,250,252,.82); backdrop-filter:saturate(180%) blur(18px); -webkit-backdrop-filter:saturate(180%) blur(18px); }
    .nav-inner { height:100%; display:flex; align-items:center; gap:28px; }
    .brand { display:flex; align-items:center; gap:10px; font-size:15px; font-weight:650; white-space:nowrap; }
    .brand-mark { display:grid; place-items:center; width:26px; height:26px; border-radius:7px; color:#fff; background:linear-gradient(145deg,#1d1d1f,#505055); font-size:11px; font-weight:750; }
    .nav-links { display:flex; align-items:center; gap:24px; margin-left:auto; color:#424245; font-size:13px; }
    .nav-links a:hover { color:var(--blue); }
    .network-pill { display:flex; align-items:center; gap:7px; padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:rgba(255,255,255,.76); font-size:12px; color:#424245; }
    .pulse { width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 0 3px var(--green-soft); }

    .hero { padding:38px 0 30px; background:var(--surface); border-bottom:1px solid var(--line-soft); }
    .eyebrow { margin:0 0 12px; color:var(--blue); font-size:14px; font-weight:650; }
    h1 { max-width:760px; margin:0; font-size:34px; line-height:1.08; font-weight:700; letter-spacing:0; }
    .hero-copy { max-width:760px; margin:10px 0 22px; color:var(--muted); font-size:15px; line-height:1.48; }
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

    .block-ribbon { display:grid; grid-template-columns:120px minmax(0,1fr); min-height:74px; margin:-8px 0 20px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); overflow:hidden; }
    .ribbon-label { display:flex; flex-direction:column; justify-content:center; padding:14px 16px; border-right:1px solid var(--line-soft); color:var(--muted); font-size:11px; }
    .ribbon-label strong { margin-top:5px; color:var(--ink); font-size:13px; }
    .block-track { display:flex; align-items:stretch; min-width:0; overflow:hidden; }
    .block-chip { flex:1 0 118px; min-width:0; padding:14px 15px; border:0; border-right:1px solid var(--line-soft); color:var(--ink); background:var(--surface); text-align:left; transition:background .18s,transform .35s cubic-bezier(.2,.8,.2,1); }
    .block-chip:hover { background:#f7faff; }
    .block-chip.new { animation:block-arrival .62s cubic-bezier(.2,.8,.2,1) both; background:var(--blue-soft); }
    .block-chip strong,.block-chip span { display:block; }
    .block-chip strong { font-size:13px; }
    .block-chip span { margin-top:6px; color:var(--muted); font-size:11px; }

    .metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; margin-bottom:20px; }
    .metric { min-height:116px; padding:17px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); box-shadow:0 1px 2px rgba(0,0,0,.02); transition:border-color .2s,box-shadow .2s,transform .2s; }
    .metric.changed { border-color:#9dccff; box-shadow:0 0 0 3px rgba(0,113,227,.08); transform:translateY(-1px); }
    .metric-label { color:var(--muted); font-size:13px; }
    .metric-value { margin-top:11px; font-size:26px; line-height:1; font-weight:650; overflow-wrap:anywhere; }
    .metric-foot { margin-top:13px; color:var(--faint); font-size:12px; }
    .metric-foot.good { color:var(--green); }

    .overview { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(280px,.8fr); gap:14px; margin-bottom:22px; }
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
    tbody tr.new-row { animation:row-arrival .75s ease both; }
    .link { color:var(--blue); font-weight:550; cursor:pointer; }
    .hash { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .type-tag { display:inline-flex; padding:4px 8px; border-radius:6px; color:#424245; background:#f0f0f2; font-size:11px; font-weight:600; text-transform:capitalize; }
    .amount { font-weight:600; white-space:nowrap; }
    .muted { color:var(--muted); }
    .empty { padding:36px 20px; color:var(--muted); text-align:center; }

    .live-board { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.15fr); gap:14px; margin-top:22px; }
    .live-board .panel { min-width:0; box-shadow:none; }
    .live-board .panel-head { padding:18px 18px 14px; }
    .live-list { min-height:450px; }
    .live-row { display:grid; width:100%; align-items:center; gap:12px; min-height:72px; padding:12px 18px; border:0; border-bottom:1px solid var(--line-soft); color:var(--ink); background:var(--surface); text-align:left; transition:background .15s; }
    .live-row:last-child { border-bottom:0; }
    .live-row:hover { background:#f7faff; }
    .block-live-row { grid-template-columns:54px minmax(0,1fr) auto; }
    .tx-live-row { grid-template-columns:44px minmax(0,1fr) auto; }
    .row-icon { display:grid; place-items:center; width:40px; height:40px; border-radius:8px; color:var(--blue); background:var(--blue-soft); font-size:12px; font-weight:700; }
    .row-icon.tx { color:#6b45c6; background:#f1edff; }
    .row-title { display:flex; align-items:center; gap:8px; min-width:0; font-size:13px; font-weight:600; }
    .row-subtitle { display:flex; gap:8px; margin-top:5px; min-width:0; color:var(--muted); font-size:12px; }
    .row-side { text-align:right; font-size:12px; }
    .row-side strong { display:block; font-size:13px; }
    .row-side span { display:block; margin-top:5px; color:var(--muted); }
    .stream-clock { display:inline-flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; }
    .stream-clock.live { color:var(--green); }
    .stream-clock.stale { color:var(--amber); }
    .stream-dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
    .stream-clock.live .stream-dot { animation:live-pulse 1.8s ease-out infinite; }
    .filter-control { display:flex; align-items:center; gap:8px; }
    .filter-control select { height:32px; padding:0 28px 0 10px; border:1px solid var(--line); border-radius:7px; color:var(--ink); background:var(--surface); font-size:12px; }

    .drawer-backdrop { position:fixed; inset:0; z-index:40; visibility:hidden; background:rgba(0,0,0,.2); opacity:0; transition:opacity .25s,visibility .25s; }
    .drawer-backdrop.visible { visibility:visible; opacity:1; }
    .drawer { position:absolute; top:0; right:0; width:min(620px,100%); height:100%; overflow:auto; background:rgba(255,255,255,.96); box-shadow:-24px 0 60px rgba(0,0,0,.16); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); transform:translateX(100%); transition:transform .32s cubic-bezier(.2,.8,.2,1); }
    .drawer-backdrop.visible .drawer { transform:translateX(0); }
    .drawer-head { position:sticky; top:0; z-index:2; display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:24px; border-bottom:1px solid var(--line-soft); background:rgba(255,255,255,.9); backdrop-filter:blur(18px); }
    .drawer-head h2 { margin:3px 0 0; font-size:24px; }
    .drawer-kicker { color:var(--blue); font-size:12px; font-weight:650; text-transform:uppercase; }
    .icon-button { display:grid; place-items:center; width:36px; height:36px; flex:none; border:1px solid var(--line-soft); border-radius:50%; color:var(--ink); background:#f3f3f5; font-size:20px; line-height:1; }
    .detail-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; background:var(--line-soft); border-bottom:1px solid var(--line-soft); }
    .detail-stat { min-height:94px; padding:18px; background:var(--surface); }
    .detail-stat span { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; }
    .detail-stat strong { display:block; margin-top:9px; font-size:16px; overflow-wrap:anywhere; }
    .detail-body { padding:20px 24px 40px; }
    .detail-row { display:grid; grid-template-columns:150px minmax(0,1fr) auto; gap:14px; align-items:start; padding:14px 0; border-bottom:1px solid var(--line-soft); font-size:13px; }
    .detail-row dt { color:var(--muted); }
    .detail-row dd { margin:0; overflow-wrap:anywhere; }
    .copy-button { width:30px; height:30px; border:0; border-radius:6px; color:var(--blue); background:var(--blue-soft); font-size:11px; }
    .toast { position:fixed; left:50%; bottom:24px; z-index:60; padding:10px 14px; border-radius:8px; color:#fff; background:rgba(29,29,31,.92); box-shadow:var(--shadow); font-size:13px; opacity:0; transform:translate(-50%,12px); pointer-events:none; transition:opacity .2s,transform .2s; }
    .toast.visible { opacity:1; transform:translate(-50%,0); }

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
    @keyframes row-arrival { from { opacity:0; transform:translateY(-8px); background:var(--blue-soft); } to { opacity:1; transform:translateY(0); background:transparent; } }
    @keyframes block-arrival { from { opacity:0; transform:translateX(-18px); } to { opacity:1; transform:translateX(0); } }
    @keyframes live-pulse { 0% { box-shadow:0 0 0 0 rgba(36,138,61,.35); } 70% { box-shadow:0 0 0 7px rgba(36,138,61,0); } 100% { box-shadow:0 0 0 0 rgba(36,138,61,0); } }

    @media (max-width:900px) {
      .metrics { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .overview { grid-template-columns:1fr; }
      .live-board { grid-template-columns:1fr; }
      .block-ribbon { grid-template-columns:104px minmax(0,1fr); }
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
      .status-bar { flex-wrap:wrap; }
      .status-bar .refresh { margin-left:0; }
      .block-ribbon { grid-template-columns:88px minmax(0,1fr); }
      .ribbon-label { padding:12px; }
      .block-chip { flex-basis:108px; padding:13px 12px; }
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
      .detail-summary { grid-template-columns:1fr 1fr; }
      .detail-row { grid-template-columns:100px minmax(0,1fr) auto; }
    }
    @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } * { animation:none!important; transition:none!important; } }
  </style>
</head>
<body>
  <nav class="nav" aria-label="Primary navigation">
    <div class="shell nav-inner">
      <a class="brand" href="#top" aria-label="YNX Chain Explorer home"><span class="brand-mark">YNX</span><span>Chain Explorer</span></a>
      <div class="nav-links">
        <a href="#network">Overview</a><a href="#live">Blockchain</a><a href="#intelligence">Validators</a><a href="#resourcesPanel">Resources</a>
        <span class="network-pill"><span class="pulse"></span><span id="networkName">Testnet</span></span>
      </div>
    </div>
  </nav>

  <header class="hero" id="top">
    <div class="shell">
      <p class="eyebrow">YNX Testnet</p>
      <h1>YNX Chain network explorer</h1>
      <p class="hero-copy">Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.</p>
      <form class="search" id="searchForm">
        <input id="searchInput" aria-label="Search the chain" placeholder="Search ynx1 address, transaction, block, or EVM compatibility address" autocomplete="off" spellcheck="false">
        <button type="submit">Search</button>
      </form>
      <div class="hero-meta"><span><span class="pulse"></span>RPC + indexer verified</span><span id="lastUpdated">Connecting to the network</span><span id="heroHeight">Waiting for the latest block</span></div>
      <section class="result-panel" id="resultPanel" aria-live="polite">
        <div class="panel-head"><div><h2 id="resultTitle">Search result</h2><p id="resultSubtitle"></p></div><button class="result-close" id="resultClose" type="button">Close</button></div>
        <div id="resultBody"></div>
      </section>
    </div>
  </header>

  <main>
    <div class="shell">
      <div class="status-bar" id="status"><span class="state"><span class="pulse"></span><span id="statusText">Connecting</span></span><span id="statusDetail">Reading RPC and indexer state</span><span class="stream-clock" id="streamClock"><span class="stream-dot"></span><span id="streamClockText">Opening live stream</span></span><button class="refresh" id="refreshButton" type="button">Refresh</button></div>

      <section class="block-ribbon" aria-label="Live finalized block stream">
        <div class="ribbon-label"><span>FINALITY</span><strong id="finalityState">Connecting</strong></div>
        <div class="block-track" id="blockTrack"><div class="empty">Waiting for finalized blocks...</div></div>
      </section>

      <section class="metrics" aria-label="Network metrics">
        <article class="metric"><div class="metric-label">Latest block</div><div class="metric-value skeleton" id="rpcHeight">0000</div><div class="metric-foot" id="blockAge">Waiting for block data</div></article>
        <article class="metric"><div class="metric-label">Network TPS</div><div class="metric-value skeleton" id="networkTps">0.00</div><div class="metric-foot">Latest indexed window</div></article>
        <article class="metric"><div class="metric-label">Block time</div><div class="metric-value skeleton" id="blockTime">0.0s</div><div class="metric-foot">Observed average</div></article>
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

      <section class="live-board" id="live">
        <article class="panel" id="blocks">
          <div class="panel-head"><div><h2>Latest blocks</h2><p>Finalized blocks arriving from the live indexer</p></div><button class="section-link" type="button" data-refresh>Refresh</button></div>
          <div class="live-list" id="blocksBody"><div class="empty">Loading blocks...</div></div>
        </article>
        <article class="panel" id="transactions">
          <div class="panel-head"><div><h2>Latest transactions</h2><p>Transfers and protocol actions on YNX Chain</p></div><div class="filter-control"><select id="txFilter" aria-label="Filter transaction type"><option value="all">All activity</option><option value="transfer">Transfers</option><option value="resource">Resources</option><option value="faucet">Faucet</option></select></div></div>
          <div class="live-list" id="txsBody"><div class="empty">Loading transactions...</div></div>
        </article>
      </section>

      <section class="wallet-band">
        <div><h2>YNX-native identity comes first.</h2><p>YNX applications use the checksummed ynx1 address by default. Standard MetaMask remains available through the isolated EVM compatibility adapter for the same account.</p></div>
        <button id="metamaskButton" class="wallet-button" type="button">Open MetaMask compatibility</button>
      </section>
    </div>
  </main>

  <footer><div class="shell footer-inner"><span>YNX Chain Explorer</span><span>Live testnet data. Mainnet launch is not claimed.</span></div></footer>

  <div class="drawer-backdrop" id="detailBackdrop" aria-hidden="true">
    <aside class="drawer" id="detailDrawer" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
      <div class="drawer-head"><div><div class="drawer-kicker" id="detailKicker">Chain detail</div><h2 id="detailTitle">Loading</h2></div><button class="icon-button" id="detailClose" type="button" aria-label="Close detail panel">&times;</button></div>
      <div id="detailContent"><div class="empty">Loading live chain data...</div></div>
    </aside>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite">Copied</div>

  <script>
    const api = '';
    let walletConfig = null;
    let refreshTimer = null;
    let eventSource = null;
    let latestTransactions = [];
    let previousHeight = 0;
    let previousTxHash = '';
    let lastStreamAt = 0;
    let toastTimer = null;
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
    function blockRow(block,index = 0) {
      const txs = (block.transactions || []).length;
      const isNew = index === 0 && previousHeight && Number(block.height) > previousHeight;
      return '<button class="live-row block-live-row' + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><span class="row-icon">BK</span><span><span class="row-title"><span class="link mono">#' + escapeHTML(number(block.height)) + '</span><span class="type-tag">Finalized</span></span><span class="row-subtitle"><span class="mono hash" title="' + escapeHTML(block.hash) + '">' + escapeHTML(compact(block.hash,14,9)) + '</span></span></span><span class="row-side"><strong>' + txs + (txs === 1 ? ' tx' : ' txs') + '</strong><span title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</span></span></button>';
    }
    function txRow(tx,index = 0) {
      const isNew = index === 0 && previousTxHash && tx.hash !== previousTxHash;
      const route = tx.sponsor ? '<span>uses</span><span class="mono hash" title="' + escapeHTML(tx.sponsor) + '">' + escapeHTML(compact(tx.sponsor,8,6)) + ' sponsor</span>' : '<span>to</span><span class="mono hash" title="' + escapeHTML(tx.to) + '">' + escapeHTML(compact(tx.to,8,6)) + '</span>';
      const value = tx.resourceConsumed ? escapeHTML(number(tx.resourceConsumed)) + ' ' + escapeHTML(String(tx.resourceType || 'resource').replaceAll('_',' ')) : escapeHTML(number(tx.amount)) + ' YNXT';
      const cost = tx.sponsor ? 'Pool ' + escapeHTML(compact(tx.sponsorPoolId,8,5)) : 'Fee ' + escapeHTML(number(tx.fee));
      return '<button class="live-row tx-live-row' + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(tx.hash) + '"><span class="row-icon tx">TX</span><span><span class="row-title"><span class="link mono hash" title="' + escapeHTML(tx.hash) + '">' + escapeHTML(compact(tx.hash,12,8)) + '</span><span class="type-tag">' + escapeHTML(tx.type || 'transaction') + '</span></span><span class="row-subtitle"><span class="mono hash" title="' + escapeHTML(tx.from) + '">' + escapeHTML(compact(tx.from,8,6)) + '</span>' + route + '</span></span><span class="row-side"><strong>' + value + '</strong><span>' + cost + '</span></span></button>';
    }
    function calculateWindow(blocks) {
      if (blocks.length < 2) return {blockTime:0,tps:0};
      const newest = new Date(blocks[0].time).getTime();
      const oldest = new Date(blocks[blocks.length - 1].time).getTime();
      const duration = Math.max(0,(newest - oldest) / 1000);
      const txs = blocks.reduce((sum,block) => sum + (block.transactions || []).length,0);
      return {blockTime:duration ? duration / (blocks.length - 1) : 0,tps:duration ? txs / duration : 0};
    }
    function renderTransactions() {
      const filter = $('txFilter').value;
      const filtered = latestTransactions.filter(tx => filter === 'all' || (filter === 'resource' ? String(tx.type).includes('resource') : tx.type === filter));
      $('txsBody').innerHTML = filtered.length ? filtered.slice(0,6).map(txRow).join('') : '<div class="empty">No matching indexed transactions.</div>';
      bindQueries();
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
    function renderBlockTrack(blocks,incomingHeight) {
      $('finalityState').textContent = blocks.length ? 'Block #' + number(blocks[0].height) : 'Waiting';
      $('blockTrack').innerHTML = blocks.slice(0,8).map((block,index) => {
        const arrived = index === 0 && previousHeight && incomingHeight > previousHeight;
        const txs = (block.transactions || []).length;
        return '<button class="block-chip' + (arrived ? ' new' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><strong class="mono">#' + escapeHTML(number(block.height)) + '</strong><span>' + txs + (txs === 1 ? ' tx' : ' txs') + ' / ' + escapeHTML(relativeTime(block.time)) + '</span></button>';
      }).join('') || '<div class="empty">No finalized blocks yet.</div>';
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
      const windowStats = calculateWindow(blocks);
      const incomingHeight = Number(summary.rpcHeight || 0);
      walletConfig = summary.wallet;
      latestTransactions = transactions;
      $('networkName').textContent = summary.network.name || 'YNX Testnet';
      $('rpcHeight').textContent = number(summary.rpcHeight);
      $('networkTps').textContent = windowStats.tps.toFixed(2);
      $('blockTime').textContent = windowStats.blockTime.toFixed(1) + 's';
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
      $('heroHeight').textContent = 'Block #' + number(summary.rpcHeight) + ' / ' + number(summary.syncLagBlocks) + '-block index lag';
      document.title = 'Block ' + number(summary.rpcHeight) + ' | YNX Chain Explorer';
      $('blocksBody').innerHTML = blocks.length ? blocks.slice(0,6).map(blockRow).join('') : '<div class="empty">No indexed blocks yet.</div>';
      renderTransactions();
      renderBlockTrack(blocks,incomingHeight);
      renderActivity(blocks);
      renderIntelligence(validatorData, resources);
      bindQueries();
      $('statusText').textContent = summary.ok ? 'Network operational' : 'Upstream degraded';
      $('statusDetail').textContent = summary.ok ? source + ' / RPC and indexer are responding' : (summary.indexerError || 'One or more upstream services are degraded');
      $('status').className = 'status-bar' + (summary.ok ? '' : ' warn');
      if (incomingHeight > previousHeight) {
        const metric = $('rpcHeight').closest('.metric');
        metric.classList.remove('changed');
        requestAnimationFrame(() => metric.classList.add('changed'));
        window.setTimeout(() => metric.classList.remove('changed'),700);
      }
      previousHeight = incomingHeight;
      previousTxHash = transactions[0]?.hash || previousTxHash;
      removeSkeletons();
      $('refreshButton').disabled = false;
    }
    async function load() {
      $('refreshButton').disabled = true;
      const [summary, blockData, txData, validators, resources] = await Promise.all([
        get('/api/summary'),
        get('/api/blocks/latest?limit=12'),
        get('/api/txs?limit=12'),
        get('/api/validators').catch(() => ({})),
        get('/api/resource-market/analytics').catch(() => ({}))
      ]);
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
      eventSource.onopen = () => {
        $('streamClock').className = 'stream-clock live';
        $('streamClockText').textContent = 'Live stream connected';
      };
      eventSource.addEventListener('dashboard', event => {
        try {
          const snapshot = JSON.parse(event.data);
          lastStreamAt = Date.now();
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
        $('streamClock').className = 'stream-clock stale';
        $('streamClockText').textContent = 'Stream reconnecting';
        startFallbackPolling();
      };
    }
    function flatten(value, prefix = '', rows = []) {
      if (value === null || value === undefined) { rows.push([prefix || 'Value','unavailable']); return rows; }
      if (Array.isArray(value)) { rows.push([prefix || 'Items',value.length ? value.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(', ') : 'None']); return rows; }
      if (typeof value === 'object') { Object.entries(value).forEach(([key,item]) => flatten(item,prefix ? prefix + ' / ' + key : key,rows)); return rows; }
      rows.push([prefix,value]); return rows;
    }
    function detailStats(type,detail) {
      if (type === 'block') return [['Height','#' + number(detail.height)],['Transactions',(detail.transactions || []).length],['Validator',compact(detail.validator,10,7)]];
      if (type === 'transaction' && detail.sponsor) return [['Resource',number(detail.resourceConsumed) + ' ' + String(detail.resourceType || 'units').replaceAll('_',' ')],['Sponsor',compact(detail.sponsor,10,7)],['Pool',compact(detail.sponsorPoolId,10,7)]];
      if (type === 'transaction') return [['Amount',number(detail.amount) + ' YNXT'],['Fee',number(detail.fee) + ' YNXT'],['Block','#' + number(detail.blockNumber)]];
      if (type === 'account') return [['YNX address',compact(detail.addressFormats?.ynxAddress || detail.account?.address,14,10)],['Balance',number(detail.account?.balance) + ' YNXT'],['Staked',number(detail.account?.staked) + ' YNXT'],['Nonce',number(detail.account?.nonce)]];
      return [];
    }
    function detailRows(type,detail) {
      if (type !== 'account') return flatten(detail);
      const account = {...(detail.account || {})};
      delete account.address;
      const rest = {...detail,account};
      delete rest.addressFormats;
      return [
        ['YNX native address (default)',detail.addressFormats?.ynxAddress || detail.account?.address || 'unavailable'],
        ['EVM compatibility address',detail.addressFormats?.evmAddress || detail.account?.address || 'unavailable'],
        ...flatten(rest)
      ];
    }
    function showDrawer(type,query,detail) {
      const title = type.charAt(0).toUpperCase() + type.slice(1);
      $('detailKicker').textContent = 'Live ' + type + ' detail';
      $('detailTitle').textContent = type === 'account' ? compact(detail.addressFormats?.ynxAddress || query,18,12) : title;
      const stats = detailStats(type,detail);
      const summary = stats.length ? '<div class="detail-summary">' + stats.map(([label,value]) => '<div class="detail-stat"><span>' + escapeHTML(label) + '</span><strong class="mono">' + escapeHTML(value) + '</strong></div>').join('') + '</div>' : '';
      const rows = detailRows(type,detail).map(([key,value]) => {
        const text = String(value ?? '');
        const copy = text.length > 10 ? '<button class="copy-button" type="button" data-copy="' + encodeURIComponent(text) + '" aria-label="Copy value">Copy</button>' : '';
        return '<div class="detail-row"><dt>' + escapeHTML(key) + '</dt><dd class="mono">' + escapeHTML(text) + '</dd>' + copy + '</div>';
      }).join('');
      $('detailContent').innerHTML = summary + '<dl class="detail-body">' + rows + '</dl>';
      $('detailBackdrop').classList.add('visible');
      $('detailBackdrop').setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
      $('detailClose').focus();
    }
    function closeDrawer() {
      $('detailBackdrop').classList.remove('visible');
      $('detailBackdrop').setAttribute('aria-hidden','true');
      document.body.style.overflow = '';
    }
    function showToast(message) {
      $('toast').textContent = message;
      $('toast').classList.add('visible');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => $('toast').classList.remove('visible'),1500);
    }
    async function search(query) {
      const q = String(query || $('searchInput').value).trim();
      if (!q) return;
      $('searchInput').value = q;
      $('detailKicker').textContent = 'Searching live chain data';
      $('detailTitle').textContent = compact(q,18,10);
      $('detailContent').innerHTML = '<div class="empty">Resolving RPC and indexer records...</div>';
      $('detailBackdrop').classList.add('visible');
      $('detailBackdrop').setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
      try {
        const resolved = await get('/api/search?q=' + encodeURIComponent(q));
        const detail = await get(resolved.path);
        showDrawer(resolved.type,q,detail);
      } catch (error) {
        $('detailKicker').textContent = 'Search result';
        $('detailTitle').textContent = 'Not found';
        $('detailContent').innerHTML = '<div class="result-error">' + escapeHTML(error.message) + '</div>';
      }
    }
    $('searchForm').onsubmit = event => { event.preventDefault(); search(); };
    $('resultClose').onclick = () => $('resultPanel').classList.remove('visible');
    $('detailClose').onclick = closeDrawer;
    $('detailBackdrop').onclick = event => { if (event.target === $('detailBackdrop')) closeDrawer(); };
    $('detailContent').onclick = async event => {
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      try { await navigator.clipboard.writeText(decodeURIComponent(button.dataset.copy)); showToast('Copied to clipboard'); }
      catch (_) { showToast('Clipboard unavailable'); }
    };
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
    $('txFilter').onchange = renderTransactions;
    $('refreshButton').onclick = () => load().catch(showLoadError);
    document.querySelectorAll('[data-refresh]').forEach(button => button.onclick = () => load().catch(showLoadError));
    $('metamaskButton').onclick = async () => {
      if (!window.ethereum) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Wallet not detected'; $('resultSubtitle').textContent = 'Install or open an EIP-1193 compatible wallet.'; $('resultBody').innerHTML = '<div class="result-error">MetaMask is not available in this browser.</div>'; return; }
      if (!walletConfig) await load();
      try {
        await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:walletConfig.chainIdHex,chainName:walletConfig.chainName,nativeCurrency:{name:walletConfig.nativeCurrencyName,symbol:walletConfig.nativeSymbol,decimals:walletConfig.decimals},rpcUrls:walletConfig.rpcUrls,blockExplorerUrls:walletConfig.blockExplorerUrls}]});
        $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Compatibility request sent'; $('resultSubtitle').textContent = 'Confirm the YNX Testnet EVM adapter in MetaMask.'; $('resultBody').innerHTML = '<div class="empty">YNX-native applications continue to identify this account with its ynx1 address.</div>';
      } catch (error) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Wallet request declined'; $('resultBody').innerHTML = '<div class="result-error">' + escapeHTML(error.message) + '</div>'; }
    };
    function showLoadError(error) { $('statusText').textContent = 'Explorer unavailable'; $('statusDetail').textContent = error.message; $('status').className = 'status-bar warn'; $('refreshButton').disabled = false; removeSkeletons(); }
    load().catch(showLoadError);
    connectLiveStream();
    window.setInterval(() => {
      if (!lastStreamAt) return;
      const age = Math.floor((Date.now() - lastStreamAt) / 1000);
      $('streamClock').className = 'stream-clock ' + (age < 8 ? 'live' : 'stale');
      $('streamClockText').textContent = age < 2 ? 'Updated now' : (age < 8 ? 'Updated ' + age + 's ago' : 'No event for ' + age + 's');
    },1000);
    document.addEventListener('keydown',event => { if (event.key === 'Escape') closeDrawer(); });
    document.addEventListener('visibilitychange',() => { if (!document.hidden) load().catch(showLoadError); });
  </script>
</body>
</html>`
