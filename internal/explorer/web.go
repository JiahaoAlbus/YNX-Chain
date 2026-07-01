package explorer

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>YNX Chain Explorer</title>
  <style>
    :root { color-scheme: light; --blue:#002FA7; --ink:#061133; --muted:#526071; --line:#d9e2ff; --soft:#f5f8ff; --ok:#096b3a; --warn:#8a5200; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color:var(--ink); background:#fff; }
    header { background:var(--blue); color:#fff; padding:18px 24px; }
    header h1 { margin:0; font-size:22px; letter-spacing:0; }
    header p { margin:6px 0 0; color:#dce6ff; font-size:13px; }
    main { max-width:1180px; margin:0 auto; padding:22px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
    input { min-width:280px; flex:1; border:1px solid var(--line); border-radius:6px; padding:11px 12px; font-size:14px; }
    button { border:0; border-radius:6px; background:var(--blue); color:white; padding:11px 14px; font-weight:650; cursor:pointer; }
    button.secondary { background:#eef3ff; color:var(--blue); border:1px solid var(--line); }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; margin:14px 0 22px; }
    .card { border:1px solid var(--line); border-radius:8px; padding:14px; background:#fff; min-height:86px; }
    .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
    .value { margin-top:8px; font-size:19px; font-weight:720; overflow-wrap:anywhere; }
    .status { padding:10px 12px; border-radius:6px; background:var(--soft); border:1px solid var(--line); color:var(--muted); margin-bottom:14px; }
    .status.ok { color:var(--ok); }
    .status.warn { color:var(--warn); }
    table { width:100%; border-collapse:collapse; margin:10px 0 24px; table-layout:fixed; }
    th, td { border-bottom:1px solid var(--line); padding:10px 8px; text-align:left; vertical-align:top; overflow-wrap:anywhere; font-size:13px; }
    th { color:var(--muted); font-weight:650; background:var(--soft); }
    h2 { font-size:16px; margin:20px 0 8px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body>
  <header>
    <h1>YNX Chain Explorer</h1>
    <p>RPC and indexer backed view for YNX Testnet data. Native currency: YNXT.</p>
  </header>
  <main>
    <div class="toolbar">
      <input id="searchInput" placeholder="Search block height, transaction hash, or address" autocomplete="off">
      <button id="searchButton">Search</button>
      <button id="metamaskButton" class="secondary">Add YNX Testnet to MetaMask</button>
    </div>
    <div id="status" class="status">Loading Explorer API...</div>
    <section class="grid" id="summary"></section>
    <h2>Latest Blocks</h2>
    <table><thead><tr><th>Height</th><th>Hash</th><th>Time</th><th>Txs</th></tr></thead><tbody id="blocks"></tbody></table>
    <h2>Latest Transactions</h2>
    <table><thead><tr><th>Hash</th><th>Type</th><th>From</th><th>To</th><th>Amount</th><th>Fee</th></tr></thead><tbody id="txs"></tbody></table>
    <h2>Search Result</h2>
    <pre id="result" class="status mono">No query yet.</pre>
  </main>
  <script>
    const api = '';
    let walletConfig = null;
    const fmt = (value) => value === undefined || value === null || value === '' ? 'unavailable' : String(value);
    const cell = (value) => '<td class="mono">' + fmt(value).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</td>';
    async function get(path) {
      const response = await fetch(api + path);
      if (!response.ok) throw new Error(path + ' returned ' + response.status);
      return response.json();
    }
    async function load() {
      const [summary, blockData, txData] = await Promise.all([
        get('/api/summary'),
        get('/api/blocks/latest?limit=8'),
        get('/api/txs?limit=10')
      ]);
      walletConfig = summary.wallet;
      status.textContent = summary.ok ? 'Explorer API connected: ' + summary.network.name + ' / indexed height ' + summary.indexedHeight : 'Explorer API has a degraded upstream';
      status.className = 'status ' + (summary.ok ? 'ok' : 'warn');
      const items = [
        ['RPC height', summary.rpcHeight],
        ['Indexed height', summary.indexedHeight],
        ['Sync lag', summary.syncLagBlocks],
        ['Transactions', summary.indexedTxCount],
        ['Validators', summary.validatorCount],
        ['Chain ID', summary.network.chainId],
        ['Native', summary.nativeSymbol],
        ['Truth', summary.truthfulStatus]
      ];
      document.getElementById('summary').innerHTML = items.map(([k,v]) => '<section class="card"><div class="label">' + k + '</div><div class="value mono">' + fmt(v) + '</div></section>').join('');
      document.getElementById('blocks').innerHTML = blockData.blocks.map(b => '<tr>' + cell(b.height) + cell(b.hash) + cell(b.time) + cell((b.transactions || []).length) + '</tr>').join('');
      document.getElementById('txs').innerHTML = txData.transactions.map(t => '<tr>' + cell(t.hash) + cell(t.type) + cell(t.from) + cell(t.to) + cell(t.amount || 0) + cell(t.fee || 0) + '</tr>').join('');
    }
    document.getElementById('searchButton').onclick = async () => {
      const q = document.getElementById('searchInput').value.trim();
      if (!q) return;
      try {
        const resolved = await get('/api/search?q=' + encodeURIComponent(q));
        const detail = await get(resolved.path);
        document.getElementById('result').textContent = JSON.stringify({resolved, detail}, null, 2);
      } catch (error) {
        document.getElementById('result').textContent = error.message;
      }
    };
    document.getElementById('metamaskButton').onclick = async () => {
      if (!window.ethereum) {
        document.getElementById('result').textContent = 'MetaMask/EIP-1193 wallet not detected.';
        return;
      }
      if (!walletConfig) await load();
      const params = [{
        chainId: walletConfig.chainIdHex,
        chainName: walletConfig.chainName,
        nativeCurrency: { name: walletConfig.nativeCurrencyName, symbol: walletConfig.nativeSymbol, decimals: walletConfig.decimals },
        rpcUrls: walletConfig.rpcUrls,
        blockExplorerUrls: walletConfig.blockExplorerUrls
      }];
      try {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params });
        document.getElementById('result').textContent = 'YNX Testnet add-network request sent to wallet.';
      } catch (error) {
        document.getElementById('result').textContent = error.message;
      }
    };
    load().catch(error => {
      status.textContent = 'Explorer API unavailable: ' + error.message;
      status.className = 'status warn';
    });
  </script>
</body>
</html>`
