import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBlockPage, loadTransactionPage } from './api';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json' } });
}

test('cursor page clients send only the server-issued cursor and requested limit', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async input => {
    requested.push(String(input));
    return response({ blocks:[], transactions:[], cursorVersion:1 });
  };
  try {
    await loadBlockPage('signed block cursor', 7);
    await loadTransactionPage('signed transaction cursor', 9);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const blockURL = new URL(requested[0], 'https://explorer.ynxweb4.com');
  assert.equal(blockURL.pathname, '/api/blocks/latest');
  assert.equal(blockURL.searchParams.get('limit'), '7');
  assert.equal(blockURL.searchParams.get('cursor'), 'signed block cursor');
  const transactionURL = new URL(requested[1], 'https://explorer.ynxweb4.com');
  assert.equal(transactionURL.pathname, '/api/txs');
  assert.equal(transactionURL.searchParams.get('limit'), '9');
  assert.equal(transactionURL.searchParams.get('cursor'), 'signed transaction cursor');
});

test('cursor page clients surface fail-closed source errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ error:'invalid_cursor' }, 400);
  try {
    await assert.rejects(() => loadBlockPage('tampered'), /Explorer source unavailable \(400\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
