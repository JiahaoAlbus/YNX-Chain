import manifest from '../contract/public-endpoint-manifest.json';

/** Exact bundled contract from Integration commit fa0ffd9bbbcc831438078be8e19cebff51b07e5e. */
export const financeEndpointManifest=Object.freeze(manifest);

export function assertFinanceConsumerContract(){
  if(Date.parse(financeEndpointManifest.expiresAt)<=Date.now())throw new Error('CLIENT_RETIRED: the bundled YNX Testnet endpoint manifest has expired. Update Finance before connecting.');
  if(financeEndpointManifest.evmChainId!==6423||financeEndpointManifest.evmChainHex!=='0x1917')throw new Error('WRONG_CHAIN: bundled endpoint manifest is not YNX Testnet.');
  if(financeEndpointManifest.endpointStates.products.finance.status!=='PENDING')throw new Error('ENDPOINT_MANIFEST_INVALID: Finance must not activate an unaccepted product API.');
  if(financeEndpointManifest.integrity.payloadSha256!=='3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5')throw new Error('ENDPOINT_MANIFEST_UNVERIFIED: Finance bundled manifest identity changed.');
  return financeEndpointManifest;
}
