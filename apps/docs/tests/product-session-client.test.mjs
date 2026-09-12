import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsBrowserSession, docsSessionBinding} from '../web/product-session-client.js';

test('Docs uses the official browser construction interface and fixed new authority', async () => {
  let gatewayConfig, clientConfig;
  const registry = {fixture: true};
  const sdk = {
    ProductSessionGatewayFetchAdapter: class { constructor(config) { gatewayConfig = config; } },
    createBrowserProductSessionClient: async (config) => { clientConfig = config; return {client: {}}; },
  };
  const environment = {isSecureContext: true, location: {origin: docsSessionBinding.origin}, fetch() { throw Error('No live request in test'); }};
  await createDocsBrowserSession({sdk, registry, environment});
  assert.equal(gatewayConfig.endpoint, 'https://wallet-auth.ynxweb4.com');
  assert.equal(clientConfig.productId, 'docs');
  assert.equal(clientConfig.registry, registry);
  assert.deepEqual(clientConfig.scopes, ['docs.read', 'files.read']);
  assert.equal(gatewayConfig.walletInstalled(), false);
  assert.equal(gatewayConfig.schemeRegistered(), false);
});

test('legacy shared site origin is not treated as the new Docs authority binding', async () => {
  await assert.rejects(createDocsBrowserSession({sdk: {}, registry: {}, environment: {isSecureContext: true, location: {origin: 'https://web4.ynxweb4.com'}}}), /configured secure application origin/);
});
