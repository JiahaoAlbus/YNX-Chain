const base = process.env.YNX_EXPLORER_URL || 'http://127.0.0.1:6427';
const required = ['/health','/api/summary','/api/blocks/latest','/api/txs','/api/validators','/api/stream'];
const evidence = new Map();
for (const path of required) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), path === '/api/stream' ? 4000 : 2500);
  const response = await fetch(base + path, { signal:controller.signal }); clearTimeout(timeout);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  if (path === '/api/stream' && !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('stream is not SSE');
  if (path !== '/api/stream') evidence.set(path, await response.json()); else await response.body.cancel();
}
const summary = evidence.get('/api/summary');
const blocks = evidence.get('/api/blocks/latest');
const transactions = evidence.get('/api/txs');
if (summary?.truthfulStatus !== 'rpc-and-indexer-backed' || summary?.nativeSymbol !== 'YNXT') throw new Error('explorer summary is not canonical RPC/Indexer-backed YNXT evidence');
if (!Array.isArray(blocks?.blocks) || blocks.blocks.length === 0) throw new Error('explorer returned no real indexed blocks');
if (!Array.isArray(transactions?.transactions) || transactions.transactions.length === 0) throw new Error('explorer returned no real indexed transactions');
console.log(`explorer real-service smoke passed: ${base} blocks=${blocks.blocks.length} transactions=${transactions.transactions.length}`);
