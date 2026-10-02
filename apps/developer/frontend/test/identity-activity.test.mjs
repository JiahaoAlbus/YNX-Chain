import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityActivity } from '../src/codeoss/identityActivity.ts';
test('trusted explicit host actions alone submit activity; passive saves and synthetic events do not', async () => {
  let calls = [], time = 0;
  const activity = createIdentityActivity(async (url, input) => { calls.push({ url, input }); return { ok: true, json: async () => ({ connected: true, csrf: 'csrf' }) }; }, () => time, () => 'e'.repeat(43));
  assert.equal(await activity.attest({ isTrusted: false }, 'save'), false); assert.equal(calls.length, 0);
  assert.equal(await activity.savedTrustedEdit(), false); assert.equal(calls.length, 0);
  assert.equal(await activity.attest({ isTrusted: true }, 'open-project'), true); assert.equal(calls.length, 2);
  assert.equal(await activity.attest({ isTrusted: true }, 'save'), true); assert.equal(calls.length, 2);
  time += 60001; assert.equal(await activity.attest({ isTrusted: true }, 'review-tool'), true); assert.equal(calls.length, 4);
});
test('logout while identity fetch is pending prevents late activity submission', async () => {
  let release, calls = [];
  const held = new Promise(resolve => release = resolve);
  const activity = createIdentityActivity(async url => { calls.push(url); await held; return { ok: true, json: async () => ({ connected: true, csrf: 'old' }) }; });
  const late = activity.attest({ isTrusted: true }, 'save'); activity.reset(); release();
  assert.equal(await late, false); assert.deepEqual(calls, ['/runtime/identity']);
});
