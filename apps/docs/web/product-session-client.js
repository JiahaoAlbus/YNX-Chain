export const docsSessionBinding = Object.freeze({
  authority: 'https://wallet-auth.ynxweb4.com',
  origin: 'https://docs.ynxweb4.com',
  callback: 'https://docs.ynxweb4.com/wallet-auth/callback',
  productId: 'docs', scopes: Object.freeze(['docs.read', 'files.read']),
});
export const docsEditingScopes = Object.freeze(['docs.read', 'docs.write', 'files.read', 'files.write']);

export async function createDocsBrowserSession({sdk, registry, environment = globalThis, walletInstalled = () => false, access = 'read'}) {
  if (!['read', 'edit'].includes(access)) throw new TypeError('Unsupported Docs access profile');
  if (environment.location?.origin !== docsSessionBinding.origin || environment.isSecureContext !== true) {
    throw new Error('Docs Product Session requires the configured secure application origin');
  }
  const gateway = new sdk.ProductSessionGatewayFetchAdapter({
    endpoint: docsSessionBinding.authority,
    fetch: environment.fetch.bind(environment),
    walletInstalled,
    schemeRegistered: walletInstalled,
    timeoutMs: 10000,
  });
  return sdk.createBrowserProductSessionClient({
    registry, productId: docsSessionBinding.productId,
    scopes: [...(access === 'edit' ? docsEditingScopes : docsSessionBinding.scopes)],
    purpose: access === 'edit' ? 'Read, create and save explicitly authorized YNX Docs documents.' : 'Read only explicitly authorized YNX Docs documents.',
    gateway, environment,
  });
}

export async function loadDocsBrowserSession({environment = globalThis, walletInstalled, access = 'read'} = {}) {
  if (environment.location?.origin !== docsSessionBinding.origin) throw new Error('This is not the configured Docs origin');
  const configResponse = await environment.fetch('/wallet-session-config.json', {cache: 'no-store', credentials: 'omit', redirect: 'error'});
  if (!configResponse.ok) throw new Error('Docs session configuration is unavailable');
  const config = await configResponse.json();
  if (config.enabled !== true) throw new Error('Docs Product Session v2 is not enabled on this deployment');
  if (access === 'edit' && config.apiWriteEnabled !== true) throw new Error('Docs editing authorization is not enabled on this deployment');
  if (config.authority !== docsSessionBinding.authority) throw new Error('Docs session authority does not match the configured deployment');
  const registryResponse = await environment.fetch('/vendor/product-session-registry.json', {cache: 'no-store', credentials: 'omit', redirect: 'error'});
  if (!registryResponse.ok) throw new Error('Docs Product Session registry is unavailable');
  const registry = await registryResponse.json();
  // Deployment bundles the fixed official SDK; never load SDK code from a callback URL.
  const sdk = await import('./vendor/wallet-session-sdk.js');
  return createDocsBrowserSession({sdk, registry, environment, walletInstalled, access});
}
