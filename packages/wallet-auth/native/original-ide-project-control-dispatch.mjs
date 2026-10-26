// Normal readonly Source-side control verifier. No signer, key export, Root
// creation or callback-selected authority. Registered/source transport seams
// exist only for PUBLIC tests; stdin dispatch always uses the fixed originals.
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{dispatchOriginalSourceV2}from'./original-auth-source-v2-dispatch.mjs';
import{fetchOriginalNativeAuthorization}from'./original-ide-auth-proof-dispatch.mjs';
import{parsePQAccountAuthorization,assertPQAuthorizationCurrent}from'../src/pq-wallet-policy.js';
import{encodeOriginalDeveloperPrincipalDATA}from'./original-developer-principal-data.mjs';
import{encodeOriginalDeveloperCommandDATA,verifyOriginalProjectControlApprovalDATA,ORIGINAL_PROJECT_CONTROL_SOURCE_PURPOSE}from'./original-ide-project-control-contract.mjs';
const fail=c=>{throw Object.assign(Error(c),{code:c})};
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail('IDE_CONTROL_DISPATCH_SCHEMA')}
function live(p,t){if(!p||p.dataOnly!==true||p.nativeAdmission!==false||p.status!=='active'||!Number.isSafeInteger(p.timeFloor)||!Number.isSafeInteger(p.expiresAtMs)||t<p.timeFloor||t>=p.expiresAtMs||typeof p.executionHeight!=='string'||!/^[0-9]+$/.test(p.executionHeight))fail('IDE_CONTROL_DISPATCH_SOURCE_NOT_CURRENT')}
export async function dispatchOriginalProjectControlCurrent(input,getSource=dispatchOriginalSourceV2,getRole=fetchOriginalNativeAuthorization){
 const result={version:'YNX-IDE-CONTROL-VERIFICATION-DATA/v1',completed:false,sourceBefore:null,sourceAfter:null,approvalOriginal:'',projection:null,failureCode:'',dataOnly:true,authorized:false,nativeAdmission:false};
 try{
  exact(input,['operation','source','approvalOriginal','principal','command','expected']);
  if(input.operation!=='ide-project-control-current-native-node/v1'||input.source?.policy?.signatureContract?.purpose!==ORIGINAL_PROJECT_CONTROL_SOURCE_PURPOSE)fail('IDE_CONTROL_DISPATCH_DEDICATED_SOURCE_REQUIRED');
  const first=await getSource(input.source);result.sourceBefore=first;const before=first.projection;live(before,Date.now());
  const capture=before.selection?.projectControlCapture,root=JSON.parse(input.source.rootRaw),peer=before.selection?.identityPeerBinding;
  if(before.profileDigest!==sha(input.source.profileRaw)||!capture||before.head!==sha(canonical(capture))||peer?.walletCodeIdentity!==input.expected?.callerIdentity)fail('IDE_CONTROL_DISPATCH_CAPTURE_NOT_SELECTED');
  const p=encodeOriginalDeveloperPrincipalDATA(input.principal),c=encodeOriginalDeveloperCommandDATA(input.command,Date.now());
  if(capture.principalOriginal!==Buffer.from(p.principalOriginal).toString('base64url')||capture.commandOriginal!==Buffer.from(c.commandOriginal).toString('base64url'))fail('IDE_CONTROL_DISPATCH_ORIGINAL_CHANGED');
  const network={chainId:root.networkId,nativeChainId:input.source.node.nativeChainId,owner:before.subjectOwner};
  const roleBefore=parsePQAccountAuthorization(await getRole(input.source.node,before.subjectOwner),network);
  result.approvalOriginal=input.approvalOriginal;
  const projected=verifyOriginalProjectControlApprovalDATA(input.approvalOriginal,roleBefore,input.principal,input.command,input.expected,Date.now());result.projection=projected;
  const e=JSON.parse(input.approvalOriginal);
  if(e.binding.owner!==before.subjectOwner||BigInt(e.binding.executionHeight)<BigInt(before.executionHeight)||BigInt(e.binding.executionHeight)<BigInt(roleBefore.executionHeight))fail('IDE_CONTROL_DISPATCH_ISSUANCE_ROLLBACK');
  const last=await getSource({...input.source,previous:{sequence:before.sequence,floor:before.floor,head:before.head,timeFloor:before.timeFloor,executionHeight:before.executionHeight}});result.sourceAfter=last;const after=last.projection;live(after,Date.now());
  for(const k of['profileDigest','generation','sourceId','instanceId','sequence','floor','head','subjectOwner','subjectKeyVersion'])if(before[k]!==after[k])fail('IDE_CONTROL_DISPATCH_POST_SOURCE_CHANGED');
  if(canonical(before.selection)!==canonical(after.selection)||BigInt(after.executionHeight)<BigInt(e.binding.executionHeight))fail('IDE_CONTROL_DISPATCH_POST_SOURCE_CHANGED');
  const roleAfter=parsePQAccountAuthorization(await getRole(input.source.node,before.subjectOwner),network);assertPQAuthorizationCurrent(roleBefore,roleAfter);
  if(roleAfter.executionHeight!==roleBefore.executionHeight)fail('IDE_CONTROL_DISPATCH_HEIGHT_CHANGED');
  const now=Date.now();if(now<before.timeFloor||now<after.timeFloor||now>=Math.min(before.expiresAtMs,after.expiresAtMs,projected.expiresMS,Number(capture.expiresAtMs)))fail('IDE_CONTROL_DISPATCH_POST_EXPIRED');
  result.completed=true;
 }catch(e){result.failureCode=typeof e?.code==='string'&&/^(AUTH_|IDE_|PQ_)[A-Z0-9_]{1,100}$/.test(e.code)?e.code:'IDE_CONTROL_DISPATCH_UNKNOWN'}
 return Object.freeze(result);
}
