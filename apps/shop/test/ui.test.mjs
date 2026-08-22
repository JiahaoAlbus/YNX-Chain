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
  for (const walletControl of ['walletDialog', 'connectYNXWallet', 'connectMetaMask', 'walletDetails', 'disconnectWallet', 'switchWalletAccount']) assert.ok(html.includes(`id="${walletControl}"`), walletControl);
  for (const behavior of ['restoreStandardConnection()', 'disconnectStandardConnection()', 'switchStandardAccount()', "$('#wallet').onclick=openWalletDialog", "$('#walletDialog').close()", "$('#wallet').focus()"] ) assert.ok(js.includes(behavior), behavior);
  assert.ok(!html.includes('target="_blank"'), 'wallet links must not create new top-level tabs');
  assert.ok(!js.includes("location.assign('ynxwallet://authorize"), 'web must not navigate to a custom wallet scheme');
});

test('connected account opens details instead of restarting account approval', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(js.includes('function openWalletDialog(){renderWallet(standardConnection())'));
  assert.ok(js.includes("$('#walletDetails').hidden=!connection"));
  assert.ok(js.includes("$('#walletChoices').hidden=Boolean(connection)"));
  assert.ok(html.includes('Private Product Session failure never removes the Standard Wallet connection.'));
});
