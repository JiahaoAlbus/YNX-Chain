import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {decodePQMigrationRequest,preparePQMigrationTransport,decodePQTransferRequest,preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const fail=()=>{throw Object.assign(new Error('The original PQ journal record cannot be verified.'),{code:'PQ_ORIGINAL_RECORD_INVALID'});};
export const PQ_ORIGINAL_RESERVE_BYTES=350_000;
export const PQ_ORIGINAL_KINDS=Object.freeze(['pq-migration','pq-transfer']);
/** Public signed output only, never private keys or authorization. The SDK
 * owns wire parsing; a journal read does not verify chain policy or finality. */
export function parsePQOriginalRecord(value){
 try{
  exactPQRecord(value,['version','account','kind','operationId','hash','wire','status']);
  if(value.version!==1||!PQ_ORIGINAL_KINDS.includes(value.kind)||value.status!=='signed-unsubmitted'||typeof value.operationId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.operationId)||typeof value.wire!=='string'||value.wire.length>349526||! /^[A-Za-z0-9_-]+$/.test(value.wire))fail();
  const wire=Buffer.from(value.wire,'base64url');if(!wire.length||wire.length>262144||wire.toString('base64url')!==value.wire)fail();
  const migration=value.kind==='pq-migration',decoded=migration?decodePQMigrationRequest(wire):decodePQTransferRequest(wire),request=migration?preparePQMigrationTransport(wire):preparePQTransferTransport(wire);
  if((migration?decoded.intent.owner:decoded.transfer.from)!==value.account||request.transportHash!==value.hash)fail();
  return Object.freeze({...value});
 }catch{fail();}
}
export function createPQOriginalRecord({account,kind,operationId,request}){
 if(!request||request.method!=='POST'||request.contentType!=='application/octet-stream'||request.admissionIsFinality!==false)fail();
 const wire=request.body;if(!(wire instanceof Uint8Array)||wire.buffer instanceof SharedArrayBuffer)fail();
 if(!PQ_ORIGINAL_KINDS.includes(kind))fail();
 const expected=kind==='pq-migration'?preparePQMigrationTransport(wire):preparePQTransferTransport(wire);
 if(request.path!==expected.path||request.transportHash!==expected.transportHash)fail();
 return parsePQOriginalRecord({version:1,account,kind,operationId,hash:expected.transportHash,wire:Buffer.from(wire).toString('base64url'),status:'signed-unsubmitted'});
}
