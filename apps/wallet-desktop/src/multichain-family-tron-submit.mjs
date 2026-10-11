import {randomUUID} from 'node:crypto';
import {exactObject,multiError} from './multichain-config.mjs';
import {FamilyOperationGate} from './multichain-family-operation-gate.mjs';
import {createFamilyReadTransport} from './multichain-family-transport.mjs';
import {TronPreflight} from './multichain-tron-preflight.mjs';
import {tronAddress,tronDisplay,verifyTronSigned} from './multichain-tron.mjs';
const fail=code=>{throw multiError(code,'Keep and check the original TRON transaction.');};
export class FamilyTronSubmission {
  #reviews=new Map();
  constructor({journal,networks,getContext,gate=new FamilyOperationGate(),now=Date.now,id=randomUUID,createPreflight=network=>{const transport=createFamilyReadTransport({family:'tron',networkId:network.network,baseURL:network.rpcUrl});return new TronPreflight({network:{id:network.network,genesisBlockId:network.genesis},transport:(route,body,chain)=>transport(chain,route,body),now});},createSender=async network=>{const {createTronBroadcastTransport}=await import('./multichain-tron-broadcast.mjs');return createTronBroadcastTransport({networkId:network.network,baseURL:network.rpcUrl});}}){Object.assign(this,{journal,networks,getContext,gate,now,id,createPreflight,createSender});}
  invalidate(){this.#reviews.clear();}
  async review(input){
    exactObject(input,['id']);const context=await this.getContext();if(context.locked||context.authenticating||!context.account)fail('MULTICHAIN_LOCKED');
    const record=(await this.journal.list()).find(r=>r.id===input.id);
    if(!record||record.account!==context.account||record.family!=='tron'||record.state!=='signed-unsubmitted'||!record.result)fail('FAMILY_RESOLUTION_REQUIRED');
    const {intent,context:original,feeBudget}=record.request.operation;
    // Legacy records without a reviewed fee budget remain queryable. They do
    // not acquire new broadcast authority or invented fees on recovery.
    if(!feeBudget)fail('TRON_ORIGINAL_FEE_BUDGET_REQUIRED');
    verifyTronSigned(record.result.produced.transaction,intent,original,this.now());
    const revision=(await this.networks.read()).revision,current=await this.getContext();if(current.locked||current.authenticating||current.account!==context.account||current.revision!==context.revision)fail('MULTICHAIN_CONTEXT_CHANGED');
    const reviewId=this.id(),expiresAt=Math.min(this.now()+120000,Number(original.expiration));this.#reviews.clear();this.#reviews.set(reviewId,{record,context,revision,expiresAt});
    return {reviewId,id:record.id,family:'tron',network:record.networkId,vaultAccount:record.account,rpcUrl:record.request.network.rpcUrl,from:tronAddress(intent.owner).base58,to:tronAddress(intent.to).base58,amount:tronDisplay(intent.units,intent.decimals),symbol:intent.asset==='trx'?'TRX':'TRC20',contract:intent.contract?tronAddress(intent.contract).base58:null,maxFeeSun:feeBudget.maxFeeSun,energyFeeLimitSun:original.feeLimitSun,txid:record.result.txid,expiresAt};
  }
  cancel(input){exactObject(input,['reviewId']);return {cancelled:this.#reviews.delete(input.reviewId)};}
  async send(input,guard){return this.gate.run(()=>this.#send(input,guard));}
  async #send(input,guard){
    exactObject(input,['reviewId']);const review=this.#reviews.get(input.reviewId);if(!review||this.now()>=review.expiresAt)fail('TRON_REQUEST_EXPIRED');this.#reviews.delete(input.reviewId);
    const {record,context}=review;let fenced=false,dispatchStarted=false;
    const live=async()=>{guard?.assert();if(guard?.account!==context.account||typeof guard?.submit!=='function')fail('FAMILY_SUBMIT_AUTHORITY_REQUIRED');const active=await this.getContext();if(active.locked||active.authenticating||active.account!==context.account||active.revision!==context.revision||(await this.networks.read()).revision!==review.revision||this.now()>=review.expiresAt)fail('MULTICHAIN_CONTEXT_CHANGED');guard.assert();};
    try{
      await live();const latest=(await this.journal.list()).find(r=>r.id===record.id);if(!latest||latest.state!=='signed-unsubmitted'||latest.binding!==record.binding||latest.resultDigest!==record.resultDigest||latest.revision!==record.revision)fail('FAMILY_RESOLUTION_REQUIRED');
      const {intent,context:original,feeBudget}=record.request.operation;
      const preflight=await this.createPreflight(record.request.network),fresh=await preflight.prepare({owner:intent.owner,to:intent.to,asset:intent.asset,amount:tronDisplay(intent.units,intent.decimals),decimals:intent.decimals,...(intent.contract?{contract:intent.contract}:{}),derivationIndex:original.derivationIndex,permissionId:0,feeLimitSun:original.feeLimitSun,maxFeeSun:feeBudget.maxFeeSun});await live();
      if(fresh.networkId!==record.networkId||fresh.networkGenesis!==record.request.network.genesis||fresh.intent.binding!==intent.binding||fresh.context.feeLimitSun!==original.feeLimitSun||fresh.verification!=='provider-reported-not-consensus')fail('FAMILY_RECOVERY_BINDING');
      // The fresh unsigned preview is diagnostic only. Never replace the saved
      // original TAPOS, lifetime, bytes, signature or transaction ID with it.
      verifyTronSigned(record.result.produced.transaction,intent,original,this.now());
      const sender=await this.createSender(record.request.network);await live();
      await this.journal.fenceSubmission(record);fenced=true;await live();
      const observation=await guard.submit(()=>{dispatchStarted=true;return sender({network:record.networkId,txid:record.result.txid,transaction:record.result.produced.transaction});});
      exactObject(observation,['networkId','txid','state','receipt']);if(observation.networkId!==record.networkId||observation.txid!==record.result.txid||!['submitted-unconfirmed','unknown'].includes(observation.state)||observation.receipt!==null)fail('FAMILY_SUBMISSION_UNKNOWN');
      await this.journal.finishSubmission(record,{state:observation.state,evidence:{phase:observation.state==='submitted-unconfirmed'?'rpc-accepted':'dispatch-outcome-unknown'}});
      return {id:record.id,family:'tron',network:record.networkId,txid:record.result.txid,state:observation.state};
    }catch(error){if(fenced){await this.journal.finishSubmission(record,{state:'unknown',evidence:{phase:dispatchStarted?'dispatch-outcome-unknown':'not-dispatched',error:typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'FAMILY_SUBMISSION_UNKNOWN'}}).catch(()=>{});fail('FAMILY_SUBMISSION_UNKNOWN');}throw error;}
  }
}
