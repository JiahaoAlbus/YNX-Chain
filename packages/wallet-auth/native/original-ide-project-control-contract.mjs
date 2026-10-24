// Auth-owned dedicated production wire contract, not a signer/provider or a
// Source grant. Only original protected Native capture may issue it after an
// explicit review. Root/role admission and durable server ACL/current remain
// separately required; no default key or trusted snapshot is installed here.
import{encodeFields,VERSION,SUITE}from'@ynx/batch-v01-candidate';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{encodeOriginalDeveloperPrincipalDATA}from'./original-developer-principal-data.mjs';
import{verifyPQRegisteredMemberData}from'../src/pq-registered-member.js';
import{evmAddressFromYNX}from'../src/crypto.js';
export const ORIGINAL_PROJECT_CONTROL_PURPOSE='IDE-PROJECT-CONTROL';
export const ORIGINAL_PROJECT_CONTROL_FRAME='YNX-IDE-PROJECT-CONTROL-APPROVAL/v1';
export const ORIGINAL_PROJECT_CONTROL_SOURCE_PURPOSE='ide-project-control-authority-v1';
export const ORIGINAL_PUBLISHER_REGISTRATION_PURPOSE='IDE-PUBLISHER-REGISTRATION';
export const ORIGINAL_PUBLISHER_REGISTRATION_FRAME='YNX-IDE-PUBLISHER-REGISTRATION/v1';
export const ORIGINAL_PUBLISHER_CUSTODIAN_PURPOSE='AUTH-PUBLISHER-REGISTRATION';
export const ORIGINAL_PUBLISHER_CUSTODIAN_FRAME='YNX-AUTH-PROTECTED-PUBLISHER-REGISTRATION/v1';
const fail=code=>{throw Object.assign(Error(code),{code});};
const commandFields=['RequestID','Action','ProjectID','TeamID','SubjectAccount','PublisherID','RuntimeOrigin','ExpectedRevision','GrantExpiresMS','Read','Publish','Runtime','Revoke','ExpiresMS','PublicOriginalSHA256'];
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('IDE_CONTROL_SCHEMA');const d=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(d);if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('IDE_CONTROL_SCHEMA');return v;}
function text(v,empty=false){if(typeof v!=='string'||!v.isWellFormed()||(!empty&&!v.length)||Buffer.byteLength(v)>256||/[\s\x00-\x1f\x7f]/u.test(v))fail('IDE_CONTROL_TEXT');return v;}
function decimal(v,max=9223372036854775807n){if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v)||BigInt(v)>max)fail('IDE_CONTROL_DECIMAL');return BigInt(v);}
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function memberBytes(value){if(typeof value!=='string'||!value.length||value.length>349526||!/^[A-Za-z0-9_-]+$/.test(value))fail('IDE_CONTROL_MEMBER');const raw=Buffer.from(value,'base64url');if(!raw.length||raw.length>262144||raw.toString('base64url')!==value)fail('IDE_CONTROL_MEMBER');return raw;}
function goString(v){return JSON.stringify(v).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
export function encodeOriginalDeveloperCommandDATA(input,atMs){
 const c=exact(input,commandFields);if(!Number.isSafeInteger(atMs)||atMs<0)fail('IDE_CONTROL_TIME');
 for(const k of commandFields.slice(0,7))text(c[k],!['RequestID','Action'].includes(k));text(c.PublicOriginalSHA256,true);
 for(const k of ['Read','Publish','Runtime','Revoke'])if(typeof c[k]!=='boolean')fail('IDE_CONTROL_SCHEMA');
 const rev=decimal(c.ExpectedRevision,18446744073709551615n),grant=decimal(c.GrantExpiresMS),expires=decimal(c.ExpiresMS),now=BigInt(atMs);
 if(rev>(1n<<62n)||expires<=now||expires-now>300000n)fail('IDE_CONTROL_EXPIRED_OR_REVISION');
 text(c.Action.startsWith('team.')?c.TeamID:c.ProjectID);
 const empty=(...ks)=>ks.every(k=>c[k]===''),rights=c.Read||c.Publish||c.Runtime;
 if(['team.member','project.member','project.team','project.publisher'].includes(c.Action)?(c.Revoke?grant!==0n:grant<=now):grant!==0n)fail('IDE_CONTROL_GRANT_WINDOW');
 let ok=false;switch(c.Action){
 case'project.create':case'team.create':ok=rev===0n&&empty(c.Action==='project.create'?'TeamID':'ProjectID','SubjectAccount','PublisherID','RuntimeOrigin','PublicOriginalSHA256')&&!rights&&!c.Revoke;break;
 case'team.member':ok=!!c.SubjectAccount&&empty('ProjectID','PublisherID','RuntimeOrigin','PublicOriginalSHA256')&&!rights;break;
 case'project.member':ok=!!c.SubjectAccount&&empty('TeamID','PublisherID','RuntimeOrigin','PublicOriginalSHA256')&&(c.Revoke||rights);break;
 case'project.team':ok=!!c.TeamID&&empty('SubjectAccount','PublisherID','RuntimeOrigin','PublicOriginalSHA256')&&(c.Revoke||rights);break;
 case'project.origin':{let u;try{u=new URL(c.RuntimeOrigin)}catch{}ok=rev>0n&&u?.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.origin===c.RuntimeOrigin&&empty('TeamID','SubjectAccount','PublisherID','PublicOriginalSHA256')&&!rights&&!c.Revoke;break;}
 case'project.revoke':case'team.revoke':ok=rev>0n&&c.Revoke&&!rights&&empty('SubjectAccount','PublisherID','PublicOriginalSHA256','RuntimeOrigin',c.Action==='project.revoke'?'TeamID':'ProjectID');break;
 case'project.publisher':ok=!!c.SubjectAccount&&!!c.PublisherID&&hex(c.PublicOriginalSHA256)&&empty('TeamID','RuntimeOrigin')&&!rights;break;
 }if(!ok)fail('IDE_CONTROL_COMMAND');
 // EXACT existing Go Command field order and json.Marshal escaping; display
 // decimal strings become original numeric tokens, never JS Number values.
 const raw='{'+commandFields.map(k=>goString(k)+':'+(['ExpectedRevision','GrantExpiresMS','ExpiresMS'].includes(k)?c[k]:typeof c[k]==='boolean'?String(c[k]):goString(c[k]))).join(',')+'}';
 return Object.freeze({commandOriginal:raw,commandSHA256:sha(raw),dataOnly:true,authorized:false});
}
const decisionFields=['version','decision','requestId','principalSHA256','commandSHA256','reviewId','nonce','confirmationRef','revocationRef','issuedAtMs','expiresAtMs'];
function decision(raw,p,c,command,at){let b;try{b=JSON.parse(raw)}catch{fail('IDE_CONTROL_CANONICAL')};exact(b,decisionFields);if(canonical(b)!==raw||b.version!=='YNX-IDE-PROJECT-CONTROL-DECISION/v1'||!['approve','reject'].includes(b.decision)||b.requestId!==command.RequestID||b.principalSHA256!==p.principalSHA256||b.commandSHA256!==c.commandSHA256)fail('IDE_CONTROL_DECISION_BINDING');
 for(const k of ['reviewId','confirmationRef','revocationRef'])text(b[k]);if(typeof b.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(b.nonce)||Buffer.from(b.nonce,'base64url').length!==32||Buffer.from(b.nonce,'base64url').toString('base64url')!==b.nonce||Buffer.from(b.nonce,'base64url').every(n=>n===0))fail('IDE_CONTROL_NONCE');
 if(!Number.isSafeInteger(b.issuedAtMs)||!Number.isSafeInteger(b.expiresAtMs)||b.issuedAtMs<0||at<b.issuedAtMs||at>=b.expiresAtMs||b.expiresAtMs<=b.issuedAtMs||b.expiresAtMs-b.issuedAtMs>30000||BigInt(b.expiresAtMs)>BigInt(command.ExpiresMS)||BigInt(b.expiresAtMs)>BigInt(p.principalOriginal.match(/"ExpiresMS":([0-9]+)\}$/)[1]))fail('IDE_CONTROL_DECISION_EXPIRED');return b;
}
function binding(b){exact(b,['networkId','owner','keyVersion','executionHeight','callerIdentity','sourceCurrentRef']);if(!hex(b.networkId)||!/^0x[a-f0-9]{40}$/.test(b.owner)||decimal(b.keyVersion,18446744073709551615n)===0n)fail('IDE_CONTROL_CONTEXT');decimal(b.executionHeight,18446744073709551615n);text(b.callerIdentity);text(b.sourceCurrentRef);return b;}
export function encodeOriginalProjectControlApprovalDATA(context,principal,command,decisionOriginal){
 binding(context);const p=encodeOriginalDeveloperPrincipalDATA(principal);let body;try{body=JSON.parse(decisionOriginal)}catch{fail('IDE_CONTROL_CANONICAL')};const c=encodeOriginalDeveloperCommandDATA(command,body.issuedAtMs);decision(decisionOriginal,p,c,command,body.issuedAtMs);
 if(context.owner!==evmAddressFromYNX(principal.account)||context.sourceCurrentRef!==principal.currentRef)fail('IDE_CONTROL_PRINCIPAL_OWNER');
 return encodeFields([ORIGINAL_PROJECT_CONTROL_FRAME,VERSION,SUITE,ORIGINAL_PROJECT_CONTROL_PURPOSE,Buffer.from(context.networkId,'hex'),context.owner,context.keyVersion,context.executionHeight,context.callerIdentity,context.sourceCurrentRef,p.principalOriginal,c.commandOriginal,decisionOriginal]);
}
export function canonicalOriginalProjectControlApprovalDATA(context,principal,command,decisionOriginal,memberOriginal){
 encodeOriginalProjectControlApprovalDATA(context,principal,command,decisionOriginal);memberBytes(memberOriginal);
 return canonical({version:ORIGINAL_PROJECT_CONTROL_FRAME,binding:context,principalOriginal:encodeOriginalDeveloperPrincipalDATA(principal).principalOriginal,commandOriginal:encodeOriginalDeveloperCommandDATA(command,JSON.parse(decisionOriginal).issuedAtMs).commandOriginal,decisionOriginal,memberOriginal});
}
export function verifyOriginalProjectControlApprovalDATA(raw,registeredSender,principal,command,expected,at){
 exact(expected,['nonce','callerIdentity','sourceCurrentRef']);if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>393216)fail('IDE_CONTROL_ENVELOPE');let e;try{e=JSON.parse(raw)}catch{fail('IDE_CONTROL_CANONICAL')};exact(e,['version','binding','principalOriginal','commandOriginal','decisionOriginal','memberOriginal']);if(canonical(e)!==raw||e.version!==ORIGINAL_PROJECT_CONTROL_FRAME)fail('IDE_CONTROL_ENVELOPE');const member=memberBytes(e.memberOriginal);
 const p=encodeOriginalDeveloperPrincipalDATA(principal),c=encodeOriginalDeveloperCommandDATA(command,at),b=decision(e.decisionOriginal,p,c,command,at);binding(e.binding);
 if(e.principalOriginal!==p.principalOriginal||e.commandOriginal!==c.commandOriginal||b.nonce!==expected.nonce||e.binding.callerIdentity!==expected.callerIdentity||e.binding.sourceCurrentRef!==expected.sourceCurrentRef)fail('IDE_CONTROL_ORIGINAL_CHANGED');
 const signed=verifyPQRegisteredMemberData(registeredSender,member,{chainId:e.binding.networkId,owner:e.binding.owner,keyVersion:e.binding.keyVersion,executionHeight:e.binding.executionHeight,purpose:ORIGINAL_PROJECT_CONTROL_PURPOSE,message:encodeOriginalProjectControlApprovalDATA(e.binding,principal,command,e.decisionOriginal)});
 if(signed.memberCount!==1||signed.memberIndex!==0)fail('IDE_CONTROL_N1_REQUIRED');
 return Object.freeze({principalSHA256:p.principalSHA256,bindingSHA256:c.commandSHA256,proofSHA256:sha(raw),confirmationRef:b.confirmationRef,revocationRef:b.revocationRef,requestId:b.requestId,nonce:b.nonce,decision:b.decision,expiresMS:b.expiresAtMs,readyForSourceVerification:b.decision==='approve',signatureVerified:true,dataOnly:true,authorized:false,committed:false,nativeAdmission:false});
}
