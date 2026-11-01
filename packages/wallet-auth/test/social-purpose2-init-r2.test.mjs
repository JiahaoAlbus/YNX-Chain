// PUBLIC DATA projections only. Real absent-storage/current/UNKNOWN effects
// must be tested by Main/Auth/Client with the same new matching revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as P from '../src/social-platform-policy-v3.js';
import {policy,release,delegation,expected,current} from './fixtures/social-policy-public.fixture.mjs';

const p=mask=>({...policy(),first_device_operations:0,message_operations:mask});
function grant(mask){const r={...release(),first_device_operations:0,message_operations:mask};const d={...delegation(),first_device_operations:0,message_operations:mask};return [r,d,{...d}];}
test('R2 only-purpose2-init mask is exact bit1 and cannot authorize existing message effects',()=>{
 const one=p(1);const a=P.assertSocialPlatformRequiredOperationsV3DATA(one,2,1);
 assert.equal(a.requiredOperations,1);assert.equal(a.availableOperations,1);assert.equal(a.RootAdmission,false);
 for(const bit of [2,4,8,16,32,63])assert.throws(()=>P.assertSocialPlatformRequiredOperationsV3DATA(one,2,bit));
 for(const invalid of [0,64,127,4294967295])assert.throws(()=>P.assertSocialPlatformRequiredOperationsV3DATA(one,2,invalid));
 assert.throws(()=>P.assertSocialPlatformRequiredOperationsV3DATA(one,1,1));
});
test('message zero and legacy62 never acquire init through first-device63; explicit63 remains a subset check',()=>{
 const none={...policy(),first_device_operations:63,message_operations:0};
 assert.throws(()=>P.assertSocialPlatformRequiredOperationsV3DATA(none,2,1));
 assert.throws(()=>P.assertSocialPlatformRequiredOperationsV3DATA(p(62),2,1));
 for(const required of [1,2,4,8,16,32,63])assert.equal(P.assertSocialPlatformRequiredOperationsV3DATA(p(63),2,required).requiredOperations,required);
 assert.throws(()=>P.inspectSocialPlatformPolicyOriginalV3DATA(p(64)));
});
test('all Root4 and both Deleg4 and Policy3 operands must explicitly include purpose2 init',()=>{
 const [r,i,a]=grant(1);const good=P.assertSocialPlatformRuntimeV4DATA(r,i,a,p(1),expected(),120n);
 assert.equal(good.policy.message_operations,1);assert.equal(good.signatureVerified,false);assert.equal(good.SourceAdmission,false);
 for(const index of [0,1,2]){
  const chain=[r,i,a].map(x=>({...x}));chain[index].first_device_operations=1;chain[index].message_operations=0;
  assert.throws(()=>P.assertSocialPlatformRuntimeV4DATA(...chain,p(1),expected(),120n));
 }
 const [wide,di,da]=grant(63);
 assert.equal(P.assertSocialPlatformRuntimeV4DATA(wide,di,da,p(1),expected(),120n).policy.message_operations,1);
 const [narrow,ni,na]=grant(1);
 assert.throws(()=>P.assertSocialPlatformRuntimeV4DATA(narrow,ni,na,p(63),expected(),120n));
});
test('purpose2 init never borrows changed account/device/namespace/epoch/generation/current',()=>{
 const [r,i,a]=grant(1),one=p(1);
 for(const key of ['account','device','namespace']){
  const wrong=expected();wrong[key]=new Uint8Array(32).fill(19);
  assert.throws(()=>P.assertSocialPlatformRuntimeV4DATA(r,i,a,one,wrong,120n));
 }
 for(const key of ['storage_generation','key_epoch','registration_revision']){
  const wrong=expected();wrong[key]+=1n;
  assert.throws(()=>P.assertSocialPlatformRuntimeV4DATA(r,i,a,one,wrong,120n));
 }
 const digest=new Uint8Array(32).fill(11);
 assert.equal(P.assertSocialPlatformPolicyCurrentDATA(one,current(),digest,120n).RootAdmission,false);
 assert.throws(()=>P.assertSocialPlatformPolicyCurrentDATA(one,{...current(),revoked:true},digest,120n));
 assert.throws(()=>P.assertSocialPlatformPolicyCurrentDATA(one,current(),digest,140n));
 assert.throws(()=>P.assertSocialPlatformPolicyCurrentDATA(one,{...current(),key_epoch:1n},digest,120n));
});
test('R2 exact wire shapes and field order stay unchanged; old62 bytes still mean only62',()=>{
 for(const mask of [1,62,63]){
  const one=p(mask),raw=P.encodeSocialPlatformPolicyOriginalV3DATA(one);
  assert.equal(P.decodeSocialPlatformPolicyOriginalV3DATA(raw).message_operations,mask);
  assert.deepEqual(P.encodeSocialPlatformPolicyOriginalV3DATA(P.decodeSocialPlatformPolicyOriginalV3DATA(raw)),raw);
  const [r,d]=grant(mask),rr=P.encodeSocialPlatformReleaseOptInV4DATA(r),dr=P.encodeSocialPlatformRuntimeDelegationV4DATA(d);
  assert.deepEqual(P.encodeSocialPlatformReleaseOptInV4DATA(P.decodeSocialPlatformReleaseOptInV4DATA(rr)),rr);
  assert.deepEqual(P.encodeSocialPlatformRuntimeDelegationV4DATA(P.decodeSocialPlatformRuntimeDelegationV4DATA(dr)),dr);
  assert.equal(JSON.parse(raw).version,3);assert.equal(JSON.parse(rr).version,4);assert.equal(JSON.parse(dr).version,4);
  assert.equal(JSON.parse(raw).revision,undefined);
 }
 assert.equal(P.SOCIAL_ORDINARY_MESSAGE_OPERATIONS_R2_DATA.allowedMask,63);
 assert.equal(P.SOCIAL_ORDINARY_MESSAGE_OPERATIONS_R2_DATA.initializeStorage,1);
 assert(Object.isFrozen(P.SOCIAL_ORDINARY_MESSAGE_OPERATIONS_R2_DATA));
});
test('R2 vectors pin exact unsigned body bytes and actual subset outcomes for 0/1/62/63',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../integration/SOCIAL_PURPOSE2_INIT_R2_VECTORS.json',import.meta.url)));
 assert.equal(data.kind,'PUBLIC_UNSIGNED_SDK_DATA_VECTORS');assert.equal(data.realInitializationVerified,false);
 for(const vector of data.vectors){
  for(const [key,decode,encode] of [['policy3',P.decodeSocialPlatformPolicyOriginalV3DATA,P.encodeSocialPlatformPolicyOriginalV3DATA],['rootRelease4',P.decodeSocialPlatformReleaseOptInV4DATA,P.encodeSocialPlatformReleaseOptInV4DATA],['delegation4',P.decodeSocialPlatformRuntimeDelegationV4DATA,P.encodeSocialPlatformRuntimeDelegationV4DATA]]){
   const row=vector[key],raw=Buffer.from(row.base64url,'base64url');assert.equal(raw.length,row.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),row.sha256);assert.deepEqual(encode(decode(raw)),raw);
  }
  const policy=P.decodeSocialPlatformPolicyOriginalV3DATA(Buffer.from(vector.policy3.base64url,'base64url'));
  for(const request of vector.purpose2RequiredOperations){if(request.accepted)assert.equal(P.assertSocialPlatformRequiredOperationsV3DATA(policy,2,request.required).requiredOperations,request.required);else assert.throws(()=>P.assertSocialPlatformRequiredOperationsV3DATA(policy,2,request.required));}
  assert.equal(vector.RootAdmission,false);assert.equal(vector.signatureVerified,false);
 }
});
