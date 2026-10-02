import test from 'node:test';
import assert from 'node:assert/strict';
import {decryptAttachment} from 'matrix-encrypt-attachment';
// @ts-ignore production module
import {RestrictedMomentAttachments} from '../web/matrix/restricted-attachments.mjs';

const audience={roomId:'!original:fixture.invalid',revision:'a'.repeat(64)};
const transactionId='original_attachment_001';
const bytes=new TextEncoder().encode('private original bytes').buffer;
function fixture(){
  let stopped=false,checks=0,uploads=0;let uploaded:Uint8Array|undefined;
  const binding={account:'synthetic-account',userId:'@original:fixture.invalid',deviceId:'original-device'};
  const client={uploadContent:async(data:Uint8Array,options:any)=>{uploads++;uploaded=data;assert.equal(options.type,'application/octet-stream');assert.equal(options.includeFilename,false);return {content_uri:'mxc://fixture.invalid/encrypted'}}};
  const operation={binding,client,generation:1};
  const transport={capture:()=>operation,guard:()=>{if(stopped)throw Error('stale original operation')},assertTrusted:async()=>{}};
  const consumer={transport,check:async(_audience:any,_operation:any,authorization:any)=>{checks++;assert.deepEqual(authorization,{action:'media-prepare',transactionId})}};
  const helper=new RestrictedMomentAttachments({consumer});
  return {helper,client,consumer,stop:()=>{stopped=true},checks:()=>checks,uploads:()=>uploads,uploaded:()=>uploaded!};
}
test('restricted attachment uses official encrypted bytes and three audience/trust checks',async()=>{
  const f=fixture();const result=await f.helper.prepare(audience,{bytes,transactionId,name:'private.txt',mimeType:'text/plain'});
  assert.equal(f.checks(),3);assert.equal(f.uploads(),1);assert.equal(result.transactionId,transactionId);
  assert.equal('url' in result.content,false);assert.equal(result.content.file.url,'mxc://fixture.invalid/encrypted');
  assert.notDeepEqual(f.uploaded(),new Uint8Array(bytes));
  const ciphertext=f.uploaded().slice().buffer as ArrayBuffer;
  assert.deepEqual(new Uint8Array(await decryptAttachment(ciphertext,result.content.file)),new Uint8Array(bytes));
});
test('revoked audience after encryption prevents upload',async()=>{
  const f=fixture();let count=0;f.consumer.check=async()=>{if(++count===2)throw Error('audience revoked')};
  await assert.rejects(f.helper.prepare(audience,{bytes,transactionId}),/audience revoked/);assert.equal(f.uploads(),0);
});
test('known uploaded receipt is retained across late policy failure, explicit retry never reuploads',async()=>{
  const f=fixture();let count=0;f.consumer.check=async()=>{if(++count===3)throw Error('late policy change')};
  await assert.rejects(f.helper.prepare(audience,{bytes,transactionId}),/late policy/);assert.equal(f.uploads(),1);
  const next=await f.helper.prepare(audience,{bytes,transactionId});assert.equal(next.content.file.url,'mxc://fixture.invalid/encrypted');assert.equal(f.uploads(),1);
});
test('unknown upload result cannot be retried with the original transaction',async()=>{
  const f=fixture();let calls=0;f.client.uploadContent=async()=>{calls++;throw Error('response lost')};
  await assert.rejects(f.helper.prepare(audience,{bytes,transactionId}),/response lost/);
  await assert.rejects(f.helper.prepare(audience,{bytes,transactionId}),/unknown/);assert.equal(calls,1);
});
test('lock after upload retains receipt but never publishes a prepared descriptor',async()=>{
  const f=fixture();f.client.uploadContent=async()=>{f.stop();return {content_uri:'mxc://fixture.invalid/original'}};
  await assert.rejects(f.helper.prepare(audience,{bytes,transactionId}),/stale/);
});
test('original transaction cannot substitute the file bytes or reviewed audience',async()=>{
  const f=fixture();await f.helper.prepare(audience,{bytes,transactionId});
  await assert.rejects(f.helper.prepare(audience,{bytes:new TextEncoder().encode('replacement').buffer,transactionId}),/different attachment/);
  await assert.rejects(f.helper.prepare({...audience,revision:'b'.repeat(64)},{bytes,transactionId}),/different attachment/);
  assert.equal(f.uploads(),1);
});
