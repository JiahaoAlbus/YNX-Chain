import manifest from '../contract/public-endpoint-manifest.json';

export const FINANCE_ENDPOINT_MANIFEST_SOURCE='fa0ffd9bbbcc831438078be8e19cebff51b07e5e';
export const FINANCE_ENDPOINT_MANIFEST_SHA256='3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5';

type FinanceEndpointManifest={
  schemaVersion?:unknown;
  manifestVersion?:unknown;
  status?:unknown;
  environment?:unknown;
  sourceCommit?:unknown;
  issuedAt?:unknown;
  expiresAt?:unknown;
  cosmosChainId?:unknown;
  evmChainId?:unknown;
  evmChainHex?:unknown;
  rpc?:unknown;
  evmRpc?:unknown;
  walletGateway?:unknown;
  endpointStates?:{products?:{finance?:{status?:unknown}}};
  integrity?:{
    status?:unknown;
    algorithm?:unknown;
    canonicalization?:unknown;
    payloadSha256?:unknown;
    remoteSignature?:{status?:unknown;failClosed?:unknown};
  };
};

function invalid(message:string):never{
  throw new Error(`ENDPOINT_MANIFEST_INVALID: ${message}`);
}

/**
 * Validate an accepted, hash-pinned Finance consumer manifest. `nowMs` is an
 * explicit input so expiry has deterministic boundary tests; production callers
 * use the current clock through assertFinanceConsumerContract().
 */
export function validateFinanceConsumerContract(input:unknown,nowMs:number):FinanceEndpointManifest{
  if(!input||typeof input!=='object'||Array.isArray(input))invalid('bundled contract is not an object.');
  if(!Number.isFinite(nowMs))invalid('consumer clock is invalid.');
  const value=input as FinanceEndpointManifest;
  if(value.schemaVersion!=='1.0.0'||value.manifestVersion!=='1.0.0-p0.2'||value.status!=='ACCEPTED_BUNDLED_CONSUMER_CONTRACT'||value.environment!=='testnet')invalid('schema identity is not the accepted Finance contract.');
  if(value.sourceCommit!==FINANCE_ENDPOINT_MANIFEST_SOURCE)throw new Error('ENDPOINT_MANIFEST_UNVERIFIED: source commit does not match the accepted Finance contract.');
  const issuedAt=typeof value.issuedAt==='string'?Date.parse(value.issuedAt):Number.NaN;
  const expiresAt=typeof value.expiresAt==='string'?Date.parse(value.expiresAt):Number.NaN;
  if(!Number.isFinite(issuedAt)||!Number.isFinite(expiresAt)||expiresAt<=issuedAt)invalid('authority window is malformed.');
  if(nowMs>=expiresAt)throw new Error('CLIENT_RETIRED: the bundled YNX Testnet endpoint manifest has expired. Update Finance before connecting.');
  if(value.cosmosChainId!=='ynx_6423-1'||value.evmChainId!==6423||value.evmChainHex!=='0x1917')throw new Error('WRONG_CHAIN: bundled endpoint manifest is not YNX Testnet.');
  if(value.rpc!=='https://rpc.ynxweb4.com'||value.evmRpc!=='https://evm.ynxweb4.com'||value.walletGateway!=='https://wallet-auth.ynxweb4.com')invalid('accepted endpoint origins changed.');
  if(value.endpointStates?.products?.finance?.status!=='PENDING')invalid('Finance must not activate an unaccepted product API.');
  if(value.integrity?.status!=='BUNDLED_SHA256_ACCEPTED'||value.integrity.algorithm!=='SHA-256'||value.integrity.canonicalization!=='UTF-8 JSON.stringify(parsed manifest with integrity omitted)'||value.integrity.payloadSha256!==FINANCE_ENDPOINT_MANIFEST_SHA256)throw new Error('ENDPOINT_MANIFEST_UNVERIFIED: Finance bundled manifest identity changed.');
  if(value.integrity.remoteSignature?.status!=='PENDING_PROTECTED_SIGNER'||value.integrity.remoteSignature.failClosed!==true)throw new Error('ENDPOINT_MANIFEST_UNVERIFIED: remote replacement authority is not fail closed.');
  return value;
}

/** Exact bundled contract from Integration commit fa0ffd9bbbcc831438078be8e19cebff51b07e5e. */
export const financeEndpointManifest=Object.freeze(manifest);

export function assertFinanceConsumerContract(){
  validateFinanceConsumerContract(financeEndpointManifest,Date.now());
  return financeEndpointManifest;
}
