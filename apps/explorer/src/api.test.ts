import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicEvidenceEnvelope, loadBlockPage, loadEvidence, loadTransactionPage } from './api';

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

test('evidence clients prefer the versioned envelope and retain auxiliary raw sources', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const envelope = {
    schemaVersion:'explorer.public-evidence.v1',
    evidenceId:'ynx-evidence-sha256:abc',
    kind:'transaction',
    subject:'0xabc',
    source:{authority:'01-chain-core',system:'ynx-chain',version:'not-declared-by-source',transportOwner:'12-explorer',transport:'ynx-indexer',transportVersion:'local',path:'/api/txs/0xabc',upstreamPath:'/txs/0xabc',derivation:'none'},
    observedAt:'2026-07-27T12:00:00Z',
    asOf:'2026-07-27T11:59:00Z',
    asOfBasis:'source-event-time',
    freshness:{state:'partial',stale:false,offline:false,partial:true,lagBlocks:1},
    coverage:{status:'partial',scope:'requested-record'},
    correction:{status:'not-declared-by-source'},
    integrity:{algorithm:'sha256',digest:'abc'},
    payload:{hash:'0xabc'}
  };
  globalThis.fetch = async input => {
    const url = String(input);
    requested.push(url);
    return url.startsWith('/api/evidence/') ? response(envelope) : response({ transactionHash:'0xabc' });
  };
  try {
    const evidence = await loadEvidence('transaction', '0xabc');
    assert.deepEqual(requested, ['/api/evidence/transaction/0xabc', '/chain/evm/receipts/0xabc']);
    assert.equal(evidence.length, 2);
    assert.equal(evidence[0].rawSourceUrl, '/api/txs/0xabc');
    assert.equal(evidence[0].envelope?.freshness.state, 'partial');
    assert.equal(evidence[1].envelope, undefined);
    assert.equal(isPublicEvidenceEnvelope(envelope), true);
    assert.equal(isPublicEvidenceEnvelope({ schemaVersion:'explorer.public-evidence.v1' }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
