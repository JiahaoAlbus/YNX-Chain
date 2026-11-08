// Canonical Source scope DATA only. No Root, listener, key, callback/provider,
// Native brand or registration row is constructed by this module.
import{types}from'node:util';import path from'node:path';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
export const TASK_READ_RECEIVER_SOURCE_PURPOSE='task-read-receiver-source-v1';
export const TASK_READ_RECEIVER_SOURCE_SELECTION_KEY='taskReadReceiverV1';
export const TASK_READ_RECEIVER_SOURCE_OPERATIONS=Object.freeze(['task-read.receiver.listen']);
export const TASK_READ_RECEIVER_SERVICE='ynx-ai-original-task-read-v1';
export const TASK_READ_RECEIVER_PATHS=Object.freeze(['/internal/ai/original-task-read/input','/internal/ai/original-task-read/execute','/internal/ai/original-task-read/query']);
export const TASK_READ_RECEIVER_SCOPE_FIELDS=Object.freeze(['version','networkId','subjectOwner','sourceId','instanceId','authority','realm','tenant','sourceVersion','sourceProjection','receiverResource','namespace','service','local','peer','socketParent','socketLeaf','routes','httpLimits','issuedMS','expiresMS']);
const fail=c=>{throw Object.assign(Error(c),{code:c})};
export function receiverExactDATA(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('TASK_RECEIVER_SCHEMA');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))fail('TASK_RECEIVER_SCHEMA')}
const exact=receiverExactDATA,token=v=>typeof v==='string'&&/^[A-Za-z0-9._:/-]{1,256}$/.test(v),hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),owner=v=>typeof v==='string'&&/^0x[a-f0-9]{40}$/.test(v),integer=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
function decimal(v,positive=false){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n||positive&&v==='0')fail('TASK_RECEIVER_U64');return BigInt(v)}
function absolute(v){return typeof v==='string'&&v.isWellFormed()&&Buffer.byteLength(v)<=4096&&path.posix.isAbsolute(v)&&path.posix.normalize(v)===v&&v!=='/'&&!/[\x00-\x1f\x7f\\]/.test(v)}
function process(v){exact(v,['pid','uid','gid','start','image']);exact(v.image,['path','bytes','sha256']);if(!integer(v.pid,1,2147483647)||!integer(v.uid,1,4294967295)||!integer(v.gid,0,4294967295)||typeof v.start!=='string'||v.start.length<1||Buffer.byteLength(v.start)>128||!v.start.isWellFormed()||/[\x00-\x20\x7f]/.test(v.start)||!absolute(v.image.path)||!integer(v.image.bytes,1,268435456)||!hex(v.image.sha256))fail('TASK_RECEIVER_PROCESS')}
function array(v,n){if(!v||types.isProxy(v)||!Array.isArray(v)||v.length!==n)fail('TASK_RECEIVER_ROUTES');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==n+1||Array.from({length:n},(_,i)=>ds[i]).some(d=>!d||!Object.hasOwn(d,'value')))fail('TASK_RECEIVER_ROUTES')}
export function inspectOriginalTaskReadReceiverScopeV1DATA(s,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs){
 exact(s,TASK_READ_RECEIVER_SCOPE_FIELDS);exact(association,['account','clientId','productId','platform','applicationId','deviceId']);exact(s.sourceVersion,['authority','revision','policyRevision']);exact(s.sourceProjection,['bytes','sha256']);
 if(s.version!==1||!hex(networkId)||s.networkId!==networkId||!owner(subjectOwner)||s.subjectOwner!==subjectOwner||association.account!==subjectOwner||s.sourceId!==sourceId||s.instanceId!==instanceId||![s.sourceId,s.instanceId,s.authority,s.realm,s.tenant,s.receiverResource,s.namespace].every(token)||s.sourceVersion.authority!==s.authority||s.service!==TASK_READ_RECEIVER_SERVICE)fail('TASK_RECEIVER_IDENTITY');
 decimal(s.sourceVersion.revision,true);decimal(s.sourceVersion.policyRevision,true);if(!integer(s.sourceProjection.bytes,1,1048576)||!hex(s.sourceProjection.sha256))fail('TASK_RECEIVER_PROJECTION_BINDING');
 if(Object.values(association).some(v=>typeof v!=='string'||!v||Buffer.byteLength(v)>512)||!['linux','macos'].includes(association.platform))fail('TASK_RECEIVER_ASSOCIATION');
 process(s.local);process(s.peer);exact(s.socketParent,['path','device','inode','uid','gid','mode']);decimal(s.socketParent.device,true);decimal(s.socketParent.inode,true);
 if(!absolute(s.socketParent.path)||s.socketParent.uid!==s.local.uid||s.socketParent.gid!==s.local.gid||s.socketParent.mode!==448||typeof s.socketLeaf!=='string'||!s.socketLeaf||!s.socketLeaf.isWellFormed()||['.','..'].includes(s.socketLeaf)||path.posix.basename(s.socketLeaf)!==s.socketLeaf||/[\x00-\x1f\x7f\\]/.test(s.socketLeaf)||Buffer.byteLength(path.posix.join(s.socketParent.path,s.socketLeaf))>103)fail('TASK_RECEIVER_ENDPOINT');
 array(s.routes,3);for(let i=0;i<3;i++){const r=s.routes[i];exact(r,['method','path','maxBodyBytes','timeoutMS']);if(r.method!=='POST'||r.path!==TASK_READ_RECEIVER_PATHS[i]||!integer(r.maxBodyBytes,1,1048576)||!integer(r.timeoutMS,1,60000))fail('TASK_RECEIVER_FINITE_ROUTES')}
 exact(s.httpLimits,['maxHeaderBytes','readHeaderTimeoutMS','readTimeoutMS','writeTimeoutMS','idleTimeoutMS']);if(!integer(s.httpLimits.maxHeaderBytes,1,65536)||['readHeaderTimeoutMS','readTimeoutMS','writeTimeoutMS','idleTimeoutMS'].some(k=>!integer(s.httpLimits[k],1,60000)))fail('TASK_RECEIVER_HTTP_LIMITS');
 const from=decimal(s.issuedMS,true),end=decimal(s.expiresMS,true);if(end>BigInt(Number.MAX_SAFE_INTEGER)||end<=from||!integer(issuedAtMs,0,Number.MAX_SAFE_INTEGER)||!integer(expiresAtMs,issuedAtMs+1,Number.MAX_SAFE_INTEGER)||!integer(atMs,issuedAtMs,expiresAtMs-1)||BigInt(atMs)<from||BigInt(atMs)>=end)fail('TASK_RECEIVER_WINDOW');
 const scopeOriginal=canonical(s);if(Buffer.byteLength(scopeOriginal)>32768)fail('TASK_RECEIVER_CAPACITY');return Object.freeze({scopeOriginal,scopeHead:sha(scopeOriginal),effectExpiresAtMs:Math.min(expiresAtMs,Number(end)),dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,listenCapability:false});
}
// Projection of Auth's exact private record, not a new wire/authority parser.
// Never parse/re-marshal or replace original Go JSON held by Auth's FD custody.
// uint64 Device/Inode must cross as decimal strings, or exact safe numeric
// metadata; an already rounded JSON number is rejected, never repaired.
export function projectOriginalTaskReadReceiverRegistrationV1DATA(r){
 exact(r,['Version','Resource','Authority','Realm','Tenant','Namespace','SourceVersion','Local','Peer','SocketParent','SocketLeaf','Routes','ReadHeaderTimeoutMS','ReadTimeoutMS','WriteTimeoutMS','IdleTimeoutMS','MaxHeaderBytes','IssuedMS','ExpiresMS']);
 if(r.Version!=='AUTH-ORIGINAL-TASK-READ-RECEIVER/private-v1')fail('TASK_RECEIVER_REGISTRATION_VERSION');exact(r.SourceVersion,['Authority','Revision','PolicyRevision']);
 const proc=p=>{exact(p,['PID','UID','GID','Start','Image']);exact(p.Image,['Path','Bytes','SHA256']);return{pid:p.PID,uid:p.UID,gid:p.GID,start:p.Start,image:{path:p.Image.Path,bytes:p.Image.Bytes,sha256:p.Image.SHA256}}};
 exact(r.SocketParent,['Path','Device','Inode','UID','GID','Mode']);array(r.Routes,3);const routes=r.Routes.map(v=>{exact(v,['Method','Path','MaxBodyBytes','TimeoutMS']);return{method:v.Method,path:v.Path,maxBodyBytes:v.MaxBodyBytes,timeoutMS:v.TimeoutMS}});
 const u64=v=>typeof v==='string'?(decimal(v,true),v):Number.isSafeInteger(v)&&v>0?String(v):fail('TASK_RECEIVER_LOSSY_U64');
 return{authority:r.Authority,realm:r.Realm,tenant:r.Tenant,sourceVersion:{authority:r.SourceVersion.Authority,revision:r.SourceVersion.Revision,policyRevision:r.SourceVersion.PolicyRevision},receiverResource:r.Resource,namespace:r.Namespace,service:TASK_READ_RECEIVER_SERVICE,local:proc(r.Local),peer:proc(r.Peer),socketParent:{path:r.SocketParent.Path,device:u64(r.SocketParent.Device),inode:u64(r.SocketParent.Inode),uid:r.SocketParent.UID,gid:r.SocketParent.GID,mode:r.SocketParent.Mode},socketLeaf:r.SocketLeaf,routes,httpLimits:{maxHeaderBytes:r.MaxHeaderBytes,readHeaderTimeoutMS:r.ReadHeaderTimeoutMS,readTimeoutMS:r.ReadTimeoutMS,writeTimeoutMS:r.WriteTimeoutMS,idleTimeoutMS:r.IdleTimeoutMS},issuedMS:r.IssuedMS,expiresMS:r.ExpiresMS};
}
