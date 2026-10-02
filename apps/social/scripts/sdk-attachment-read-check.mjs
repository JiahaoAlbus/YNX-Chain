import assert from 'node:assert/strict';
import {encryptAttachment,decryptAttachment} from 'matrix-encrypt-attachment';
import {RestrictedMoments,RESTRICTED_MOMENT_PROTOCOL as protocol} from '../web/matrix/restricted-moments.mjs';
const sender='@original:fixture.invalid',audience={protocol,kind:'private',revision:'a'.repeat(64),owner:sender,roomId:'!original:fixture.invalid',members:[sender]};
const index={eventId:'$original-sdk-file',transactionId:'original_sdk_file_transaction_001',sender,audience};
const source=new TextEncoder().encode('Isolated official SDK file round trip'),encrypted=await encryptAttachment(source.buffer);
assert.equal(new TextDecoder().decode(await decryptAttachment(encrypted.data,encrypted.info)),new TextDecoder().decode(source));
const content={msgtype:'m.file',body:'fixture.txt',file:{...encrypted.info,url:'mxc://fixture.invalid/original'},'com.ynx.social.moment':{protocol,kind:'moment',owner:sender,revision:audience.revision,audience:'private',author:sender,text:'Original SDK caption'}};
const operation={binding:{userId:sender},client:{getRoom:()=>({getMembers:()=>[{userId:sender,membership:'join'}]})}};
let current=structuredClone(content);
const transport={capture:()=>operation,guard:()=>{},messages:async()=>[{id:index.eventId,sender,encrypted:true,verification:{shieldColour:0},content:current}]};
const consumer=new RestrictedMoments({transport,authorize:async expected=>expected}),results=[];
let decoded=await consumer.read(index);assert.equal(decoded.text,'Original SDK caption');assert.equal(decoded.attachment.info,undefined);results.push({name:'real SDK descriptor without optional info accepted on read',status:'PASS'});
current.info={size:source.byteLength,mimetype:'text/plain'};decoded=await consumer.read(index);assert.equal(decoded.attachment.info.size,source.byteLength);results.push({name:'real SDK descriptor with info accepted on read',status:'PASS'});
for(const field of ['key','iv','hashes']){current=structuredClone(content);delete current.file[field];await assert.rejects(()=>consumer.read(index));results.push({name:'missing '+field+' rejected',status:'PASS'})}
for(const key of [{...content.file.key,ext:false},{...content.file.key,key_ops:['decrypt']},{...content.file.key,k:'invalid-length'}]){current=structuredClone(content);current.file.key=key;await assert.rejects(()=>consumer.read(index));results.push({name:'invalid JWK contract rejected',status:'PASS'})}
current=structuredClone(content);current.file={v:'v2',url:'mxc://'};await assert.rejects(()=>consumer.read(index));results.push({name:'original incomplete descriptor rejected',status:'PASS'});
const tampered=new Uint8Array(encrypted.data.slice(0));tampered[0]^=1;await assert.rejects(()=>decryptAttachment(tampered.buffer,encrypted.info));results.push({name:'official SDK ciphertext hash verification rejects tamper',status:'PASS'});
console.log(JSON.stringify({qualification:'real locked matrix-encrypt-attachment SDK/WebCrypto; controlled encrypted event/authority, no real HS',pass:results.length,fail:0,skip:0,results},null,2));
