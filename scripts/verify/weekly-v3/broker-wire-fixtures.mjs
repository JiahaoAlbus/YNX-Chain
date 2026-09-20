import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Hashes pin public OpenAPI documents and their unmodified examples retrieved
// 2026-09-19. This validates fixture integrity, not provider availability/auth.
export function validateBrokerWireFixtures(value) {
  assert.equal(value.schema, 'ynx-weekly-v3-broker-wire-fixtures/v1');
  assert.equal(value.officialSandboxVerified, false);
  const sources = {
    getaccount: ['42e093761b129c36deabc3ecfbf0c8a8bd329f3a0ab4bdc58fb02970253c877e', '/v1/accounts/{account_id}'],
    gettradingaccount: ['3afff5fc04d6ed8ca255792aecc966949e45d743d82c38e64949d595fe77497c', '/v1/trading/accounts/{account_id}/account'],
    subscribetotradev2sse: ['13e68f7df8a5ab1e1475e55d337084d1cd91746ae52fded657ee499be2c57c9b', '/v2/events/trades'],
  };
  for (const [page, [sha, endpoint]] of Object.entries(sources)) {
    const source = value.sources[page];
    assert.equal(source.url, `https://docs.alpaca.markets/us/reference/${page}.md`);
    assert.equal(source.openapiSha256, sha);
    assert.deepEqual(source.paths, [endpoint]);
  }
  for (const field of ['cash', 'buying_power']) {
    assert(!value.sources.getaccount.properties.includes(field));
    assert(value.sources.gettradingaccount.required.includes(field));
  }
  const hashes = {
    tradingAccount: '9066f88a6a4783039b4a1dcd9c5817149834598b410fd7148408f6f4b5f37a68',
    tradeUpdateNew: '75cc5692dfad2234fa0f18da41c5dd28b15f6718801f9b129e46d48b1ff89616',
  };
  for (const [name, sha] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(JSON.stringify(value[name])).digest('hex'), sha, `${name}: do not weaken or silently rewrite official examples`);
  }
  return {schema: value.schema, sources: value.sources, exampleSha256: hashes, officialSandboxVerified: false};
}
