// Finance deployment leases are NOT endpoint authority or Product Session tokens.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
export const DOMAIN='YNX_FINANCE_DEPLOYMENT_LEASE_V2\n';
export const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=c=>{throw new Error('FINANCE_LEASE_'+c);};
export const need=(v,c)=>{if(!v)fail(c);};
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const ident=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{7,95}$/.test(v);
export function exact(v,keys){need(v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'FIELDS');}
function json(v,depth=0){
 need(depth<24,'DEPTH');if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string'){for(let i=0;i<v.length;i++){const n=v.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const m=v.charCodeAt(++i);need(m>=0xdc00&&m<=0xdfff,'UNICODE');}else need(n<0xdc00||n>0xdfff,'UNICODE');}return v;}
 if(typeof v==='number'){need(Number.isSafeInteger(v)&&!Object.is(v,-0),'INTEGER');return v;}
 if(Array.isArray(v)){need(Reflect.ownKeys(v).length===v.length+1,'ARRAY');return Array.from({length:v.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(v,''+i);need(d&&Object.hasOwn(d,'value')&&d.enumerable,'ACCESSOR');return json(d.value,depth+1);});}
 need(v&&Object.getPrototypeOf(v)===Object.prototype,'JSON');const o=Object.create(null);need(Reflect.ownKeys(v).length===Object.keys(v).length,'FIELDS');
 for(const k of Object.keys(v).sort()){json(k);const d=Object.getOwnPropertyDescriptor(v,k);need(d.enumerable&&Object.hasOwn(d,'value'),'ACCESSOR');o[k]=json(d.value,depth+1);}return o;
}
export function canonical(v){const s=JSON.stringify(json(v));need(Buffer.byteLength(s)<=262144,'SIZE');return s;}
// JSON.parse alone discards duplicate keys before canonicalization. Reject them
// after syntax validation, including differently escaped spellings of one key.
export function parseDocument(text){
 need(typeof text==='string'&&Buffer.byteLength(text)<=262144,'SIZE');const value=JSON.parse(text),stack=[];
 for(const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g)){
  const t=token[0],top=stack.at(-1);
  if(t==='{')stack.push({object:true,keys:new Set(),key:true});
  else if(t==='[')stack.push({object:false});
  else if(t==='}'||t===']')stack.pop();
  else if(t===','&&top?.object)top.key=true;
  else if(t.startsWith('"')&&top?.object&&top.key){const k=JSON.parse(t);need(!top.keys.has(k),'DUPLICATE_KEY');top.keys.add(k);top.key=false;}
 }
 return value;
}
const copy=v=>JSON.parse(canonical(v));
export function payload(lease){const v=copy(lease);delete v.signature;return canonical(v);}
function timestamp(v){need(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v),'TIME');const t=Date.parse(v);need(Number.isFinite(t)&&new Date(t).toISOString()===v,'TIME');return t;}
function raw64(v,n){need(typeof v==='string'&&/^[A-Za-z0-9_-]+$/.test(v),'ENCODING');const b=Buffer.from(v,'base64url');need(b.length===n&&b.toString('base64url')===v,'ENCODING');return b;}
export function root(input){const r=copy(input);exact(r,['schema','mode','rootVersion','keys','maxLeaseSeconds']);need(r.schema==='ynx-finance-release-trust/v2'&&['production','fixture'].includes(r.mode),'ROOT');need(Number.isSafeInteger(r.rootVersion)&&r.rootVersion>0&&Number.isSafeInteger(r.maxLeaseSeconds)&&r.maxLeaseSeconds>0&&r.maxLeaseSeconds<=3600,'ROOT');need(Array.isArray(r.keys)&&r.keys.length<=16&&new Set(r.keys.map(k=>k.keyId)).size===r.keys.length,'KEYS');for(const k of r.keys){exact(k,['keyId','algorithm','publicKey','notBefore','notAfter','revoked']);need(ident(k.keyId)&&k.algorithm==='Ed25519'&&typeof k.revoked==='boolean','KEY');raw64(k.publicKey,32);need(timestamp(k.notAfter)>timestamp(k.notBefore),'KEY_TIME');}return r;}
function identity(x){exact(x,['source','tree','releaseId','artifactSha256','manifestSha256','sbomSha256','binarySha256','envSha256']);need(hex(x.source,40)&&hex(x.tree,40)&&ident(x.releaseId),'SOURCE');for(const k of ['artifactSha256','manifestSha256','sbomSha256','binarySha256','envSha256'])need(hex(x[k],64),'HASH');}
function file(x,optional=false){exact(x,['absent','sha256','uid','gid','mode']);need(typeof x.absent==='boolean'&&Number.isSafeInteger(x.uid)&&x.uid>=0&&Number.isSafeInteger(x.gid)&&x.gid>=0&&Number.isSafeInteger(x.mode)&&x.mode>=0&&x.mode<=511,'FILE');need((optional&&x.absent&&x.sha256===null)||(!x.absent&&hex(x.sha256,64)),'FILE_HASH');}
export function policy(input,trust,{nowMs,host,minimumRootVersion=0}={}){
 const r=root(trust),l=copy(input);need(Number.isSafeInteger(nowMs)&&nowMs>=0,'TRUSTED_CLOCK_REQUIRED');need(Number.isSafeInteger(minimumRootVersion)&&minimumRootVersion>=0,'ROOT_FLOOR');
 exact(l,['schema','mode','leaseId','nonce','operation','recoveryOf','issuedAt','notBefore','expiresAt','singleUse','retryAllowed','target','candidate','baseline','rollback','admission','verification','rollbackVerification','tooling','signature']);
 need(l.schema==='ynx-finance-deployment-lease/v2'&&l.mode===r.mode&&['deploy','rollback'].includes(l.operation),'SCHEMA');need((l.recoveryOf===null||(l.operation==='rollback'&&ident(l.recoveryOf)&&l.recoveryOf!==l.leaseId)),'RECOVERY');need(ident(l.leaseId)&&hex(l.nonce,64)&&l.singleUse===true&&l.retryAllowed===false,'SINGLE_USE');
 const issued=timestamp(l.issuedAt),start=timestamp(l.notBefore),end=timestamp(l.expiresAt);need(issued<=start&&start<end&&end-issued<=r.maxLeaseSeconds*1000&&nowMs>=start&&nowMs<end&&issued<=nowMs,'EXPIRED_OR_FUTURE');
 exact(l.target,['host','machineIdSha256','sshHostFingerprint','service']);need(l.target.host===(r.mode==='production'?'43.153.202.237':'fixture.invalid')&&l.target.service==='ynx-finance.service'&&hex(l.target.machineIdSha256,64)&&/^SHA256:[A-Za-z0-9+/]{43}$/.test(l.target.sshHostFingerprint),'TARGET');if(host)need(canonical(host)===canonical(l.target),'WRONG_HOST');
 identity(l.candidate);identity(l.rollback);
 exact(l.baseline,['currentRelease','binary','env','unit','caddy','caddyFiles','dropins','state','active','pid','nrestarts']);need(typeof l.baseline.currentRelease==='string'&&/^\/opt\/ynx\/(?:releases\/finance(?:-v2)?\/)[a-zA-Z0-9_./-]+$/.test(l.baseline.currentRelease)&&!l.baseline.currentRelease.includes('..'),'BASELINE_PATH');for(const k of ['binary','env','unit','caddy'])file(l.baseline[k]);file(l.baseline.state,true);need(l.baseline.binary.sha256===l.rollback.binarySha256&&l.baseline.env.sha256===l.rollback.envSha256,'ROLLBACK_BINDING');need(typeof l.baseline.active==='boolean'&&Number.isSafeInteger(l.baseline.pid)&&((l.baseline.active&&l.baseline.pid>0)||(!l.baseline.active&&l.baseline.pid===0&&l.operation==='rollback'))&&l.baseline.nrestarts===0,'PROCESS');
 need(Array.isArray(l.baseline.caddyFiles)&&l.baseline.caddyFiles.length<=128,'CADDY_FILES');const cf=new Set();for(const x of l.baseline.caddyFiles){exact(x,['path','file']);need(/^\/etc\/caddy\/[a-zA-Z0-9_./-]+$/.test(x.path)&&!x.path.includes('..')&&x.path!=='/etc/caddy/Caddyfile'&&!cf.has(x.path),'CADDY_PATH');cf.add(x.path);file(x.file);}
 need(Array.isArray(l.baseline.dropins)&&l.baseline.dropins.length<=16,'DROPINS');const paths=new Set();for(const d of l.baseline.dropins){exact(d,['name','file']);need(/^[a-zA-Z0-9_.-]+\.conf$/.test(d.name)&&!paths.has(d.name),'DROPIN');paths.add(d.name);file(d.file);}
 exact(l.admission,['url','bodySha256','status','configurationSha256','receiptSha256']);need(l.admission.url==='https://finance.ynxweb4.com/'&&l.admission.status===503&&hex(l.admission.bodySha256,64)&&hex(l.admission.receiptSha256,64)&&l.admission.configurationSha256===l.baseline.caddy.sha256,'ADMISSION');
 exact(l.verification,['url','versionSha256','source','stateUnchanged']);need(l.verification.url==='http://127.0.0.1:6483/version'&&hex(l.verification.versionSha256,64)&&l.verification.source===l.candidate.source&&l.verification.stateUnchanged===true,'VERIFY');
 exact(l.rollbackVerification,['url','versionSha256','source','stateUnchanged']);need(l.rollbackVerification.url==='http://127.0.0.1:6483/version'&&hex(l.rollbackVerification.versionSha256,64)&&l.rollbackVerification.source===l.rollback.source&&l.rollbackVerification.stateUnchanged===true,'ROLLBACK_VERIFY');
 exact(l.tooling,['verifierSha256','executorSha256']);need(hex(l.tooling.verifierSha256,64)&&hex(l.tooling.executorSha256,64),'TOOLING');
 exact(l.signature,['algorithm','keyId','rootVersion','payloadSha256','value']);need(l.signature.algorithm==='Ed25519'&&ident(l.signature.keyId)&&l.signature.rootVersion===r.rootVersion&&r.rootVersion>=minimumRootVersion&&hex(l.signature.payloadSha256,64),'SIGNATURE_POLICY');raw64(l.signature.value,64);
 const key=r.keys.find(k=>k.keyId===l.signature.keyId);need(key&&!key.revoked,'UNKNOWN_OR_REVOKED_KEY');need(issued>=timestamp(key.notBefore)&&end<=timestamp(key.notAfter)&&nowMs>=timestamp(key.notBefore)&&nowMs<timestamp(key.notAfter),'KEY_WINDOW');need(sha(payload(l))===l.signature.payloadSha256,'DIGEST');return {lease:l,trust:r,key};
}
// keyId/rootVersion must be bound by the signature, although the signature object
// is omitted from the payload digest. Domain + these fields prevents key relabeling.
export function signingBytes(l){return Buffer.from(DOMAIN+canonical({algorithm:l.signature.algorithm,keyId:l.signature.keyId,rootVersion:l.signature.rootVersion,payload:payload(l)}));}
export function verifyLease(l,r,opts){const v=policy(l,r,opts);const publicKey=createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:v.key.publicKey},format:'jwk'});need(verify(null,signingBytes(v.lease),publicKey,raw64(v.lease.signature.value,64)),'BAD_SIGNATURE');return v.lease;}
export function draftLease(l,{keyId,rootVersion}){const d=copy(l);d.signature={algorithm:'Ed25519',keyId,rootVersion,payloadSha256:'0'.repeat(64),value:Buffer.alloc(64).toString('base64url')};d.signature.payloadSha256=sha(payload(d));return d;}
export function issueLease(l,r,{approvedPayloadSha256,privateKeyFile,nowMs,...context}){
 const v=policy(l,r,{...context,nowMs});need(v.lease.signature.payloadSha256===approvedPayloadSha256,'REVIEW_REQUIRED');need(typeof privateKeyFile==='string'&&path.isAbsolute(privateKeyFile),'KEY_FILE_REQUIRED');
 // Every policy/approval guard precedes opening the external private credential.
 const fd=fs.openSync(privateKeyFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let key;try{const st=fs.fstatSync(fd);need(st.isFile()&&st.uid===process.getuid()&&(st.mode&511)===384&&st.nlink===1&&st.size<=16384,'KEY_FILE_PERMISSIONS');key=createPrivateKey(fs.readFileSync(fd));need(key.asymmetricKeyType==='ed25519'&&createPublicKey(key).export({format:'jwk'}).x===v.key.publicKey,'SIGNER_MISMATCH');}finally{fs.closeSync(fd);}
 v.lease.signature.value=sign(null,signingBytes(v.lease),key).toString('base64url');return verifyLease(v.lease,r,{...context,nowMs});
}
