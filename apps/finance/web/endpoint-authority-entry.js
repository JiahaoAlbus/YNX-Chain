import {bundledEndpointAuthority,validateEndpointAuthority} from '@ynx-chain/sdk';
import authorityPin from '../mobile/contract/endpoint-authority-pin.json';

// Finance owns only this product adapter. Validation, canonicalization and the
// bundled trust root remain in the shared SDK.
export async function assertFinancePrivateAuthority(nowMs=Date.now()){
  const authority=await validateEndpointAuthority(bundledEndpointAuthority,{trustedPin:authorityPin,nowMs,source:'bundled'});
  if(authority.endpointStates.walletGateway.status!=='VERIFIED'||authority.endpointStates.products.finance.status!=='VERIFIED')throw new Error(`PRIVATE_SERVICE_DEGRADED: Wallet Gateway=${authority.endpointStates.walletGateway.status}; Finance Product Session=${authority.endpointStates.products.finance.status}. Private Finance and order actions remain unavailable.`);
  return authority;
}
