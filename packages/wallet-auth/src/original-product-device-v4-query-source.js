// Normal acquisition is release-owned and intentionally EMPTY, never a setter,
// caller body/ENV override or a test-kernel-to-Source authority conversion.
import {loadReleaseSelectedOriginalSourceV2} from './original-auth-source-current-v2.js';
import {loadReleaseSelectedOriginalSourceIssuanceV2} from './original-auth-source-issuance-v2.js';
import {PRODUCT_DEVICE_V4_QUERY_PURPOSE} from '../native/original-product-device-v4-query-source-contract.mjs';
const releaseSelectedQueryCurrent=Object.freeze([]);
const releaseSelectedQueryIssuance=Object.freeze([]);
const fail=code=>{throw Object.assign(Error(code),{code});};
export async function acquireOriginalProductDeviceV4QuerySource(){
 if(arguments.length)fail('AUTH_DEVICE_QUERY_SOURCE_CALLER_SELECTION_FORBIDDEN');
 const row=releaseSelectedQueryCurrent[0];
 if(!row)fail('AUTH_DEVICE_QUERY_SOURCE_NOT_ADMITTED');
 if(row.entry.policy.signatureContract.purpose!==PRODUCT_DEVICE_V4_QUERY_PURPOSE)fail('AUTH_DEVICE_QUERY_SOURCE_PURPOSE');
 return loadReleaseSelectedOriginalSourceV2(row.entry,row.readOriginalPublic);
}
export async function acquireOriginalProductDeviceV4QuerySourceIssuer(){
 if(arguments.length)fail('AUTH_DEVICE_QUERY_SOURCE_CALLER_SELECTION_FORBIDDEN');
 const row=releaseSelectedQueryIssuance[0];
 if(!row)fail('AUTH_DEVICE_QUERY_SOURCE_ISSUER_NOT_ADMITTED');
 if(row.entry.plan.policy.signatureContract.purpose!==PRODUCT_DEVICE_V4_QUERY_PURPOSE)fail('AUTH_DEVICE_QUERY_SOURCE_PURPOSE');
 return loadReleaseSelectedOriginalSourceIssuanceV2(row.entry);
}
