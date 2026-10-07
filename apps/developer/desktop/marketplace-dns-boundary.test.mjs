import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import https from 'node:https';
import tls from 'node:tls';
import { Socket } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fetchCatalog } from './marketplace-catalog-transport.mjs';

function fakeLookupRequest(t, resolveDns, { all = true, host = 'open-vsx.org' } = {}) {
  const originalLookup = dns.lookup, originalRequest = https.request;
  const observed = { resolutions: 0, connections: [], destroyed: 0 };
  dns.lookup = (name, options, callback) => {
    observed.resolutions++;
    assert.equal(name, 'open-vsx.org'); assert.deepEqual(options, { all: true, verbatim: true });
    resolveDns(callback);
  };
  syncBuiltinESMExports();
  https.request = (_url, options, receive) => {
    const req = new EventEmitter(); req.destroy = () => { observed.destroyed++; };
    req.end = () => options.lookup(host, { all }, (error, address, family) => {
      if (error) { req.emit('error', error); return; }
      observed.connections.push({ address, family });
      const response = new PassThrough(); response.statusCode = 200; response.headers = { 'content-type': 'application/json' };
      receive(response); response.end('{"extensions":[]}');
    });
    return req;
  };
  t.after(() => { dns.lookup = originalLookup; https.request = originalRequest; syncBuiltinESMExports(); });
  return observed;
}

test('actual executor lookup rejects mixed public/private DNS answers before connecting', async t => {
  let answer;
  const observed = fakeLookupRequest(t, callback => callback(null, answer));
  for (const privateAddress of ['127.0.0.1', '10.0.0.8', '::1', '::ffff:192.168.1.2']) {
    answer = [{ address: '1.1.1.1', family: 4 }, { address: privateAddress, family: privateAddress.includes(':') ? 6 : 4 }];
    await assert.rejects(fetchCatalog('search', {}), /address rejected/);
  }
  assert.equal(observed.resolutions, 4); assert.deepEqual(observed.connections, []);
});

test('actual executor forwards only the validated DNS batch without a second resolution', async t => {
  const answer = [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700::1111', family: 6 }];
  const observed = fakeLookupRequest(t, callback => callback(null, answer));
  assert.deepEqual(await fetchCatalog('query', {}), { extensions: [] });
  assert.equal(observed.resolutions, 1); assert.equal(observed.connections[0].address, answer);
});

test('cancelled request rejects late DNS results without connecting', async t => {
  let complete;
  const observed = fakeLookupRequest(t, callback => { complete = callback; });
  const controller = new AbortController();
  const work = fetchCatalog('search', {}, controller.signal); const rejected = assert.rejects(work, /cancelled/);
  controller.abort(); await rejected;
  complete(null, [{ address: '1.1.1.1', family: 4 }]);
  assert.equal(observed.destroyed, 1); assert.deepEqual(observed.connections, []);
});

test('unexpected lookup hostname is rejected without DNS resolution', async t => {
  const observed = fakeLookupRequest(t, () => assert.fail('must not resolve'), { host: 'proxy.example.invalid' });
  await assert.rejects(fetchCatalog('search', {}), /host rejected/);
  assert.equal(observed.resolutions, 0); assert.deepEqual(observed.connections, []);
});

test('real HTTPS agent retains registry TLS authority and bypasses ambient proxy agent', async t => {
  const originalConnect = tls.connect;
  const originalAddRequest = https.globalAgent.addRequest;
  const envKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_USE_ENV_PROXY'];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) process.env[key] = key === 'NODE_USE_ENV_PROXY' ? '1' : 'http://user:secret@proxy.example.invalid:3128';
  let captured, socket;
  https.globalAgent.addRequest = () => assert.fail('ambient agent must not be used');
  tls.connect = options => { captured = options; socket = new Socket(); return socket; };
  syncBuiltinESMExports();
  t.after(() => {
    tls.connect = originalConnect; https.globalAgent.addRequest = originalAddRequest; syncBuiltinESMExports(); socket?.destroy();
    for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  });
  const controller = new AbortController(); const work = fetchCatalog('search', {}, controller.signal);
  controller.abort(); await assert.rejects(work);
  assert.equal(captured.host, 'open-vsx.org'); assert.equal(captured.servername, 'open-vsx.org');
  assert.equal(Number(captured.port), 443); assert.equal(captured.rejectUnauthorized, true);
  assert.equal(captured.proxyEnv, undefined); assert.equal(captured.ca, undefined);
  assert.deepEqual(captured.headers, { Accept: 'application/json' });
});
