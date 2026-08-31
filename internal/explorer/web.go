package explorer

import _ "embed"

//go:embed assets/ynx-logo.png
var logoPNG []byte

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f5f5f7">
  <link rel="icon" href="/assets/ynx-logo.png" type="image/png">
  <link rel="apple-touch-icon" href="/assets/ynx-logo.png">
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

    main { padding:14px 0 64px; }
    .status-bar { display:flex; align-items:center; gap:10px; min-height:32px; margin-bottom:8px; color:var(--muted); font-size:12px; }
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
	.page-actions { display:flex; justify-content:center; padding:10px 14px 14px; border-top:1px solid var(--line-soft); }

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
	.flow-visual { margin:20px 24px 0; padding:18px; border:1px solid var(--line-soft); border-radius:8px; background:var(--surface-alt); }
	.flow-visual h3 { margin:0 0 14px; font-size:14px; }
	.flow-line { display:grid; grid-template-columns:80px minmax(0,1fr) 100px; gap:10px; align-items:center; margin:9px 0; font-size:12px; }
	.flow-meter { height:8px; overflow:hidden; border-radius:999px; background:#dedee3; }
	.flow-meter span { display:block; height:100%; border-radius:inherit; background:var(--blue); }
	.flow-line.out .flow-meter span { background:var(--amber); }
	.detail-notice { margin:18px 24px 0; padding:13px 15px; border-left:3px solid var(--blue); border-radius:5px; color:var(--muted); background:var(--blue-soft); font-size:12px; line-height:1.55; }
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
	html[dir="rtl"] body { direction:rtl; }
	html[dir="rtl"] .drawer { right:auto; left:0; transform:translateX(-100%); box-shadow:24px 0 60px rgba(0,0,0,.16); }
	html[dir="rtl"] .drawer-backdrop.visible .drawer { transform:translateX(0); }
	html[dir="rtl"] .search button { right:auto; left:5px; }
	html[dir="rtl"] .search input { padding-right:16px; padding-left:128px; }
	html[dir="rtl"] .row-side { text-align:left; }
	html[dir="rtl"] .flow-arrow { transform:scaleX(-1); }
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
      .brand span { display:none; }
      .nav-links { gap:10px; margin-left:auto; min-width:0; }
      .network-pill { margin-left:0; }
	  html[dir="rtl"] .nav-links { margin-right:auto; margin-left:0; }
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
  <nav class="nav" aria-label="Chain Explorer" data-i18n-aria="brand">
    <div class="shell nav-inner">
      <a class="brand" href="#top" aria-label="YNX Chain network explorer" data-i18n-aria="heroTitle"><img class="brand-logo" src="/assets/ynx-logo.png?v=df071f54b" width="46" height="24" alt=""><span data-i18n="brand">Chain Explorer</span></a>
      <div class="nav-links">
        <a href="#network" data-i18n="navOverview">Overview</a><a href="#blocks" data-i18n="navBlockchain">Blockchain</a><a href="#accounts" data-i18n="navAccounts">Accounts</a><a href="#intelligence" data-i18n="navValidators">Validators</a><a href="#resourcesPanel" data-i18n="navResources">Resources</a>
		<select class="language-select" id="languageSelect" aria-label="Language" data-i18n-aria="language"><option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="pt">Português</option><option value="ru">Русский</option><option value="ar">العربية</option><option value="id">Bahasa Indonesia</option></select>
        <span class="network-pill"><span class="pulse"></span><span id="networkName">Testnet</span></span>
      </div>
    </div>
  </nav>

  <header class="hero" id="top">
    <div class="shell">
      <p class="eyebrow" data-i18n="testnet">YNX Testnet</p>
      <h1 data-i18n="heroTitle">YNX Chain network explorer</h1>
      <p class="hero-copy" data-i18n="heroCopy">Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.</p>
      <form class="search" id="searchForm">
        <input id="searchInput" aria-label="Search block, transaction, ynx1 or 0x address, YNXT, or contract" data-i18n-aria="searchPlaceholder" data-i18n-placeholder="searchPlaceholder" placeholder="Search ynx1 address, transaction, block, or EVM compatibility address" autocomplete="off" spellcheck="false">
        <button type="submit" data-i18n="search">Search</button>
      </form>
      <div class="hero-meta"><span><span class="pulse"></span><span data-i18n="rpcIndexerVerified">RPC + indexer verified</span></span><span id="lastUpdated" data-i18n="connectingNetwork">Connecting to the network</span><span id="heroHeight" data-i18n="waitingLatest">Waiting for the latest block</span></div>
      <section class="result-panel" id="resultPanel" aria-live="polite">
        <div class="panel-head"><div><h2 id="resultTitle" data-i18n="searchResult">Search result</h2><p id="resultSubtitle"></p></div><button class="result-close" id="resultClose" type="button" data-i18n="close">Close</button></div>
        <div id="resultBody"></div>
      </section>
    </div>
  </header>

  <main>
    <div class="shell">
      <div class="status-bar" id="status"><span class="state"><span class="pulse"></span><span id="statusText" data-i18n="connecting">Connecting</span></span><span id="statusDetail" data-i18n="readingState">Reading RPC and indexer state</span><span class="stream-clock" id="streamClock"><span class="stream-dot"></span><span id="streamClockText" data-i18n="openingStream">Opening live stream</span></span><button class="refresh" id="refreshButton" type="button" data-i18n="refresh">Refresh</button></div>

	      <section class="block-ribbon" aria-label="Live finalized block stream" data-i18n-aria="latestBlocks">
        <div class="ribbon-label"><span data-i18n="finality">FINALITY</span><strong id="finalityState" data-i18n="connecting">Connecting</strong></div>
        <div class="block-track" id="blockTrack"><div class="empty" data-i18n="waitingFinalized">Waiting for finalized blocks...</div></div>
      </section>

	  <section class="metrics" aria-label="Network metrics" data-i18n-aria="networkMetrics">
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
		  <div class="live-list" id="blocksBody"><div class="empty" data-i18n="loadingBlocks">Loading blocks...</div></div><div class="page-actions"><button class="refresh" id="olderBlocks" type="button" data-i18n="olderBlocks">Older blocks</button></div>
        </article>
        <article class="panel" id="transactions">
          <div class="panel-head"><div><h2 data-i18n="latestTransactions">Latest transactions</h2><p data-i18n="latestTransactionsCopy">Newest indexed transfers and actions</p></div><div class="filter-control"><input id="txQuickFind" data-i18n-placeholder="quickFindPlaceholder" data-i18n-aria="quickFindPlaceholder" placeholder="Find hash, address, amount…" aria-label="Find hash, address, amount…"><select id="txFilter" aria-label="Live transactions" data-i18n-aria="latestTransactions"><option value="all" data-i18n="all">All</option><option value="transfer" data-i18n="transfers">Transfers</option><option value="resource" data-i18n="resourcesFilter">Resources</option><option value="faucet" data-i18n="faucet">Faucet</option></select></div></div>
		  <div class="live-list" id="txsBody"><div class="empty" data-i18n="loadingTransactions">Loading transactions...</div></div><div class="page-actions"><button class="refresh" id="olderTransactions" type="button" data-i18n="olderTransactions">Older transactions</button></div>
        </article>
        <article class="panel network-facts-panel">
          <div class="panel-head"><div><h2 data-i18n="networkDetails">Network details</h2><p data-i18n="networkDetailsCopy">Current chain configuration</p></div></div>
          <dl class="chain-facts">
            <div class="fact"><dt data-i18n="chainId">Chain ID</dt><dd class="mono" id="chainId">--</dd></div>
            <div class="fact"><dt data-i18n="nativeCoin">Native coin</dt><dd id="nativeCoin">YNXT</dd></div>
            <div class="fact"><dt data-i18n="latestHash">Latest hash</dt><dd class="mono hash" id="latestHash">--</dd></div>
            <div class="fact"><dt data-i18n="dataSource">Data source</dt><dd id="truthState">RPC + Indexer</dd></div>
          </dl>
        </article>
      </section>

      <section class="intelligence" id="intelligence">
        <div class="section-head"><div><h2 data-i18n="intelligenceTitle">Network intelligence</h2><p data-i18n="intelligenceCopy">Validator and resource-economy state from live chain APIs</p></div></div>
        <div class="segmented" role="tablist" aria-label="Network intelligence" data-i18n-aria="intelligenceTitle">
          <button class="segment active" id="validatorsTab" type="button" role="tab" aria-selected="true" aria-controls="validatorsPanel" data-i18n="validators">Validators</button>
          <button class="segment" id="resourcesTab" type="button" role="tab" aria-selected="false" aria-controls="resourcesPanel" data-i18n="resourceEconomy">Resource economy</button>
        </div>
        <div class="intelligence-panel active" id="validatorsPanel" role="tabpanel" aria-labelledby="validatorsTab">
          <div class="table-shell"><table class="blocks-table"><thead><tr><th style="width:24%" data-i18n="validator">Validator</th><th style="width:22%" data-i18n="role">Role</th><th style="width:18%" data-i18n="status">Status</th><th style="width:18%" data-i18n="votingPower">Voting power</th><th style="width:18%" data-i18n="observedHeight">Observed height</th></tr></thead><tbody id="validatorsBody"><tr><td colspan="5" class="empty" data-i18n="loadingValidators">Loading validators...</td></tr></tbody></table></div>
        </div>
        <div class="intelligence-panel" id="resourcesPanel" role="tabpanel" aria-labelledby="resourcesTab">
          <div class="resource-metrics" id="resourceMetrics"><article class="resource-item"><small data-i18n="loadingResource">Loading resource market</small></article></div>
          <div class="policy-line" id="resourcePolicy"></div>
        </div>
      </section>

      <section class="section" id="accounts">
        <div class="section-head"><div><h2 data-i18n="accountLeaderboard">YNXT account leaderboard</h2><p data-i18n="accountLeaderboardCopy">Authoritative public-ledger ranking by current liquid YNXT balance</p></div><span class="muted" id="accountTotal">Loading accounts…</span></div>
        <div class="table-shell"><table class="accounts-table"><thead><tr><th style="width:9%" data-i18n="rank">Rank</th><th style="width:43%" data-i18n="account">Account</th><th style="width:18%" data-i18n="balance">Balance</th><th style="width:16%" data-i18n="staked">Staked</th><th style="width:14%" data-i18n="nonce">Nonce</th></tr></thead><tbody id="accountsBody"><tr><td colspan="5" class="empty" data-i18n="loadingAccounts">Loading authoritative account balances...</td></tr></tbody></table></div>
      </section>

      <section class="wallet-band">
        <div><h2 data-i18n="identityTitle">YNX-native identity comes first.</h2><p data-i18n="identityCopy">YNX native address (default) and EVM compatibility address are distinct. An installed EIP-1193 wallet, including MetaMask when it announces itself, is optional EVM compatibility only; search and detail reads never require it.</p></div>
        <button id="metamaskButton" class="wallet-button" type="button">Connect EVM compatibility wallet</button>
      </section>
    </div>
  </main>

  <footer><div class="shell footer-inner"><span>YNX Chain Explorer</span><span data-i18n="footerBoundary">Live testnet data. Mainnet launch is not claimed.</span></div></footer>

  <div class="drawer-backdrop" id="detailBackdrop" aria-hidden="true">
    <aside class="drawer" id="detailDrawer" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
      <div class="drawer-head"><div><div class="drawer-kicker" id="detailKicker" data-i18n="chainDetail">Chain detail</div><h2 id="detailTitle" data-i18n="loading">Loading</h2></div><button class="icon-button" id="detailClose" type="button" aria-label="Close" data-i18n-aria="close">&times;</button></div>
      <div id="detailContent"><div class="empty" data-i18n="loadingChainData">Loading live chain data...</div></div>
    </aside>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite" data-i18n="copied">Copied</div>

  <script>
    const api = '';
    let walletConfig = null;
	const walletProviders = new Map();
	let connectedWallet = null;
    let refreshTimer = null;
    let eventSource = null;
	let latestBlocks = [];
    let latestTransactions = [];
	let blockCursor = '';
	let transactionCursor = '';
	let blockDisplayLimit = 5;
	let transactionDisplayLimit = 5;
    let previousHeight = 0;
    let previousTxHash = '';
    let lastStreamAt = 0;
    let toastTimer = null;
	let currentDetail = null;
	let currentDetailType = '';
	let currentDetailQuery = '';
    const $ = (id) => document.getElementById(id);
	const messages = {
	  en:{brand:'Chain Explorer',navOverview:'Overview',navBlockchain:'Blockchain',navAccounts:'Accounts',navValidators:'Validators',navResources:'Resources',heroTitle:'YNX Chain network explorer',heroCopy:'Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.',searchPlaceholder:'Search block, transaction, ynx1 or 0x address, YNXT, or contract',search:'Search',latestBlock:'Latest block',networkTps:'Network TPS',indexedWindow:'Latest indexed window',blockTime:'Block time',observedAverage:'Observed average',indexedTxs:'Transactions indexed',verifiedIndexer:'Verified by the indexer',validators:'Validators',reportedRpc:'Reported by chain RPC',indexerSync:'Indexer sync',networkDetails:'Network details',networkDetailsCopy:'Current chain configuration',latestBlocks:'Real-time blocks',latestBlocksCopy:'Five newest finalized blocks, updated live',refresh:'Refresh',latestTransactions:'Latest transactions',latestTransactionsCopy:'Five newest indexed transfers and actions',quickFindPlaceholder:'Find hash, address, amount…',accountLeaderboard:'YNXT account leaderboard',accountLeaderboardCopy:'Ranks full-ledger balances when available; otherwise shows a clearly labeled indexed-participant sample.',operational:'Network operational',degraded:'Upstream degraded',fullySynced:'Fully synchronized',catchingUp:'Indexer catching up',noMatching:'No matching transactions in the indexed transaction feed.',rpcResponding:'RPC and indexer are responding',live:'Live',unavailable:'Explorer data is temporarily unavailable.',reconnecting:'Reconnecting live data',fallback:'Using the ten-second snapshot fallback',historical:'Historical chain data is read-only. Viewing it cannot recreate state or submit a transaction.',economics:'A block is not a fixed YNXT reward. Fees and rewards follow chain economic parameters; this Explorer reports observed fees only.',fundsFlow:'Observed YNXT funds flow',incoming:'Incoming',outgoing:'Outgoing'},
	  'zh-CN':{brand:'链上浏览器',navOverview:'概览',navBlockchain:'区块链',navAccounts:'账户',navValidators:'验证者',navResources:'资源',heroTitle:'YNX Chain 区块链浏览器',heroCopy:'查看公共测试网的实时区块、交易、验证者、账户、手续费与原生 YNXT 资源经济数据。',searchPlaceholder:'搜索区块、交易、ynx1/0x 地址、YNXT 或合约',search:'搜索',latestBlock:'最新区块',networkTps:'网络 TPS',indexedWindow:'最近索引窗口',blockTime:'平均出块时间',observedAverage:'实时观测平均值',indexedTxs:'已索引交易',verifiedIndexer:'由索引器验证',validators:'验证者',reportedRpc:'由链 RPC 报告',indexerSync:'索引同步',networkDetails:'网络详情',networkDetailsCopy:'当前链配置',latestBlocks:'实时出块',latestBlocksCopy:'最新 5 个最终区块，实时更新',refresh:'刷新',latestTransactions:'实时交易',latestTransactionsCopy:'最新 5 笔已索引转账与协议操作',quickFindPlaceholder:'查找哈希、地址、金额…',accountLeaderboard:'YNXT 账户富豪榜',accountLeaderboardCopy:'可用时按全账本余额排名，否则明确展示索引参与者样本。',operational:'网络运行正常',degraded:'上游服务降级',fullySynced:'已完全同步',catchingUp:'索引器正在追赶',noMatching:'索引交易中没有匹配项。',rpcResponding:'RPC 与索引器正在正常响应',live:'实时',unavailable:'浏览器数据暂时不可用。',reconnecting:'正在重连实时数据',fallback:'正在使用十秒快照回退',historical:'历史链上数据只读；查看旧记录不会重建状态或提交交易。',economics:'一个区块并不固定等于一个 YNXT。手续费和奖励遵循链上经济参数，本浏览器仅报告实际观测手续费。',fundsFlow:'已观测 YNXT 资金流',incoming:'流入',outgoing:'流出'},
	  'zh-TW':{brand:'鏈上瀏覽器',navOverview:'概覽',navBlockchain:'區塊鏈',navAccounts:'帳戶',navValidators:'驗證者',navResources:'資源',heroTitle:'YNX Chain 區塊鏈瀏覽器',heroCopy:'查看公共測試網的即時區塊、交易、驗證者、帳戶、手續費與原生 YNXT 資源經濟資料。',searchPlaceholder:'搜尋區塊、交易、ynx1/0x 地址、YNXT 或合約',search:'搜尋',latestBlock:'最新區塊',networkTps:'網路 TPS',indexedWindow:'最近索引視窗',blockTime:'平均出塊時間',observedAverage:'即時觀測平均值',indexedTxs:'已索引交易',verifiedIndexer:'由索引器驗證',validators:'驗證者',reportedRpc:'由鏈 RPC 報告',indexerSync:'索引同步',networkDetails:'網路詳情',networkDetailsCopy:'目前鏈設定',latestBlocks:'即時區塊',latestBlocksCopy:'最新五個最終區塊，即時更新',refresh:'重新整理',latestTransactions:'即時交易',latestTransactionsCopy:'最新五筆已索引轉帳與操作',quickFindPlaceholder:'查找雜湊、地址、金額…',accountLeaderboard:'YNXT 帳戶排行榜',accountLeaderboardCopy:'可用時按完整帳本餘額排名，否則明確顯示索引參與者樣本。',operational:'網路運作正常',degraded:'上游服務降級',fullySynced:'已完全同步',catchingUp:'索引器追趕中',noMatching:'索引交易中沒有符合項目。',rpcResponding:'RPC 與索引器正常回應',live:'即時',unavailable:'瀏覽器資料暫時不可用。',reconnecting:'正在重新連線即時資料',fallback:'正在使用十秒快照備援',historical:'歷史鏈上資料唯讀；查看舊紀錄不會重建狀態或提交交易。',economics:'一個區塊不固定等於一個 YNXT。費用與獎勵依鏈上經濟參數，本瀏覽器僅顯示實際觀測費用。',fundsFlow:'已觀測 YNXT 資金流',incoming:'流入',outgoing:'流出'},
	  ja:{brand:'チェーンエクスプローラー',navOverview:'概要',navBlockchain:'ブロックチェーン',navAccounts:'アカウント',navValidators:'バリデーター',navResources:'リソース',heroTitle:'YNX Chain ネットワークエクスプローラー',heroCopy:'公開テストネットのブロック、取引、バリデーター、アカウント、手数料、YNXT リソース経済をリアルタイム表示します。',searchPlaceholder:'ブロック、取引、ynx1/0x、YNXT、コントラクトを検索',search:'検索',latestBlock:'最新ブロック',networkTps:'ネットワーク TPS',indexedWindow:'最新インデックス範囲',blockTime:'ブロック時間',observedAverage:'観測平均',indexedTxs:'インデックス済み取引',verifiedIndexer:'インデクサーで検証',validators:'バリデーター',reportedRpc:'チェーン RPC の報告',indexerSync:'インデクサー同期',networkDetails:'ネットワーク詳細',networkDetailsCopy:'現在のチェーン設定',latestBlocks:'リアルタイムブロック',latestBlocksCopy:'最新5件の確定ブロック',refresh:'更新',latestTransactions:'リアルタイム取引',latestTransactionsCopy:'最新5件の取引と操作',quickFindPlaceholder:'ハッシュ、アドレス、金額…',accountLeaderboard:'YNXT アカウント順位',accountLeaderboardCopy:'利用可能なら全台帳、そうでなければ明記した索引参加者を表示します。',operational:'ネットワーク正常',degraded:'上流が低下',fullySynced:'同期済み',catchingUp:'追跡中',noMatching:'一致する取引はありません。',rpcResponding:'RPC とインデクサーは応答中',live:'ライブ',unavailable:'データは一時的に利用できません。',reconnecting:'ライブデータを再接続中',fallback:'10秒スナップショットを使用中',historical:'履歴データは読み取り専用です。過去の状態や取引を再作成しません。',economics:'1ブロックは固定1 YNXTではありません。報酬と手数料はチェーンの経済パラメータに従い、ここでは観測手数料のみを表示します。',fundsFlow:'観測済み YNXT 資金フロー',incoming:'入金',outgoing:'出金'},
	  ko:{brand:'체인 탐색기',navOverview:'개요',navBlockchain:'블록체인',navAccounts:'계정',navValidators:'검증자',navResources:'리소스',heroTitle:'YNX Chain 네트워크 탐색기',heroCopy:'공개 테스트넷의 블록, 거래, 검증자, 계정, 수수료 및 YNXT 리소스 경제를 실시간으로 봅니다.',searchPlaceholder:'블록, 거래, ynx1/0x 주소, YNXT 또는 컨트랙트 검색',search:'검색',latestBlock:'최신 블록',networkTps:'네트워크 TPS',indexedWindow:'최신 인덱스 구간',blockTime:'블록 시간',observedAverage:'관측 평균',indexedTxs:'인덱싱된 거래',verifiedIndexer:'인덱서 검증',validators:'검증자',reportedRpc:'체인 RPC 보고',indexerSync:'인덱서 동기화',networkDetails:'네트워크 상세',networkDetailsCopy:'현재 체인 설정',latestBlocks:'실시간 블록',latestBlocksCopy:'최신 5개 확정 블록',refresh:'새로고침',latestTransactions:'실시간 거래',latestTransactionsCopy:'최신 5개 거래와 작업',quickFindPlaceholder:'해시, 주소, 금액 찾기…',accountLeaderboard:'YNXT 계정 순위',accountLeaderboardCopy:'가능하면 전체 원장, 아니면 명시된 인덱스 참여자 표본을 표시합니다.',operational:'네트워크 정상',degraded:'업스트림 저하',fullySynced:'동기화 완료',catchingUp:'인덱서 추적 중',noMatching:'일치하는 거래가 없습니다.',rpcResponding:'RPC와 인덱서 응답 중',live:'실시간',unavailable:'탐색기 데이터를 일시적으로 사용할 수 없습니다.',reconnecting:'실시간 데이터 재연결 중',fallback:'10초 스냅샷 대체 사용 중',historical:'과거 체인 데이터는 읽기 전용이며 상태나 거래를 다시 만들지 않습니다.',economics:'블록 하나가 고정 1 YNXT를 뜻하지 않습니다. 보상과 수수료는 체인 경제 매개변수를 따르며 관측 수수료만 표시합니다.',fundsFlow:'관측된 YNXT 자금 흐름',incoming:'유입',outgoing:'유출'},
	  es:{brand:'Explorador de cadena',navOverview:'Resumen',navBlockchain:'Blockchain',navAccounts:'Cuentas',navValidators:'Validadores',navResources:'Recursos',heroTitle:'Explorador de la red YNX Chain',heroCopy:'Bloques, transacciones, validadores, cuentas, comisiones y economía YNXT en tiempo real desde la testnet pública.',searchPlaceholder:'Buscar bloque, transacción, dirección ynx1/0x, YNXT o contrato',search:'Buscar',latestBlock:'Último bloque',networkTps:'TPS de red',indexedWindow:'Ventana indexada',blockTime:'Tiempo de bloque',observedAverage:'Promedio observado',indexedTxs:'Transacciones indexadas',verifiedIndexer:'Verificado por el indexador',validators:'Validadores',reportedRpc:'Informado por RPC',indexerSync:'Sincronización',networkDetails:'Detalles de red',networkDetailsCopy:'Configuración actual',latestBlocks:'Bloques en tiempo real',latestBlocksCopy:'Cinco bloques finalizados más recientes',refresh:'Actualizar',latestTransactions:'Transacciones en tiempo real',latestTransactionsCopy:'Cinco transferencias y acciones recientes',quickFindPlaceholder:'Buscar hash, dirección, importe…',accountLeaderboard:'Clasificación de cuentas YNXT',accountLeaderboardCopy:'Muestra el libro completo cuando está disponible o una muestra indexada claramente indicada.',operational:'Red operativa',degraded:'Servicio degradado',fullySynced:'Totalmente sincronizado',catchingUp:'Indexador poniéndose al día',noMatching:'No hay transacciones coincidentes.',rpcResponding:'RPC e indexador responden',live:'En vivo',unavailable:'Los datos no están disponibles temporalmente.',reconnecting:'Reconectando datos en vivo',fallback:'Usando instantánea cada diez segundos',historical:'Los datos históricos son de solo lectura; no recrean estado ni envían transacciones.',economics:'Un bloque no equivale a un YNXT fijo. Comisiones y recompensas siguen los parámetros económicos; solo se muestran comisiones observadas.',fundsFlow:'Flujo YNXT observado',incoming:'Entrante',outgoing:'Saliente'},
	  fr:{brand:'Explorateur de chaîne',navOverview:'Vue générale',navBlockchain:'Blockchain',navAccounts:'Comptes',navValidators:'Validateurs',navResources:'Ressources',heroTitle:'Explorateur du réseau YNX Chain',heroCopy:'Blocs, transactions, validateurs, comptes, frais et économie YNXT en direct depuis le testnet public.',searchPlaceholder:'Rechercher bloc, transaction, adresse ynx1/0x, YNXT ou contrat',search:'Rechercher',latestBlock:'Dernier bloc',networkTps:'TPS réseau',indexedWindow:'Fenêtre indexée',blockTime:'Temps de bloc',observedAverage:'Moyenne observée',indexedTxs:'Transactions indexées',verifiedIndexer:'Vérifié par l’indexeur',validators:'Validateurs',reportedRpc:'Rapporté par le RPC',indexerSync:'Synchronisation',networkDetails:'Détails réseau',networkDetailsCopy:'Configuration actuelle',latestBlocks:'Blocs en temps réel',latestBlocksCopy:'Cinq derniers blocs finalisés',refresh:'Actualiser',latestTransactions:'Transactions en temps réel',latestTransactionsCopy:'Cinq derniers transferts et actions',quickFindPlaceholder:'Trouver hash, adresse, montant…',accountLeaderboard:'Classement des comptes YNXT',accountLeaderboardCopy:'Affiche le registre complet si disponible, sinon un échantillon indexé clairement signalé.',operational:'Réseau opérationnel',degraded:'Service amont dégradé',fullySynced:'Entièrement synchronisé',catchingUp:'Indexeur en rattrapage',noMatching:'Aucune transaction correspondante.',rpcResponding:'RPC et indexeur répondent',live:'Direct',unavailable:'Les données sont temporairement indisponibles.',reconnecting:'Reconnexion des données en direct',fallback:'Instantané de secours toutes les dix secondes',historical:'Les données historiques sont en lecture seule et ne recréent ni état ni transaction.',economics:'Un bloc ne vaut pas un YNXT fixe. Frais et récompenses suivent les paramètres économiques; seuls les frais observés sont affichés.',fundsFlow:'Flux YNXT observé',incoming:'Entrant',outgoing:'Sortant'},
	  de:{brand:'Chain Explorer',navOverview:'Übersicht',navBlockchain:'Blockchain',navAccounts:'Konten',navValidators:'Validatoren',navResources:'Ressourcen',heroTitle:'YNX Chain Netzwerk-Explorer',heroCopy:'Live-Blöcke, Transaktionen, Validatoren, Konten, Gebühren und YNXT-Ressourcenökonomie aus dem öffentlichen Testnet.',searchPlaceholder:'Block, Transaktion, ynx1/0x-Adresse, YNXT oder Vertrag suchen',search:'Suchen',latestBlock:'Neuester Block',networkTps:'Netzwerk-TPS',indexedWindow:'Indexiertes Fenster',blockTime:'Blockzeit',observedAverage:'Beobachteter Mittelwert',indexedTxs:'Indexierte Transaktionen',verifiedIndexer:'Vom Indexer verifiziert',validators:'Validatoren',reportedRpc:'Von Chain-RPC gemeldet',indexerSync:'Indexer-Synchronisierung',networkDetails:'Netzwerkdetails',networkDetailsCopy:'Aktuelle Chain-Konfiguration',latestBlocks:'Echtzeit-Blöcke',latestBlocksCopy:'Fünf neueste finalisierte Blöcke',refresh:'Aktualisieren',latestTransactions:'Echtzeit-Transaktionen',latestTransactionsCopy:'Fünf neueste Transfers und Aktionen',quickFindPlaceholder:'Hash, Adresse, Betrag finden…',accountLeaderboard:'YNXT-Kontenrangliste',accountLeaderboardCopy:'Zeigt wenn verfügbar das Gesamtledger, sonst eine klar markierte Index-Stichprobe.',operational:'Netzwerk betriebsbereit',degraded:'Upstream beeinträchtigt',fullySynced:'Vollständig synchronisiert',catchingUp:'Indexer holt auf',noMatching:'Keine passenden Transaktionen.',rpcResponding:'RPC und Indexer antworten',live:'Live',unavailable:'Explorer-Daten sind vorübergehend nicht verfügbar.',reconnecting:'Live-Daten werden neu verbunden',fallback:'Zehn-Sekunden-Snapshot wird verwendet',historical:'Historische Chain-Daten sind schreibgeschützt und erzeugen keinen Zustand oder Transaktionen neu.',economics:'Ein Block entspricht nicht fest einem YNXT. Gebühren und Belohnungen folgen den Wirtschaftsparametern; angezeigt werden nur beobachtete Gebühren.',fundsFlow:'Beobachteter YNXT-Geldfluss',incoming:'Eingang',outgoing:'Ausgang'},
	  pt:{brand:'Explorador da cadeia',navOverview:'Visão geral',navBlockchain:'Blockchain',navAccounts:'Contas',navValidators:'Validadores',navResources:'Recursos',heroTitle:'Explorador da rede YNX Chain',heroCopy:'Blocos, transações, validadores, contas, taxas e economia YNXT em tempo real da testnet pública.',searchPlaceholder:'Buscar bloco, transação, endereço ynx1/0x, YNXT ou contrato',search:'Buscar',latestBlock:'Bloco mais recente',networkTps:'TPS da rede',indexedWindow:'Janela indexada',blockTime:'Tempo de bloco',observedAverage:'Média observada',indexedTxs:'Transações indexadas',verifiedIndexer:'Verificado pelo indexador',validators:'Validadores',reportedRpc:'Informado pelo RPC',indexerSync:'Sincronização',networkDetails:'Detalhes da rede',networkDetailsCopy:'Configuração atual',latestBlocks:'Blocos em tempo real',latestBlocksCopy:'Cinco blocos finalizados mais recentes',refresh:'Atualizar',latestTransactions:'Transações em tempo real',latestTransactionsCopy:'Cinco transferências e ações mais recentes',quickFindPlaceholder:'Localizar hash, endereço, valor…',accountLeaderboard:'Ranking de contas YNXT',accountLeaderboardCopy:'Mostra o livro completo quando disponível ou uma amostra indexada claramente indicada.',operational:'Rede operacional',degraded:'Serviço degradado',fullySynced:'Totalmente sincronizado',catchingUp:'Indexador atualizando',noMatching:'Nenhuma transação correspondente.',rpcResponding:'RPC e indexador respondendo',live:'Ao vivo',unavailable:'Dados temporariamente indisponíveis.',reconnecting:'Reconectando dados ao vivo',fallback:'Usando instantâneo de dez segundos',historical:'Dados históricos são somente leitura e não recriam estado nem enviam transações.',economics:'Um bloco não equivale a um YNXT fixo. Taxas e recompensas seguem os parâmetros econômicos; apenas taxas observadas são exibidas.',fundsFlow:'Fluxo YNXT observado',incoming:'Entrada',outgoing:'Saída'},
	  ru:{brand:'Обозреватель сети',navOverview:'Обзор',navBlockchain:'Блокчейн',navAccounts:'Счета',navValidators:'Валидаторы',navResources:'Ресурсы',heroTitle:'Обозреватель сети YNX Chain',heroCopy:'Блоки, транзакции, валидаторы, счета, комиссии и экономика YNXT в реальном времени из публичной тестовой сети.',searchPlaceholder:'Поиск блока, транзакции, адреса ynx1/0x, YNXT или контракта',search:'Найти',latestBlock:'Последний блок',networkTps:'TPS сети',indexedWindow:'Окно индекса',blockTime:'Время блока',observedAverage:'Наблюдаемое среднее',indexedTxs:'Проиндексировано',verifiedIndexer:'Проверено индексатором',validators:'Валидаторы',reportedRpc:'По данным RPC',indexerSync:'Синхронизация',networkDetails:'Сведения о сети',networkDetailsCopy:'Текущая конфигурация',latestBlocks:'Блоки в реальном времени',latestBlocksCopy:'Пять последних финализированных блоков',refresh:'Обновить',latestTransactions:'Транзакции в реальном времени',latestTransactionsCopy:'Пять последних переводов и действий',quickFindPlaceholder:'Хэш, адрес, сумма…',accountLeaderboard:'Рейтинг счетов YNXT',accountLeaderboardCopy:'Показывает весь реестр, если доступен, иначе явно отмеченную индексированную выборку.',operational:'Сеть работает',degraded:'Сервис деградирован',fullySynced:'Полностью синхронизировано',catchingUp:'Индексатор догоняет',noMatching:'Совпадающих транзакций нет.',rpcResponding:'RPC и индексатор отвечают',live:'В эфире',unavailable:'Данные временно недоступны.',reconnecting:'Переподключение данных',fallback:'Используется снимок каждые десять секунд',historical:'Исторические данные доступны только для чтения и не создают состояние или транзакции заново.',economics:'Блок не равен фиксированному одному YNXT. Комиссии и награды следуют экономическим параметрам; показаны только наблюдаемые комиссии.',fundsFlow:'Наблюдаемый поток YNXT',incoming:'Входящие',outgoing:'Исходящие'},
	  ar:{brand:'مستكشف السلسلة',navOverview:'نظرة عامة',navBlockchain:'سلسلة الكتل',navAccounts:'الحسابات',navValidators:'المدققون',navResources:'الموارد',heroTitle:'مستكشف شبكة YNX Chain',heroCopy:'كتل ومعاملات ومدققون وحسابات ورسوم واقتصاد موارد YNXT مباشرة من شبكة الاختبار العامة.',searchPlaceholder:'ابحث عن كتلة أو معاملة أو عنوان ynx1/0x أو YNXT أو عقد',search:'بحث',latestBlock:'أحدث كتلة',networkTps:'معاملات الشبكة/ث',indexedWindow:'نافذة الفهرسة',blockTime:'زمن الكتلة',observedAverage:'المتوسط المرصود',indexedTxs:'المعاملات المفهرسة',verifiedIndexer:'تحقق منها المفهرس',validators:'المدققون',reportedRpc:'وفق RPC السلسلة',indexerSync:'مزامنة المفهرس',networkDetails:'تفاصيل الشبكة',networkDetailsCopy:'إعداد السلسلة الحالي',latestBlocks:'الكتل المباشرة',latestBlocksCopy:'أحدث خمس كتل نهائية',refresh:'تحديث',latestTransactions:'المعاملات المباشرة',latestTransactionsCopy:'أحدث خمس تحويلات وإجراءات',quickFindPlaceholder:'ابحث عن تجزئة أو عنوان أو مبلغ…',accountLeaderboard:'ترتيب حسابات YNXT',accountLeaderboardCopy:'يعرض دفتر الحسابات الكامل عند توفره، وإلا عينة مفهرسة موضحة بوضوح.',operational:'الشبكة تعمل',degraded:'تراجع خدمة المصدر',fullySynced:'متزامن بالكامل',catchingUp:'المفهرس يلحق بالشبكة',noMatching:'لا توجد معاملات مطابقة.',rpcResponding:'RPC والمفهرس يستجيبان',live:'مباشر',unavailable:'بيانات المستكشف غير متاحة مؤقتًا.',reconnecting:'إعادة اتصال البيانات المباشرة',fallback:'استخدام لقطة احتياطية كل عشر ثوانٍ',historical:'بيانات السلسلة التاريخية للقراءة فقط ولا تعيد إنشاء الحالة أو إرسال معاملة.',economics:'لا تساوي الكتلة الواحدة مقدارًا ثابتًا من YNXT. تتبع الرسوم والمكافآت معلمات اقتصاد السلسلة، ويعرض المستكشف الرسوم المرصودة فقط.',fundsFlow:'تدفق أموال YNXT المرصود',incoming:'وارد',outgoing:'صادر'},
	  id:{brand:'Penjelajah rantai',navOverview:'Ringkasan',navBlockchain:'Blockchain',navAccounts:'Akun',navValidators:'Validator',navResources:'Sumber daya',heroTitle:'Penjelajah jaringan YNX Chain',heroCopy:'Blok, transaksi, validator, akun, biaya, dan ekonomi YNXT langsung dari testnet publik.',searchPlaceholder:'Cari blok, transaksi, alamat ynx1/0x, YNXT, atau kontrak',search:'Cari',latestBlock:'Blok terbaru',networkTps:'TPS jaringan',indexedWindow:'Jendela indeks',blockTime:'Waktu blok',observedAverage:'Rata-rata teramati',indexedTxs:'Transaksi terindeks',verifiedIndexer:'Diverifikasi pengindeks',validators:'Validator',reportedRpc:'Dilaporkan RPC',indexerSync:'Sinkronisasi pengindeks',networkDetails:'Detail jaringan',networkDetailsCopy:'Konfigurasi rantai saat ini',latestBlocks:'Blok waktu nyata',latestBlocksCopy:'Lima blok final terbaru',refresh:'Muat ulang',latestTransactions:'Transaksi waktu nyata',latestTransactionsCopy:'Lima transfer dan tindakan terbaru',quickFindPlaceholder:'Cari hash, alamat, jumlah…',accountLeaderboard:'Peringkat akun YNXT',accountLeaderboardCopy:'Menampilkan ledger penuh bila tersedia, atau sampel peserta indeks yang diberi label jelas.',operational:'Jaringan beroperasi',degraded:'Layanan hulu menurun',fullySynced:'Tersinkron penuh',catchingUp:'Pengindeks mengejar',noMatching:'Tidak ada transaksi yang cocok.',rpcResponding:'RPC dan pengindeks merespons',live:'Langsung',unavailable:'Data sementara tidak tersedia.',reconnecting:'Menyambungkan ulang data langsung',fallback:'Menggunakan snapshot cadangan sepuluh detik',historical:'Data historis hanya-baca dan tidak membuat ulang status atau mengirim transaksi.',economics:'Satu blok bukan satu YNXT tetap. Biaya dan imbalan mengikuti parameter ekonomi rantai; hanya biaya teramati yang ditampilkan.',fundsFlow:'Arus dana YNXT teramati',incoming:'Masuk',outgoing:'Keluar'}
	};
	const supplementalKeys = ['testnet','rpcIndexerVerified','connectingNetwork','waitingLatest','searchResult','close','connecting','readingState','openingStream','finality','waitingFinalized','loadingBlocks','olderBlocks','all','transfers','resourcesFilter','faucet','loadingTransactions','olderTransactions','chainId','nativeCoin','latestHash','dataSource','intelligenceTitle','intelligenceCopy','resourceEconomy','validator','role','status','votingPower','observedHeight','loadingValidators','loadingResource','rank','account','balance','staked','nonce','loadingAccounts','identityTitle','identityCopy','openMetamask','footerBoundary','chainDetail','loading','loadingChainData','copied'];
	const supplementalValues = {
	  en:['YNX Testnet','RPC + indexer verified','Connecting to the network','Waiting for the latest block','Search result','Close','Connecting','Reading RPC and indexer state','Opening live stream','FINALITY','Waiting for finalized blocks...','Loading blocks...','Older blocks','All','Transfers','Resources','Faucet','Loading transactions...','Older transactions','Chain ID','Native coin','Latest hash','Data source','Network intelligence','Validator and resource-economy state from live chain APIs','Resource economy','Validator','Role','Status','Voting power','Observed height','Loading validators...','Loading resource market','Rank','Account','Balance','Staked','Nonce','Loading authoritative account balances...','YNX-native identity comes first.','YNX applications use the checksummed ynx1 address by default. Standard MetaMask remains available through the isolated EVM compatibility adapter for the same account.','Open MetaMask compatibility','Live testnet data. Mainnet launch is not claimed.','Chain detail','Loading','Loading live chain data...','Copied'],
	  'zh-CN':['YNX 测试网','RPC 与索引器已验证','正在连接网络','等待最新区块','搜索结果','关闭','正在连接','正在读取 RPC 与索引器状态','正在打开实时数据流','最终性','等待最终区块…','正在加载区块…','更早区块','全部','转账','资源','水龙头','正在加载交易…','更早交易','链 ID','原生币','最新哈希','数据来源','网络情报','来自实时链 API 的验证者与资源经济状态','资源经济','验证者','角色','状态','投票权重','观测高度','正在加载验证者…','正在加载资源市场','排名','账户','余额','质押','Nonce','正在加载权威账户余额…','优先使用 YNX 原生身份。','YNX 应用默认使用带校验和的 ynx1 地址；同一账户仍可通过隔离的 EVM 兼容适配器使用标准 MetaMask。','打开 MetaMask 兼容模式','实时测试网数据；不声明主网已启动。','链上详情','正在加载','正在加载实时链上数据…','已复制'],
	  'zh-TW':['YNX 測試網','RPC 與索引器已驗證','正在連線網路','等待最新區塊','搜尋結果','關閉','正在連線','正在讀取 RPC 與索引器狀態','正在開啟即時資料流','最終性','等待最終區塊…','正在載入區塊…','更早區塊','全部','轉帳','資源','水龍頭','正在載入交易…','更早交易','鏈 ID','原生幣','最新雜湊','資料來源','網路情報','來自即時鏈 API 的驗證者與資源經濟狀態','資源經濟','驗證者','角色','狀態','投票權重','觀測高度','正在載入驗證者…','正在載入資源市場','排名','帳戶','餘額','質押','Nonce','正在載入權威帳戶餘額…','優先使用 YNX 原生身分。','YNX 應用預設使用具校驗和的 ynx1 地址；同一帳戶仍可透過隔離的 EVM 相容轉接器使用標準 MetaMask。','開啟 MetaMask 相容模式','即時測試網資料；不宣稱主網已啟動。','鏈上詳情','正在載入','正在載入即時鏈上資料…','已複製'],
	  ja:['YNX テストネット','RPC とインデクサーを検証済み','ネットワークに接続中','最新ブロックを待機中','検索結果','閉じる','接続中','RPC とインデクサーの状態を取得中','ライブストリームを開始中','ファイナリティ','確定ブロックを待機中…','ブロックを読み込み中…','過去のブロック','すべて','送金','リソース','フォーセット','取引を読み込み中…','過去の取引','チェーン ID','ネイティブコイン','最新ハッシュ','データソース','ネットワーク分析','ライブ Chain API のバリデーターとリソース経済状態','リソース経済','バリデーター','役割','状態','投票力','観測高','バリデーターを読み込み中…','リソース市場を読み込み中','順位','アカウント','残高','ステーク','Nonce','正式なアカウント残高を読み込み中…','YNX ネイティブ ID を優先します。','YNX アプリはチェックサム付き ynx1 アドレスを既定で使います。同じアカウントで、分離された EVM 互換アダプターを介して標準 MetaMask も利用できます。','MetaMask 互換モードを開く','ライブテストネットデータ。メインネット開始は主張しません。','チェーン詳細','読み込み中','ライブチェーンデータを読み込み中…','コピーしました'],
	  ko:['YNX 테스트넷','RPC 및 인덱서 검증됨','네트워크 연결 중','최신 블록 대기 중','검색 결과','닫기','연결 중','RPC 및 인덱서 상태 읽는 중','실시간 스트림 여는 중','최종성','확정 블록 대기 중…','블록 불러오는 중…','이전 블록','전체','전송','리소스','수도꼭지','거래 불러오는 중…','이전 거래','체인 ID','네이티브 코인','최신 해시','데이터 소스','네트워크 인텔리전스','실시간 체인 API의 검증자 및 리소스 경제 상태','리소스 경제','검증자','역할','상태','투표력','관측 높이','검증자 불러오는 중…','리소스 시장 불러오는 중','순위','계정','잔액','스테이킹','Nonce','권위 있는 계정 잔액 불러오는 중…','YNX 네이티브 ID가 우선입니다.','YNX 앱은 체크섬 ynx1 주소를 기본으로 사용합니다. 같은 계정은 격리된 EVM 호환 어댑터를 통해 표준 MetaMask도 사용할 수 있습니다.','MetaMask 호환 모드 열기','실시간 테스트넷 데이터이며 메인넷 출시를 주장하지 않습니다.','체인 상세','불러오는 중','실시간 체인 데이터 불러오는 중…','복사됨'],
	  es:['Testnet YNX','RPC e indexador verificados','Conectando a la red','Esperando el último bloque','Resultado de búsqueda','Cerrar','Conectando','Leyendo estado de RPC e indexador','Abriendo flujo en vivo','FINALIDAD','Esperando bloques finalizados…','Cargando bloques…','Bloques anteriores','Todos','Transferencias','Recursos','Grifo','Cargando transacciones…','Transacciones anteriores','ID de cadena','Moneda nativa','Último hash','Fuente de datos','Inteligencia de red','Estado de validadores y economía de recursos desde APIs en vivo','Economía de recursos','Validador','Rol','Estado','Poder de voto','Altura observada','Cargando validadores…','Cargando mercado de recursos','Puesto','Cuenta','Saldo','En staking','Nonce','Cargando saldos autorizados…','La identidad nativa YNX es prioritaria.','Las aplicaciones YNX usan por defecto la dirección ynx1 con suma de control. MetaMask estándar sigue disponible mediante el adaptador EVM aislado para la misma cuenta.','Abrir compatibilidad con MetaMask','Datos de testnet en vivo. No se afirma el lanzamiento de mainnet.','Detalle de cadena','Cargando','Cargando datos de cadena en vivo…','Copiado'],
	  fr:['Testnet YNX','RPC et indexeur vérifiés','Connexion au réseau','En attente du dernier bloc','Résultat de recherche','Fermer','Connexion','Lecture de l’état RPC et indexeur','Ouverture du flux en direct','FINALITÉ','En attente des blocs finalisés…','Chargement des blocs…','Blocs précédents','Tous','Transferts','Ressources','Robinet','Chargement des transactions…','Transactions précédentes','ID de chaîne','Monnaie native','Dernier hash','Source des données','Intelligence réseau','État des validateurs et de l’économie des ressources via les API en direct','Économie des ressources','Validateur','Rôle','État','Pouvoir de vote','Hauteur observée','Chargement des validateurs…','Chargement du marché des ressources','Rang','Compte','Solde','Mis en jeu','Nonce','Chargement des soldes de référence…','L’identité native YNX est prioritaire.','Les applications YNX utilisent par défaut l’adresse ynx1 avec somme de contrôle. MetaMask standard reste disponible via l’adaptateur EVM isolé pour le même compte.','Ouvrir la compatibilité MetaMask','Données testnet en direct. Aucun lancement mainnet n’est revendiqué.','Détail de chaîne','Chargement','Chargement des données de chaîne en direct…','Copié'],
	  de:['YNX-Testnet','RPC und Indexer verifiziert','Verbindung zum Netzwerk','Warten auf den neuesten Block','Suchergebnis','Schließen','Verbindung wird hergestellt','RPC- und Indexer-Status wird gelesen','Live-Stream wird geöffnet','FINALITÄT','Warten auf finalisierte Blöcke…','Blöcke werden geladen…','Ältere Blöcke','Alle','Transfers','Ressourcen','Faucet','Transaktionen werden geladen…','Ältere Transaktionen','Chain-ID','Native Coin','Neuester Hash','Datenquelle','Netzwerkintelligenz','Validator- und Ressourcenökonomiestatus aus Live-Chain-APIs','Ressourcenökonomie','Validator','Rolle','Status','Stimmgewicht','Beobachtete Höhe','Validatoren werden geladen…','Ressourcenmarkt wird geladen','Rang','Konto','Guthaben','Gestakt','Nonce','Verbindliche Kontostände werden geladen…','Die YNX-native Identität hat Vorrang.','YNX-Anwendungen verwenden standardmäßig die geprüfte ynx1-Adresse. Standard-MetaMask bleibt für dasselbe Konto über den isolierten EVM-Kompatibilitätsadapter verfügbar.','MetaMask-Kompatibilität öffnen','Live-Testnet-Daten. Ein Mainnet-Start wird nicht behauptet.','Chain-Detail','Wird geladen','Live-Chain-Daten werden geladen…','Kopiert'],
	  pt:['Testnet YNX','RPC e indexador verificados','Conectando à rede','Aguardando o bloco mais recente','Resultado da busca','Fechar','Conectando','Lendo estado do RPC e indexador','Abrindo fluxo ao vivo','FINALIDADE','Aguardando blocos finalizados…','Carregando blocos…','Blocos anteriores','Todos','Transferências','Recursos','Torneira','Carregando transações…','Transações anteriores','ID da cadeia','Moeda nativa','Hash mais recente','Fonte de dados','Inteligência da rede','Estado dos validadores e da economia de recursos pelas APIs ao vivo','Economia de recursos','Validador','Função','Estado','Poder de voto','Altura observada','Carregando validadores…','Carregando mercado de recursos','Posição','Conta','Saldo','Em stake','Nonce','Carregando saldos autoritativos…','A identidade nativa YNX vem primeiro.','Aplicativos YNX usam por padrão o endereço ynx1 com checksum. O MetaMask padrão continua disponível pelo adaptador EVM isolado para a mesma conta.','Abrir compatibilidade com MetaMask','Dados da testnet ao vivo. O lançamento da mainnet não é declarado.','Detalhe da cadeia','Carregando','Carregando dados da cadeia ao vivo…','Copiado'],
	  ru:['Тестовая сеть YNX','RPC и индексатор проверены','Подключение к сети','Ожидание последнего блока','Результат поиска','Закрыть','Подключение','Чтение состояния RPC и индексатора','Открытие потока данных','ФИНАЛЬНОСТЬ','Ожидание финализированных блоков…','Загрузка блоков…','Более ранние блоки','Все','Переводы','Ресурсы','Кран','Загрузка транзакций…','Более ранние транзакции','ID сети','Нативная монета','Последний хэш','Источник данных','Аналитика сети','Состояние валидаторов и экономики ресурсов из API сети','Экономика ресурсов','Валидатор','Роль','Состояние','Сила голоса','Наблюдаемая высота','Загрузка валидаторов…','Загрузка рынка ресурсов','Место','Счёт','Баланс','В стейкинге','Nonce','Загрузка авторитетных балансов…','Нативная идентичность YNX имеет приоритет.','Приложения YNX по умолчанию используют адрес ynx1 с контрольной суммой. Стандартный MetaMask доступен для того же счёта через изолированный EVM-адаптер.','Открыть совместимость MetaMask','Данные тестовой сети в реальном времени. Запуск mainnet не заявлен.','Детали сети','Загрузка','Загрузка данных сети…','Скопировано'],
	  ar:['شبكة اختبار YNX','تم التحقق من RPC والمفهرس','جارٍ الاتصال بالشبكة','بانتظار أحدث كتلة','نتيجة البحث','إغلاق','جارٍ الاتصال','قراءة حالة RPC والمفهرس','فتح البث المباشر','النهائية','بانتظار الكتل النهائية…','تحميل الكتل…','كتل أقدم','الكل','التحويلات','الموارد','الصنبور','تحميل المعاملات…','معاملات أقدم','معرّف السلسلة','العملة الأصلية','أحدث تجزئة','مصدر البيانات','معلومات الشبكة','حالة المدققين واقتصاد الموارد من واجهات السلسلة المباشرة','اقتصاد الموارد','المدقق','الدور','الحالة','قوة التصويت','الارتفاع المرصود','تحميل المدققين…','تحميل سوق الموارد','الترتيب','الحساب','الرصيد','المحجوز','Nonce','تحميل أرصدة الحسابات الموثوقة…','هوية YNX الأصلية أولًا.','تستخدم تطبيقات YNX عنوان ynx1 ذا المجموع الاختباري افتراضيًا، ويبقى MetaMask القياسي متاحًا للحساب نفسه عبر محول EVM المعزول.','فتح توافق MetaMask','بيانات شبكة الاختبار مباشرة؛ لا ندّعي إطلاق الشبكة الرئيسية.','تفاصيل السلسلة','جارٍ التحميل','تحميل بيانات السلسلة المباشرة…','تم النسخ'],
	  id:['Testnet YNX','RPC dan pengindeks terverifikasi','Menghubungkan ke jaringan','Menunggu blok terbaru','Hasil pencarian','Tutup','Menghubungkan','Membaca status RPC dan pengindeks','Membuka aliran langsung','FINALITAS','Menunggu blok final…','Memuat blok…','Blok lebih lama','Semua','Transfer','Sumber daya','Faucet','Memuat transaksi…','Transaksi lebih lama','ID rantai','Koin asli','Hash terbaru','Sumber data','Intelijen jaringan','Status validator dan ekonomi sumber daya dari API rantai langsung','Ekonomi sumber daya','Validator','Peran','Status','Kekuatan suara','Ketinggian teramati','Memuat validator…','Memuat pasar sumber daya','Peringkat','Akun','Saldo','Dipertaruhkan','Nonce','Memuat saldo akun otoritatif…','Identitas asli YNX didahulukan.','Aplikasi YNX memakai alamat ynx1 ber-checksum secara default. MetaMask standar tetap tersedia untuk akun yang sama melalui adaptor kompatibilitas EVM terisolasi.','Buka kompatibilitas MetaMask','Data testnet langsung. Peluncuran mainnet tidak diklaim.','Detail rantai','Memuat','Memuat data rantai langsung…','Disalin']
	};
	Object.entries(supplementalValues).forEach(([locale,values]) => {
	  if (values.length !== supplementalKeys.length) throw new Error('Incomplete Explorer locale: ' + locale);
	  supplementalKeys.forEach((key,index) => { messages[locale][key] = values[index]; });
	});
	const accessibilityMessages = {
	  en:{language:'Language',networkMetrics:'Network metrics'},
	  'zh-CN':{language:'语言',networkMetrics:'网络指标'},
	  'zh-TW':{language:'語言',networkMetrics:'網路指標'},
	  ja:{language:'言語',networkMetrics:'ネットワーク指標'},
	  ko:{language:'언어',networkMetrics:'네트워크 지표'},
	  es:{language:'Idioma',networkMetrics:'Métricas de red'},
	  fr:{language:'Langue',networkMetrics:'Indicateurs réseau'},
	  de:{language:'Sprache',networkMetrics:'Netzwerkmetriken'},
	  pt:{language:'Idioma',networkMetrics:'Métricas da rede'},
	  ru:{language:'Язык',networkMetrics:'Метрики сети'},
	  ar:{language:'اللغة',networkMetrics:'مقاييس الشبكة'},
	  id:{language:'Bahasa',networkMetrics:'Metrik jaringan'}
	};
	Object.entries(accessibilityMessages).forEach(([locale,values]) => Object.assign(messages[locale],values));
	const rowMessages = {
	  en:{emptyBlock:'Empty block',finalized:'Finalized',txUnit:'transactions',blockUnit:'blocks',observedAccounts:'observed accounts',publicAccounts:'public accounts',noBalances:'No verifiable indexed account balances are available yet.'},
	  'zh-CN':{emptyBlock:'空区块',finalized:'已最终确定',txUnit:'笔交易',blockUnit:'个区块',observedAccounts:'个已观测账户',publicAccounts:'个全账本账户',noBalances:'暂未发现可验证的已索引账户余额。'},
	  'zh-TW':{emptyBlock:'空區塊',finalized:'已最終確定',txUnit:'筆交易',blockUnit:'個區塊',observedAccounts:'個已觀測帳戶',publicAccounts:'個完整帳本帳戶',noBalances:'暫無可驗證的已索引帳戶餘額。'},
	  ja:{emptyBlock:'空ブロック',finalized:'確定済み',txUnit:'取引',blockUnit:'ブロック',observedAccounts:'観測アカウント',publicAccounts:'公開アカウント',noBalances:'検証可能なインデックス済み残高はまだありません。'},
	  ko:{emptyBlock:'빈 블록',finalized:'확정됨',txUnit:'거래',blockUnit:'블록',observedAccounts:'관측 계정',publicAccounts:'공개 계정',noBalances:'검증 가능한 인덱싱 계정 잔액이 아직 없습니다.'},
	  es:{emptyBlock:'Bloque vacío',finalized:'Finalizado',txUnit:'transacciones',blockUnit:'bloques',observedAccounts:'cuentas observadas',publicAccounts:'cuentas públicas',noBalances:'Aún no hay saldos indexados verificables.'},
	  fr:{emptyBlock:'Bloc vide',finalized:'Finalisé',txUnit:'transactions',blockUnit:'blocs',observedAccounts:'comptes observés',publicAccounts:'comptes publics',noBalances:'Aucun solde indexé vérifiable pour le moment.'},
	  de:{emptyBlock:'Leerer Block',finalized:'Finalisiert',txUnit:'Transaktionen',blockUnit:'Blöcke',observedAccounts:'beobachtete Konten',publicAccounts:'öffentliche Konten',noBalances:'Noch keine verifizierbaren indexierten Kontostände.'},
	  pt:{emptyBlock:'Bloco vazio',finalized:'Finalizado',txUnit:'transações',blockUnit:'blocos',observedAccounts:'contas observadas',publicAccounts:'contas públicas',noBalances:'Ainda não há saldos indexados verificáveis.'},
	  ru:{emptyBlock:'Пустой блок',finalized:'Финализирован',txUnit:'транзакций',blockUnit:'блоков',observedAccounts:'наблюдаемых счетов',publicAccounts:'публичных счетов',noBalances:'Проверяемые индексированные балансы пока отсутствуют.'},
	  ar:{emptyBlock:'كتلة فارغة',finalized:'نهائية',txUnit:'معاملات',blockUnit:'كتل',observedAccounts:'حسابات مرصودة',publicAccounts:'حسابات عامة',noBalances:'لا توجد أرصدة مفهرسة قابلة للتحقق بعد.'},
	  id:{emptyBlock:'Blok kosong',finalized:'Final',txUnit:'transaksi',blockUnit:'blok',observedAccounts:'akun teramati',publicAccounts:'akun publik',noBalances:'Belum ada saldo akun terindeks yang dapat diverifikasi.'}
	};
	Object.entries(rowMessages).forEach(([locale,values]) => Object.assign(messages[locale],values));
	const fieldKeys = ['delegatedYnxt','rentalVolume','providerIncome','protocolFees','policy','activeDelegations','rentals','evidence','amount','fee','from','to','time','events','address','deployer','verified','functions','deployedAt','usage','sourceStatus','liquidBalance','indexedCoverage','indexedActivity','contractActivity','dataCheckedAt','throughBlock','loadOlderActivity','yes','no','none','contract','name','evmAddress','sentTo','sponsor','pool','symbol','decimals','runtime','hash','parentHash','type','sourceHash','bytecodeHash','compiler','units'];
	const fieldValues = {
	  en:['Delegated YNXT','Rental volume','Provider income','Protocol fees','Policy','Active delegations','Rentals','Evidence','Amount','Fee','From','To','Time','Events','Address','Deployer','Verified','Functions','Deployed at','Usage','Source status','Liquid balance','Indexed history coverage','Indexed activity','Contract activity','Data checked at','Through block','Load older indexed activity','Yes','No','None','Contract','Name','EVM compatibility address','sent to','Sponsor','Pool','Symbol','Decimals','Runtime','Hash','Parent hash','Type','Source hash','Bytecode hash','Compiler','units'],
	  'zh-CN':['已委托 YNXT','租赁量','提供方收入','协议手续费','策略','有效委托','租赁','证据','金额','手续费','发起方','接收方','时间','事件','地址','部署者','已验证','函数','部署时间','用途','来源状态','可用余额','索引历史覆盖','已索引活动','合约活动','数据检查时间','截至区块','加载更早索引活动','是','否','无','合约','名称','EVM 兼容地址','发送到','赞助方','资源池','符号','小数位','运行时','哈希','父哈希','类型','源码哈希','字节码哈希','编译器','单位'],
	  'zh-TW':['已委託 YNXT','租賃量','提供方收入','協議手續費','策略','有效委託','租賃','證據','金額','手續費','來源','去向','時間','事件','地址','部署者','已驗證','函式','部署時間','用途','來源狀態','可用餘額','索引歷史涵蓋','已索引活動','合約活動','資料檢查時間','截至區塊','載入更早索引活動','是','否','無','合約','名稱','EVM 相容地址','傳送至','贊助方','資源池','符號','小數位','執行環境','雜湊','父雜湊','類型','原始碼雜湊','位元組碼雜湊','編譯器','單位'],
	  ja:['委任済み YNXT','レンタル量','プロバイダー収入','プロトコル手数料','ポリシー','有効な委任','レンタル','証拠','金額','手数料','送信元','送信先','時刻','イベント','アドレス','デプロイヤー','検証済み','関数','デプロイ日時','用途','ソース状態','流動残高','インデックス履歴範囲','インデックス済み活動','コントラクト活動','データ確認日時','ブロックまで','過去の活動を読み込む','はい','いいえ','なし','コントラクト','名前','EVM 互換アドレス','送信先','スポンサー','プール','シンボル','小数桁','ランタイム','ハッシュ','親ハッシュ','種類','ソースハッシュ','バイトコードハッシュ','コンパイラー','単位'],
	  ko:['위임된 YNXT','대여량','공급자 수입','프로토콜 수수료','정책','활성 위임','대여','증거','금액','수수료','보낸 주소','받는 주소','시간','이벤트','주소','배포자','검증됨','함수','배포 시각','용도','소스 상태','유동 잔액','인덱스 이력 범위','인덱싱된 활동','컨트랙트 활동','데이터 확인 시각','블록까지','이전 인덱싱 활동 불러오기','예','아니요','없음','컨트랙트','이름','EVM 호환 주소','전송 대상','후원자','풀','기호','소수 자릿수','런타임','해시','부모 해시','유형','소스 해시','바이트코드 해시','컴파일러','단위'],
	  es:['YNXT delegado','Volumen de alquiler','Ingresos del proveedor','Comisiones del protocolo','Política','Delegaciones activas','Alquileres','Evidencia','Importe','Comisión','Desde','Hacia','Hora','Eventos','Dirección','Desplegador','Verificado','Funciones','Desplegado el','Uso','Estado de fuente','Saldo líquido','Cobertura histórica indexada','Actividad indexada','Actividad de contrato','Datos comprobados el','Hasta el bloque','Cargar actividad anterior','Sí','No','Ninguno','Contrato','Nombre','Dirección compatible con EVM','enviado a','Patrocinador','Grupo','Símbolo','Decimales','Entorno de ejecución','Hash','Hash padre','Tipo','Hash de fuente','Hash de bytecode','Compilador','unidades'],
	  fr:['YNXT délégué','Volume de location','Revenu fournisseur','Frais de protocole','Politique','Délégations actives','Locations','Preuve','Montant','Frais','De','Vers','Heure','Événements','Adresse','Déployeur','Vérifié','Fonctions','Déployé le','Utilisation','État de la source','Solde liquide','Couverture historique indexée','Activité indexée','Activité du contrat','Données vérifiées le','Jusqu’au bloc','Charger l’activité antérieure','Oui','Non','Aucun','Contrat','Nom','Adresse compatible EVM','envoyé à','Sponsor','Pool','Symbole','Décimales','Environnement d’exécution','Hash','Hash parent','Type','Hash source','Hash du bytecode','Compilateur','unités'],
	  de:['Delegierte YNXT','Mietvolumen','Anbieterertrag','Protokollgebühren','Richtlinie','Aktive Delegierungen','Mieten','Nachweis','Betrag','Gebühr','Von','An','Zeit','Ereignisse','Adresse','Bereitsteller','Verifiziert','Funktionen','Bereitgestellt am','Verwendung','Quellstatus','Liquides Guthaben','Indexierte Verlaufsabdeckung','Indexierte Aktivität','Vertragsaktivität','Daten geprüft am','Bis Block','Ältere Aktivität laden','Ja','Nein','Keine','Vertrag','Name','EVM-kompatible Adresse','gesendet an','Sponsor','Pool','Symbol','Dezimalstellen','Laufzeit','Hash','Übergeordneter Hash','Typ','Quell-Hash','Bytecode-Hash','Compiler','Einheiten'],
	  pt:['YNXT delegado','Volume de aluguel','Receita do provedor','Taxas do protocolo','Política','Delegações ativas','Aluguéis','Evidência','Valor','Taxa','De','Para','Hora','Eventos','Endereço','Implantador','Verificado','Funções','Implantado em','Uso','Status da fonte','Saldo líquido','Cobertura histórica indexada','Atividade indexada','Atividade do contrato','Dados verificados em','Até o bloco','Carregar atividade anterior','Sim','Não','Nenhum','Contrato','Nome','Endereço compatível com EVM','enviado para','Patrocinador','Pool','Símbolo','Casas decimais','Ambiente de execução','Hash','Hash pai','Tipo','Hash da fonte','Hash do bytecode','Compilador','unidades'],
	  ru:['Делегировано YNXT','Объём аренды','Доход поставщика','Комиссии протокола','Политика','Активные делегирования','Аренды','Доказательство','Сумма','Комиссия','От','Кому','Время','События','Адрес','Развернувший','Проверен','Функции','Развёрнут','Использование','Состояние источника','Ликвидный баланс','Охват индексированной истории','Индексированная активность','Активность контракта','Данные проверены','До блока','Загрузить раннюю активность','Да','Нет','Нет данных','Контракт','Имя','EVM-совместимый адрес','отправлено','Спонсор','Пул','Символ','Десятичные знаки','Среда выполнения','Хэш','Родительский хэш','Тип','Хэш исходника','Хэш байткода','Компилятор','единицы'],
	  ar:['YNXT المفوض','حجم الإيجار','دخل المزود','رسوم البروتوكول','السياسة','التفويضات النشطة','الإيجارات','الدليل','المبلغ','الرسوم','من','إلى','الوقت','الأحداث','العنوان','الناشر','موثّق','الدوال','وقت النشر','الاستخدام','حالة المصدر','الرصيد السائل','تغطية السجل المفهرس','النشاط المفهرس','نشاط العقد','وقت فحص البيانات','حتى الكتلة','تحميل نشاط أقدم','نعم','لا','لا شيء','العقد','الاسم','عنوان متوافق مع EVM','أُرسل إلى','الراعي','المجمّع','الرمز','المنازل العشرية','بيئة التشغيل','التجزئة','تجزئة الأصل','النوع','تجزئة المصدر','تجزئة الشفرة','المترجم','وحدات'],
	  id:['YNXT didelegasikan','Volume sewa','Pendapatan penyedia','Biaya protokol','Kebijakan','Delegasi aktif','Penyewaan','Bukti','Jumlah','Biaya','Dari','Ke','Waktu','Peristiwa','Alamat','Penerap','Terverifikasi','Fungsi','Diterapkan pada','Penggunaan','Status sumber','Saldo likuid','Cakupan riwayat terindeks','Aktivitas terindeks','Aktivitas kontrak','Data diperiksa pada','Sampai blok','Muat aktivitas lebih lama','Ya','Tidak','Tidak ada','Kontrak','Nama','Alamat kompatibel EVM','dikirim ke','Sponsor','Pool','Simbol','Desimal','Runtime','Hash','Hash induk','Jenis','Hash sumber','Hash bytecode','Kompilator','unit']
	};
	Object.entries(fieldValues).forEach(([locale,values]) => {
	  if (values.length !== fieldKeys.length) throw new Error('Incomplete Explorer detail locale: ' + locale);
	  fieldKeys.forEach((key,index) => { messages[locale][key] = values[index]; });
	});
	const supportedLocales = Object.keys(messages);
	let language = localStorage.getItem('ynx-explorer-language') || 'en';
	const t = key => messages[language]?.[key] || messages.en[key] || key;
	const staleStreamPrefixes = {
	  en:'No event for ', 'zh-CN':'已无事件 ', 'zh-TW':'已無事件 ', ja:'イベントなし: ', ko:'이벤트 없음: ', es:'Sin eventos durante ', fr:'Aucun événement depuis ', de:'Kein Ereignis seit ', pt:'Sem evento há ', ru:'Нет событий в течение ', ar:'لا أحداث منذ ', id:'Tidak ada peristiwa selama '
	};
	function staleStreamMessage(age) { return (staleStreamPrefixes[language] || staleStreamPrefixes.en) + age + 's'; }
    function applyLanguage(nextLanguage) {
      language = messages[nextLanguage] ? nextLanguage : 'en';
      localStorage.setItem('ynx-explorer-language',language);
	  document.documentElement.lang = language;
	  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
      document.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label',t(node.dataset.i18nAria)); });
      $('languageSelect').value = language;
      renderTransactions();
    }
    const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const compact = (value, start = 10, end = 7) => { const text = String(value ?? ''); return text.length > start + end + 3 ? text.slice(0,start) + '...' + text.slice(-end) : text || '--'; };
	const number = (value) => new Intl.NumberFormat(language).format(Number(value || 0));
    const relativeTime = (value) => {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
	  if (!Number.isFinite(seconds)) return t('unavailable');
	  const formatter = new Intl.RelativeTimeFormat(language,{numeric:'always'});
	  if (seconds < 60) return formatter.format(-seconds,'second');
	  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60),'minute');
	  return formatter.format(-Math.floor(seconds / 3600),'hour');
    };
    const exactTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString([], {dateStyle:'medium',timeStyle:'medium'}); };
    async function get(path) {
      const response = await fetch(api + path, {headers:{accept:'application/json'}});
	  if (!response.ok) { let detail = ''; try { const failure = await response.json(); detail = failure.message || ''; } catch (_) {} throw new Error(detail || t('unavailable')); }
      return response.json();
    }
    function walletName(provider, info) {
      const announced = typeof info?.name === 'string' ? info.name.trim().slice(0,120) : '';
      if (announced) return announced;
      if (provider?.isYNXWallet) return 'YNX Wallet';
      if (provider?.isMetaMask) return 'MetaMask';
      return 'Browser wallet';
    }
    function walletIcon(value) {
      if (typeof value !== 'string' || value.length > 16384) return '';
      try { const url = new URL(value, location.origin); return url.protocol === 'https:' || url.protocol === 'data:' ? url.href : ''; } catch (_) { return ''; }
    }
    function addWalletProvider(provider, info, source) {
      if (!provider || typeof provider.request !== 'function') return;
      const id = source + ':' + (typeof info?.uuid === 'string' && info.uuid ? info.uuid : (typeof info?.rdns === 'string' ? info.rdns : walletName(provider,info)));
      for (const [existingId, existing] of walletProviders) { if (existing.provider === provider) { if (existing.source === 'legacy-eip1193' && source === 'eip6963') walletProviders.delete(existingId); else return; } }
      walletProviders.set(id,{id,name:walletName(provider,info),icon:walletIcon(info?.icon),provider,source});
    }
    window.addEventListener('eip6963:announceProvider', event => addWalletProvider(event.detail?.provider,event.detail?.info,'eip6963'));
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (window.ethereum) addWalletProvider(window.ethereum,{},'legacy-eip1193');
    function showWalletResult(title, subtitle, body, error) {
      $('resultPanel').classList.add('visible'); $('resultTitle').textContent = title; $('resultSubtitle').textContent = subtitle;
      $('resultBody').innerHTML = '<div class="' + (error ? 'result-error' : 'empty') + '">' + escapeHTML(body) + '</div>';
    }
    async function ensureYNXTestnet(provider) {
      const expected = walletConfig?.chainIdHex || '0x1917';
      const initial = await provider.request({method:'eth_chainId'});
      if (initial !== expected) { try { await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:expected}]}); } catch (error) { if (error?.code !== 4902) throw error; await provider.request({method:'wallet_addEthereumChain',params:[{chainId:expected,chainName:walletConfig.chainName,nativeCurrency:{name:walletConfig.nativeCurrencyName,symbol:walletConfig.nativeSymbol,decimals:walletConfig.decimals},rpcUrls:walletConfig.rpcUrls,blockExplorerUrls:walletConfig.blockExplorerUrls}]}); await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:expected}]}); } }
      if (await provider.request({method:'eth_chainId'}) !== expected) throw new Error('Wallet did not select YNX Testnet (0x1917).');
    }
    function attachWalletLifecycle(wallet, account) {
      const clear = message => { connectedWallet = null; showWalletResult(t('unavailable'),t('identityTitle'),message,false); };
      wallet.provider.on?.('accountsChanged', accounts => { if (!Array.isArray(accounts) || !accounts.some(value => typeof value === 'string' && value.toLowerCase() === account.toLowerCase())) clear(t('unavailable')); });
      wallet.provider.on?.('chainChanged', chainId => { if (chainId !== (walletConfig?.chainIdHex || '0x1917')) clear(t('unavailable')); });
      wallet.provider.on?.('disconnect', () => clear(t('unavailable')));
    }
    async function connectWallet(id) {
      const wallet = walletProviders.get(id);
      if (!wallet) return showWalletResult(t('unavailable'),t('openMetamask'),t('unavailable'),true);
      if (!walletConfig) await load();
      try { const accounts = await wallet.provider.request({method:'eth_requestAccounts'}); const account = Array.isArray(accounts) && typeof accounts[0] === 'string' && /^0x[0-9a-f]{40}$/i.test(accounts[0]) ? accounts[0] : ''; if (!account) throw new Error('Wallet did not return an EVM account.'); await ensureYNXTestnet(wallet.provider); connectedWallet = {id:wallet.id,account}; attachWalletLifecycle(wallet,account); showWalletResult(t('openMetamask'),wallet.name + ' · 0x1917',compact(account,10,8),false); }
      catch (error) { showWalletResult(t('unavailable'),t('openMetamask'),error?.code === 4001 ? t('unavailable') : String(error?.message || t('unavailable')),true); }
    }
    function chooseWallet() {
      if (!walletProviders.size) return showWalletResult(t('unavailable'),t('openMetamask'),t('unavailable'),true);
      $('resultPanel').classList.add('visible'); $('resultTitle').textContent = t('openMetamask'); $('resultSubtitle').textContent = t('identityTitle');
      $('resultBody').innerHTML = [...walletProviders.values()].map(wallet => '<button class="wallet-button" type="button" data-wallet-provider="' + escapeHTML(wallet.id) + '">' + (wallet.icon ? '<img src="' + escapeHTML(wallet.icon) + '" alt="" width="20" height="20">' : '') + 'Connect ' + escapeHTML(wallet.name) + '</button>').join('');
    }
    function removeSkeletons() { document.querySelectorAll('.skeleton').forEach(node => node.classList.remove('skeleton')); }
    function blockRow(block,index = 0) {
      const txs = (block.transactions || []).length;
      const isNew = index === 0 && previousHeight && Number(block.height) > previousHeight;
	  return '<button class="live-row block-live-row' + (txs === 0 ? ' empty-block-row' : '') + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><span class="row-icon">BK</span><span><span class="row-title"><span class="link mono">#' + escapeHTML(number(block.height)) + '</span><span class="type-tag">' + escapeHTML(t(txs === 0 ? 'emptyBlock' : 'finalized')) + '</span></span><span class="row-subtitle"><span class="mono hash" title="' + escapeHTML(block.hash) + '">' + escapeHTML(compact(block.hash,14,9)) + '</span></span></span><span class="row-side"><strong>' + escapeHTML(number(txs)) + ' ' + escapeHTML(t('txUnit')) + '</strong><span title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</span></span></button>';
    }
    function txRow(tx,index = 0) {
      const isNew = index === 0 && previousTxHash && tx.hash !== previousTxHash;
      const destination = tx.sponsor || tx.to;
      const route = '<span class="transfer-flow"><span class="mono address-chip" data-account="' + escapeHTML(tx.from) + '" title="' + escapeHTML(t('from')) + ' ' + escapeHTML(tx.from) + '">' + escapeHTML(compact(tx.from,8,6)) + '</span><span class="flow-arrow" aria-label="' + escapeHTML(t('sentTo')) + '"></span><span class="mono address-chip" data-account="' + escapeHTML(destination) + '" title="' + escapeHTML(t('to')) + ' ' + escapeHTML(destination) + '">' + escapeHTML(compact(destination,8,6)) + '</span></span>';
      const value = tx.resourceConsumed ? escapeHTML(number(tx.resourceConsumed)) + ' ' + escapeHTML(String(tx.resourceType || 'resource').replaceAll('_',' ')) : escapeHTML(number(tx.amount)) + ' YNXT';
      const cost = tx.sponsor ? escapeHTML(t('pool')) + ' ' + escapeHTML(compact(tx.sponsorPoolId,8,5)) : escapeHTML(t('fee')) + ' ' + escapeHTML(number(tx.fee));
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
	  $('txsBody').innerHTML = filtered.length ? filtered.slice(0,transactionDisplayLimit).map(txRow).join('') : '<div class="empty">' + escapeHTML(t('noMatching')) + '</div>';
	  $('olderTransactions').hidden = !transactionCursor;
      bindQueries();
    }
    function renderBlockTrack(blocks,incomingHeight) {
	  $('finalityState').textContent = blocks.length ? t('latestBlock') + ' #' + number(blocks[0].height) : t('waitingLatest');
      $('blockTrack').innerHTML = blocks.slice(0,8).map((block,index) => {
        const arrived = index === 0 && previousHeight && incomingHeight > previousHeight;
        const txs = (block.transactions || []).length;
		return '<button class="block-chip' + (txs === 0 ? ' empty-block' : '') + (arrived ? ' new' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><strong class="mono">#' + escapeHTML(number(block.height)) + '</strong><span>' + (txs === 0 ? escapeHTML(t('emptyBlock')) : escapeHTML(number(txs)) + ' ' + escapeHTML(t('txUnit'))) + ' / ' + escapeHTML(relativeTime(block.time)) + '</span></button>';
	  }).join('') || '<div class="empty">' + escapeHTML(t('unavailable')) + '</div>';
    }
    function renderIntelligence(validatorData, resources) {
      const validators = Array.isArray(validatorData) ? validatorData : (validatorData?.validators || []);
      $('validatorsBody').innerHTML = validators.length ? validators.map(validator => {
        const ready = Boolean(validator.peerReady || validator.active);
        const status = validator.peerStatus || (ready ? 'active' : 'not ready');
        return '<tr><td><strong>' + escapeHTML(validator.moniker || compact(validator.address)) + '</strong><span class="mono hash muted" title="' + escapeHTML(validator.address) + '">' + escapeHTML(compact(validator.address,12,7)) + '</span></td><td>' + escapeHTML(validator.role || 'validator') + '</td><td><span class="validator-state' + (ready ? '' : ' offline') + '">' + escapeHTML(status) + '</span></td><td class="mono">' + escapeHTML(number(validator.votingPower)) + '</td><td class="mono">' + escapeHTML(number(validator.latestHeight)) + '</td></tr>';
	  }).join('') : '<tr><td colspan="5" class="empty">' + escapeHTML(t('unavailable')) + '</td></tr>';
      if (!resources || typeof resources !== 'object' || !Object.keys(resources).length) {
		$('resourceMetrics').innerHTML = '<article class="resource-item"><small>' + escapeHTML(t('unavailable')) + '</small></article>';
        $('resourcePolicy').innerHTML = '';
        return;
      }
      const resourceItems = [
		[t('delegatedYnxt'),resources.delegatedYnxt],
		[t('rentalVolume'),resources.rentalVolumeYnxt],
		[t('providerIncome'),resources.providerIncomeYnxt],
		[t('protocolFees'),resources.protocolFeeYnxt]
      ];
      $('resourceMetrics').innerHTML = resourceItems.map(([label,value]) => '<article class="resource-item"><small>' + escapeHTML(label) + '</small><strong>' + escapeHTML(number(value)) + '</strong><small>YNXT</small></article>').join('');
	  $('resourcePolicy').innerHTML = '<span>' + escapeHTML(t('policy')) + ' <strong>' + escapeHTML(resources.policyVersion || '--') + '</strong></span><span>' + escapeHTML(t('activeDelegations')) + ' <strong>' + escapeHTML(number(resources.activeDelegationCount)) + '</strong></span><span>' + escapeHTML(t('rentals')) + ' <strong>' + escapeHTML(number(resources.resourceRentalCount)) + '</strong></span><span>' + escapeHTML(t('evidence')) + ' <strong class="mono">' + escapeHTML(compact(resources.policyHash,10,7)) + '</strong></span>';
    }
    function renderAccounts(leaderboard) {
      const accounts = leaderboard?.accounts || [];
	  if (leaderboard?.failed) {
		$('accountTotal').textContent = t('unavailable');
		$('accountsBody').innerHTML = '<tr><td colspan="5" class="empty">' + escapeHTML(t('unavailable')) + '</td></tr>';
		return;
	  }
      const observed = leaderboard?.truthfulStatus === 'observed-indexed-participant-account-ranking';
	  $('accountTotal').textContent = number(leaderboard?.total || accounts.length) + ' ' + t(observed ? 'observedAccounts' : 'publicAccounts') + ' / ' + number(accounts.length) + ' · ' + exactTime(leaderboard?.checkedAt);
	  $('accountsBody').innerHTML = accounts.length ? accounts.map((account,index) => '<tr data-query="' + escapeHTML(account.address) + '"><td><strong>#' + (index + 1) + '</strong></td><td><span class="link mono hash" title="' + escapeHTML(account.address) + '">' + escapeHTML(account.address) + '</span></td><td class="amount">' + escapeHTML(number(account.balance)) + ' YNXT</td><td>' + escapeHTML(number(account.staked)) + ' YNXT</td><td class="mono">' + escapeHTML(number(account.nonce)) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">' + escapeHTML(t('noBalances')) + '</td></tr>';
      bindQueries();
    }
    function mergeLiveRows(incoming, accumulated, identity) {
      const seen = new Set(incoming.map(identity));
      return [...incoming, ...accumulated.filter(row => !seen.has(identity(row)))];
    }
    function canonicalHistoryChanged(incoming, accumulated) {
      const known = new Map(accumulated.map(block => [String(block.height), String(block.hash || '')]));
      return incoming.some(block => known.has(String(block.height)) && known.get(String(block.height)) !== String(block.hash || ''));
    }
    function bindQueries() {
      document.querySelectorAll('[data-query]').forEach(node => node.onclick = () => search(node.dataset.query));
      document.querySelectorAll('[data-account]').forEach(node => node.onclick = event => { event.preventDefault(); event.stopPropagation(); search(node.dataset.account); });
    }
    function renderDashboard(summary, blocks, transactions, validatorData, resources, sourceKey = 'live') {
      const windowStats = calculateWindow(blocks);
      const incomingHeight = Number(summary.rpcHeight || 0);
      walletConfig = summary.wallet;
	  latestBlocks = blocks;
      latestTransactions = transactions;
      $('networkName').textContent = summary.network.name || 'YNX Testnet';
      $('rpcHeight').textContent = number(summary.rpcHeight);
      $('networkTps').textContent = windowStats.tps.toFixed(2);
      $('blockTime').textContent = windowStats.blockTime.toFixed(1) + 's';
      $('txCount').textContent = number(summary.indexedTxCount);
      $('validatorCount').textContent = number(summary.validatorCount);
	  $('syncValue').textContent = number(summary.syncLagBlocks) + ' ' + t('blockUnit');
      $('syncState').textContent = summary.syncLagBlocks === 0 ? t('fullySynced') : t('catchingUp');
      $('syncState').className = 'metric-foot' + (summary.syncLagBlocks === 0 ? ' good' : '');
      $('blockAge').textContent = relativeTime(summary.latestBlockTime);
      $('chainId').textContent = summary.network.chainId + ' / ' + summary.wallet.chainIdHex;
      const nativeName = summary.network.nativeCoinName || 'YNX Token';
      $('nativeCoin').textContent = nativeName === 'YNXT' ? 'YNXT' : nativeName + ' (YNXT)';
      $('latestHash').textContent = compact(summary.latestBlockHash,12,9);
      $('latestHash').title = summary.latestBlockHash || '';
      $('truthState').textContent = summary.truthfulStatus === 'rpc-and-indexer-backed' ? 'RPC + Indexer' : summary.truthfulStatus;
	  $('lastUpdated').textContent = new Date(summary.lastCheckedAt).toLocaleTimeString(language, {hour:'2-digit',minute:'2-digit',second:'2-digit'});
	  $('heroHeight').textContent = t('latestBlock') + ' #' + number(summary.rpcHeight) + ' / ' + t('indexerSync') + ' ' + number(summary.syncLagBlocks) + ' ' + t('blockUnit');
      document.title = 'Block ' + number(summary.rpcHeight) + ' | YNX Chain Explorer';
	  $('blocksBody').innerHTML = blocks.length ? blocks.slice(0,blockDisplayLimit).map(blockRow).join('') : '<div class="empty">' + escapeHTML(t('unavailable')) + '</div>';
	  $('olderBlocks').hidden = !blockCursor;
      renderTransactions();
      renderBlockTrack(blocks,incomingHeight);
      renderIntelligence(validatorData, resources);
      bindQueries();
      $('statusText').textContent = summary.ok ? t('operational') : t('degraded');
	  $('statusDetail').textContent = summary.ok ? t(sourceKey) + ' / ' + t('rpcResponding') : t('unavailable');
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
      const [snapshot, leaderboard] = await Promise.all([
        get('/api/dashboard'),
		get('/api/accounts?limit=10').catch(() => ({accounts:[],total:0,failed:true}))
      ]);
	  blockCursor = '';
	  transactionCursor = '';
	  renderDashboard(snapshot.summary, snapshot.blocks || [], snapshot.transactions || [], snapshot.validators || {}, snapshot.resources || {}, 'shared-live-snapshot');
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
		$('streamClockText').textContent = t('live');
      };
	  eventSource.addEventListener('dashboard', event => {
        try {
          const snapshot = JSON.parse(event.data);
          lastStreamAt = Date.now();
		  if (canonicalHistoryChanged(snapshot.blocks || [], latestBlocks)) {
			blockDisplayLimit = 5;
			transactionDisplayLimit = 5;
			load().then(stopFallbackPolling).catch(showLoadError);
			return;
		  }
		  const blocks = mergeLiveRows(snapshot.blocks || [], latestBlocks, block => String(block.height));
		  const transactions = mergeLiveRows(snapshot.transactions || [], latestTransactions, tx => tx.hash);
		  renderDashboard(snapshot.summary, blocks, transactions, snapshot.validators, snapshot.resources, 'live');
          stopFallbackPolling();
        } catch (error) { showLoadError(error); }
      });
	  eventSource.addEventListener('upstream-error', event => {
		try { showLoadError(new Error(JSON.parse(event.data).message || t('unavailable'))); } catch (_) { showLoadError(new Error(t('unavailable'))); }
      });
      eventSource.onerror = () => {
		$('statusText').textContent = t('reconnecting');
		$('statusDetail').textContent = t('fallback');
        $('status').className = 'status-bar warn';
        $('streamClock').className = 'stream-clock stale';
		$('streamClockText').textContent = t('reconnecting');
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
	  if (type === 'block') return [[t('observedHeight'),'#' + number(detail.height)],[t('latestTransactions'),(detail.transactions || []).length],[t('validator'),compact(detail.validator,10,7)]];
	  if (type === 'transaction' && detail.sponsor) return [[t('navResources'),number(detail.resourceConsumed) + ' ' + String(detail.resourceType || t('units')).replaceAll('_',' ')],[t('sponsor'),compact(detail.sponsor,10,7)],[t('pool'),compact(detail.sponsorPoolId,10,7)]];
	  if (type === 'transaction') return [[t('amount'),number(detail.amount) + ' YNXT'],[t('fee'),number(detail.fee) + ' YNXT'],[t('latestBlock'),'#' + number(detail.blockNumber)]];
	  if (type === 'account') return [[t('address'),compact(detail.addressFormats?.ynxAddress || detail.account?.address,14,10)],[t('balance'),number(detail.account?.balance) + ' YNXT'],[t('staked'),number(detail.account?.staked) + ' YNXT'],[t('nonce'),number(detail.account?.nonce)]];
	  if (type === 'token') return [[t('symbol'),detail.symbol],[t('decimals'),number(detail.decimals)],[t('networkDetails'),detail.network?.name || '--']];
	  if (type === 'contract') return [[t('name'),detail.name || '--'],[t('verified'),detail.verified ? t('yes') : t('no')],[t('runtime'),detail.runtimeMode || '--']];
      return [];
    }
    function detailRows(type,detail) {
	  if (type === 'transaction') return [[t('status'),detail.status],[t('from'),detail.from || t('unavailable')],[t('to'),detail.to || t('unavailable')],[t('amount'),number(detail.amount) + ' YNXT'],[t('fee'),number(detail.gas?.feeYnxt ?? detail.fee) + ' YNXT'],[t('latestBlock'),'#' + number(detail.blockNumber)],[t('hash'),detail.blockHash],[t('time'),exactTime(detail.timestamp)],[t('nonce'),number(detail.nonce)],[t('events'),(detail.events || []).length ? JSON.stringify(detail.events) : t('none')],[t('type'),detail.type]];
	  if (type === 'block') return [[t('observedHeight'),'#' + number(detail.height)],[t('hash'),detail.hash],[t('parentHash'),detail.parentHash],[t('validator'),detail.validator],[t('time'),exactTime(detail.time)],[t('latestTransactions'),(detail.transactions || []).length]];
	  if (type === 'contract') return [[t('address'),detail.address],[t('deployer'),detail.deployer],[t('name'),detail.name],[t('sourceHash'),detail.sourceHash],[t('bytecodeHash'),detail.deployedBytecodeHash],[t('compiler'),detail.compiler?.version || detail.compilerMode],[t('verified'),detail.verified ? t('yes') : t('no')],[t('functions'),(detail.functions || []).length],[t('events'),(detail.events || []).length],[t('deployedAt'),exactTime(detail.deployedAt)]];
	  if (type === 'token') return [[t('symbol'),detail.symbol],[t('name'),detail.name],[t('type'),detail.type],[t('decimals'),detail.decimals],[t('networkDetails'),detail.network?.name],[t('usage'),(detail.usage || []).join(', ')],[t('sourceStatus'),detail.truthfulStatus]];
	  if (type !== 'account') return flatten(detail);
	  return [[t('address'),detail.addressFormats?.ynxAddress || detail.account?.address || t('unavailable')],[t('evmAddress'),detail.addressFormats?.evmAddress || detail.account?.address || t('unavailable')],[t('liquidBalance'),number(detail.account?.balance) + ' YNXT'],[t('staked'),number(detail.account?.staked) + ' YNXT'],[t('nonce'),number(detail.account?.nonce)],[t('indexedCoverage'),t('throughBlock') + ' #' + number(detail.activity?.lastIndexedHeight)],[t('indexedActivity'),(detail.activity?.transactions || []).map(tx => tx.hash + ' / ' + tx.type + ' / ' + number(tx.amount) + ' YNXT').join('\n') || t('none')],[t('contractActivity'),number(detail.activity?.contractActivityCount)],[t('dataCheckedAt'),exactTime(detail.activity?.checkedAt)]];
    }
	function detailExtra(type,detail) {
	  let html = '';
	  if (type === 'account' && detail.activity?.fundsFlow) {
		const flow = detail.activity.fundsFlow;
		const maxFlow = Math.max(1,Number(flow.inboundYnxt || 0),Number(flow.outboundYnxt || 0));
		html += '<section class="flow-visual" aria-label="' + escapeHTML(t('fundsFlow')) + '"><h3>' + escapeHTML(t('fundsFlow')) + '</h3><div class="flow-line"><span>' + escapeHTML(t('incoming')) + '</span><span class="flow-meter"><span style="width:' + Math.round(Number(flow.inboundYnxt || 0) / maxFlow * 100) + '%"></span></span><strong>' + escapeHTML(number(flow.inboundYnxt)) + ' YNXT</strong></div><div class="flow-line out"><span>' + escapeHTML(t('outgoing')) + '</span><span class="flow-meter"><span style="width:' + Math.round(Number(flow.outboundYnxt || 0) / maxFlow * 100) + '%"></span></span><strong>' + escapeHTML(number(flow.outboundYnxt)) + ' YNXT</strong></div></section>';
		if (detail.activity.nextCursor) html += '<div class="detail-notice"><button class="refresh" type="button" data-activity-cursor="' + escapeHTML(detail.activity.nextCursor) + '">' + escapeHTML(t('loadOlderActivity')) + '</button></div>';
	  }
	  if (type === 'block') html += '<p class="detail-notice">' + escapeHTML(t('historical')) + ' ' + escapeHTML(t('economics')) + '</p>';
	  if (type === 'transaction' && detail.historicalNotice) html += '<p class="detail-notice">' + escapeHTML(t('historical')) + '</p>';
	  return html;
	}
    function showDrawer(type,query,detail) {
	  currentDetailType = type; currentDetailQuery = query; currentDetail = detail;
      const title = type.charAt(0).toUpperCase() + type.slice(1);
	  const typeLabels = {block:t('latestBlock'),transaction:t('latestTransactions'),account:t('navAccounts'),token:t('nativeCoin'),contract:t('contract')};
	  $('detailKicker').textContent = t('live') + ' · ' + (typeLabels[type] || title);
	  $('detailTitle').textContent = type === 'account' ? compact(detail.addressFormats?.ynxAddress || query,18,12) : (typeLabels[type] || title);
      const stats = detailStats(type,detail);
      const summary = stats.length ? '<div class="detail-summary">' + stats.map(([label,value]) => '<div class="detail-stat"><span>' + escapeHTML(label) + '</span><strong class="mono">' + escapeHTML(value) + '</strong></div>').join('') + '</div>' : '';
      const rows = detailRows(type,detail).map(([key,value]) => {
        const text = String(value ?? '');
		const copy = text.length > 10 ? '<button class="copy-button" type="button" data-copy="' + encodeURIComponent(text) + '" aria-label="' + escapeHTML(t('copied')) + '">' + escapeHTML(t('copied')) + '</button>' : '';
        return '<div class="detail-row"><dt>' + escapeHTML(key) + '</dt><dd class="mono">' + escapeHTML(text) + '</dd>' + copy + '</div>';
      }).join('');
	  $('detailContent').innerHTML = summary + detailExtra(type,detail) + '<dl class="detail-body">' + rows + '</dl>';
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
	function transactionHashFromPath() {
	  const match = window.location.pathname.match(/^\/tx\/(0[xX][0-9a-fA-F]{64})$/);
	  return match ? match[1].toLowerCase() : '';
	}
	async function search(query,updateHistory = true) {
      const q = String(query || $('searchInput').value).trim();
      if (!q) return;
      $('searchInput').value = q;
	  $('detailKicker').textContent = t('search');
      $('detailTitle').textContent = compact(q,18,10);
	  $('detailContent').innerHTML = '<div class="empty">' + escapeHTML(t('readingState')) + '</div>';
      $('detailBackdrop').classList.add('visible');
      $('detailBackdrop').setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
      try {
        const resolved = await get('/api/search?q=' + encodeURIComponent(q));
        const detail = await get(resolved.path);
        showDrawer(resolved.type,q,detail);
		if (updateHistory && resolved.deepLink) history.pushState({query:q},'',resolved.deepLink);
      } catch (error) {
		$('detailKicker').textContent = t('searchResult');
		$('detailTitle').textContent = t('unavailable');
		$('detailContent').innerHTML = '<div class="result-error">' + escapeHTML(t('unavailable')) + '</div>';
      }
    }
    $('searchForm').onsubmit = event => { event.preventDefault(); search(); };
    $('resultClose').onclick = () => $('resultPanel').classList.remove('visible');
    $('detailClose').onclick = closeDrawer;
    $('detailBackdrop').onclick = event => { if (event.target === $('detailBackdrop')) closeDrawer(); };
    $('detailContent').onclick = async event => {
	  const pageButton = event.target.closest('[data-activity-cursor]');
	  if (pageButton && currentDetailType === 'account') {
		pageButton.disabled = true;
		try {
		  const address = currentDetail.account?.address || currentDetailQuery;
		  const next = await get('/api/accounts/' + encodeURIComponent(address) + '/activity?limit=25&cursor=' + encodeURIComponent(pageButton.dataset.activityCursor));
		  const previousFlow = currentDetail.activity.fundsFlow || {};
		  const nextFlow = next.fundsFlow || {};
		  currentDetail.activity = {
			...currentDetail.activity,
			...next,
			transactions: [...(currentDetail.activity.transactions || []),...(next.transactions || [])],
			contractActivityCount: Number(currentDetail.activity.contractActivityCount || 0) + Number(next.contractActivityCount || 0),
			fundsFlow: {
			  inboundYnxt: Number(previousFlow.inboundYnxt || 0) + Number(nextFlow.inboundYnxt || 0),
			  outboundYnxt: Number(previousFlow.outboundYnxt || 0) + Number(nextFlow.outboundYnxt || 0)
			}
		  };
		  showDrawer('account',currentDetailQuery,currentDetail);
		} catch (_) { showToast(t('unavailable')); pageButton.disabled = false; }
		return;
	  }
      const button = event.target.closest('[data-copy]');
      if (!button) return;
	  try { await navigator.clipboard.writeText(decodeURIComponent(button.dataset.copy)); showToast(t('copied')); }
	  catch (_) { showToast(t('unavailable')); }
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
	$('olderBlocks').onclick = async () => {
	  if (!blockCursor) return;
	  $('olderBlocks').disabled = true;
	  try {
		const page = await get('/api/blocks/latest?limit=25&cursor=' + encodeURIComponent(blockCursor));
		const known = new Set(latestBlocks.map(block => String(block.height)));
		latestBlocks.push(...(page.blocks || []).filter(block => !known.has(String(block.height))));
		blockCursor = page.nextCursor || '';
		blockDisplayLimit = latestBlocks.length;
		$('blocksBody').innerHTML = latestBlocks.map(blockRow).join('');
		$('olderBlocks').hidden = !blockCursor;
		bindQueries();
	  } catch (_) { showToast(t('unavailable')); }
	  $('olderBlocks').disabled = false;
	};
	$('olderTransactions').onclick = async () => {
	  if (!transactionCursor) return;
	  $('olderTransactions').disabled = true;
	  try {
		const page = await get('/api/txs?limit=25&cursor=' + encodeURIComponent(transactionCursor));
		const known = new Set(latestTransactions.map(tx => tx.hash));
		latestTransactions.push(...(page.transactions || []).filter(tx => !known.has(tx.hash)));
		transactionCursor = page.nextCursor || '';
		transactionDisplayLimit = latestTransactions.length;
		renderTransactions();
	  } catch (_) { showToast(t('unavailable')); }
	  $('olderTransactions').disabled = false;
	};
    document.querySelectorAll('[data-refresh]').forEach(button => button.onclick = () => load().catch(showLoadError));
	$('metamaskButton').onclick = chooseWallet;
	$('resultBody').onclick = event => { const button = event.target.closest('[data-wallet-provider]'); if (button) void connectWallet(button.dataset.walletProvider); };
	function showLoadError() { $('statusText').textContent = t('degraded'); $('statusDetail').textContent = t('unavailable'); $('status').className = 'status-bar warn'; $('refreshButton').disabled = false; removeSkeletons(); }
    applyLanguage(language);
    load().catch(showLoadError).finally(openDeepLink);
    connectLiveStream();
    window.setInterval(() => {
      if (!lastStreamAt) return;
      const age = Math.floor((Date.now() - lastStreamAt) / 1000);
      $('streamClock').className = 'stream-clock ' + (age < 8 ? 'live' : 'stale');
	  $('streamClockText').textContent = age < 2 ? t('live') : (age < 8 ? relativeTime(new Date(lastStreamAt)) : staleStreamMessage(age));
    },1000);
    document.addEventListener('keydown',event => { if (event.key === 'Escape') closeDrawer(); });
    document.addEventListener('visibilitychange',() => { if (!document.hidden) load().catch(showLoadError); });
	window.addEventListener('popstate',() => openDeepLink());
	async function openDeepLink() {
	  const canonicalTransaction = transactionHashFromPath();
	  if (canonicalTransaction) { await search(canonicalTransaction,false); return; }
	  const match = location.pathname.match(/^\/(block|tx|address|token|contract)\/(.+)$/);
	  if (!match) return;
	  const aliases = {tx:'transaction',address:'account'};
	  const type = aliases[match[1]] || match[1];
	  const query = decodeURIComponent(match[2]);
	  const endpoints = {block:'/api/blocks/',transaction:'/api/txs/',account:'/api/accounts/',token:'/api/tokens/',contract:'/api/contracts/'};
	  try { showDrawer(type,query,await get(endpoints[type] + encodeURIComponent(query))); } catch (_) { showLoadError(); }
	}
  </script>
</body>
</html>`
