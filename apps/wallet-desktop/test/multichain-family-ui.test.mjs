import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFamilyUI} from '../src/multichain-family-ui.mjs';
import {WALLET_LOCALES, walletCopy} from '../src/wallet-locale.mjs';
import {FAMILY_COPY} from '../src/wallet-locale-family.mjs';
function harness(request = async () => ({ok: true, value: {family: 'bitcoin', network: 'mainnet', vaultAccount: 'PUBLIC-base', address: 'PUBLIC-BTC-address', path: "m/84'/0'/0'/0/0"}})) {
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
  const ui = createFamilyUI({document, api: {familyAccount: request}, getContext: () => context});
  const [family, network, button, status, address, path] = registry.get('#family-content').children;
  return {ui, family, network, button, status, address, path, sheet: registry.get('#family-sheet'), open: () => registry.get('#open-family').handlers.click(), change: value => {context = {...context, ...value};}};
}
test('mounted entry consumes actual safeIPC value envelope, displays exact public address/path', async () => { const h = harness(); h.open(); await h.button.handlers.click(); assert.equal(h.address.value, 'PUBLIC-BTC-address'); assert.equal(h.path.textContent, "m/84'/0'/0'/0/0"); assert.equal(h.sheet.open, true); h.sheet.close(); assert.equal(h.address.value, ''); });
test('late address callback cannot refill a closed or invalidated sheet', async () => { let release; const h = harness(() => new Promise(resolve => {release = resolve;})); h.open(); const pending = h.button.handlers.click(); h.sheet.close(); release({ok: true, value: {family: 'bitcoin', network: 'mainnet', vaultAccount: 'PUBLIC-base', address: 'PUBLIC-stale', path: 'PUBLIC-path'}}); await pending; assert.equal(h.address.value, ''); });
test('lock blocks derivation and family/network change clears the public result', async () => { let calls = 0; const h = harness(async () => { calls++; return {ok: false, error: {code: 'MNEMONIC_NOT_AVAILABLE'}}; }); h.change({locked: true}); h.open(); await h.button.handlers.click(); assert.equal(calls, 0); h.change({locked: false}); h.ui.invalidate(); await h.button.handlers.click(); assert.equal(h.status.textContent, 'MNEMONIC_NOT_AVAILABLE'); h.family.value = 'tron'; h.family.handlers.change(); assert.equal(h.network.value, 'mainnet'); assert.equal(h.status.textContent, ''); });
test('all 12 locales contain explicit family safety copy; trusted-main route stays sensitive', async () => {
  for (const locale of WALLET_LOCALES) for (const key of ['Show receiving address', 'Checking account…', 'Receiving address', 'A receiving address does not verify the network or balance. Never send assets on another network.']) { assert.ok(Object.hasOwn(FAMILY_COPY[locale], key)); assert.equal(walletCopy(locale, key), FAMILY_COPY[locale][key]); }
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8'); const preload = await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /handleWalletIPC\('wallet:family-account', \(_event, input\) => sensitiveIPC/);
  assert.match(main, /createMnemonicFamilyAccounts\(\{/); assert.match(preload, /familyAccount: input => ipcRenderer\.invoke\('wallet:family-account', input\)/);
});
