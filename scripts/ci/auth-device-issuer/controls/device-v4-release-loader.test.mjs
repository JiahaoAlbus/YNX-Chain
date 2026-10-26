import test from'node:test';import assert from'node:assert/strict';import * as realFS from'node:fs';import{pathToFileURL}from'node:url';
const root=process.env.AUTH_DEVICE_SCOPE_STAGE,load=p=>import(pathToFileURL(root+'/'+p));
const{full}=await import(pathToFileURL(process.env.AUTH_DEVICE_ISSUER_PUBLIC_FIXTURE));
const{canonical,sha}=await load('native/original-auth-identity-source-verifier.mjs');
const{encodeOriginalAuthSourceStatementV2:message,inspectOriginalProductDeviceV4IssuanceBodyDATA:inspect}=await load('native/original-auth-identity-source-v2-verifier.mjs');
let approvalRaw,views,opened=[],closed=[],reads=0;
const fileStat=()=>({dev:1,ino:10,uid:0,gid:0,mode:0o100444,nlink:1,size:Buffer.byteLength(approvalRaw),mtimeMs:1,ctimeMs:1,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false});
const dirStat={dev:1,ino:1,uid:0,gid:0,mode:0o40755,nlink:2,size:0,mtimeMs:1,ctimeMs:1,isFile:()=>false,isDirectory:()=>true,isSymbolicLink:()=>false};
// PUBLIC original-approval file boundary only. Any attempted role-key path is
// a hard failure; the real release loader, not a modeled copy, is executed.
const{default:ignoredDefault,...fsNamed}=realFS;
test.mock.module('node:fs',{namedExports:{...fsNamed,realpathSync:p=>p,lstatSync:p=>p==='/PUBLIC/approval'?fileStat():dirStat,fstatSync:fd=>{assert.equal(fd,123);return fileStat();},openSync:p=>{opened.push(p);if(p!=='/PUBLIC/approval')throw Error('PRIVATE_KEY_OPEN_FORBIDDEN_IN_PUBLIC_TEST');return 123;},readFileSync:fd=>{assert.equal(fd,123);reads++;return approvalRaw;},closeSync:fd=>{assert.equal(fd,123);closed.push(fd);}}});
test.mock.module(pathToFileURL(root+'/native/original-ide-auth-proof-dispatch.mjs').href,{namedExports:{fetchOriginalNativeAuthorization:async(_node,owner)=>{const value=Object.values(views).find(v=>v.owner===owner);assert.ok(value);return value;}}});
const{loadReleaseSelectedOriginalSourceIssuanceV2:acquire}=await load('src/original-auth-source-issuance-v2.js');
const{loadReleaseSelectedOriginalSourceV2:acquireCurrent}=await load('src/original-auth-source-current-v2.js');
function entry(change){const f=full();for(const v of Object.values(f.registrations))v.activeRevision='1';change(f);views=f.registrations;
const binding={networkId:views.root.networkId,owner:f.e.profileOwner,keyVersion:'1',executionHeight:'5'},bodyRaw=canonical(f.p),plan={role:'profile',rootRaw:f.rootRaw,enrollmentRaw:f.enrollmentRaw,bodyRaw,policy:f.policy,binding,approvalDigest:'',journalPath:'/PUBLIC/device-issuer'};
approvalRaw=canonical({version:'YNX-ORIGINAL-SOURCE-ISSUANCE-APPROVAL/v1',role:'profile',purpose:'AUTH-SOURCE-PROFILE',owner:binding.owner,networkId:binding.networkId,keyVersion:'1',bodySHA256:sha(bodyRaw),messageSHA256:sha(message('profile',f.policy.signatureContract.profileFrame,binding,bodyRaw)),decision:'approved',issuedAtMs:1000,expiresAtMs:21000});plan.approvalDigest=sha(approvalRaw);
return{plan,approval:{path:'/PUBLIC/approval',device:'1',inode:'10',gid:0,mode:0o444,bytes:Buffer.byteLength(approvalRaw),sha256:sha(approvalRaw)},node:{nativeChainId:'6423'},roleKeys:{A:{path:'/PRIVATE/A'},B:{path:'/PRIVATE/B'}}};}
for(const[name,change]of[['extra device permission',f=>f.p.selection.privateSigner=true],['cross-app request',f=>f.p.selection.productSessionDeviceV4.expected.applicationId='com.foreign.app']])test('actual production release loader rejects '+name+' before opening private role keys and returns closable partial',async()=>{
test.mock.method(Date,'now',()=>2000);opened=[];closed=[];reads=0;const selected=entry(change);let expectedCode;assert.throws(()=>inspect('profile',selected.plan.rootRaw,selected.plan.enrollmentRaw,selected.plan.bodyRaw,selected.plan.policy,views,2000),e=>{expectedCode=e.code;return typeof expectedCode==='string';});const result=await acquire(selected);assert.equal(result.error?.code,expectedCode);assert.ok(result.partial);assert.deepEqual(opened,['/PUBLIC/approval']);assert.equal(reads,1);result.partial.retire();result.partial.join();result.partial.close();result.partial.close();assert.deepEqual(closed,[123]);test.mock.restoreAll();
});
test('actual device current release loader rechecks expiry before role-key open',async()=>{
 const f=full();for(const v of Object.values(f.registrations))v.activeRevision='1';views=f.registrations;opened=[];closed=[];let calls=0;
 test.mock.method(Date,'now',()=>++calls===1?2000:21000);
 const raw=f.profile(),entry={rootPath:'/PUBLIC/root',enrollmentPath:'/PUBLIC/enrollment',profiles:[{path:'/PUBLIC/profile',sha256:sha(raw)}],policy:f.policy,node:{nativeChainId:'6423'},currentKeys:{A:{path:'/PRIVATE/A'},B:{path:'/PRIVATE/B'}}};
 const readPublic=(path,digest)=>{const value=path==='/PUBLIC/root'?f.rootRaw:path==='/PUBLIC/enrollment'?f.enrollmentRaw:raw;assert.equal(sha(value),digest);return value;};
 await assert.rejects(acquireCurrent(entry,readPublic),{code:'AUTH_SOURCE_V2_EXPIRED'});assert.ok(calls>=2);assert.deepEqual(opened,[]);assert.deepEqual(closed,[]);test.mock.restoreAll();
});
