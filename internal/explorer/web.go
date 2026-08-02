package explorer

import _ "embed"

//go:embed assets/ynx-logo.png
var logoPNG []byte

//go:embed assets/ynx-icon.png
var iconPNG []byte

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f5f5f7">
  <link rel="icon" href="/assets/ynx-icon.png?v=aacc2912" type="image/png">
  <link rel="apple-touch-icon" href="/assets/ynx-icon.png?v=aacc2912">
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
    .brand-logo { display:block; width:auto; height:24px; max-width:46px; object-fit:contain; object-position:center; }
    .nav-links { display:flex; align-items:center; gap:24px; margin-left:auto; color:#424245; font-size:13px; }
    .nav-links a:hover { color:var(--blue); }
    .network-pill { display:flex; align-items:center; gap:7px; padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:rgba(255,255,255,.76); font-size:12px; color:#424245; }
    .language-select { height:30px; padding:0 26px 0 9px; border:1px solid var(--line); border-radius:7px; color:#424245; background:rgba(255,255,255,.82); font-size:12px; }
    .pulse { width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 0 3px var(--green-soft); }

    .hero { padding:22px 0 18px; background:var(--surface); border-bottom:1px solid var(--line-soft); }
    .eyebrow { margin:0 0 7px; color:var(--blue); font-size:13px; font-weight:650; }
    h1 { max-width:760px; margin:0; font-size:30px; line-height:1.08; font-weight:700; letter-spacing:0; }
    .hero-copy { max-width:760px; margin:7px 0 13px; color:var(--muted); font-size:14px; line-height:1.42; }
    .search { position:relative; max-width:820px; display:flex; align-items:center; gap:10px; }
    .search input { width:100%; height:46px; padding:0 128px 0 16px; border:1px solid var(--line); border-radius:8px; color:var(--ink); background:var(--surface); font-size:15px; outline:none; box-shadow:0 1px 2px rgba(0,0,0,.03); transition:border-color .2s,box-shadow .2s; }
    .search input:focus { border-color:var(--blue); box-shadow:0 0 0 4px rgba(0,113,227,.12); }
    .search button { position:absolute; right:5px; height:36px; padding:0 18px; border:0; border-radius:7px; color:#fff; background:var(--blue); font-weight:600; }
    .search button:hover { background:var(--blue-dark); }
    .hero-meta { display:flex; flex-wrap:wrap; gap:6px 20px; margin-top:11px; color:var(--faint); font-size:11px; }
    .hero-meta span { display:flex; align-items:center; gap:7px; }

    main { padding:17px 0 64px; }
    .status-bar { display:flex; align-items:center; gap:10px; min-height:32px; margin-bottom:10px; color:var(--muted); font-size:12px; }
    .status-bar .state { display:inline-flex; align-items:center; gap:8px; padding:7px 10px; border-radius:7px; background:var(--green-soft); color:var(--green); font-weight:600; }
    .status-bar.warn .state { background:var(--amber-soft); color:var(--amber); }
    .status-bar .refresh { margin-left:auto; border:0; background:transparent; color:var(--blue); padding:7px 0; }

    .block-ribbon { display:grid; grid-template-columns:112px minmax(0,1fr); min-height:58px; margin:0 0 10px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); overflow:hidden; }
    .ribbon-label { display:flex; flex-direction:column; justify-content:center; padding:9px 14px; border-right:1px solid var(--line-soft); color:var(--muted); font-size:10px; }
    .ribbon-label strong { margin-top:5px; color:var(--ink); font-size:13px; }
    .block-track { display:flex; align-items:stretch; min-width:0; overflow:hidden; }
    .block-chip { flex:1 0 112px; min-width:0; padding:9px 13px; border:0; border-right:1px solid var(--line-soft); color:var(--ink); background:var(--surface); text-align:left; transition:background .18s,transform .35s cubic-bezier(.2,.8,.2,1); }
    .block-chip:hover { background:#f7faff; }
    .block-chip.empty-block { flex-basis:78px; opacity:.58; background:#fafafa; }
    .block-chip.new { animation:block-arrival .62s cubic-bezier(.2,.8,.2,1) both; background:var(--blue-soft); }
    .block-chip strong,.block-chip span { display:block; }
    .block-chip strong { font-size:13px; }
    .block-chip span { margin-top:3px; color:var(--muted); font-size:10px; }

    .metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:8px; margin-bottom:5px; }
    .metric { min-height:86px; padding:12px 14px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); box-shadow:0 1px 2px rgba(0,0,0,.02); transition:border-color .2s,box-shadow .2s,transform .2s; }
    .metric.changed { border-color:#9dccff; box-shadow:0 0 0 3px rgba(0,113,227,.08); transform:translateY(-1px); }
    .metric-label { color:var(--muted); font-size:13px; }
    .metric-value { margin-top:6px; font-size:23px; line-height:1; font-weight:650; overflow-wrap:anywhere; }
    .metric-foot { margin-top:7px; color:var(--faint); font-size:10px; }
    .metric-foot.good { color:var(--green); }

    .overview { display:grid; grid-template-columns:minmax(280px,.82fr) minmax(390px,1.18fr) minmax(250px,.68fr); gap:10px; margin-bottom:22px; align-items:start; }
    .panel { border:1px solid var(--line-soft); border-radius:8px; background:var(--surface); box-shadow:var(--shadow); overflow:hidden; }
    .panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:22px 22px 18px; border-bottom:1px solid var(--line-soft); }
    .panel-head h2,.section-head h2 { margin:0; font-size:20px; line-height:1.2; font-weight:650; }
    .panel-head p,.section-head p { margin:5px 0 0; color:var(--muted); font-size:13px; }
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

    .overview .panel { min-width:0; }
    .overview .panel-head { min-height:60px; padding:10px 12px 7px; }
    .overview .panel-head h2 { font-size:18px; }
    .overview .panel-head p { max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .live-list { min-height:0; overflow:visible; }
    .live-row { display:grid; width:100%; align-items:center; gap:8px; min-height:43px; padding:5px 10px; border:0; border-bottom:1px solid var(--line-soft); color:var(--ink); background:var(--surface); text-align:left; transition:background .15s; }
    .live-row:last-child { border-bottom:0; }
    .live-row:hover { background:#f7faff; }
    .block-live-row { grid-template-columns:42px minmax(0,1fr) auto; }
    .block-live-row.empty-block-row { min-height:35px; opacity:.64; grid-template-columns:42px minmax(0,1fr) auto; }
    .block-live-row.empty-block-row .row-icon { width:30px; height:30px; font-size:10px; }
    .tx-live-row { grid-template-columns:44px minmax(0,1fr) auto; }
    .row-icon { display:grid; place-items:center; width:40px; height:40px; border-radius:8px; color:var(--blue); background:var(--blue-soft); font-size:12px; font-weight:700; }
    .row-icon.tx { color:#6b45c6; background:#f1edff; }
    .row-title { display:flex; align-items:center; gap:8px; min-width:0; font-size:13px; font-weight:600; }
    .row-subtitle { display:flex; gap:8px; margin-top:5px; min-width:0; color:var(--muted); font-size:12px; }
    .transfer-flow { display:flex; align-items:center; gap:8px; min-width:0; }
    .address-chip { max-width:112px; padding:3px 7px; border-radius:6px; color:var(--blue); background:var(--blue-soft); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .flow-arrow { position:relative; width:34px; height:1px; flex:none; background:linear-gradient(90deg,#9dccff,var(--blue)); }
    .flow-arrow::after { content:""; position:absolute; right:-1px; top:-3px; width:6px; height:6px; border-top:1px solid var(--blue); border-right:1px solid var(--blue); transform:rotate(45deg); }
    .tx-live-row:hover .flow-arrow { animation:flow-signal 1s ease-in-out infinite; }
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
    .filter-control input { width:150px; height:32px; padding:0 10px; border:1px solid var(--line); border-radius:7px; color:var(--ink); background:var(--surface); font-size:12px; outline:none; }
    .filter-control input:focus { border-color:var(--blue); box-shadow:0 0 0 3px rgba(0,113,227,.1); }

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
    @keyframes flow-signal { 0%,100% { opacity:.45; } 50% { opacity:1; box-shadow:0 0 8px rgba(0,113,227,.45); } }

    @media (max-width:900px) {
      .metrics { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .overview { grid-template-columns:1fr 1fr; }
      .overview .network-facts-panel { grid-column:1 / -1; }
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
      .filter-control { align-items:stretch; flex-direction:column; }
      .filter-control input { width:100%; }
      .wallet-band { align-items:flex-start; flex-direction:column; padding:24px 20px; }
      .wallet-button { width:100%; }
      .result-grid { grid-template-columns:112px minmax(0,1fr); }
      .resource-metrics { grid-template-columns:1fr 1fr; }
      .overview { grid-template-columns:1fr; }
      .overview .network-facts-panel { grid-column:auto; }
      .overview .panel-head p { white-space:normal; }
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
      <a class="brand" href="#top" aria-label="YNX Chain Explorer home"><img class="brand-logo" src="/assets/ynx-logo.png?v=df071f54b" width="46" height="24" alt=""><span data-i18n="brand">Chain Explorer</span></a>
      <div class="nav-links">
        <a href="#network" data-i18n="navOverview">Overview</a><a href="#blocks" data-i18n="navBlockchain">Blockchain</a><a href="#accounts" data-i18n="navAccounts">Accounts</a><a href="#intelligence" data-i18n="navValidators">Validators</a><a href="#resourcesPanel" data-i18n="navResources">Resources</a>
        <select class="language-select" id="languageSelect" aria-label="Language"><option value="en">English</option><option value="zh">中文</option></select>
        <span class="network-pill"><span class="pulse"></span><span id="networkName">Testnet</span></span>
      </div>
    </div>
  </nav>

  <header class="hero" id="top">
    <div class="shell">
      <p class="eyebrow">YNX Testnet</p>
      <h1 data-i18n="heroTitle">YNX Chain network explorer</h1>
      <p class="hero-copy" data-i18n="heroCopy">Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.</p>
      <form class="search" id="searchForm">
        <input id="searchInput" aria-label="Search the chain" data-i18n-placeholder="searchPlaceholder" placeholder="Search ynx1 address, transaction, block, or EVM compatibility address" autocomplete="off" spellcheck="false">
        <button type="submit" data-i18n="search">Search</button>
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
        <article class="metric"><div class="metric-label" data-i18n="latestBlock">Latest block</div><div class="metric-value skeleton" id="rpcHeight">0000</div><div class="metric-foot" id="blockAge">Waiting for block data</div></article>
        <article class="metric"><div class="metric-label" data-i18n="networkTps">Network TPS</div><div class="metric-value skeleton" id="networkTps">0.00</div><div class="metric-foot" data-i18n="indexedWindow">Latest indexed window</div></article>
        <article class="metric"><div class="metric-label" data-i18n="blockTime">Block time</div><div class="metric-value skeleton" id="blockTime">0.0s</div><div class="metric-foot" data-i18n="observedAverage">Observed average</div></article>
        <article class="metric"><div class="metric-label" data-i18n="indexedTxs">Transactions indexed</div><div class="metric-value skeleton" id="txCount">0000</div><div class="metric-foot" data-i18n="verifiedIndexer">Verified by the indexer</div></article>
        <article class="metric"><div class="metric-label" data-i18n="validators">Validators</div><div class="metric-value skeleton" id="validatorCount">00</div><div class="metric-foot" data-i18n="reportedRpc">Reported by chain RPC</div></article>
        <article class="metric"><div class="metric-label" data-i18n="indexerSync">Indexer sync</div><div class="metric-value skeleton" id="syncValue">0 blocks</div><div class="metric-foot" id="syncState">Checking consistency</div></article>
      </section>

      <section class="overview" id="network">
        <article class="panel" id="blocks">
          <div class="panel-head"><div><h2 data-i18n="latestBlocks">Live blocks</h2><p data-i18n="latestBlocksCopy">Finalized blocks arriving now</p></div><span class="stream-clock live"><span class="stream-dot"></span><span data-i18n="live">Live</span></span></div>
          <div class="live-list" id="blocksBody"><div class="empty">Loading blocks...</div></div>
        </article>
        <article class="panel" id="transactions">
          <div class="panel-head"><div><h2 data-i18n="latestTransactions">Live transactions</h2><p data-i18n="latestTransactionsCopy">Newest indexed transfers and actions</p></div><div class="filter-control"><input id="txQuickFind" data-i18n-placeholder="quickFindPlaceholder" placeholder="Find hash, address, amount…" aria-label="Quick find transactions"><select id="txFilter" aria-label="Filter transaction type"><option value="all">All</option><option value="transfer">Transfers</option><option value="resource">Resources</option><option value="faucet">Faucet</option></select></div></div>
          <div class="live-list" id="txsBody"><div class="empty">Loading transactions...</div></div>
        </article>
        <article class="panel network-facts-panel">
          <div class="panel-head"><div><h2 data-i18n="networkDetails">Network details</h2><p data-i18n="networkDetailsCopy">Current chain configuration</p></div></div>
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

      <section class="section" id="accounts">
        <div class="section-head"><div><h2 data-i18n="accountLeaderboard">YNXT account leaderboard</h2><p data-i18n="accountLeaderboardCopy">Authoritative public-ledger ranking by current liquid YNXT balance</p></div><span class="muted" id="accountTotal">Loading accounts…</span></div>
        <div class="table-shell"><table class="accounts-table"><thead><tr><th style="width:9%">Rank</th><th style="width:43%">Account</th><th style="width:18%">Balance</th><th style="width:16%">Staked</th><th style="width:14%">Nonce</th></tr></thead><tbody id="accountsBody"><tr><td colspan="5" class="empty">Loading authoritative account balances...</td></tr></tbody></table></div>
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
    const messages = {
      en:{brand:'Chain Explorer',navOverview:'Overview',navBlockchain:'Blockchain',navAccounts:'Accounts',navValidators:'Validators',navResources:'Resources',heroTitle:'YNX Chain network explorer',heroCopy:'Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.',searchPlaceholder:'Search ynx1 address, transaction, block, or EVM compatibility address',search:'Search',latestBlock:'Latest block',networkTps:'Network TPS',indexedWindow:'Latest indexed window',blockTime:'Block time',observedAverage:'Observed average',indexedTxs:'Transactions indexed',verifiedIndexer:'Verified by the indexer',validators:'Validators',reportedRpc:'Reported by chain RPC',indexerSync:'Indexer sync',networkDetails:'Network details',networkDetailsCopy:'Current chain configuration',latestBlocks:'Real-time blocks',latestBlocksCopy:'Five newest finalized blocks, updated live',refresh:'Refresh',latestTransactions:'Real-time transactions',latestTransactionsCopy:'Five newest indexed transfers and actions',quickFindPlaceholder:'Find hash, address, amount…',accountLeaderboard:'YNXT account leaderboard',accountLeaderboardCopy:'Authoritative public-ledger ranking by current liquid YNXT balance',operational:'Network operational',degraded:'Upstream degraded',fullySynced:'Fully synchronized',catchingUp:'Indexer catching up',noMatching:'No matching transactions in the indexed transaction feed.',rpcResponding:'RPC and indexer are responding',live:'Live'},
      zh:{brand:'链上浏览器',navOverview:'概览',navBlockchain:'区块链',navAccounts:'账户',navValidators:'验证者',navResources:'资源',heroTitle:'YNX Chain 区块链浏览器',heroCopy:'查看公共测试网的实时区块、交易、验证者、账户、手续费与原生 YNXT 资源经济数据。',searchPlaceholder:'搜索 ynx1 地址、交易哈希、区块高度或 EVM 兼容地址',search:'搜索',latestBlock:'最新区块',networkTps:'网络 TPS',indexedWindow:'最近索引窗口',blockTime:'平均出块时间',observedAverage:'实时观测平均值',indexedTxs:'已索引交易',verifiedIndexer:'由索引器验证',validators:'验证者',reportedRpc:'由链 RPC 报告',indexerSync:'索引同步',networkDetails:'网络详情',networkDetailsCopy:'当前链配置',latestBlocks:'实时出块',latestBlocksCopy:'最新 5 个最终区块，实时更新',refresh:'刷新',latestTransactions:'实时交易',latestTransactionsCopy:'最新 5 笔已索引转账与协议操作',quickFindPlaceholder:'快速查找哈希、地址、金额…',accountLeaderboard:'YNXT 账户富豪榜',accountLeaderboardCopy:'按当前可用 YNXT 余额排序的权威公共账本排名',operational:'网络运行正常',degraded:'上游服务降级',fullySynced:'已完全同步',catchingUp:'索引器正在追赶',noMatching:'已索引交易流中没有匹配结果。',rpcResponding:'RPC 与索引器正在正常响应',live:'实时'}
    };
    let language = localStorage.getItem('ynx-explorer-language') || (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
    const t = key => messages[language]?.[key] || messages.en[key] || key;
    function applyLanguage(nextLanguage) {
      language = messages[nextLanguage] ? nextLanguage : 'en';
      localStorage.setItem('ynx-explorer-language',language);
      document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
      document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
      $('languageSelect').value = language;
      renderTransactions();
    }
    const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const compact = (value, start = 10, end = 7) => { const text = String(value ?? ''); return text.length > start + end + 3 ? text.slice(0,start) + '...' + text.slice(-end) : text || '--'; };
    const number = (value) => new Intl.NumberFormat('en-US').format(Number(value || 0));
    const relativeTime = (value) => {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
      if (!Number.isFinite(seconds)) return 'Time unavailable';
      if (language === 'zh') {
        if (seconds < 60) return seconds + ' 秒前';
        if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
        return Math.floor(seconds / 3600) + ' 小时前';
      }
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
      return '<button class="live-row block-live-row' + (txs === 0 ? ' empty-block-row' : '') + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><span class="row-icon">BK</span><span><span class="row-title"><span class="link mono">#' + escapeHTML(number(block.height)) + '</span><span class="type-tag">' + (txs === 0 ? (language === 'zh' ? '空区块' : 'Empty') : (language === 'zh' ? '已最终确定' : 'Finalized')) + '</span></span><span class="row-subtitle"><span class="mono hash" title="' + escapeHTML(block.hash) + '">' + escapeHTML(compact(block.hash,14,9)) + '</span></span></span><span class="row-side"><strong>' + txs + (language === 'zh' ? ' 笔交易' : (txs === 1 ? ' tx' : ' txs')) + '</strong><span title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</span></span></button>';
    }
    function txRow(tx,index = 0) {
      const isNew = index === 0 && previousTxHash && tx.hash !== previousTxHash;
      const destination = tx.sponsor || tx.to;
      const route = '<span class="transfer-flow"><span class="mono address-chip" data-account="' + escapeHTML(tx.from) + '" title="From ' + escapeHTML(tx.from) + '">' + escapeHTML(compact(tx.from,8,6)) + '</span><span class="flow-arrow" aria-label="sent to"></span><span class="mono address-chip" data-account="' + escapeHTML(destination) + '" title="To ' + escapeHTML(destination) + '">' + escapeHTML(compact(destination,8,6)) + '</span></span>';
      const value = tx.resourceConsumed ? escapeHTML(number(tx.resourceConsumed)) + ' ' + escapeHTML(String(tx.resourceType || 'resource').replaceAll('_',' ')) : escapeHTML(number(tx.amount)) + ' YNXT';
      const cost = tx.sponsor ? 'Pool ' + escapeHTML(compact(tx.sponsorPoolId,8,5)) : 'Fee ' + escapeHTML(number(tx.fee));
      return '<button class="live-row tx-live-row' + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(tx.hash) + '"><span class="row-icon tx">TX</span><span><span class="row-title"><span class="link mono hash" title="' + escapeHTML(tx.hash) + '">' + escapeHTML(compact(tx.hash,12,8)) + '</span><span class="type-tag">' + escapeHTML(tx.type || 'transaction') + '</span></span><span class="row-subtitle">' + route + '</span></span><span class="row-side"><strong>' + value + '</strong><span>' + cost + '</span></span></button>';
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
      const query = String($('txQuickFind').value || '').trim().toLowerCase();
      const filtered = latestTransactions.filter(tx => (filter === 'all' || (filter === 'resource' ? String(tx.type).includes('resource') : tx.type === filter)) && (!query || [tx.hash,tx.from,tx.to,tx.type,tx.amount,tx.fee,tx.blockNumber].some(value => String(value ?? '').toLowerCase().includes(query))));
      $('txsBody').innerHTML = filtered.length ? filtered.slice(0,5).map(txRow).join('') : '<div class="empty">' + escapeHTML(t('noMatching')) + '</div>';
      bindQueries();
    }
    function renderBlockTrack(blocks,incomingHeight) {
      $('finalityState').textContent = blocks.length ? 'Block #' + number(blocks[0].height) : 'Waiting';
      $('blockTrack').innerHTML = blocks.slice(0,8).map((block,index) => {
        const arrived = index === 0 && previousHeight && incomingHeight > previousHeight;
        const txs = (block.transactions || []).length;
        return '<button class="block-chip' + (txs === 0 ? ' empty-block' : '') + (arrived ? ' new' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><strong class="mono">#' + escapeHTML(number(block.height)) + '</strong><span>' + (txs === 0 ? (language === 'zh' ? '空区块' : 'empty') : txs + (language === 'zh' ? ' 笔' : (txs === 1 ? ' tx' : ' txs'))) + ' / ' + escapeHTML(relativeTime(block.time)) + '</span></button>';
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
    function renderAccounts(leaderboard) {
      const accounts = leaderboard?.accounts || [];
      $('accountTotal').textContent = number(leaderboard?.total || accounts.length) + ' public accounts / top ' + number(accounts.length);
      $('accountsBody').innerHTML = accounts.length ? accounts.map((account,index) => '<tr data-query="' + escapeHTML(account.address) + '"><td><strong>#' + (index + 1) + '</strong></td><td><span class="link mono hash" title="' + escapeHTML(account.address) + '">' + escapeHTML(account.address) + '</span></td><td class="amount">' + escapeHTML(number(account.balance)) + ' YNXT</td><td>' + escapeHTML(number(account.staked)) + ' YNXT</td><td class="mono">' + escapeHTML(number(account.nonce)) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">No authoritative accounts are available.</td></tr>';
      bindQueries();
    }
    function bindQueries() {
      document.querySelectorAll('[data-query]').forEach(node => node.onclick = () => search(node.dataset.query));
      document.querySelectorAll('[data-account]').forEach(node => node.onclick = event => { event.preventDefault(); event.stopPropagation(); search(node.dataset.account); });
    }
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
      $('syncValue').textContent = number(summary.syncLagBlocks) + (language === 'zh' ? ' 个区块' : (summary.syncLagBlocks === 1 ? ' block' : ' blocks'));
      $('syncState').textContent = summary.syncLagBlocks === 0 ? t('fullySynced') : t('catchingUp');
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
      $('blocksBody').innerHTML = blocks.length ? blocks.slice(0,5).map(blockRow).join('') : '<div class="empty">No indexed blocks yet.</div>';
      renderTransactions();
      renderBlockTrack(blocks,incomingHeight);
      renderIntelligence(validatorData, resources);
      bindQueries();
      $('statusText').textContent = summary.ok ? t('operational') : t('degraded');
      $('statusDetail').textContent = summary.ok ? source + ' / ' + t('rpcResponding') : (summary.indexerError || (language === 'zh' ? '一个或多个上游服务已降级' : 'One or more upstream services are degraded'));
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
      const [summary, blockData, txData, validators, resources, leaderboard] = await Promise.all([
        get('/api/summary'),
        get('/api/blocks/latest?limit=12'),
        get('/api/txs?limit=12'),
        get('/api/validators').catch(() => ({})),
        get('/api/resource-market/analytics').catch(() => ({})),
        get('/api/accounts?limit=10').catch(() => ({accounts:[],total:0}))
      ]);
      renderDashboard(summary, blockData.blocks, txData.transactions, validators, resources, 'Manual snapshot');
      renderAccounts(leaderboard);
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
    $('txQuickFind').oninput = renderTransactions;
    $('languageSelect').onchange = event => { applyLanguage(event.target.value); load().catch(showLoadError); };
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
    applyLanguage(language);
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
