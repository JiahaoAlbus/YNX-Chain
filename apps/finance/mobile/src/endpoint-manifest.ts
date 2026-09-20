import {
  bundledEndpointAuthority,selectAuthorityEndpoint,validateEndpointAuthority,
  type EndpointAuthority,type EndpointAuthorityPin,
} from '@ynx-chain/sdk';
import pin from '../contract/endpoint-authority-pin.json';

export const FINANCE_ENDPOINT_AUTHORITY_SOURCE='58d41e396e9970048a97f5a26bee7a8411ce2bde';
export const FINANCE_ENDPOINT_AUTHORITY_TREE='ab9d15db8c508284c073f5355ce52abe91a7c814';
export const FINANCE_ENDPOINT_AUTHORITY_FILE_SHA256='c8eb9f641185958aaec82c6fa16764e9424ad10f47bf7435af643a2a888a07e1';
export const FINANCE_ENDPOINT_AUTHORITY_PAYLOAD_SHA256='29f801933e9df4faea58531cb522cc34bfe1028628adfb88227f3d0cae1e4e73';
export const financeEndpointAuthorityPin=Object.freeze(pin) as EndpointAuthorityPin;
export const financeEndpointManifest=bundledEndpointAuthority;
export type FinanceAuthorityDigest=(payload:string)=>Promise<string>;

export async function validateFinanceConsumerContract(input:unknown,nowMs:number,digestSHA256?:FinanceAuthorityDigest):Promise<EndpointAuthority>{
  const authority=await validateEndpointAuthority(input,{trustedPin:financeEndpointAuthorityPin,nowMs,source:'bundled',...(digestSHA256?{digestSHA256}:{})});
  if(authority.endpointStates.walletGateway.status!=='PENDING'||authority.endpointStates.products.finance.status!=='PENDING')throw new Error('FINANCE_AUTHORITY_SCOPE_DRIFT: this release must not activate Wallet Gateway or Finance Product Session.');
  return authority;
}

export async function assertFinanceConsumerContract(nowMs=Date.now(),digestSHA256?:FinanceAuthorityDigest){return validateFinanceConsumerContract(financeEndpointManifest,nowMs,digestSHA256)}

export async function financeNetworkEndpoints(nowMs=Date.now(),digestSHA256?:FinanceAuthorityDigest){
  const authority=await assertFinanceConsumerContract(nowMs,digestSHA256);
  return Object.freeze({
    rpc:selectAuthorityEndpoint(authority,'rpc',{nowMs}),
    evmRpc:selectAuthorityEndpoint(authority,'evmRpc',{nowMs}),
    faucet:selectAuthorityEndpoint(authority,'faucet',{nowMs}),
  });
}

export async function assertFinanceProductSessionContract(nowMs=Date.now(),digestSHA256?:FinanceAuthorityDigest):Promise<EndpointAuthority>{
  const authority=await assertFinanceConsumerContract(nowMs,digestSHA256);
  throw new Error(`PRIVATE_SERVICE_DEGRADED: Wallet Gateway=${authority.endpointStates.walletGateway.status}; Finance Product Session=${authority.endpointStates.products.finance.status}. Standard Wallet and guest surfaces remain independent.`);
}
