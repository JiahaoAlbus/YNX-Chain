import {types} from 'node:util';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {readPQFinalityOriginal as readPQTransferOriginal} from './wallet-pq-finality-original.mjs';
import {parsePQTransferFinalityCollector} from './features/pq-transaction/finality-collector.mjs';
import {inspectPQReviewedTypedActionFinalityCollector} from './features/pq-transaction/typed-action-finality.mjs';
import {readPQFinalityVerifierEvidence} from './wallet-pq-verifier-restore.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
// Original Main's read-only collector. Neither a 200 response, saved proof,
// returned observation nor this controller can release or mutate an outbox.
export function createPQFinalityCollection({intentStore,networkId,evidence,transport,typedTransport=null,verification=null}){
 let active=false,pending=null;
 const binding=plan=>({account:plan.original.account,networkId});
 async function enter(hash,guard,action){
  if(active)fail('PQ_FINALITY_COLLECTION_IN_PROGRESS');
  guard.assert();active=true;
  try{const plan=await readPQTransferOriginal(intentStore,hash,{account:guard.account,networkId,guard});return await action(plan);}finally{active=false;}
 }
 async function observation(plan,ref){
  const raw=await evidence.read(plan.original,binding(plan),ref);
  const parsed=parse(plan,ref,raw);
  return Object.freeze({...parsed.observation,hash:plan.original.hash,evidence:ref,rawStored:true,proofCollected:parsed.proof!==null,clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false});
 }
 function parse(plan,ref,raw){
  if(!plan.typed)return parsePQTransferFinalityCollector(plan.original,binding(plan),ref.httpStatus,raw);
  if(!ref.http)fail('PQ_TYPED_FINALITY_HTTP_METADATA_REQUIRED');
  const t=plan.typed;return inspectPQReviewedTypedActionFinalityCollector(t.review,t.raw,t.original,{...ref.http,status:ref.httpStatus,body:raw});
 }
 const api=Object.freeze({
  retire(){verification?.retire();},
  join:()=>verification?.join(),
  assertSafeToClose(){if(active||pending)fail('PQ_FINALITY_EVIDENCE_UNCONFIRMED');verification?.assertSafeToClose();evidence.assertSafeToClose();},
  async verify(hash,guard){
   if(typeof verification?.verify!=='function')fail('PQ_HOST_SOURCE_NOT_SUPPLIED');
   const collected=await api.collect(hash,guard);
   if(!collected.proofCollected)fail('PQ_FINALITY_PROOF_NOT_COLLECTED');
   return enter(hash,guard,async plan=>{
    const raw=await evidence.read(plan.original,binding(plan),collected.evidence);guard.assert();
    const parsed=parse(plan,collected.evidence,raw);
    if(parsed.proof===null)fail('PQ_FINALITY_PROOF_NOT_COLLECTED');
    return verification.verify(plan.original,binding(plan),parsed.proof,guard);
   });
  },
  async collect(hash,guard){
   if(pending||verification?.pending())fail('PQ_FINALITY_EVIDENCE_UNCONFIRMED');evidence.assertSafeToClose();
   return enter(hash,guard,async plan=>{
    if(typeof (plan.typed?typedTransport?.readOriginalProof:transport?.readFinalityProof)!=='function')fail('PQ_FINALITY_TRANSPORT_NOT_SUPPLIED');
    guard.assert();const t=plan.typed,response=t?await typedTransport.readOriginalProof(t.review,t.raw,t.original,()=>guard.assert()):await transport.readFinalityProof(plan.original,binding(plan));
    if(types.isProxy(response))fail('PQ_FINALITY_RESPONSE_INVALID');exactData(response,t?['method','requestPath','status','contentType','cacheControl','body']:['status','rawBytes'],'PQ_FINALITY_RESPONSE_INVALID');
    // Capture complete authenticated HTTP bytes/status BEFORE post-await lock
    // checks or any UTF-8/JSON/proof interpretation. No outward write follows.
    pending=plan;
    let ref;
    try{ref=await evidence.append(plan.original,binding(plan),'collector-http',t?response.body:response.rawBytes,{httpStatus:response.status,...(t?{http:{method:response.method,requestPath:response.requestPath,contentType:response.contentType,cacheControl:response.cacheControl}}:{})});pending=null;}
    catch(error){if(!evidence.pending())pending=null;throw error;}
    const result=await observation(plan,ref);guard.assert();return result;
   });
  },
  async save(hash,guard){
   return enter(hash,guard,async plan=>{
    if(!pending&&verification?.pending())return verification.save(plan.original,binding(plan),guard);
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
     if(ref.kind!=='collector-http'&&ref.kind!=='verifier-result')continue;
     let rawStored=false;
     try{
      const raw=await evidence.read(plan.original,binding(plan),ref);rawStored=true;
      if(ref.kind==='verifier-result'){records.push(await readPQFinalityVerifierEvidence(plan.original,binding(plan),evidence,ref));guard.assert();continue;}
      const parsed=parse(plan,ref,raw);
      records.push(Object.freeze({...parsed.observation,hash:plan.original.hash,evidence:ref,rawStored:true,proofCollected:parsed.proof!==null,clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false}));
     }catch{records.push(Object.freeze({evidence:ref,rawStored,status:'evidence-unverified',clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false}));}
     guard.assert();
    }
    guard.assert();return Object.freeze({account:plan.original.account,hash:plan.original.hash,operationId:plan.original.operationId,records:Object.freeze(records),unreadable:found.unreadable,heldLocally:verification?.pending(plan.original)===true||pending?.original.hash===plan.original.hash&&pending.original.account===plan.original.account&&pending.original.operationId===plan.original.operationId,clearsOriginal:false,consensusFinality:false,independentFinality:false,canRetry:false});
   });
  },
 });return api;
}
