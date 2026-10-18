import {createHash} from 'node:crypto';
import {types} from 'node:util';
// Exact canonical329/R97 wire.h, SHA4a051601...: DATA ONLY. This module
// creates no socket, source, owner, approval, proof or Native qualification.
export const IDE_IDENTITY_PEER_WIRE=Object.freeze({headerBytes:24,payloadMax:524288,proofMax:262144,requestMax:16384,packetMax:65536,kinds:Object.freeze({request:1,proof:2,reject:3,cancel:4,current:5,result:6,failure:7,close:8})});
const magic=Buffer.from('YNXIDP01'),maxSequence=18446744073709551615n;
const error=code=>Object.assign(Error(code),{code});
const fail=code=>{throw error(code);};
function bytes(value,max){
 if(types.isProxy(value)||!types.isUint8Array(value)||![Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value))||['buffer','byteOffset','byteLength','length'].some(k=>Object.hasOwn(value,k))||types.isSharedArrayBuffer(value.buffer)||!value.byteLength||value.byteLength>max)fail('AUTH_IDENTITY_PEER_FRAME_INVALID');
 return Buffer.from(value);
}
function sequence(value){if(typeof value!=='bigint'||value<1n||value>maxSequence)fail('AUTH_IDENTITY_PEER_FRAME_INVALID');return value;}
function text(value){if(typeof value!=='string'||!value.length||Buffer.byteLength(value)>IDE_IDENTITY_PEER_WIRE.requestMax||Buffer.from(value).toString('utf8')!==value)fail('AUTH_IDENTITY_PEER_REQUEST_INVALID');return value;}
export function encodeIDEIdentityPeerFrame({kind,sequence:seq,payload}){
 if(!Number.isInteger(kind)||kind<1||kind>8)fail('AUTH_IDENTITY_PEER_FRAME_INVALID');sequence(seq);const body=bytes(payload,IDE_IDENTITY_PEER_WIRE.payloadMax),raw=Buffer.alloc(24+body.length);magic.copy(raw);raw[9]=1;raw[10]=kind;raw.writeBigUInt64BE(seq,12);raw.writeUInt32BE(body.length,20);body.copy(raw,24);return raw;
}
export function createIDEIdentityPeerReader(){
 let raw=Buffer.alloc(24),at=0,header=false,unknown=false,first=null;
 const invalid=()=>{unknown=true;first??=error('AUTH_IDENTITY_PEER_FRAME_INVALID');throw first;};
 return Object.freeze({
  remaining:()=>unknown?0:raw.length-at,
  append(value){
   if(unknown)throw first;let part;try{part=bytes(value,raw.length-at);}catch{return invalid();}
   part.copy(raw,at);at+=part.length;
   if(!header&&at===24){if(!raw.subarray(0,8).equals(magic)||raw[8]!==0||raw[9]!==1||raw[10]<1||raw[10]>8||raw[11]!==0||raw.readBigUInt64BE(12)===0n)invalid();const size=raw.readUInt32BE(20);if(!size||size>IDE_IDENTITY_PEER_WIRE.payloadMax)invalid();const full=Buffer.alloc(24+size);raw.copy(full);raw=full;header=true;}
  },
  finish(){if(unknown)throw first;if(!header||at!==raw.length)invalid();return Object.freeze({kind:raw[10],sequence:raw.readBigUInt64BE(12),payload:Buffer.from(raw.subarray(24))});},
  snapshot:()=>Object.freeze({state:unknown?'unknown':header&&at===raw.length?'complete':'pending',raw:Buffer.from(raw.subarray(0,at)),firstCause:first}),
 });
}
export function createIDEIdentityPeerSequence(){
 let sent=0n,received=0n,unknown=false,first,hasFirst=false;
 const markUnknown=cause=>{unknown=true;if(!hasFirst){hasFirst=true;first=cause;}};
 return Object.freeze({
  selectSend(){if(unknown||sent===maxSequence){markUnknown(error('AUTH_IDENTITY_PEER_STREAM_UNKNOWN'));fail('AUTH_IDENTITY_PEER_STREAM_UNKNOWN');}return ++sent;},
  acceptReceive(value){if(unknown||received===maxSequence||typeof value!=='bigint'||value!==received+1n){markUnknown(error('AUTH_IDENTITY_PEER_REPLAY_OR_ORDER'));fail('AUTH_IDENTITY_PEER_REPLAY_OR_ORDER');}received=value;},
  markUnknown,
  snapshot:()=>Object.freeze({sent,received,unknown,firstCausePresent:hasFirst,firstCause:first}),
 });
}
/** Decode only the fixed Node wrapper. Original expected/purpose/Source and
 * invocation recognition belong to the actual same Native request owner. */
export function decodeIDEIdentityPeerRequestPacket(value){
 const raw=bytes(value,IDE_IDENTITY_PEER_WIRE.packetMax);let packet;
 try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));}catch{fail('AUTH_IDENTITY_PEER_REQUEST_INVALID');}
 if(!packet||Object.getPrototypeOf(packet)!==Object.prototype||Reflect.ownKeys(packet).length!==2||!Object.hasOwn(packet,'requestRaw')||!Object.hasOwn(packet,'invocationRaw'))fail('AUTH_IDENTITY_PEER_REQUEST_INVALID');
 text(packet.requestRaw);if(packet.invocationRaw!==null)text(packet.invocationRaw);
 if(!Buffer.from(JSON.stringify({requestRaw:packet.requestRaw,invocationRaw:packet.invocationRaw})).equals(raw))fail('AUTH_IDENTITY_PEER_REQUEST_INVALID');
 return Object.freeze({requestRaw:packet.requestRaw,invocationRaw:packet.invocationRaw,requestSha256:createHash('sha256').update(Buffer.from(packet.requestRaw)).digest('hex')});
}
/** Called only after genuine same-request user decision/Native production.
 * Public bytes are not proof authority. Request-bound cancel requires Auth
 * R111's complete matching Native successor; sealed329 cannot consume it.
 * It is a distinct USER_CANCELLED failure, never reject/approve/proof. */
export function encodeIDEIdentityPeerDecision({decision,requestRaw,proof}){
 text(requestRaw);
 if(decision==='approve')return Object.freeze({kind:2,payload:bytes(proof,IDE_IDENTITY_PEER_WIRE.proofMax)});
 if(['reject','cancel'].includes(decision)&&proof===null)return Object.freeze({kind:decision==='reject'?3:4,payload:createHash('sha256').update(Buffer.from(requestRaw)).digest()});
 fail('AUTH_IDENTITY_PEER_RETURN_KIND_INVALID');
}
