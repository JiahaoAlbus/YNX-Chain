import test from 'node:test';import assert from 'node:assert/strict';
import {validateBinding,fetchMatrixBinding,MatrixSocialTransport,MATRIX_PROTOCOL} from './transport.mjs';
const account='ynx1'+'a'.repeat(38),binding={protocol:MATRIX_PROTOCOL,account,userId:`@${account}:qa.test`,serverName:'qa.test',deviceId:'YNX-device',homeserver:'https://qa.test/',accessToken:'synthetic-test-token'};
test('identity/URL/version fail closed',()=>{assert.equal(validateBinding(binding,account),binding);for(const update of [{account:'ynx1'+'b'.repeat(38)},{homeserver:'http://qa.test/'},{protocol:'v2'},{userId:'@attacker:qa.test'},{homeserver:'https://qa.test/?token=x'}])assert.throws(()=>validateBinding({...binding,...update},account));assert.equal(validateBinding({...binding,homeserver:'http://127.0.0.1:9999/'},account,{localQA:true}).account,account)});
test('bridge requires exact existing consent, never calls issuer on rejected session',async()=>{let calls=0;await assert.rejects(fetchMatrixBinding({account,deviceId:'YNX-device',client:{restore:async()=>({status:'disconnected'})},fetcher:async()=>{calls++}}));assert.equal(calls,0)});
test('unverified device/downgrade and offline sending blocked',async()=>{const t=new MatrixSocialTransport();await assert.rejects(t.sendText('!room:qa.test','hello'),e=>e.code==='MATRIX_LOCKED');t.connected=true;t.binding=binding;t.client={getCrypto:()=>({isEncryptionEnabledInRoom:async()=>false})};await assert.rejects(t.assertTrusted('!room:qa.test'),e=>e.code==='MATRIX_DOWNGRADE_BLOCKED')});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function trustedTransport(block){const t=new MatrixSocialTransport();t.binding=binding;t.connected=true;const crypto={isEncryptionEnabledInRoom:async()=>true,getUserDeviceInfo:async()=>new Map([[binding.userId,new Map([[binding.deviceId,{deviceId:binding.deviceId,keys:new Map()}]])]]),getDeviceVerificationStatus:async()=>({isVerified:()=>true})};t.client={getCrypto:()=>crypto,getRoom:()=>({getMembers:()=>[{userId:binding.userId,membership:'join'}]}),stopClient(){},sendTextMessage:async()=>{throw new Error('Old text must not be sent')},uploadContent:async()=>block.promise,sendMessage:async()=>{throw new Error('Old attachment must not be sent')}};return t}
test('deferred trust query cannot send after account replacement',async()=>{const block=deferred(),t=trustedTransport(block);t.client.getCrypto().isEncryptionEnabledInRoom=()=>block.promise;const pending=t.sendText('!room:qa.test','old account text');t.stop();let sends=0;t.client={sendTextMessage:()=>sends++};t.binding={...binding,account:'ynx1'+'b'.repeat(38)};block.resolve(true);await assert.rejects(pending,e=>e.code==='MATRIX_STALE_SESSION');assert.equal(sends,0)});
test('deferred attachment upload cannot use replacement account',async()=>{const block=deferred(),started=deferred(),t=trustedTransport(block);t.client.uploadContent=()=>{started.resolve();return block.promise};const pending=t.sendAttachment('!room:qa.test',new TextEncoder().encode('isolated test bytes').buffer);await started.promise;t.stop();let sends=0;t.client={sendMessage:()=>sends++};t.binding={...binding,account:'ynx1'+'b'.repeat(38)};block.resolve({content_uri:'mxc://qa.test/ciphertext'});await assert.rejects(pending,e=>e.code==='MATRIX_STALE_SESSION');assert.equal(sends,0)});
test('grey and red sender warnings do not expose plaintext or attachment keys',async()=>{for(const shieldColour of [1,2]){const t=new MatrixSocialTransport();t.binding=binding;const event={isEncrypted:()=>true,getWireType:()=> 'm.room.encrypted',getWireContent:()=>({algorithm:'m.megolm.v1.aes-sha2'}),isDecryptionFailure:()=>false,getType:()=> 'm.room.message',getId:()=>'$test',getSender:()=> '@peer:qa.test',getContent:()=>{throw new Error('unverified plaintext must not be read')}};t.client={getRoom:()=>({getLiveTimeline:()=>({getEvents:()=>[event]})}),decryptEventIfNeeded:async()=>{},getCrypto:()=>({getEncryptionInfoForEvent:async()=>({shieldColour,shieldReason:1})})};const messages=await t.messages('!room:qa.test');assert.equal(messages.length,1);assert.equal(messages[0].content.file,undefined);assert.match(messages[0].content.body,/blocked/)} });
test('replacement sync cannot complete the previous connection or stop replacement client',async()=>{
 const waiting=deferred(),clients=[];const t=new MatrixSocialTransport({storeFactory:()=>({backend:{},on(){},startup:async()=>{}}),clientFactory:()=>{const handlers=new Map();const index=clients.length;const client={stops:0,initRustCrypto:async()=>{},getCrypto:()=>({setTrustCrossSignedDevices(){},userHasCrossSigningKeys:async()=>true,getVersion:()=> 'synthetic'}),on:(event,fn)=>handlers.set(event,fn),startClient:async()=>{if(index===0){waiting.resolve();return}handlers.get('sync')('PREPARED')},stopClient(){this.stops++}};clients.push(client);return client}});
 const old=t.connect(binding,account,new Uint8Array(32));const stale=assert.rejects(old,e=>e.code==='MATRIX_STALE_SESSION');await waiting.promise;
 const nextAccount='ynx1'+'b'.repeat(38),next={...binding,account:nextAccount,userId:`@${nextAccount}:qa.test`};const result=await t.connect(next,nextAccount,new Uint8Array(32));await stale;
 assert.equal(result.account,nextAccount);assert.equal(t.client,clients[1]);assert.equal(clients[1].stops,0);assert.equal(t.connected,true);
});
test('unknown verification rejection fails rather than reporting successful cancellation',async()=>{const t=trustedTransport(deferred());await assert.rejects(t.rejectVerification('missing'),e=>e.code==='MATRIX_VERIFICATION_MISSING')});
test('device list change discards session and never silently trusts a new device',async()=>{
 const t=trustedTransport(deferred()),crypto=t.client.getCrypto();let discard=0;crypto.forceDiscardSession=async()=>{discard++};await t.assertTrusted('!room:qa.test');
 crypto.getUserDeviceInfo=async()=>new Map([[binding.userId,new Map([[binding.deviceId,{deviceId:binding.deviceId,keys:new Map()}],['new-device',{deviceId:'new-device',keys:new Map([['ed25519:new-device','new-key']])}]])]]);crypto.getDeviceVerificationStatus=async()=>({isVerified:()=>false});
 await assert.rejects(t.assertTrusted('!room:qa.test'),e=>e.code==='MATRIX_DEVICE_CHANGED');assert.equal(discard,1);await assert.rejects(t.assertTrusted('!room:qa.test'),e=>e.code==='MATRIX_UNVERIFIED_DEVICE');
});
test('legacy MXID requires the exact previously verified login metadata, never a derived replacement',()=>{
 const old={...binding,userId:'@historical:qa.test'};
 assert.throws(()=>validateBinding(old,account));assert.equal(validateBinding(old,account,{expectedUserId:old.userId}),old);
 assert.throws(()=>validateBinding(old,account,{expectedUserId:binding.userId}));
 assert.throws(()=>validateBinding({...old,userId:'@historical:other.test'},account,{expectedUserId:'@historical:other.test'}));
});
test('verified historical peer on another server uses the original MXID and encrypted room state',async()=>{
 const t=new MatrixSocialTransport();t.binding=binding;let roomInput;t.client={createRoom:async input=>(roomInput=input,{room_id:'!fixture:qa.test'})};
 const userId='@historical-peer:remote.test',verifiedPeer={account:'ynx1'+'b'.repeat(38),userId,serverName:'remote.test'};
 await assert.rejects(t.createConversation(userId),e=>e.code==='MATRIX_PEER_BINDING_REQUIRED');assert.equal(roomInput,undefined);
 assert.equal(await t.createConversation(userId,{verifiedPeer}),'!fixture:qa.test');assert.deepEqual(roomInput.invite,[userId]);
 assert.equal(roomInput.initial_state[0].content.algorithm,'m.megolm.v1.aes-sha2');
 await assert.rejects(t.createConversation(userId,{verifiedPeer:{...verifiedPeer,userId:'@other:remote.test'}}),e=>e.code==='MATRIX_PEER_BINDING_REQUIRED');
});
test('historical MXID connect keeps original per-account/device sync and Rust crypto namespaces',async()=>{
 let storeOptions,clientOptions,cryptoOptions;const handlers=new Map();
 const t=new MatrixSocialTransport({storeFactory:options=>(storeOptions=options,{backend:{},on(){},startup:async()=>{}}),clientFactory:options=>(clientOptions=options,{stopClient(){},initRustCrypto:async options=>{cryptoOptions=options},getCrypto:()=>({setTrustCrossSignedDevices(){},userHasCrossSigningKeys:async()=>true,getVersion:()=> 'fixture'}),on:(event,fn)=>handlers.set(event,fn),startClient:async()=>handlers.get('sync')('PREPARED')})});
 const old={...binding,userId:'@historical:qa.test'},key=new Uint8Array(32);
 await t.connect(old,account,key,{expectedUserId:old.userId});
 assert.equal(clientOptions.userId,old.userId);assert.equal(clientOptions.deviceId,binding.deviceId);
 assert.equal(storeOptions.dbName,`ynx-social-matrix-sync-v1:${account}:${binding.deviceId}`);
 assert.equal(cryptoOptions.cryptoDatabasePrefix,`ynx-social-matrix-v1:${account}:${binding.deviceId}`);assert.equal(cryptoOptions.storageKey,key);
});
