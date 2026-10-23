import {randomUUID} from 'node:crypto';
import {exactObject,multiError,publicMultiErrorCode} from './multichain-config.mjs';
import {BitcoinReadAdapter} from './multichain-bitcoin.mjs';
import {createFamilyReadTransport} from './multichain-family-transport.mjs';
import {FamilyOperationGate} from './multichain-family-operation-gate.mjs';
const fail=code=>{throw multiError(code,'Keep and check the original Bitcoin transaction.');};
export class FamilyBitcoinSubmission {
  #reviews=new Map();
  constructor({journal,networks,getContext,gate=new FamilyOperationGate(),now=Date.now,id=randomUUID,createReader=network=>new BitcoinReadAdapter({network:network.network,request:createFamilyReadTransport({family:'bitcoin',networkId:network.network,baseURL:network.rpcUrl})}),createSender=async network=>{const {createBitcoinBroadcastTransport}=await import('./multichain-bitcoin-broadcast.mjs');return createBitcoinBroadcastTransport({networkId:network.network,baseURL:network.rpcUrl});}}){Object.assign(this,{journal,networks,getContext,gate,now,id,createReader,createSender});}
  invalidate(){this.#reviews.clear();}
  async review(input){
    exactObject(input,['id']);const context=await this.getContext();if(context.locked||context.authenticating||!context.account)fail('MULTICHAIN_LOCKED');
    const record=(await this.journal.list()).find(r=>r.id===input.id);
    if(!record||record.account!==context.account||record.family!=='bitcoin'||record.state!=='signed-unsubmitted'||!record.result)fail('FAMILY_RESOLUTION_REQUIRED');
    const revision=(await this.networks.read()).revision,current=await this.getContext();
    if(current.locked||current.account!==context.account||current.revision!==context.revision)fail('MULTICHAIN_CONTEXT_CHANGED');
    const reviewId=this.id(),expiresAt=this.now()+120000;
    this.#reviews.clear();this.#reviews.set(reviewId,{record,context,revision,expiresAt});
    const request=record.request.operation.previewRequest;
    return {reviewId,id:record.id,family:'bitcoin',network:record.networkId,vaultAccount:record.account,rpcUrl:record.request.network.rpcUrl,from:request.from,to:request.to,amount:request.amount,changeAddress:request.changeAddress,feeSats:record.result.produced.feeSats,txid:record.result.txid,expiresAt};
  }
  cancel(input){exactObject(input,['reviewId']);return {cancelled:this.#reviews.delete(input.reviewId)};}
  async send(input,guard){return this.gate.run(()=>this.#sendOriginal(input,guard));}
  async #sendOriginal(input,guard){
    exactObject(input,['reviewId']);const review=this.#reviews.get(input.reviewId);if(!review||this.now()>=review.expiresAt)fail('BTC_REQUEST_EXPIRED');this.#reviews.delete(input.reviewId);
    const {record,context}=review;let fenced=false,dispatchStarted=false;
    const live=async()=>{guard?.assert();if(guard?.account!==context.account||typeof guard?.submit!=='function')fail('FAMILY_SUBMIT_AUTHORITY_REQUIRED');const active=await this.getContext();if(active.locked||active.authenticating||active.account!==context.account||active.revision!==context.revision||(await this.networks.read()).revision!==review.revision||this.now()>=review.expiresAt)fail('MULTICHAIN_CONTEXT_CHANGED');guard.assert();};
    try{
      await live();const latest=(await this.journal.list()).find(r=>r.id===record.id);
      if(!latest||latest.state!=='signed-unsubmitted'||latest.binding!==record.binding||latest.resultDigest!==record.resultDigest||latest.revision!==record.revision)fail('FAMILY_RESOLUTION_REQUIRED');
      const reader=await this.createReader(record.request.network);await reader.verify();await live();
      const original=record.request.operation,inputs=record.outpoints.map(value=>{const [txid,vout]=value.split(':');return {txid,vout:Number(vout)};});
      const proofs=await reader.fetchPrevoutProofs(inputs);await live();
      if(JSON.stringify(proofs.previousTransactions)!==JSON.stringify(original.previousTransactions)||proofs.unspentChecks.length!==inputs.length||proofs.unspentChecks.some((p,i)=>p.network!==record.networkId||p.txid!==inputs[i].txid||p.vout!==inputs[i].vout||p.spent!==false))fail('BTC_UNSPENT_CHECK_REQUIRED');
      const sender=await this.createSender(record.request.network);await live();
      // Durable uncertainty is written before the external boundary. A lost ACK
      // or crash must never leave a replayable signed-unsubmitted record.
      await this.journal.fenceSubmission(record);fenced=true;await live();
      const observation=await guard.submit(()=>{dispatchStarted=true;return sender({network:record.networkId,txid:record.result.txid,rawTransaction:record.result.produced.rawTransaction});});
      exactObject(observation,['networkId','txid','state','receipt']);
      if(observation.networkId!==record.networkId||observation.txid!==record.result.txid||!['submitted-unconfirmed','unknown'].includes(observation.state)||observation.receipt!==null)fail('FAMILY_SUBMISSION_UNKNOWN');
      await this.journal.finishSubmission(record,{state:observation.state,evidence:{phase:observation.state==='submitted-unconfirmed'?'rpc-accepted':'dispatch-outcome-unknown'}});
      return {id:record.id,family:'bitcoin',network:record.networkId,txid:record.result.txid,state:observation.state};
    }catch(error){if(fenced){
      let cleanupCausePresent=false,cleanupCause;
      try{await this.journal.finishSubmission(record,{state:'unknown',evidence:{phase:dispatchStarted?'dispatch-outcome-unknown':'not-dispatched',error:publicMultiErrorCode(error,'FAMILY_SUBMISSION_UNKNOWN')}});}catch(cause){cleanupCausePresent=true;cleanupCause=cause;}
      throw Object.assign(multiError('FAMILY_SUBMISSION_UNKNOWN','Keep and check the original Bitcoin transaction.'),{cause:error,cleanupCausePresent,cleanupCause});
    }throw error;}
  }
}
