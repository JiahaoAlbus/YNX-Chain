import {randomUUID} from 'node:crypto';
import {multiError,exactObject,validateNetwork} from './multichain-config.mjs';
import {address,displayUnits} from './multichain-evm.mjs';

const publicRecord=record=>{const {raw,...publicValue}=record;return publicValue};
export class MultichainService{
  #attempts=new Map();
  #heldSigned=new Map();
  async #retainUnknown(record){
    // Only the original returned signature enters this private hold. Retrying
    // custody persistence never signs, reserves a new nonce or submits bytes.
    this.#heldSigned.set(record.id,{...record,state:'unknown'});
    const stored=(await this.journal.list(record.network.id,record.account)).find(r=>r.id===record.id);
    if(!stored)throw multiError('MULTICHAIN_UNKNOWN_INTENT','Keep the original signed custody.');
    if(stored.state==='prepared')await this.journal.transition(record.id,{state:'signed',raw:record.raw,hash:record.hash,updatedAt:Math.max(stored.updatedAt,record.updatedAt)});
    else if(stored.raw!==record.raw||stored.hash!==record.hash)throw multiError('MULTICHAIN_INTENT_CONFLICT','Keep the original signed custody.');
    await this.journal.transition(record.id,{state:'unknown',updatedAt:Math.max(stored.updatedAt,record.updatedAt)});
    this.#heldSigned.delete(record.id);
  }
  constructor({config,journal,adapter,getContext,withSecret,now=Date.now,id=randomUUID}){Object.assign(this,{config,journal,adapter,getContext,withSecret,now,id});this.epoch=0;this.reviews=new Map();this.mutating=false;this.sending=false}
  invalidate(){this.epoch++;this.reviews.clear()}
  async context({unlocked=false}={}){const context=await this.getContext();if(!context.account)throw multiError('MULTICHAIN_ACCOUNT_REQUIRED','Select an existing account first.');if(unlocked&&context.locked)throw multiError('MULTICHAIN_LOCKED','Unlock Wallet first.');return {...context,account:address(context.account),epoch:this.epoch}}
  async assert(context,revision){const current=await this.context();if(this.mutating||current.account!==context.account||current.revision!==context.revision||current.epoch!==context.epoch||current.locked!==context.locked||revision!==undefined&&(await this.config.read()).revision!==revision)throw multiError('MULTICHAIN_CONTEXT_CHANGED','Account, network or Wallet protection changed. Review again.')}
  async snapshot(){const context=await this.context(),config=await this.config.read();await this.assert(context,config.revision);return {...config,account:context.account}}
  async mutate(action){if(this.mutating||this.sending)throw multiError('MULTICHAIN_BUSY','Finish the current operation first.');this.mutating=true;this.invalidate();try{return await action()}finally{this.mutating=false;this.invalidate()}}
  async putNetwork(input){const network=validateNetwork(input);return this.mutate(async()=>{await this.adapter.verify(network);return this.config.putNetwork(input)})}
  select(id){return this.mutate(()=>this.config.select(id))}
  remove(id){return this.mutate(async()=>{if([...this.#heldSigned.values()].some(r=>r.network.id===id)||await this.journal.pendingNetwork(id))throw multiError('MULTICHAIN_RESOLUTION_REQUIRED','Keep this network until its recorded transactions are resolved.');return this.config.remove(id)})}
  async putToken(input){exactObject(input,['address','decimals','symbol','name']);return this.mutate(async()=>{const config=await this.config.read(),network=config.networks.find(n=>n.id===config.selected);if(!network)throw multiError('MULTICHAIN_NETWORK_REQUIRED','Select a network first.');return this.config.putToken(await this.adapter.token(network,input))})}
  async removeToken(input){exactObject(input,['networkId','address']);return this.mutate(()=>this.config.removeToken(input.networkId,address(input.address)))}
  async selected(unlocked=false){if(this.mutating)throw multiError('MULTICHAIN_BUSY','Network configuration is changing.');const context=await this.context({unlocked}),config=await this.config.read(),network=config.networks.find(n=>n.id===config.selected);if(!network)throw multiError('MULTICHAIN_NETWORK_REQUIRED','Select a saved EVM network.');await this.assert(context,config.revision);return {context,config,network}}
  async balances(){const {context,config,network}=await this.selected(),assets=[{address:'native',name:network.name,symbol:network.symbol,decimals:18},...config.tokens.filter(t=>t.networkId===network.id)];const result=[];for(const asset of assets){try{const amount=await this.adapter.balance(network,context.account,asset.address==='native'?null:asset);result.push({...asset,amount,display:displayUnits(amount,asset.decimals),error:null})}catch(error){result.push({...asset,amount:null,display:null,error:error.code??'MULTICHAIN_RPC_UNAVAILABLE'})}await this.assert(context,config.revision)}return {account:context.account,networkId:network.id,configRevision:config.revision,assets:result}}
  async prepare(input){exactObject(input,['asset','to','amount']);const {context,config,network}=await this.selected(true);if(this.sending)throw multiError('MULTICHAIN_BUSY','A send is already being recorded.');if([...this.#heldSigned.values()].some(r=>r.network.id===network.id&&r.account===context.account)||(await this.journal.blocking(network.id,context.account)).length)throw multiError('MULTICHAIN_RESOLUTION_REQUIRED','Check the unresolved transaction before sending another.');const asset=input.asset==='native'?null:config.tokens.find(t=>t.networkId===network.id&&t.address===input.asset);if(input.asset!=='native'&&!asset)throw multiError('MULTICHAIN_UNKNOWN_ASSET','Select an imported asset on this network.');const to=address(input.to),prepared=await this.adapter.prepare(network,context.account,asset,to,input.amount);await this.assert(context,config.revision);const id=this.id(),review={id,network,account:context.account,asset:asset?.address??'native',symbol:asset?.symbol??network.symbol,decimals:asset?.decimals??18,to,...prepared,expiresAt:this.now()+120000};this.reviews.clear();this.reviews.set(id,{review,context,revision:config.revision});return structuredClone(review)}
  async cancel(id){
    const attempt=this.#attempts.get(id);
    if(!attempt)return {cancelled:this.reviews.delete(id),reason:'review-only'};
    if(attempt.submissionStarted)return {cancelled:false,reason:'submit-started',hash:attempt.hash??null};
    attempt.cancelled=true;await attempt.done;
    return attempt.cancellation??{cancelled:false,reason:'record-needs-resolution',hash:attempt.hash??null};
  }
  async send(id,guard){
    const entry=this.reviews.get(id);if(!entry||entry.review.expiresAt<=this.now())throw multiError('MULTICHAIN_REVIEW_EXPIRED','Prepare and review the transfer again.');if(this.sending)throw multiError('MULTICHAIN_BUSY','A send is already being recorded.');
    this.sending=true;this.reviews.delete(id);let record,reservationStarted=false,reserved=false,signatureCreated=false,signed=false,permit,finish;
    const attempt={cancelled:false,submissionStarted:false,hash:null,done:new Promise(resolve=>{finish=resolve})};this.#attempts.set(id,attempt);
    try{
      const {review,context,revision}=entry;
      const assertAttempt=()=>{if(attempt.cancelled)throw multiError('MULTICHAIN_CANCELLED','The original transfer was cancelled before submission.');if(review.expiresAt<=this.now())throw multiError('MULTICHAIN_REVIEW_EXPIRED','Prepare and review the transfer again.')};
      const live=async()=>{guard.assert();assertAttempt();await this.assert(context,revision);guard.assert();assertAttempt()};
      await live();if(guard.account?.toLowerCase()!==review.account)throw multiError('MULTICHAIN_ACCOUNT_CHANGED','The authorization account changed.');await this.adapter.verify(review.network);await live();
      record={id:review.id,network:review.network,account:review.account,nonce:review.transaction.nonce,asset:review.asset,to:review.to,amount:review.amount,transaction:review.transaction,state:'prepared',raw:null,hash:null,receipt:null,createdAt:this.now(),updatedAt:this.now()};
      await this.adapter.validateSend(record.network,record);await live();
      reservationStarted=true;permit=await this.journal.reserve(record);reserved=true;await live();
      const result=await this.withSecret(async(secret,identity,keyGuard)=>{await live();keyGuard.assert();if(identity.account.toLowerCase()!==record.account)throw multiError('MULTICHAIN_ACCOUNT_CHANGED','Signing account changed.');return this.adapter.sign(secret,record)});
      // Capture before any awaited post-sign gate. A returned signature is not
      // "before sign", even if its durable write has not completed.
      record={...record,raw:result.raw,hash:result.hash,state:'signed',updatedAt:this.now()};signatureCreated=true;attempt.hash=record.hash;this.#heldSigned.set(record.id,record);
      this.adapter.verifySigned(record.raw,record);await this.journal.transition(record.id,{state:'signed',raw:record.raw,hash:record.hash,updatedAt:record.updatedAt});signed=true;this.#heldSigned.delete(record.id);await live();
      await this.adapter.validateSend(record.network,record);await live();
      try{await guard.submit(()=>{assertAttempt();permit.beginSubmit();attempt.submissionStarted=true;return this.adapter.broadcast(record.network,record)});record={...record,state:'submitted',updatedAt:this.now()};await this.journal.transition(record.id,{state:'submitted',updatedAt:record.updatedAt})}
      catch(error){if(!attempt.submissionStarted)throw error;record={...record,state:'unknown',updatedAt:this.now()};await this.journal.transition(record.id,{state:'unknown',updatedAt:record.updatedAt})}
      return publicRecord(record);
    }catch(error){
      // Never broadcast unless signed bytes were durably committed. An uncertain
      // disk commit is retained and blocks another nonce; it is not replayed.
      if(signatureCreated&&!signed){
        await this.#retainUnknown(record).catch(()=>{});
        attempt.cancellation={cancelled:false,reason:'record-needs-resolution',hash:record.hash};
        throw Object.assign(multiError('MULTICHAIN_RECORDED_OUTCOME_UNKNOWN','Signed custody persistence is uncertain. Keep the original record.'),{data:{code:'MULTICHAIN_RECORDED_OUTCOME_UNKNOWN',outcomeUnknown:true,transactionHash:record.hash}});
      }
      if(attempt.cancelled&&!attempt.submissionStarted){
        try{
          if(reservationStarted&&!reserved)throw error;
          if(signed)await permit.cancelSigned(this.now());
          else if(reserved)await this.journal.transition(record.id,{state:'cancelled',updatedAt:this.now()});
          attempt.cancellation={cancelled:true,reason:signed?'local-cancelled-before-broadcast':'cancelled-before-sign',hash:record?.hash??null};
          throw multiError('MULTICHAIN_CANCELLED','The original attempt was cancelled before submission; any signed record is retained.');
        }catch(cancellationError){
          if(cancellationError.code==='MULTICHAIN_CANCELLED')throw cancellationError;
          attempt.cancellation={cancelled:false,reason:'record-needs-resolution',hash:record?.hash??null};
          throw Object.assign(multiError('MULTICHAIN_RECORDED_OUTCOME_UNKNOWN','Cancellation persistence is uncertain. Keep and check the original record.'),{data:{code:'MULTICHAIN_RECORDED_OUTCOME_UNKNOWN',outcomeUnknown:true,transactionHash:record?.hash??null}});
        }
      }
      if(reserved&&!signed){try{await this.journal.transition(record.id,{state:'cancelled',updatedAt:this.now()})}catch{}}
      if(signed){await this.#retainUnknown(record).catch(()=>{});throw Object.assign(multiError('MULTICHAIN_RECORDED_OUTCOME_UNKNOWN','Signed bytes are recorded. Check the original transaction; do not send again.'),{data:{code:'MULTICHAIN_RECORDED_OUTCOME_UNKNOWN',outcomeUnknown:true,transactionHash:record.hash}});}
      throw error;
    }finally{permit?.retire();this.sending=false;this.#attempts.delete(id);finish()}
  }
  async history(){const {context,config,network}=await this.selected(),records=await this.journal.list(network.id,context.account);for(const held of this.#heldSigned.values()){if(held.network.id===network.id&&held.account===context.account){const index=records.findIndex(r=>r.id===held.id);if(index<0)records.push(structuredClone(held));else records[index]=structuredClone(held)}}await this.assert(context,config.revision);return {account:context.account,networkId:network.id,configRevision:config.revision,records:records.map(publicRecord).reverse()}}
  async check(id){if(this.sending)throw multiError('MULTICHAIN_BUSY','Wait until the send has been recorded.');const {context,config,network}=await this.selected();const held=this.#heldSigned.get(id);if(held){if(held.network.id!==network.id||held.account!==context.account)throw multiError('MULTICHAIN_UNKNOWN_INTENT','Transaction not found for this account and network.');await this.#retainUnknown(held);await this.assert(context,config.revision)}const record=(await this.journal.list(network.id,context.account)).find(r=>r.id===id);if(!record)throw multiError('MULTICHAIN_UNKNOWN_INTENT','Transaction not found for this account and network.');if(['cancelled','local-cancelled-before-broadcast'].includes(record.state))return publicRecord(record);let next;if(record.state==='prepared')next={state:'cancelled',receipt:null};else{try{next=await this.adapter.reconcile(network,record)}catch{next={state:'unknown',receipt:null}}}await this.assert(context,config.revision);await this.journal.transition(id,{...next,updatedAt:this.now()});return publicRecord({...record,...next});}
}

/** Production mount uses the existing trusted-main-frame and key lifecycle gates. */
export function installMultichainIPC({handle,safe,sensitive,service,getGuard}){
  const methods={snapshot:()=>service.snapshot(),network:input=>service.putNetwork(input),select:id=>service.select(id),remove:id=>service.remove(id),token:input=>service.putToken(input),'remove-token':input=>service.removeToken(input),balances:()=>service.balances(),cancel:id=>service.cancel(id),history:()=>service.history(),check:id=>service.check(id)};
  for(const [name,action] of Object.entries(methods))handle('wallet:multichain-'+name,(_event,input)=>safe(()=>action(input)));
  handle('wallet:multichain-prepare',(_event,input)=>sensitive(()=>service.prepare(input)));
  handle('wallet:multichain-send',(_event,id)=>sensitive(()=>service.send(id,getGuard())));
}
