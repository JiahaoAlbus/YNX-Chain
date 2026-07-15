const base = process.env.YNX_EXPLORER_URL || 'http://127.0.0.1:6427';
const required = ['/health','/api/summary','/api/blocks/latest','/api/txs','/api/validators','/api/stream'];
for (const path of required) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), path === '/api/stream' ? 4000 : 2500);
  const response = await fetch(base + path, { signal:controller.signal }); clearTimeout(timeout);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  if (path === '/api/stream' && !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('stream is not SSE');
  if (path !== '/api/stream') await response.json(); else await response.body.cancel();
}
console.log(`explorer real-service smoke passed: ${base}`);
