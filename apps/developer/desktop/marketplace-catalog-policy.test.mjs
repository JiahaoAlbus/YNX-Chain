import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogRequest, decodeCatalogResponse, catalogLimits } from './marketplace-catalog-policy.mjs';

test('catalog accepts framework search/query and fixes destination, method and credentials', () => {
  for (const operation of ['search', 'query']) {
    const request = catalogRequest(operation, operation === 'search' ? { query: '中文 & C++', size: 20, offset: 0, sortBy: 'relevance' } : { extensionId: 'ms-ceintl.vscode-language-pack-zh-hans', includeAllVersions: 'links', targetPlatform: 'darwin-arm64' });
    assert.equal(new URL(request.url).origin, 'https://open-vsx.org');
    assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit');
    assert.deepEqual(request.headers, { Accept: 'application/json' });
  }
});

test('catalog refuses arbitrary destinations, methods, headers and unbounded inputs', () => {
  for (const operation of ['download', 'install', '__proto__', 'constructor', 'https://example.org']) assert.throws(() => catalogRequest(operation));
  for (const options of [{ url: 'https://example.org' }, { headers: { Authorization: 'secret' } }, { method: 'POST' }, { size: 101 }, { offset: -1 }, { size: NaN }, { query: 'a'.repeat(513) }, { query: '\n' }, { includeAllVersions: 'true' }, { sortBy: 'anything' }, []]) assert.throws(() => catalogRequest('search', options));
});

test('catalog response rejects HTML, oversize, malformed UTF8 and invalid result shapes', () => {
  const bytes = value => Buffer.from(JSON.stringify(value));
  assert.deepEqual(decodeCatalogResponse(bytes({ extensions: [], offset: 0 }), 'application/json; charset=utf-8'), { extensions: [], offset: 0 });
  for (const [body, type] of [[bytes({ extensions: [] }), 'text/html'], [Buffer.alloc(catalogLimits.maxBytes + 1), 'application/json'], [Buffer.from([0xff]), 'application/json'], [bytes({ error: 'unavailable' }), 'application/json'], [bytes({ extensions: Array(101).fill({}) }), 'application/json']]) assert.throws(() => decodeCatalogResponse(body, type));
});
