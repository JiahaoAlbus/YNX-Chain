// Normal Source-side current dispatcher. It cannot sign, register a publisher,
// create a Root or promote a standalone mathematical result to protected custody.
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {dispatchOriginalSourceV2} from './original-auth-source-v2-dispatch.mjs';
import {fetchOriginalNativeAuthorization} from './original-ide-auth-proof-dispatch.mjs';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {encodeOriginalDeveloperPrincipalDATA} from './original-developer-principal-data.mjs';
import {encodeOriginalDeveloperCommandDATA,ORIGINAL_PROJECT_CONTROL_SOURCE_PURPOSE} from './original-ide-project-control-contract.mjs';
import {verifyOriginalProtectedPublisherRegistrationDATA} from './original-ide-protected-publisher-contract.mjs';
const fail=code=>{throw Object.assign(Error(code),{code})};
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail('IDE_PUBLISHER_CURRENT_SCHEMA')}
function live(p,at){if(!p||p.dataOnly!==true||p.nativeAdmission!==false||p.status!=='active'||!Number.isSafeInteger(p.timeFloor)||!Number.isSafeInteger(p.expiresAtMs)||at<p.timeFloor||at>=p.expiresAtMs||typeof p.executionHeight!=='string'||!/^(0|[1-9][0-9]*)$/.test(p.executionHeight))fail('IDE_PUBLISHER_CURRENT_SOURCE_NOT_ACTIVE')}
export async function dispatchOriginalProtectedPublisherCurrent(input,getSource=dispatchOriginalSourceV2,getRole=fetchOriginalNativeAuthorization){
 const result={version:'YNX-IDE-PUBLISHER-CURRENT-VERIFICATION-DATA/v1',completed:false,sourceBefore:null,sourceAfter:null,registrationOriginal:'',projection:null,failureCode:'',dataOnly:true,authorized:false,registered:false,protectedCustodyAdmitted:false,nativeAdmission:false};
 try{
  const started=Date.now();
  exact(input,['operation','source','registrationOriginal','principal','command']);
  if(input.operation!=='ide-protected-publisher-current-native-node/v1'||input.source?.policy?.signatureContract?.purpose!==ORIGINAL_PROJECT_CONTROL_SOURCE_PURPOSE)fail('IDE_PUBLISHER_CURRENT_DEDICATED_SOURCE_REQUIRED');
  if(typeof input.registrationOriginal!=='string'||!input.registrationOriginal.length||Buffer.byteLength(input.registrationOriginal)>786432)fail('IDE_PUBLISHER_CURRENT_CAPACITY');
  // Own the actual partial before the first asynchronous current callback.
  result.registrationOriginal=input.registrationOriginal;
  const first=await getSource(input.source);result.sourceBefore=first;
  const before=first?.projection;live(before,Date.now());
  const capture=before.selection?.projectControlCapture,review=capture?.review?.publisher,peer=before.selection?.identityPeerBinding;
  const p=encodeOriginalDeveloperPrincipalDATA(input.principal),c=encodeOriginalDeveloperCommandDATA(input.command,Date.now());
  if(capture?.version!=='YNX-IDE-PROJECT-CONTROL-CAPTURE/v1'||!review||before.profileDigest!==sha(input.source.profileRaw)||before.head!==sha(canonical(capture))||capture.principalOriginal!==Buffer.from(p.principalOriginal).toString('base64url')||capture.commandOriginal!==Buffer.from(c.commandOriginal).toString('base64url')||typeof peer?.walletCodeIdentity!=='string'||!peer.walletCodeIdentity.length)fail('IDE_PUBLISHER_CURRENT_CAPTURE_NOT_SELECTED');
  exact(review,['Account','ProjectID','PublisherID','KeyRole','PublicSHA256','RegistrationRef','ExpiresMS']);
  if(review.Account!==input.command.SubjectAccount||review.ProjectID!==input.command.ProjectID||review.PublisherID!==input.command.PublisherID||review.KeyRole!=='ide-artifact-publisher'||review.PublicSHA256!==input.command.PublicOriginalSHA256||typeof review.ExpiresMS!=='string'||!/^[1-9][0-9]*$/.test(review.ExpiresMS)||BigInt(review.ExpiresMS)<BigInt(input.command.GrantExpiresMS))fail('IDE_PUBLISHER_CURRENT_REVIEW_CHANGED');
  // This request nonce must come from the SAME authenticated Source selection,
  // not from parsing/echoing the proof that it is meant to authenticate.
  const registrationCapture=before.selection?.projectPublisherRegistrationCapture;
  exact(registrationCapture,['version','requestId','registrationRef','nonce','principalSHA256','commandSHA256','publicSHA256']);
  if(registrationCapture.version!=='YNX-IDE-PUBLISHER-REGISTRATION-CAPTURE/v1'||registrationCapture.requestId!==input.command.RequestID||registrationCapture.registrationRef!==review.RegistrationRef||registrationCapture.principalSHA256!==p.principalSHA256||registrationCapture.commandSHA256!==c.commandSHA256||registrationCapture.publicSHA256!==review.PublicSHA256)fail('IDE_PUBLISHER_CURRENT_REGISTRATION_CAPTURE_CHANGED');
  const root=JSON.parse(input.source.rootRaw),network={chainId:root.networkId,nativeChainId:input.source.node.nativeChainId,owner:before.subjectOwner};
  const roleBefore=parsePQAccountAuthorization(await getRole(input.source.node,before.subjectOwner),network);
  const expected={registrationRef:review.RegistrationRef,nonce:registrationCapture.nonce,callerIdentity:peer.walletCodeIdentity,sourceCurrentRef:input.principal.currentRef,custodyCurrentRef:before.head};
  const projection=verifyOriginalProtectedPublisherRegistrationDATA(input.registrationOriginal,roleBefore,input.principal,input.command,expected,Date.now());result.projection=projection;
  const envelope=JSON.parse(input.registrationOriginal);
  if(envelope.binding.owner!==before.subjectOwner||envelope.binding.keyVersion!==before.subjectKeyVersion||BigInt(envelope.binding.executionHeight)<BigInt(before.executionHeight)||BigInt(envelope.binding.executionHeight)<BigInt(roleBefore.executionHeight))fail('IDE_PUBLISHER_CURRENT_ISSUANCE_ROLLBACK');
  const last=await getSource({...input.source,previous:{sequence:before.sequence,floor:before.floor,head:before.head,timeFloor:before.timeFloor,executionHeight:before.executionHeight}});result.sourceAfter=last;
  const after=last?.projection;live(after,Date.now());
  for(const k of ['profileDigest','generation','sourceId','instanceId','sequence','floor','head','subjectOwner','subjectKeyVersion'])if(before[k]!==after[k])fail('IDE_PUBLISHER_CURRENT_SOURCE_CHANGED');
  if(canonical(before.selection)!==canonical(after.selection)||BigInt(after.executionHeight)<BigInt(envelope.binding.executionHeight))fail('IDE_PUBLISHER_CURRENT_SOURCE_CHANGED');
  const roleAfter=parsePQAccountAuthorization(await getRole(input.source.node,before.subjectOwner),network);assertPQAuthorizationCurrent(roleBefore,roleAfter);
  if(roleAfter.executionHeight!==roleBefore.executionHeight)fail('IDE_PUBLISHER_CURRENT_HEIGHT_CHANGED');
  const at=Date.now(),expires=Number(capture.expiresAtMs);
  if(!Number.isSafeInteger(expires)||at<started||at<before.timeFloor||at<after.timeFloor||at>=Math.min(before.expiresAtMs,after.expiresAtMs,projection.expiresAtMs,expires))fail('IDE_PUBLISHER_CURRENT_POST_EXPIRED');
  result.completed=true;
 }catch(e){result.failureCode=typeof e?.code==='string'&&/^(AUTH_|IDE_|PQ_)[A-Z0-9_]{1,100}$/.test(e.code)?e.code:'IDE_PUBLISHER_CURRENT_UNKNOWN'}
 return Object.freeze(result);
}
