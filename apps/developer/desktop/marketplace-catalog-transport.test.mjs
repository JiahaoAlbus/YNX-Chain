import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { fetchCatalog, isPublicCatalogAddress } from './marketplace-catalog-transport.mjs';
import { catalogLimits } from './marketplace-catalog-policy.mjs';

test('catalog excludes private, mapped, loopback and reserved destinations', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','192.168.1.1','169.254.1.1','100.64.1.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','invalid']) assert.equal(isPublicCatalogAddress(ip), false, ip);
  assert.equal(isPublicCatalogAddress('1.1.1.1'), true);
  assert.equal(isPublicCatalogAddress('2606:4700::1111'), true);
});

test('executor bounds actual streaming responses and never follows redirects', async t => {
  const original = https.request; let fixture, calls = 0;
  https.request = (url, options, receive) => {
    calls++; assert.equal(new URL(url).origin, 'https://open-vsx.org'); assert.equal(options.method, 'GET');
    assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true);
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    const req = new EventEmitter(); req.destroy = () => {}; req.end = () => queueMicrotask(() => {
      const stream = new PassThrough(); stream.statusCode = fixture.status || 200;
      stream.headers = { 'content-type': fixture.type || 'application/json', ...fixture.headers };
      receive(stream); if (!stream.destroyed) stream.end(fixture.bytes);
    }); return req;
  };
  t.after(() => { https.request = original; });
  const good = Buffer.from('{"extensions":[],"offset":0}');
  for (const bad of [
    { status: 302, headers: { location: 'https://example.org' }, bytes: good },
    { status: 500, bytes: good }, { type: 'text/html', bytes: good },
    { bytes: Buffer.from([255]) }, { bytes: Buffer.from('{"extensions":[null]}') },
    { bytes: Buffer.alloc(catalogLimits.maxBytes + 1) },
    { headers: { 'content-encoding': 'gzip' }, bytes: gzipSync(Buffer.alloc(catalogLimits.maxBytes + 1)) },
  ]) { fixture = bad; const before = calls; await assert.rejects(fetchCatalog('search', {})); assert.equal(calls, before + 1); }
  fixture = { headers: { 'content-encoding': 'gzip' }, bytes: gzipSync(good) };
  assert.deepEqual(await fetchCatalog('search', {}), { extensions: [], offset: 0 });
});

test('abort stops an active request; aborted calls do not open connections', async t => {
  const original = https.request; let destroyed = false, calls = 0;
  https.request = () => { calls++; const req = new EventEmitter(); req.end = () => {}; req.destroy = () => { destroyed = true; }; return req; };
  t.after(() => { https.request = original; });
  const controller = new AbortController(); const work = fetchCatalog('query', {}, controller.signal); controller.abort();
  await assert.rejects(work, /cancelled/); assert.equal(destroyed, true);
  await assert.rejects(fetchCatalog('query', {}, controller.signal)); assert.equal(calls, 1);
});

test('whole-request deadline destroys a stalled request', async t => {
  const original = https.request; let destroyed = false;
  https.request = () => { const req = new EventEmitter(); req.end = () => {}; req.destroy = () => { destroyed = true; }; return req; };
  t.after(() => { https.request = original; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = fetchCatalog('search', {}); const rejection = assert.rejects(work, /timed out/);
  t.mock.timers.tick(15000); await rejection; assert.equal(destroyed, true);
});
