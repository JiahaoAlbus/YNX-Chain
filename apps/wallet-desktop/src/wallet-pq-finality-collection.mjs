import {types} from 'node:util';
import {exactData,readPQTransferOriginal} from './features/pq-transaction/transfer-binding.mjs';
import {parsePQTransferFinalityCollector} from './features/pq-transaction/finality-collector.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
// Original Main's read-only collector. Neither a 200 response, saved proof,
// returned observation nor this controller can release or mutate an outbox.
export function createPQFinalityCollection({intentStore,networkId,evidence,transport}){
 let active=false,pending=null;
 const binding=plan=>({account:plan.original.account,networkId});
 async function enter(hash,guard,action){
  if(active)fail('PQ_FINALITY_COLLECTION_IN_PROGRESS');
  guard.assert();active=true;
  try{const plan=await readPQTransferOriginal(intentStore,hash,{account:guard.account,networkId,guard});return await action(plan);}finally{active=false;}
 }
 async function observation(plan,ref){
  const raw=await evidence.read(plan.original,binding(plan),ref);
  const parsed=parsePQTransferFinalityCollector(plan.original,binding(plan),ref.httpStatus,raw);
  return Object.freeze({...parsed.observation,hash:plan.original.hash,evidence:ref,rawStored:true,proofCollected:parsed.proof!==null,clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false});
 }
 return Object.freeze({
  assertSafeToClose(){if(active||pending)fail('PQ_FINALITY_EVIDENCE_UNCONFIRMED');evidence.assertSafeToClose();},
  async collect(hash,guard){
   if(pending)fail('PQ_FINALITY_EVIDENCE_UNCONFIRMED');evidence.assertSafeToClose();
   if(typeof transport?.readFinalityProof!=='function')fail('PQ_FINALITY_TRANSPORT_NOT_SUPPLIED');
   return enter(hash,guard,async plan=>{
    guard.assert();const response=await transport.readFinalityProof(plan.original,binding(plan));
    if(types.isProxy(response))fail('PQ_FINALITY_RESPONSE_INVALID');exactData(response,['status','rawBytes'],'PQ_FINALITY_RESPONSE_INVALID');
    // Capture complete authenticated HTTP bytes/status BEFORE post-await lock
    // checks or any UTF-8/JSON/proof interpretation. No outward write follows.
    pending=plan;
    let ref;
    try{ref=await evidence.append(plan.original,binding(plan),'collector-http',response.rawBytes,{httpStatus:response.status});pending=null;}
    catch(error){if(!evidence.pending())pending=null;throw error;}
    const result=await observation(plan,ref);guard.assert();return result;
   });
  },
  async save(hash,guard){
   return enter(hash,guard,async plan=>{
    const held=evidence.pending();
    if(!pending||!held||pending.original.account!==plan.original.account||pending.original.hash!==plan.original.hash||pending.original.operationId!==plan.original.operationId)fail('PQ_FINALITY_NO_HELD_EVIDENCE');
    guard.assert();const ref=await evidence.flush(held.eventId);pending=null;
    const result=await observation(plan,ref);guard.assert();return result;
   });
  },
  async restore(hash,guard){
   return enter(hash,guard,async plan=>{
    const found=await evidence.candidates(plan.original,binding(plan));guard.assert();const records=[];
    for(const ref of found.candidates){
     if(ref.kind!=='collector-http')continue;
     let rawStored=false;
     try{
      const raw=await evidence.read(plan.original,binding(plan),ref);rawStored=true;
      const parsed=parsePQTransferFinalityCollector(plan.original,binding(plan),ref.httpStatus,raw);
      records.push(Object.freeze({...parsed.observation,hash:plan.original.hash,evidence:ref,rawStored:true,proofCollected:parsed.proof!==null,clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false}));
     }catch{records.push(Object.freeze({evidence:ref,rawStored,status:'evidence-unverified',clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false}));}
     guard.assert();
    }
    guard.assert();return Object.freeze({account:plan.original.account,hash:plan.original.hash,operationId:plan.original.operationId,records:Object.freeze(records),unreadable:found.unreadable,heldLocally:pending?.original.hash===plan.original.hash&&pending.original.account===plan.original.account&&pending.original.operationId===plan.original.operationId,clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false});
   });
  },
 });
}
