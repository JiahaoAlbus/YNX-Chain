import assert from 'node:assert/strict';
import test from 'node:test';
import { pathForSelection, selectionFromSearchResult, selectionFromURL } from './routing';

function url(value: string) {
  return new URL(value, 'https://explorer.ynxweb4.com');
}

test('canonical evidence paths round-trip without losing identifiers', () => {
  for (const selection of [
    { kind: 'block' as const, id: '6423' },
    { kind: 'transaction' as const, id: '0xabc/def' },
    { kind: 'account' as const, id: 'ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9e75rs' }
  ]) {
    const path = pathForSelection(selection);
    assert.deepEqual(selectionFromURL(url(path)), selection);
  }
});

test('legacy query deep links remain readable while malformed paths fail closed', () => {
  assert.deepEqual(selectionFromURL(url('/?kind=block&id=18')), { kind: 'block', id: '18' });
  assert.equal(selectionFromURL(url('/unknown/value')), undefined);
  assert.equal(selectionFromURL(url('/block/18/extra')), undefined);
  assert.equal(selectionFromURL(url('/?kind=wallet&id=18')), undefined);
  assert.equal(selectionFromURL(url('/?kind=block&id=')), undefined);
});

test('search results resolve to canonical evidence identities', () => {
  assert.deepEqual(selectionFromSearchResult({ type: 'block', query: '91' }), { kind: 'block', id: '91' });
  assert.deepEqual(selectionFromSearchResult({ type: 'transaction', query: '0xfeed' }), { kind: 'transaction', id: '0xfeed' });
  assert.deepEqual(
    selectionFromSearchResult({ type: 'account', query: 'ynx1alias', normalizedAddress: '0x001122' }),
    { kind: 'account', id: '0x001122' }
  );
  assert.equal(selectionFromSearchResult({ type: 'price', query: 'YNXT' }), undefined);
});
