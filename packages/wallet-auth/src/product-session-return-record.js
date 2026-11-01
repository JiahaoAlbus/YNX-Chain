// Original Gateway snapshot extension only. Rows retain public approval bytes,
// never a signing key, capability, new issuer or an independent storage engine.
import {canonicalJSON,digestHex,exactFields,WalletAuthError} from './canonical.js';
import {parseProductSessionChallenge,productSessionApprovalDigest} from './product-session-v2.js';
export const PRODUCT_SESSION_RETURN_VERSION='YNX-PRODUCT-SESSION-RETURNS/v1';
export const PRODUCT_SESSION_RETURN_PREFIX='ynxpsr1_';
const fail=()=>{throw new WalletAuthError('INVALID_RETURN_STORE','Original pending return store is invalid')};
export function parseProductSessionReturns(value){
 exactFields(value,['version','records'],'Original return publications');
 if(value.version!==PRODUCT_SESSION_RETURN_VERSION||!Array.isArray(value.records)||value.records.length>64)fail();
 const records=value.records.map(row=>{
  exactFields(row,['version','reference','requestId','requestRaw','approvalRaw','challengeRaw','createdAt','expiresAt','status','completionRaw','sessionBinding'],'Original return publication');
  if(row.version!==PRODUCT_SESSION_RETURN_VERSION||!/^ynxpsr1_[A-Za-z0-9_-]{43}$/.test(row.reference)||!/^req_[A-Za-z0-9_-]{12,80}$/.test(row.requestId)||!['pending','completed'].includes(row.status))fail();
  const parse=(raw,max)=>{if(typeof raw!=='string'||new TextEncoder().encode(raw).length>max)fail();let v;try{v=JSON.parse(raw);}catch{fail();}if(canonicalJSON(v)!==raw)fail();return v;};
  const request=parse(row.requestRaw,16384),approval=parse(row.approvalRaw,196608),challenge=parseProductSessionChallenge(parse(row.challengeRaw,16384));
  if(request.version!=='2'||approval.version!=='3'||digestHex('YNX_PRODUCT_SESSION_REQUEST_V2',request)!==challenge.requestDigest||approval.requestDigest!==challenge.requestDigest||productSessionApprovalDigest(approval)!==challenge.approvalDigest||approval.account!==challenge.account||request.nonce!==challenge.nonce||request.state!==challenge.state||row.createdAt!==challenge.issuedAt||row.expiresAt!==challenge.expiresAt)fail();
  for(const key of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','deviceAlgorithm','deviceKey'])if(request[key]!==challenge[key]||approval[key]!==challenge[key])fail();
  if(row.status==='pending'?(row.completionRaw!==null||row.sessionBinding!==null):(typeof row.sessionBinding!=='string'||!/^[a-f0-9]{64}$/.test(row.sessionBinding)||!row.completionRaw))fail();
  if(row.completionRaw!==null){const completion=parse(row.completionRaw,16384);exactFields(completion,['challenge','deviceSignature'],'Original completed return');if(canonicalJSON(completion.challenge)!==row.challengeRaw||typeof completion.deviceSignature!=='string'||completion.deviceSignature.length>256||row.sessionBinding!==digestHex('YNX_PRODUCT_SESSION_BINDING_V2',challenge))fail();}
  return Object.freeze({...row});
 });
 for(const key of ['reference','requestId'])if(new Set(records.map(x=>x[key])).size!==records.length)fail();
 if([...records].sort((a,b)=>a.requestId.localeCompare(b.requestId)).map(x=>x.requestId).join('|')!==records.map(x=>x.requestId).join('|'))fail();
 return Object.freeze({version:PRODUCT_SESSION_RETURN_VERSION,records:Object.freeze(records)});
}
