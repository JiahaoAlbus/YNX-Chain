import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFamilyUI} from '../src/multichain-family-ui.mjs';
import {WALLET_LOCALES, walletCopy} from '../src/wallet-locale.mjs';
import {FAMILY_COPY} from '../src/wallet-locale-family.mjs';
function harness(request = async () => ({ok: true, value: {family: 'bitcoin', network: 'mainnet', vaultAccount: 'PUBLIC-base', address: 'PUBLIC-BTC-address', path: "m/84'/0'/0'/0/0"}}), extraAPI = {}) {
  const registry = new Map();
  class Node {
    constructor(tag) { this.tagName = tag; this.textContent = ''; this.value = ''; this.children = []; this.handlers = {}; this.ownerDocument = {}; this.open = false; }
    setAttribute() {}
    append(...nodes) { for (const n of nodes) { this.children.push(n); if (n.id) registry.set('#' + n.id, n); if (this.tagName === 'select' && !this.value) this.value = n.value; } }
    replaceChildren(...nodes) { this.children = []; this.value = ''; this.append(...nodes); }
    addEventListener(event, action) { this.handlers[event] = action; }
    showModal() { this.open = true; }
    close() { this.open = false; this.handlers.close?.(); }
  }
  for (const key of ['#family-sheet', '#family-content', '#family-close', '.toolbar']) registry.set(key, new Node('div'));
  const document = {querySelector: key => registry.get(key), createElement: tag => new Node(tag)};
  let context = {account: 'PUBLIC-base', revision: 1, locked: false};
  const ui = createFamilyUI({document, api: {familyAccount: request, ...extraAPI}, getContext: () => context});
  const [family, network, button, status, address, path] = registry.get('#family-content').children;
  const content = registry.get('#family-content').children;
  const settings = content[7], refresh = content[8], balance = content[9];
  const tokenSection = content[10];
  return {ui, family, network, button, status, address, path, settings, rpc: settings.children[2], genesis: settings.children[4], save: settings.children[5], refresh, balance, tokenSection, tokenContract: tokenSection.children[2], importToken: tokenSection.children[3], sheet: registry.get('#family-sheet'), open: () => registry.get('#open-family').handlers.click(), change: value => {context = {...context, ...value};}};
}
test('TRC20 form submits contract only on selected unlocked TRON network', async () => {
  let submitted, calls = 0;
  const h = harness(undefined, {familyToken: async input => {calls++; submitted = input; return {ok: true, value: {family: 'tron', network: 'nile', name: 'Public Fixture', symbol: 'PUBLIC', decimals: 6}};}});
  h.open(); h.tokenContract.value = 'PUBLIC-contract'; await h.importToken.handlers.click(); assert.equal(calls, 0);
  h.family.value = 'tron'; h.family.handlers.change(); h.network.value = 'nile'; h.network.handlers.change();
  h.change({locked: true}); h.ui.invalidate(); await h.importToken.handlers.click(); assert.equal(calls, 0);
  h.change({locked: false}); h.ui.invalidate(); await h.importToken.handlers.click();
  assert.deepEqual(submitted, {family: 'tron', network: 'nile', contract: 'PUBLIC-contract'}); assert.equal(h.status.textContent, 'Public Fixture (PUBLIC) · 6'); assert.equal(h.tokenContract.value, '');
});
test('delayed token import cannot refill closed dialog or switched network', async () => {
  let release;
  const h = harness(undefined, {familyToken: () => new Promise(resolve => {release = resolve;})});
  h.open(); h.family.value = 'tron'; h.family.handlers.change(); const pending = h.importToken.handlers.click(); h.sheet.close();
  release({ok: true, value: {family: 'tron', network: 'mainnet', name: 'Public Fixture', symbol: 'PUBLIC', decimals: 6}});
  await pending; assert.equal(h.status.textContent, ''); assert.equal(h.balance.textContent, '');
});
test('network settings submit selected family and balance preserves exact display', async () => {
  let submitted;
  const h = harness(undefined, {
    familyNetwork: async value => { submitted = value; return {ok: true, value: {revision: 1}}; },
    familyBalances: async () => ({ok: true, value: {vaultAccount: 'PUBLIC-base', family: 'bitcoin', network: 'mainnet', account: 'PUBLIC-BTC-address', assets: [{display: '0.00000001', symbol: 'BTC', verification: 'provider-reported-not-spv'}]}})
  });
  h.open(); h.rpc.value = 'https://public.example/api'; await h.save.handlers.click();
  assert.deepEqual(submitted, {family: 'bitcoin', network: 'mainnet', rpcUrl: 'https://public.example/api', genesis: null});
  await h.refresh.handlers.click(); assert.equal(h.balance.textContent, '0.00000001 BTC'); assert.equal(h.address.value, 'PUBLIC-BTC-address');
});
test('balance error is not a zero and closing rejects delayed balance', async () => {
  let release;
  const h = harness(undefined, {familyBalances: async () => ({ok: false, error: {code: 'FAMILY_NETWORK_REQUIRED'}})});
  h.open(); await h.refresh.handlers.click(); assert.equal(h.status.textContent, 'FAMILY_NETWORK_REQUIRED'); assert.equal(h.balance.textContent, '');
  const delayed = harness(undefined, {familyBalances: () => new Promise(resolve => {release = resolve;})});
  delayed.open(); const pending = delayed.refresh.handlers.click(); delayed.sheet.close();
  release({ok: true, value: {vaultAccount: 'PUBLIC-base', family: 'bitcoin', network: 'mainnet', account: 'PUBLIC-stale', assets: [{display: '99', symbol: 'BTC', verification: 'provider-reported-not-spv'}]}});
  await pending; assert.equal(delayed.balance.textContent, ''); assert.equal(delayed.address.value, '');
});
test('editing endpoint invalidates delayed saved settings readback', async () => {
  const releases = [];
  const h = harness(undefined, {familyNetworks: () => new Promise(resolve => releases.push(resolve))});
  h.open(); h.rpc.value = 'https://edited.example/api'; h.rpc.handlers.input();
  for (const release of releases) release({ok: true, value: {networks: [{family: 'bitcoin', network: 'mainnet', rpcUrl: 'https://stale.example/api', genesis: null}]}});
  await Promise.resolve(); assert.equal(h.rpc.value, 'https://edited.example/api');
});
test('mounted entry consumes actual safeIPC value envelope, displays exact public address/path', async () => { const h = harness(); h.open(); await h.button.handlers.click(); assert.equal(h.address.value, 'PUBLIC-BTC-address'); assert.equal(h.path.textContent, "m/84'/0'/0'/0/0"); assert.equal(h.sheet.open, true); h.sheet.close(); assert.equal(h.address.value, ''); });
test('late address callback cannot refill a closed or invalidated sheet', async () => { let release; const h = harness(() => new Promise(resolve => {release = resolve;})); h.open(); const pending = h.button.handlers.click(); h.sheet.close(); release({ok: true, value: {family: 'bitcoin', network: 'mainnet', vaultAccount: 'PUBLIC-base', address: 'PUBLIC-stale', path: 'PUBLIC-path'}}); await pending; assert.equal(h.address.value, ''); });
test('lock blocks derivation and family/network change clears the public result', async () => { let calls = 0; const h = harness(async () => { calls++; return {ok: false, error: {code: 'MNEMONIC_NOT_AVAILABLE'}}; }); h.change({locked: true}); h.open(); await h.button.handlers.click(); assert.equal(calls, 0); h.change({locked: false}); h.ui.invalidate(); await h.button.handlers.click(); assert.equal(h.status.textContent, 'MNEMONIC_NOT_AVAILABLE'); h.family.value = 'tron'; h.family.handlers.change(); assert.equal(h.network.value, 'mainnet'); assert.equal(h.status.textContent, ''); });
test('all 12 locales contain explicit family safety copy; trusted-main route stays sensitive', async () => {
  for (const locale of WALLET_LOCALES) for (const key of ['Show receiving address', 'Checking account…', 'Receiving address', 'A receiving address does not verify the network or balance. Never send assets on another network.', 'Import TRC20 token']) { assert.ok(Object.hasOwn(FAMILY_COPY[locale], key)); assert.equal(walletCopy(locale, key), FAMILY_COPY[locale][key]); }
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8'); const preload = await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /handleWalletIPC\('wallet:family-account', \(_event, input\) => sensitiveIPC/);
  assert.match(main, /createMnemonicFamilyAccounts\(\{/); assert.match(preload, /familyAccount: input => ipcRenderer\.invoke\('wallet:family-account', input\)/);
});
