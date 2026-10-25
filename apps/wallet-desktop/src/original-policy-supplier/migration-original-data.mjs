// Original saved E6/current policy mathematics only, not a Source or approval.
// The Main-only factory independently requires the real private review borrow.
import{createHash}from'node:crypto';import{types}from'node:util';
import{decodePQMigrationRequest,verifyPQMigrationPossessionData}from'@ynx-chain/wallet-auth/pq-wallet-authorization';
import{assertPQMigrationRequestPolicy}from'@ynx-chain/wallet-auth/pq-wallet-policy';
import{verifyPQRegisteredMemberData}from'@ynx-chain/wallet-auth/pq-registered-member';
import{parsePQOriginalRecord}from'../wallet-pq-intent-record.mjs';
import{pqBFTOriginalIdentity}from'../wallet-pq-bft-evidence.mjs';
const fail=()=>{throw Object.assign(Error('AUTH_MIGRATION_ORIGINAL_MISMATCH'),{code:'AUTH_MIGRATION_ORIGINAL_MISMATCH'});};
const sha=b=>createHash('sha256').update(b).digest('hex');
export function inspectOriginalMigrationPacketDATA(source,request){
 if(!source||types.isProxy(source)||Object.getPrototypeOf(source)!==Object.prototype)fail();
 const d=Object.getOwnPropertyDescriptors(source);if(Reflect.ownKeys(d).length!==2||!['original','snapshot'].every(k=>d[k]?.enumerable&&Object.hasOwn(d[k],'value')))fail();
 const original=parsePQOriginalRecord(source.original);
 if(original.kind!=='pq-migration'||original.account!==request.account||original.operationId!==request.originalOperationId||original.hash!==request.transportHash)fail();
 const wire=Buffer.from(original.wire,'base64url'),decoded=decodePQMigrationRequest(wire),identity=pqBFTOriginalIdentity(original),plan=assertPQMigrationRequestPolicy(source.snapshot,wire);
 if(source.snapshot.executionHeight!==request.executionHeight||plan.policy.mode!==request.currentAuthorization||decoded.currentAuthorization!==request.currentAuthorization||identity.abciTransactionHash!==request.abciTransactionHash||sha(decoded.intentBytes)!==request.requestDigest||'0x'+sha(decoded.newKeyWholeProof)!==request.newKeyWholeProofHash||(decoded.currentPQMember.length?'0x'+sha(decoded.currentPQMember):null)!==request.currentPQMemberHash)fail();
 for(const k of Object.keys(decoded.intent))if(decoded.intent[k]!==request.migrationIntent[k])fail();
 if(decoded.currentAuthorization==='pq'){
  const verified=verifyPQRegisteredMemberData(source.snapshot,decoded.currentPQMember,{chainId:request.networkId,owner:request.account,keyVersion:request.policyRevision,executionHeight:request.executionHeight,purpose:'ACCOUNT-MIGRATION',message:decoded.intentBytes});
  if(!verified.signatureVerified||verified.memberCount!==1||verified.memberIndex!==0)fail();
 }
 // For legacy, sole SDK decoding already verifies the existing low-S public
 // signature/owner. No classic signer/fallback exists here. Proposed new pair
 // proves possession only; never manufacture/persist an active account policy.
 const possession=verifyPQMigrationPossessionData(decoded.newKeyWholeProof,decoded.intent);
 if(possession.purpose!=='ACCOUNT-MIGRATION'||possession.N!==1||possession.signatureVerified!==true||possession.dataOnly!==true||possession.registered!==false||possession.current!==false||possession.SourceAdmission!==false||possession.NativeAdmission!==false||possession.approval!==false)fail();
 return Object.freeze({originalOperationId:original.operationId,transportHash:original.hash,abciTransactionHash:identity.abciTransactionHash,executionHeight:request.executionHeight,dataOnly:true,SourceAdmission:false,NativeAdmission:false,approval:false});
}
