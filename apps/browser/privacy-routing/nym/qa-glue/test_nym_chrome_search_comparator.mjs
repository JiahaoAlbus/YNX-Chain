import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as httpServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { createServer as tcpServer, connect } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { publicHost, makeRelay, runBrowserComparator } from './nym_chrome_search_comparator.mjs';

test('SOCKS domain boundary rejects literal and local addresses', () => {
  assert.equal(publicHost('DuckDuckGo.com'), 'duckduckgo.com');
  for (const host of ['127.0.0.1', '100.64.0.1', '::1', 'x.localhost', 'x.local', 'x.internal', 'x%00.com'])
    assert.equal(publicHost(host), null);
});

test('same Chrome tab renders JS results and clicks through the original SOCKS test relay', { timeout: 30_000 }, async t => {
  const fixtureHost = 'search.fixture.invalid';
  const requests = [];
  const web = httpServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/find') res.end(`<!doctype html><script>
      setTimeout(() => { const a = document.createElement('a'); a.setAttribute('data-testid','result-title-a');
      a.href='/article'; a.textContent='Fixture organic result'; document.body.append(a); }, 30);
    </script>`);
    else if (req.url === '/article') res.end('<!doctype html><title>Fixture article</title>');
    else res.writeHead(404).end();
  });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  t.after(() => web.close());
  const frames = [], sockets = new Set();
  const socks = tcpServer(client => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    let message = Buffer.alloc(0), phase = 0;
    client.on('error', () => client.destroy());
    const parse = data => {
      message = Buffer.concat([message, data]);
      if (phase === 0) {
        if (message.length < 3) return;
        assert.deepEqual(message.subarray(0, 3), Buffer.from([5, 1, 0]));
        message = message.subarray(3); phase = 1; client.write(Buffer.from([5, 0]));
      }
      if (message.length < 5 || message.length < message[4] + 7) return;
      assert.deepEqual(message.subarray(0, 4), Buffer.from([5, 1, 0, 3]));
      const length = message[4], host = message.subarray(5, 5+length).toString();
      const port = message.readUInt16BE(5+length);
      frames.push([host, port]);
      if (host !== fixtureHost || port !== 80) { client.destroy(); return; }
      client.off('data', parse);
      const target = connect({ host: '127.0.0.1', port: web.address().port });
      target.on('error', () => client.destroy());
      client.on('close', () => target.destroy());
      target.on('close', () => client.destroy());
      target.once('connect', () => {
        // Reproduce a live path whose SOCKS acknowledgment outlasts CDP's
        // four-second budget for control commands.
        setTimeout(() => {
          if (client.destroyed || target.destroyed) return;
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          target.write(message.subarray(7+length)); message = Buffer.alloc(0);
          client.pipe(target); target.pipe(client);
        }, 4500);
      });
    };
    client.on('data', parse);
  });
  socks.listen(0, '127.0.0.1');
  await once(socks, 'listening');
  t.after(() => { for (const client of sockets) client.destroy(); socks.close(); });

  const root = process.env.NYM_CHROME_TEST_ROOT;
  assert.ok(root?.startsWith('/Volumes/'), 'private external fixture root required');
  const profile = await mkdtemp(join(root, 'chrome-fixture-'));
  const result = await runBrowserComparator({ profile, url: `http://${fixtureHost}/find`,
    upstream: socks.address().port, absoluteMs: Date.now()+23_000, fixture: true });
  assert.equal(result.firstFailure, null, JSON.stringify({ result, frames, requests }));
  assert.equal(result.searchDocument?.status, 200);
  assert.equal(result.targetProxyHandshake, true);
  assert.equal(result.visibleOrganicLinks, 1);
  assert.equal(result.click?.complete, true);
  assert.equal(result.click.proxyHandshake, true);
  assert.deepEqual(frames.map(([host]) => host), frames.map(() => fixtureHost));
  assert.equal(requests.filter(path => path === '/find').length, 1);
  assert.equal(requests.filter(path => path === '/article').length, 1);
  assert.ok(result.browserExit);
});

test('owned SOCKS relay closes forbidden domain without dialing upstream', async () => {
  const upstream = tcpServer(() => assert.fail('forbidden target reached proxy'));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const relay = await makeRelay(upstream.address().port, () => false);
  try {
    const socket = connect(relay.port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write(Buffer.from([5,1,0]));
    await once(socket, 'data');
    const domain=Buffer.from('forbidden.fixture.invalid');
    socket.write(Buffer.concat([Buffer.from([5,1,0,3,domain.length]),domain,Buffer.from([1,187])]));
    await once(socket, 'close');
    assert.equal(relay.seen.size,0);
  } finally {
    await relay.close();
    upstream.close();
  }
});
