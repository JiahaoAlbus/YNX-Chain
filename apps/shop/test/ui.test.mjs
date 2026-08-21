import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('buyer UI wires full order lifecycle', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  for (const text of ['Sign in with YNX Wallet', 'Category', 'Max price', 'Order review', 'Trust evidence', 'Your orders', 'Tax service: unavailable', 'Your Shop data', 'DELETE_MY_SHOP_DATA', 'Public-chain settlement addresses']) assert.ok(html.includes(text), text);
  for (const path of ['/cart', '/orders', 'pay-handoff', 'confirm-payment', '/transition', '/stores/', '/profile', '/privacy/export', '/privacy/delete', '/ai/jobs']) assert.ok(js.includes(path), path);
  for (const control of ['exportData', 'deleteData', 'deleteConfirmation', 'privacyState']) assert.ok(html.includes(`id="${control}"`), control);
  assert.ok(js.includes("confirmation!=='DELETE_MY_SHOP_DATA'"));
  assert.ok(js.includes("${tr('label')} ${caps.privacyData}"));
  for (const state of ['cancelled', 'delivered', 'return_requested', 'refund_requested', 'disputed', 'reviewed']) assert.ok(js.includes(state), state);
  for (const workflow of ['search_comparison', 'support_draft', 'return_explanation']) assert.ok(js.includes(workflow), workflow);
  for (const walletControl of ['walletDialog', 'connectYNXWallet', 'connectMetaMask', 'downloadYNXWallet', 'downloadMetaMask']) assert.ok(html.includes(`id="${walletControl}"`), walletControl);
  assert.ok(js.includes("startWalletAuth('buyer',{wallet})"));
  assert.ok(!js.includes("location.assign('ynxwallet://authorize"));
});

test('web wallet uses standard providers and YNX chain 6423 without custom-scheme navigation', async () => {
  const auth = await readFile(new URL('../wallet-auth.js', import.meta.url), 'utf8');
  const discovery = await readFile(new URL('../wallet-provider-discovery.js', import.meta.url), 'utf8');
  for (const method of ['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']) assert.ok(auth.includes(method), method);
  assert.ok(auth.includes("chainId: '0x1917'"));
  assert.ok(auth.includes("'https://evm.ynxweb4.com'"));
  assert.ok(discovery.includes('eip6963:requestProvider'));
  assert.ok(discovery.includes('eip6963:announceProvider'));
  assert.equal((auth.match(/ynxwallet:\/\/authorize/g)||[]).length, 0, 'the Web bundle must contain no custom-scheme navigation');
});
