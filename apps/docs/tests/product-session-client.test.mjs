import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsBrowserSession, loadDocsBrowserSession, docsSessionBinding} from '../web/product-session-client.js';

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

test('editing authorization readiness is independent from backend write activation', async () => {
  const requests = [];
  const environment = {location: {origin: docsSessionBinding.origin}, fetch: async (path) => {
    requests.push(path);
    return requests.length === 1
      ? Response.json({enabled:true,editingAuthorizationEnabled:true,apiWriteEnabled:false,authority:docsSessionBinding.authority})
      : new Response('',{status:503});
  }};
  await assert.rejects(loadDocsBrowserSession({environment,access:'edit'}),/registry is unavailable/);
  assert.deepEqual(requests,['/wallet-session-config.json','/vendor/product-session-registry.json']);
});

test('editing authorization stays gated when its explicit readiness flag is absent', async () => {
  let calls = 0;
  const environment = {location:{origin:docsSessionBinding.origin},fetch:async()=>{calls++;return Response.json({enabled:true,apiWriteEnabled:true,authority:docsSessionBinding.authority});}};
  await assert.rejects(loadDocsBrowserSession({environment,access:'edit'}),/editing authorization is not enabled/);
  assert.equal(calls,1);
});
