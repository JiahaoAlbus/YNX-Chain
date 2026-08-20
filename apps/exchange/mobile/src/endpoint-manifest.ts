import manifest from '../contract/public-endpoint-manifest.json';

/** Exact bundled contract from Integration commit fa0ffd9bbbcc831438078be8e19cebff51b07e5e. */
export const exchangeEndpointManifest=Object.freeze(manifest);

export function assertExchangeConsumerContract(){
  if(Date.parse(exchangeEndpointManifest.expiresAt)<=Date.now())throw new Error('CLIENT_RETIRED: the bundled YNX Testnet endpoint manifest has expired. Update Exchange before connecting.');
  if(exchangeEndpointManifest.evmChainId!==6423||exchangeEndpointManifest.evmChainHex!=='0x1917')throw new Error('WRONG_CHAIN: bundled endpoint manifest is not YNX Testnet.');
  if(exchangeEndpointManifest.endpointStates.products.exchange.status!=='PENDING')throw new Error('ENDPOINT_MANIFEST_INVALID: Exchange must not activate an unaccepted product API.');
  if(exchangeEndpointManifest.integrity.payloadSha256!=='3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5')throw new Error('ENDPOINT_MANIFEST_UNVERIFIED: Exchange bundled manifest identity changed.');
  return exchangeEndpointManifest;
}
