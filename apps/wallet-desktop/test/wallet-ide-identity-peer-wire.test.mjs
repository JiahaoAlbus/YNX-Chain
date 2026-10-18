import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {IDE_IDENTITY_PEER_WIRE as W,encodeIDEIdentityPeerFrame as encode,createIDEIdentityPeerReader as reader,createIDEIdentityPeerSequence as sequence,decodeIDEIdentityPeerRequestPacket as packet,encodeIDEIdentityPeerDecision as decision} from '../src/wallet-ide-identity-peer-wire.mjs';
function read(raw){const r=reader();r.append(raw.subarray(0,24));r.append(raw.subarray(24));return r.finish();}
test('exact original24-byte header, versions/kinds and uint64 sequence preserve opaque bytes without consuming the raw startup marker',()=>{
 const raw=encode({kind:1,sequence:9007199254740993n,payload:Buffer.from([0,255,3])});assert.equal(raw.subarray(0,8).toString(),'YNXIDP01');assert.deepEqual([...raw.subarray(8,12)],[0,1,1,0]);assert.equal(raw.readBigUInt64BE(12),9007199254740993n);assert.equal(raw.readUInt32BE(20),3);assert.deepEqual(read(raw).payload,Buffer.from([0,255,3]));const r=reader();r.append(Buffer.from('YNXIDP01'));assert.throws(()=>r.finish(),{code:'AUTH_IDENTITY_PEER_FRAME_INVALID'});
});
test('fragmentation follows exact remaining bytes; truncation, extra bytes and bad header become sticky UNKNOWN with retained prefix',()=>{
 const raw=encode({kind:1,sequence:1n,payload:Buffer.from('PUBLIC')});const r=reader();for(const b of raw)r.append(Buffer.from([b]));assert.equal(r.finish().kind,1);const body=r.finish().payload;body.fill(0);assert.notEqual(r.finish().payload[0],0);
 for(const change of [b=>{b[8]=1;},b=>{b[9]=2;},b=>{b[10]=9;},b=>{b[11]=1;},b=>{b.writeBigUInt64BE(0n,12);},b=>{b.writeUInt32BE(W.payloadMax+1,20);},b=>{b.writeUInt32BE(0,20);}]){const bad=Buffer.from(raw);change(bad);const x=reader();assert.throws(()=>x.append(bad.subarray(0,24)));assert.equal(x.snapshot().state,'unknown');assert.throws(()=>x.finish());}
 const truncated=reader();truncated.append(raw.subarray(0,24));truncated.append(raw.subarray(24,-1));assert.throws(()=>truncated.finish());assert.equal(truncated.snapshot().raw.length,raw.length-1);
 const extra=reader();assert.throws(()=>extra.append(raw));assert.equal(extra.snapshot().state,'unknown');
});
test('send reservation and receive order are separate; replay/order/partial failure never reset or renew the same stream',()=>{
 const s=sequence();assert.equal(s.selectSend(),1n);s.acceptReceive(1n);assert.equal(s.selectSend(),2n);assert.throws(()=>s.acceptReceive(1n),{code:'AUTH_IDENTITY_PEER_REPLAY_OR_ORDER'});assert.equal(s.snapshot().unknown,true);assert.throws(()=>s.selectSend(),{code:'AUTH_IDENTITY_PEER_STREAM_UNKNOWN'});const x=sequence();x.markUnknown(false);x.markUnknown(Error('later'));assert.equal(x.snapshot().firstCause,false);assert.equal(x.snapshot().firstCausePresent,true);
});
test('original Node wrapper preserves exact request and null/string invocation; duplicates, aliases, BOM and noncanonical bytes refuse',()=>{
 const requestRaw='PUBLIC exact request bytes',invocationRaw='PUBLIC exact invocation',raw=Buffer.from(JSON.stringify({requestRaw,invocationRaw})),p=packet(raw);assert.equal(p.requestRaw,requestRaw);assert.equal(p.invocationRaw,invocationRaw);assert.equal(p.requestSha256,createHash('sha256').update(requestRaw).digest('hex'));assert.equal(packet(Buffer.from(JSON.stringify({requestRaw,invocationRaw:null}))).invocationRaw,null);
 for(const text of ['{"requestRaw":"x","requestRaw":"y","invocationRaw":null}','{"requestRaw":"x","request\\u0052aw":"y","invocationRaw":null}','\ufeff'+raw.toString(),'{ "requestRaw":"x","invocationRaw":null}',JSON.stringify({requestRaw,invocationRaw:undefined}),JSON.stringify({requestRaw:'x',invocationRaw:false})])assert.throws(()=>packet(Buffer.from(text)));
});
test('approve preserves proof; reject and R111 cancel have distinct kinds with the same exact32-byte original request correlation',()=>{
 const requestRaw='PUBLIC original expected UTF8 请求',proof=Buffer.from([7,0,255]),approved=decision({decision:'approve',requestRaw,proof});assert.equal(approved.kind,2);assert.deepEqual(approved.payload,proof);proof.fill(0);assert.equal(approved.payload[0],7);
 const rejected=decision({decision:'reject',requestRaw,proof:null}),cancelled=decision({decision:'cancel',requestRaw,proof:null});assert.equal(rejected.kind,3);assert.equal(cancelled.kind,4);assert.equal(rejected.payload.length,32);assert.deepEqual(cancelled.payload,rejected.payload);assert.deepEqual(rejected.payload,createHash('sha256').update(Buffer.from(requestRaw)).digest());for(const d of ['close','EOF'])assert.throws(()=>decision({decision:d,requestRaw,proof:null}),{code:'AUTH_IDENTITY_PEER_RETURN_KIND_INVALID'});
});
test('fixed caps and unsafe byte containers fail before output; there is no socket/FD/Root construction seam',()=>{
 assert.throws(()=>encode({kind:1,sequence:1,payload:Buffer.from('x')}));assert.throws(()=>encode({kind:1,sequence:1n,payload:Buffer.alloc(W.payloadMax+1)}));assert.throws(()=>decision({decision:'approve',requestRaw:'x',proof:Buffer.alloc(W.proofMax+1)}));assert.throws(()=>decision({decision:'approve',requestRaw:'x',proof:Buffer.alloc(0)}));assert.throws(()=>packet(Buffer.from(JSON.stringify({requestRaw:'x'.repeat(W.requestMax+1),invocationRaw:null}))));assert.throws(()=>encode({kind:1,sequence:1n,payload:new Uint8Array(new SharedArrayBuffer(1))}));assert.equal(Object.isFrozen(W),true);
});
