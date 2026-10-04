import assert from "node:assert/strict";
import test from "node:test";
import {SocialAPI} from "./api";
import {ContactRequestFlow,requireSocialProfileQR,socialProfileQR,socialDiscoveryEntry} from "./contactRequestFlow";

const id="sp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",qr=`https://social.ynxweb4.com/people/${id}`;
test('Native initial and live discovery URLs carry business intent only',()=>{
 assert.deepEqual(socialDiscoveryEntry(qr),{source:'qr',value:qr});const invitation='https://social.ynxweb4.com/invite/'+'B'.repeat(32);assert.deepEqual(socialDiscoveryEntry(invitation),{source:'invite',value:invitation});
 for(const value of [qr+'?',qr+'#',qr+'?approved=true',qr+'/',qr.replace('/people/','/%70eople/'),qr.replace('.com/','.com:443/'),'ynxsocial://invite/'+'B'.repeat(32),'wc:pair','ethereum:payment','https://evil.invalid/invite/'+'B'.repeat(32),null])assert.equal(socialDiscoveryEntry(value),null);
});
function fixture(){const api=new SocialAPI("http://127.0.0.1:6431"),sent:unknown[][]=[];let fail=false,count=0;api.previewContact=async()=>({person:{id,handle:"bob",displayName:"Bob"}});api.requestContact=async(...args)=>{sent.push(args);if(fail)throw new Error("offline");return {}};const flow=new ContactRequestFlow(api,async()=>`synthetic_key_${String(++count).padStart(16,"0")}`);return {api,flow,sent,setFail:(value:boolean)=>{fail=value}}}
test("Native preview sends nothing until explicit confirmation of stable target",async()=>{const f=fixture(),review=await f.flow.preview("handle"," @bob ");assert.equal(f.sent.length,0);await f.flow.confirm(review,"Hello Bob");assert.deepEqual(f.sent[0]?.slice(0,5),["handle","bob",review.idempotencyKey,id,"Hello Bob"]);assert.ok(f.sent[0]?.[5] instanceof AbortSignal);assert.equal(f.sent[0][5].aborted,false);await assert.rejects(f.flow.confirm(review),/again/)});
test("Native same-account new generation rejects old review",async()=>{const f=fixture();f.api.useProductSession(async()=>({} as never),"same-account");const review=await f.flow.preview("handle","bob");f.api.useProductSession(async()=>({} as never),"same-account");await assert.rejects(f.flow.confirm(review),/again/);assert.equal(f.sent.length,0)});
test("Native cancellation and logout reject old review without submitting",async()=>{const f=fixture(),review=await f.flow.preview("qr",qr);f.flow.cancel();await assert.rejects(f.flow.confirm(review),/again/);const next=await f.flow.preview("invite","https://social.ynxweb4.com/invite/"+'B'.repeat(32));f.api.setToken(null);await assert.rejects(f.flow.confirm(next),/again/);assert.equal(f.sent.length,0)});
test('Native personal QR preview cannot silently retarget a stable identity',async()=>{
 const f=fixture();f.api.previewContact=async()=>({person:{id:'sp_'+'B'.repeat(32),handle:'another',displayName:'Another'}});
 await assert.rejects(f.flow.preview('qr',qr),/does not match/);assert.equal(f.sent.length,0);
});
test('Native malformed invitation is rejected before preview, while exact original token is retained',async()=>{
 const f=fixture();let reads=0;f.api.previewContact=async()=>{reads++;return {person:{id,handle:'bob',displayName:'Bob'}}};
 const link='https://social.ynxweb4.com/invite/'+'B'.repeat(32);
 for(const value of [link+'?',link+'#',link+'?approved=1',link.replace('.com/','.com:443/'),link.replace('/invite/','/%69nvite/'),'B'.repeat(31),'ynxsocial://invite/'+'B'.repeat(32)])await assert.rejects(f.flow.preview('invite',value),/exact YNX/);
 assert.equal(reads,0);const review=await f.flow.preview('invite',link);assert.equal(review.value,'B'.repeat(32));assert.equal(reads,1);assert.equal(f.sent.length,0);
});
test('restoring original contact requires fresh preview and allocates no replacement nonce',async()=>{
 const f=fixture(),original={source:'handle' as const,value:'bob',personId:id,idempotencyKey:'native-contact-'+'a'.repeat(32)};let reads=0;
 f.api.previewContact=async()=>{reads++;return {person:{id,handle:'bob',displayName:'Current Bob'}}};
 const restored=await f.flow.restore(original);assert.equal(reads,1);assert.equal(f.sent.length,0);assert.equal(restored.idempotencyKey,original.idempotencyKey);assert.equal(restored.person.displayName,'Current Bob');await f.flow.confirm(restored,'Original message');assert.equal(f.sent[0]?.[2],original.idempotencyKey);
});
test('restoring changed target refuses the request instead of retargeting original nonce',async()=>{
 const f=fixture();f.api.previewContact=async()=>({person:{id:'sp_'+'B'.repeat(32),handle:'other',displayName:'Other'}});await assert.rejects(f.flow.restore({source:'handle',value:'bob',personId:id,idempotencyKey:'native-contact-'+'a'.repeat(32)}),/target changed/);assert.equal(f.sent.length,0);
});
test("Native failed retry preserves identity, key and message",async()=>{const f=fixture(),review=await f.flow.preview("handle","bob");f.setFail(true);await assert.rejects(f.flow.confirm(review,"original"),/offline/);await assert.rejects(f.flow.confirm(review,"changed"),/original/);f.setFail(false);await f.flow.confirm(review,"original");assert.deepEqual(f.sent[0],f.sent[1])});
test("Native late preview after account change cannot become a review",async()=>{const f=fixture();let resolve!:(value:any)=>void;f.api.previewContact=()=>new Promise(done=>{resolve=done});const pending=f.flow.preview("handle","bob");f.api.setToken(null);resolve({person:{id,handle:"bob",displayName:"Bob"}});await assert.rejects(pending,/authorization changed/);assert.equal(f.sent.length,0)});
test("Native QR contract accepts opaque canonical locator, rejects legacy and funding values",()=>{assert.equal(requireSocialProfileQR(qr),qr);for(const value of [`${qr}?x=1`,`${qr}#x`,"ynxsocial://profile/bob","https://social.ynxweb4.com/people/ynx1funding","https://example.invalid/people/"+id]){assert.equal(socialProfileQR(value),null);assert.throws(()=>requireSocialProfileQR(value))}});
test("Native preview rejects stale-server funding IDs and foreign invitation URLs",async()=>{const f=fixture();await assert.rejects(f.flow.preview("invite","https://example.invalid/invite/token"),/exact YNX/);f.api.previewContact=async()=>({person:{id:"ynx1funding",handle:"bob",displayName:"Bob"}});await assert.rejects(f.flow.preview("handle","bob"),/stable Social/);assert.equal(f.sent.length,0)});
