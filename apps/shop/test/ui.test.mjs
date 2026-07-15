import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('buyer UI wires full order lifecycle', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  for (const text of ['Sign in with YNX Wallet', 'Category', 'Max price', 'Order review', 'Trust evidence', 'Your orders', 'Tax service: unavailable']) assert.ok(html.includes(text), text);
  for (const path of ['/cart', '/orders', 'pay-handoff', 'confirm-payment', '/transition', '/stores/', '/profile', '/ai/jobs']) assert.ok(js.includes(path), path);
  for (const state of ['cancelled', 'delivered', 'return_requested', 'refund_requested', 'disputed', 'reviewed']) assert.ok(js.includes(state), state);
  for (const workflow of ['search_comparison', 'support_draft', 'return_explanation']) assert.ok(js.includes(workflow), workflow);
});
