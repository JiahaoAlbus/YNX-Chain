// Original Root-selected capture validation; DATA is not consent or signing.
import{encodeFields,VERSION,SUITE}from'@ynx/batch-v01-candidate';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{encodeOriginalDeveloperPrincipalDATA}from'./original-developer-principal-data.mjs';
import{encodeOriginalDeveloperCommandDATA,ORIGINAL_PROJECT_CONTROL_PURPOSE}from'./original-ide-project-control-contract.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
function exact(v,k){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==k.slice().sort().join('|'))fail('IDE_CONTROL_CAPTURE_SCHEMA');for(const d of Object.values(Object.getOwnPropertyDescriptors(v)))if(!d.enumerable||!Object.hasOwn(d,'value'))fail('IDE_CONTROL_CAPTURE_SCHEMA');}
function bytes(s,max){if(typeof s!=='string'||!s.length||s.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(s))fail('IDE_CONTROL_CAPTURE_BASE64');const b=Buffer.from(s,'base64url');if(!b.length||b.length>max||b.toString('base64url')!==s)fail('IDE_CONTROL_CAPTURE_BASE64');return b;}
const utf8=b=>new TextDecoder('utf8',{fatal:true}).decode(b);
function originalJSON(b){try{return JSON.parse(utf8(b),(k,v,c)=>typeof v==='number'?c.source:v)}catch{fail('IDE_CONTROL_CAPTURE_ORIGINAL_JSON')}}
export function encodeOriginalProjectControlRequestDATA(networkId,callerIdentity,principalOriginal,commandOriginal){
 if(typeof networkId!=='string'||!/^[a-f0-9]{64}$/.test(networkId)||typeof callerIdentity!=='string'||!callerIdentity.length||Buffer.byteLength(callerIdentity)>256||typeof principalOriginal!=='string'||Buffer.byteLength(principalOriginal)>16384||typeof commandOriginal!=='string'||Buffer.byteLength(commandOriginal)>16384)fail('IDE_CONTROL_CAPTURE_REQUEST');
 return encodeFields(['YNX-IDE-PROJECT-CONTROL-REQUEST/v1',VERSION,SUITE,ORIGINAL_PROJECT_CONTROL_PURPOSE,Buffer.from(networkId,'hex'),callerIdentity,principalOriginal,commandOriginal]);
}
export function inspectOriginalProjectControlCaptureDATA(capture,association,networkId,walletCodeIdentity,profileIssued,profileExpires,at){
 exact(capture,['version','review','requestOriginal','principalOriginal','commandOriginal','expiresAtMs']);if(capture.version!=='YNX-IDE-PROJECT-CONTROL-CAPTURE/v1')fail('IDE_CONTROL_CAPTURE_VERSION');
 if(typeof capture.expiresAtMs!=='string'||!/^[1-9][0-9]*$/.test(capture.expiresAtMs)||BigInt(capture.expiresAtMs)>9007199254740991n||!Number.isSafeInteger(at)||at<profileIssued||BigInt(at)>=BigInt(capture.expiresAtMs)||BigInt(capture.expiresAtMs)>BigInt(profileExpires)||BigInt(capture.expiresAtMs)>BigInt(profileIssued)+30000n)fail('IDE_CONTROL_CAPTURE_EXPIRED');
 const pRaw=bytes(capture.principalOriginal,16384),cRaw=bytes(capture.commandOriginal,16384),request=bytes(capture.requestOriginal,65536),p=originalJSON(pRaw),c=originalJSON(cRaw);
 exact(p,['Account','DeviceID','SessionRef','CurrentRef','AccountGeneration','SessionGeneration','ExpiresMS']);
 const principal={account:p.Account,deviceId:p.DeviceID,sessionRef:p.SessionRef,currentRef:p.CurrentRef,accountGeneration:p.AccountGeneration,sessionGeneration:p.SessionGeneration,expiresMS:p.ExpiresMS};
 const encoded=encodeOriginalDeveloperPrincipalDATA(principal),command=encodeOriginalDeveloperCommandDATA(c,at);
 if(encoded.principalOriginal!==utf8(pRaw)||command.commandOriginal!==utf8(cRaw)||principal.account!==association.account||principal.deviceId!==association.deviceId||BigInt(capture.expiresAtMs)>BigInt(principal.expiresMS)||BigInt(capture.expiresAtMs)>BigInt(c.ExpiresMS))fail('IDE_CONTROL_CAPTURE_ORIGINAL_BINDING');
 const r=capture.review;exact(r,Object.hasOwn(r??{},'publisher')?['reviewId','account','networkId','command','publisher']:['reviewId','account','networkId','command']);
 if(typeof r.reviewId!=='string'||!r.reviewId.length||Buffer.byteLength(r.reviewId)>256||r.account!==principal.account||r.networkId!==networkId||canonical(r.command)!==canonical(c))fail('IDE_CONTROL_CAPTURE_REVIEW_BINDING');
 if(!encodeOriginalProjectControlRequestDATA(networkId,walletCodeIdentity,encoded.principalOriginal,command.commandOriginal).equals(request))fail('IDE_CONTROL_CAPTURE_REQUEST_BINDING');
 if(c.Action==='project.publisher'&&!c.Revoke){const k=r.publisher;exact(k,['Account','ProjectID','PublisherID','KeyRole','PublicSHA256','RegistrationRef','ExpiresMS']);if(k.Account!==c.SubjectAccount||k.ProjectID!==c.ProjectID||k.PublisherID!==c.PublisherID||k.KeyRole!=='ide-artifact-publisher'||k.PublicSHA256!==c.PublicOriginalSHA256||typeof k.RegistrationRef!=='string'||!k.RegistrationRef.length||typeof k.ExpiresMS!=='string'||!/^[1-9][0-9]*$/.test(k.ExpiresMS)||BigInt(k.ExpiresMS)<BigInt(c.GrantExpiresMS))fail('IDE_CONTROL_CAPTURE_PUBLISHER');}else if(Object.hasOwn(r,'publisher'))fail('IDE_CONTROL_CAPTURE_PUBLISHER');
 return Object.freeze({captureSHA256:sha(canonical(capture)),principalSHA256:encoded.principalSHA256,commandSHA256:command.commandSHA256,expiresAtMs:Number(capture.expiresAtMs),dataOnly:true,authorized:false});
}
