import manifest from './contract/public-endpoint-manifest.json';

/** Exact bundled Integration consumer contract: fa0ffd9bbbcc831438078be8e19cebff51b07e5e. */
export const payEndpointManifest=Object.freeze(manifest);

export function assertPayConsumerContract(){
  if(Date.parse(payEndpointManifest.expiresAt)<=Date.now())throw new Error('CLIENT_RETIRED: the bundled YNX Testnet endpoint manifest has expired. Update Pay before connecting.');
  if(payEndpointManifest.evmChainId!==6423||payEndpointManifest.evmChainHex!=='0x1917')throw new Error('WRONG_CHAIN: bundled endpoint manifest is not YNX Testnet.');
  if(payEndpointManifest.endpointStates.products.pay.status!=='PENDING')throw new Error('ENDPOINT_MANIFEST_INVALID: Pay must not activate an unaccepted product API.');
  if(payEndpointManifest.integrity.payloadSha256!=='3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5')throw new Error('ENDPOINT_MANIFEST_UNVERIFIED: Pay bundled manifest identity changed.');
  return payEndpointManifest;
}
