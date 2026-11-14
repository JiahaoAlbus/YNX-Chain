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

async function searchFixture(t, { path, slowGreeting = false }) {
  const fixtureHost = 'search.fixture.invalid';
  const organicHost = 'links.fixture.invalid';
  const requests = [];
  const web = httpServer((req, res) => {
    requests.push({ host: req.headers.host, path: req.url });
    if (req.url === '/find' || req.url === '/accepted') {
      res.writeHead(req.url === '/find' ? 200 : 202, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><script src="http://${organicHost}/organic.js"></script>`);
    } else if (req.url === '/organic.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(`
      setTimeout(() => { const a = document.createElement('a'); a.setAttribute('data-testid','result-title-a');
      a.href='/article'; a.textContent='Fixture organic result'; document.body.append(a); }, 30);
      `);
    }
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
      if (![fixtureHost, organicHost].includes(host) || port !== 80) { client.destroy(); return; }
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
        }, slowGreeting && host === fixtureHost ? 4500 : 0);
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
  const result = await runBrowserComparator({ profile, url: `http://${fixtureHost}${path}`,
    upstream: socks.address().port, absoluteMs: Date.now()+23_000, fixture: true, fixtureOrganicHost: organicHost });
  assert.equal(result.firstFailure, null, JSON.stringify({ result, frames, requests }));
  assert.deepEqual(result.browserExit, { code: 0, signal: null });
  return { result, frames, requests, fixtureHost, organicHost };
}

test('Chrome loads an organic script on the other origin and clicks through the same SOCKS relay', { timeout: 30_000 }, async t => {
  const { result, frames, requests, fixtureHost, organicHost } = await searchFixture(t, { path: '/find', slowGreeting: true });
  assert.equal(result.searchDocument?.status, 200);
  assert.equal(result.searchOutcome, 'RENDERED_ORGANIC_RESULTS');
  assert.deepEqual(result.organicService, { requestsAllowed: 1, responsesObserved: 1 });
  assert.equal(result.targetProxyHandshake, true);
  assert.equal(result.visibleOrganicLinks, 1);
  assert.equal(result.click?.complete, true);
  assert.equal(result.click.proxyHandshake, true);
  assert.deepEqual(new Set(frames.map(([host]) => host)), new Set([fixtureHost, organicHost]));
  assert.equal(requests.filter(({ host, path }) => host === fixtureHost && path === '/find').length, 1);
  assert.equal(requests.filter(({ host, path }) => host === organicHost && path === '/organic.js').length, 1);
  assert.equal(requests.filter(({ host, path }) => host === fixtureHost && path === '/article').length, 1);
});

test('Chrome stops on an HTTP 202 document without loading its organic script or clicking', { timeout: 30_000 }, async t => {
  const { result, frames, requests, fixtureHost } = await searchFixture(t, { path: '/accepted' });
  assert.equal(result.searchDocument?.status, 202);
  assert.equal(result.searchOutcome, 'SITE_ACCEPTED_WITHOUT_RESULTS');
  assert.equal(result.challenge, false);
  assert.ok(['NOT_SAMPLED', 'NOT_OBSERVED_IN_SAMPLE'].includes(result.challengeObservation));
  assert.deepEqual(result.organicService, { requestsAllowed: 0, responsesObserved: 0 });
  assert.equal(result.visibleOrganicLinks, 0);
  assert.equal(result.click, null);
  assert.deepEqual(new Set(frames.map(([host]) => host)), new Set([fixtureHost]));
  assert.deepEqual(requests, [{ host: fixtureHost, path: '/accepted' }]);
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
