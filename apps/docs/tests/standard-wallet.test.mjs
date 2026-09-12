import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsWalletController} from '../web/standard-wallet.js';

function provider() {
  const calls = [];
  let accounts = ['0x1111111111111111111111111111111111111111'];
  const handlers = new Map();
  return {calls, on(event, handler) { handlers.set(event, handler); }, removeListener(event) { handlers.delete(event); },
    async request({method}) {
      calls.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accounts;
      if (method === 'eth_chainId') return '0x1917';
      if (method === 'wallet_revokePermissions') { accounts = []; return null; }
      throw Error('Unexpected RPC');
    },
  };
}
function harness(discover) {
  const values = new Map();
  const rendered = [];
  const controller = createDocsWalletController({
    environment: {location: {origin: 'https://docs.ynxweb4.com'}, localStorage: {getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value)}},
    discover, render: (state) => rendered.push(state),
  });
  return {controller, values, rendered};
}

test('explicit MetaMask selection restores only its read-only state without YNX or private gateway', async () => {
  const metamask = provider();
  const ynx = provider();
  const h = harness(async () => ({metamask: {provider: metamask}, ynx: {provider: ynx}}));
  await h.controller.select('metamask');
  assert.deepEqual(metamask.calls, ['eth_accounts', 'eth_chainId']);
  assert.deepEqual(ynx.calls, []);
  assert.equal(h.rendered.at(-1).kind, 'metamask');
  assert.equal(h.rendered.at(-1).session.selectedChain, '0x1917');
});

test('missing saved provider is not silently replaced with a different wallet', async () => {
  const ynx = provider();
  const h = harness(async () => ({ynx: {provider: ynx}, metamask: null}));
  h.values.set('ynx.docs.standard-wallet-choice', 'metamask');
  await h.controller.restoreSaved();
  assert.equal(h.rendered.at(-1).session, null);
  assert.deepEqual(ynx.calls, []);
});

test('late discovery for old selection cannot replace the newly selected wallet', async () => {
  let resolve;
  let calls = 0;
  const old = provider();
  const current = provider();
  const h = harness(() => ++calls === 1 ? new Promise((done) => { resolve = done; }) : {ynx: {provider: current}});
  const pending = h.controller.select('metamask', true);
  await h.controller.select('ynx-wallet', true);
  resolve({metamask: {provider: old}});
  await pending;
  assert.equal(h.rendered.at(-1).kind, 'ynx-wallet');
  assert.deepEqual(old.calls, []);
  assert.deepEqual(current.calls, ['eth_requestAccounts', 'eth_chainId']);
});

test('revocation is confirmed only after provider acknowledgement and empty account readback', async () => {
  const wallet = provider();
  const h = harness(async () => ({metamask: {provider: wallet}}));
  await h.controller.select('metamask', true);
  const result = await h.controller.revoke();
  assert.equal(result.permissionRevoked, true);
  assert.deepEqual(wallet.calls.slice(-2), ['wallet_revokePermissions', 'eth_accounts']);
  assert.match(h.rendered.at(-1).message, /empty accounts confirmed/);
});
