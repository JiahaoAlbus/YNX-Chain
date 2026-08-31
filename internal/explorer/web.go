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
    html { -webkit-text-size-adjust:100%; text-size-adjust:100%; }
    body { background:var(--page); font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; font-size:clamp(14px,0.18vw + 13px,16px); }
    img,svg,canvas { max-width:100%; }
    button,input,select,textarea { max-width:100%; min-width:0; }
    .shell { width:min(1430px,calc(100% - 48px)); }
    .nav { position:relative; height:64px; background:rgba(255,255,255,.96); border-bottom:1px solid var(--line); backdrop-filter:none; }
    .nav-inner { gap:28px; }
    .brand { gap:9px; font-size:15px; font-weight:760; letter-spacing:-.2px; }
    .brand-logo { width:30px; height:30px; max-width:30px; }
    .nav-links { gap:0; margin-left:0; font-size:clamp(12px,0.24vw + 11px,14px); color:#242833; }
    .nav-links a,.nav-links button { display:inline-flex; align-items:center; height:64px; padding:0 16px; border:0; border-bottom:3px solid transparent; color:inherit; background:transparent; font:inherit; white-space:nowrap; }
    .nav-links a:hover,.nav-links a:focus-visible,.nav-links button:hover,.nav-links button:focus-visible { color:var(--blue); border-bottom-color:var(--blue); outline:0; }
    .nav-actions { display:flex; align-items:center; gap:14px; margin-left:auto; color:#555d69; font-size:13px; white-space:nowrap; }
    .nav-actions a { color:inherit; }
    .nav-actions a:hover { color:var(--blue); }
    .wallet-connect { height:36px; padding:0 14px; border:0; border-radius:5px; color:#fff; background:#151820; font-size:13px; font-weight:700; }
    .wallet-connect:hover { background:var(--blue); }
    .network-pill { display:none; }
    .language-select { height:32px; padding-left:8px; border-color:var(--line); background:#fff; }
    .route-head h1 { font-size:clamp(23px,1.4vw + 17px,32px); line-height:1.15; overflow-wrap:anywhere; }
    .route-head p { font-size:clamp(13px,0.24vw + 12px,15px); overflow-wrap:anywhere; }
    .portal-panel h2,.panel-head h2,.section-head h2 { font-size:clamp(16px,0.55vw + 14px,20px); overflow-wrap:anywhere; }
    .metric-label { font-size:clamp(12px,0.2vw + 11px,13px); }
    .metric-value { font-size:clamp(19px,1.1vw + 14px,25px); line-height:1.08; }
    .portal-panel,.download-item,.ecosystem-card { min-width:0; }
    .route-table th,.route-table td { overflow-wrap:anywhere; }
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
    .portal-callout { display:flex; flex-direction:column; justify-content:space-between; min-height:0; padding:14px 16px; border:1px solid #dce5ff; border-radius:7px; color:#fff; background:var(--blue); }
    .portal-callout p { margin:0; color:#bfd0ff; font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
    .portal-callout h2 { max-width:320px; margin:5px 0 9px; font-size:17px; line-height:1.18; letter-spacing:-.25px; }
    .portal-callout-links { display:flex; flex-wrap:wrap; gap:9px; }
    .portal-callout-links a { padding:6px 9px; border:1px solid rgba(255,255,255,.34); border-radius:4px; color:#fff; font-size:12px; }
    .portal-callout-links a:hover { background:#fff; color:var(--blue); }
    .portal-callout-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; margin:8px 0; }
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
    .ribbon-label > span:first-child,.ribbon-label strong { display:none; }
    .ribbon-label .ribbon-heading { display:block; color:#1d2028; font-size:21px; font-weight:750; }
    .ribbon-label .ribbon-more { color:#596271; font-size:13px; font-weight:500; }
    .ribbon-label .ribbon-more:hover { color:var(--blue); }
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
    .route-grid > * { min-width:0; }
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
    .chart-window { display:grid; grid-template-columns:repeat(auto-fit,minmax(16px,1fr)); align-items:end; gap:5px; min-height:210px; padding:20px 16px 28px; border:1px solid #dce4f4; border-radius:6px; background:linear-gradient(180deg,#fcfdff,#f7f9ff); }
    .chart-window button { display:grid; align-items:end; min-width:0; height:158px; padding:0; border:0; border-radius:4px 4px 2px 2px; background:transparent; cursor:pointer; }
    .chart-window button:hover .chart-bar,.chart-window button:focus-visible .chart-bar { background:#0d4bc7; outline:0; }
    .chart-bar { display:block; width:100%; min-height:4px; border-radius:4px 4px 1px 1px; background:#2b63d9; transition:background .16s ease; }
    .chart-window-caption { grid-column:1 / -1; margin:8px 0 -12px; color:var(--muted); font-size:11px; line-height:1.4; }
    .code-sample { margin:0; padding:16px; overflow:auto; border:1px solid #dce4f4; border-radius:6px; color:#173a82; background:#f7f9ff; font:12px/1.6 var(--mono); white-space:pre; }
    @media (max-width:760px) { .route-grid,.route-grid.two { grid-template-columns:1fr; } .route-head { align-items:flex-start; flex-direction:column; } }
    @media (max-width:1360px) { .nav { height:auto; } .nav-inner { height:auto; flex-wrap:wrap; min-height:58px; padding:9px 0; } .nav-links { order:3; width:100%; overflow-x:auto; } .nav-links a,.nav-links button { height:42px; padding:0 9px; } }
    @media (max-width:1050px) { .hero-grid,.network-summary { grid-template-columns:1fr; } .portal-callout { min-height:0; } .ecosystem-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:760px) { .shell { width:min(100% - 24px,1430px); } .nav { height:auto; } .nav-inner { flex-wrap:wrap; min-height:58px; gap:4px 12px; padding:9px 0; } .nav-links { order:3; width:100%; overflow:auto; scroll-snap-type:x proximity; scrollbar-width:thin; scrollbar-color:#c6d1e5 transparent; } .nav-links a,.nav-links button { height:38px; padding:0 10px; font-size:12px; scroll-snap-align:start; } .nav-links .more-wrap { position:sticky; right:0; z-index:2; margin-left:8px; background:#fff; box-shadow:-12px 0 14px #fff; } .nav-actions { gap:8px; } .nav-actions a { display:none; } .metrics { grid-template-columns:1fr 1fr; } .metric:nth-child(2n) { border-right:0; } .metric:nth-child(n+5) { border-bottom:0; } .block-track { overflow:auto; padding-bottom:2px; } .block-chip { flex:0 0 220px; } .overview { grid-template-columns:1fr; } .download-grid { grid-template-columns:1fr; } .ecosystem-grid { grid-template-columns:1fr; } }
    /* The final responsive layer wins over the dense desktop presentation above. */
    .route-head h1 { font-size:clamp(23px,1.4vw + 17px,32px); line-height:1.15; }
    .metric-value { font-size:clamp(19px,1.1vw + 14px,25px); line-height:1.08; }
    /* Keep the dense desktop hierarchy, while allowing text and controls to
       breathe on narrow or unusually shaped browser windows.  Browser zoom
       still uses the user agent's normal scaling; these rules only govern
       responsive layout. */
    @media (max-width:480px) {
      .route-head h1 { font-size:clamp(22px,6vw + 3px,27px); }
      .metric-value { font-size:clamp(18px,4vw + 4px,22px); }
      .portal-panel,.download-item { padding:16px; }
      .code-sample { padding:12px; font-size:11px; }
      .chart-window { gap:4px; padding:16px 10px 24px; }
      .chart-window button { height:132px; }
      .announcement .shell { align-items:flex-start; padding:9px 0; font-size:clamp(11px,2.9vw,13px); line-height:1.4; }
      .announcement a { flex:none; }
      .nav-actions { width:100%; justify-content:space-between; margin-left:0; }
      .language-select { min-width:0; flex:1 1 auto; }
      .wallet-connect { min-width:0; max-width:52%; padding:0 11px; overflow:hidden; text-overflow:ellipsis; }
      .search input { height:52px; padding-right:94px; padding-left:42px; font-size:clamp(13px,3.6vw,15px); }
      .search button { height:40px; padding:0 12px; font-size:12px; }
      .trending { gap:7px 12px; font-size:12px; }
      .portal-callout { padding:18px; }
      .portal-callout h2 { font-size:clamp(16px,5vw,20px); }
      .portal-callout-links { gap:6px; }
      .portal-callout-links a { flex:1 1 auto; text-align:center; }
      .status-bar { align-items:flex-start; gap:7px; font-size:11px; }
      .status-bar .refresh { min-height:30px; }
      .metric { min-height:104px; padding:16px 14px; }
      .metric-label { font-size:clamp(11px,3.1vw,13px); }
      .asset-overview-head { align-items:flex-start; flex-direction:column; }
      .block-chip { flex-basis:190px; min-height:116px; padding:15px; }
      .block-chip strong { font-size:clamp(15px,4.7vw,17px); }
      .live-row { min-height:58px; padding:8px 12px; }
      .row-title,.row-side strong { font-size:12px; }
      .row-subtitle,.row-side { font-size:11px; }
      .address-chip { max-width:78px; }
      .flow-arrow { width:18px; }
      .page-controls { align-items:flex-start; flex-direction:column; }
      .page-controls div { width:100%; }
      .page-controls button { flex:1 1 0; }
      .detail-summary { grid-template-columns:1fr; }
      .detail-row { grid-template-columns:1fr auto; gap:5px 10px; }
      .detail-row dd { grid-column:1 / -1; }
      .detail-row .copy-button { grid-column:2; grid-row:1; }
      .toast { width:min(calc(100% - 24px),460px); text-align:center; }
    }
    /* Keep keyboard position unmistakable without changing the compact
       information hierarchy.  This deliberately wins over component hover
       treatments that remove the browser default outline. */
    body :is(a,button,input,select,textarea,[tabindex]):focus-visible { outline:3px solid #2b63d9!important; outline-offset:3px; }
    .skip-link { position:fixed; top:10px; left:12px; z-index:100; padding:10px 13px; border-radius:5px; color:#fff; background:#002fa7; box-shadow:0 8px 20px rgba(0,34,123,.24); transform:translateY(-160%); transition:transform .16s ease; }
    .skip-link:focus { transform:translateY(0); }
  </style>
</head>
<body>
  <a class="skip-link" id="skipLink" href="#homeContent" data-a11y-i18n="skipToContent">Skip to content</a>
  <nav class="nav" data-i18n-aria="primaryNavigation" aria-label="Primary navigation">
    <div class="shell nav-inner">
      <a class="brand" href="#top" data-i18n-aria="explorerHome" aria-label="YNX Chain Explorer home"><img class="brand-logo" src="/assets/ynx-logo.png?v=df071f54b" width="30" height="30" alt=""><span>YNX Chain</span></a>
      <div class="nav-links">
        <a href="#home" data-route="home" data-i18n="home">Home</a><span class="nav-menu"><a href="#blockchain" data-route="blockchain" data-i18n="blockchain">Blockchain</a><span class="more-popover"><a href="#blockchain" data-route="blockchain" data-i18n="blocksTransactions">Blocks &amp; transactions</a><a href="#blockchain" data-route="blockchain" data-i18n="addressesContracts">Addresses &amp; contracts</a><a href="#blockchain" data-route="blockchain" data-i18n="validatorsStatus">Validators &amp; network status</a></span></span><span class="nav-menu"><a href="#tokens" data-route="tokens" data-i18n="tokens">Tokens</a><span class="more-popover"><a href="#tokens" data-route="tokens" data-i18n="ynxtNative">YNXT native asset</a><a href="#tokens" data-route="tokens" data-i18n="tokenRegistry">Verified token registry</a></span></span><span class="nav-menu"><a href="#data" data-route="data" data-i18n="data">Data</a><span class="more-popover"><a href="#data" data-route="data" data-i18n="networkActivity">Network activity</a><a href="#data" data-route="data" data-i18n="dataSourceStatus">Data source status</a></span></span><a href="#governance" data-route="governance" data-i18n="governance">Governance</a><span class="nav-menu"><a href="#ecosystem" data-route="ecosystem" data-i18n="ecosystem">YNX Ecosystem</a><span class="more-popover"><a href="#ecosystem" data-route="ecosystem" data-i18n="walletPermissions">Wallet &amp; permissions</a><a href="#ecosystem" data-route="ecosystem" data-i18n="defiPayments">DeFi &amp; Payments</a><a href="#ecosystem" data-route="ecosystem" data-i18n="developerInfrastructure">Developer &amp; Infrastructure</a><a href="#ecosystem" data-route="ecosystem" data-i18n="aiSocialDataMedia">AI, Social, Data &amp; Media</a><a href="#ecosystem" data-route="ecosystem" data-i18n="commerce">Commerce</a></span></span><span class="nav-menu"><a href="#developers" data-route="developers" data-i18n="developers">Developers</a><span class="more-popover"><a href="#developers" data-route="developers" data-i18n="networkConfiguration">Network configuration</a><a href="#developers" data-route="developers" data-i18n="sdkCliContracts">SDK, CLI &amp; contracts</a><a href="#developers" data-route="developers" data-i18n="faucetServiceStatus">Faucet &amp; service status</a></span></span><a href="#downloads" data-route="downloads" data-i18n="downloads">Downloads</a><span class="more-wrap"><button id="moreButton" type="button" aria-expanded="false" aria-controls="morePopover" data-i18n="more">More</button><span class="more-popover" id="morePopover"><a href="#blockchain" data-route="blockchain" data-i18n="validatorsNodes">Validators &amp; nodes</a><a href="#blockchain" data-route="blockchain" data-i18n="accounts">Accounts</a><a href="#documentation" data-route="documentation" data-i18n="documentation">Documentation</a></span></span>
      </div>
      <div class="nav-actions"><span id="networkName" hidden>Testnet</span><a href="#documentation" data-route="documentation" data-i18n="docs">Docs</a><select class="language-select" id="languageSelect" data-i18n-aria="language" aria-label="Language"><option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="ko">한국어</option></select><button class="wallet-connect" id="walletConnectButton" type="button" data-i18n="connectWallet">Connect Wallet</button></div>
    </div>
  </nav>

  <div class="announcement" role="status"><div class="shell"><span class="announcement-dot"></span><strong data-i18n="portalAnnouncement">YNX 6423 Testnet portal</strong><span data-i18n="portalLivePolicy">Live figures appear only when the RPC and indexer agree.</span><a href="#documentation" data-i18n="readDataPolicy">Read the data policy</a></div></div>

  <header class="hero" id="top">
    <div class="shell">
      <div class="hero-grid"><div><p class="eyebrow" data-home-i18n="testnet">YNX Testnet</p><h1 data-i18n="heroTitle">YNX Chain network explorer</h1><p class="hero-copy" data-i18n="heroCopy">Live blocks, transactions, validators, accounts, fees, and native YNXT resource economics from the public testnet.</p>
        <div class="search-wrap"><form class="search" id="searchForm"><input id="searchInput" data-i18n-aria="searchChain" aria-label="Search the chain" aria-autocomplete="list" aria-controls="searchSuggestions" data-i18n-placeholder="searchPlaceholder" placeholder="Search token, account, contract, transaction, or block" autocomplete="off" spellcheck="false"><button type="submit" data-i18n="search">Search</button></form><div class="search-suggestions" id="searchSuggestions" role="listbox" hidden></div></div>
        <div class="trending"><span class="trending-label" data-home-i18n="quickSearch">Quick search:</span><button type="button" data-search="latest" data-home-i18n="latestBlock">Latest block</button><button type="button" data-search="YNXT" data-home-i18n="ynxtToken">YNXT token</button><button type="button" data-search="6423" data-home-i18n="block6423">Block 6423</button><button type="button" data-search="0x1917" data-home-i18n="evmNetwork">EVM network</button></div>
        <div class="status-bar" id="status"><span class="state"><span class="pulse"></span><span id="statusText" data-initial-i18n="connecting">Connecting</span></span><span id="statusDetail" data-initial-i18n="readingState">Reading RPC and indexer state</span><span class="stream-clock" id="streamClock"><span class="stream-dot"></span><span id="streamClockText" data-initial-i18n="openingStream">Opening live stream</span></span><button class="refresh" id="refreshButton" type="button" data-live-i18n="refresh">Refresh</button></div>
        <div class="hero-meta"><span><span class="pulse"></span><span data-initial-i18n="verifiedSources">RPC + indexer verified</span></span><span id="lastUpdated" data-initial-i18n="connectingNetwork">Connecting to the network</span><span id="heroHeight" data-initial-i18n="awaitingLatestBlock">Waiting for the latest block</span></div>
      </div><aside class="portal-callout"><div><p data-home-i18n="developerEntry">Developer entry point</p><h2 data-home-i18n="developerCallout">Build and inspect on YNX 6423.</h2><div class="portal-callout-stats" aria-label="YNX network identity"><span><small data-live-i18n="chain">Chain</small><strong>6423</strong></span><span><small data-initial-i18n="evm">EVM</small><strong>0x1917</strong></span><span><small data-live-i18n="native">Native</small><strong>YNXT</strong></span></div></div><div class="portal-callout-links"><a href="#developers" data-home-i18n="developerTools">Developer tools</a><a href="#documentation" data-i18n="documentation">Documentation</a><a href="#downloads" data-i18n="downloads">Downloads</a></div></aside></div>
      <section class="result-panel" id="resultPanel" aria-live="polite">
        <div class="panel-head"><div><h2 id="resultTitle">Search result</h2><p id="resultSubtitle"></p></div><button class="result-close" id="resultClose" type="button">Close</button></div>
        <div id="resultBody"></div>
      </section>
    </div>
  </header>

  <main id="homeContent" tabindex="-1">
    <div class="shell">
      <section class="network-summary" data-i18n-aria="networkSummary" aria-label="Network summary">
      <div class="metrics" data-i18n-aria="networkMetrics" aria-label="Network metrics">
        <article class="metric"><div class="metric-label" data-i18n="latestBlock">Latest block</div><div class="metric-value skeleton" id="rpcHeight">0000</div><div class="metric-foot" id="blockAge">Waiting for block data</div></article>
        <article class="metric"><div class="metric-label" data-i18n="networkTps">Network TPS</div><div class="metric-value skeleton" id="networkTps">0.00</div><div class="metric-foot" data-i18n="indexedWindow">Latest indexed window</div></article>
        <article class="metric"><div class="metric-label" data-i18n="blockTime">Block time</div><div class="metric-value skeleton" id="blockTime">0.0s</div><div class="metric-foot" data-i18n="observedAverage">Observed average</div></article>
        <article class="metric"><div class="metric-label" data-i18n="indexedTxs">Transactions indexed</div><div class="metric-value skeleton" id="txCount">0000</div><div class="metric-foot" data-i18n="verifiedIndexer">Verified by the indexer</div></article>
        <article class="metric"><div class="metric-label" data-i18n="validators">Validators</div><div class="metric-value skeleton" id="validatorCount">00</div><div class="metric-foot" data-i18n="reportedRpc">Reported by chain RPC</div></article>
        <article class="metric"><div class="metric-label" data-i18n="indexerSync">Indexer sync</div><div class="metric-value skeleton" id="syncValue">0 blocks</div><div class="metric-foot" id="syncState">Checking consistency</div></article>
      </div>
      <aside class="asset-overview" data-i18n-aria="assetSummary" aria-label="YNXT network summary"><div class="asset-overview-head"><div class="asset-token"><img src="/assets/ynx-icon.png?v=df071f54b" width="34" height="34" alt=""><div><strong>YNXT</strong><small data-live-i18n="nativeAsset">Native asset · 6423</small></div></div><div><strong id="assetTruthState" data-initial-i18n="connecting">Connecting</strong><small data-live-i18n="networkSource">Network source</small></div></div><div class="asset-overview-body"><div class="asset-fact"><span data-live-i18n="chainIdentity">Chain identity</span><strong>6423 / 0x1917</strong><small>ynx_6423-1</small></div><div class="asset-fact"><span data-i18n="validators">Validators</span><strong id="assetValidatorCount">--</strong><small data-i18n="reportedRpc">Reported by RPC</small></div><div class="asset-fact"><span data-i18n="accounts">Accounts</span><strong id="assetAccountCount">--</strong><small data-i18n="verifiedIndexer">Verified by the indexer</small></div><div class="asset-fact"><span data-live-i18n="lastVerified">Last verified</span><strong id="assetVerifiedAt">--</strong><small id="assetHeight" data-initial-i18n="awaitingLatestBlock">Awaiting latest block</small></div></div></aside>
      </section>

      <section class="block-ribbon" data-i18n-aria="liveBlockStream" aria-label="Live finalized block stream">
        <div class="ribbon-label"><span data-home-i18n="finality">FINALITY</span><span class="ribbon-heading" data-live-i18n="blocks">Blocks</span><a class="ribbon-more" href="#blockchain" data-route="blockchain" data-live-i18n="more">More</a><strong id="finalityState" data-initial-i18n="connecting">Connecting</strong></div>
        <div class="block-track" id="blockTrack"><div class="empty" data-initial-i18n="waitingFinalizedBlocks">Waiting for finalized blocks...</div></div>
      </section>

      <section class="overview" id="network">
        <article class="panel" id="blocks">
          <div class="panel-head"><div><h2 data-i18n="latestBlocks">Live blocks</h2><p data-i18n="latestBlocksCopy">Finalized blocks arriving now</p></div><span class="stream-clock live"><span class="stream-dot"></span><span data-i18n="live">Live</span></span></div>
          <div class="live-list" id="blocksBody"><div class="empty" data-initial-i18n="loadingBlocks">Loading blocks...</div></div>
        </article>
        <article class="panel" id="transactions">
          <div class="panel-head"><div><h2 data-i18n="latestTransactions">Live transactions</h2><p data-i18n="latestTransactionsCopy">Newest indexed transfers and actions</p></div><div class="filter-control"><input id="txQuickFind" data-i18n-placeholder="quickFindPlaceholder" placeholder="Find hash, address, amount…" data-i18n-aria="quickFindTransactions" aria-label="Quick find transactions"><select id="txFilter" data-i18n-aria="filterTransactionType" aria-label="Filter transaction type"><option value="all" data-i18n="all" data-initial-i18n="all">All</option><option value="transfer" data-i18n="transfers" data-initial-i18n="transfers">Transfers</option><option value="resource" data-i18n="resources" data-initial-i18n="resources">Resources</option><option value="faucet" data-i18n="faucet" data-initial-i18n="faucet">Faucet</option></select></div></div>
          <div class="live-list" id="txsBody"><div class="empty" data-initial-i18n="loadingTransactions">Loading transactions...</div></div>
        </article>
        <article class="panel network-facts-panel">
          <div class="panel-head"><div><h2 data-i18n="networkDetails">Network details</h2><p data-i18n="networkDetailsCopy">Current chain configuration</p></div></div>
          <dl class="chain-facts">
            <div class="fact"><dt data-initial-i18n="chainID">Chain ID</dt><dd class="mono" id="chainId">--</dd></div>
            <div class="fact"><dt data-initial-i18n="nativeCoin">Native coin</dt><dd id="nativeCoin">YNXT</dd></div>
            <div class="fact"><dt data-initial-i18n="latestHash">Latest hash</dt><dd class="mono hash" id="latestHash">--</dd></div>
            <div class="fact"><dt data-initial-i18n="dataSource">Data source</dt><dd id="truthState" data-initial-i18n="rpcIndexer">RPC + Indexer</dd></div>
          </dl>
        </article>
      </section>

      <section class="intelligence" id="intelligence">
        <div class="section-head"><div><h2 data-home-i18n="intelligence">Network intelligence</h2><p data-home-i18n="intelligenceCopy">Validator and resource-economy state from live chain APIs</p></div></div>
        <div class="segmented" role="tablist" data-i18n-aria="networkIntelligenceViews" aria-label="Network intelligence views">
          <button class="segment active" id="validatorsTab" type="button" role="tab" aria-selected="true" aria-controls="validatorsPanel" data-i18n="validators">Validators</button>
          <button class="segment" id="resourcesTab" type="button" role="tab" aria-selected="false" aria-controls="resourcesPanel" data-home-i18n="resourceEconomy">Resource economy</button>
        </div>
        <div class="intelligence-panel active" id="validatorsPanel" role="tabpanel" aria-labelledby="validatorsTab">
          <div class="table-shell"><table class="blocks-table"><thead><tr><th style="width:24%" data-initial-i18n="validator">Validator</th><th style="width:22%" data-initial-i18n="role">Role</th><th style="width:18%" data-initial-i18n="status">Status</th><th style="width:18%" data-initial-i18n="votingPower">Voting power</th><th style="width:18%" data-initial-i18n="observedHeight">Observed height</th></tr></thead><tbody id="validatorsBody"><tr><td colspan="5" class="empty" data-initial-i18n="loadingValidators">Loading validators...</td></tr></tbody></table></div>
        </div>
        <div class="intelligence-panel" id="resourcesPanel" role="tabpanel" aria-labelledby="resourcesTab">
          <div class="resource-metrics" id="resourceMetrics"><article class="resource-item"><small data-initial-i18n="loadingResourceMarket">Loading resource market</small></article></div>
          <div class="policy-line" id="resourcePolicy"></div>
        </div>
      </section>

      <section class="section" id="accounts">
        <div class="section-head"><div><h2 data-i18n="accountLeaderboard">YNXT account leaderboard</h2><p data-i18n="accountLeaderboardCopy">Authoritative public-ledger ranking by current liquid YNXT balance</p></div><span class="muted" id="accountTotal" data-initial-i18n="loadingAccounts">Loading accounts…</span></div>
        <div class="table-shell"><table class="accounts-table"><thead><tr><th style="width:9%" data-initial-i18n="rank">Rank</th><th style="width:43%" data-initial-i18n="account">Account</th><th style="width:18%" data-initial-i18n="balance">Balance</th><th style="width:16%" data-initial-i18n="staked">Staked</th><th style="width:14%" data-initial-i18n="nonce">Nonce</th></tr></thead><tbody id="accountsBody"><tr><td colspan="5" class="empty" data-initial-i18n="loadingAccountBalances">Loading authoritative account balances...</td></tr></tbody></table></div>
      </section>

      <section class="wallet-band">
        <div><h2 data-home-i18n="walletTitle">YNX-native identity comes first.</h2><p data-home-i18n="walletCopy">YNX applications use the checksummed ynx1 address by default. Standard MetaMask remains available through the isolated EVM compatibility adapter for the same account.</p></div>
        <button id="metamaskButton" class="wallet-button" type="button" data-home-i18n="metaMask">Open MetaMask compatibility</button>
      </section>

      <section class="ecosystem" id="ecosystem">
        <div class="section-head"><div><h2 data-i18n="ecosystem">YNX Ecosystem</h2><p data-home-i18n="ecosystemCopy">Independent products on YNX 6423. A product is never shown as publicly downloadable without matching release proof.</p></div><a class="section-link" href="#ecosystem" data-route="ecosystem" data-home-i18n="viewDirectory">View directory</a></div>
        <div class="ecosystem-grid" id="homeEcosystem"></div>
      </section>

      <section class="section" id="downloads">
        <div class="section-head"><div><h2 data-i18n="downloads">Downloads</h2><p data-download-i18n="installProof">Public artifact verification is required before instructions are shown.</p></div><a class="section-link" href="#downloads" data-route="downloads" data-i18n="downloads">Downloads</a></div>
        <div class="download-grid" id="homeDownloads"></div>
      </section>
    </div>
  </main>

  <section class="route-view shell" id="routeView" hidden aria-live="polite" tabindex="-1"></section>

  <footer><div class="shell footer-inner"><span data-footer-i18n="portal">YNX Chain · 6423 Testnet portal</span><span><a href="#documentation" data-route="documentation" data-i18n="documentation">Documentation</a> · <span data-footer-i18n="disclaimer">Live testnet data. Mainnet launch is not claimed.</span></span></div></footer>

  <div class="drawer-backdrop" id="detailBackdrop" aria-hidden="true">
    <aside class="drawer" id="detailDrawer" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
      <div class="drawer-head"><div><div class="drawer-kicker" id="detailKicker" data-initial-i18n="chainDetail">Chain detail</div><h2 id="detailTitle" data-initial-i18n="loading">Loading</h2></div><button class="icon-button" id="detailClose" type="button" data-i18n-aria="closeDetail" aria-label="Close detail panel">&times;</button></div>
      <div id="detailContent"><div class="empty" data-initial-i18n="loadingLiveChain">Loading live chain data...</div></div>
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
      defi: Object.freeze({name:'YNX DeFi services',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Protocol status, market, and settlement records',timeoutMs:0,cache:'none',degraded:'Do not advertise a market, balance, price, or product link without a verified public service.'}),
      payments: Object.freeze({name:'YNX Payments',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Merchant, payment-intent, and settlement records',timeoutMs:0,cache:'none',degraded:'Do not advertise checkout, merchant settlement, or payment actions without a verified public service.'}),
      developer: Object.freeze({name:'YNX developer tools',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'SDK, API, contract-tooling, and faucet availability records',timeoutMs:0,cache:'none',degraded:'Keep public tool links unavailable until a matching public artifact or endpoint is verified.'}),
      ai: Object.freeze({name:'YNX AI services',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Provider capability and permission-bound service records',timeoutMs:0,cache:'none',degraded:'Do not expose a provider, credential flow, or product link without verified public runtime evidence.'}),
      social: Object.freeze({name:'YNX Social',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Application release and service availability records',timeoutMs:0,cache:'none',degraded:'Do not advertise web, mobile, or extension availability without verified release evidence.'}),
      dataFabric: Object.freeze({name:'YNX Data Fabric',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Control-plane, data provenance, and integration status records',timeoutMs:0,cache:'none',degraded:'Do not claim a data integration or expose an unverified endpoint.'}),
      media: Object.freeze({name:'YNX Media',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Application release and media-service availability records',timeoutMs:0,cache:'none',degraded:'Do not advertise public playback, upload, or client availability without verified release evidence.'}),
      commerce: Object.freeze({name:'YNX Commerce',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Storefront, seller, and settlement availability records',timeoutMs:0,cache:'none',degraded:'Do not advertise a storefront, seller integration, or settlement path without verified public evidence.'}),
      infrastructure: Object.freeze({name:'YNX infrastructure',officialURL:'Unavailable',expectedChainID:'6423 / 0x1917 / ynx_6423-1',healthEndpoint:'Unavailable',schema:'Validator, RPC, indexer, monitor, and release availability records',timeoutMs:0,cache:'none',degraded:'Keep each infrastructure surface unavailable until its public identity and health check are independently verified.'}),
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
    const hasPublicWalletNetworkConfig = config => {
      const rpc = config?.rpcUrls?.[0];
      const explorer = config?.blockExplorerUrls?.[0];
      try {
        const rpcURL = new URL(rpc);
        const explorerURL = new URL(explorer);
        return rpcURL.protocol === 'https:' && explorerURL.protocol === 'https:' && rpcURL.hostname !== 'localhost' && explorerURL.hostname !== 'localhost';
      } catch (_) { return false; }
    };
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
    const routeContent = {
      en:{cosmos:'Cosmos chain ID',numeric:'Numeric chain ID',evm:'EVM chain ID',nativeAsset:'Native asset',dataSource:'Data source',rpcEndpoint:'RPC endpoint',explorerEndpoint:'Explorer endpoint',symbol:'Symbol',network:'Network',decimals:'Decimals',contract:'Contract',source:'Source',latestBlock:'Latest block',indexedTransactions:'Indexed transactions',indexerLag:'Indexer lag',snapshotTime:'Snapshot time',service:'Service',expectedIdentity:'Expected identity',healthEndpoint:'Health endpoint',degradedBehavior:'Degraded behavior',liveSource:'Live source',failClosed:'Fail closed',tokensIntro:'YNXT is the native 6423 asset. Price, market cap, holders, and liquidity remain unavailable until an authoritative source is connected.',nativeContract:'Native asset — no ERC-20 contract is asserted',tokenMetadataUnavailable:'Token metadata requires a verified 6423 RPC snapshot.',holdersUnavailable:'A verified native-token holder-list endpoint is not configured. The account leaderboard remains a separate explicitly labeled account-ranking view.',unverifiedTokensUnavailable:'No public verified token-list endpoint is configured, so unverified assets are not listed or promoted.',contractsUnavailable:'No verified 6423 contract-index endpoint is configured. Contract search and detail remain unavailable rather than inferred from arbitrary addresses.',snapshotUnavailable:'The 6423 RPC and indexer have not returned a verified snapshot yet.',dataPolicyCopy:'Every chart requires an authenticated timestamped 6423 source. The portal records its source and last-validation state instead of estimating history from a short live window.'},
      'zh-CN':{cosmos:'Cosmos 链 ID',numeric:'数字链 ID',evm:'EVM 链 ID',nativeAsset:'原生资产',dataSource:'数据来源',rpcEndpoint:'RPC 端点',explorerEndpoint:'浏览器端点',symbol:'符号',network:'网络',decimals:'小数位',contract:'合约',source:'来源',latestBlock:'最新区块',indexedTransactions:'已索引交易',indexerLag:'索引器延迟',snapshotTime:'快照时间',service:'服务',expectedIdentity:'预期身份',healthEndpoint:'健康端点',degradedBehavior:'降级行为',liveSource:'实时来源',failClosed:'失败关闭',tokensIntro:'YNXT 是 6423 的原生资产。在接入权威数据来源前，价格、市值、持有人和流动性均明确暂不可用。',nativeContract:'原生资产——不声明 ERC-20 合约',tokenMetadataUnavailable:'代币元数据需要已验证的 6423 RPC 快照。',holdersUnavailable:'尚未配置已验证的原生代币持有人列表端点；账户排行榜仍是单独且明确标注的账户排名视图。',unverifiedTokensUnavailable:'尚未配置公开且已验证的代币列表端点，因此不会列出或推广未验证资产。',contractsUnavailable:'尚未配置已验证的 6423 合约索引端点；合约搜索与详情保持暂不可用，不会从任意地址推断。',snapshotUnavailable:'6423 RPC 与索引器尚未返回已验证的快照。',dataPolicyCopy:'每张图表都需要带时间戳且经过认证的 6423 数据来源。门户记录其来源和最后验证状态，而不会从短暂的实时窗口估算历史数据。'},
      'zh-TW':{cosmos:'Cosmos 鏈 ID',numeric:'數值鏈 ID',evm:'EVM 鏈 ID',nativeAsset:'原生資產',dataSource:'資料來源',rpcEndpoint:'RPC 端點',explorerEndpoint:'瀏覽器端點',symbol:'代號',network:'網路',decimals:'小數位',contract:'合約',source:'來源',latestBlock:'最新區塊',indexedTransactions:'已索引交易',indexerLag:'索引器延遲',snapshotTime:'快照時間',service:'服務',expectedIdentity:'預期身分',healthEndpoint:'健康端點',degradedBehavior:'降級行為',liveSource:'即時來源',failClosed:'失敗即關閉',tokensIntro:'YNXT 是 6423 的原生資產。在接上權威資料來源前，價格、市值、持有人與流動性會明確保持暫時不可用。',nativeContract:'原生資產——不主張 ERC-20 合約',tokenMetadataUnavailable:'代幣中繼資料需要已驗證的 6423 RPC 快照。',holdersUnavailable:'尚未設定已驗證的原生代幣持有人清單端點；帳戶排行榜仍為分開且明確標記的帳戶排名檢視。',unverifiedTokensUnavailable:'尚未設定公開且已驗證的代幣清單端點，因此不會列出或推廣未驗證資產。',contractsUnavailable:'尚未設定已驗證的 6423 合約索引端點；合約搜尋與詳情會保持暫時不可用，不會從任意位址推論。',snapshotUnavailable:'6423 RPC 與索引器尚未回傳已驗證快照。',dataPolicyCopy:'每個圖表都需要帶時間戳記且已認證的 6423 資料來源。入口記錄來源與最後驗證狀態，而不會從短暫即時視窗推算歷史。'},
      ja:{cosmos:'Cosmos チェーン ID',numeric:'数値チェーン ID',evm:'EVM チェーン ID',nativeAsset:'ネイティブ資産',dataSource:'データソース',rpcEndpoint:'RPC エンドポイント',explorerEndpoint:'Explorer エンドポイント',symbol:'シンボル',network:'ネットワーク',decimals:'小数桁',contract:'コントラクト',source:'ソース',latestBlock:'最新ブロック',indexedTransactions:'索引済みトランザクション',indexerLag:'インデクサー遅延',snapshotTime:'スナップショット時刻',service:'サービス',expectedIdentity:'期待されるID',healthEndpoint:'ヘルスエンドポイント',degradedBehavior:'劣化時の動作',liveSource:'ライブソース',failClosed:'fail-closed',tokensIntro:'YNXT は 6423 のネイティブ資産です。権威あるソースに接続されるまで、価格、時価総額、保有者、流動性は利用不可として表示されます。',nativeContract:'ネイティブ資産 — ERC-20 コントラクトは主張しません',tokenMetadataUnavailable:'トークンメタデータには検証済みの 6423 RPC スナップショットが必要です。',holdersUnavailable:'検証済みのネイティブトークン保有者リストのエンドポイントは未設定です。アカウントランキングは別の明示的にラベル付けされたビューです。',unverifiedTokensUnavailable:'公開かつ検証済みのトークン一覧エンドポイントが未設定のため、未検証資産は一覧・推奨しません。',contractsUnavailable:'検証済みの 6423 コントラクト索引エンドポイントは未設定です。任意のアドレスから推測せず、検索と詳細は利用不可のままです。',snapshotUnavailable:'6423 RPC とインデクサーから検証済みスナップショットがまだ返されていません。',dataPolicyCopy:'各チャートには認証された時刻付き 6423 ソースが必要です。ポータルは短いライブウィンドウから履歴を推定せず、ソースと最終検証状態を記録します。'},
      ko:{cosmos:'Cosmos 체인 ID',numeric:'숫자 체인 ID',evm:'EVM 체인 ID',nativeAsset:'네이티브 자산',dataSource:'데이터 소스',rpcEndpoint:'RPC 엔드포인트',explorerEndpoint:'Explorer 엔드포인트',symbol:'심볼',network:'네트워크',decimals:'소수 자릿수',contract:'컨트랙트',source:'소스',latestBlock:'최신 블록',indexedTransactions:'색인된 거래',indexerLag:'인덱서 지연',snapshotTime:'스냅샷 시간',service:'서비스',expectedIdentity:'예상 ID',healthEndpoint:'상태 엔드포인트',degradedBehavior:'성능 저하 동작',liveSource:'실시간 소스',failClosed:'fail-closed',tokensIntro:'YNXT는 6423의 네이티브 자산입니다. 권위 있는 소스가 연결되기 전까지 가격, 시가총액, 보유자 및 유동성은 사용할 수 없음으로 표시됩니다.',nativeContract:'네이티브 자산 — ERC-20 컨트랙트는 주장하지 않습니다',tokenMetadataUnavailable:'토큰 메타데이터에는 검증된 6423 RPC 스냅샷이 필요합니다.',holdersUnavailable:'검증된 네이티브 토큰 보유자 목록 엔드포인트가 구성되지 않았습니다. 계정 순위는 별도의 명확히 표시된 계정 순위 보기입니다.',unverifiedTokensUnavailable:'공개적으로 검증된 토큰 목록 엔드포인트가 구성되지 않아 미검증 자산을 나열하거나 홍보하지 않습니다.',contractsUnavailable:'검증된 6423 컨트랙트 인덱스 엔드포인트가 구성되지 않았습니다. 임의 주소로 추론하지 않으며 검색과 상세 정보는 사용할 수 없습니다.',snapshotUnavailable:'6423 RPC와 인덱서가 아직 검증된 스냅샷을 반환하지 않았습니다.',dataPolicyCopy:'각 차트에는 인증된 타임스탬프 6423 소스가 필요합니다. 포털은 짧은 실시간 창에서 이력을 추정하지 않고 소스와 마지막 검증 상태를 기록합니다.'}
    };
    const c = key => routeContent[language]?.[key] || routeContent.en[key] || key;
    const resourceAnalyticsUI = {
      en:{title:'Resource market snapshot',copy:'Current counters come from the local 6423 resource runtime. They are useful for this portal session, but are not public release proof.',localOnly:'Local runtime only — not public proof'},
      'zh-CN':{title:'资源市场快照',copy:'当前计数来自本地 6423 资源运行时。它们可用于本门户会话，但不构成公开发布证明。',localOnly:'仅本地运行时——不构成公开证明'},
      'zh-TW':{title:'資源市場快照',copy:'目前計數來自本機 6423 資源執行環境。它們可用於此入口工作階段，但不構成公開發布證明。',localOnly:'僅限本機執行環境——不構成公開證明'},
      ja:{title:'リソース市場スナップショット',copy:'現在のカウンターはローカルの 6423 リソースランタイムから取得しています。このポータルセッションでは利用できますが、公開リリースの証明ではありません。',localOnly:'ローカルランタイムのみ — 公開証明ではありません'},
      ko:{title:'리소스 마켓 스냅샷',copy:'현재 카운터는 로컬 6423 리소스 런타임에서 가져옵니다. 이 포털 세션에서는 사용할 수 있지만 공개 릴리스 증명은 아닙니다.',localOnly:'로컬 런타임 전용 — 공개 증명이 아님'}
    };
    const resourceAnalytics = key => resourceAnalyticsUI[language]?.[key] || resourceAnalyticsUI.en[key] || key;
    const ecosystemUI = {
      en:{support:'6423 support',platforms:'Platforms',open:'Open',docs:'Docs',download:'Download',status:'Status',testnet:'Testnet',notPublic:'Unavailable',localTestnet:'Verified in this local 6423 Testnet portal only',noProductLink:'No verified public product link, documentation route, or download artifact is configured.'},
      'zh-CN':{support:'6423 支持',platforms:'平台',open:'打开',docs:'文档',download:'下载',status:'状态',testnet:'测试网',notPublic:'暂不可用',localTestnet:'仅在此本地 6423 测试网门户中验证',noProductLink:'尚未配置已验证的公开产品链接、文档路由或下载制品。'},
      'zh-TW':{support:'6423 支援',platforms:'平台',open:'開啟',docs:'文件',download:'下載',status:'狀態',testnet:'測試網',notPublic:'暫時不可用',localTestnet:'僅在此本機 6423 測試網入口中驗證',noProductLink:'尚未設定已驗證的公開產品連結、文件路由或下載成品。'},
      ja:{support:'6423 対応',platforms:'プラットフォーム',open:'開く',docs:'ドキュメント',download:'ダウンロード',status:'状態',testnet:'テストネット',notPublic:'利用不可',localTestnet:'このローカル 6423 テストネットポータルでのみ検証済み',noProductLink:'検証済みの公開プロダクトリンク、ドキュメントルート、ダウンロード成果物は設定されていません。'},
      ko:{support:'6423 지원',platforms:'플랫폼',open:'열기',docs:'문서',download:'다운로드',status:'상태',testnet:'테스트넷',notPublic:'사용 불가',localTestnet:'이 로컬 6423 테스트넷 포털에서만 검증됨',noProductLink:'검증된 공개 제품 링크, 문서 경로 또는 다운로드 아티팩트가 구성되지 않았습니다.'}
    };
    const e = key => ecosystemUI[language]?.[key] || ecosystemUI.en[key] || key;
    const ecosystemProducts = {
      en:[['Wallet','Custody, DApp permissions, and account identity.','Testnet candidate','Browser extension and native packages: unavailable'],['DeFi','Financial applications with product-scoped availability.','Source evidence only','Public route and settlement proof: unavailable'],['Payments','YNXT payment and merchant workflows.','Source evidence only','Public payment release: unavailable'],['Developer','Explorer, SDK, contract tools, faucet, and Testnet setup.','Testnet tools','Use the verified 6423 configuration'],['AI','Permissioned AI product workflows.','Provider availability unverified','Public runtime proof: unavailable'],['Social','Independent social application.','Public release unverified','iOS, Android, web proof: unavailable'],['Data','Data Fabric and trustworthy data services.','Integration status required','Control-plane integration: unavailable'],['Media','Music and Video products.','Public release unverified','Installed-runtime proof: unavailable'],['Commerce','Shop and seller operations.','Settlement proof required','Public storefront proof: unavailable'],['Infrastructure','Validator, RPC, indexer, and monitor surfaces.','Live data varies by endpoint','Current Explorer data is shown separately']],
      'zh-CN':[['钱包','托管、DApp 权限与账户身份。','测试网候选','浏览器扩展与原生安装包：暂不可用'],['DeFi','按产品范围显示可用性的金融应用。','仅有源代码证据','公开路由与结算证明：暂不可用'],['支付','YNXT 支付与商户工作流。','仅有源代码证据','公开支付发布：暂不可用'],['开发者','浏览器、SDK、合约工具、水龙头与测试网设置。','测试网工具','使用已验证的 6423 配置'],['AI','经许可的 AI 产品工作流。','提供方可用性未验证','公开运行时证明：暂不可用'],['社交','独立的社交应用。','公开发布未验证','iOS、Android、Web 证明：暂不可用'],['数据','数据织网与可信数据服务。','需要集成状态','控制平面集成：暂不可用'],['媒体','音乐与视频产品。','公开发布未验证','已安装运行时证明：暂不可用'],['商业','商店与卖家运营。','需要结算证明','公开店面证明：暂不可用'],['基础设施','验证者、RPC、索引器与监控界面。','实时数据因端点而异','当前 Explorer 数据单独展示']],
      'zh-TW':[['錢包','託管、DApp 權限與帳戶身分。','測試網候選','瀏覽器擴充功能與原生套件：暫時不可用'],['DeFi','依產品範圍顯示可用性的金融應用。','僅有來源證據','公開路由與結算證明：暫時不可用'],['支付','YNXT 支付與商家流程。','僅有來源證據','公開支付發布：暫時不可用'],['開發者','瀏覽器、SDK、合約工具、水龍頭與測試網設定。','測試網工具','使用已驗證的 6423 設定'],['AI','經授權的 AI 產品流程。','供應商可用性未驗證','公開執行環境證明：暫時不可用'],['社群','獨立的社群應用。','公開發布未驗證','iOS、Android、Web 證明：暫時不可用'],['資料','資料織網與可信資料服務。','需要整合狀態','控制平面整合：暫時不可用'],['媒體','音樂與影片產品。','公開發布未驗證','已安裝執行環境證明：暫時不可用'],['商務','商店與賣家營運。','需要結算證明','公開店面證明：暫時不可用'],['基礎設施','驗證者、RPC、索引器與監控介面。','即時資料因端點而異','目前 Explorer 資料另行顯示']],
      ja:[['ウォレット','カストディ、DApp 権限、アカウントID。','テストネット候補','ブラウザー拡張とネイティブパッケージ：利用不可'],['DeFi','プロダクト単位の可用性を持つ金融アプリ。','ソース証拠のみ','公開ルートと決済証拠：利用不可'],['決済','YNXT の決済および加盟店ワークフロー。','ソース証拠のみ','公開決済リリース：利用不可'],['開発者','Explorer、SDK、コントラクトツール、フォーセット、テストネット設定。','テストネットツール','検証済みの 6423 設定を使用'],['AI','権限付き AI プロダクトワークフロー。','プロバイダー可用性は未検証','公開ランタイム証拠：利用不可'],['ソーシャル','独立したソーシャルアプリ。','公開リリース未検証','iOS、Android、Web の証拠：利用不可'],['データ','Data Fabric と信頼できるデータサービス。','統合状態が必要','コントロールプレーン統合：利用不可'],['メディア','音楽と動画のプロダクト。','公開リリース未検証','インストール済みランタイム証拠：利用不可'],['コマース','ショップと販売者の運用。','決済証拠が必要','公開ストアフロント証拠：利用不可'],['インフラ','バリデーター、RPC、インデクサー、監視画面。','ライブデータはエンドポイントにより異なる','現在の Explorer データは別に表示']],
      ko:[['지갑','보관, DApp 권한 및 계정 ID입니다.','테스트넷 후보','브라우저 확장과 네이티브 패키지: 사용 불가'],['DeFi','제품 범위별 가용성을 갖춘 금융 애플리케이션입니다.','소스 증거만 있음','공개 경로와 결제 증명: 사용 불가'],['결제','YNXT 결제 및 가맹점 워크플로입니다.','소스 증거만 있음','공개 결제 릴리스: 사용 불가'],['개발자','Explorer, SDK, 컨트랙트 도구, 수도꼭지 및 테스트넷 설정입니다.','테스트넷 도구','검증된 6423 구성을 사용하세요'],['AI','권한이 부여된 AI 제품 워크플로입니다.','제공자 가용성 미검증','공개 런타임 증명: 사용 불가'],['소셜','독립 소셜 애플리케이션입니다.','공개 릴리스 미검증','iOS, Android, 웹 증명: 사용 불가'],['데이터','데이터 패브릭 및 신뢰 가능한 데이터 서비스입니다.','통합 상태 필요','제어 플레인 통합: 사용 불가'],['미디어','음악 및 비디오 제품입니다.','공개 릴리스 미검증','설치된 런타임 증명: 사용 불가'],['커머스','상점 및 판매자 운영입니다.','결제 증명 필요','공개 스토어프론트 증명: 사용 불가'],['인프라','검증인, RPC, 인덱서 및 모니터 화면입니다.','실시간 데이터는 엔드포인트에 따라 다름','현재 Explorer 데이터는 별도로 표시됩니다']]
    };
    const downloadUI = {
      en:{platform:'Platform',version:'Version',size:'Size',sha:'SHA-256',signing:'Signing',published:'Source / published',install:'Install',downloadUnavailable:'Download unavailable',unavailable:'Unavailable',installProof:'Public artifact verification is required before instructions are shown.'},
      'zh-CN':{platform:'平台',version:'版本',size:'大小',sha:'SHA-256',signing:'签名',published:'来源 / 发布',install:'安装',downloadUnavailable:'下载暂不可用',unavailable:'暂不可用',installProof:'在展示安装说明前，必须完成公开制品验证。'},
      'zh-TW':{platform:'平台',version:'版本',size:'大小',sha:'SHA-256',signing:'簽章',published:'來源 / 發布',install:'安裝',downloadUnavailable:'下載暫時不可用',unavailable:'暫時不可用',installProof:'顯示安裝說明前，必須完成公開成品驗證。'},
      ja:{platform:'プラットフォーム',version:'バージョン',size:'サイズ',sha:'SHA-256',signing:'署名',published:'ソース / 公開',install:'インストール',downloadUnavailable:'ダウンロードは利用不可',unavailable:'利用不可',installProof:'手順を表示する前に公開成果物の検証が必要です。'},
      ko:{platform:'플랫폼',version:'버전',size:'크기',sha:'SHA-256',signing:'서명',published:'소스 / 게시',install:'설치',downloadUnavailable:'다운로드 사용 불가',unavailable:'사용 불가',installProof:'설치 안내를 표시하기 전에 공개 아티팩트 검증이 필요합니다.'}
    };
    const d = key => downloadUI[language]?.[key] || downloadUI.en[key] || key;
    const downloadProducts = {
      en:[['YNX Wallet browser extension','Browser extension'],['YNX Wallet desktop','macOS / Windows / Linux'],['YNX Wallet mobile','Android / iOS'],['Developer CLI and SDK','Developer tooling'],['YNX web applications','Web / PWA'],['Other ecosystem applications','Product-specific platforms']],
      'zh-CN':[['YNX 钱包浏览器扩展','浏览器扩展'],['YNX 钱包桌面端','macOS / Windows / Linux'],['YNX 钱包移动端','Android / iOS'],['开发者 CLI 与 SDK','开发者工具'],['YNX Web 应用','Web / PWA'],['其他生态应用','产品特定平台']],
      'zh-TW':[['YNX 錢包瀏覽器擴充功能','瀏覽器擴充功能'],['YNX 錢包桌面版','macOS / Windows / Linux'],['YNX 錢包行動版','Android / iOS'],['開發者 CLI 與 SDK','開發者工具'],['YNX Web 應用','Web / PWA'],['其他生態應用','產品特定平台']],
      ja:[['YNX ウォレット ブラウザー拡張','ブラウザー拡張'],['YNX ウォレット デスクトップ','macOS / Windows / Linux'],['YNX ウォレット モバイル','Android / iOS'],['開発者 CLI と SDK','開発者ツール'],['YNX Web アプリケーション','Web / PWA'],['その他のエコシステムアプリ','製品別プラットフォーム']],
      ko:[['YNX 지갑 브라우저 확장','브라우저 확장'],['YNX 지갑 데스크톱','macOS / Windows / Linux'],['YNX 지갑 모바일','Android / iOS'],['개발자 CLI 및 SDK','개발자 도구'],['YNX 웹 애플리케이션','Web / PWA'],['기타 생태계 애플리케이션','제품별 플랫폼']]
    };
    const dataChartCopy = {
      en:{activity:['Blocks & transactions','Verified current indexed counts are above. A time series is intentionally empty until its source can be authenticated.'],addresses:['Active addresses','The Explorer can show individual verified accounts, but no timestamped active-address series is configured.'],gas:['Gas & fees','Current transaction fees are verifiable per transaction; aggregate historical gas data is not.'],nodes:['Nodes & network health','Validator and sync state are live; a historical node-health series is not available.'],tokens:['Token activity','YNXT is verifiable as the native asset. Historical transfer activity needs a dedicated authenticated series.'],empty:'No authenticated historical 6423 series is available for this metric.',source:'Source',lastVerified:'Last verified',range:'Range',historyUnavailable:'No verified historical 6423 records are available for this interval, so this chart remains intentionally empty.'},
      'zh-CN':{activity:['区块与交易','上方为已验证的当前索引数量。在数据源通过认证前，时间序列将明确保持为空。'],addresses:['活跃地址','Explorer 可展示单个已验证账户，但尚未配置带时间戳的活跃地址序列。'],gas:['Gas 与费用','当前交易费用可逐笔验证；聚合历史 Gas 数据不可验证。'],nodes:['节点与网络健康','验证者和同步状态为实时数据；历史节点健康序列暂不可用。'],tokens:['代币活动','YNXT 可作为原生资产验证；历史转账活动需要专用且已认证的序列。'],empty:'此指标没有已认证的 6423 历史序列。',source:'来源',lastVerified:'最后验证',range:'范围',historyUnavailable:'此时间范围没有已验证的 6423 历史记录，因此图表明确保持为空。'},
      'zh-TW':{activity:['區塊與交易','上方為已驗證的目前索引數量。在資料來源通過驗證前，時間序列會明確保持為空。'],addresses:['活躍位址','Explorer 可顯示個別已驗證帳戶，但尚未設定帶時間戳記的活躍位址序列。'],gas:['Gas 與費用','目前交易費用可逐筆驗證；彙總歷史 Gas 資料不可驗證。'],nodes:['節點與網路健康','驗證者和同步狀態為即時資料；歷史節點健康序列暫時不可用。'],tokens:['代幣活動','YNXT 可作為原生資產驗證；歷史轉帳活動需要專用且已認證的序列。'],empty:'此指標沒有已認證的 6423 歷史序列。',source:'來源',lastVerified:'最後驗證',range:'範圍',historyUnavailable:'此時間範圍沒有已驗證的 6423 歷史記錄，因此圖表明確保持為空。'},
      ja:{activity:['ブロックとトランザクション','現在の検証済み索引数を上に表示しています。ソースを認証できるまで時系列は意図的に空です。'],addresses:['アクティブアドレス','Explorer は個別の検証済みアカウントを表示できますが、時刻付きアクティブアドレス系列は未設定です。'],gas:['Gas と手数料','現在の取引手数料は取引ごとに検証できますが、集約した履歴 Gas データは検証できません。'],nodes:['ノードとネットワーク健全性','バリデーターと同期状態はライブですが、履歴ノード健全性系列はありません。'],tokens:['トークン活動','YNXT はネイティブ資産として検証できます。履歴送金活動には専用の認証済み系列が必要です。'],empty:'この指標の認証済み 6423 履歴系列はありません。',source:'ソース',lastVerified:'最終検証',range:'範囲',historyUnavailable:'この期間に検証済みの 6423 履歴レコードはないため、チャートは意図的に空です。'},
      ko:{activity:['블록 및 트랜잭션','검증된 현재 색인 수가 위에 표시됩니다. 소스가 인증될 때까지 시계열은 의도적으로 비어 있습니다.'],addresses:['활성 주소','Explorer는 개별 검증 계정을 표시할 수 있지만 타임스탬프가 있는 활성 주소 계열은 구성되지 않았습니다.'],gas:['Gas 및 수수료','현재 트랜잭션 수수료는 거래별로 검증할 수 있지만 집계된 이력 Gas 데이터는 검증할 수 없습니다.'],nodes:['노드 및 네트워크 상태','검증인과 동기화 상태는 실시간이지만 이력 노드 상태 계열은 없습니다.'],tokens:['토큰 활동','YNXT는 네이티브 자산으로 검증할 수 있습니다. 이력 전송 활동에는 전용 인증 계열이 필요합니다.'],empty:'이 지표에 대한 인증된 6423 이력 계열이 없습니다.',source:'소스',lastVerified:'마지막 검증',range:'범위',historyUnavailable:'이 기간에 검증된 6423 이력 레코드가 없으므로 차트는 의도적으로 비어 있습니다.'}
    };
    Object.assign(dataChartCopy.en,{loading:'Loading verified indexed blocks…',window24:'24 blocks',window48:'48 blocks',window72:'72 blocks',window100:'100 blocks',windowCaption:'{blocks} verified indexed blocks · {transactions} transactions',blockPoint:'Block #{height}: {count} transactions',windowUnavailable:'The current verified indexed block window is unavailable. Retry from the network status panel.'});
    Object.assign(dataChartCopy['zh-CN'],{loading:'正在加载已验证的索引区块…',window24:'24 个区块',window48:'48 个区块',window72:'72 个区块',window100:'100 个区块',windowCaption:'{blocks} 个已验证索引区块 · {transactions} 笔交易',blockPoint:'区块 #{height}：{count} 笔交易',windowUnavailable:'当前已验证索引区块窗口暂不可用，请从网络状态面板重试。'});
    Object.assign(dataChartCopy['zh-TW'],{loading:'正在載入已驗證的索引區塊…',window24:'24 個區塊',window48:'48 個區塊',window72:'72 個區塊',window100:'100 個區塊',windowCaption:'{blocks} 個已驗證索引區塊 · {transactions} 筆交易',blockPoint:'區塊 #{height}：{count} 筆交易',windowUnavailable:'目前已驗證索引區塊視窗暫時不可用，請從網路狀態面板重試。'});
    Object.assign(dataChartCopy.ja,{loading:'検証済みの索引ブロックを読み込み中…',window24:'24 ブロック',window48:'48 ブロック',window72:'72 ブロック',window100:'100 ブロック',windowCaption:'検証済み索引ブロック {blocks} 件 · トランザクション {transactions} 件',blockPoint:'ブロック #{height}: トランザクション {count} 件',windowUnavailable:'現在の検証済み索引ブロックウィンドウを利用できません。ネットワーク状態パネルから再試行してください。'});
    Object.assign(dataChartCopy.ko,{loading:'검증된 색인 블록을 불러오는 중…',window24:'24개 블록',window48:'48개 블록',window72:'72개 블록',window100:'100개 블록',windowCaption:'검증된 색인 블록 {blocks}개 · 트랜잭션 {transactions}건',blockPoint:'블록 #{height}: 트랜잭션 {count}건',windowUnavailable:'현재 검증된 색인 블록 창을 사용할 수 없습니다. 네트워크 상태 패널에서 다시 시도하세요.'});
    dataChartCopy.en.activity[1] = 'The current verified indexed block window is interactive below. Longer historical series remain unavailable until their source can be authenticated.';
    dataChartCopy['zh-CN'].activity[1] = '下方为可交互的当前已验证索引区块窗口；在数据源通过认证前，长期历史序列仍明确暂不可用。';
    dataChartCopy['zh-TW'].activity[1] = '下方為可互動的目前已驗證索引區塊視窗；在資料來源通過驗證前，長期歷史系列仍明確暫時不可用。';
    dataChartCopy.ja.activity[1] = '下に現在の検証済み索引ブロックウィンドウを表示します。長期履歴系列はソースを認証できるまで利用不可です。';
    dataChartCopy.ko.activity[1] = '아래에서 현재 검증된 색인 블록 창을 상호작용으로 확인할 수 있습니다. 장기 이력 계열은 소스를 인증할 때까지 사용할 수 없습니다.';
    const chartText = (key, values = {}) => { const value = dataChartCopy[language]?.[key] || dataChartCopy.en[key] || key; return typeof value === 'string' ? value.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '') : value; };
    const governancePanels = {
      en:[['Governance proposals','A 6423 governance proposal endpoint is not available from the current Explorer service.'],['Proposal detail','No proposal detail can be shown until a verified proposal ID and 6423 governance source are available.'],['Voting information','No verified vote tally, voter eligibility, or voting window is available.'],['Governance parameters','No verified 6423 parameter snapshot is available.']],
      'zh-CN':[['治理提案','当前 Explorer 服务未提供 6423 治理提案端点。'],['提案详情','在已验证的提案 ID 和 6423 治理来源可用前，不会展示提案详情。'],['投票信息','尚无已验证的票数、投票资格或投票窗口。'],['治理参数','尚无已验证的 6423 参数快照。']],
      'zh-TW':[['治理提案','目前 Explorer 服務未提供 6423 治理提案端點。'],['提案詳情','在已驗證的提案 ID 和 6423 治理來源可用前，不會顯示提案詳情。'],['投票資訊','尚無已驗證的票數、投票資格或投票期間。'],['治理參數','尚無已驗證的 6423 參數快照。']],
      ja:[['ガバナンス提案','現在の Explorer サービスに 6423 ガバナンス提案エンドポイントはありません。'],['提案詳細','検証済みの提案 ID と 6423 ガバナンスソースが利用可能になるまで提案詳細は表示しません。'],['投票情報','検証済みの投票集計、投票資格、投票期間はありません。'],['ガバナンスパラメータ','検証済みの 6423 パラメータスナップショットはありません。']],
      ko:[['거버넌스 제안','현재 Explorer 서비스에서 6423 거버넌스 제안 엔드포인트를 사용할 수 없습니다.'],['제안 상세','검증된 제안 ID와 6423 거버넌스 소스를 사용할 수 있을 때까지 제안 세부 정보를 표시하지 않습니다.'],['투표 정보','검증된 득표 수, 유권자 자격 또는 투표 기간이 없습니다.'],['거버넌스 파라미터','검증된 6423 파라미터 스냅샷이 없습니다.']]
    };
    const documentationUI = {
      en:{using:'Using this portal',search:'Search and browse blocks, transactions, and accounts',identifiers:'Use verified Testnet identifiers',downloads:'Review download evidence requirements',policy:'Status policy',policyCopy:'A product, download, or service with no verified public evidence is shown as unavailable instead of being linked to a placeholder.',api:'Local Explorer API',apiCopy:'These read-only endpoints are served by this Testnet portal. They are not public RPC endpoints.',endpoint:'Endpoint',method:'Method',availableHere:'Available in this portal',publicAPIUnavailable:'No verified public HTTPS API endpoint is configured.'},
      'zh-CN':{using:'使用本门户',search:'搜索和浏览区块、交易与账户',identifiers:'使用已验证的测试网标识',downloads:'查看下载证据要求',policy:'状态政策',policyCopy:'没有已验证公开证据的产品、下载或服务会显示为暂不可用，而不会链接到占位页面。',api:'本地 Explorer API',apiCopy:'这些只读端点由此测试网门户提供，不是公网 RPC 端点。',endpoint:'端点',method:'方法',availableHere:'在本门户可用',publicAPIUnavailable:'尚未配置已验证的公网 HTTPS API 端点。'},
      'zh-TW':{using:'使用此入口',search:'搜尋和瀏覽區塊、交易與帳戶',identifiers:'使用已驗證的測試網識別資料',downloads:'查看下載證據要求',policy:'狀態政策',policyCopy:'沒有已驗證公開證據的產品、下載或服務會顯示為暫時不可用，而不會連結到預留頁面。',api:'本機 Explorer API',apiCopy:'這些唯讀端點由此測試網入口提供，並非公開 RPC 端點。',endpoint:'端點',method:'方法',availableHere:'可在此入口使用',publicAPIUnavailable:'尚未設定已驗證的公開 HTTPS API 端點。'},
      ja:{using:'このポータルを使う',search:'ブロック、取引、アカウントを検索・参照',identifiers:'検証済みテストネットIDを使用',downloads:'ダウンロード証拠の要件を確認',policy:'状態方針',policyCopy:'検証済みの公開証拠がないプロダクト、ダウンロード、サービスはプレースホルダーへリンクせず利用不可として表示します。',api:'ローカル Explorer API',apiCopy:'これらの読み取り専用エンドポイントはこのテストネットポータルで提供されます。公開 RPC エンドポイントではありません。',endpoint:'エンドポイント',method:'メソッド',availableHere:'このポータルで利用可能',publicAPIUnavailable:'検証済みの公開 HTTPS API エンドポイントは設定されていません。'},
      ko:{using:'이 포털 사용',search:'블록, 트랜잭션 및 계정 검색과 탐색',identifiers:'검증된 테스트넷 식별자 사용',downloads:'다운로드 증거 요건 검토',policy:'상태 정책',policyCopy:'검증된 공개 증거가 없는 제품, 다운로드 또는 서비스는 자리표시자에 연결하지 않고 사용 불가로 표시합니다.',api:'로컬 Explorer API',apiCopy:'이 읽기 전용 엔드포인트는 이 테스트넷 포털에서 제공됩니다. 공개 RPC 엔드포인트가 아닙니다.',endpoint:'엔드포인트',method:'메서드',availableHere:'이 포털에서 사용 가능',publicAPIUnavailable:'검증된 공개 HTTPS API 엔드포인트가 구성되지 않았습니다.'}
    };
    const homeUI = {
      en:{testnet:'YNX Testnet',quickSearch:'Quick search:',latestBlock:'Latest block',ynxtToken:'YNXT token',block6423:'Block 6423',evmNetwork:'EVM network',developerEntry:'Developer entry point',developerCallout:'Build and inspect on YNX 6423.',developerTools:'Developer tools',finality:'FINALITY',intelligence:'Network intelligence',intelligenceCopy:'Validator and resource-economy state from live chain APIs',resourceEconomy:'Resource economy',walletTitle:'YNX-native identity comes first.',walletCopy:'YNX applications use the checksummed ynx1 address by default. Standard MetaMask remains available through the isolated EVM compatibility adapter for the same account.',metaMask:'Open MetaMask compatibility',ecosystemCopy:'Independent products on YNX 6423. A product is never shown as publicly downloadable without matching release proof.',viewDirectory:'View directory',availability:'Availability details',openDeveloper:'Open developer portal'},
      'zh-CN':{testnet:'YNX 测试网',quickSearch:'快速搜索：',latestBlock:'最新区块',ynxtToken:'YNXT 代币',block6423:'区块 6423',evmNetwork:'EVM 网络',developerEntry:'开发者入口',developerCallout:'在 YNX 6423 上构建与检视。',developerTools:'开发者工具',finality:'终局性',intelligence:'网络洞察',intelligenceCopy:'来自实时链 API 的验证者和资源经济状态',resourceEconomy:'资源经济',walletTitle:'YNX 原生身份优先。',walletCopy:'YNX 应用默认使用校验和 ynx1 地址；同一账户仍可通过隔离的 EVM 兼容适配器使用标准 MetaMask。',metaMask:'打开 MetaMask 兼容模式',ecosystemCopy:'YNX 6423 上的独立产品。没有匹配的发布证据时，产品绝不会显示为可公开下载。',viewDirectory:'查看目录',availability:'可用性详情',openDeveloper:'打开开发者门户'},
      'zh-TW':{testnet:'YNX 測試網',quickSearch:'快速搜尋：',latestBlock:'最新區塊',ynxtToken:'YNXT 代幣',block6423:'區塊 6423',evmNetwork:'EVM 網路',developerEntry:'開發者入口',developerCallout:'在 YNX 6423 上建置與檢視。',developerTools:'開發者工具',finality:'最終性',intelligence:'網路洞察',intelligenceCopy:'來自即時鏈 API 的驗證者和資源經濟狀態',resourceEconomy:'資源經濟',walletTitle:'YNX 原生身分優先。',walletCopy:'YNX 應用預設使用校驗和 ynx1 位址；同一帳戶仍可透過隔離的 EVM 相容介面使用標準 MetaMask。',metaMask:'開啟 MetaMask 相容模式',ecosystemCopy:'YNX 6423 上的獨立產品。沒有相符發布證據時，產品絕不會顯示為可公開下載。',viewDirectory:'查看目錄',availability:'可用性詳情',openDeveloper:'開啟開發者入口'},
      ja:{testnet:'YNX テストネット',quickSearch:'クイック検索:',latestBlock:'最新ブロック',ynxtToken:'YNXT トークン',block6423:'ブロック 6423',evmNetwork:'EVM ネットワーク',developerEntry:'開発者向け入口',developerCallout:'YNX 6423 で構築・検証。',developerTools:'開発者ツール',finality:'ファイナリティ',intelligence:'ネットワーク分析',intelligenceCopy:'ライブチェーン API からのバリデーターとリソース経済の状態',resourceEconomy:'リソース経済',walletTitle:'YNX ネイティブIDを優先。',walletCopy:'YNX アプリケーションは既定でチェックサム付き ynx1 アドレスを使用します。同じアカウントで標準 MetaMask は分離された EVM 互換アダプターから利用できます。',metaMask:'MetaMask 互換を開く',ecosystemCopy:'YNX 6423 上の独立したプロダクトです。対応するリリース証拠なしに公開ダウンロード可能とは表示しません。',viewDirectory:'一覧を見る',availability:'利用可否の詳細',openDeveloper:'開発者ポータルを開く'},
      ko:{testnet:'YNX 테스트넷',quickSearch:'빠른 검색:',latestBlock:'최신 블록',ynxtToken:'YNXT 토큰',block6423:'블록 6423',evmNetwork:'EVM 네트워크',developerEntry:'개발자 진입점',developerCallout:'YNX 6423에서 구축하고 확인하세요.',developerTools:'개발자 도구',finality:'최종성',intelligence:'네트워크 인사이트',intelligenceCopy:'실시간 체인 API의 검증인 및 리소스 경제 상태',resourceEconomy:'리소스 경제',walletTitle:'YNX 네이티브 ID를 우선합니다.',walletCopy:'YNX 애플리케이션은 기본적으로 체크섬 ynx1 주소를 사용합니다. 동일한 계정에서 표준 MetaMask는 분리된 EVM 호환 어댑터로 계속 사용할 수 있습니다.',metaMask:'MetaMask 호환 열기',ecosystemCopy:'YNX 6423의 독립 제품입니다. 일치하는 릴리스 증거가 없으면 공개 다운로드 가능으로 표시하지 않습니다.',viewDirectory:'디렉터리 보기',availability:'이용 가능 세부 정보',openDeveloper:'개발자 포털 열기'}
    };
    const liveUI = {
      en:{refresh:'Refresh',chain:'Chain',native:'Native',blocks:'Blocks',more:'More',nativeAsset:'Native asset · 6423',networkSource:'Network source',chainIdentity:'Chain identity',pendingTransactions:'Pending transactions',currentRPC:'Current RPC status',lastVerified:'Last verified',awaitingBlock:'Awaiting latest block',manualSnapshot:'Manual snapshot',liveSSE:'Live SSE',updatedNow:'Updated now',updatedAgo:'Updated {seconds}s ago',noEvent:'No event for {seconds}s',liveConnected:'Live stream connected',reconnecting:'Reconnecting live data',snapshotFallback:'Using 10-second snapshot fallback',streamReconnecting:'Stream reconnecting',unavailable:'Explorer unavailable',retry:'The verified 6423 data source is unavailable. Refresh to retry.'},
      'zh-CN':{refresh:'刷新',chain:'链',native:'原生',blocks:'区块',more:'更多',nativeAsset:'原生资产 · 6423',networkSource:'网络来源',chainIdentity:'链身份',pendingTransactions:'待处理交易',currentRPC:'当前 RPC 状态',lastVerified:'最后验证',awaitingBlock:'等待最新区块',manualSnapshot:'手动快照',liveSSE:'实时 SSE',updatedNow:'刚刚更新',updatedAgo:'{seconds} 秒前更新',noEvent:'{seconds} 秒没有事件',liveConnected:'实时流已连接',reconnecting:'正在重连实时数据',snapshotFallback:'使用 10 秒快照回退',streamReconnecting:'实时流正在重连',unavailable:'浏览器暂不可用',retry:'经验证的 6423 数据来源暂不可用，请刷新重试。'},
      'zh-TW':{refresh:'重新整理',chain:'鏈',native:'原生',blocks:'區塊',more:'更多',nativeAsset:'原生資產 · 6423',networkSource:'網路來源',chainIdentity:'鏈身分',pendingTransactions:'待處理交易',currentRPC:'目前 RPC 狀態',lastVerified:'最後驗證',awaitingBlock:'等待最新區塊',manualSnapshot:'手動快照',liveSSE:'即時 SSE',updatedNow:'剛剛更新',updatedAgo:'{seconds} 秒前更新',noEvent:'{seconds} 秒沒有事件',liveConnected:'即時串流已連線',reconnecting:'正在重新連線即時資料',snapshotFallback:'使用 10 秒快照回退',streamReconnecting:'即時串流正在重新連線',unavailable:'瀏覽器暫時不可用',retry:'已驗證的 6423 資料來源暫時不可用，請重新整理重試。'},
      ja:{refresh:'更新',chain:'チェーン',native:'ネイティブ',blocks:'ブロック',more:'もっと見る',nativeAsset:'ネイティブ資産 · 6423',networkSource:'ネットワークソース',chainIdentity:'チェーンID',pendingTransactions:'保留中のトランザクション',currentRPC:'現在の RPC 状態',lastVerified:'最終検証',awaitingBlock:'最新ブロックを待機中',manualSnapshot:'手動スナップショット',liveSSE:'ライブ SSE',updatedNow:'更新済み',updatedAgo:'{seconds} 秒前に更新',noEvent:'{seconds} 秒間イベントなし',liveConnected:'ライブストリーム接続済み',reconnecting:'ライブデータを再接続中',snapshotFallback:'10 秒のスナップショットにフォールバック中',streamReconnecting:'ストリームを再接続中',unavailable:'エクスプローラーを利用できません',retry:'検証済みの 6423 データソースを利用できません。更新して再試行してください。'},
      ko:{refresh:'새로 고침',chain:'체인',native:'네이티브',blocks:'블록',more:'더 보기',nativeAsset:'네이티브 자산 · 6423',networkSource:'네트워크 소스',chainIdentity:'체인 ID',pendingTransactions:'보류 중인 거래',currentRPC:'현재 RPC 상태',lastVerified:'마지막 검증',awaitingBlock:'최신 블록 대기 중',manualSnapshot:'수동 스냅샷',liveSSE:'실시간 SSE',updatedNow:'방금 업데이트됨',updatedAgo:'{seconds}초 전 업데이트됨',noEvent:'{seconds}초 동안 이벤트 없음',liveConnected:'실시간 스트림 연결됨',reconnecting:'실시간 데이터 재연결 중',snapshotFallback:'10초 스냅샷 대체 사용 중',streamReconnecting:'스트림 재연결 중',unavailable:'Explorer를 사용할 수 없음',retry:'검증된 6423 데이터 소스를 사용할 수 없습니다. 새로 고침 후 다시 시도하세요.'}
    };
    const developerUI = {
      en:{configuration:'YNX 6423 configuration',testnetOnly:'Testnet only',tools:'Tools & documentation',copyNetwork:'Copy Add Network configuration',networkJSON:'6423 Testnet JSON',apiReference:'API reference',sdk:'SDK & CLI',faucet:'Faucet',unavailable:'Unavailable',sourceOnly:'Source-bound only',checkStatus:'Check status first',serviceDirectory:'6423 service directory',serviceCopy:'Verified Explorer and stream entries update in this browser session; unavailable services fail closed.',example:'Read-only Explorer API example',exampleCopy:'This example queries the currently served portal summary; it does not request wallet access, a signature, or a transaction.',copyExample:'Copy example',serviceSchema:'Service & schema',expectedIdentity:'Expected identity',officialEndpoint:'Official endpoint',timeoutCache:'Timeout & cache',verification:'Verification / degraded behavior',notVerified:'Not verified in this browser session',cache:'Cache',health:'Health'},
      'zh-CN':{configuration:'YNX 6423 配置',testnetOnly:'仅测试网',tools:'工具与文档',copyNetwork:'复制添加网络配置',networkJSON:'6423 测试网 JSON',apiReference:'API 参考',sdk:'SDK 与 CLI',faucet:'水龙头',unavailable:'暂不可用',sourceOnly:'仅限源代码',checkStatus:'请先检查状态',serviceDirectory:'6423 服务目录',serviceCopy:'已验证的 Explorer 和流服务会在此浏览器会话更新；不可用服务会 fail-closed。',example:'只读 Explorer API 示例',exampleCopy:'该示例查询当前门户提供的摘要；不会请求钱包访问、签名或交易。',copyExample:'复制示例',serviceSchema:'服务与 schema',expectedIdentity:'预期身份',officialEndpoint:'官方端点',timeoutCache:'超时与缓存',verification:'验证 / 降级行为',notVerified:'未在此浏览器会话验证',cache:'缓存',health:'健康检查'},
      'zh-TW':{configuration:'YNX 6423 設定',testnetOnly:'僅測試網',tools:'工具與文件',copyNetwork:'複製新增網路設定',networkJSON:'6423 測試網 JSON',apiReference:'API 參考',sdk:'SDK 與 CLI',faucet:'水龍頭',unavailable:'暫時不可用',sourceOnly:'僅限來源程式碼',checkStatus:'請先檢查狀態',serviceDirectory:'6423 服務目錄',serviceCopy:'已驗證的 Explorer 和串流服務會在此瀏覽器工作階段更新；不可用服務會 fail-closed。',example:'唯讀 Explorer API 範例',exampleCopy:'此範例查詢目前入口提供的摘要；不會請求錢包存取、簽章或交易。',copyExample:'複製範例',serviceSchema:'服務與 schema',expectedIdentity:'預期身分',officialEndpoint:'官方端點',timeoutCache:'逾時與快取',verification:'驗證 / 降級行為',notVerified:'未在此瀏覽器工作階段驗證',cache:'快取',health:'健康檢查'},
      ja:{configuration:'YNX 6423 設定',testnetOnly:'テストネットのみ',tools:'ツールとドキュメント',copyNetwork:'ネットワーク追加設定をコピー',networkJSON:'6423 テストネット JSON',apiReference:'API リファレンス',sdk:'SDK と CLI',faucet:'フォーセット',unavailable:'利用不可',sourceOnly:'ソースに限定',checkStatus:'先に状態を確認',serviceDirectory:'6423 サービス一覧',serviceCopy:'検証済みの Explorer とストリーム項目はこのブラウザーセッションで更新され、利用不可のサービスは fail-closed です。',example:'読み取り専用 Explorer API の例',exampleCopy:'この例は現在提供されているポータル要約を照会し、ウォレットアクセス、署名、取引を要求しません。',copyExample:'例をコピー',serviceSchema:'サービスとスキーマ',expectedIdentity:'期待されるID',officialEndpoint:'公式エンドポイント',timeoutCache:'タイムアウトとキャッシュ',verification:'検証 / 劣化時の動作',notVerified:'このブラウザーセッションでは未検証',cache:'キャッシュ',health:'ヘルス'},
      ko:{configuration:'YNX 6423 구성',testnetOnly:'테스트넷 전용',tools:'도구 및 문서',copyNetwork:'네트워크 추가 구성 복사',networkJSON:'6423 테스트넷 JSON',apiReference:'API 참조',sdk:'SDK 및 CLI',faucet:'수도꼭지',unavailable:'사용 불가',sourceOnly:'소스 전용',checkStatus:'먼저 상태 확인',serviceDirectory:'6423 서비스 디렉터리',serviceCopy:'검증된 Explorer 및 스트림 항목은 이 브라우저 세션에서 갱신되며, 사용할 수 없는 서비스는 fail-closed 됩니다.',example:'읽기 전용 Explorer API 예제',exampleCopy:'이 예제는 현재 제공되는 포털 요약을 조회하며 지갑 액세스, 서명 또는 트랜잭션을 요청하지 않습니다.',copyExample:'예제 복사',serviceSchema:'서비스 및 스키마',expectedIdentity:'예상 ID',officialEndpoint:'공식 엔드포인트',timeoutCache:'시간 초과 및 캐시',verification:'검증 / 성능 저하 동작',notVerified:'이 브라우저 세션에서 검증되지 않음',cache:'캐시',health:'상태 확인'}
    };
    const v = key => developerUI[language]?.[key] || developerUI.en[key] || key;
    const serviceNameUI = {
      en:{explorer:'YNX Explorer 6423 adapter',stream:'YNX Explorer live stream',wallet:'YNX Wallet provider',defi:'YNX DeFi services',payments:'YNX Payments',developer:'YNX developer tools',ai:'YNX AI services',social:'YNX Social',dataFabric:'YNX Data Fabric',media:'YNX Media',commerce:'YNX Commerce',infrastructure:'YNX infrastructure',governance:'6423 governance',history:'6423 historical analytics',releases:'YNX signed release manifest'},
      'zh-CN':{explorer:'YNX 6423 浏览器适配器',stream:'YNX 浏览器实时流',wallet:'YNX 钱包提供者',defi:'YNX DeFi 服务',payments:'YNX 支付',developer:'YNX 开发者工具',ai:'YNX AI 服务',social:'YNX 社交',dataFabric:'YNX 数据编织',media:'YNX 媒体',commerce:'YNX 商业',infrastructure:'YNX 基础设施',governance:'6423 治理',history:'6423 历史分析',releases:'YNX 已签名发布清单'},
      'zh-TW':{explorer:'YNX 6423 瀏覽器介面',stream:'YNX 瀏覽器即時串流',wallet:'YNX 錢包提供者',defi:'YNX DeFi 服務',payments:'YNX 支付',developer:'YNX 開發者工具',ai:'YNX AI 服務',social:'YNX 社群',dataFabric:'YNX 資料編織',media:'YNX 媒體',commerce:'YNX 商務',infrastructure:'YNX 基礎設施',governance:'6423 治理',history:'6423 歷史分析',releases:'YNX 已簽章發布清單'},
      ja:{explorer:'YNX Explorer 6423 アダプター',stream:'YNX Explorer ライブストリーム',wallet:'YNX ウォレットプロバイダー',defi:'YNX DeFi サービス',payments:'YNX 決済',developer:'YNX 開発者ツール',ai:'YNX AI サービス',social:'YNX ソーシャル',dataFabric:'YNX データファブリック',media:'YNX メディア',commerce:'YNX コマース',infrastructure:'YNX インフラストラクチャ',governance:'6423 ガバナンス',history:'6423 履歴分析',releases:'YNX 署名付きリリースマニフェスト'},
      ko:{explorer:'YNX Explorer 6423 어댑터',stream:'YNX Explorer 실시간 스트림',wallet:'YNX 지갑 제공자',defi:'YNX DeFi 서비스',payments:'YNX 결제',developer:'YNX 개발자 도구',ai:'YNX AI 서비스',social:'YNX 소셜',dataFabric:'YNX 데이터 패브릭',media:'YNX 미디어',commerce:'YNX 커머스',infrastructure:'YNX 인프라',governance:'6423 거버넌스',history:'6423 기록 분석',releases:'YNX 서명된 릴리스 매니페스트'}
    };
    const serviceName = (key, fallback) => serviceNameUI[language]?.[key] || serviceNameUI.en[key] || fallback;
    const serviceTextUI = {
      en:{explorerSchema:'Explorer JSON: summary, blocks, transactions, accounts, token, validators, resources, and fees',streamSchema:'Server-sent dashboard snapshot',walletSchema:'Standard provider and account response',defiSchema:'Protocol status, market, and settlement records',paymentsSchema:'Merchant, payment-intent, and settlement records',developerSchema:'SDK, API, contract-tooling, and faucet availability records',aiSchema:'Provider capability and permission-bound service records',socialSchema:'Application release and service availability records',dataFabricSchema:'Control-plane, provenance, and integration status records',mediaSchema:'Application release and media-service availability records',commerceSchema:'Storefront, seller, and settlement availability records',infrastructureSchema:'Validator, RPC, indexer, monitor, and release availability records',governanceSchema:'Proposal, vote, and parameter records',historySchema:'Timestamped blocks, transactions, addresses, gas, node health, and token activity',releasesSchema:'Public URL, version, size, SHA-256, signing, source, and published time',degradedVerified:'Keep the current verified snapshot and label the portal degraded.',degradedStream:'Fall back to a ten-second Explorer snapshot.',degradedWallet:'Do not fall back to MetaMask or request an account.',degradedPublic:'No verified public service is available; links and actions stay disabled.',degradedGovernance:'Show unavailable; no governance data endpoint is configured.',degradedHistory:'Show an interactive empty chart; do not infer history.',degradedReleases:'Disable downloads until public artifact evidence is verified.',noStore:'No store',eventStream:'Event stream',sessionOnly:'Session only',noCache:'None',providerDiscovery:'Provider discovery',walletExpected:'0x1917 when connected'},
      'zh-CN':{explorerSchema:'Explorer JSON：摘要、区块、交易、账户、代币、验证者、资源和费用',streamSchema:'服务器发送的仪表板快照',walletSchema:'标准提供者和账户响应',defiSchema:'协议状态、市场和结算记录',paymentsSchema:'商户、支付意图和结算记录',developerSchema:'SDK、API、合约工具和水龙头可用性记录',aiSchema:'提供者能力和权限绑定服务记录',socialSchema:'应用发布和服务可用性记录',dataFabricSchema:'控制平面、数据溯源和集成状态记录',mediaSchema:'应用发布和媒体服务可用性记录',commerceSchema:'店铺、卖家和结算可用性记录',infrastructureSchema:'验证者、RPC、索引器、监控和发布可用性记录',governanceSchema:'提案、投票和参数记录',historySchema:'带时间戳的区块、交易、地址、Gas、节点健康和代币活动',releasesSchema:'公网 URL、版本、大小、SHA-256、签名、来源和发布时间',degradedVerified:'保留当前已验证快照，并将门户标记为降级。',degradedStream:'回退到十秒 Explorer 快照。',degradedWallet:'不回退到 MetaMask，也不请求账户。',degradedPublic:'没有可验证的公共服务；链接和操作保持禁用。',degradedGovernance:'显示暂不可用；未配置治理数据端点。',degradedHistory:'显示可交互空图表；不推断历史数据。',degradedReleases:'在验证公开制品证据前禁用下载。',noStore:'不缓存',eventStream:'事件流',sessionOnly:'仅本会话',noCache:'无',providerDiscovery:'提供者发现',walletExpected:'连接时为 0x1917'},
      'zh-TW':{explorerSchema:'Explorer JSON：摘要、區塊、交易、帳戶、代幣、驗證者、資源與費用',streamSchema:'伺服器傳送的儀表板快照',walletSchema:'標準提供者與帳戶回應',defiSchema:'協議狀態、市場與結算記錄',paymentsSchema:'商家、付款意圖與結算記錄',developerSchema:'SDK、API、合約工具與水龍頭可用性記錄',aiSchema:'提供者能力與權限綁定服務記錄',socialSchema:'應用發布與服務可用性記錄',dataFabricSchema:'控制平面、資料溯源與整合狀態記錄',mediaSchema:'應用發布與媒體服務可用性記錄',commerceSchema:'店面、賣家與結算可用性記錄',infrastructureSchema:'驗證者、RPC、索引器、監控與發布可用性記錄',governanceSchema:'提案、投票與參數記錄',historySchema:'具時間戳記的區塊、交易、位址、Gas、節點健康與代幣活動',releasesSchema:'公開 URL、版本、大小、SHA-256、簽章、來源與發布時間',degradedVerified:'保留目前已驗證快照，並將入口標示為降級。',degradedStream:'回退至十秒 Explorer 快照。',degradedWallet:'不回退到 MetaMask，也不請求帳戶。',degradedPublic:'沒有可驗證的公開服務；連結與操作維持停用。',degradedGovernance:'顯示暫時不可用；未設定治理資料端點。',degradedHistory:'顯示可互動空圖表；不推論歷史資料。',degradedReleases:'在驗證公開制品證據前停用下載。',noStore:'不快取',eventStream:'事件串流',sessionOnly:'僅本工作階段',noCache:'無',providerDiscovery:'提供者探索',walletExpected:'連線時為 0x1917'},
      ja:{explorerSchema:'Explorer JSON：概要、ブロック、取引、アカウント、トークン、バリデーター、リソース、手数料',streamSchema:'サーバー送信のダッシュボードスナップショット',walletSchema:'標準プロバイダーとアカウント応答',defiSchema:'プロトコル状態、市場、決済レコード',paymentsSchema:'加盟店、支払いインテント、決済レコード',developerSchema:'SDK、API、コントラクトツール、フォーセットの可用性レコード',aiSchema:'プロバイダー能力と権限バインド済みサービスレコード',socialSchema:'アプリリリースとサービス可用性レコード',dataFabricSchema:'コントロールプレーン、データ来歴、統合状態レコード',mediaSchema:'アプリリリースとメディアサービス可用性レコード',commerceSchema:'ストアフロント、販売者、決済の可用性レコード',infrastructureSchema:'バリデーター、RPC、インデクサー、監視、リリース可用性レコード',governanceSchema:'提案、投票、パラメータレコード',historySchema:'時刻付きブロック、取引、アドレス、Gas、ノード健全性、トークン活動',releasesSchema:'公開 URL、バージョン、サイズ、SHA-256、署名、ソース、公開時刻',degradedVerified:'現在の検証済みスナップショットを保持し、ポータルを劣化状態として表示します。',degradedStream:'10 秒の Explorer スナップショットにフォールバックします。',degradedWallet:'MetaMask にフォールバックせず、アカウントも要求しません。',degradedPublic:'検証済みの公開サービスはありません。リンクと操作は無効のままです。',degradedGovernance:'利用不可を表示します。ガバナンスデータエンドポイントは未設定です。',degradedHistory:'インタラクティブな空チャートを表示し、履歴を推測しません。',degradedReleases:'公開アーティファクト証拠が検証されるまでダウンロードを無効にします。',noStore:'保存しない',eventStream:'イベントストリーム',sessionOnly:'このセッションのみ',noCache:'なし',providerDiscovery:'プロバイダー検出',walletExpected:'接続時は 0x1917'},
      ko:{explorerSchema:'Explorer JSON: 요약, 블록, 트랜잭션, 계정, 토큰, 검증인, 리소스 및 수수료',streamSchema:'서버 전송 대시보드 스냅샷',walletSchema:'표준 제공자 및 계정 응답',defiSchema:'프로토콜 상태, 시장 및 결제 레코드',paymentsSchema:'판매자, 결제 인텐트 및 정산 레코드',developerSchema:'SDK, API, 컨트랙트 도구 및 수도꼭지 가용성 레코드',aiSchema:'제공자 기능 및 권한 바인딩 서비스 레코드',socialSchema:'앱 릴리스 및 서비스 가용성 레코드',dataFabricSchema:'제어 평면, 데이터 계보 및 통합 상태 레코드',mediaSchema:'앱 릴리스 및 미디어 서비스 가용성 레코드',commerceSchema:'스토어프론트, 판매자 및 정산 가용성 레코드',infrastructureSchema:'검증인, RPC, 인덱서, 모니터 및 릴리스 가용성 레코드',governanceSchema:'제안, 투표 및 파라미터 레코드',historySchema:'타임스탬프 블록, 트랜잭션, 주소, Gas, 노드 상태 및 토큰 활동',releasesSchema:'공개 URL, 버전, 크기, SHA-256, 서명, 소스 및 게시 시간',degradedVerified:'현재 검증된 스냅샷을 유지하고 포털을 성능 저하로 표시합니다.',degradedStream:'10초 Explorer 스냅샷으로 대체합니다.',degradedWallet:'MetaMask로 대체하지 않고 계정을 요청하지 않습니다.',degradedPublic:'검증된 공개 서비스가 없습니다. 링크와 작업은 계속 비활성화됩니다.',degradedGovernance:'사용 불가를 표시합니다. 거버넌스 데이터 엔드포인트가 구성되지 않았습니다.',degradedHistory:'대화형 빈 차트를 표시하며 이력을 추론하지 않습니다.',degradedReleases:'공개 아티팩트 증거가 검증될 때까지 다운로드를 비활성화합니다.',noStore:'저장 안 함',eventStream:'이벤트 스트림',sessionOnly:'이 세션만',noCache:'없음',providerDiscovery:'제공자 검색',walletExpected:'연결 시 0x1917'}
    };
    const serviceText = (key, fallback) => serviceTextUI[language]?.[key] || serviceTextUI.en[key] || fallback;
    const serviceDegradedKey = key => ({explorer:'degradedVerified',stream:'degradedStream',wallet:'degradedWallet',governance:'degradedGovernance',history:'degradedHistory',releases:'degradedReleases'})[key] || 'degradedPublic';
    const serviceCache = cache => ({'no-store':'noStore','event stream':'eventStream','session only':'sessionOnly','none':'noCache'})[cache] || cache;
    const doc = key => documentationUI[language]?.[key] || documentationUI.en[key] || key;
    const home = key => homeUI[language]?.[key] || homeUI.en[key] || key;
    const live = (key, values = {}) => (liveUI[language]?.[key] || liveUI.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    // Runtime strings use the same locale selection and fallback path as the
    // route copy.  These messages cover rows, drawers, and transient states
    // that are created after the initial document has loaded.
    const interactionUI = {
      en:{empty:'Empty',finalized:'Finalized',transaction:'{count} transaction',transactions:'{count} transactions',block:'Block #{height}',slot:'{seconds}s slot',finalityObserved:'Finality observed',noFinalizedBlocks:'No finalized blocks yet.',resourceUnavailable:'Resource analytics temporarily unavailable',delegated:'Delegated YNXT',rental:'Rental volume',providerIncome:'Provider income',protocolFees:'Protocol fees',policy:'Policy',activeDelegations:'Active delegations',rentals:'Rentals',evidence:'Evidence',blockLag:'Block #{height} / {lag}-block index lag',liveDetail:'Live {type} detail',copy:'Copy',copyValue:'Copy value',noMatch:'No matching verified 6423 record was found.',searching:'Searching live chain data',resolving:'Resolving RPC and indexer records…',searchResult:'Search result',copied:'Copied to clipboard',clipboardUnavailable:'Clipboard unavailable',routeCopied:'Route copied',from:'From',to:'To',sentTo:'sent to',validator:'Validator',noValidatorRecords:'No validator records available.'},
      'zh-CN':{empty:'空区块',finalized:'已最终确定',transaction:'{count} 笔交易',transactions:'{count} 笔交易',block:'区块 #{height}',slot:'{seconds} 秒出块',finalityObserved:'已观测到终局性',noFinalizedBlocks:'暂无最终确定区块。',resourceUnavailable:'资源分析暂不可用',delegated:'已委托 YNXT',rental:'租赁量',providerIncome:'提供者收入',protocolFees:'协议费用',policy:'政策',activeDelegations:'活跃委托',rentals:'租赁',evidence:'证据',blockLag:'区块 #{height} / 索引延迟 {lag} 个区块',liveDetail:'实时{type}详情',copy:'复制',copyValue:'复制值',noMatch:'未找到匹配的已验证 6423 记录。',searching:'正在搜索实时链数据',resolving:'正在解析 RPC 和索引器记录…',searchResult:'搜索结果',copied:'已复制到剪贴板',clipboardUnavailable:'剪贴板不可用',routeCopied:'路由已复制',from:'从',to:'至',sentTo:'转至',validator:'验证者',noValidatorRecords:'暂无可用验证者记录。'},
      'zh-TW':{empty:'空區塊',finalized:'已最終確定',transaction:'{count} 筆交易',transactions:'{count} 筆交易',block:'區塊 #{height}',slot:'{seconds} 秒出塊',finalityObserved:'已觀測到最終性',noFinalizedBlocks:'尚無最終確定區塊。',resourceUnavailable:'資源分析暫時不可用',delegated:'已委託 YNXT',rental:'租賃量',providerIncome:'提供者收入',protocolFees:'協議費用',policy:'政策',activeDelegations:'有效委託',rentals:'租賃',evidence:'證據',blockLag:'區塊 #{height} / 索引延遲 {lag} 個區塊',liveDetail:'即時{type}詳情',copy:'複製',copyValue:'複製值',noMatch:'找不到相符的已驗證 6423 記錄。',searching:'正在搜尋即時鏈資料',resolving:'正在解析 RPC 與索引器記錄…',searchResult:'搜尋結果',copied:'已複製到剪貼簿',clipboardUnavailable:'剪貼簿暫時不可用',routeCopied:'路由已複製',from:'從',to:'至',sentTo:'轉至',validator:'驗證者',noValidatorRecords:'暫無可用驗證者記錄。'},
      ja:{empty:'空ブロック',finalized:'確定',transaction:'{count} 件のトランザクション',transactions:'{count} 件のトランザクション',block:'ブロック #{height}',slot:'{seconds} 秒スロット',finalityObserved:'ファイナリティを確認',noFinalizedBlocks:'確定済みブロックはまだありません。',resourceUnavailable:'リソース分析は一時的に利用できません',delegated:'委任済み YNXT',rental:'レンタル量',providerIncome:'プロバイダー収益',protocolFees:'プロトコル手数料',policy:'ポリシー',activeDelegations:'アクティブな委任',rentals:'レンタル',evidence:'証拠',blockLag:'ブロック #{height} / インデックス遅延 {lag} ブロック',liveDetail:'ライブ{type}詳細',copy:'コピー',copyValue:'値をコピー',noMatch:'一致する検証済み 6423 レコードはありません。',searching:'ライブチェーンデータを検索中',resolving:'RPC とインデクサーのレコードを解決中…',searchResult:'検索結果',copied:'クリップボードにコピーしました',clipboardUnavailable:'クリップボードを利用できません',routeCopied:'ルートをコピーしました',from:'送信元',to:'送信先',sentTo:'送信先',validator:'バリデーター',noValidatorRecords:'利用可能なバリデーターレコードはありません。'},
      ko:{empty:'빈 블록',finalized:'확정됨',transaction:'트랜잭션 {count}건',transactions:'트랜잭션 {count}건',block:'블록 #{height}',slot:'{seconds}초 슬롯',finalityObserved:'최종성 확인됨',noFinalizedBlocks:'확정된 블록이 아직 없습니다.',resourceUnavailable:'리소스 분석을 일시적으로 사용할 수 없습니다',delegated:'위임된 YNXT',rental:'대여량',providerIncome:'제공자 수익',protocolFees:'프로토콜 수수료',policy:'정책',activeDelegations:'활성 위임',rentals:'대여',evidence:'증거',blockLag:'블록 #{height} / 인덱서 지연 {lag}개 블록',liveDetail:'실시간 {type} 상세',copy:'복사',copyValue:'값 복사',noMatch:'일치하는 검증된 6423 레코드가 없습니다.',searching:'실시간 체인 데이터를 검색 중',resolving:'RPC 및 인덱서 레코드를 확인하는 중…',searchResult:'검색 결과',copied:'클립보드에 복사됨',clipboardUnavailable:'클립보드를 사용할 수 없음',routeCopied:'경로가 복사됨',from:'보낸 사람',to:'받는 사람',sentTo:'전송 대상',validator:'검증인',noValidatorRecords:'사용 가능한 검증인 레코드가 없습니다.'}
    };
    const i = (key, values = {}) => (interactionUI[language]?.[key] || interactionUI.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    // Values produced after the initial document is rendered use the same
    // locale-aware contract as labels.  Do not surface upstream enum values
    // or English pagination fragments as public UI text.
    const runtimeUI = {
      en:{sourceVerified:'RPC + indexer verified',sourceNative:'Verified RPC native-asset status',sourceUnavailable:'Verified source unavailable',pagination:'{shown} of {total} verified indexed records',transfer:'Transfer',faucet:'Faucet',resourceAction:'Resource action',transaction:'Transaction',observedAccounts:'{total} observed accounts / showing top {shown}',publicAccounts:'{total} public accounts / showing top {shown}',accountBalancesUnavailable:'No verifiable indexed account balances are available yet.',nativeTokenSource:'Native token status from the verified RPC snapshot'},
      'zh-CN':{sourceVerified:'RPC 与索引器已验证',sourceNative:'已验证 RPC 原生资产状态',sourceUnavailable:'已验证来源暂不可用',pagination:'已显示 {shown} / 共 {total} 条已验证索引记录',transfer:'转账',faucet:'水龙头',resourceAction:'资源操作',transaction:'交易',observedAccounts:'{total} 个已观测账户 / 展示前 {shown}',publicAccounts:'{total} 个全账本账户 / 展示前 {shown}',accountBalancesUnavailable:'暂未发现可验证的已索引账户余额。',nativeTokenSource:'来自已验证 RPC 快照的原生代币状态'},
      'zh-TW':{sourceVerified:'RPC 與索引器已驗證',sourceNative:'已驗證 RPC 原生資產狀態',sourceUnavailable:'已驗證來源暫時不可用',pagination:'已顯示 {shown} / 共 {total} 筆已驗證索引記錄',transfer:'轉帳',faucet:'水龍頭',resourceAction:'資源操作',transaction:'交易',observedAccounts:'{total} 個已觀測帳戶 / 顯示前 {shown}',publicAccounts:'{total} 個全帳本帳戶 / 顯示前 {shown}',accountBalancesUnavailable:'尚未發現可驗證的已索引帳戶餘額。',nativeTokenSource:'來自已驗證 RPC 快照的原生代幣狀態'},
      ja:{sourceVerified:'RPC とインデクサーを検証済み',sourceNative:'検証済み RPC のネイティブ資産状態',sourceUnavailable:'検証済みソースを利用できません',pagination:'{total} 件中 {shown} 件の検証済み索引レコードを表示',transfer:'送金',faucet:'フォーセット',resourceAction:'リソース操作',transaction:'トランザクション',observedAccounts:'観測済みアカウント {total} 件 / 上位 {shown} 件を表示',publicAccounts:'公開アカウント {total} 件 / 上位 {shown} 件を表示',accountBalancesUnavailable:'検証可能な索引済みアカウント残高はまだありません。',nativeTokenSource:'検証済み RPC スナップショットのネイティブトークン状態'},
      ko:{sourceVerified:'RPC 및 인덱서 검증됨',sourceNative:'검증된 RPC 네이티브 자산 상태',sourceUnavailable:'검증된 소스를 사용할 수 없음',pagination:'검증된 인덱스 레코드 {total}건 중 {shown}건 표시',transfer:'전송',faucet:'수도꼭지',resourceAction:'리소스 작업',transaction:'트랜잭션',observedAccounts:'관측된 계정 {total}개 / 상위 {shown}개 표시',publicAccounts:'공개 계정 {total}개 / 상위 {shown}개 표시',accountBalancesUnavailable:'검증 가능한 인덱스 계정 잔액이 아직 없습니다.',nativeTokenSource:'검증된 RPC 스냅샷의 네이티브 토큰 상태'}
    };
    const runtime = (key, values = {}) => (runtimeUI[language]?.[key] || runtimeUI.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    const transactionType = type => runtime(({transfer:'transfer',faucet:'faucet',resource_sponsored_action:'resourceAction'})[String(type || '').toLowerCase()] || 'transaction');
    const sourceTruth = value => String(value || '') === 'rpc-and-indexer-backed' ? runtime('sourceVerified') : String(value || '') === 'native-token-from-rpc-status' ? runtime('sourceNative') : runtime('sourceUnavailable');
    const validatorUI = {
      en:{title:'Validators & nodes',copy:'Validator state is verified from the current 6423 RPC response. Node endpoints remain unavailable until they are independently authenticated.',validator:'Validator',status:'Status',votingPower:'Voting power',observedHeight:'Observed height',lastSeen:'Last seen',ready:'Ready',notReady:'Not ready',loading:'Loading verified validator records…',retry:'Verified validator records are temporarily unavailable.',nodesUnavailable:'No independently authenticated node directory is available.'},
      'zh-CN':{title:'验证者与节点',copy:'验证者状态来自当前 6423 RPC 的已验证响应；节点端点在独立完成身份验证前保持暂不可用。',validator:'验证者',status:'状态',votingPower:'投票权重',observedHeight:'观测高度',lastSeen:'最后观测',ready:'就绪',notReady:'未就绪',loading:'正在加载已验证的验证者记录…',retry:'已验证的验证者记录暂时不可用。',nodesUnavailable:'暂无已独立验证的节点目录。'},
      'zh-TW':{title:'驗證者與節點',copy:'驗證者狀態來自目前 6423 RPC 的已驗證回應；節點端點在獨立完成身分驗證前維持暫時不可用。',validator:'驗證者',status:'狀態',votingPower:'投票權重',observedHeight:'觀測高度',lastSeen:'最後觀測',ready:'就緒',notReady:'未就緒',loading:'正在載入已驗證的驗證者記錄…',retry:'已驗證的驗證者記錄暫時不可用。',nodesUnavailable:'暫無已獨立驗證的節點目錄。'},
      ja:{title:'バリデーターとノード',copy:'バリデーター状態は現在の 6423 RPC 応答から検証されています。ノードエンドポイントは独立して認証されるまで利用できません。',validator:'バリデーター',status:'状態',votingPower:'投票パワー',observedHeight:'観測ブロック高',lastSeen:'最終観測',ready:'準備完了',notReady:'未準備',loading:'検証済みバリデーターレコードを読み込み中…',retry:'検証済みバリデーターレコードを一時的に利用できません。',nodesUnavailable:'独立して認証済みのノードディレクトリはありません。'},
      ko:{title:'검증인 및 노드',copy:'검증인 상태는 현재 6423 RPC 응답으로 검증됩니다. 노드 엔드포인트는 독립적으로 인증될 때까지 사용할 수 없습니다.',validator:'검증인',status:'상태',votingPower:'투표 지분',observedHeight:'관측 높이',lastSeen:'마지막 관측',ready:'준비됨',notReady:'준비 안 됨',loading:'검증된 검증인 레코드를 불러오는 중…',retry:'검증된 검증인 레코드를 일시적으로 사용할 수 없습니다.',nodesUnavailable:'독립적으로 인증된 노드 디렉터리가 없습니다.'}
    };
    const validatorText = key => validatorUI[language]?.[key] || validatorUI.en[key] || key;
    const detailUI = {
      en:{block:'Block',transaction:'Transaction',account:'Account',token:'Token',validator:'Validator',height:'Height',hash:'Hash',parentHash:'Parent hash',time:'Time',validatorLabel:'Validator',transactionCount:'Transactions',type:'Type',from:'From',to:'To',amount:'Amount',fee:'Fee',nonce:'Nonce',blockHash:'Block hash',blockNumber:'Block number',timestamp:'Timestamp',memo:'Memo',sponsor:'Sponsor',sponsorPool:'Sponsor pool',resourceType:'Resource type',resourceConsumed:'Resource consumed',resource:'Resource',bandwidth:'Bandwidth',compute:'Compute',aiCredits:'AI credits',trustCredits:'Trust credits',payCredits:'Pay credits',actionReference:'Action reference',lotMovements:'Lot movements',eventLogs:'Event logs',ynxAddress:'YNX native address',evmAddress:'EVM compatibility address',balance:'Balance',staked:'Staked',resourceUsage:'Resource usage',bandwidthUsed:'Bandwidth used',computeUsed:'Compute used',aiCreditsUsed:'AI credits used',trustUsed:'Trust credits used',payCreditsUsed:'Pay credits used',lotsRecorded:'Recorded lots',traceRecords:'Trace records',symbol:'Symbol',name:'Name',assetType:'Asset type',decimals:'Decimals',chainName:'Chain name',chainID:'Chain ID',nativeAsset:'Native asset',usage:'Usage',source:'Source',unavailable:'Unavailable',none:'None',yes:'Yes',no:'No',items:'{count} item(s)',nativeAssetType:'Native gas, resource, Pay, Trust, and AI token',gas:'Gas',staking:'Staking',resourceCollateral:'Resource collateral',resourceRental:'Resource rental settlement',paySettlement:'Pay settlement'},
      'zh-CN':{block:'区块',transaction:'交易',account:'账户',token:'代币',validator:'验证者',height:'高度',hash:'哈希',parentHash:'父哈希',time:'时间',validatorLabel:'验证者',transactionCount:'交易数',type:'类型',from:'从',to:'至',amount:'数量',fee:'费用',nonce:'随机数',blockHash:'区块哈希',blockNumber:'区块高度',timestamp:'时间戳',memo:'备注',sponsor:'赞助方',sponsorPool:'赞助池',resourceType:'资源类型',resourceConsumed:'已消耗资源',resource:'资源',bandwidth:'带宽',compute:'计算',aiCredits:'AI 积分',trustCredits:'信任积分',payCredits:'支付积分',actionReference:'操作引用',lotMovements:'批次流转',eventLogs:'事件日志',ynxAddress:'YNX 原生地址',evmAddress:'EVM 兼容地址',balance:'余额',staked:'已质押',resourceUsage:'资源使用',bandwidthUsed:'已用带宽',computeUsed:'已用计算',aiCreditsUsed:'已用 AI 积分',trustUsed:'已用信任积分',payCreditsUsed:'已用支付积分',lotsRecorded:'已记录批次',traceRecords:'追溯记录',symbol:'符号',name:'名称',assetType:'资产类型',decimals:'小数位',chainName:'链名称',chainID:'链 ID',nativeAsset:'原生资产',usage:'用途',source:'来源',unavailable:'暂不可用',none:'无',yes:'是',no:'否',items:'{count} 项',nativeAssetType:'原生 Gas、资源、支付、信任与 AI 代币',gas:'Gas',staking:'质押',resourceCollateral:'资源抵押',resourceRental:'资源租赁结算',paySettlement:'支付结算'},
      'zh-TW':{block:'區塊',transaction:'交易',account:'帳戶',token:'代幣',validator:'驗證者',height:'高度',hash:'雜湊',parentHash:'父雜湊',time:'時間',validatorLabel:'驗證者',transactionCount:'交易數',type:'類型',from:'從',to:'至',amount:'數量',fee:'費用',nonce:'隨機數',blockHash:'區塊雜湊',blockNumber:'區塊高度',timestamp:'時間戳記',memo:'備註',sponsor:'贊助方',sponsorPool:'贊助池',resourceType:'資源類型',resourceConsumed:'已消耗資源',resource:'資源',bandwidth:'頻寬',compute:'運算',aiCredits:'AI 點數',trustCredits:'信任點數',payCredits:'支付點數',actionReference:'操作參照',lotMovements:'批次流轉',eventLogs:'事件日誌',ynxAddress:'YNX 原生位址',evmAddress:'EVM 相容位址',balance:'餘額',staked:'已質押',resourceUsage:'資源使用',bandwidthUsed:'已用頻寬',computeUsed:'已用運算',aiCreditsUsed:'已用 AI 點數',trustUsed:'已用信任點數',payCreditsUsed:'已用支付點數',lotsRecorded:'已記錄批次',traceRecords:'追溯記錄',symbol:'符號',name:'名稱',assetType:'資產類型',decimals:'小數位',chainName:'鏈名稱',chainID:'鏈 ID',nativeAsset:'原生資產',usage:'用途',source:'來源',unavailable:'暫時不可用',none:'無',yes:'是',no:'否',items:'{count} 項',nativeAssetType:'原生 Gas、資源、支付、信任與 AI 代幣',gas:'Gas',staking:'質押',resourceCollateral:'資源抵押',resourceRental:'資源租賃結算',paySettlement:'支付結算'},
      ja:{block:'ブロック',transaction:'トランザクション',account:'アカウント',token:'トークン',validator:'バリデーター',height:'高さ',hash:'ハッシュ',parentHash:'親ハッシュ',time:'時刻',validatorLabel:'バリデーター',transactionCount:'トランザクション数',type:'種別',from:'送信元',to:'送信先',amount:'数量',fee:'手数料',nonce:'ノンス',blockHash:'ブロックハッシュ',blockNumber:'ブロック高',timestamp:'タイムスタンプ',memo:'メモ',sponsor:'スポンサー',sponsorPool:'スポンサープール',resourceType:'リソース種別',resourceConsumed:'消費リソース',resource:'リソース',bandwidth:'帯域幅',compute:'コンピュート',aiCredits:'AI クレジット',trustCredits:'Trust クレジット',payCredits:'Pay クレジット',actionReference:'アクション参照',lotMovements:'ロット移動',eventLogs:'イベントログ',ynxAddress:'YNX ネイティブアドレス',evmAddress:'EVM 互換アドレス',balance:'残高',staked:'ステーク済み',resourceUsage:'リソース使用量',bandwidthUsed:'使用帯域幅',computeUsed:'使用コンピュート',aiCreditsUsed:'使用 AI クレジット',trustUsed:'使用 Trust クレジット',payCreditsUsed:'使用 Pay クレジット',lotsRecorded:'記録済みロット',traceRecords:'トレース記録',symbol:'シンボル',name:'名称',assetType:'資産種別',decimals:'小数桁',chainName:'チェーン名',chainID:'チェーン ID',nativeAsset:'ネイティブ資産',usage:'用途',source:'ソース',unavailable:'利用不可',none:'なし',yes:'はい',no:'いいえ',items:'{count} 件',nativeAssetType:'ネイティブ Gas、リソース、Pay、Trust、AI トークン',gas:'Gas',staking:'ステーキング',resourceCollateral:'リソース担保',resourceRental:'リソースレンタル決済',paySettlement:'Pay 決済'},
      ko:{block:'블록',transaction:'트랜잭션',account:'계정',token:'토큰',validator:'검증인',height:'높이',hash:'해시',parentHash:'상위 해시',time:'시간',validatorLabel:'검증인',transactionCount:'트랜잭션 수',type:'유형',from:'보낸 주소',to:'받는 주소',amount:'수량',fee:'수수료',nonce:'논스',blockHash:'블록 해시',blockNumber:'블록 높이',timestamp:'타임스탬프',memo:'메모',sponsor:'스폰서',sponsorPool:'스폰서 풀',resourceType:'리소스 유형',resourceConsumed:'소비된 리소스',resource:'리소스',bandwidth:'대역폭',compute:'컴퓨팅',aiCredits:'AI 크레딧',trustCredits:'Trust 크레딧',payCredits:'Pay 크레딧',actionReference:'작업 참조',lotMovements:'로트 이동',eventLogs:'이벤트 로그',ynxAddress:'YNX 네이티브 주소',evmAddress:'EVM 호환 주소',balance:'잔액',staked:'스테이킹됨',resourceUsage:'리소스 사용량',bandwidthUsed:'사용된 대역폭',computeUsed:'사용된 컴퓨팅',aiCreditsUsed:'사용된 AI 크레딧',trustUsed:'사용된 Trust 크레딧',payCreditsUsed:'사용된 Pay 크레딧',lotsRecorded:'기록된 로트',traceRecords:'추적 기록',symbol:'심볼',name:'이름',assetType:'자산 유형',decimals:'소수 자릿수',chainName:'체인 이름',chainID:'체인 ID',nativeAsset:'네이티브 자산',usage:'용도',source:'소스',unavailable:'사용 불가',none:'없음',yes:'예',no:'아니요',items:'{count}개',nativeAssetType:'네이티브 Gas, 리소스, Pay, Trust 및 AI 토큰',gas:'Gas',staking:'스테이킹',resourceCollateral:'리소스 담보',resourceRental:'리소스 대여 정산',paySettlement:'Pay 정산'}
    };
    const detailText = (key, values = {}) => (detailUI[language]?.[key] || detailUI.en[key] || detailUI.en.unavailable).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    const searchUI = {
      en:{timeUnavailable:'Time unavailable',requestUnavailable:'The verified 6423 data is unavailable right now.',requestTimeout:'The verified 6423 service took too long to respond. Please retry.',block:'Block',transaction:'Transaction',token:'Token',validatorAddress:'Validator address',transactionAddress:'Transaction / address',search:'Search',blockSuggestion:'Block #{height}',nativeToken:'YNXT native token',heightSuggestion:'Search block height #{height}',addressSuggestion:'Search transaction or EVM-compatible address',indexSuggestion:'Search the current 6423 index'},
      'zh-CN':{timeUnavailable:'时间暂不可用',requestUnavailable:'已验证的 6423 数据当前暂不可用。',requestTimeout:'已验证的 6423 服务响应超时，请重试。',block:'区块',transaction:'交易',token:'代币',validatorAddress:'验证者地址',transactionAddress:'交易 / 地址',search:'搜索',blockSuggestion:'区块 #{height}',nativeToken:'YNXT 原生代币',heightSuggestion:'搜索区块高度 #{height}',addressSuggestion:'搜索交易或 EVM 兼容地址',indexSuggestion:'搜索当前 6423 索引'},
      'zh-TW':{timeUnavailable:'時間暫時不可用',requestUnavailable:'已驗證的 6423 資料目前暫時不可用。',requestTimeout:'已驗證的 6423 服務回應逾時，請重試。',block:'區塊',transaction:'交易',token:'代幣',validatorAddress:'驗證者位址',transactionAddress:'交易 / 位址',search:'搜尋',blockSuggestion:'區塊 #{height}',nativeToken:'YNXT 原生代幣',heightSuggestion:'搜尋區塊高度 #{height}',addressSuggestion:'搜尋交易或 EVM 相容位址',indexSuggestion:'搜尋目前的 6423 索引'},
      ja:{timeUnavailable:'時刻を利用できません',requestUnavailable:'検証済みの 6423 データを現在利用できません。',requestTimeout:'検証済みの 6423 サービスが時間内に応答しませんでした。再試行してください。',block:'ブロック',transaction:'トランザクション',token:'トークン',validatorAddress:'バリデーターアドレス',transactionAddress:'トランザクション / アドレス',search:'検索',blockSuggestion:'ブロック #{height}',nativeToken:'YNXT ネイティブトークン',heightSuggestion:'ブロック高 #{height} を検索',addressSuggestion:'トランザクションまたは EVM 互換アドレスを検索',indexSuggestion:'現在の 6423 インデックスを検索'},
      ko:{timeUnavailable:'시간을 사용할 수 없음',requestUnavailable:'검증된 6423 데이터를 현재 사용할 수 없습니다.',requestTimeout:'검증된 6423 서비스의 응답 시간이 초과되었습니다. 다시 시도하세요.',block:'블록',transaction:'트랜잭션',token:'토큰',validatorAddress:'검증인 주소',transactionAddress:'트랜잭션 / 주소',search:'검색',blockSuggestion:'블록 #{height}',nativeToken:'YNXT 네이티브 토큰',heightSuggestion:'블록 높이 #{height} 검색',addressSuggestion:'트랜잭션 또는 EVM 호환 주소 검색',indexSuggestion:'현재 6423 인덱스 검색'}
    };
    const searchText = (key, values = {}) => (searchUI[language]?.[key] || searchUI.en[key] || searchUI.en.requestUnavailable).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    const accessibilityUI = {
      en:{skipToContent:'Skip to content'},
      'zh-CN':{skipToContent:'跳到主要内容'},
      'zh-TW':{skipToContent:'跳至主要內容'},
      ja:{skipToContent:'本文へ移動'},
      ko:{skipToContent:'본문으로 건너뛰기'}
    };
    const ax = key => accessibilityUI[language]?.[key] || accessibilityUI.en[key] || key;
    const walletUI = {
      en:{connected:'YNX Wallet connected',session:'EIP-6963 / EIP-1193 session — no signature or transaction was requested',account:'Account',provider:'Provider',providerValue:'YNX Wallet only · MetaMask remains separate',connectedChain:'Connected chain',requiredTestnet:'Required Testnet',onExpected:'Connected to YNX 6423 Testnet',wrongNetwork:'This provider is on a different network. Connection remains intact until you choose to switch.',switchNetwork:'Switch to 0x1917',switchHelp:'Requests a wallet network change',refreshAccount:'Refresh selected account',refreshHelp:'Reads the provider account list',disconnect:'Disconnect',disconnectHelp:'Clears this portal session only',configUnavailable:'No verified public 6423 network configuration is available for this wallet action.'},
      'zh-CN':{connected:'YNX 钱包已连接',session:'EIP-6963 / EIP-1193 会话——未请求签名或交易',account:'账户',provider:'提供者',providerValue:'仅使用 YNX 钱包；MetaMask 保持独立',connectedChain:'已连接网络',requiredTestnet:'所需测试网',onExpected:'已连接至 YNX 6423 测试网',wrongNetwork:'该提供者当前在其他网络；在你选择切换前，连接会保持不变。',switchNetwork:'切换至 0x1917',switchHelp:'将请求钱包网络切换',refreshAccount:'刷新所选账户',refreshHelp:'读取提供者账户列表',disconnect:'断开连接',disconnectHelp:'仅清除此门户会话',configUnavailable:'该钱包操作没有已验证的公开 6423 网络配置。'},
      'zh-TW':{connected:'YNX 錢包已連線',session:'EIP-6963 / EIP-1193 工作階段——未請求簽章或交易',account:'帳戶',provider:'提供者',providerValue:'僅使用 YNX 錢包；MetaMask 維持獨立',connectedChain:'已連線網路',requiredTestnet:'所需測試網',onExpected:'已連線至 YNX 6423 測試網',wrongNetwork:'此提供者目前在其他網路；在你選擇切換前，連線會保持不變。',switchNetwork:'切換至 0x1917',switchHelp:'將請求錢包網路切換',refreshAccount:'重新整理所選帳戶',refreshHelp:'讀取提供者帳戶清單',disconnect:'中斷連線',disconnectHelp:'只清除此入口工作階段',configUnavailable:'此錢包操作沒有已驗證的公開 6423 網路設定。'},
      ja:{connected:'YNX ウォレット接続済み',session:'EIP-6963 / EIP-1193 セッション — 署名や取引は要求していません',account:'アカウント',provider:'プロバイダー',providerValue:'YNX ウォレットのみ使用し、MetaMask は分離されたままです',connectedChain:'接続済みチェーン',requiredTestnet:'必要なテストネット',onExpected:'YNX 6423 テストネットに接続済み',wrongNetwork:'このプロバイダーは別のネットワークにあります。切り替えを選ぶまで接続は維持されます。',switchNetwork:'0x1917 に切り替え',switchHelp:'ウォレットのネットワーク変更を要求します',refreshAccount:'選択アカウントを更新',refreshHelp:'プロバイダーのアカウント一覧を読み取ります',disconnect:'切断',disconnectHelp:'このポータルのセッションのみを消去します',configUnavailable:'このウォレット操作に利用可能な検証済み公開 6423 ネットワーク設定はありません。'},
      ko:{connected:'YNX 지갑 연결됨',session:'EIP-6963 / EIP-1193 세션 — 서명이나 트랜잭션을 요청하지 않았습니다',account:'계정',provider:'제공자',providerValue:'YNX 지갑만 사용하며 MetaMask는 분리되어 유지됩니다',connectedChain:'연결된 체인',requiredTestnet:'필수 테스트넷',onExpected:'YNX 6423 테스트넷에 연결됨',wrongNetwork:'이 제공자는 다른 네트워크에 있습니다. 전환을 선택할 때까지 연결이 유지됩니다.',switchNetwork:'0x1917로 전환',switchHelp:'지갑 네트워크 변경을 요청합니다',refreshAccount:'선택한 계정 새로 고침',refreshHelp:'제공자 계정 목록을 읽습니다',disconnect:'연결 해제',disconnectHelp:'이 포털 세션만 지웁니다',configUnavailable:'이 지갑 작업에 사용할 검증된 공개 6423 네트워크 구성이 없습니다.'}
    };
    const w = key => walletUI[language]?.[key] || walletUI.en[key] || key;
    const footerUI = {
      en:{portal:'YNX Chain · 6423 Testnet portal',disclaimer:'Live testnet data. Mainnet launch is not claimed.'},
      'zh-CN':{portal:'YNX Chain · 6423 测试网门户',disclaimer:'显示实时测试网数据；不声明主网上线。'},
      'zh-TW':{portal:'YNX Chain · 6423 測試網入口',disclaimer:'顯示即時測試網資料；不宣稱主網已上線。'},
      ja:{portal:'YNX Chain · 6423 テストネットポータル',disclaimer:'ライブテストネットデータを表示します。メインネット公開は主張しません。'},
      ko:{portal:'YNX Chain · 6423 테스트넷 포털',disclaimer:'실시간 테스트넷 데이터를 표시하며 메인넷 출시를 주장하지 않습니다.'}
    };
    const footer = key => footerUI[language]?.[key] || footerUI.en[key] || key;
    const ariaUI = {
      en:{primaryNavigation:'Primary navigation',explorerHome:'YNX Chain Explorer home',language:'Language',searchChain:'Search the chain',networkSummary:'Network summary',networkMetrics:'Network metrics',assetSummary:'YNXT network summary',liveBlockStream:'Live finalized block stream',quickFindTransactions:'Quick find transactions',filterTransactionType:'Filter transaction type',networkIntelligenceViews:'Network intelligence views',closeDetail:'Close detail panel'},
      'zh-CN':{primaryNavigation:'主导航',explorerHome:'YNX Chain 浏览器首页',language:'语言',searchChain:'搜索链上数据',networkSummary:'网络摘要',networkMetrics:'网络指标',assetSummary:'YNXT 网络摘要',liveBlockStream:'实时最终确定区块流',quickFindTransactions:'快速查找交易',filterTransactionType:'筛选交易类型',networkIntelligenceViews:'网络洞察视图',closeDetail:'关闭详情面板'},
      'zh-TW':{primaryNavigation:'主導覽',explorerHome:'YNX Chain 瀏覽器首頁',language:'語言',searchChain:'搜尋鏈上資料',networkSummary:'網路摘要',networkMetrics:'網路指標',assetSummary:'YNXT 網路摘要',liveBlockStream:'即時最終確定區塊串流',quickFindTransactions:'快速尋找交易',filterTransactionType:'篩選交易類型',networkIntelligenceViews:'網路洞察檢視',closeDetail:'關閉詳情面板'},
      ja:{primaryNavigation:'メインナビゲーション',explorerHome:'YNX Chain エクスプローラーのホーム',language:'言語',searchChain:'チェーンを検索',networkSummary:'ネットワーク概要',networkMetrics:'ネットワーク指標',assetSummary:'YNXT ネットワーク概要',liveBlockStream:'確定済みブロックのライブストリーム',quickFindTransactions:'トランザクションをすばやく検索',filterTransactionType:'トランザクション種別を絞り込み',networkIntelligenceViews:'ネットワーク分析ビュー',closeDetail:'詳細パネルを閉じる'},
      ko:{primaryNavigation:'주 탐색',explorerHome:'YNX Chain Explorer 홈',language:'언어',searchChain:'체인 검색',networkSummary:'네트워크 요약',networkMetrics:'네트워크 지표',assetSummary:'YNXT 네트워크 요약',liveBlockStream:'확정된 블록 실시간 스트림',quickFindTransactions:'트랜잭션 빠른 찾기',filterTransactionType:'트랜잭션 유형 필터',networkIntelligenceViews:'네트워크 인사이트 보기',closeDetail:'세부 정보 패널 닫기'}
    };
    const a = key => ariaUI[language]?.[key] || ariaUI.en[key] || key;
    const initialUI = {
      en:{loadingBlocks:'Loading blocks…',loadingTransactions:'Loading transactions…',validator:'Validator',role:'Role',status:'Status',votingPower:'Voting power',observedHeight:'Observed height',loadingValidators:'Loading validators…',loadingResourceMarket:'Loading resource market…',loadingAccounts:'Loading accounts…',rank:'Rank',account:'Account',balance:'Balance',staked:'Staked',nonce:'Nonce',loadingAccountBalances:'Loading authoritative account balances…',chainDetail:'Chain detail',loading:'Loading',loadingLiveChain:'Loading live chain data…',connecting:'Connecting',readingState:'Reading RPC and indexer state',openingStream:'Opening live stream',verifiedSources:'RPC + indexer verified',connectingNetwork:'Connecting to the network',awaitingLatestBlock:'Awaiting latest block',waitingFinalizedBlocks:'Waiting for finalized blocks…',evm:'EVM',chainID:'Chain ID',nativeCoin:'Native coin',latestHash:'Latest hash',dataSource:'Data source',rpcIndexer:'RPC + Indexer',all:'All',transfers:'Transfers',resources:'Resources',faucet:'Faucet',range24h:'24h',range7d:'7d',range30d:'30d',pagination:'pagination'},
      'zh-CN':{loadingBlocks:'正在加载区块…',loadingTransactions:'正在加载交易…',validator:'验证者',role:'角色',status:'状态',votingPower:'投票权重',observedHeight:'观测高度',loadingValidators:'正在加载验证者…',loadingResourceMarket:'正在加载资源市场…',loadingAccounts:'正在加载账户…',rank:'排名',account:'账户',balance:'余额',staked:'已质押',nonce:'随机数',loadingAccountBalances:'正在加载权威账户余额…',chainDetail:'链上详情',loading:'正在加载',loadingLiveChain:'正在加载实时链上数据…',connecting:'正在连接',readingState:'正在读取 RPC 与索引器状态',openingStream:'正在打开实时流',verifiedSources:'RPC 与索引器已验证',connectingNetwork:'正在连接网络',awaitingLatestBlock:'正在等待最新区块',waitingFinalizedBlocks:'正在等待最终确定区块…',evm:'EVM',chainID:'链 ID',nativeCoin:'原生代币',latestHash:'最新哈希',dataSource:'数据来源',rpcIndexer:'RPC + 索引器',all:'全部',transfers:'转账',resources:'资源',faucet:'水龙头',range24h:'24 小时',range7d:'7 天',range30d:'30 天',pagination:'分页'},
      'zh-TW':{loadingBlocks:'正在載入區塊…',loadingTransactions:'正在載入交易…',validator:'驗證者',role:'角色',status:'狀態',votingPower:'投票權重',observedHeight:'觀測高度',loadingValidators:'正在載入驗證者…',loadingResourceMarket:'正在載入資源市場…',loadingAccounts:'正在載入帳戶…',rank:'排名',account:'帳戶',balance:'餘額',staked:'已質押',nonce:'隨機數',loadingAccountBalances:'正在載入權威帳戶餘額…',chainDetail:'鏈上詳情',loading:'正在載入',loadingLiveChain:'正在載入即時鏈上資料…',connecting:'正在連線',readingState:'正在讀取 RPC 與索引器狀態',openingStream:'正在開啟即時串流',verifiedSources:'RPC 與索引器已驗證',connectingNetwork:'正在連線至網路',awaitingLatestBlock:'正在等待最新區塊',waitingFinalizedBlocks:'正在等待最終確定區塊…',evm:'EVM',chainID:'鏈 ID',nativeCoin:'原生代幣',latestHash:'最新雜湊',dataSource:'資料來源',rpcIndexer:'RPC + 索引器',all:'全部',transfers:'轉帳',resources:'資源',faucet:'水龍頭',range24h:'24 小時',range7d:'7 天',range30d:'30 天',pagination:'分頁'},
      ja:{loadingBlocks:'ブロックを読み込み中…',loadingTransactions:'トランザクションを読み込み中…',validator:'バリデーター',role:'ロール',status:'状態',votingPower:'投票パワー',observedHeight:'観測ブロック高',loadingValidators:'バリデーターを読み込み中…',loadingResourceMarket:'リソース市場を読み込み中…',loadingAccounts:'アカウントを読み込み中…',rank:'順位',account:'アカウント',balance:'残高',staked:'ステーク済み',nonce:'ノンス',loadingAccountBalances:'信頼できるアカウント残高を読み込み中…',chainDetail:'チェーン詳細',loading:'読み込み中',loadingLiveChain:'ライブチェーンデータを読み込み中…',connecting:'接続中',readingState:'RPC とインデクサーの状態を読み込み中',openingStream:'ライブストリームを開始中',verifiedSources:'RPC とインデクサーを検証済み',connectingNetwork:'ネットワークに接続中',awaitingLatestBlock:'最新ブロックを待機中',waitingFinalizedBlocks:'確定済みブロックを待機中…',evm:'EVM',chainID:'チェーン ID',nativeCoin:'ネイティブコイン',latestHash:'最新ハッシュ',dataSource:'データソース',rpcIndexer:'RPC + インデクサー',all:'すべて',transfers:'送金',resources:'リソース',faucet:'フォーセット',range24h:'24時間',range7d:'7日間',range30d:'30日間',pagination:'ページネーション'},
      ko:{loadingBlocks:'블록을 불러오는 중…',loadingTransactions:'트랜잭션을 불러오는 중…',validator:'검증인',role:'역할',status:'상태',votingPower:'투표 지분',observedHeight:'관측 높이',loadingValidators:'검증인을 불러오는 중…',loadingResourceMarket:'리소스 시장을 불러오는 중…',loadingAccounts:'계정을 불러오는 중…',rank:'순위',account:'계정',balance:'잔액',staked:'스테이킹됨',nonce:'논스',loadingAccountBalances:'신뢰할 수 있는 계정 잔액을 불러오는 중…',chainDetail:'체인 세부 정보',loading:'불러오는 중',loadingLiveChain:'실시간 체인 데이터를 불러오는 중…',connecting:'연결 중',readingState:'RPC 및 인덱서 상태를 읽는 중',openingStream:'실시간 스트림을 여는 중',verifiedSources:'RPC 및 인덱서 검증됨',connectingNetwork:'네트워크에 연결 중',awaitingLatestBlock:'최신 블록 대기 중',waitingFinalizedBlocks:'확정된 블록 대기 중…',evm:'EVM',chainID:'체인 ID',nativeCoin:'네이티브 코인',latestHash:'최신 해시',dataSource:'데이터 소스',rpcIndexer:'RPC + 인덱서',all:'전체',transfers:'전송',resources:'리소스',faucet:'수도꼭지',range24h:'24시간',range7d:'7일',range30d:'30일',pagination:'페이지 나누기'}
    };
    const initial = key => initialUI[language]?.[key] || initialUI.en[key] || key;
    const walletRuntimeUI = {
      en:{accountListDisconnected:'The provider disconnected its account list.',accountNoLongerAvailable:'YNX Wallet no longer exposes an account to this portal. No wallet permission, signature, or transaction changed.',accountUpdated:'YNX Wallet account updated',networkSelected:'YNX 6423 network selected',networkChanged:'Wallet network changed',disconnected:'The provider disconnected.',portalDisconnected:'YNX Wallet disconnected from this portal.',metaMaskNotDetected:'MetaMask not detected',metaMaskNoFallback:'YNX Wallet is intentionally not used as a MetaMask fallback.',metaMaskInstall:'Open MetaMask or install an EIP-1193 MetaMask provider to use the compatibility adapter.',compatibilityRequest:'Compatibility request sent',compatibilityConfirm:'Confirm the YNX Testnet EVM adapter in MetaMask.',nativeIdentity:'YNX-native applications continue to identify this account with its ynx1 address.',requestDeclined:'Wallet request declined',ynxNotDetected:'YNX Wallet provider is not detected. No account request, local session, or fallback to MetaMask was made.',noAccountReturned:'No account returned',connectionNotApproved:'YNX Wallet connection was not approved.',sessionCleared:'The YNX Wallet account was cleared from this portal. No wallet permission, signature, or transaction was changed.',networkNotApproved:'YNX Wallet network change was not approved.',noProviderAccount:'No provider account is currently exposed.',noPortalAccount:'No YNX Wallet account is currently exposed to this portal.',refreshFailed:'YNX Wallet account refresh failed.'},
      'zh-CN':{accountListDisconnected:'提供者已断开账户列表。',accountNoLongerAvailable:'YNX 钱包不再向此门户暴露账户。未更改钱包权限、签名或交易。',accountUpdated:'YNX 钱包账户已更新',networkSelected:'已选择 YNX 6423 网络',networkChanged:'钱包网络已更改',disconnected:'提供者已断开连接。',portalDisconnected:'YNX 钱包已从此门户断开连接。',metaMaskNotDetected:'未检测到 MetaMask',metaMaskNoFallback:'YNX 钱包不会作为 MetaMask 的后备提供者。',metaMaskInstall:'请打开 MetaMask 或安装 EIP-1193 MetaMask 提供者以使用兼容适配器。',compatibilityRequest:'已发送兼容性请求',compatibilityConfirm:'请在 MetaMask 中确认 YNX 测试网 EVM 适配器。',nativeIdentity:'YNX 原生应用仍以其 ynx1 地址识别此账户。',requestDeclined:'钱包请求被拒绝',ynxNotDetected:'未检测到 YNX 钱包提供者。未发起账户请求、创建本地会话或回退到 MetaMask。',noAccountReturned:'未返回账户',connectionNotApproved:'YNX 钱包连接未获批准。',sessionCleared:'YNX 钱包账户已从此门户清除。未更改钱包权限、签名或交易。',networkNotApproved:'YNX 钱包网络更改未获批准。',noProviderAccount:'提供者当前未暴露账户。',noPortalAccount:'YNX 钱包当前未向此门户暴露账户。',refreshFailed:'YNX 钱包账户刷新失败。'},
      'zh-TW':{accountListDisconnected:'提供者已中斷帳戶清單。',accountNoLongerAvailable:'YNX 錢包不再向此入口提供帳戶。未變更錢包權限、簽章或交易。',accountUpdated:'YNX 錢包帳戶已更新',networkSelected:'已選擇 YNX 6423 網路',networkChanged:'錢包網路已變更',disconnected:'提供者已中斷連線。',portalDisconnected:'YNX 錢包已從此入口中斷連線。',metaMaskNotDetected:'未偵測到 MetaMask',metaMaskNoFallback:'YNX 錢包不會作為 MetaMask 的備援提供者。',metaMaskInstall:'請開啟 MetaMask 或安裝 EIP-1193 MetaMask 提供者以使用相容介面。',compatibilityRequest:'已送出相容性請求',compatibilityConfirm:'請在 MetaMask 中確認 YNX 測試網 EVM 介面。',nativeIdentity:'YNX 原生應用仍以 ynx1 位址識別此帳戶。',requestDeclined:'錢包請求遭拒',ynxNotDetected:'未偵測到 YNX 錢包提供者。未發出帳戶請求、建立本機工作階段或回退至 MetaMask。',noAccountReturned:'未回傳帳戶',connectionNotApproved:'YNX 錢包連線未獲核准。',sessionCleared:'YNX 錢包帳戶已從此入口清除。未變更錢包權限、簽章或交易。',networkNotApproved:'YNX 錢包網路變更未獲核准。',noProviderAccount:'提供者目前未提供帳戶。',noPortalAccount:'YNX 錢包目前未向此入口提供帳戶。',refreshFailed:'YNX 錢包帳戶重新整理失敗。'},
      ja:{accountListDisconnected:'プロバイダーのアカウント一覧が切断されました。',accountNoLongerAvailable:'YNX ウォレットはこのポータルにアカウントを公開していません。権限、署名、取引は変更されていません。',accountUpdated:'YNX ウォレットのアカウントを更新しました',networkSelected:'YNX 6423 ネットワークを選択しました',networkChanged:'ウォレットネットワークが変更されました',disconnected:'プロバイダーが切断されました。',portalDisconnected:'YNX ウォレットをこのポータルから切断しました。',metaMaskNotDetected:'MetaMask が検出されません',metaMaskNoFallback:'YNX ウォレットを MetaMask のフォールバックとして使用しません。',metaMaskInstall:'互換アダプターを使うには MetaMask を開くか、EIP-1193 MetaMask プロバイダーをインストールしてください。',compatibilityRequest:'互換性リクエストを送信しました',compatibilityConfirm:'MetaMask で YNX テストネット EVM アダプターを確認してください。',nativeIdentity:'YNX ネイティブアプリは引き続き ynx1 アドレスでこのアカウントを識別します。',requestDeclined:'ウォレットリクエストが拒否されました',ynxNotDetected:'YNX ウォレットプロバイダーが検出されません。アカウント要求、ローカルセッション、MetaMask へのフォールバックは行っていません。',noAccountReturned:'アカウントが返されませんでした',connectionNotApproved:'YNX ウォレット接続は承認されませんでした。',sessionCleared:'YNX ウォレットのアカウントをこのポータルから消去しました。権限、署名、取引は変更されていません。',networkNotApproved:'YNX ウォレットのネットワーク変更は承認されませんでした。',noProviderAccount:'プロバイダーは現在アカウントを公開していません。',noPortalAccount:'YNX ウォレットは現在このポータルにアカウントを公開していません。',refreshFailed:'YNX ウォレットのアカウント更新に失敗しました。'},
      ko:{accountListDisconnected:'제공자의 계정 목록 연결이 해제되었습니다.',accountNoLongerAvailable:'YNX 지갑이 더 이상 이 포털에 계정을 노출하지 않습니다. 지갑 권한, 서명 또는 트랜잭션은 변경되지 않았습니다.',accountUpdated:'YNX 지갑 계정이 업데이트되었습니다',networkSelected:'YNX 6423 네트워크가 선택되었습니다',networkChanged:'지갑 네트워크가 변경되었습니다',disconnected:'제공자 연결이 해제되었습니다.',portalDisconnected:'YNX 지갑이 이 포털에서 연결 해제되었습니다.',metaMaskNotDetected:'MetaMask가 감지되지 않았습니다',metaMaskNoFallback:'YNX 지갑은 MetaMask 대체 수단으로 사용되지 않습니다.',metaMaskInstall:'호환 어댑터를 사용하려면 MetaMask를 열거나 EIP-1193 MetaMask 제공자를 설치하세요.',compatibilityRequest:'호환성 요청을 보냈습니다',compatibilityConfirm:'MetaMask에서 YNX 테스트넷 EVM 어댑터를 확인하세요.',nativeIdentity:'YNX 네이티브 앱은 이 계정을 계속 ynx1 주소로 식별합니다.',requestDeclined:'지갑 요청이 거부되었습니다',ynxNotDetected:'YNX 지갑 제공자가 감지되지 않았습니다. 계정 요청, 로컬 세션 또는 MetaMask 대체를 수행하지 않았습니다.',noAccountReturned:'반환된 계정이 없습니다',connectionNotApproved:'YNX 지갑 연결이 승인되지 않았습니다.',sessionCleared:'YNX 지갑 계정이 이 포털에서 제거되었습니다. 지갑 권한, 서명 또는 트랜잭션은 변경되지 않았습니다.',networkNotApproved:'YNX 지갑 네트워크 변경이 승인되지 않았습니다.',noProviderAccount:'제공자가 현재 계정을 노출하지 않습니다.',noPortalAccount:'YNX 지갑이 현재 이 포털에 계정을 노출하지 않습니다.',refreshFailed:'YNX 지갑 계정 새로 고침에 실패했습니다.'}
    };
    const wm = (key, values = {}) => (walletRuntimeUI[language]?.[key] || walletRuntimeUI.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    const isChinese = () => language.startsWith('zh');
    function renderHomeDirectory() {
      const ecosystem = $('homeEcosystem');
      if (ecosystem) {
        ecosystem.innerHTML = (ecosystemProducts[language] || ecosystemProducts.en).slice(0,4).map(([name,copy],index) => {
          const developer = index === 3;
          return '<article class="ecosystem-card"><h3>' + escapeHTML(name) + '</h3><p>' + escapeHTML(copy) + '</p><span class="product-state">' + escapeHTML(developer ? e('testnet') : e('notPublic')) + '</span><a href="#' + (developer ? 'developers' : 'ecosystem') + '" data-route="' + (developer ? 'developers' : 'ecosystem') + '">' + escapeHTML(developer ? home('openDeveloper') : home('availability')) + '</a></article>';
        }).join('');
      }
      const downloads = $('homeDownloads');
      if (downloads) {
        downloads.innerHTML = (downloadProducts[language] || downloadProducts.en).slice(0,3).map(([name,platform]) => '<article class="download-item"><strong>' + escapeHTML(name) + '</strong><span>' + escapeHTML(platform) + '</span><span>' + escapeHTML(d('installProof')) + '</span><button type="button" disabled aria-disabled="true" title="' + escapeHTML(d('installProof')) + '">' + escapeHTML(d('downloadUnavailable')) + '</button></article>').join('');
      }
    }
    function applyLanguage(nextLanguage) {
      language = messages[nextLanguage] ? nextLanguage : 'en';
      localStorage.setItem('ynx-explorer-language',language);
      document.documentElement.lang = language;
      document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
      document.querySelectorAll('[data-home-i18n]').forEach(node => { node.textContent = home(node.dataset.homeI18n); });
      document.querySelectorAll('[data-live-i18n]').forEach(node => { node.textContent = live(node.dataset.liveI18n); });
      document.querySelectorAll('[data-download-i18n]').forEach(node => { node.textContent = d(node.dataset.downloadI18n); });
      document.querySelectorAll('[data-footer-i18n]').forEach(node => { node.textContent = footer(node.dataset.footerI18n); });
      document.querySelectorAll('[data-a11y-i18n]').forEach(node => { node.textContent = ax(node.dataset.a11yI18n); });
      document.querySelectorAll('[data-initial-i18n]').forEach(node => { node.textContent = initial(node.dataset.initialI18n); });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
      document.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label',a(node.dataset.i18nAria)); });
      renderHomeDirectory();
      $('languageSelect').value = language;
      renderTransactions();
      if (typeof renderLocation === 'function') renderLocation();
    }
    const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const compact = (value, start = 10, end = 7) => { const text = String(value ?? ''); return text.length > start + end + 3 ? text.slice(0,start) + '...' + text.slice(-end) : text || '--'; };
    const number = (value) => new Intl.NumberFormat(language === 'en' ? 'en-US' : language).format(Number(value || 0));
    const relativeTime = (value) => {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
      if (!Number.isFinite(seconds)) return searchText('timeUnavailable');
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
    function clientError(error, fallback) {
      if (error?.name === 'AbortError') return searchText('requestTimeout');
      return fallback || searchText('requestUnavailable');
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
      return '<button class="live-row block-live-row' + (txs === 0 ? ' empty-block-row' : '') + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><span class="row-icon">BK</span><span><span class="row-title"><span class="link mono">#' + escapeHTML(number(block.height)) + '</span><span class="type-tag">' + escapeHTML(txs === 0 ? i('empty') : i('finalized')) + '</span></span><span class="row-subtitle"><span class="mono hash" title="' + escapeHTML(block.hash) + '">' + escapeHTML(compact(block.hash,14,9)) + '</span></span></span><span class="row-side"><strong>' + escapeHTML(i(txs === 1 ? 'transaction' : 'transactions',{count:txs})) + '</strong><span title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</span></span></button>';
    }
    function txRow(tx,index = 0) {
      const isNew = index === 0 && previousTxHash && tx.hash !== previousTxHash;
      const destination = tx.sponsor || tx.to;
      const route = '<span class="transfer-flow"><span class="mono address-chip" data-account="' + escapeHTML(tx.from) + '" title="' + escapeHTML(i('from')) + ' ' + escapeHTML(tx.from) + '">' + escapeHTML(compact(tx.from,8,6)) + '</span><span class="flow-arrow" aria-label="' + escapeHTML(i('sentTo')) + '"></span><span class="mono address-chip" data-account="' + escapeHTML(destination) + '" title="' + escapeHTML(i('to')) + ' ' + escapeHTML(destination) + '">' + escapeHTML(compact(destination,8,6)) + '</span></span>';
      const resourceKey = String(tx.resourceType || '').toLowerCase().replaceAll('_','').replaceAll('-','');
      const resourceLabel = ({bandwidth:'bandwidth',compute:'compute',aicredits:'aiCredits',trustcredits:'trustCredits',paycredits:'payCredits'})[resourceKey] || 'resource';
      const value = tx.resourceConsumed ? escapeHTML(number(tx.resourceConsumed)) + ' ' + escapeHTML(detailText(resourceLabel)) : escapeHTML(number(tx.amount)) + ' YNXT';
      const cost = tx.sponsor ? escapeHTML(detailText('sponsorPool')) + ' ' + escapeHTML(compact(tx.sponsorPoolId,8,5)) : escapeHTML(detailText('fee')) + ' ' + escapeHTML(number(tx.fee));
      return '<button class="live-row tx-live-row' + (isNew ? ' new-row' : '') + '" type="button" data-query="' + escapeHTML(tx.hash) + '"><span class="row-icon tx">TX</span><span><span class="row-title"><span class="link mono hash" title="' + escapeHTML(tx.hash) + '">' + escapeHTML(compact(tx.hash,12,8)) + '</span><span class="type-tag">' + escapeHTML(transactionType(tx.type)) + '</span></span><span class="row-subtitle">' + route + '</span></span><span class="row-side"><strong>' + value + '</strong><span>' + cost + '</span></span></button>';
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
      $('finalityState').textContent = blocks.length ? i('block',{height:number(blocks[0].height)}) : live('awaitingBlock');
      const slot = calculateWindow(blocks).blockTime;
      $('blockTrack').innerHTML = blocks.slice(0,4).map((block,index) => {
        const arrived = index === 0 && previousHeight && incomingHeight > previousHeight;
        const txs = (block.transactions || []).length;
        const state = txs === 0 ? i('empty') : i('finalized');
        const slotLabel = slot > 0 ? i('slot',{seconds:slot.toFixed(1)}) : i('finalityObserved');
        return '<button class="block-chip' + (txs === 0 ? ' empty-block' : '') + (arrived ? ' new' : '') + '" type="button" data-query="' + escapeHTML(block.height) + '"><strong class="mono">#' + escapeHTML(number(block.height)) + '</strong><span>' + escapeHTML(state) + ' · ' + escapeHTML(i(txs === 1 ? 'transaction' : 'transactions',{count:txs})) + '</span><span class="block-chip-meta"><b>' + escapeHTML(slotLabel) + '</b><em title="' + escapeHTML(exactTime(block.time)) + '">' + escapeHTML(relativeTime(block.time)) + '</em></span></button>';
      }).join('') || '<div class="empty">' + escapeHTML(i('noFinalizedBlocks')) + '</div>';
    }
    function renderIntelligence(validatorData, resources) {
      const validators = Array.isArray(validatorData) ? validatorData : (validatorData?.validators || []);
      $('validatorsBody').innerHTML = validators.length ? validators.map(validator => {
        const ready = Boolean(validator.peerReady || validator.active);
        return '<tr><td><strong>' + escapeHTML(validator.moniker || compact(validator.address)) + '</strong><span class="mono hash muted" title="' + escapeHTML(validator.address) + '">' + escapeHTML(compact(validator.address,12,7)) + '</span></td><td>' + escapeHTML(validator.role || i('validator')) + '</td><td><span class="validator-state' + (ready ? '' : ' offline') + '">' + escapeHTML(validatorText(ready ? 'ready' : 'notReady')) + '</span></td><td class="mono">' + escapeHTML(number(validator.votingPower)) + '</td><td class="mono">' + escapeHTML(number(validator.latestHeight)) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="empty">' + escapeHTML(i('noValidatorRecords')) + '</td></tr>';
      if (!resources || typeof resources !== 'object' || !Object.keys(resources).length) {
        $('resourceMetrics').innerHTML = '<article class="resource-item"><small>' + escapeHTML(i('resourceUnavailable')) + '</small></article>';
        $('resourcePolicy').innerHTML = '';
        return;
      }
      const resourceItems = [
        [i('delegated'),resources.delegatedYnxt],
        [i('rental'),resources.rentalVolumeYnxt],
        [i('providerIncome'),resources.providerIncomeYnxt],
        [i('protocolFees'),resources.protocolFeeYnxt]
      ];
      $('resourceMetrics').innerHTML = resourceItems.map(([label,value]) => '<article class="resource-item"><small>' + escapeHTML(label) + '</small><strong>' + escapeHTML(number(value)) + '</strong><small>YNXT</small></article>').join('');
      $('resourcePolicy').innerHTML = '<span>' + escapeHTML(i('policy')) + ' <strong>' + escapeHTML(resources.policyVersion || '--') + '</strong></span><span>' + escapeHTML(i('activeDelegations')) + ' <strong>' + escapeHTML(number(resources.activeDelegationCount)) + '</strong></span><span>' + escapeHTML(i('rentals')) + ' <strong>' + escapeHTML(number(resources.resourceRentalCount)) + '</strong></span><span>' + escapeHTML(i('evidence')) + ' <strong class="mono">' + escapeHTML(compact(resources.policyHash,10,7)) + '</strong></span>';
    }
    function renderAccounts(leaderboard) {
      const accounts = leaderboard?.accounts || [];
      const observed = leaderboard?.truthfulStatus === 'observed-indexed-participant-account-ranking';
      $('assetAccountCount').textContent = number(leaderboard?.total || accounts.length);
      $('accountTotal').textContent = runtime(observed ? 'observedAccounts' : 'publicAccounts',{total:number(leaderboard?.total || accounts.length),shown:number(accounts.length)});
      $('accountsBody').innerHTML = accounts.length ? accounts.map((account,index) => '<tr><td><strong>#' + (index + 1) + '</strong></td><td><button type="button" class="table-link mono hash" data-query="' + escapeHTML(account.address) + '" title="' + escapeHTML(account.address) + '">' + escapeHTML(account.address) + '</button></td><td class="amount">' + escapeHTML(number(account.balance)) + ' YNXT</td><td>' + escapeHTML(number(account.staked)) + ' YNXT</td><td class="mono">' + escapeHTML(number(account.nonce)) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">' + escapeHTML(runtime('accountBalancesUnavailable')) + '</td></tr>';
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
      $('assetTruthState').textContent = summary.ok ? initial('rpcIndexer') : t('degraded');
      $('assetVerifiedAt').textContent = exactTime(summary.lastCheckedAt);
      $('assetHeight').textContent = i('blockLag',{height:number(summary.rpcHeight),lag:number(summary.syncLagBlocks)});
      $('syncState').textContent = summary.syncLagBlocks === 0 ? t('fullySynced') : t('catchingUp');
      $('syncState').className = 'metric-foot' + (summary.syncLagBlocks === 0 ? ' good' : '');
      $('blockAge').textContent = relativeTime(summary.latestBlockTime);
      $('chainId').textContent = summary.network.chainId + ' / ' + summary.wallet.chainIdHex;
      const nativeName = summary.network.nativeCoinName || 'YNX Token';
      $('nativeCoin').textContent = nativeName === 'YNXT' ? 'YNXT' : nativeName + ' (YNXT)';
      $('latestHash').textContent = compact(summary.latestBlockHash,12,9);
      $('latestHash').title = summary.latestBlockHash || '';
      $('truthState').textContent = sourceTruth(summary.truthfulStatus);
      $('lastUpdated').textContent = live('lastVerified') + ' ' + new Date(summary.lastCheckedAt).toLocaleTimeString(language === 'en' ? 'en-US' : language, {hour:'2-digit',minute:'2-digit',second:'2-digit'});
      $('heroHeight').textContent = i('blockLag',{height:number(summary.rpcHeight),lag:number(summary.syncLagBlocks)});
      // Dashboard refreshes continue after route navigation. Keep the document
      // identity on the portal rather than replacing it with a transient block
      // title whenever live summary data arrives.
      if (!location.hash || location.hash === '#home') document.title = 'YNX Chain | 6423 Testnet portal';
      $('blocksBody').innerHTML = blocks.length ? blocks.slice(0,5).map(blockRow).join('') : '<div class="empty">No indexed blocks yet.</div>';
      renderTransactions();
      renderBlockTrack(blocks,incomingHeight);
      renderIntelligence(validatorData, resources);
      bindQueries();
      const activeRoute = location.hash.split('?')[0].slice(1);
      if (['blockchain','tokens','data','developers'].includes(activeRoute)) renderPortalRoute(activeRoute);
      $('statusText').textContent = summary.ok ? t('operational') : t('degraded');
      $('statusDetail').textContent = summary.ok ? (source === 'Manual snapshot' ? live('manualSnapshot') : source === 'Live SSE' ? live('liveSSE') : source) + ' / ' + t('rpcResponding') : (summary.indexerError || t('degraded'));
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
        $('streamClockText').textContent = live('liveConnected');
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
        $('statusText').textContent = live('reconnecting');
        $('statusDetail').textContent = live('snapshotFallback');
        $('status').className = 'status-bar warn';
        $('streamClock').className = 'stream-clock stale';
        $('streamClockText').textContent = live('streamReconnecting');
        startFallbackPolling();
      };
    }
    const detailRow = (label, value) => [detailText(label), value];
    const presentDetail = (key, value) => {
      if (value === null || value === undefined || value === '') return detailText('unavailable');
      if (key === 'type') return transactionType(value);
      if (key === 'assetType') return detailText('nativeAssetType');
      if (key === 'source') return sourceTruth(value);
      if (key === 'usage') {
        const usage = {'gas':'gas','staking':'staking','resource collateral':'resourceCollateral','resource rental settlement':'resourceRental','Pay settlement':'paySettlement','AI Credits base':'aiCredits','Trust Credits base':'trustCredits'};
        return Array.isArray(value) ? value.map(item => detailText(usage[item] || 'unavailable')).join(' · ') : detailText('unavailable');
      }
      if (key === 'time' || key === 'timestamp') return exactTime(value);
      if (typeof value === 'boolean') return detailText(value ? 'yes' : 'no');
      return String(value);
    };
    function detailStats(type,detail) {
      if (type === 'block') return [[detailText('height'),'#' + number(detail.height)],[detailText('transactionCount'),number((detail.transactions || []).length)],[detailText('validatorLabel'),compact(detail.validator,10,7)]];
      if (type === 'transaction' && detail.sponsor) return [[detailText('resourceConsumed'),number(detail.resourceConsumed) + ' ' + presentDetail('resourceType',detail.resourceType || detailText('unavailable'))],[detailText('sponsor'),compact(detail.sponsor,10,7)],[detailText('sponsorPool'),compact(detail.sponsorPoolId,10,7)]];
      if (type === 'transaction') return [[detailText('amount'),number(detail.amount) + ' YNXT'],[detailText('fee'),number(detail.fee) + ' YNXT'],[detailText('blockNumber'),'#' + number(detail.blockNumber)]];
      if (type === 'account') return [[detailText('ynxAddress'),compact(detail.addressFormats?.ynxAddress || detail.account?.address,14,10)],[detailText('balance'),number(detail.account?.balance) + ' YNXT'],[detailText('staked'),number(detail.account?.staked) + ' YNXT'],[detailText('nonce'),number(detail.account?.nonce)]];
      return [];
    }
    function detailRows(type,detail) {
      if (type === 'block') return [
        detailRow('height','#' + number(detail.height)),detailRow('hash',detail.hash),detailRow('parentHash',detail.parentHash),detailRow('time',presentDetail('time',detail.time)),detailRow('validatorLabel',detail.validator),detailRow('transactionCount',number((detail.transactions || []).length))
      ];
      if (type === 'transaction') return [
        detailRow('hash',detail.hash),detailRow('type',presentDetail('type',detail.type)),detailRow('from',detail.from),detailRow('to',detail.to),detailRow('amount',number(detail.amount) + ' YNXT'),detailRow('fee',number(detail.fee) + ' YNXT'),detailRow('nonce',number(detail.nonce)),detailRow('blockHash',detail.blockHash),detailRow('blockNumber','#' + number(detail.blockNumber)),detailRow('timestamp',presentDetail('timestamp',detail.timestamp)),detailRow('memo',detail.memo),detailRow('sponsor',detail.sponsor),detailRow('sponsorPool',detail.sponsorPoolId),detailRow('resourceType',detail.resourceType),detailRow('resourceConsumed',detail.resourceConsumed ? number(detail.resourceConsumed) : null),detailRow('actionReference',detail.actionReference),detailRow('lotMovements',detailText('items',{count:(detail.lotFlows || []).length})),detailRow('eventLogs',detailText('items',{count:(detail.logs || []).length}))
      ].filter(([,value]) => value !== null && value !== undefined && value !== '');
      if (type === 'account') {
        const account = detail.account || {};
        const usage = account.resourceUsage || {};
        return [
          detailRow('ynxAddress',detail.addressFormats?.ynxAddress || account.address || detailText('unavailable')),detailRow('evmAddress',detail.addressFormats?.evmAddress || account.address || detailText('unavailable')),detailRow('balance',number(account.balance) + ' YNXT'),detailRow('staked',number(account.staked) + ' YNXT'),detailRow('nonce',number(account.nonce)),detailRow('bandwidthUsed',number(usage.bandwidthUsed)),detailRow('computeUsed',number(usage.computeUsed)),detailRow('aiCreditsUsed',number(usage.aiCreditsUsed)),detailRow('trustUsed',number(usage.trustUsed)),detailRow('payCreditsUsed',number(usage.payCreditsUsed)),detailRow('lotsRecorded',detailText('items',{count:Object.keys(account.lots || {}).length})),detailRow('traceRecords',detailText('items',{count:(detail.trace?.lots || []).length}))
        ];
      }
      if (type === 'token') return [
        detailRow('symbol',detail.symbol),detailRow('name',detail.name),detailRow('assetType',presentDetail('assetType',detail.type)),detailRow('decimals',number(detail.decimals)),detailRow('chainName',detail.network?.name),detailRow('chainID',detail.network?.chainId),detailRow('nativeAsset',detail.network?.nativeCurrencySymbol),detailRow('usage',presentDetail('usage',detail.usage)),detailRow('source',presentDetail('source',detail.truthfulStatus))
      ];
      return [detailRow('validatorLabel',detail.moniker || detail.address || detailText('unavailable')),detailRow('hash',detail.address || detailText('unavailable'))];
    }
    let drawerReturnFocus = null;
    function focusDrawer() { window.requestAnimationFrame(() => $('detailClose').focus()); }
    function openDrawer() {
      if (!$('detailBackdrop').classList.contains('visible')) drawerReturnFocus = document.activeElement;
      $('detailBackdrop').classList.add('visible');
      $('detailBackdrop').setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
      focusDrawer();
    }
    function showDrawer(type,query,detail) {
      const title = detailText(type);
      $('detailKicker').textContent = i('liveDetail',{type:title});
      $('detailTitle').textContent = type === 'account' ? compact(detail.addressFormats?.ynxAddress || query,18,12) : title;
      const stats = detailStats(type,detail);
      const summary = stats.length ? '<div class="detail-summary">' + stats.map(([label,value]) => '<div class="detail-stat"><span>' + escapeHTML(label) + '</span><strong class="mono">' + escapeHTML(value) + '</strong></div>').join('') + '</div>' : '';
      const rows = detailRows(type,detail).map(([key,value]) => {
        const text = String(value ?? '');
        const copy = text.length > 10 ? '<button class="copy-button" type="button" data-copy="' + encodeURIComponent(text) + '" aria-label="' + escapeHTML(i('copyValue')) + '">' + escapeHTML(i('copy')) + '</button>' : '';
        return '<div class="detail-row"><dt>' + escapeHTML(key) + '</dt><dd class="mono">' + escapeHTML(text) + '</dd>' + copy + '</div>';
      }).join('');
      $('detailContent').innerHTML = summary + '<dl class="detail-body">' + rows + '</dl>';
      openDrawer();
    }
    function dismissDrawer() {
      const returnFocus = drawerReturnFocus;
      drawerReturnFocus = null;
      $('detailBackdrop').classList.remove('visible');
      $('detailBackdrop').setAttribute('aria-hidden','true');
      document.body.style.overflow = '';
      if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) returnFocus.focus();
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
        $('detailContent').innerHTML = '<div class="result-error">' + escapeHTML(i('noMatch')) + '</div>';
        openDrawer();
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
        const verified = runtime.lastVerifiedAt ? exactTime(runtime.lastVerifiedAt) : v('notVerified');
        const timeout = service.timeoutMs ? (service.timeoutMs / 1000) + 's' : v('unavailable');
        const endpoint = service.officialURL === 'Unavailable' ? v('unavailable') : service.officialURL;
        const schema = serviceText(key + 'Schema',service.schema);
        const expectedIdentity = key === 'wallet' ? serviceText('walletExpected',service.expectedChainID) : service.expectedChainID;
        const health = service.healthEndpoint === 'Unavailable' ? v('unavailable') : service.healthEndpoint === 'Provider discovery' ? serviceText('providerDiscovery',service.healthEndpoint) : service.healthEndpoint;
        const cache = serviceText(serviceCache(service.cache),service.cache);
        // Runtime errors can contain transport details. Keep the public directory
        // failure-closed and show the localized contract instead of raw internals.
        const degraded = runtime.lastError ? v('unavailable') : serviceText(serviceDegradedKey(key),service.degraded);
        return '<tr><td><strong>' + escapeHTML(serviceName(key,service.name)) + '</strong><span class="muted">' + escapeHTML(schema) + '</span></td><td class="mono">' + escapeHTML(expectedIdentity) + '</td><td class="mono">' + escapeHTML(endpoint) + '<br><small>' + escapeHTML(v('health')) + ': ' + escapeHTML(health) + '</small></td><td><span>' + escapeHTML(timeout) + '</span><br><small>' + escapeHTML(v('cache')) + ': ' + escapeHTML(cache) + '</small></td><td><span>' + escapeHTML(verified) + '</span><br><small>' + escapeHTML(degraded) + '</small></td></tr>';
      }).join('');
      return '<div class="table-shell"><table class="route-table"><thead><tr><th>' + escapeHTML(v('serviceSchema')) + '</th><th>' + escapeHTML(v('expectedIdentity')) + '</th><th>' + escapeHTML(v('officialEndpoint')) + '</th><th>' + escapeHTML(v('timeoutCache')) + '</th><th>' + escapeHTML(v('verification')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    function portalTable(items,columns) {
      if (!items?.length) return unavailable(u('recordsUnavailable'));
      return '<div class="table-shell"><table class="route-table"><thead><tr>' + columns.map(column => '<th>' + escapeHTML(column.label) + '</th>').join('') + '</tr></thead><tbody>' + items.map(item => '<tr>' + columns.map(column => '<td class="mono">' + escapeHTML(String(column.value(item) ?? '—')) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    }
    function paginationControls(kind,page) {
      const previousDisabled = page.offset === 0 ? ' disabled aria-disabled="true"' : '';
      const nextDisabled = page.hasMore ? '' : ' disabled aria-disabled="true"';
      const shown = page.items.length ? (page.offset + 1) + '–' + (page.offset + page.items.length) : '0';
      const label = kind === 'blocks' ? r('blocks') : r('transactions');
      return '<div class="page-controls" aria-label="' + escapeHTML(label + ' ' + initial('pagination')) + '"><span>' + escapeHTML(runtime('pagination',{shown,total:number(page.total)})) + '</span><div><button type="button" data-page-kind="' + escapeHTML(kind) + '" data-page-offset="' + Math.max(0,page.offset-page.limit) + '"' + previousDisabled + '>' + escapeHTML(r('previous')) + '</button><button type="button" data-page-kind="' + escapeHTML(kind) + '" data-page-offset="' + (page.offset+page.limit) + '"' + nextDisabled + '>' + escapeHTML(r('next')) + '</button></div></div>';
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
        tbody.innerHTML = items.length ? items.map(tx => '<tr><td><button type="button" class="table-link mono" data-query="' + escapeHTML(tx.hash) + '">' + escapeHTML(compact(tx.hash,12,8)) + '</button></td><td><span class="type-tag">' + escapeHTML(transactionType(tx.type)) + '</span></td><td class="mono">' + escapeHTML(compact(tx.from,9,6)) + '</td><td class="mono">' + escapeHTML(compact(tx.to,9,6)) + '</td><td>' + escapeHTML(number(tx.amount)) + ' YNXT</td><td><button type="button" class="copy-button" data-copy="' + encodeURIComponent(tx.hash || '') + '">' + escapeHTML(u('copyHash')) + '</button></td></tr>').join('') : '<tr><td colspan="6" class="empty">' + escapeHTML(u('noTransactionMatch')) + '</td></tr>';
      }
      controls.innerHTML = paginationControls(kind,page);
      bindQueries();
    }
    function renderBlockchainValidators(payload) {
      const target = $('blockchainValidatorsBody');
      if (!target) return;
      const validators = Array.isArray(payload) ? payload : (payload?.validators || []);
      target.innerHTML = validators.length ? validators.map(validator => {
        const ready = Boolean(validator.peerReady || validator.active);
        const status = ready ? validatorText('ready') : validatorText('notReady');
        return '<tr><td><button type="button" class="table-link" data-search="' + encodeURIComponent(validator.address || validator.moniker || '') + '">' + escapeHTML(validator.moniker || compact(validator.address,14,9)) + '</button><br><small class="mono">' + escapeHTML(compact(validator.address,14,9)) + '</small></td><td><span class="validator-state' + (ready ? '' : ' offline') + '">' + escapeHTML(status) + '</span></td><td class="mono">' + escapeHTML(number(validator.votingPower)) + '</td><td class="mono">' + escapeHTML(number(validator.latestHeight)) + '</td><td title="' + escapeHTML(exactTime(validator.lastSeenAt || validator.updatedAt)) + '">' + escapeHTML(relativeTime(validator.lastSeenAt || validator.updatedAt)) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="empty">' + escapeHTML(i('noValidatorRecords')) + '</td></tr>';
    }
    async function loadBlockchainValidators() {
      const target = $('blockchainValidatorsBody');
      if (target) target.innerHTML = '<tr><td colspan="5" class="empty">' + escapeHTML(validatorText('loading')) + '</td></tr>';
      try { renderBlockchainValidators(await get('/api/validators')); }
      catch (_) { if (target) target.innerHTML = '<tr><td colspan="5" class="empty">' + escapeHTML(validatorText('retry')) + '</td></tr>'; }
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
      $('resultTitle').textContent = w('connected');
      $('resultSubtitle').textContent = w('session');
      $('resultBody').innerHTML = '<dl class="detail-body"><div class="detail-row"><dt>' + escapeHTML(w('account')) + '</dt><dd class="mono">' + escapeHTML(connectedYNXWallet.account) + '</dd></div><div class="detail-row"><dt>' + escapeHTML(w('provider')) + '</dt><dd>' + escapeHTML(w('providerValue')) + '</dd></div><div class="detail-row"><dt>' + escapeHTML(w('connectedChain')) + '</dt><dd class="mono">' + escapeHTML(connectedYNXWallet.chainId || r('unavailable')) + '</dd></div><div class="detail-row"><dt>' + escapeHTML(w('requiredTestnet')) + '</dt><dd class="mono">6423 / 0x1917 / ynx_6423-1</dd></div></dl><div class="' + (onExpectedNetwork ? 'status-note' : 'unavailable') + '">' + escapeHTML(onExpectedNetwork ? w('onExpected') : w('wrongNetwork')) + '</div><div class="portal-list"><button type="button" data-wallet-session="network">' + escapeHTML(w('switchNetwork')) + '<small>' + escapeHTML(w('switchHelp')) + '</small></button><button type="button" data-wallet-session="switch">' + escapeHTML(w('refreshAccount')) + '<small>' + escapeHTML(w('refreshHelp')) + '</small></button><button type="button" data-wallet-session="disconnect">' + escapeHTML(w('disconnect')) + '<small>' + escapeHTML(w('disconnectHelp')) + '</small></button></div>';
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
        if (!account) { clearWalletSession(wm('accountListDisconnected')); showPortalNotice(wm('accountNoLongerAvailable')); return; }
        connectedYNXWallet.account = account;
        updateWalletButton();
        showToast(wm('accountUpdated'));
      });
      provider.on('chainChanged', chainId => {
        if (!connectedYNXWallet || connectedYNXWallet.provider !== provider) return;
        connectedYNXWallet.chainId = String(chainId || '').toLowerCase();
        serviceRuntime.get('wallet').lastVerifiedAt = new Date().toISOString();
        showToast(connectedYNXWallet.chainId === expected6423.evmChainId ? wm('networkSelected') : wm('networkChanged'));
      });
      provider.on('disconnect', () => { if (connectedYNXWallet?.provider === provider) { clearWalletSession(wm('disconnected')); showPortalNotice(wm('portalDisconnected')); } });
    }
    async function switchYNXWalletNetwork() {
      if (!connectedYNXWallet?.provider || !walletConfig) return;
      if (!hasPublicWalletNetworkConfig(walletConfig)) { showPortalNotice(w('configUnavailable')); return; }
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
    async function loadActivityWindow(limit = 24) {
      const target = $('historyChart-activity');
      if (!target) return;
      target.className = 'chart-empty';
      target.textContent = chartText('loading');
      try {
        const page = await get('/api/blocks/latest?limit=' + Math.max(1,Math.min(100,Number(limit) || 24)));
        const blocks = Array.isArray(page.blocks) ? page.blocks.slice().reverse() : [];
        if (!blocks.length) { target.textContent = chartText('windowUnavailable'); return; }
        const counts = blocks.map(block => Array.isArray(block.transactions) ? block.transactions.length : 0);
        const maximum = Math.max(1,...counts);
        const transactions = counts.reduce((total,count) => total + count,0);
        target.className = 'chart-window';
        target.setAttribute('role','group');
        target.setAttribute('aria-label',chartText('windowCaption',{blocks:blocks.length,transactions}));
        target.innerHTML = blocks.map((block,index) => {
          const count = counts[index];
          const height = count === 0 ? 4 : Math.max(12,Math.round((count / maximum) * 100));
          const label = chartText('blockPoint',{height:number(block.height),count:number(count)});
          return '<button type="button" data-search="' + escapeHTML(String(block.height)) + '" title="' + escapeHTML(label) + '" aria-label="' + escapeHTML(label) + '"><span class="chart-bar" style="height:' + height + '%"></span></button>';
        }).join('') + '<p class="chart-window-caption">' + escapeHTML(chartText('windowCaption',{blocks:blocks.length,transactions})) + '</p>';
      } catch (_) {
        target.className = 'chart-empty';
        target.textContent = chartText('windowUnavailable');
      }
    }
    function renderPortalRoute(route) {
      if (!route || route === 'home') { $('homeContent').hidden = false; $('routeView').hidden = true; $('skipLink').setAttribute('href','#homeContent'); document.title = 'YNX Chain | 6423 Testnet portal'; return; }
      $('homeContent').hidden = true;
      const view = $('routeView');
      view.hidden = false;
      $('skipLink').setAttribute('href','#routeView');
      const snapshot = lastDashboard;
      const summary = snapshot?.summary;
      const blocks = snapshot?.blocks || [];
      const txs = snapshot?.transactions || [];
      const set = (title,copy,body) => { view.innerHTML = routeHead(title,copy) + body; document.title = title + ' | YNX Chain'; };
      const observedWindow = calculateWindow(blocks);
      const chainFacts = summary ? [[c('cosmos'),'ynx_6423-1'],[c('numeric'),String(summary.network?.chainId || 6423)],[c('evm'),String(summary.wallet?.chainIdHex || '0x1917')],[c('nativeAsset'),String(summary.nativeSymbol || 'YNXT')],[t('networkTps'),observedWindow.tps.toFixed(2)],[t('blockTime'),observedWindow.blockTime ? observedWindow.blockTime.toFixed(1) + 's' : r('unavailable')],[t('indexerSync'),i('blockLag',{height:number(summary.rpcHeight),lag:number(summary.syncLagBlocks)})],[live('lastVerified'),exactTime(summary.lastCheckedAt)],[c('dataSource'),sourceTruth(summary.truthfulStatus)]] : [];
      if (route === 'blockchain') {
        const blockTable = '<div class="record-actions"><label>' + escapeHTML(u('filter')) + ' <select id="blockchainBlockFilter"><option value="all">' + escapeHTML(u('allBlocks')) + '</option><option value="withTransactions">' + escapeHTML(u('withTransactions')) + '</option><option value="empty">' + escapeHTML(u('emptyBlocks')) + '</option></select></label><button type="button" data-share-route="blockchain">' + escapeHTML(r('copyRoute')) + '</button></div><div class="table-shell"><table class="route-table"><thead><tr><th>' + escapeHTML(u('height')) + '</th><th>' + escapeHTML(u('finalized')) + '</th><th>' + escapeHTML(r('transactions')) + '</th><th>' + escapeHTML(u('status')) + '</th><th>' + escapeHTML(u('hash')) + '</th></tr></thead><tbody id="blockchainBlocksBody"><tr><td colspan="5" class="empty">' + escapeHTML(u('loadingRecords')) + '</td></tr></tbody></table></div><div id="blockchainBlocksControls"></div>';
        const txTable = '<div class="record-actions"><label>' + escapeHTML(u('filter')) + ' <select id="blockchainTransactionFilter"><option value="all">' + escapeHTML(u('allTransactionTypes')) + '</option><option value="transfer">' + escapeHTML(u('transfers')) + '</option><option value="resource_sponsored_action">' + escapeHTML(u('resourceActions')) + '</option><option value="faucet">' + escapeHTML(u('faucet')) + '</option></select></label><button type="button" data-share-route="blockchain">' + escapeHTML(r('copyRoute')) + '</button></div><div class="table-shell"><table class="route-table"><thead><tr><th>' + escapeHTML(u('hash')) + '</th><th>' + escapeHTML(u('type')) + '</th><th>' + escapeHTML(u('from')) + '</th><th>' + escapeHTML(u('to')) + '</th><th>' + escapeHTML(u('amount')) + '</th><th>' + escapeHTML(u('copy')) + '</th></tr></thead><tbody id="blockchainTransactionsBody"><tr><td colspan="6" class="empty">' + escapeHTML(u('loadingRecords')) + '</td></tr></tbody></table></div><div id="blockchainTransactionsControls"></div>';
        const validatorTable = '<p>' + escapeHTML(validatorText('copy')) + '</p><div class="table-shell"><table class="route-table"><thead><tr><th>' + escapeHTML(validatorText('validator')) + '</th><th>' + escapeHTML(validatorText('status')) + '</th><th>' + escapeHTML(validatorText('votingPower')) + '</th><th>' + escapeHTML(validatorText('observedHeight')) + '</th><th>' + escapeHTML(validatorText('lastSeen')) + '</th></tr></thead><tbody id="blockchainValidatorsBody"><tr><td colspan="5" class="empty">' + escapeHTML(validatorText('loading')) + '</td></tr></tbody></table></div>' + unavailable(validatorText('nodesUnavailable'));
        const contracts = unavailable(c('contractsUnavailable'));
        set(...routeHeading('blockchain'),'<div class="route-grid two">' + portalPanel(r('networkStatus'),summary ? facts(chainFacts) : unavailable(c('snapshotUnavailable')),summary?.ok ? u('indexerBacked') : r('unavailable')) + portalPanel(r('contracts'),contracts,r('unavailable')) + '</div><section class="section">' + portalPanel(r('blocks'),blockTable,u('verifiedPagination')) + '</section><section class="section">' + portalPanel(r('transactions'),txTable,u('verifiedPagination')) + '</section><section class="section">' + portalPanel(validatorText('title'),validatorTable,t('reportedRpc')) + '</section>');
        $('blockchainBlockFilter').onchange = () => renderBlockchainPage('blocks');
        $('blockchainTransactionFilter').onchange = () => renderBlockchainPage('transactions');
        loadBlockchainPage('blocks');
        loadBlockchainPage('transactions');
        loadBlockchainValidators();
        return;
      }
      if (route === 'tokens') {
        const transfers = txs.filter(tx => !tx.resourceConsumed).slice(0,10);
        const body = summary ? '<p>' + escapeHTML(c('tokensIntro')) + '</p>' + facts([[c('symbol'),'YNXT'],[c('network'),'ynx_6423-1 / 6423 / 0x1917'],[c('decimals'),String(summary.wallet?.decimals ?? '—')],[c('contract'),c('nativeContract')],[c('source'),runtime('nativeTokenSource')]]) : unavailable(c('tokenMetadataUnavailable'));
        const transferTable = portalTable(transfers,[{label:u('hash'),value:t => compact(t.hash,12,8)},{label:u('from'),value:t => compact(t.from,10,7)},{label:u('to'),value:t => compact(t.to,10,7)},{label:u('amount'),value:t => number(t.amount) + ' YNXT'},{label:r('blocks'),value:t => '#' + number(t.blockNumber)}]);
        const holders = unavailable(c('holdersUnavailable'));
        set(...routeHeading('tokens'),'<div class="route-grid two">' + portalPanel('YNXT',body,c('nativeAsset')) + portalPanel(t('tokenRegistry'),'<div class="portal-list"><button type="button" data-search="YNXT">YNXT <small>' + escapeHTML(c('nativeAsset')) + ' · ' + escapeHTML(u('indexerBacked')) + '</small></button></div>' + unavailable(c('unverifiedTokensUnavailable')),'YNXT') + '</div><section class="section"><div class="route-grid two">' + portalPanel('YNXT ' + r('transactions'),transferTable,u('liveSource')) + portalPanel('YNXT ' + t('accounts'),holders,r('unavailable')) + '</div></section>'); return;
      }
      if (route === 'data') {
        const rows = summary ? [[c('latestBlock'),number(summary.rpcHeight)],[c('indexedTransactions'),number(summary.indexedTxCount)],[t('validators'),number(summary.validatorCount)],[c('indexerLag'),number(summary.syncLagBlocks) + ' ' + t('indexerSync')],[c('snapshotTime'),exactTime(summary.lastCheckedAt)]] : [];
        const resources = snapshot?.resources;
        const resourceRows = resources && typeof resources === 'object' && Object.keys(resources).length ? [[i('delegated'),number(resources.delegatedYnxt) + ' YNXT'],[i('rental'),number(resources.rentalVolumeYnxt) + ' YNXT'],[i('providerIncome'),number(resources.providerIncomeYnxt) + ' YNXT'],[i('protocolFees'),number(resources.protocolFeeYnxt) + ' YNXT']] : [];
        const resourceBody = resourceRows.length ? '<p>' + escapeHTML(resourceAnalytics('copy')) + '</p>' + facts(resourceRows) : unavailable(i('resourceUnavailable'));
        const resourceNote = resources?.truthfulStatus === 'local-devnet' ? resourceAnalytics('localOnly') : r('unavailable');
        const historySource = serviceDirectory.history.officialURL === 'Unavailable' ? r('unavailable') : serviceDirectory.history.officialURL;
        const chartCard = id => { const [title,copy] = chartText(id); const live = id === 'activity'; const tip = live ? chartText('loading') : chartText('empty') + ' ' + chartText('source') + ': ' + historySource + '. ' + chartText('lastVerified') + ': ' + r('unavailable'); const rangeLabel = key => live ? chartText(({ '24h':'window24','7d':'window48','30d':'window72',all:'window100' })[key]) : initial(({ '24h':'range24h','7d':'range7d','30d':'range30d',all:'all' })[key]); return '<article class="portal-panel"><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(copy) + '</p><div class="chart-toolbar" role="toolbar" aria-label="' + escapeHTML(title) + ' ' + escapeHTML(chartText('range')) + '"><button type="button" class="active" data-chart-id="' + id + '" data-chart-range="24h">' + escapeHTML(rangeLabel('24h')) + '</button><button type="button" data-chart-id="' + id + '" data-chart-range="7d">' + escapeHTML(rangeLabel('7d')) + '</button><button type="button" data-chart-id="' + id + '" data-chart-range="30d">' + escapeHTML(rangeLabel('30d')) + '</button><button type="button" data-chart-id="' + id + '" data-chart-range="all">' + escapeHTML(rangeLabel('all')) + '</button></div><div class="chart-empty" id="historyChart-' + id + '" role="status" tabindex="0" title="' + escapeHTML(tip) + '">' + escapeHTML(live ? chartText('loading') : chartText('empty')) + (live ? '' : '<br><small>' + escapeHTML(chartText('source')) + ': ' + escapeHTML(historySource) + ' · ' + escapeHTML(chartText('lastVerified')) + ': ' + escapeHTML(r('unavailable')) + '</small>') + '</div></article>'; };
        const charts = chartCard('activity') + chartCard('addresses') + chartCard('gas') + chartCard('nodes') + chartCard('tokens');
        set(...routeHeading('data'),'<div class="route-grid two">' + portalPanel(r('currentSnapshot'),facts(rows),c('liveSource')) + portalPanel(r('dataPolicy'),'<p>' + escapeHTML(c('dataPolicyCopy')) + '</p>' + facts([[c('service'),serviceDirectory.history.name],[c('expectedIdentity'),serviceDirectory.history.expectedChainID],[c('healthEndpoint'),serviceDirectory.history.healthEndpoint],[c('degradedBehavior'),serviceDirectory.history.degraded]]),c('failClosed')) + '</div><section class="section">' + portalPanel(resourceAnalytics('title'),resourceBody,resourceNote) + '</section><section class="section"><div class="route-grid two">' + charts + '</div></section>'); loadActivityWindow(); return;
      }
      if (route === 'governance') { const panels = governancePanels[language] || governancePanels.en; set(...routeHeading('governance'),'<div class="route-grid two">' + panels.map(([title,copy]) => portalPanel(title,unavailable(copy),r('unavailable'))).join('') + '</div>'); return; }
      if (route === 'ecosystem') {
        const cards = (ecosystemProducts[language] || ecosystemProducts.en).map(([name,copy,,platform],index) => { const localTestnet = index === 3 || index === 9; return '<article class="ecosystem-card"><div class="product-title"><img class="product-mark" src="/assets/ynx-icon.png?v=df071f54b" width="28" height="28" alt=""><h3>' + escapeHTML(name) + '</h3></div><p>' + escapeHTML(copy) + '</p><span class="product-state">' + escapeHTML(localTestnet ? e('testnet') : e('notPublic')) + '</span><div class="product-meta"><span><strong>' + escapeHTML(e('support')) + ':</strong> ' + escapeHTML(localTestnet ? e('localTestnet') : e('notPublic')) + '</span><span><strong>' + escapeHTML(e('platforms')) + ':</strong> ' + escapeHTML(platform) + '</span></div><div class="product-actions"><button type="button" disabled aria-disabled="true" title="' + escapeHTML(e('noProductLink')) + '">' + escapeHTML(e('open')) + '</button><button type="button" disabled aria-disabled="true" title="' + escapeHTML(e('noProductLink')) + '">' + escapeHTML(e('docs')) + '</button><button type="button" disabled aria-disabled="true" title="' + escapeHTML(e('noProductLink')) + '">' + escapeHTML(e('download')) + '</button><button type="button" data-portal-note="' + encodeURIComponent(name + ': ' + e('noProductLink')) + '">' + escapeHTML(e('status')) + '</button></div></article>'; }).join('');
        set(...routeHeading('ecosystem'),'<div class="ecosystem-grid">' + cards + '</div>'); return;
      }
      if (route === 'developers') {
        const publicWalletConfig = hasPublicWalletNetworkConfig(summary?.wallet);
        const rpc = publicWalletConfig ? summary.wallet.rpcUrls[0] : v('unavailable');
        const explorer = publicWalletConfig ? summary.wallet.blockExplorerUrls[0] : v('unavailable');
        const config = facts([[c('cosmos'),'ynx_6423-1'],[c('numeric'),'6423'],[c('evm'),'0x1917'],[c('nativeAsset'),'YNXT'],[c('rpcEndpoint'),rpc],[c('explorerEndpoint'),explorer]]);
        const addNetwork = publicWalletConfig ? JSON.stringify({chainId:'0x1917',chainName:summary?.wallet?.chainName || 'YNX 6423 Testnet',nativeCurrency:{name:summary?.wallet?.nativeCurrencyName || 'YNXT',symbol:'YNXT',decimals:summary?.wallet?.decimals ?? 18},rpcUrls:summary.wallet.rpcUrls,blockExplorerUrls:summary.wallet.blockExplorerUrls},null,2) : '';
        const example = "const response = await fetch('/api/summary', { cache: 'no-store' });\nconst summary = await response.json();\nconsole.log(summary.network.chainId); // 6423";
        const networkControl = publicWalletConfig ? '<button type="button" data-copy="' + encodeURIComponent(addNetwork) + '">' + escapeHTML(v('copyNetwork')) + '<small>' + escapeHTML(v('networkJSON')) + '</small></button>' : '<button type="button" disabled aria-disabled="true" title="' + escapeHTML(doc('publicAPIUnavailable')) + '">' + escapeHTML(v('copyNetwork')) + '<small>' + escapeHTML(v('unavailable')) + '</small></button>';
        const tools = '<div class="portal-list">' + networkControl + '<a href="#documentation" data-route="documentation">' + escapeHTML(v('apiReference')) + '<small>' + escapeHTML(doc('availableHere')) + '</small></a><button type="button" disabled aria-disabled="true" title="' + escapeHTML(doc('publicAPIUnavailable')) + '">' + escapeHTML(v('sdk')) + '<small>' + escapeHTML(v('sourceOnly')) + '</small></button><button type="button" disabled aria-disabled="true" title="' + escapeHTML(doc('publicAPIUnavailable')) + '">' + escapeHTML(v('faucet')) + '<small>' + escapeHTML(v('unavailable')) + '</small></button></div>';
        const exampleCard = '<p>' + escapeHTML(v('exampleCopy')) + '</p><pre class="code-sample"><code>' + escapeHTML(example) + '</code></pre><div class="record-actions"><button type="button" data-copy="' + encodeURIComponent(example) + '">' + escapeHTML(v('copyExample')) + '</button></div>';
        set(...routeHeading('developers'),'<div class="route-grid two">' + portalPanel(v('configuration'),config,v('testnetOnly')) + portalPanel(v('tools'),tools) + '</div><section class="section"><div class="route-grid two">' + portalPanel(v('example'),exampleCard,v('testnetOnly')) + portalPanel(v('serviceDirectory'),serviceDirectoryTable(),v('serviceCopy')) + '</div></section>'); return;
      }
      if (route === 'downloads') {
        const items = (downloadProducts[language] || downloadProducts.en).map(([name,platform]) => '<article class="download-item"><strong>' + escapeHTML(name) + '</strong><span><strong>' + escapeHTML(d('platform')) + ':</strong> ' + escapeHTML(platform) + '</span><span><strong>' + escapeHTML(d('version')) + ':</strong> ' + escapeHTML(d('unavailable')) + '</span><span><strong>' + escapeHTML(d('size')) + ':</strong> ' + escapeHTML(d('unavailable')) + '</span><span><strong>' + escapeHTML(d('sha')) + ':</strong> ' + escapeHTML(d('unavailable')) + '</span><span><strong>' + escapeHTML(d('signing')) + ':</strong> ' + escapeHTML(d('unavailable')) + '</span><span><strong>' + escapeHTML(d('published')) + ':</strong> ' + escapeHTML(d('unavailable')) + '</span><span><strong>' + escapeHTML(d('install')) + ':</strong> ' + escapeHTML(d('installProof')) + '</span><span class="product-state">' + escapeHTML(d('unavailable')) + '</span><button type="button" disabled aria-disabled="true" title="' + escapeHTML(d('installProof')) + '">' + escapeHTML(d('downloadUnavailable')) + '</button></article>').join('');
        set(...routeHeading('downloads'),'<div class="download-grid">' + items + '</div>'); return;
      }
      if (route === 'documentation') { const endpoints = [['GET','/api/summary'],['GET','/api/blocks/latest?limit=10'],['GET','/api/txs?limit=10'],['GET','/api/accounts?limit=10'],['GET','/api/accounts/{address}'],['GET','/api/tokens/YNXT'],['GET','/api/validators'],['GET','/api/resources/{address}'],['GET','/api/resource-market/analytics'],['GET','/api/fees/{hash}'],['GET','/api/search?q=YNXT'],['GET','/api/stream (SSE)']]; const apiTable = '<p>' + escapeHTML(doc('apiCopy')) + '</p><div class="table-shell"><table class="route-table"><thead><tr><th>' + escapeHTML(doc('method')) + '</th><th>' + escapeHTML(doc('endpoint')) + '</th></tr></thead><tbody>' + endpoints.map(([method,endpoint]) => '<tr><td>' + escapeHTML(method) + '</td><td class="mono">' + escapeHTML(endpoint) + '</td></tr>').join('') + '</tbody></table></div>' + unavailable(doc('publicAPIUnavailable')); set(...routeHeading('documentation'),'<div class="route-grid two">' + portalPanel(doc('using'),'<div class="portal-list"><a href="#blockchain" data-route="blockchain">' + escapeHTML(doc('search')) + '</a><a href="#developers" data-route="developers">' + escapeHTML(doc('identifiers')) + '</a><a href="#downloads" data-route="downloads">' + escapeHTML(doc('downloads')) + '</a></div>') + portalPanel(doc('policy'),unavailable(doc('policyCopy'))) + '</div><section class="section">' + portalPanel(doc('api'),apiTable,doc('availableHere')) + '</section>'); return; }
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
      (snapshot.blocks || []).filter(block => String(block.height).includes(lower) || String(block.hash || '').toLowerCase().includes(lower)).slice(0,3).forEach(block => add(String(block.height),searchText('blockSuggestion',{height:number(block.height)}),searchText('block')));
      (snapshot.transactions || []).filter(tx => [tx.hash,tx.from,tx.to].some(value => String(value || '').toLowerCase().includes(lower))).slice(0,3).forEach(tx => add(tx.hash,compact(tx.hash,14,9),searchText('transaction')));
      if ('ynxt'.includes(lower) || lower.includes('ynxt')) add('YNXT',searchText('nativeToken'),searchText('token'));
      const validators = Array.isArray(snapshot.validatorData) ? snapshot.validatorData : (snapshot.validatorData?.validators || []);
      validators.filter(validator => [validator.moniker,validator.address].some(value => String(value || '').toLowerCase().includes(lower))).slice(0,2).forEach(validator => add(validator.address,validator.moniker || compact(validator.address,14,9),searchText('validatorAddress')));
      if (/^\d+$/.test(query)) add(query,searchText('heightSuggestion',{height:query}),searchText('block'));
      if (/^0x[0-9a-f]+$/i.test(query)) add(query,searchText('addressSuggestion'),searchText('transactionAddress'));
      if (suggestions.length === 0) add(query,searchText('indexSuggestion'),searchText('search'));
      box.innerHTML = suggestions.slice(0,6).map(item => '<button type="button" role="option" data-suggestion="' + encodeURIComponent(item.value) + '"><span class="mono">' + escapeHTML(item.label) + '</span><small>' + escapeHTML(item.kind) + '</small></button>').join('');
      box.hidden = false;
    }
    function closeSearchSuggestions() { $('searchSuggestions').hidden = true; }
    async function search(query) {
      const q = String(query || $('searchInput').value).trim();
      if (!q) return;
      closeSearchSuggestions();
      $('searchInput').value = q;
      $('detailKicker').textContent = i('searching');
      $('detailTitle').textContent = compact(q,18,10);
      $('detailContent').innerHTML = '<div class="empty">' + escapeHTML(i('resolving')) + '</div>';
      openDrawer();
      try {
        const resolved = await get('/api/search?q=' + encodeURIComponent(q));
        setDetailLocation(resolved.type,resolved.query || q);
      } catch (error) {
        const unresolvedContract = /^0x[0-9a-f]{40}$/i.test(q);
        $('detailKicker').textContent = i('searchResult');
        $('detailTitle').textContent = unresolvedContract ? r('unavailable') : r('notFound');
        $('detailContent').innerHTML = '<div class="result-error">' + escapeHTML(unresolvedContract ? c('contractsUnavailable') : clientError(error,i('noMatch'))) + '</div>';
      }
    }
    $('searchForm').onsubmit = event => { event.preventDefault(); search(); };
    $('searchInput').oninput = updateSearchSuggestions;
    $('searchInput').onfocus = updateSearchSuggestions;
    $('searchInput').onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); search(); return; }
      if (event.key === 'Escape') { closeSearchSuggestions(); return; }
      if (event.key !== 'ArrowDown') return;
      const first = $('searchSuggestions').querySelector('[data-suggestion]');
      if (first) { event.preventDefault(); first.focus(); }
    };
    $('resultClose').onclick = () => $('resultPanel').classList.remove('visible');
    $('detailClose').onclick = closeDrawer;
    $('detailBackdrop').onclick = event => { if (event.target === $('detailBackdrop')) closeDrawer(); };
    $('detailContent').onclick = async event => {
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      try { await navigator.clipboard.writeText(decodeURIComponent(button.dataset.copy)); showToast(i('copied')); }
      catch (_) { showToast(i('clipboardUnavailable')); }
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
    $('skipLink').onclick = event => {
      event.preventDefault();
      const target = document.querySelector($('skipLink').getAttribute('href'));
      if (!target) return;
      target.scrollIntoView({block:'start'});
      target.focus();
    };
    $('txFilter').onchange = renderTransactions;
    $('txQuickFind').oninput = renderTransactions;
    $('languageSelect').onchange = event => { applyLanguage(event.target.value); load().catch(showLoadError); };
    $('refreshButton').onclick = () => load().catch(showLoadError);
    document.querySelectorAll('[data-refresh]').forEach(button => button.onclick = () => load().catch(showLoadError));
    $('metamaskButton').onclick = async () => {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      const metamask = walletProviders.find(item => item.provider?.isMetaMask === true && item.provider?.isYNXWallet !== true) || (window.ethereum?.isMetaMask === true && window.ethereum?.isYNXWallet !== true ? {provider:window.ethereum} : null);
      if (!metamask) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = wm('metaMaskNotDetected'); $('resultSubtitle').textContent = wm('metaMaskNoFallback'); $('resultBody').innerHTML = '<div class="result-error">' + escapeHTML(wm('metaMaskInstall')) + '</div>'; return; }
      if (!walletConfig) await load();
      if (!hasPublicWalletNetworkConfig(walletConfig)) { showPortalNotice(w('configUnavailable')); return; }
      try {
        await metamask.provider.request({method:'wallet_addEthereumChain',params:[{chainId:walletConfig.chainIdHex,chainName:walletConfig.chainName,nativeCurrency:{name:walletConfig.nativeCurrencyName,symbol:walletConfig.nativeSymbol,decimals:walletConfig.decimals},rpcUrls:walletConfig.rpcUrls,blockExplorerUrls:walletConfig.blockExplorerUrls}]});
        await metamask.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:expected6423.evmChainId}]});
        $('resultPanel').classList.add('visible'); $('resultTitle').textContent = wm('compatibilityRequest'); $('resultSubtitle').textContent = wm('compatibilityConfirm'); $('resultBody').innerHTML = '<div class="empty">' + escapeHTML(wm('nativeIdentity')) + '</div>';
      } catch (_) { $('resultPanel').classList.add('visible'); $('resultTitle').textContent = wm('requestDeclined'); $('resultBody').innerHTML = '<div class="result-error">' + escapeHTML(wm('requestDeclined')) + '</div>'; }
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
      if (!ynx) { showPortalNotice(wm('ynxNotDetected')); return; }
      try {
        const accounts = await ynx.provider.request({method:'eth_requestAccounts'});
        const account = Array.isArray(accounts) && accounts[0] ? accounts[0] : wm('noAccountReturned');
        const chainId = await readWalletChain(ynx.provider);
        connectedYNXWallet = {provider:ynx.provider,account,chainId};
        attachWalletListeners(ynx.provider);
        serviceRuntime.get('wallet').lastVerifiedAt = new Date().toISOString();
        serviceRuntime.get('wallet').lastError = null;
        updateWalletButton();
        showWalletSession();
      } catch (_) { showPortalNotice(wm('connectionNotApproved')); }
    };
    $('moreButton').onclick = () => { const wrap = $('moreButton').closest('.more-wrap'); const open = !wrap.classList.contains('open'); wrap.classList.toggle('open',open); $('moreButton').setAttribute('aria-expanded',String(open)); };
    document.addEventListener('click',async event => {
      const suggestion = event.target.closest('[data-suggestion]');
      if (suggestion) { $('searchInput').value = decodeURIComponent(suggestion.dataset.suggestion); search(); return; }
      const page = event.target.closest('[data-page-kind]');
      if (page && !page.disabled) { loadBlockchainPage(page.dataset.pageKind,Number(page.dataset.pageOffset || 0)); return; }
      const share = event.target.closest('[data-share-route]');
      if (share) { try { await navigator.clipboard.writeText(location.origin + '/#' + share.dataset.shareRoute); showToast(i('routeCopied')); } catch (_) { showToast(i('clipboardUnavailable')); } return; }
      const copy = event.target.closest('[data-copy]');
      if (copy) { try { await navigator.clipboard.writeText(decodeURIComponent(copy.dataset.copy)); showToast(i('copied')); } catch (_) { showToast(i('clipboardUnavailable')); } return; }
      const range = event.target.closest('[data-chart-range]');
      if (range) { const id = range.dataset.chartId || 'activity'; const historySource = serviceDirectory.history.officialURL === 'Unavailable' ? r('unavailable') : serviceDirectory.history.officialURL; const rangeKey = ({'24h':'range24h','7d':'range7d','30d':'range30d',all:'all'})[range.dataset.chartRange] || 'all'; document.querySelectorAll('[data-chart-id="' + id + '"][data-chart-range]').forEach(button => button.classList.toggle('active',button === range)); if (id === 'activity') { loadActivityWindow(({ '24h':24,'7d':48,'30d':72,all:100 })[range.dataset.chartRange] || 24); return; } const chart = $('historyChart-' + id); if (chart) chart.innerHTML = escapeHTML(chartText('range')) + ': <strong>' + escapeHTML(initial(rangeKey)) + '</strong>. ' + escapeHTML(chartText('historyUnavailable')) + '<br><small>' + escapeHTML(chartText('source')) + ': ' + escapeHTML(historySource) + ' · ' + escapeHTML(chartText('lastVerified')) + ': ' + escapeHTML(r('unavailable')) + '</small>'; return; }
      const route = event.target.closest('[data-route]');
      if (route) { event.preventDefault(); const next = route.dataset.route; if (location.hash.slice(1) !== next) location.hash = next; else renderPortalRoute(next); $('moreButton').closest('.more-wrap').classList.remove('open'); $('moreButton').setAttribute('aria-expanded','false'); return; }
      const quick = event.target.closest('[data-search]');
      if (quick) { const value = quick.dataset.search === 'latest' ? String(lastDashboard?.summary?.rpcHeight || '') : quick.dataset.search; search(value); return; }
      const note = event.target.closest('[data-portal-note]');
      if (note) { showPortalNotice(decodeURIComponent(note.dataset.portalNote)); return; }
      const download = event.target.closest('[data-download]');
      if (download) { showPortalNotice(d('installProof')); }
      const walletAction = event.target.closest('[data-wallet-session]');
      if (walletAction?.dataset.walletSession === 'disconnect') { clearWalletSession(); showPortalNotice(wm('sessionCleared')); return; }
      if (walletAction?.dataset.walletSession === 'network') { try { await switchYNXWalletNetwork(); } catch (_) { showPortalNotice(wm('networkNotApproved')); } return; }
      if (walletAction?.dataset.walletSession === 'switch') { if (!connectedYNXWallet?.provider) return; try { const accounts = await connectedYNXWallet.provider.request({method:'eth_accounts'}); const account = Array.isArray(accounts) && accounts[0] ? accounts[0] : null; if (!account) { clearWalletSession(wm('noProviderAccount')); showPortalNotice(wm('noPortalAccount')); return; } connectedYNXWallet.account = account; connectedYNXWallet.chainId = await readWalletChain(connectedYNXWallet.provider); updateWalletButton(); showWalletSession(); } catch (_) { showPortalNotice(wm('refreshFailed')); } }
    });
    window.addEventListener('hashchange',renderLocation);
    function showLoadError() { $('statusText').textContent = live('unavailable'); $('statusDetail').textContent = live('retry'); $('status').className = 'status-bar warn'; $('refreshButton').disabled = false; removeSkeletons(); }
    applyLanguage(language);
    load().catch(showLoadError);
    connectLiveStream();
    renderLocation();
    window.setInterval(() => {
      if (!lastStreamAt) return;
      const age = Math.floor((Date.now() - lastStreamAt) / 1000);
      $('streamClock').className = 'stream-clock ' + (age < 8 ? 'live' : 'stale');
      $('streamClockText').textContent = age < 2 ? live('updatedNow') : (age < 8 ? live('updatedAgo',{seconds:age}) : live('noEvent',{seconds:age}));
    },1000);
    document.addEventListener('keydown',event => {
      if (!$('detailBackdrop').classList.contains('visible')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from($('detailDrawer').querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('visibilitychange',() => { if (!document.hidden) load().catch(showLoadError); });
  </script>
</body>
</html>`
