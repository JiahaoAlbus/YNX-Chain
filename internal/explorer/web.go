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

    /* Public-portal presentation: dense explorer hierarchy, expressed in YNX's own brand. */
    :root { --page:#f3f5f9; --surface:#fff; --surface-alt:#f8f9fc; --ink:#151820; --muted:#747b8a; --faint:#98a0ae; --line:#e6e9f0; --line-soft:#edf0f5; --blue:#002fa7; --blue-dark:#00227b; --blue-soft:#edf2ff; --shadow:0 1px 3px rgba(24,42,82,.04); }
    body { background:var(--page); font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; }
    .shell { width:min(1430px,calc(100% - 48px)); }
    .nav { position:relative; height:64px; background:rgba(255,255,255,.96); border-bottom:1px solid var(--line); backdrop-filter:none; }
    .nav-inner { gap:28px; }
    .brand { gap:9px; font-size:15px; font-weight:760; letter-spacing:-.2px; }
    .brand-logo { width:30px; height:30px; max-width:30px; }
    .nav-links { gap:0; margin-left:0; font-size:14px; color:#242833; }
    .nav-links a,.nav-links button { display:inline-flex; align-items:center; height:64px; padding:0 16px; border:0; border-bottom:3px solid transparent; color:inherit; background:transparent; font:inherit; white-space:nowrap; }
    .nav-links a:hover,.nav-links a:focus-visible,.nav-links button:hover,.nav-links button:focus-visible { color:var(--blue); border-bottom-color:var(--blue); outline:0; }
    .nav-actions { display:flex; align-items:center; gap:14px; margin-left:auto; color:#555d69; font-size:13px; white-space:nowrap; }
    .nav-actions a { color:inherit; }
    .nav-actions a:hover { color:var(--blue); }
    .wallet-connect { height:36px; padding:0 14px; border:0; border-radius:5px; color:#fff; background:#151820; font-size:13px; font-weight:700; }
    .wallet-connect:hover { background:var(--blue); }
    .network-pill { display:none; }
    .language-select { height:32px; padding-left:8px; border-color:var(--line); background:#fff; }
    .more-wrap { position:relative; }
    .nav-menu { position:relative; display:inline-flex; }
    .more-popover { position:absolute; top:53px; right:0; display:none; width:210px; padding:8px; border:1px solid var(--line); border-radius:8px; background:#fff; box-shadow:0 14px 32px rgba(18,34,64,.12); }
    .more-wrap.open .more-popover { display:grid; }
    .nav-menu .more-popover { left:0; right:auto; top:53px; width:248px; }
    .nav-menu:hover .more-popover,.nav-menu:focus-within .more-popover { display:grid; }
    .more-popover a { height:auto; padding:10px 11px; border:0; border-radius:5px; font-size:13px; }
    .more-popover a:hover { background:var(--blue-soft); }
    .announcement { min-height:38px; border-bottom:1px solid #e9edf4; background:#fafbfe; }
    .announcement .shell { display:flex; align-items:center; justify-content:center; min-height:38px; gap:9px; color:#616978; font-size:13px; }
    .announcement strong { color:#303846; font-weight:650; }
    .announcement a { color:var(--blue); font-weight:650; }
    .announcement-dot { width:6px; height:6px; border-radius:50%; background:var(--blue); }
    .hero { padding:22px 0 16px; background:var(--page); border:0; }
    .hero-grid { display:grid; grid-template-columns:minmax(0,1fr) 390px; gap:22px; align-items:stretch; }
    .hero-copy,.eyebrow,.hero h1 { display:none; }
    .search { max-width:none; min-height:58px; }
    .search-wrap { position:relative; }
    .search input { height:58px; padding:0 144px 0 48px; border:1px solid #e5e8ee; border-radius:7px; background:#fff; box-shadow:none; font-size:16px; }
    .search::before { content:""; position:absolute; left:19px; width:14px; height:14px; border:2px solid #7b8492; border-radius:50%; }
    .search::after { content:""; position:absolute; left:32px; top:35px; width:7px; height:2px; background:#7b8492; transform:rotate(45deg); }
    .search button { right:6px; height:44px; padding:0 18px; border-radius:5px; background:var(--blue); }
    .search-suggestions { position:absolute; z-index:20; top:64px; right:0; left:0; display:grid; gap:2px; padding:7px; border:1px solid var(--line); border-radius:7px; background:#fff; box-shadow:0 15px 36px rgba(18,34,64,.14); }
    .search-suggestions[hidden] { display:none; }
    .search-suggestions button { position:static; display:flex; align-items:center; justify-content:space-between; width:100%; height:auto; min-height:38px; padding:8px 10px; border:0; border-radius:5px; color:var(--ink); background:#fff; font-size:12px; font-weight:500; text-align:left; }
    .search-suggestions button:hover,.search-suggestions button:focus-visible { color:var(--blue); background:var(--blue-soft); outline:0; }
    .search-suggestions small { color:var(--muted); font-size:11px; }
    .hero-meta { display:none; }
    .trending { display:flex; flex-wrap:wrap; align-items:center; gap:8px 20px; margin-top:12px; color:#5f6876; font-size:13px; }
    .trending-label { color:#4b5360; font-weight:650; }
    .trending button { padding:0; border:0; color:#5f6876; background:transparent; font:inherit; }
    .trending button:hover { color:var(--blue); text-decoration:underline; }
    .portal-callout { display:flex; flex-direction:column; justify-content:space-between; min-height:112px; padding:18px 20px; border:1px solid #dce5ff; border-radius:7px; color:#fff; background:var(--blue); }
    .portal-callout p { margin:0; color:#bfd0ff; font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
    .portal-callout h2 { max-width:280px; margin:7px 0 15px; font-size:19px; line-height:1.18; letter-spacing:-.3px; }
    .portal-callout-links { display:flex; flex-wrap:wrap; gap:9px; }
    .portal-callout-links a { padding:6px 9px; border:1px solid rgba(255,255,255,.34); border-radius:4px; color:#fff; font-size:12px; }
    .portal-callout-links a:hover { background:#fff; color:var(--blue); }
    .portal-callout-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; margin:13px 0 14px; }
    .portal-callout-stats span { display:block; padding:7px 8px; border:1px solid rgba(255,255,255,.18); border-radius:4px; background:rgba(0,25,100,.16); }
    .portal-callout-stats small,.portal-callout-stats strong { display:block; }
    .portal-callout-stats small { color:#bfd0ff; font-size:9px; letter-spacing:.04em; text-transform:uppercase; }
    .portal-callout-stats strong { margin-top:3px; color:#fff; font-size:12px; font-weight:750; }
    main { padding:0 0 64px; }
    .status-bar { min-height:30px; margin-bottom:10px; padding:0 2px; }
    .status-bar .state { padding:5px 8px; border-radius:4px; font-size:12px; }
    .network-summary { display:grid; grid-template-columns:minmax(0,2fr) minmax(300px,.95fr); gap:22px; margin:0 0 20px; }
    .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); gap:0; margin:0; border:1px solid var(--line); border-radius:7px; background:#fff; overflow:hidden; }
    .metric { min-height:112px; padding:21px 22px; border:0; border-right:1px solid var(--line); border-bottom:1px solid var(--line); border-radius:0; box-shadow:none; }
    .metric:nth-child(2n) { border-right:0; }
    .metric:nth-child(n+5) { display:none; border-bottom:0; }
    .metric:hover { background:#fafcff; }
    .metric-label { color:#9299a5; font-size:14px; }
    .metric-value { margin-top:7px; color:#1d2028; font-size:25px; font-weight:750; letter-spacing:-.45px; }
    .metric-foot { margin-top:8px; font-size:12px; }
    .asset-overview { display:grid; grid-template-rows:auto 1fr; min-height:226px; border:1px solid var(--line); border-radius:7px; background:#fff; overflow:hidden; }
    .asset-overview-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 20px; border-bottom:1px solid var(--line); }
    .asset-token { display:flex; align-items:center; gap:10px; }
    .asset-token img { width:34px; height:34px; object-fit:contain; }
    .asset-token strong { display:block; color:#1d2028; font-size:16px; }
    .asset-token small,.asset-overview-head small { display:block; margin-top:3px; color:var(--muted); font-size:11px; }
    .asset-overview-body { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0; padding:0; }
    .asset-fact { min-height:73px; padding:13px 15px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
    .asset-fact:nth-child(2n) { border-right:0; }
    .asset-fact:nth-child(n+3) { border-bottom:0; }
    .asset-fact span { display:block; color:#8b94a2; font-size:11px; }
    .asset-fact strong { display:block; margin-top:6px; color:#303846; font-size:14px; overflow-wrap:anywhere; }
    .asset-fact small { display:block; margin-top:3px; color:#657184; font-size:10px; }
    .block-ribbon { display:block; min-height:0; margin:0 0 25px; border:0; border-radius:0; background:transparent; overflow:visible; }
    .ribbon-label { display:flex; flex-direction:row; align-items:baseline; justify-content:space-between; padding:0 0 12px; border:0; color:#1d2028; font-size:21px; font-weight:750; }
    .ribbon-label span { display:none; }
    .ribbon-label strong { display:flex; width:100%; align-items:center; justify-content:space-between; color:#1d2028; font-size:0; }
    .ribbon-label strong::before { content:"Blocks"; font-size:21px; }
    .ribbon-label strong::after { content:"More"; color:#596271; font-size:13px; font-weight:500; }
    .block-track { gap:16px; overflow:visible; }
    .block-chip { flex:1 1 0; min-height:128px; padding:18px 19px; border:1px solid var(--line); border-radius:7px; background:#fff; box-shadow:none; text-align:left; }
    .block-chip:hover { border-color:#b9c9fb; background:#fff; }
    .block-chip strong { color:#1c2028; font-size:17px; }
    .block-chip span { margin-top:9px; font-size:12px; }
    .block-chip .block-chip-meta { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:16px; padding-top:10px; border-top:1px solid var(--line-soft); color:#697586; }
    .block-chip .block-chip-meta b { color:#303846; font-size:11px; font-weight:750; }
    .block-chip .block-chip-meta em { color:#7a8594; font-size:11px; font-style:normal; }
    .overview { grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr); gap:16px; margin:0 0 30px; }
    .overview .network-facts-panel { display:none; }
    .panel { border-color:var(--line); border-radius:7px; box-shadow:none; }
    .overview .panel-head { min-height:66px; padding:17px 20px 13px; }
    .overview .panel-head h2 { font-size:20px; }
    .live-list { max-height:340px; overflow:auto; }
    .live-row { min-height:60px; padding:8px 16px; }
    .row-icon { width:34px; height:34px; border-radius:5px; }
    .intelligence,.section { margin-top:34px; }
    .wallet-band { border-radius:7px; background:#161b26; }
    .ecosystem { margin-top:34px; }
    .ecosystem-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .ecosystem-card { min-height:154px; padding:18px; border:1px solid var(--line); border-radius:7px; background:#fff; }
    .ecosystem-card,.portal-panel,.download-item,.block-chip { transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
    .ecosystem-card:hover,.portal-panel:hover,.download-item:hover { border-color:#b8c9ff; box-shadow:0 12px 28px rgba(0,47,167,.08); transform:translateY(-2px); }
    .ecosystem-card h3 { margin:0; font-size:16px; }
    .product-title { display:flex; align-items:center; gap:10px; }
    .product-mark { width:28px; height:28px; object-fit:contain; }
    .ecosystem-card p { min-height:36px; margin:8px 0 11px; color:var(--muted); font-size:12px; line-height:1.45; }
    .ecosystem-card .product-state { display:inline-flex; padding:4px 7px; border-radius:4px; color:#50617a; background:#eef3ff; font-size:11px; font-weight:650; }
    .ecosystem-card a { display:block; margin-top:12px; color:var(--blue); font-size:12px; font-weight:650; }
    .product-meta { display:grid; gap:5px; margin-top:12px; color:#5d6775; font-size:11px; line-height:1.35; }
    .product-meta strong { color:#303846; font-weight:700; }
    .product-actions { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:5px; margin-top:13px; }
    .product-actions button { min-height:28px; padding:3px 4px; border:1px solid var(--line); border-radius:4px; color:#667181; background:#fff; font-size:10px; font-weight:650; }
    .product-actions button:not(:disabled):hover { border-color:#a8bcf9; color:var(--blue); }
    .product-actions button:disabled { cursor:not-allowed; opacity:.62; }
    .download-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .download-item { padding:16px 18px; border:1px solid var(--line); border-radius:7px; background:#fff; }
    .download-item strong,.download-item span { display:block; }
    .download-item span { margin-top:6px; color:var(--muted); font-size:12px; }
    .download-item button { margin-top:12px; padding:0; border:0; color:var(--blue); background:transparent; font-size:12px; font-weight:650; }
    .route-view { padding:30px 0 64px; }
    .route-view[hidden], main[hidden] { display:none!important; }
    .route-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:22px; }
    .route-head h1 { display:block; max-width:none; font-size:30px; }
    .route-head p { max-width:680px; margin:8px 0 0; color:var(--muted); font-size:14px; line-height:1.55; }
    .route-back { padding:8px 0; border:0; color:var(--blue); background:transparent; font-size:13px; font-weight:650; }
    .route-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .route-grid.two { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .portal-panel { padding:20px; border:1px solid var(--line); border-radius:7px; background:#fff; }
    .portal-panel h2,.portal-panel h3 { margin:0; font-size:18px; }
    .portal-panel h3 { font-size:15px; }
    .portal-panel p { margin:8px 0 0; color:var(--muted); font-size:13px; line-height:1.5; }
    .portal-panel dl { margin:14px 0 0; }
    .portal-panel dt { margin-top:10px; color:var(--muted); font-size:11px; text-transform:uppercase; }
    .portal-panel dd { margin:4px 0 0; color:var(--ink); font-size:13px; overflow-wrap:anywhere; }
    .portal-panel .status-note { display:inline-flex; margin-top:14px; padding:5px 8px; border-radius:4px; color:#4c5e7c; background:#eef3ff; font-size:11px; font-weight:700; }
    .portal-list { display:grid; gap:0; margin:14px 0 0; border-top:1px solid var(--line-soft); }
    .portal-list button,.portal-list a { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 0; border:0; border-bottom:1px solid var(--line-soft); color:var(--ink); background:transparent; text-align:left; font:inherit; }
    .portal-list button:hover,.portal-list a:hover { color:var(--blue); }
    .portal-list small { color:var(--muted); font-size:11px; }
    .unavailable { padding:18px; border:1px dashed #c8d0dd; border-radius:6px; color:#5d6775; background:#fafbfc; font-size:13px; line-height:1.5; }
    .route-table { width:100%; margin-top:0; }
    .route-table td,.route-table th { padding:13px 14px; }
    .record-actions { display:flex; flex-wrap:wrap; gap:6px; }
    .record-actions button { padding:5px 7px; border:1px solid var(--line); border-radius:4px; color:#4f5b6d; background:#fff; font-size:11px; font-weight:650; }
    .record-actions button:hover,.record-actions button:focus-visible { border-color:#a8bcf9; color:var(--blue); background:#f8faff; outline:0; }
    .table-link { padding:0; border:0; color:var(--blue); background:transparent; font:inherit; font-weight:700; }
    .table-link:hover,.table-link:focus-visible { text-decoration:underline; outline:0; }
    .page-controls { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:12px; color:var(--muted); font-size:12px; }
    .page-controls div { display:flex; gap:7px; }
    .page-controls button { min-height:32px; padding:6px 10px; border:1px solid var(--line); border-radius:4px; color:#445164; background:#fff; font-size:12px; font-weight:700; }
    .page-controls button:not(:disabled):hover,.page-controls button:not(:disabled):focus-visible { border-color:#a8bcf9; color:var(--blue); outline:0; }
    .page-controls button:disabled { cursor:not-allowed; opacity:.52; }
    .chart-toolbar { display:flex; flex-wrap:wrap; gap:7px; margin:13px 0; }
    .chart-toolbar button { padding:7px 10px; border:1px solid var(--line); border-radius:4px; color:#536072; background:#fff; font-size:12px; font-weight:650; }
    .chart-toolbar button.active { border-color:var(--blue); color:#fff; background:var(--blue); }
    .chart-empty { display:grid; min-height:210px; place-items:center; padding:24px; border:1px dashed #c6cfde; border-radius:6px; color:#5d6878; background:linear-gradient(180deg,#fcfdff,#f7f9ff); text-align:center; font-size:13px; line-height:1.55; }
    @media (max-width:760px) { .route-grid,.route-grid.two { grid-template-columns:1fr; } .route-head { align-items:flex-start; flex-direction:column; } }
    @media (max-width:1360px) { .nav { height:auto; } .nav-inner { height:auto; flex-wrap:wrap; min-height:58px; padding:9px 0; } .nav-links { order:3; width:100%; overflow-x:auto; } .nav-links a,.nav-links button { height:42px; padding:0 9px; } }
    @media (max-width:1050px) { .hero-grid,.network-summary { grid-template-columns:1fr; } .portal-callout { min-height:0; } .ecosystem-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:760px) { .shell { width:min(100% - 24px,1430px); } .nav { height:auto; } .nav-inner { flex-wrap:wrap; min-height:58px; gap:4px 12px; padding:9px 0; } .nav-links { order:3; width:100%; overflow:auto; } .nav-links a,.nav-links button { height:38px; padding:0 10px; font-size:12px; } .nav-actions { gap:8px; } .nav-actions a { display:none; } .metrics { grid-template-columns:1fr 1fr; } .metric:nth-child(2n) { border-right:0; } .metric:nth-child(n+5) { border-bottom:0; } .block-track { overflow:auto; padding-bottom:2px; } .block-chip { flex:0 0 220px; } .overview { grid-template-columns:1fr; } .download-grid { grid-template-columns:1fr; } .ecosystem-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <nav class="nav" aria-label="Primary navigation">
    <div class="shell nav-inner">
      <a class="brand" href="#top" aria-label="YNX Chain Explorer home"><img class="brand-logo" src="/assets/ynx-logo.png?v=df071f54b" width="30" height="30" alt=""><span>YNX Chain</span></a>
      <div class="nav-links">
        <a href="#home" data-route="home" data-i18n="home">Home</a><span class="nav-menu"><a href="#blockchain" data-route="blockchain" data-i18n="blockchain">Blockchain</a><span class="more-popover"><a href="#blockchain" data-route="blockchain" data-i18n="blocksTransactions">Blocks &amp; transactions</a><a href="#blockchain" data-route="blockchain" data-i18n="addressesContracts">Addresses &amp; contracts</a><a href="#blockchain" data-route="blockchain" data-i18n="validatorsStatus">Validators &amp; network status</a></span></span><span class="nav-menu"><a href="#tokens" data-route="tokens" data-i18n="tokens">Tokens</a><span class="more-popover"><a href="#tokens" data-route="tokens" data-i18n="ynxtNative">YNXT native asset</a><a href="#tokens" data-route="tokens" data-i18n="tokenRegistry">Verified token registry</a></span></span><span class="nav-menu"><a href="#data" data-route="data" data-i18n="data">Data</a><span class="more-popover"><a href="#data" data-route="data" data-i18n="networkActivity">Network activity</a><a href="#data" data-route="data" data-i18n="dataSourceStatus">Data source status</a></span></span><a href="#governance" data-route="governance" data-i18n="governance">Governance</a><span class="nav-menu"><a href="#ecosystem" data-route="ecosystem" data-i18n="ecosystem">YNX Ecosystem</a><span class="more-popover"><a href="#ecosystem" data-route="ecosystem" data-i18n="walletPermissions">Wallet &amp; permissions</a><a href="#ecosystem" data-route="ecosystem" data-i18n="defiPayments">DeFi &amp; Payments</a><a href="#ecosystem" data-route="ecosystem" data-i18n="developerInfrastructure">Developer &amp; Infrastructure</a><a href="#ecosystem" data-route="ecosystem" data-i18n="aiSocialDataMedia">AI, Social, Data &amp; Media</a><a href="#ecosystem" data-route="ecosystem" data-i18n="commerce">Commerce</a></span></span><span class="nav-menu"><a href="#developers" data-route="developers" data-i18n="developers">Developers</a><span class="more-popover"><a href="#developers" data-route="developers" data-i18n="networkConfiguration">Network configuration</a><a href="#developers" data-route="developers" data-i18n="sdkCliContracts">SDK, CLI &amp; contracts</a><a href="#developers" data-route="developers" data-i18n="faucetServiceStatus">Faucet &amp; service status</a></span></span><a href="#downloads" data-route="downloads" data-i18n="downloads">Downloads</a><span class="more-wrap"><button id="moreButton" type="button" aria-expanded="false" aria-controls="morePopover" data-i18n="more">More</button><span class="more-popover" id="morePopover"><a href="#blockchain" data-route="blockchain" data-i18n="validatorsNodes">Validators &amp; nodes</a><a href="#blockchain" data-route="blockchain" data-i18n="accounts">Accounts</a><a href="#documentation" data-route="documentation" data-i18n="documentation">Documentation</a></span></span>
      </div>
      <div class="nav-actions"><span id="networkName" hidden>Testnet</span><a href="#documentation" data-route="documentation" data-i18n="docs">Docs</a><select class="language-select" id="languageSelect" aria-label="Language"><option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="ko">한국어</option></select><button class="wallet-connect" id="walletConnectButton" type="button" data-i18n="connectWallet">Connect Wallet</button></div>
    </div>
  </nav>

  <div class="announcement" role="status"><div class="shell"><span class="announcement-dot"></span><strong data-i18n="portalAnnouncement">YNX 6423 Testnet portal</strong><span data-i18n="portalLivePolicy">Live figures appear only when the RPC and indexer agree.</span><a href="#documentation" data-i18n="readDataPolicy">Read the data policy</a></div></div>

  <header class="hero" id="top">
    <div class="shell">
      <div class="hero-grid"><div><p class="eyebrow">YNX Testnet</p><h1 data-i18n="heroTitle">YNX Chain network explorer</h1><p class="hero-copy" data-i18n="heroCopy">Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.</p>
        <div class="search-wrap"><form class="search" id="searchForm"><input id="searchInput" aria-label="Search the chain" aria-autocomplete="list" aria-controls="searchSuggestions" data-i18n-placeholder="searchPlaceholder" placeholder="Search token, account, contract, transaction, or block" autocomplete="off" spellcheck="false"><button type="submit" data-i18n="search">Search</button></form><div class="search-suggestions" id="searchSuggestions" role="listbox" hidden></div></div>
        <div class="trending"><span class="trending-label">Quick search:</span><button type="button" data-search="latest">Latest block</button><button type="button" data-search="YNXT">YNXT token</button><button type="button" data-search="6423">Block 6423</button><button type="button" data-search="0x1917">EVM network</button></div>
        <div class="hero-meta"><span><span class="pulse"></span>RPC + indexer verified</span><span id="lastUpdated">Connecting to the network</span><span id="heroHeight">Waiting for the latest block</span></div>
      </div><aside class="portal-callout"><div><p>Developer entry point</p><h2>Build and inspect on YNX 6423.</h2><div class="portal-callout-stats" aria-label="YNX network identity"><span><small>Chain</small><strong>6423</strong></span><span><small>EVM</small><strong>0x1917</strong></span><span><small>Native</small><strong>YNXT</strong></span></div></div><div class="portal-callout-links"><a href="#developers">Developer tools</a><a href="#documentation">Documentation</a><a href="#downloads">Downloads</a></div></aside></div>
      <section class="result-panel" id="resultPanel" aria-live="polite">
        <div class="panel-head"><div><h2 id="resultTitle">Search result</h2><p id="resultSubtitle"></p></div><button class="result-close" id="resultClose" type="button">Close</button></div>
        <div id="resultBody"></div>
      </section>
    </div>
  </header>

  <main id="homeContent">
    <div class="shell">
      <div class="status-bar" id="status"><span class="state"><span class="pulse"></span><span id="statusText">Connecting</span></span><span id="statusDetail">Reading RPC and indexer state</span><span class="stream-clock" id="streamClock"><span class="stream-dot"></span><span id="streamClockText">Opening live stream</span></span><button class="refresh" id="refreshButton" type="button">Refresh</button></div>

      <section class="network-summary" aria-label="Network summary">
      <div class="metrics" aria-label="Network metrics">
        <article class="metric"><div class="metric-label" data-i18n="latestBlock">Latest block</div><div class="metric-value skeleton" id="rpcHeight">0000</div><div class="metric-foot" id="blockAge">Waiting for block data</div></article>
        <article class="metric"><div class="metric-label" data-i18n="networkTps">Network TPS</div><div class="metric-value skeleton" id="networkTps">0.00</div><div class="metric-foot" data-i18n="indexedWindow">Latest indexed window</div></article>
        <article class="metric"><div class="metric-label" data-i18n="blockTime">Block time</div><div class="metric-value skeleton" id="blockTime">0.0s</div><div class="metric-foot" data-i18n="observedAverage">Observed average</div></article>
        <article class="metric"><div class="metric-label" data-i18n="indexedTxs">Transactions indexed</div><div class="metric-value skeleton" id="txCount">0000</div><div class="metric-foot" data-i18n="verifiedIndexer">Verified by the indexer</div></article>
        <article class="metric"><div class="metric-label" data-i18n="validators">Validators</div><div class="metric-value skeleton" id="validatorCount">00</div><div class="metric-foot" data-i18n="reportedRpc">Reported by chain RPC</div></article>
        <article class="metric"><div class="metric-label" data-i18n="indexerSync">Indexer sync</div><div class="metric-value skeleton" id="syncValue">0 blocks</div><div class="metric-foot" id="syncState">Checking consistency</div></article>
      </div>
      <aside class="asset-overview" aria-label="YNXT network summary"><div class="asset-overview-head"><div class="asset-token"><img src="/assets/ynx-icon.png?v=df071f54b" width="34" height="34" alt=""><div><strong>YNXT</strong><small>Native asset · 6423</small></div></div><div><strong id="assetTruthState">Connecting</strong><small>Network source</small></div></div><div class="asset-overview-body"><div class="asset-fact"><span>Chain identity</span><strong>6423 / 0x1917</strong><small>ynx_6423-1</small></div><div class="asset-fact"><span>Validators</span><strong id="assetValidatorCount">--</strong><small>Reported by RPC</small></div><div class="asset-fact"><span>Pending transactions</span><strong id="assetPendingCount">--</strong><small>Current RPC status</small></div><div class="asset-fact"><span>Last verified</span><strong id="assetVerifiedAt">--</strong><small id="assetHeight">Awaiting latest block</small></div></div></aside>
      </section>

      <section class="block-ribbon" aria-label="Live finalized block stream">
        <div class="ribbon-label"><span>FINALITY</span><strong id="finalityState">Connecting</strong></div>
        <div class="block-track" id="blockTrack"><div class="empty">Waiting for finalized blocks...</div></div>
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

      <section class="ecosystem" id="ecosystem">
        <div class="section-head"><div><h2>YNX Ecosystem</h2><p>Independent products on YNX 6423. A product is never shown as publicly downloadable without matching release proof.</p></div><a class="section-link" href="#ecosystem" data-route="ecosystem">View directory</a></div>
        <div class="ecosystem-grid">
          <article class="ecosystem-card"><h3>YNX Wallet</h3><p>Account custody and explicit application permissions.</p><span class="product-state">Testnet candidate</span><a href="#ecosystem" data-route="ecosystem">Availability details</a></article>
          <article class="ecosystem-card"><h3>DeFi &amp; Payments</h3><p>YNXT-native financial and payment workflows with explicit settlement boundaries.</p><span class="product-state">Source available</span><a href="#ecosystem" data-route="ecosystem">Availability details</a></article>
          <article class="ecosystem-card"><h3>Developer</h3><p>Explorer APIs, SDKs, contract tools, faucet, and Testnet configuration.</p><span class="product-state">Testnet tools</span><a href="#developers" data-route="developers">Open developer portal</a></article>
          <article class="ecosystem-card"><h3>AI, Social &amp; Media</h3><p>Independent YNX products with availability shown per platform and release proof.</p><span class="product-state">Mixed availability</span><a href="#ecosystem" data-route="ecosystem">Availability details</a></article>
        </div>
      </section>

      <section class="section" id="downloads">
        <div class="section-head"><div><h2>Download center</h2><p>Only a public, identity-matched artifact can receive an active download link.</p></div><a class="section-link" href="#downloads" data-route="downloads">Open download center</a></div>
        <div class="download-grid"><article class="download-item"><strong>YNX Wallet extension</strong><span>Public artifact verification is unavailable.</span><button type="button" data-download="wallet-extension">Why unavailable?</button></article><article class="download-item"><strong>Mobile &amp; desktop</strong><span>Store and signing proof are not attached to this portal.</span><button type="button" data-download="native-apps">Why unavailable?</button></article><article class="download-item"><strong>CLI &amp; SDK</strong><span>Use source-bound developer materials until a signed release is verified.</span><button type="button" data-route="developers">View developer materials</button></article></div>
      </section>
    </div>
  </main>

  <section class="route-view shell" id="routeView" hidden aria-live="polite"></section>

  <footer><div class="shell footer-inner"><span>YNX Chain · 6423 Testnet portal</span><span><a href="#documentation" data-route="documentation">Documentation</a> · Live testnet data. Mainnet launch is not claimed.</span></div></footer>

  <div class="drawer-backdrop" id="detailBackdrop" aria-hidden="true">
    <aside class="drawer" id="detailDrawer" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
      <div class="drawer-head"><div><div class="drawer-kicker" id="detailKicker">Chain detail</div><h2 id="detailTitle">Loading</h2></div><button class="icon-button" id="detailClose" type="button" aria-label="Close detail panel">&times;</button></div>
      <div id="detailContent"><div class="empty">Loading live chain data...</div></div>
    </aside>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite">Copied</div>

  <script>
    const api = '';
    const expected6423 = Object.freeze({numericChainId:6423,evmChainId:'0x1917',cosmosChainId:'ynx_6423-1',nativeSymbol:'YNXT'});
    const serviceDirectory = Object.freeze({
      explorer: Object.freeze({name:'YNX Explorer 6423 adapter',officialURL:'/api',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'/health',schema:'Explorer JSON summary, blocks, transactions, accounts, token, validators, resources, and fees',timeoutMs:8000,cache:'no-store',degraded:'Keep existing verified snapshot and label the portal degraded.'}),
      stream: Object.freeze({name:'YNX Explorer live stream',officialURL:'/api/stream',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'/health',schema:'Server-sent dashboard snapshot',timeoutMs:10000,cache:'event stream',degraded:'Fall back to the Explorer snapshot at a 10-second interval.'}),
      wallet: Object.freeze({name:'YNX Wallet provider',officialURL:'EIP-6963 / EIP-1193',expectedChainID:'0x1917 when connected',healthEndpoint:'Provider discovery',schema:'Standard provider and account response',timeoutMs:8000,cache:'session only',degraded:'Do not fall back to MetaMask or request an account.'}),
      governance: Object.freeze({name:'6423 governance',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Proposal, vote, and parameter records',timeoutMs:0,cache:'none',degraded:'Show unavailable; no governance data endpoint is configured.'}),
      history: Object.freeze({name:'6423 historical analytics',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Timestamped blocks, transactions, addresses, gas, node health, and token activity',timeoutMs:0,cache:'none',degraded:'Show an interactive empty chart; do not infer historical values.'}),
      releases: Object.freeze({name:'YNX signed release manifest',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Public URL, version, size, SHA-256, signing, source, and published time',timeoutMs:0,cache:'none',degraded:'Disable download controls and explain missing artifact evidence.'})
    });
    const serviceRuntime = new Map(Object.keys(serviceDirectory).map(key => [key,{lastVerifiedAt:null,lastError:null}]));
    let walletConfig = null;
    let refreshTimer = null;
    let eventSource = null;
    let latestTransactions = [];
    let previousHeight = 0;
    let previousTxHash = '';
    let lastStreamAt = 0;
    let toastTimer = null;
    let lastDashboard = null;
    let connectedYNXWallet = null;
    const walletListenerProviders = new WeakSet();
    const blockchainPages = {blocks:{items:[],total:0,limit:10,offset:0,hasMore:false},transactions:{items:[],total:0,limit:10,offset:0,hasMore:false}};
    const $ = (id) => document.getElementById(id);
    const messages = {
      en:{brand:'Chain Explorer',navOverview:'Overview',navBlockchain:'Blockchain',navAccounts:'Accounts',navValidators:'Validators',navResources:'Resources',heroTitle:'YNX Chain network explorer',heroCopy:'Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.',searchPlaceholder:'Search ynx1 address, transaction, block, or EVM compatibility address',search:'Search',latestBlock:'Latest block',networkTps:'Network TPS',indexedWindow:'Latest indexed window',blockTime:'Block time',observedAverage:'Observed average',indexedTxs:'Transactions indexed',verifiedIndexer:'Verified by the indexer',validators:'Validators',reportedRpc:'Reported by chain RPC',indexerSync:'Indexer sync',networkDetails:'Network details',networkDetailsCopy:'Current chain configuration',latestBlocks:'Real-time blocks',latestBlocksCopy:'Five newest finalized blocks, updated live',refresh:'Refresh',latestTransactions:'Real-time transactions',latestTransactionsCopy:'Five newest indexed transfers and actions',quickFindPlaceholder:'Find hash, address, amount…',accountLeaderboard:'YNXT account leaderboard',accountLeaderboardCopy:'Ranks full-ledger balances when available; otherwise shows a clearly labeled indexed-participant sample.',operational:'Network operational',degraded:'Upstream degraded',fullySynced:'Fully synchronized',catchingUp:'Indexer catching up',noMatching:'No matching transactions in the indexed transaction feed.',rpcResponding:'RPC and indexer are responding',live:'Live'},
      'zh-CN':{brand:'链上浏览器',navOverview:'概览',navBlockchain:'区块链',navAccounts:'账户',navValidators:'验证者',navResources:'资源',heroTitle:'YNX Chain 区块链浏览器',heroCopy:'查看公共测试网的实时区块、交易、验证者、账户、手续费与原生 YNXT 资源经济数据。',searchPlaceholder:'搜索 ynx1 地址、交易哈希、区块高度或 EVM 兼容地址',search:'搜索',latestBlock:'最新区块',networkTps:'网络 TPS',indexedWindow:'最近索引窗口',blockTime:'平均出块时间',observedAverage:'实时观测平均值',indexedTxs:'已索引交易',verifiedIndexer:'由索引器验证',validators:'验证者',reportedRpc:'由链 RPC 报告',indexerSync:'索引同步',networkDetails:'网络详情',networkDetailsCopy:'当前链配置',latestBlocks:'实时出块',latestBlocksCopy:'最新 5 个最终区块，实时更新',refresh:'刷新',latestTransactions:'实时交易',latestTransactionsCopy:'最新 5 笔已索引转账与协议操作',quickFindPlaceholder:'快速查找哈希、地址、金额…',accountLeaderboard:'YNXT 账户富豪榜',accountLeaderboardCopy:'节点支持时展示全账本余额排名；否则明确标注为已索引交易参与地址样本。',operational:'网络运行正常',degraded:'上游服务降级',fullySynced:'已完全同步',catchingUp:'索引器正在追赶',noMatching:'已索引交易流中没有匹配结果。',rpcResponding:'RPC 与索引器正在正常响应',live:'实时'},
      'zh-TW':{brand:'鏈上瀏覽器',navOverview:'概覽',navBlockchain:'區塊鏈',navAccounts:'帳戶',navValidators:'驗證者',navResources:'資源',heroTitle:'YNX Chain 區塊鏈瀏覽器',heroCopy:'檢視公開測試網的即時區塊、交易、驗證者、帳戶、手續費與原生 YNXT 資源經濟資料。',searchPlaceholder:'搜尋 ynx1 位址、交易雜湊、區塊高度或 EVM 相容位址',search:'搜尋',latestBlock:'最新區塊',networkTps:'網路 TPS',indexedWindow:'最近索引視窗',blockTime:'平均出塊時間',observedAverage:'即時觀測平均值',indexedTxs:'已索引交易',verifiedIndexer:'由索引器驗證',validators:'驗證者',reportedRpc:'由鏈 RPC 回報',indexerSync:'索引同步',networkDetails:'網路詳情',networkDetailsCopy:'目前鏈設定',latestBlocks:'即時出塊',latestBlocksCopy:'最新 5 個最終區塊，即時更新',refresh:'重新整理',latestTransactions:'即時交易',latestTransactionsCopy:'最新 5 筆已索引轉帳與協議操作',quickFindPlaceholder:'快速尋找雜湊、位址、金額…',accountLeaderboard:'YNXT 帳戶排行榜',accountLeaderboardCopy:'節點支援時顯示全帳本餘額排名；否則明確標示為已索引交易參與位址樣本。',operational:'網路運作正常',degraded:'上游服務降級',fullySynced:'已完全同步',catchingUp:'索引器正在追趕',noMatching:'已索引交易流中沒有相符結果。',rpcResponding:'RPC 與索引器正在回應',live:'即時'},
      ja:{brand:'チェーンエクスプローラー',navOverview:'概要',navBlockchain:'ブロックチェーン',navAccounts:'アカウント',navValidators:'バリデーター',navResources:'リソース',heroTitle:'YNX Chain ネットワークエクスプローラー',heroCopy:'公開テストネットのライブブロック、トランザクション、バリデーター、アカウント、手数料、YNXT リソース経済を確認します。',searchPlaceholder:'ynx1 アドレス、トランザクション、ブロック、EVM 互換アドレスを検索',search:'検索',latestBlock:'最新ブロック',networkTps:'ネットワーク TPS',indexedWindow:'最新のインデックス範囲',blockTime:'ブロック時間',observedAverage:'観測平均',indexedTxs:'インデックス済みトランザクション',verifiedIndexer:'インデクサーで検証済み',validators:'バリデーター',reportedRpc:'チェーン RPC の報告値',indexerSync:'インデクサー同期',networkDetails:'ネットワーク詳細',networkDetailsCopy:'現在のチェーン設定',latestBlocks:'ライブブロック',latestBlocksCopy:'最新の確定済み 5 ブロックをライブ更新',refresh:'更新',latestTransactions:'ライブトランザクション',latestTransactionsCopy:'最新のインデックス済み転送と操作',quickFindPlaceholder:'ハッシュ、アドレス、金額を検索…',accountLeaderboard:'YNXT アカウントランキング',accountLeaderboardCopy:'利用可能な場合は台帳残高を順位付けし、それ以外はインデックス済み参加者サンプルを表示します。',operational:'ネットワークは稼働中',degraded:'上流サービス低下',fullySynced:'完全に同期済み',catchingUp:'インデクサーが追随中',noMatching:'インデックス済みフィードに一致するトランザクションはありません。',rpcResponding:'RPC とインデクサーが応答中',live:'ライブ'},
      ko:{brand:'체인 탐색기',navOverview:'개요',navBlockchain:'블록체인',navAccounts:'계정',navValidators:'검증인',navResources:'리소스',heroTitle:'YNX Chain 네트워크 탐색기',heroCopy:'공개 테스트넷의 실시간 블록, 거래, 검증인, 계정, 수수료 및 YNXT 리소스 경제를 확인합니다.',searchPlaceholder:'ynx1 주소, 거래, 블록 또는 EVM 호환 주소 검색',search:'검색',latestBlock:'최신 블록',networkTps:'네트워크 TPS',indexedWindow:'최신 인덱스 범위',blockTime:'블록 시간',observedAverage:'관측 평균',indexedTxs:'인덱싱된 거래',verifiedIndexer:'인덱서 검증',validators:'검증인',reportedRpc:'체인 RPC 보고',indexerSync:'인덱서 동기화',networkDetails:'네트워크 상세',networkDetailsCopy:'현재 체인 설정',latestBlocks:'실시간 블록',latestBlocksCopy:'최근 확정 블록 5개를 실시간 갱신',refresh:'새로 고침',latestTransactions:'실시간 거래',latestTransactionsCopy:'최근 인덱싱된 전송 및 작업',quickFindPlaceholder:'해시, 주소, 금액 찾기…',accountLeaderboard:'YNXT 계정 순위',accountLeaderboardCopy:'가능하면 전체 원장 잔액 순위를, 그 외에는 인덱싱된 참여자 표본을 표시합니다.',operational:'네트워크 정상',degraded:'업스트림 서비스 저하',fullySynced:'완전히 동기화됨',catchingUp:'인덱서 동기화 중',noMatching:'인덱싱된 거래 피드에서 일치 항목이 없습니다.',rpcResponding:'RPC와 인덱서가 응답 중',live:'실시간'}
    };
    const portalMessages = {
      en:{home:'Home',blockchain:'Blockchain',tokens:'Tokens',data:'Data',governance:'Governance',ecosystem:'YNX Ecosystem',developers:'Developers',downloads:'Downloads',more:'More',docs:'Docs',documentation:'Documentation',connectWallet:'Connect Wallet',accounts:'Accounts',blocksTransactions:'Blocks & transactions',addressesContracts:'Addresses & contracts',validatorsStatus:'Validators & network status',ynxtNative:'YNXT native asset',tokenRegistry:'Verified token registry',networkActivity:'Network activity',dataSourceStatus:'Data source status',walletPermissions:'Wallet & permissions',defiPayments:'DeFi & Payments',developerInfrastructure:'Developer & Infrastructure',aiSocialDataMedia:'AI, Social, Data & Media',commerce:'Commerce',networkConfiguration:'Network configuration',sdkCliContracts:'SDK, CLI & contracts',faucetServiceStatus:'Faucet & service status',validatorsNodes:'Validators & nodes',portalAnnouncement:'YNX 6423 Testnet portal',portalLivePolicy:'Live figures appear only when the RPC and indexer agree.',readDataPolicy:'Read the data policy'},
      'zh-CN':{home:'首页',blockchain:'区块链',tokens:'代币',data:'数据',governance:'治理',ecosystem:'YNX 生态',developers:'开发者',downloads:'下载',more:'更多',docs:'文档',documentation:'文档中心',connectWallet:'连接钱包',accounts:'账户',blocksTransactions:'区块与交易',addressesContracts:'地址与合约',validatorsStatus:'验证者与网络状态',ynxtNative:'YNXT 原生资产',tokenRegistry:'已验证代币目录',networkActivity:'网络活动',dataSourceStatus:'数据源状态',walletPermissions:'钱包与权限',defiPayments:'DeFi 与支付',developerInfrastructure:'开发者与基础设施',aiSocialDataMedia:'AI、社交、数据与媒体',commerce:'商业',networkConfiguration:'网络配置',sdkCliContracts:'SDK、CLI 与合约',faucetServiceStatus:'水龙头与服务状态',validatorsNodes:'验证者与节点',portalAnnouncement:'YNX 6423 测试网门户',portalLivePolicy:'仅当 RPC 与索引器一致时才展示实时数据。',readDataPolicy:'阅读数据政策'},
      'zh-TW':{home:'首頁',blockchain:'區塊鏈',tokens:'代幣',data:'資料',governance:'治理',ecosystem:'YNX 生態',developers:'開發者',downloads:'下載',more:'更多',docs:'文件',documentation:'文件中心',connectWallet:'連接錢包',accounts:'帳戶',blocksTransactions:'區塊與交易',addressesContracts:'位址與合約',validatorsStatus:'驗證者與網路狀態',ynxtNative:'YNXT 原生資產',tokenRegistry:'已驗證代幣目錄',networkActivity:'網路活動',dataSourceStatus:'資料來源狀態',walletPermissions:'錢包與權限',defiPayments:'DeFi 與支付',developerInfrastructure:'開發者與基礎設施',aiSocialDataMedia:'AI、社群、資料與媒體',commerce:'商務',networkConfiguration:'網路設定',sdkCliContracts:'SDK、CLI 與合約',faucetServiceStatus:'水龍頭與服務狀態',validatorsNodes:'驗證者與節點',portalAnnouncement:'YNX 6423 測試網入口',portalLivePolicy:'僅在 RPC 與索引器一致時顯示即時資料。',readDataPolicy:'閱讀資料政策'},
      ja:{home:'ホーム',blockchain:'ブロックチェーン',tokens:'トークン',data:'データ',governance:'ガバナンス',ecosystem:'YNX エコシステム',developers:'開発者',downloads:'ダウンロード',more:'その他',docs:'ドキュメント',documentation:'ドキュメント',connectWallet:'ウォレットに接続',accounts:'アカウント',blocksTransactions:'ブロックと取引',addressesContracts:'アドレスとコントラクト',validatorsStatus:'バリデーターとネットワーク状態',ynxtNative:'YNXT ネイティブ資産',tokenRegistry:'検証済みトークン一覧',networkActivity:'ネットワーク活動',dataSourceStatus:'データソースの状態',walletPermissions:'ウォレットと権限',defiPayments:'DeFi と決済',developerInfrastructure:'開発者とインフラ',aiSocialDataMedia:'AI、ソーシャル、データ、メディア',commerce:'コマース',networkConfiguration:'ネットワーク設定',sdkCliContracts:'SDK、CLI、コントラクト',faucetServiceStatus:'フォーセットとサービス状態',validatorsNodes:'バリデーターとノード',portalAnnouncement:'YNX 6423 テストネットポータル',portalLivePolicy:'RPC とインデクサーが一致した場合のみライブ値を表示します。',readDataPolicy:'データポリシーを読む'},
      ko:{home:'홈',blockchain:'블록체인',tokens:'토큰',data:'데이터',governance:'거버넌스',ecosystem:'YNX 생태계',developers:'개발자',downloads:'다운로드',more:'더보기',docs:'문서',documentation:'문서',connectWallet:'지갑 연결',accounts:'계정',blocksTransactions:'블록 및 거래',addressesContracts:'주소 및 컨트랙트',validatorsStatus:'검증인 및 네트워크 상태',ynxtNative:'YNXT 네이티브 자산',tokenRegistry:'검증된 토큰 목록',networkActivity:'네트워크 활동',dataSourceStatus:'데이터 소스 상태',walletPermissions:'지갑 및 권한',defiPayments:'DeFi 및 결제',developerInfrastructure:'개발자 및 인프라',aiSocialDataMedia:'AI, 소셜, 데이터 및 미디어',commerce:'커머스',networkConfiguration:'네트워크 구성',sdkCliContracts:'SDK, CLI 및 컨트랙트',faucetServiceStatus:'수도꼭지 및 서비스 상태',validatorsNodes:'검증인 및 노드',portalAnnouncement:'YNX 6423 테스트넷 포털',portalLivePolicy:'RPC와 인덱서가 일치할 때만 실시간 수치를 표시합니다.',readDataPolicy:'데이터 정책 보기'}
    };
    const routeMessages = {
      en:{back:'Back to portal',availability:'Availability',evidenceGated:'Evidence-gated portal control',notFound:'Not found',loading:'Loading verified records…',unavailable:'Unavailable',networkStatus:'Network status',contracts:'Contracts',blocks:'Blocks',transactions:'Transactions',currentSnapshot:'Current 6423 snapshot',dataPolicy:'Data source policy',proposals:'Governance proposals',proposalDetail:'Proposal detail',voting:'Voting information',parameters:'Governance parameters',tools:'Tools & documentation',serviceDirectory:'6423 service directory',usingPortal:'Using this portal',statusPolicy:'Status policy',copyRoute:'Copy this route',previous:'Previous',next:'Next'},
      'zh-CN':{back:'返回门户',availability:'可用性',evidenceGated:'受证据门禁保护的门户操作',notFound:'未找到',loading:'正在加载已验证记录…',unavailable:'暂不可用',networkStatus:'网络状态',contracts:'合约',blocks:'区块',transactions:'交易',currentSnapshot:'当前 6423 快照',dataPolicy:'数据源政策',proposals:'治理提案',proposalDetail:'提案详情',voting:'投票信息',parameters:'治理参数',tools:'工具与文档',serviceDirectory:'6423 服务目录',usingPortal:'使用本门户',statusPolicy:'状态政策',copyRoute:'复制当前路由',previous:'上一页',next:'下一页'},
      'zh-TW':{back:'返回入口',availability:'可用性',evidenceGated:'受證據門檻保護的入口操作',notFound:'找不到結果',loading:'正在載入已驗證記錄…',unavailable:'暫時不可用',networkStatus:'網路狀態',contracts:'合約',blocks:'區塊',transactions:'交易',currentSnapshot:'目前 6423 快照',dataPolicy:'資料來源政策',proposals:'治理提案',proposalDetail:'提案詳情',voting:'投票資訊',parameters:'治理參數',tools:'工具與文件',serviceDirectory:'6423 服務目錄',usingPortal:'使用此入口',statusPolicy:'狀態政策',copyRoute:'複製目前路由',previous:'上一頁',next:'下一頁'},
      ja:{back:'ポータルに戻る',availability:'利用可否',evidenceGated:'証拠ゲート付きポータル操作',notFound:'見つかりません',loading:'検証済みレコードを読み込み中…',unavailable:'利用不可',networkStatus:'ネットワーク状態',contracts:'コントラクト',blocks:'ブロック',transactions:'トランザクション',currentSnapshot:'現在の 6423 スナップショット',dataPolicy:'データソース方針',proposals:'ガバナンス提案',proposalDetail:'提案詳細',voting:'投票情報',parameters:'ガバナンスパラメータ',tools:'ツールとドキュメント',serviceDirectory:'6423 サービス一覧',usingPortal:'このポータルについて',statusPolicy:'状態方針',copyRoute:'このルートをコピー',previous:'前へ',next:'次へ'},
      ko:{back:'포털로 돌아가기',availability:'이용 가능 여부',evidenceGated:'증거 게이트가 적용된 포털 제어',notFound:'찾을 수 없음',loading:'검증된 레코드 로드 중…',unavailable:'사용 불가',networkStatus:'네트워크 상태',contracts:'컨트랙트',blocks:'블록',transactions:'거래',currentSnapshot:'현재 6423 스냅샷',dataPolicy:'데이터 소스 정책',proposals:'거버넌스 제안',proposalDetail:'제안 상세',voting:'투표 정보',parameters:'거버넌스 파라미터',tools:'도구 및 문서',serviceDirectory:'6423 서비스 디렉터리',usingPortal:'이 포털 사용',statusPolicy:'상태 정책',copyRoute:'이 경로 복사',previous:'이전',next:'다음'}
    };
    const supportedLanguages = ['en','zh-CN','zh-TW','ja','ko'];
    const detectLanguage = () => { const preferred = navigator.language || 'en'; if (preferred.toLowerCase().startsWith('zh-tw') || preferred.toLowerCase().startsWith('zh-hk')) return 'zh-TW'; if (preferred.toLowerCase().startsWith('zh')) return 'zh-CN'; if (preferred.toLowerCase().startsWith('ja')) return 'ja'; if (preferred.toLowerCase().startsWith('ko')) return 'ko'; return 'en'; };
    let language = supportedLanguages.includes(localStorage.getItem('ynx-explorer-language')) ? localStorage.getItem('ynx-explorer-language') : detectLanguage();
    const t = key => messages[language]?.[key] || portalMessages[language]?.[key] || messages.en[key] || portalMessages.en[key] || key;
    const r = key => routeMessages[language]?.[key] || routeMessages.en[key] || key;
    const routeHeadings = {
      en:{blockchain:['Blockchain','Browse verified indexed blocks and transactions. Record details open in this tab; pagination never requests an unverified history source.'],tokens:['Tokens','Only current 6423-native token facts and indexed transfer records are displayed. This portal does not invent market data or token contracts.'],data:['Data','Current snapshot metrics are live. Each chart control remains interactive while its unverified history stays explicitly empty.'],governance:['Governance','Proposals, proposal detail, voting information, and parameters appear only after the portal can read a verified 6423 governance source.'],ecosystem:['YNX Ecosystem','Each product remains independent. Availability is shown only when its own public release evidence has been verified.'],developers:['Developers','The service directory is the single 6423 data adapter. Copy configuration only after the current source passes its identity check.'],downloads:['Download center','Every download must have verified public artifact and signing evidence. None is fabricated here.'],documentation:['Documentation','This portal keeps routes and release claims conservative: source documentation is not presented as a public production endpoint.']},
      'zh-CN':{blockchain:['区块链','浏览已验证索引的区块和交易。详情在当前标签页打开，分页不会请求未经验证的历史来源。'],tokens:['代币','仅展示当前 6423 原生代币事实和已索引转账记录；门户不会编造行情或代币合约。'],data:['数据','当前快照指标为实时数据。图表控件可交互，但未经验证的历史数据保持明确为空。'],governance:['治理','提案、详情、投票信息和参数仅在门户读取到已验证的 6423 治理来源后显示。'],ecosystem:['YNX 生态','每个产品保持独立；仅在其自身公开发布证据已验证时显示可用性。'],developers:['开发者','服务目录是唯一的 6423 数据适配器。仅在当前来源通过身份校验后复制配置。'],downloads:['下载中心','每项下载都必须有已验证的公开制品与签名证据；此处不会伪造任何下载。'],documentation:['文档','本门户对路由与发布声明保持审慎：源代码文档不被表述为公开生产端点。']},
      'zh-TW':{blockchain:['區塊鏈','瀏覽已驗證索引的區塊和交易。詳情在目前分頁開啟，分頁不會請求未驗證的歷史來源。'],tokens:['代幣','僅顯示目前 6423 原生代幣事實和已索引轉帳記錄；入口不會捏造行情或代幣合約。'],data:['資料','目前快照指標為即時資料。圖表控制項可互動，但未驗證的歷史資料會明確保留為空。'],governance:['治理','提案、詳情、投票資訊和參數只會在入口讀取到已驗證的 6423 治理來源後顯示。'],ecosystem:['YNX 生態','每個產品保持獨立；只在其自身公開發布證據已驗證時顯示可用性。'],developers:['開發者','服務目錄是唯一的 6423 資料介面。只在目前來源通過身分驗證後複製設定。'],downloads:['下載中心','每項下載都必須有已驗證的公開成品與簽章證據；此處不會捏造任何下載。'],documentation:['文件','本入口對路由與發布聲明維持審慎：來源文件不會被表述為公開正式端點。']},
      ja:{blockchain:['ブロックチェーン','検証済みで索引化されたブロックとトランザクションを参照します。詳細はこのタブで開き、未検証の履歴ソースは要求しません。'],tokens:['トークン','現在の 6423 ネイティブ資産の事実と索引済み送金のみを表示します。市場データやトークン契約を作りません。'],data:['データ','現在のスナップショット指標はライブです。チャート操作は可能ですが、未検証の履歴は明示的に空のままです。'],governance:['ガバナンス','提案、詳細、投票情報、パラメータは、検証済みの 6423 ガバナンスソースを読めた場合のみ表示します。'],ecosystem:['YNX エコシステム','各プロダクトは独立しています。自身の公開リリース証拠が検証された場合のみ可用性を示します。'],developers:['開発者','サービス一覧は唯一の 6423 データアダプターです。現在のソースがID検証に通った後だけ設定をコピーしてください。'],downloads:['ダウンロードセンター','各ダウンロードには検証済みの公開成果物と署名証拠が必要です。ここで捏造しません。'],documentation:['ドキュメント','このポータルはルートとリリースの主張を慎重に扱います。ソース文書を公開プロダクションエンドポイントとは示しません。']},
      ko:{blockchain:['블록체인','검증되어 색인된 블록과 트랜잭션을 살펴봅니다. 상세 정보는 이 탭에서 열리며 검증되지 않은 기록 소스는 요청하지 않습니다.'],tokens:['토큰','현재 6423 네이티브 자산 정보와 색인된 전송만 표시합니다. 시장 데이터나 토큰 계약을 만들어 내지 않습니다.'],data:['데이터','현재 스냅샷 지표는 실시간입니다. 차트는 조작할 수 있지만 검증되지 않은 이력은 명시적으로 비어 있습니다.'],governance:['거버넌스','제안, 세부 정보, 투표 정보와 파라미터는 검증된 6423 거버넌스 소스를 읽을 수 있을 때만 표시합니다.'],ecosystem:['YNX 생태계','각 제품은 독립적입니다. 자체 공개 릴리스 증거가 검증된 경우에만 이용 가능 여부를 표시합니다.'],developers:['개발자','서비스 디렉터리는 단일 6423 데이터 어댑터입니다. 현재 소스가 신원 확인을 통과한 뒤에만 설정을 복사하세요.'],downloads:['다운로드 센터','모든 다운로드에는 검증된 공개 아티팩트와 서명 증거가 필요합니다. 여기서 만들어 내지 않습니다.'],documentation:['문서','이 포털은 경로와 릴리스 주장을 보수적으로 다룹니다. 소스 문서를 공개 운영 엔드포인트로 제시하지 않습니다.']}
    };
    const routeHeading = key => routeHeadings[language]?.[key] || routeHeadings.en[key] || [key,''];
    const routeUI = {
      en:{filter:'Filter',allBlocks:'All finalized blocks',withTransactions:'With transactions',emptyBlocks:'Empty blocks',allTransactionTypes:'All transaction types',transfers:'Transfers',resourceActions:'Resource actions',faucet:'Faucet',height:'Height',finalized:'Finalized',status:'Status',hash:'Hash',type:'Type',from:'From',to:'To',amount:'Amount',copy:'Copy',copyHash:'Copy hash',finalizedState:'Finalized',emptyState:'Empty',noBlockMatch:'No verified block matches this filter.',noTransactionMatch:'No verified transaction matches this filter.',recordsUnavailable:'No live records are available from the current 6423 source.',loadingRecords:'Loading verified indexed records…',recordsRetry:'Verified 6423 indexed records are unavailable. Retry from the network status panel.',verifiedPagination:'Verified local-index pagination',liveSource:'Live source',indexerBacked:'RPC + indexer backed'},
      'zh-CN':{filter:'筛选',allBlocks:'全部已终局区块',withTransactions:'含交易',emptyBlocks:'空区块',allTransactionTypes:'全部交易类型',transfers:'转账',resourceActions:'资源操作',faucet:'水龙头',height:'高度',finalized:'已终局',status:'状态',hash:'哈希',type:'类型',from:'从',to:'至',amount:'数量',copy:'复制',copyHash:'复制哈希',finalizedState:'已终局',emptyState:'空',noBlockMatch:'没有符合此筛选条件的已验证区块。',noTransactionMatch:'没有符合此筛选条件的已验证交易。',recordsUnavailable:'当前 6423 来源未提供实时记录。',loadingRecords:'正在加载已验证索引记录…',recordsRetry:'已验证的 6423 索引记录暂不可用。请从网络状态面板重试。',verifiedPagination:'已验证的本地索引分页',liveSource:'实时来源',indexerBacked:'RPC + 索引器支持'},
      'zh-TW':{filter:'篩選',allBlocks:'全部已終局區塊',withTransactions:'含交易',emptyBlocks:'空區塊',allTransactionTypes:'全部交易類型',transfers:'轉帳',resourceActions:'資源操作',faucet:'水龍頭',height:'高度',finalized:'已終局',status:'狀態',hash:'雜湊',type:'類型',from:'從',to:'至',amount:'數量',copy:'複製',copyHash:'複製雜湊',finalizedState:'已終局',emptyState:'空',noBlockMatch:'沒有符合此篩選條件的已驗證區塊。',noTransactionMatch:'沒有符合此篩選條件的已驗證交易。',recordsUnavailable:'目前 6423 來源未提供即時記錄。',loadingRecords:'正在載入已驗證索引記錄…',recordsRetry:'已驗證的 6423 索引記錄暫時不可用。請從網路狀態面板重試。',verifiedPagination:'已驗證的本地索引分頁',liveSource:'即時來源',indexerBacked:'RPC + 索引器支援'},
      ja:{filter:'絞り込み',allBlocks:'すべての確定ブロック',withTransactions:'取引あり',emptyBlocks:'空ブロック',allTransactionTypes:'すべての取引種別',transfers:'送金',resourceActions:'リソース操作',faucet:'フォーセット',height:'高さ',finalized:'確定',status:'状態',hash:'ハッシュ',type:'種別',from:'送信元',to:'送信先',amount:'数量',copy:'コピー',copyHash:'ハッシュをコピー',finalizedState:'確定',emptyState:'空',noBlockMatch:'この絞り込みに一致する検証済みブロックはありません。',noTransactionMatch:'この絞り込みに一致する検証済み取引はありません。',recordsUnavailable:'現在の 6423 ソースからライブレコードを取得できません。',loadingRecords:'検証済み索引レコードを読み込み中…',recordsRetry:'検証済み 6423 索引レコードを利用できません。ネットワーク状態パネルから再試行してください。',verifiedPagination:'検証済みローカル索引ページング',liveSource:'ライブソース',indexerBacked:'RPC + インデクサー連携'},
      ko:{filter:'필터',allBlocks:'모든 확정 블록',withTransactions:'트랜잭션 있음',emptyBlocks:'빈 블록',allTransactionTypes:'모든 트랜잭션 유형',transfers:'전송',resourceActions:'리소스 작업',faucet:'수도꼭지',height:'높이',finalized:'확정',status:'상태',hash:'해시',type:'유형',from:'보낸 주소',to:'받는 주소',amount:'수량',copy:'복사',copyHash:'해시 복사',finalizedState:'확정',emptyState:'비어 있음',noBlockMatch:'이 필터와 일치하는 검증된 블록이 없습니다.',noTransactionMatch:'이 필터와 일치하는 검증된 트랜잭션이 없습니다.',recordsUnavailable:'현재 6423 소스에서 실시간 레코드를 사용할 수 없습니다.',loadingRecords:'검증된 색인 레코드를 불러오는 중…',recordsRetry:'검증된 6423 색인 레코드를 사용할 수 없습니다. 네트워크 상태 패널에서 다시 시도하세요.',verifiedPagination:'검증된 로컬 인덱스 페이지네이션',liveSource:'실시간 소스',indexerBacked:'RPC + 인덱서 기반'}
    };
    const u = key => routeUI[language]?.[key] || routeUI.en[key] || key;
    const ecosystemUI = {
      en:{support:'6423 support',platforms:'Platforms',open:'Open',docs:'Docs',download:'Download',status:'Status',notPublic:'Not publicly verified',liveDependent:'Live endpoint dependent',noProductLink:'No verified public product link, documentation route, or download artifact is configured.'},
      'zh-CN':{support:'6423 支持',platforms:'平台',open:'打开',docs:'文档',download:'下载',status:'状态',notPublic:'尚未公开验证',liveDependent:'取决于实时端点',noProductLink:'尚未配置已验证的公开产品链接、文档路由或下载制品。'},
      'zh-TW':{support:'6423 支援',platforms:'平台',open:'開啟',docs:'文件',download:'下載',status:'狀態',notPublic:'尚未公開驗證',liveDependent:'取決於即時端點',noProductLink:'尚未設定已驗證的公開產品連結、文件路由或下載成品。'},
      ja:{support:'6423 対応',platforms:'プラットフォーム',open:'開く',docs:'ドキュメント',download:'ダウンロード',status:'状態',notPublic:'公開検証なし',liveDependent:'ライブエンドポイントに依存',noProductLink:'検証済みの公開プロダクトリンク、ドキュメントルート、ダウンロード成果物は設定されていません。'},
      ko:{support:'6423 지원',platforms:'플랫폼',open:'열기',docs:'문서',download:'다운로드',status:'상태',notPublic:'공개 검증되지 않음',liveDependent:'실시간 엔드포인트에 따름',noProductLink:'검증된 공개 제품 링크, 문서 경로 또는 다운로드 아티팩트가 구성되지 않았습니다.'}
    };
    const e = key => ecosystemUI[language]?.[key] || ecosystemUI.en[key] || key;
    const ecosystemProducts = {
      en:[['Wallet','Custody, DApp permissions, and account identity.','Testnet candidate','Browser extension and native packages: unavailable'],['DeFi','Financial applications with product-scoped availability.','Source evidence only','Public route and settlement proof: unavailable'],['Payments','YNXT payment and merchant workflows.','Source evidence only','Public payment release: unavailable'],['Developer','Explorer, SDK, contract tools, faucet, and Testnet setup.','Testnet tools','Use the verified 6423 configuration'],['AI','Permissioned AI product workflows.','Provider availability unverified','Public runtime proof: unavailable'],['Social','Independent social application.','Public release unverified','iOS, Android, web proof: unavailable'],['Data','Data Fabric and trustworthy data services.','Integration status required','Control-plane integration: unavailable'],['Media','Music and Video products.','Public release unverified','Installed-runtime proof: unavailable'],['Commerce','Shop and seller operations.','Settlement proof required','Public storefront proof: unavailable'],['Infrastructure','Validator, RPC, indexer, and monitor surfaces.','Live data varies by endpoint','Current Explorer data is shown separately']],
      'zh-CN':[['钱包','托管、DApp 权限与账户身份。','测试网候选','浏览器扩展与原生安装包：暂不可用'],['DeFi','按产品范围显示可用性的金融应用。','仅有源代码证据','公开路由与结算证明：暂不可用'],['支付','YNXT 支付与商户工作流。','仅有源代码证据','公开支付发布：暂不可用'],['开发者','浏览器、SDK、合约工具、水龙头与测试网设置。','测试网工具','使用已验证的 6423 配置'],['AI','经许可的 AI 产品工作流。','提供方可用性未验证','公开运行时证明：暂不可用'],['社交','独立的社交应用。','公开发布未验证','iOS、Android、Web 证明：暂不可用'],['数据','数据织网与可信数据服务。','需要集成状态','控制平面集成：暂不可用'],['媒体','音乐与视频产品。','公开发布未验证','已安装运行时证明：暂不可用'],['商业','商店与卖家运营。','需要结算证明','公开店面证明：暂不可用'],['基础设施','验证者、RPC、索引器与监控界面。','实时数据因端点而异','当前 Explorer 数据单独展示']],
      'zh-TW':[['錢包','託管、DApp 權限與帳戶身分。','測試網候選','瀏覽器擴充功能與原生套件：暫時不可用'],['DeFi','依產品範圍顯示可用性的金融應用。','僅有來源證據','公開路由與結算證明：暫時不可用'],['支付','YNXT 支付與商家流程。','僅有來源證據','公開支付發布：暫時不可用'],['開發者','瀏覽器、SDK、合約工具、水龍頭與測試網設定。','測試網工具','使用已驗證的 6423 設定'],['AI','經授權的 AI 產品流程。','供應商可用性未驗證','公開執行環境證明：暫時不可用'],['社群','獨立的社群應用。','公開發布未驗證','iOS、Android、Web 證明：暫時不可用'],['資料','資料織網與可信資料服務。','需要整合狀態','控制平面整合：暫時不可用'],['媒體','音樂與影片產品。','公開發布未驗證','已安裝執行環境證明：暫時不可用'],['商務','商店與賣家營運。','需要結算證明','公開店面證明：暫時不可用'],['基礎設施','驗證者、RPC、索引器與監控介面。','即時資料因端點而異','目前 Explorer 資料另行顯示']],
      ja:[['ウォレット','カストディ、DApp 権限、アカウントID。','テストネット候補','ブラウザー拡張とネイティブパッケージ：利用不可'],['DeFi','プロダクト単位の可用性を持つ金融アプリ。','ソース証拠のみ','公開ルートと決済証拠：利用不可'],['決済','YNXT の決済および加盟店ワークフロー。','ソース証拠のみ','公開決済リリース：利用不可'],['開発者','Explorer、SDK、コントラクトツール、フォーセット、テストネット設定。','テストネットツール','検証済みの 6423 設定を使用'],['AI','権限付き AI プロダクトワークフロー。','プロバイダー可用性は未検証','公開ランタイム証拠：利用不可'],['ソーシャル','独立したソーシャルアプリ。','公開リリース未検証','iOS、Android、Web の証拠：利用不可'],['データ','Data Fabric と信頼できるデータサービス。','統合状態が必要','コントロールプレーン統合：利用不可'],['メディア','音楽と動画のプロダクト。','公開リリース未検証','インストール済みランタイム証拠：利用不可'],['コマース','ショップと販売者の運用。','決済証拠が必要','公開ストアフロント証拠：利用不可'],['インフラ','バリデーター、RPC、インデクサー、監視画面。','ライブデータはエンドポイントにより異なる','現在の Explorer データは別に表示']],
      ko:[['지갑','보관, DApp 권한 및 계정 ID입니다.','테스트넷 후보','브라우저 확장과 네이티브 패키지: 사용 불가'],['DeFi','제품 범위별 가용성을 갖춘 금융 애플리케이션입니다.','소스 증거만 있음','공개 경로와 결제 증명: 사용 불가'],['결제','YNXT 결제 및 가맹점 워크플로입니다.','소스 증거만 있음','공개 결제 릴리스: 사용 불가'],['개발자','Explorer, SDK, 컨트랙트 도구, 수도꼭지 및 테스트넷 설정입니다.','테스트넷 도구','검증된 6423 구성을 사용하세요'],['AI','권한이 부여된 AI 제품 워크플로입니다.','제공자 가용성 미검증','공개 런타임 증명: 사용 불가'],['소셜','독립 소셜 애플리케이션입니다.','공개 릴리스 미검증','iOS, Android, 웹 증명: 사용 불가'],['데이터','데이터 패브릭 및 신뢰 가능한 데이터 서비스입니다.','통합 상태 필요','제어 플레인 통합: 사용 불가'],['미디어','음악 및 비디오 제품입니다.','공개 릴리스 미검증','설치된 런타임 증명: 사용 불가'],['커머스','상점 및 판매자 운영입니다.','결제 증명 필요','공개 스토어프론트 증명: 사용 불가'],['인프라','검증인, RPC, 인덱서 및 모니터 화면입니다.','실시간 데이터는 엔드포인트에 따라 다름','현재 Explorer 데이터는 별도로 표시됩니다']]
    };
    const isChinese = () => language.startsWith('zh');
    function applyLanguage(nextLanguage) {
      language = messages[nextLanguage] ? nextLanguage : 'en';
      localStorage.setItem('ynx-explorer-language',language);
      document.documentElement.lang = language;
      document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
      $('languageSelect').value = language;
      renderTransactions();
      if (typeof renderLocation === 'function') renderLocation();
    }
    const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const compact = (value, start = 10, end = 7) => { const text = String(value ?? ''); return text.length > start + end + 3 ? text.slice(0,start) + '...' + text.slice(-end) : text || '--'; };
    const number = (value) => new Intl.NumberFormat(language === 'en' ? 'en-US' : language).format(Number(value || 0));
    const relativeTime = (value) => {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
      if (!Number.isFinite(seconds)) return 'Time unavailable';
      if (language === 'zh-CN') {
        if (seconds < 60) return seconds + ' 秒前';
        if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
        return Math.floor(seconds / 3600) + ' 小时前';
      }
      if (language === 'zh-TW') { if (seconds < 60) return seconds + ' 秒前'; if (seconds < 3600) return Math.floor(seconds / 60) + ' 分鐘前'; return Math.floor(seconds / 3600) + ' 小時前'; }
      if (language === 'ja') { if (seconds < 60) return seconds + ' 秒前'; if (seconds < 3600) return Math.floor(seconds / 60) + ' 分前'; return Math.floor(seconds / 3600) + ' 時間前'; }
      if (language === 'ko') { if (seconds < 60) return seconds + '초 전'; if (seconds < 3600) return Math.floor(seconds / 60) + '분 전'; return Math.floor(seconds / 3600) + '시간 전'; }
      if (seconds < 60) return seconds + ' seconds ago';
      if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
      return Math.floor(seconds / 3600) + ' hours ago';
    };
    const exactTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString(language === 'en' ? 'en-US' : language, {dateStyle:'medium',timeStyle:'medium'}); };
    function serviceState(key) { return serviceRuntime.get(key) || {lastVerifiedAt:null,lastError:'Unknown service'}; }
    function clientError(error, fallback = 'The requested verified 6423 data is unavailable right now.') {
      if (error?.name === 'AbortError') return 'The verified 6423 service took too long to respond. Please retry.';
      return fallback;
    }
    async function get(path, serviceKey = 'explorer') {
      const service = serviceDirectory[serviceKey] || serviceDirectory.explorer;
      if (!service.timeoutMs) throw new Error(service.degraded);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(),service.timeoutMs);
      try {
        const response = await fetch(api + path, {headers:{accept:'application/json','cache-control':service.cache},cache:'no-store',signal:controller.signal});
        if (!response.ok) throw new Error('verified-service-unavailable');
        const payload = await response.json();
        const state = serviceRuntime.get(serviceKey) || serviceRuntime.get('explorer');
        state.lastVerifiedAt = new Date().toISOString();
        state.lastError = null;
        return payload;
      } catch (error) {
        const state = serviceRuntime.get(serviceKey) || serviceRuntime.get('explorer');
        state.lastError = clientError(error,service.degraded);
        throw error;
      } finally { window.clearTimeout(timeout); }
    }
    function assert6423Snapshot(summary) {
      const actualNumeric = Number(summary?.network?.chainId);
      const actualEVM = String(summary?.wallet?.chainIdHex || '').toLowerCase();
      const actualSymbol = String(summary?.nativeSymbol || summary?.wallet?.nativeSymbol || '').toUpperCase();
      if (actualNumeric !== expected6423.numericChainId || actualEVM !== expected6423.evmChainId || actualSymbol !== expected6423.nativeSymbol) {
        throw new Error('The data source did not prove the required 6423 network identity.');
      }
      return summary;
    }
    function removeSkeletons() { document.querySelectorAll('.skeleton').forEach(node => node.classList.remove('skeleton')); }
    function blockRow(block,index = 0) {
      const txs = (block.transactions || []).length;
      const isNew = index === 0 && previousHeight && Number(block.height) > previousHeight;
      return '<button class="live-row block-live-row' + (txs === 0 ? ' empty-block-row' : '') + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><span class="row-icon">BK</span><span><span class="row-title"><span class="link mono">#' + escapeHTML(number(block.height)) + '</span><span class="type-tag">' + (txs === 0 ? (isChinese() ? '空区块' : 'Empty') : (isChinese() ? '已最终确定' : 'Finalized')) + '</span></span><span class="row-subtitle"><span class="mono hash" title="' + escapeHTML(block.hash) + '">' + escapeHTML(compact(block.hash,14,9)) + '</span></span></span><span class="row-side"><strong>' + txs + (isChinese() ? ' 笔交易' : (txs === 1 ? ' tx' : ' txs')) + '</strong><span title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</span></span></button>';
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
      const slot = calculateWindow(blocks).blockTime;
      $('blockTrack').innerHTML = blocks.slice(0,4).map((block,index) => {
        const arrived = index === 0 && previousHeight && incomingHeight > previousHeight;
        const txs = (block.transactions || []).length;
        const state = txs === 0 ? (isChinese() ? '空区块' : 'Empty') : (isChinese() ? '已最终确定' : 'Finalized');
        const slotLabel = slot > 0 ? slot.toFixed(1) + 's slot' : 'Finality observed';
        return '<button class="block-chip' + (txs === 0 ? ' empty-block' : '') + (arrived ? ' new' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><strong class="mono">#' + escapeHTML(number(block.height)) + '</strong><span>' + escapeHTML(state) + ' · ' + txs + (isChinese() ? ' 笔交易' : (txs === 1 ? ' transaction' : ' transactions')) + '</span><span class="block-chip-meta"><b>' + escapeHTML(slotLabel) + '</b><em title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</em></span></button>';
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
      const observed = leaderboard?.truthfulStatus === 'observed-indexed-participant-account-ranking';
      $('accountTotal').textContent = number(leaderboard?.total || accounts.length) + (observed ? (isChinese() ? ' 个已观测账户 / 展示前 ' : ' observed accounts / top ') : (isChinese() ? ' 个全账本账户 / 展示前 ' : ' public accounts / top ')) + number(accounts.length);
      $('accountsBody').innerHTML = accounts.length ? accounts.map((account,index) => '<tr data-query="' + escapeHTML(account.address) + '"><td><strong>#' + (index + 1) + '</strong></td><td><span class="link mono hash" title="' + escapeHTML(account.address) + '">' + escapeHTML(account.address) + '</span></td><td class="amount">' + escapeHTML(number(account.balance)) + ' YNXT</td><td>' + escapeHTML(number(account.staked)) + ' YNXT</td><td class="mono">' + escapeHTML(number(account.nonce)) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">' + (isChinese() ? '暂未发现可验证的已索引账户余额。' : 'No verifiable indexed account balances are available yet.') + '</td></tr>';
      bindQueries();
    }
    function bindQueries() {
      document.querySelectorAll('[data-query]').forEach(node => node.onclick = () => search(node.dataset.query));
      document.querySelectorAll('[data-account]').forEach(node => node.onclick = event => { event.preventDefault(); event.stopPropagation(); search(node.dataset.account); });
    }
    function renderDashboard(summary, blocks, transactions, validatorData, resources, source = 'Live stream') {
      lastDashboard = {summary, blocks, transactions, validatorData, resources, source};
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
      $('syncValue').textContent = number(summary.syncLagBlocks) + (isChinese() ? ' 个区块' : (summary.syncLagBlocks === 1 ? ' block' : ' blocks'));
      $('assetValidatorCount').textContent = number(summary.validatorCount);
      $('assetPendingCount').textContent = number(summary.pendingTxCount);
      $('assetTruthState').textContent = summary.ok ? 'RPC + Indexer' : 'Degraded';
      $('assetVerifiedAt').textContent = exactTime(summary.lastCheckedAt);
      $('assetHeight').textContent = 'Block #' + number(summary.rpcHeight) + ' · ' + number(summary.syncLagBlocks) + '-block lag';
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
      // Dashboard refreshes continue after route navigation. Keep the document
      // identity on the portal rather than replacing it with a transient block
      // title whenever live summary data arrives.
      if (!location.hash || location.hash === '#home') document.title = 'YNX Chain | 6423 Testnet portal';
      $('blocksBody').innerHTML = blocks.length ? blocks.slice(0,5).map(blockRow).join('') : '<div class="empty">No indexed blocks yet.</div>';
      renderTransactions();
      renderBlockTrack(blocks,incomingHeight);
      renderIntelligence(validatorData, resources);
      bindQueries();
      $('statusText').textContent = summary.ok ? t('operational') : t('degraded');
      $('statusDetail').textContent = summary.ok ? source + ' / ' + t('rpcResponding') : (summary.indexerError || (isChinese() ? '一个或多个上游服务已降级' : 'One or more upstream services are degraded'));
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
      renderDashboard(assert6423Snapshot(summary), blockData.blocks, txData.transactions, validators, resources, 'Manual snapshot');
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
        serviceRuntime.get('stream').lastVerifiedAt = new Date().toISOString();
        serviceRuntime.get('stream').lastError = null;
        $('streamClock').className = 'stream-clock live';
        $('streamClockText').textContent = 'Live stream connected';
      };
      eventSource.addEventListener('dashboard', event => {
        try {
          const snapshot = JSON.parse(event.data);
          lastStreamAt = Date.now();
          renderDashboard(assert6423Snapshot(snapshot.summary), snapshot.blocks || [], snapshot.transactions || [], snapshot.validators, snapshot.resources, 'Live SSE');
          stopFallbackPolling();
        } catch (error) { showLoadError(error); }
      });
      eventSource.addEventListener('upstream-error', event => {
        try { showLoadError(new Error(JSON.parse(event.data).error || 'Live upstream error')); } catch (_) { showLoadError(new Error('Live upstream error')); }
      });
      eventSource.onerror = () => {
        serviceRuntime.get('stream').lastError = serviceDirectory.stream.degraded;
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
    function dismissDrawer() {
      $('detailBackdrop').classList.remove('visible');
      $('detailBackdrop').setAttribute('aria-hidden','true');
      document.body.style.overflow = '';
    }
    function closeDrawer() {
      dismissDrawer();
      if (location.hash.includes('?detail=')) location.hash = '#blockchain';
    }
    function parsePortalLocation() {
      const raw = location.hash.slice(1) || 'home';
      const [route,query = ''] = raw.split('?');
      return {route:route || 'home',params:new URLSearchParams(query)};
    }
    function setDetailLocation(type,query) {
      const next = '#blockchain?detail=' + encodeURIComponent(type + ':' + query);
      if (location.hash === next) openDetailFromLocation(type,query);
      else location.hash = next;
    }
    async function openDetailFromLocation(type,query) {
      try {
        let detail;
        if (type === 'block') detail = await get('/api/blocks/' + encodeURIComponent(query));
        else if (type === 'transaction') detail = await get('/api/txs/' + encodeURIComponent(query));
        else if (type === 'account') detail = await get('/api/accounts/' + encodeURIComponent(query));
        else if (type === 'token') detail = await get('/api/tokens/' + encodeURIComponent(query));
        else if (type === 'validator') {
          const validators = await get('/api/validators');
          detail = (validators.validators || []).find(validator => String(validator.address).toLowerCase() === String(query).toLowerCase() || String(validator.moniker).toLowerCase() === String(query).toLowerCase());
          if (!detail) throw new Error('validator-not-found');
        } else throw new Error('unsupported-detail');
        showDrawer(type,query,detail);
      } catch (error) {
        $('detailKicker').textContent = r('availability');
        $('detailTitle').textContent = r('notFound');
        $('detailContent').innerHTML = '<div class="result-error">No matching verified 6423 record was found.</div>';
        $('detailBackdrop').classList.add('visible');
        $('detailBackdrop').setAttribute('aria-hidden','false');
      }
    }
    function renderLocation() {
      const current = parsePortalLocation();
      renderPortalRoute(current.route);
      const detail = current.params.get('detail');
      if (!detail) { dismissDrawer(); return; }
      const separator = detail.indexOf(':');
      if (separator < 1 || !detail.slice(separator + 1)) return;
      openDetailFromLocation(detail.slice(0,separator),detail.slice(separator + 1));
    }
    function showToast(message) {
      $('toast').textContent = message;
      $('toast').classList.add('visible');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => $('toast').classList.remove('visible'),1500);
    }
    const portalPanel = (title,body,note = '') => '<article class="portal-panel"><h2>' + escapeHTML(title) + '</h2>' + body + (note ? '<span class="status-note">' + escapeHTML(note) + '</span>' : '') + '</article>';
    const routeHead = (title,copy) => '<div class="route-head"><div><button class="route-back" type="button" data-route="home">← ' + escapeHTML(r('back')) + '</button><h1>' + escapeHTML(title) + '</h1><p>' + escapeHTML(copy) + '</p></div></div>';
    const unavailable = message => '<div class="unavailable">' + escapeHTML(message) + '</div>';
    const facts = rows => '<dl>' + rows.map(([key,value]) => '<dt>' + escapeHTML(key) + '</dt><dd class="mono">' + escapeHTML(value) + '</dd>').join('') + '</dl>';
    function serviceDirectoryTable() {
      const rows = Object.entries(serviceDirectory).map(([key,service]) => {
        const runtime = serviceState(key);
        const verified = runtime.lastVerifiedAt ? exactTime(runtime.lastVerifiedAt) : 'Not verified in this browser session';
        const timeout = service.timeoutMs ? (service.timeoutMs / 1000) + 's' : 'Unavailable';
        return '<tr><td><strong>' + escapeHTML(service.name) + '</strong><span class="muted">' + escapeHTML(service.schema) + '</span></td><td class="mono">' + escapeHTML(service.expectedChainID) + '</td><td class="mono">' + escapeHTML(service.officialURL) + '<br><small>Health: ' + escapeHTML(service.healthEndpoint) + '</small></td><td><span>' + escapeHTML(timeout) + '</span><br><small>Cache: ' + escapeHTML(service.cache) + '</small></td><td><span>' + escapeHTML(verified) + '</span><br><small>' + escapeHTML(runtime.lastError || service.degraded) + '</small></td></tr>';
      }).join('');
      return '<div class="table-shell"><table class="route-table"><thead><tr><th>Service & schema</th><th>Expected identity</th><th>Official endpoint</th><th>Timeout & cache</th><th>Verification / degraded behavior</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    function portalTable(items,columns) {
      if (!items?.length) return unavailable(u('recordsUnavailable'));
      return '<div class="table-shell"><table class="route-table"><thead><tr>' + columns.map(column => '<th>' + escapeHTML(column.label) + '</th>').join('') + '</tr></thead><tbody>' + items.map(item => '<tr>' + columns.map(column => '<td class="mono">' + escapeHTML(String(column.value(item) ?? '—')) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    }
    function paginationControls(kind,page) {
      const previousDisabled = page.offset === 0 ? ' disabled aria-disabled="true"' : '';
      const nextDisabled = page.hasMore ? '' : ' disabled aria-disabled="true"';
      const shown = page.items.length ? (page.offset + 1) + '–' + (page.offset + page.items.length) : '0';
      return '<div class="page-controls" aria-label="' + escapeHTML(kind) + ' pagination"><span>' + escapeHTML(shown) + ' of ' + escapeHTML(number(page.total)) + ' verified indexed records</span><div><button type="button" data-page-kind="' + escapeHTML(kind) + '" data-page-offset="' + Math.max(0,page.offset-page.limit) + '"' + previousDisabled + '>' + escapeHTML(r('previous')) + '</button><button type="button" data-page-kind="' + escapeHTML(kind) + '" data-page-offset="' + (page.offset+page.limit) + '"' + nextDisabled + '>' + escapeHTML(r('next')) + '</button></div></div>';
    }
    function renderBlockchainPage(kind) {
      const page = blockchainPages[kind];
      const tbody = $(kind === 'blocks' ? 'blockchainBlocksBody' : 'blockchainTransactionsBody');
      const controls = $(kind === 'blocks' ? 'blockchainBlocksControls' : 'blockchainTransactionsControls');
      if (!tbody || !controls) return;
      const filter = $(kind === 'blocks' ? 'blockchainBlockFilter' : 'blockchainTransactionFilter')?.value || 'all';
      const items = page.items.filter(item => kind === 'blocks' ? (filter === 'all' || (filter === 'empty' ? (item.transactions || []).length === 0 : (item.transactions || []).length > 0)) : (filter === 'all' || String(item.type || '').toLowerCase() === filter));
      if (kind === 'blocks') {
        tbody.innerHTML = items.length ? items.map(block => '<tr><td><button type="button" class="table-link mono" data-query="' + escapeHTML(block.height) + '">#' + escapeHTML(number(block.height)) + '</button></td><td title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</td><td>' + escapeHTML(number((block.transactions || []).length)) + '</td><td><span class="type-tag">' + escapeHTML((block.transactions || []).length ? u('finalizedState') : u('emptyState')) + '</span></td><td><button type="button" class="copy-button" data-copy="' + encodeURIComponent(block.hash || '') + '">' + escapeHTML(u('copyHash')) + '</button></td></tr>').join('') : '<tr><td colspan="5" class="empty">' + escapeHTML(u('noBlockMatch')) + '</td></tr>';
      } else {
        tbody.innerHTML = items.length ? items.map(tx => '<tr><td><button type="button" class="table-link mono" data-query="' + escapeHTML(tx.hash) + '">' + escapeHTML(compact(tx.hash,12,8)) + '</button></td><td><span class="type-tag">' + escapeHTML(tx.type || 'transaction') + '</span></td><td class="mono">' + escapeHTML(compact(tx.from,9,6)) + '</td><td class="mono">' + escapeHTML(compact(tx.to,9,6)) + '</td><td>' + escapeHTML(number(tx.amount)) + ' YNXT</td><td><button type="button" class="copy-button" data-copy="' + encodeURIComponent(tx.hash || '') + '">' + escapeHTML(u('copyHash')) + '</button></td></tr>').join('') : '<tr><td colspan="6" class="empty">' + escapeHTML(u('noTransactionMatch')) + '</td></tr>';
      }
      controls.innerHTML = paginationControls(kind,page);
      bindQueries();
    }
    async function loadBlockchainPage(kind,offset = 0) {
      const endpoint = kind === 'blocks' ? '/api/blocks/latest' : '/api/txs';
      const target = $(kind === 'blocks' ? 'blockchainBlocksBody' : 'blockchainTransactionsBody');
      if (target) target.innerHTML = '<tr><td colspan="6" class="empty">' + escapeHTML(u('loadingRecords')) + '</td></tr>';
      try {
        const page = await get(endpoint + '?limit=10&offset=' + Math.max(0,offset));
        blockchainPages[kind] = {items:kind === 'blocks' ? (page.blocks || []) : (page.transactions || []),total:Number(page.total || 0),limit:Number(page.limit || 10),offset:Number(page.offset || 0),hasMore:Boolean(page.hasMore)};
        renderBlockchainPage(kind);
      } catch (_) {
        if (target) target.innerHTML = '<tr><td colspan="6" class="empty">' + escapeHTML(u('recordsRetry')) + '</td></tr>';
      }
    }
    function showPortalNotice(message) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = r('availability'); $('resultSubtitle').textContent = r('evidenceGated'); $('resultBody').innerHTML = '<div class="empty">' + escapeHTML(message) + '</div>'; }
    function showWalletSession() {
      if (!connectedYNXWallet) return;
      const onExpectedNetwork = String(connectedYNXWallet.chainId || '').toLowerCase() === expected6423.evmChainId;
      $('resultPanel').classList.add('visible');
      $('resultTitle').textContent = 'YNX Wallet connected';
      $('resultSubtitle').textContent = 'EIP-6963 / EIP-1193 session — no signature or transaction was requested';
      $('resultBody').innerHTML = '<dl class="detail-body"><div class="detail-row"><dt>Account</dt><dd class="mono">' + escapeHTML(connectedYNXWallet.account) + '</dd></div><div class="detail-row"><dt>Provider</dt><dd>YNX Wallet only · MetaMask remains separate</dd></div><div class="detail-row"><dt>Connected chain</dt><dd class="mono">' + escapeHTML(connectedYNXWallet.chainId || 'Unavailable') + '</dd></div><div class="detail-row"><dt>Required Testnet</dt><dd class="mono">6423 / 0x1917 / ynx_6423-1</dd></div></dl><div class="' + (onExpectedNetwork ? 'status-note' : 'unavailable') + '">' + (onExpectedNetwork ? 'Connected to YNX 6423 Testnet' : 'This provider is on a different network. Connection remains intact until you choose to switch.') + '</div><div class="portal-list"><button type="button" data-wallet-session="network">Switch to 0x1917 <small>Requests a wallet network change</small></button><button type="button" data-wallet-session="switch">Refresh selected account <small>Reads the provider account list</small></button><button type="button" data-wallet-session="disconnect">Disconnect <small>Clears this portal session only</small></button></div>';
    }
    function updateWalletButton() { $('walletConnectButton').textContent = connectedYNXWallet ? compact(connectedYNXWallet.account,6,4) : t('connectWallet'); }
    function clearWalletSession(reason) {
      connectedYNXWallet = null;
      serviceRuntime.get('wallet').lastError = reason || null;
      updateWalletButton();
    }
    async function readWalletChain(provider) {
      const chainId = await provider.request({method:'eth_chainId'});
      return String(chainId || '').toLowerCase();
    }
    function attachWalletListeners(provider) {
      if (typeof provider?.on !== 'function' || walletListenerProviders.has(provider)) return;
      walletListenerProviders.add(provider);
      provider.on('accountsChanged', async accounts => {
        if (!connectedYNXWallet || connectedYNXWallet.provider !== provider) return;
        const account = Array.isArray(accounts) && accounts[0];
        if (!account) { clearWalletSession('The provider disconnected its account list.'); showPortalNotice('YNX Wallet no longer exposes an account to this portal. No wallet permission, signature, or transaction changed.'); return; }
        connectedYNXWallet.account = account;
        updateWalletButton();
        showToast('YNX Wallet account updated');
      });
      provider.on('chainChanged', chainId => {
        if (!connectedYNXWallet || connectedYNXWallet.provider !== provider) return;
        connectedYNXWallet.chainId = String(chainId || '').toLowerCase();
        serviceRuntime.get('wallet').lastVerifiedAt = new Date().toISOString();
        showToast(connectedYNXWallet.chainId === expected6423.evmChainId ? 'YNX 6423 network selected' : 'Wallet network changed');
      });
      provider.on('disconnect', () => { if (connectedYNXWallet?.provider === provider) { clearWalletSession('The provider disconnected.'); showPortalNotice('YNX Wallet disconnected from this portal.'); } });
    }
    async function switchYNXWalletNetwork() {
      if (!connectedYNXWallet?.provider || !walletConfig) return;
      const provider = connectedYNXWallet.provider;
      try {
        await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:expected6423.evmChainId}]});
      } catch (error) {
        if (Number(error?.code) !== 4902) throw error;
        await provider.request({method:'wallet_addEthereumChain',params:[{chainId:walletConfig.chainIdHex,chainName:walletConfig.chainName,nativeCurrency:{name:walletConfig.nativeCurrencyName,symbol:walletConfig.nativeSymbol,decimals:walletConfig.decimals},rpcUrls:walletConfig.rpcUrls,blockExplorerUrls:walletConfig.blockExplorerUrls}]});
        await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:expected6423.evmChainId}]});
      }
      connectedYNXWallet.chainId = await readWalletChain(provider);
      showWalletSession();
    }
    function renderPortalRoute(route) {
      if (!route || route === 'home') { $('homeContent').hidden = false; $('routeView').hidden = true; document.title = 'YNX Chain | 6423 Testnet portal'; return; }
      $('homeContent').hidden = true;
      const view = $('routeView');
      view.hidden = false;
      const snapshot = lastDashboard;
      const summary = snapshot?.summary;
      const blocks = snapshot?.blocks || [];
      const txs = snapshot?.transactions || [];
      const set = (title,copy,body) => { view.innerHTML = routeHead(title,copy) + body; document.title = title + ' | YNX Chain'; };
      const chainFacts = summary ? [['Cosmos chain ID','ynx_6423-1'],['Numeric chain ID',String(summary.network?.chainId || 6423)],['EVM chain ID',String(summary.wallet?.chainIdHex || '0x1917')],['Native asset',String(summary.nativeSymbol || 'YNXT')],['Data source',String(summary.truthfulStatus || 'unavailable')]] : [];
      if (route === 'blockchain') {
        const blockTable = '<div class="record-actions"><label>' + escapeHTML(u('filter')) + ' <select id="blockchainBlockFilter"><option value="all">' + escapeHTML(u('allBlocks')) + '</option><option value="withTransactions">' + escapeHTML(u('withTransactions')) + '</option><option value="empty">' + escapeHTML(u('emptyBlocks')) + '</option></select></label><button type="button" data-share-route="blockchain">' + escapeHTML(r('copyRoute')) + '</button></div><div class="table-shell"><table class="route-table"><thead><tr><th>' + escapeHTML(u('height')) + '</th><th>' + escapeHTML(u('finalized')) + '</th><th>' + escapeHTML(r('transactions')) + '</th><th>' + escapeHTML(u('status')) + '</th><th>' + escapeHTML(u('hash')) + '</th></tr></thead><tbody id="blockchainBlocksBody"><tr><td colspan="5" class="empty">' + escapeHTML(u('loadingRecords')) + '</td></tr></tbody></table></div><div id="blockchainBlocksControls"></div>';
        const txTable = '<div class="record-actions"><label>' + escapeHTML(u('filter')) + ' <select id="blockchainTransactionFilter"><option value="all">' + escapeHTML(u('allTransactionTypes')) + '</option><option value="transfer">' + escapeHTML(u('transfers')) + '</option><option value="resource_sponsored_action">' + escapeHTML(u('resourceActions')) + '</option><option value="faucet">' + escapeHTML(u('faucet')) + '</option></select></label><button type="button" data-share-route="blockchain">' + escapeHTML(r('copyRoute')) + '</button></div><div class="table-shell"><table class="route-table"><thead><tr><th>' + escapeHTML(u('hash')) + '</th><th>' + escapeHTML(u('type')) + '</th><th>' + escapeHTML(u('from')) + '</th><th>' + escapeHTML(u('to')) + '</th><th>' + escapeHTML(u('amount')) + '</th><th>' + escapeHTML(u('copy')) + '</th></tr></thead><tbody id="blockchainTransactionsBody"><tr><td colspan="6" class="empty">' + escapeHTML(u('loadingRecords')) + '</td></tr></tbody></table></div><div id="blockchainTransactionsControls"></div>';
        const contracts = unavailable('No verified 6423 contract-index endpoint is configured. Contract search and detail remain unavailable rather than inferred from arbitrary addresses.');
        set(...routeHeading('blockchain'),'<div class="route-grid two">' + portalPanel(r('networkStatus'),summary ? facts(chainFacts) : unavailable('The 6423 RPC and indexer have not returned a verified snapshot yet.'),summary?.ok ? u('indexerBacked') : r('unavailable')) + portalPanel(r('contracts'),contracts,r('unavailable')) + '</div><section class="section">' + portalPanel(r('blocks'),blockTable,u('verifiedPagination')) + '</section><section class="section">' + portalPanel(r('transactions'),txTable,u('verifiedPagination')) + '</section>');
        $('blockchainBlockFilter').onchange = () => renderBlockchainPage('blocks');
        $('blockchainTransactionFilter').onchange = () => renderBlockchainPage('transactions');
        loadBlockchainPage('blocks');
        loadBlockchainPage('transactions');
        return;
      }
      if (route === 'tokens') {
        const transfers = txs.filter(tx => !tx.resourceConsumed).slice(0,10);
        const body = summary ? '<p>YNXT is the native 6423 asset. Price, market cap, holders, and liquidity remain unavailable until an authoritative source is connected.</p>' + facts([['Symbol','YNXT'],['Network','ynx_6423-1 / 6423 / 0x1917'],['Decimals',String(summary.wallet?.decimals ?? '—')],['Contract','Native asset — no ERC-20 contract is asserted'],['Source','native-token-from-rpc-status']]) : unavailable('Token metadata requires a verified 6423 RPC snapshot.');
        const transferTable = portalTable(transfers,[{label:'Hash',value:t => compact(t.hash,12,8)},{label:'From',value:t => compact(t.from,10,7)},{label:'To',value:t => compact(t.to,10,7)},{label:'Amount',value:t => number(t.amount) + ' YNXT'},{label:'Block',value:t => '#' + number(t.blockNumber)}]);
        const holders = unavailable('A verified native-token holder-list endpoint is not configured. The account leaderboard remains a separate explicitly labeled account-ranking view.');
        set(...routeHeading('tokens'),'<div class="route-grid two">' + portalPanel('YNXT',body,'Native token') + portalPanel(t('tokenRegistry'),'<div class="portal-list"><button type="button" data-search="YNXT">YNXT <small>Native asset · verified metadata</small></button></div>' + unavailable('No public verified token-list endpoint is configured, so unverified assets are not listed or promoted.'),'YNXT only') + '</div><section class="section"><div class="route-grid two">' + portalPanel('YNXT transfer records',transferTable,'Current indexed window') + portalPanel('YNXT holders',holders,r('unavailable')) + '</div></section>'); return;
      }
      if (route === 'data') {
        const rows = summary ? [['Latest block',number(summary.rpcHeight)],['Indexed transactions',number(summary.indexedTxCount)],['Validators',number(summary.validatorCount)],['Indexer lag',number(summary.syncLagBlocks) + ' blocks'],['Snapshot time',exactTime(summary.lastCheckedAt)]] : [];
        const chartCard = (id,title,copy) => '<article class="portal-panel"><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(copy) + '</p><div class="chart-toolbar" role="toolbar" aria-label="' + escapeHTML(title) + ' range"><button type="button" class="active" data-chart-id="' + id + '" data-chart-range="24h">24h</button><button type="button" data-chart-id="' + id + '" data-chart-range="7d">7d</button><button type="button" data-chart-id="' + id + '" data-chart-range="30d">30d</button><button type="button" data-chart-id="' + id + '" data-chart-range="all">All</button></div><div class="chart-empty" id="historyChart-' + id + '" role="status">No authenticated historical 6423 series is available for this metric.<br><small>Source: ' + escapeHTML(serviceDirectory.history.officialURL) + ' · Last verified: unavailable</small></div></article>';
        const charts = chartCard('activity','Blocks & transactions','Verified current indexed counts are above. A time series is intentionally empty until its source can be authenticated.') + chartCard('addresses','Active addresses','The Explorer can show individual verified accounts, but no timestamped active-address series is configured.') + chartCard('gas','Gas & fees','Current transaction fees are verifiable per transaction; aggregate historical gas data is not.') + chartCard('nodes','Nodes & network health','Validator and sync state are live; a historical node-health series is not available.') + chartCard('tokens','Token activity','YNXT is verifiable as the native asset. Historical transfer activity needs a dedicated authenticated series.');
        set(...routeHeading('data'),'<div class="route-grid two">' + portalPanel(r('currentSnapshot'),facts(rows),'Live source') + portalPanel(r('dataPolicy'),'<p>Every chart requires an authenticated timestamped 6423 source. The portal records its source and last-validation state instead of estimating history from a short live window.</p>' + facts([['Service',serviceDirectory.history.name],['Expected identity',serviceDirectory.history.expectedChainID],['Health endpoint',serviceDirectory.history.healthEndpoint],['Degraded behavior',serviceDirectory.history.degraded]]),'Fail closed') + '</div><section class="section"><div class="route-grid two">' + charts + '</div></section>'); return;
      }
      if (route === 'governance') { set(...routeHeading('governance'),'<div class="route-grid two">' + portalPanel('Governance proposals',unavailable('A 6423 governance proposal endpoint is not available from the current Explorer service.'),'Unavailable') + portalPanel('Proposal detail',unavailable('No proposal detail can be shown until a verified proposal ID and 6423 governance source are available.'),'Unavailable') + portalPanel('Voting information',unavailable('No verified vote tally, voter eligibility, or voting window is available.'),'Unavailable') + portalPanel('Governance parameters',unavailable('No verified 6423 parameter snapshot is available.'),'Unavailable') + '</div>'); return; }
      if (route === 'ecosystem') {
        const cards = (ecosystemProducts[language] || ecosystemProducts.en).map(([name,copy,state,platform],index) => '<article class="ecosystem-card"><div class="product-title"><img class="product-mark" src="/assets/ynx-icon.png?v=df071f54b" width="28" height="28" alt="YNX identity mark"><h3>' + escapeHTML(name) + '</h3></div><p>' + escapeHTML(copy) + '</p><span class="product-state">' + escapeHTML(state) + '</span><div class="product-meta"><span><strong>' + escapeHTML(e('support')) + ':</strong> ' + escapeHTML(index === 3 || index === 9 ? e('liveDependent') : e('notPublic')) + '</span><span><strong>' + escapeHTML(e('platforms')) + ':</strong> ' + escapeHTML(platform) + '</span></div><div class="product-actions"><button type="button" disabled aria-disabled="true">' + escapeHTML(e('open')) + '</button><button type="button" disabled aria-disabled="true">' + escapeHTML(e('docs')) + '</button><button type="button" disabled aria-disabled="true">' + escapeHTML(e('download')) + '</button><button type="button" data-portal-note="' + encodeURIComponent(name + ': ' + e('noProductLink')) + '">' + escapeHTML(e('status')) + '</button></div></article>').join('');
        set(...routeHeading('ecosystem'),'<div class="ecosystem-grid">' + cards + '</div>'); return;
      }
      if (route === 'developers') {
        const rpc = summary?.wallet?.rpcUrls?.[0] || 'Unavailable';
        const explorer = summary?.wallet?.blockExplorerUrls?.[0] || 'Unavailable';
        const config = facts([['Cosmos chain ID','ynx_6423-1'],['Numeric chain ID','6423'],['EVM chain ID','0x1917'],['Native asset','YNXT'],['RPC endpoint',rpc],['Explorer endpoint',explorer]]);
        const tools = '<div class="portal-list"><button type="button" data-copy="' + encodeURIComponent(JSON.stringify({chainId:'0x1917',chainName:summary?.wallet?.chainName || 'YNX 6423 Testnet',nativeCurrency:{name:summary?.wallet?.nativeCurrencyName || 'YNXT',symbol:'YNXT',decimals:summary?.wallet?.decimals ?? 18},rpcUrls:summary?.wallet?.rpcUrls || [],blockExplorerUrls:summary?.wallet?.blockExplorerUrls || []},null,2)) + '">Copy Add Network configuration <small>6423 Testnet JSON</small></button><button type="button" data-portal-note="Public API documentation URL is not verified for this portal.">API reference <small>Unavailable</small></button><button type="button" data-portal-note="SDK artifact identity is not verified for download.">SDK & CLI <small>Source-bound only</small></button><button type="button" data-portal-note="Faucet availability must be verified independently before opening.">Faucet <small>Check status first</small></button></div>';
        set(...routeHeading('developers'),'<div class="route-grid two">' + portalPanel('YNX 6423 configuration',config,'Testnet only') + portalPanel('Tools & documentation',tools) + '</div><section class="section">' + portalPanel('6423 service directory',serviceDirectoryTable(),'Verified Explorer and stream entries update in this browser session; unavailable services fail closed.') + '</section>'); return;
      }
      if (route === 'downloads') {
        const products = [
          ['YNX Wallet browser extension','Browser extension','Unavailable'],['YNX Wallet desktop','macOS / Windows / Linux','Unavailable'],['YNX Wallet mobile','Android / iOS','Unavailable'],['Developer CLI and SDK','Developer tooling','Unavailable'],['YNX web applications','Web / PWA','Unavailable'],['Other ecosystem applications','Product-specific platforms','Unavailable']
        ];
        const items = products.map(([name,platform,status]) => '<article class="download-item"><strong>' + escapeHTML(name) + '</strong><span><strong>Platform:</strong> ' + escapeHTML(platform) + '</span><span><strong>Version:</strong> Unavailable</span><span><strong>Size:</strong> Unavailable</span><span><strong>SHA-256:</strong> Unavailable</span><span><strong>Signing:</strong> Unavailable</span><span><strong>Source / published:</strong> Unavailable</span><span><strong>Install:</strong> Public artifact verification is required before instructions are shown.</span><span class="product-state">' + escapeHTML(status) + '</span><button type="button" disabled aria-disabled="true">Download unavailable</button></article>').join('');
        set(...routeHeading('downloads'),'<div class="download-grid">' + items + '</div>'); return;
      }
      if (route === 'documentation') { set(...routeHeading('documentation'),'<div class="route-grid two">' + portalPanel('Using this portal','<div class="portal-list"><a href="#blockchain" data-route="blockchain">Search and browse blocks, transactions, and accounts</a><a href="#developers" data-route="developers">Use verified Testnet identifiers</a><a href="#downloads" data-route="downloads">Review download evidence requirements</a></div>') + portalPanel('Status policy',unavailable('A product, download, or service with no verified public evidence is shown as unavailable instead of being linked to a placeholder.')) + '</div>'); return; }
      renderPortalRoute('home');
    }
    function updateSearchSuggestions() {
      const query = String($('searchInput').value || '').trim();
      const box = $('searchSuggestions');
      if (!query) { box.hidden = true; box.innerHTML = ''; return; }
      const lower = query.toLowerCase();
      const snapshot = lastDashboard || {};
      const suggestions = [];
      const add = (value,label,kind) => { if (value && !suggestions.some(item => item.value === value)) suggestions.push({value,label,kind}); };
      (snapshot.blocks || []).filter(block => String(block.height).includes(lower) || String(block.hash || '').toLowerCase().includes(lower)).slice(0,3).forEach(block => add(String(block.height),'Block #' + number(block.height),'Block'));
      (snapshot.transactions || []).filter(tx => [tx.hash,tx.from,tx.to].some(value => String(value || '').toLowerCase().includes(lower))).slice(0,3).forEach(tx => add(tx.hash,compact(tx.hash,14,9),'Transaction'));
      if ('ynxt'.includes(lower) || lower.includes('ynxt')) add('YNXT','YNXT native token','Token');
      const validators = Array.isArray(snapshot.validatorData) ? snapshot.validatorData : (snapshot.validatorData?.validators || []);
      validators.filter(validator => [validator.moniker,validator.address].some(value => String(value || '').toLowerCase().includes(lower))).slice(0,2).forEach(validator => add(validator.address,validator.moniker || compact(validator.address,14,9),'Validator address'));
      if (/^\d+$/.test(query)) add(query,'Search block height #' + query,'Block');
      if (/^0x[0-9a-f]+$/i.test(query)) add(query,'Search transaction or EVM-compatible address','Transaction / address');
      if (suggestions.length === 0) add(query,'Search current 6423 index','Search');
      box.innerHTML = suggestions.slice(0,6).map(item => '<button type="button" role="option" data-suggestion="' + encodeURIComponent(item.value) + '"><span class="mono">' + escapeHTML(item.label) + '</span><small>' + escapeHTML(item.kind) + '</small></button>').join('');
      box.hidden = false;
    }
    function closeSearchSuggestions() { $('searchSuggestions').hidden = true; }
    async function search(query) {
      const q = String(query || $('searchInput').value).trim();
      if (!q) return;
      closeSearchSuggestions();
      $('searchInput').value = q;
      $('detailKicker').textContent = 'Searching live chain data';
      $('detailTitle').textContent = compact(q,18,10);
      $('detailContent').innerHTML = '<div class="empty">Resolving RPC and indexer records...</div>';
      $('detailBackdrop').classList.add('visible');
      $('detailBackdrop').setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
      try {
        const resolved = await get('/api/search?q=' + encodeURIComponent(q));
        setDetailLocation(resolved.type,resolved.query || q);
      } catch (error) {
        $('detailKicker').textContent = 'Search result';
        $('detailTitle').textContent = 'Not found';
        $('detailContent').innerHTML = '<div class="result-error">' + escapeHTML(clientError(error,'No matching verified 6423 record was found.')) + '</div>';
      }
    }
    $('searchForm').onsubmit = event => { event.preventDefault(); search(); };
    $('searchInput').oninput = updateSearchSuggestions;
    $('searchInput').onfocus = updateSearchSuggestions;
    $('searchInput').onkeydown = event => { if (event.key === 'Escape') closeSearchSuggestions(); };
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
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      const metamask = walletProviders.find(item => item.provider?.isMetaMask === true && item.provider?.isYNXWallet !== true) || (window.ethereum?.isMetaMask === true && window.ethereum?.isYNXWallet !== true ? {provider:window.ethereum} : null);
      if (!metamask) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'MetaMask not detected'; $('resultSubtitle').textContent = 'YNX Wallet is intentionally not used as a MetaMask fallback.'; $('resultBody').innerHTML = '<div class="result-error">Open MetaMask or install an EIP-1193 MetaMask provider to use the compatibility adapter.</div>'; return; }
      if (!walletConfig) await load();
      try {
        await metamask.provider.request({method:'wallet_addEthereumChain',params:[{chainId:walletConfig.chainIdHex,chainName:walletConfig.chainName,nativeCurrency:{name:walletConfig.nativeCurrencyName,symbol:walletConfig.nativeSymbol,decimals:walletConfig.decimals},rpcUrls:walletConfig.rpcUrls,blockExplorerUrls:walletConfig.blockExplorerUrls}]});
        await metamask.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:expected6423.evmChainId}]});
        $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Compatibility request sent'; $('resultSubtitle').textContent = 'Confirm the YNX Testnet EVM adapter in MetaMask.'; $('resultBody').innerHTML = '<div class="empty">YNX-native applications continue to identify this account with its ynx1 address.</div>';
      } catch (error) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = 'Wallet request declined'; $('resultBody').innerHTML = '<div class="result-error">' + escapeHTML(error.message) + '</div>'; }
    };
    const walletProviders = [];
    window.addEventListener('eip6963:announceProvider', event => {
      const detail = event.detail;
      if (detail?.provider && !walletProviders.some(item => item.provider === detail.provider)) walletProviders.push(detail);
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    $('walletConnectButton').onclick = async () => {
      if (connectedYNXWallet) { showWalletSession(); return; }
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      const ynx = walletProviders.find(item => item.provider?.isYNXWallet === true && item.provider?.isMetaMask !== true) || (window.ethereum?.isYNXWallet === true && window.ethereum?.isMetaMask !== true ? {provider:window.ethereum} : null);
      if (!ynx) { showPortalNotice('YNX Wallet provider is not detected. No account request, local session, or fallback to MetaMask was made.'); return; }
      try {
        const accounts = await ynx.provider.request({method:'eth_requestAccounts'});
        const account = Array.isArray(accounts) && accounts[0] ? accounts[0] : 'No account returned';
        const chainId = await readWalletChain(ynx.provider);
        connectedYNXWallet = {provider:ynx.provider,account,chainId};
        attachWalletListeners(ynx.provider);
        serviceRuntime.get('wallet').lastVerifiedAt = new Date().toISOString();
        serviceRuntime.get('wallet').lastError = null;
        updateWalletButton();
        showWalletSession();
      } catch (error) { showPortalNotice('YNX Wallet connection was not approved: ' + (error?.message || 'request declined')); }
    };
    $('moreButton').onclick = () => { const wrap = $('moreButton').closest('.more-wrap'); const open = !wrap.classList.contains('open'); wrap.classList.toggle('open',open); $('moreButton').setAttribute('aria-expanded',String(open)); };
    document.addEventListener('click',async event => {
      const suggestion = event.target.closest('[data-suggestion]');
      if (suggestion) { $('searchInput').value = decodeURIComponent(suggestion.dataset.suggestion); search(); return; }
      const page = event.target.closest('[data-page-kind]');
      if (page && !page.disabled) { loadBlockchainPage(page.dataset.pageKind,Number(page.dataset.pageOffset || 0)); return; }
      const share = event.target.closest('[data-share-route]');
      if (share) { try { await navigator.clipboard.writeText(location.origin + '/#' + share.dataset.shareRoute); showToast('Route copied'); } catch (_) { showToast('Clipboard unavailable'); } return; }
      const copy = event.target.closest('[data-copy]');
      if (copy) { try { await navigator.clipboard.writeText(decodeURIComponent(copy.dataset.copy)); showToast('Copied to clipboard'); } catch (_) { showToast('Clipboard unavailable'); } return; }
      const range = event.target.closest('[data-chart-range]');
      if (range) { const id = range.dataset.chartId || 'activity'; document.querySelectorAll('[data-chart-id="' + id + '"][data-chart-range]').forEach(button => button.classList.toggle('active',button === range)); const chart = $('historyChart-' + id); if (chart) chart.innerHTML = 'Range: <strong>' + escapeHTML(range.dataset.chartRange) + '</strong>. No verified historical 6423 records are available for this interval, so this chart remains intentionally empty.<br><small>Source: ' + escapeHTML(serviceDirectory.history.officialURL) + ' · Last verified: unavailable</small>'; return; }
      const route = event.target.closest('[data-route]');
      if (route) { event.preventDefault(); const next = route.dataset.route; if (location.hash.slice(1) !== next) location.hash = next; else renderPortalRoute(next); $('moreButton').closest('.more-wrap').classList.remove('open'); $('moreButton').setAttribute('aria-expanded','false'); return; }
      const quick = event.target.closest('[data-search]');
      if (quick) { const value = quick.dataset.search === 'latest' ? String(lastDashboard?.summary?.rpcHeight || '') : quick.dataset.search; search(value); return; }
      const note = event.target.closest('[data-portal-note]');
      if (note) { showPortalNotice(decodeURIComponent(note.dataset.portalNote)); return; }
      const download = event.target.closest('[data-download]');
      if (download) { showPortalNotice('No publicly verifiable download artifact is configured for ' + download.dataset.download + '.'); }
      const walletAction = event.target.closest('[data-wallet-session]');
      if (walletAction?.dataset.walletSession === 'disconnect') { clearWalletSession(); showPortalNotice('The YNX Wallet account was cleared from this portal. No wallet permission, signature, or transaction was changed.'); return; }
      if (walletAction?.dataset.walletSession === 'network') { try { await switchYNXWalletNetwork(); } catch (error) { showPortalNotice('YNX Wallet network change was not approved: ' + (error?.message || 'request declined')); } return; }
      if (walletAction?.dataset.walletSession === 'switch') { if (!connectedYNXWallet?.provider) return; try { const accounts = await connectedYNXWallet.provider.request({method:'eth_accounts'}); const account = Array.isArray(accounts) && accounts[0] ? accounts[0] : null; if (!account) { clearWalletSession('No provider account is currently exposed.'); showPortalNotice('No YNX Wallet account is currently exposed to this portal.'); return; } connectedYNXWallet.account = account; connectedYNXWallet.chainId = await readWalletChain(connectedYNXWallet.provider); updateWalletButton(); showWalletSession(); } catch (error) { showPortalNotice('YNX Wallet account refresh failed: ' + (error?.message || 'provider unavailable')); } }
    });
    window.addEventListener('hashchange',renderLocation);
    function showLoadError() { $('statusText').textContent = 'Explorer unavailable'; $('statusDetail').textContent = 'The verified 6423 data source is unavailable. Refresh to retry.'; $('status').className = 'status-bar warn'; $('refreshButton').disabled = false; removeSkeletons(); }
    applyLanguage(language);
    load().catch(showLoadError);
    connectLiveStream();
    renderLocation();
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
