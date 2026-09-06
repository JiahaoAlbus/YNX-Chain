import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createVideoProductSession, VIDEO_ORIGIN, VIDEO_SCOPES, videoScope} from './product-session.js';
import {createVideoAPI} from './video-api.js';
import {createWatchProgress} from './watch-progress.js';

const registry = JSON.parse(await readFile(new URL('./product-session-registry.json', import.meta.url)));
const ok = body => ({ok: true, status: 200, json: async () => body});

test('Video uses the frozen browser SDK with exact Video registration and honest browser storage', async () => {
  const source = JSON.parse(await readFile(new URL('./product-session-sdk-source.json', import.meta.url)));
  assert.equal(source.sdkSourceCommit, 'b3e4b5269d665ee5c8e2542454191cfc6ff53ecb');
  assert.equal(source.securityLevel, 'webcrypto-nonextractable');
  assert.equal(source.osProtected, false);
  assert.equal(source.hardwareBacked, false);
  for (const item of source.files) {
    const bytes = await readFile(new URL(item.path, import.meta.url));
    assert.equal(bytes.length, item.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
  }
  assert.equal(registry.products.length, 1);
  const product = registry.products[0];
  assert.equal(product.productId, 'video');
  assert.equal(product.clientId, 'ynx-video-mobile-v1');
  assert.equal(product.applicationId, 'com.ynxweb4.video');
  assert.equal(product.webOrigin, VIDEO_ORIGIN);
  assert.deepEqual(product.scopes, VIDEO_SCOPES);
});

test('product preparation protects pending request before explicit link and never asserts installation', async () => {
  const calls = [];
  const pending = {nonce: 'pending', expiresAt: '2026-09-06T23:59:00.000Z'};
  let config;
  const product = createVideoProductSession({environment: {location: {origin: VIDEO_ORIGIN}, navigator: {onLine: true}, fetch: async () => ok(registry)},
    GatewayAdapter: class {constructor(input) {config = input;}},
    createBrowserClient: async input => {
      assert.equal(input.productId, 'video'); assert.deepEqual(input.scopes, VIDEO_SCOPES);
      return {client: {begin: async environment => {calls.push(['persist-pending', environment]); return {request: pending};}}};
    },
    encodeWalletURL: (actualRegistry, request) => {calls.push(['encode-link', request]); assert.equal(actualRegistry, registry); return 'ynxwallet://authorize?request=fixture';},
  });
  const prepared = await product.prepare();
  assert.equal(await config.walletInstalled(), false);
  assert.equal(await config.schemeRegistered(), false);
  assert.equal(config.endpoint, 'https://wallet-auth.ynxweb4.com');
  assert.deepEqual(calls, [['persist-pending', {walletInstalled: false, schemeRegistered: false}], ['encode-link', pending]]);
  assert.equal(prepared.url, 'ynxwallet://authorize?request=fixture');
});

test('wrong web origin stops before registry, SDK initialization and Gateway requests', async () => {
  let calls = 0;
  const product = createVideoProductSession({environment: {location: {origin: 'https://creator.ynxweb4.com'}, fetch: async () => {calls++; throw Error('unexpected');}}});
  await assert.rejects(product.prepare(), /video\.ynxweb4\.com/);
  await assert.rejects(product.authorization('/v1/history'), /video\.ynxweb4\.com/);
  assert.equal(calls, 0);
});

test('callback, restore and disconnect use SDK authority while private scopes remain route specific', async () => {
  const calls = [];
  const product = createVideoProductSession({environment: {location: {origin: VIDEO_ORIGIN}, navigator: {onLine: false}, fetch: async () => ok(registry)},
    GatewayAdapter: class {}, createBrowserClient: async () => ({client: {
      restore: async online => {calls.push(['restore', online]); return {status: 'network-unavailable'};},
      handleReturn: async url => {calls.push(['callback', url]); return {status: 'retry-required'};},
      disconnect: async () => {calls.push(['revoke-through-sdk']); return {status: 'disconnected'};},
    }, createIntrospectionProof: async scopes => {calls.push(['proof', scopes]); return {proofHeader: 'device-proof'};}}),
  });
  await product.restore();
  await product.finishReturn(`${VIDEO_ORIGIN}/wallet-auth/callback?result=rejected`);
  await product.authorization('/v1/videos/vid_one/comments', 'POST');
  await product.authorization('/v1/playlists/list_one/videos/vid_one', 'DELETE');
  await product.disconnect();
  assert.deepEqual(calls, [['restore', false], ['callback', `${VIDEO_ORIGIN}/wallet-auth/callback?result=rejected`],
    ['proof', ['video:account']], ['proof', ['video:library']], ['revoke-through-sdk']]);
});

test('Video scope allowlist rejects Creator reads, moderation and unknown mutation paths', () => {
  for (const [method, path] of [['GET', '/v1/studio'], ['GET', '/v1/channels/chn_one/team'], ['GET', '/v1/studio/history'],
    ['POST', '/v1/uploads'], ['POST', '/v1/videos/vid_one/publish'], ['POST', '/v1/videos/vid_one/review-publication'],
    ['POST', '/v1/reports/report_one/moderate'], ['DELETE', '/v1/videos/vid_one'], ['POST', '/v1/wallet/revoke']]) {
    assert.throws(() => videoScope(path, method), /not available/);
  }
  assert.equal(videoScope('/v1/videos/vid_one/comments'), 'video:playback');
  assert.equal(videoScope('/v1/videos/vid_one/reports', 'POST'), 'video:account');
  assert.equal(videoScope('/v1/privacy/account-data', 'DELETE'), 'video:account');
  assert.equal(videoScope('/v1/channels/chn_one/subscription', 'DELETE'), 'video:library');
  assert.equal(videoScope('/v1/playlists/list_one', 'DELETE'), 'video:library');
});

test('public API starts without awaiting or attaching a Product Session', async () => {
  let authorizations = 0;
  const api = createVideoAPI({baseURL: `${VIDEO_ORIGIN}/video/api`, authorize: () => {authorizations++; return new Promise(() => {});},
    fetch: async (url, options) => {assert.equal(url, `${VIDEO_ORIGIN}/video/api/v1/videos`); assert.deepEqual(options.headers, {}); return ok([{id: 'published'}]);}});
  assert.deepEqual(await api('/v1/videos', {headers: {'X-YNX-App-Session': 'old', Authorization: 'old'}}), [{id: 'published'}]);
  assert.equal(authorizations, 0);
});

test('network retry generates fresh device proof with stable idempotency key and immutable body', async () => {
  let authorizations = 0;
  const requests = [];
  const api = createVideoAPI({baseURL: `${VIDEO_ORIGIN}/video/api`, requestId: () => 'mutation-one',
    authorize: async (path, method) => {assert.equal(path, '/v1/playlists'); assert.equal(method, 'POST');return {'X-YNX-Product-Session-Proof-V2': `proof-${++authorizations}`};},
    fetch: async (_url, options) => {requests.push(options);if(requests.length === 1) throw Error('network interrupted');return ok({ID:'list_one'});}});
  await api('/v1/playlists', {private: true, method: 'POST', body: '{"name":"Saved"}'});
  assert.equal(authorizations, 2);
  assert.equal(requests[0].headers['X-YNX-Product-Session-Proof-V2'], 'proof-1');
  assert.equal(requests[1].headers['X-YNX-Product-Session-Proof-V2'], 'proof-2');
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[1].credentials, 'omit');
});

test('private credentials never go to an overridden origin and rejected authority clears private UI', async () => {
  let calls = 0;
  const wrong = createVideoAPI({baseURL: 'https://example.com/video/api', authorize: async () => {calls++;}, fetch: async () => {calls++;}});
  await assert.rejects(wrong('/v1/history', {private: true}), /require video/);
  assert.equal(calls, 0);
  const denied = createVideoAPI({baseURL: `${VIDEO_ORIGIN}/video/api`, authorize: async () => ({}),
    fetch: async () => ({status: 401, ok: false, json: async () => ({error: 'sign in again'})}), onUnauthorized: () => calls++});
  await assert.rejects(denied('/v1/history', {private: true}), /sign in again/);
  assert.equal(calls, 1);
});

test('watch progress excludes guest playback and seeking; failed persistence retains real elapsed time', async () => {
  let now = 0, signedIn = false, attempt = 0;
  const writes = [];
  const watch = createWatchProgress({clock: () => now, signedIn: () => signedIn, send: async body => {writes.push(body);if(++attempt === 1)throw Error('offline');}});
  const sample = position => watch.sample({position, paused: false, seeking: false});
  sample(0);now=1000;sample(1);await watch.flush();assert.equal(writes.length,0);
  signedIn=true;sample(1);now=2000;sample(2);now=3000;sample(99); // Seeking jump excluded.
  await assert.rejects(watch.flush(), /offline/);
  await watch.flush();
  assert.deepEqual(writes,[{seconds:1,completed:false},{seconds:1,completed:false}]);
  await watch.flush();assert.equal(writes.length,2);
  watch.discard();now=4000;sample(100);now=5000;sample(101);await watch.flush();assert.equal(writes.length,2);
});
