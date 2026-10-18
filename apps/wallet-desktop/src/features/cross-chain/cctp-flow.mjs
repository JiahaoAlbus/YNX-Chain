import {randomUUID} from 'node:crypto';
import {AtomicMultiFile, exactObject, multiError,validateNetwork} from '../../multichain-config.mjs';
import {address, units} from '../../multichain-evm.mjs';
import {ROUTE,decodeAndValidateMessage} from './cctp-wire.mjs';

const fail=(code,message)=>{throw multiError('CCTP_'+code,message)};
const uint=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]*)$/.test(v)&&BigInt(v)<(1n<<256n);
const identifier=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const clone=v=>structuredClone(v);
const states=new Set(['ready','approval-pending','burn-ready','burn-pending','attestation-pending','mint-ready','mint-pending','completed','failed','cancelled']);
const terminal=new Set(['completed','failed','cancelled']);
const unresolved=r=>!terminal.has(r.state)||r.state==='failed'&&r.operations.some(o=>o.step==='burn'&&o.state==='included');
const steps=['approve','burn','mint'];

export function validateCctpBinding(q){
  exactObject(q,['routeId','account','recipient','amountUnits','maxFeeUnits','maxSourceGasFeeWei','maxDestinationGasFeeWei','sourceNetwork','destinationNetwork','context','configRevision','expiresAt','quoteId']);
  if(q.routeId!==ROUTE.id||address(q.account)!==q.account||address(q.recipient)!==q.recipient||!identifier(q.quoteId)||![q.amountUnits,q.maxFeeUnits,q.maxSourceGasFeeWei,q.maxDestinationGasFeeWei].every(uint)||BigInt(q.amountUnits)<=BigInt(q.maxFeeUnits)||BigInt(q.maxSourceGasFeeWei)===0n||BigInt(q.maxDestinationGasFeeWei)===0n||!Number.isSafeInteger(q.expiresAt)||!Number.isSafeInteger(q.configRevision)||!q.context)fail('INVALID_BINDING','Invalid cross-chain review binding.');
  if(BigInt(q.sourceNetwork.chainId)!==BigInt(ROUTE.source.chainId)||BigInt(q.destinationNetwork.chainId)!==BigInt(ROUTE.destination.chainId))fail('UNSUPPORTED_ROUTE','Only the named USDC testnet route is available.');
  if(q.context.account!==q.account)fail('ACCOUNT_CHANGED','Review context belongs to another account.');
  for(const network of [q.sourceNetwork,q.destinationNetwork]){const {id,family,...data}=network;if(family!=='evm'||validateNetwork(data).id!==id)fail('NETWORK_CHANGED','The pinned network identity is invalid.');}
  return q;
}
export function validateCctpStore(value){
  exactObject(value,['version','records']);
  if(value.version!==1||!Array.isArray(value.records)||value.records.length>256)fail('STORE_INVALID','Preserve the original cross-chain history.');
  const ids=new Set();
  for(const r of value.records){
    exactObject(r,['id','revision','binding','state','operations','proof','destination','firstError','createdAt','updatedAt']);
    validateCctpBinding(r.binding);
    if(!identifier(r.id)||ids.has(r.id)||!Number.isSafeInteger(r.revision)||r.revision<0||!states.has(r.state)||!Array.isArray(r.operations)||r.operations.length>3||!Number.isSafeInteger(r.createdAt)||!Number.isSafeInteger(r.updatedAt)||r.updatedAt<r.createdAt)fail('STORE_INVALID','Invalid cross-chain record.');
    ids.add(r.id);
    const seen=new Set();
    for(const op of r.operations){
      exactObject(op,['step','id','state','hash']);
      if(!steps.includes(op.step)||seen.has(op.step)||!identifier(op.id)||!['review','dispatching','unknown','submitted','included','reverted','cancelled'].includes(op.state)||op.hash!==null&&!hash(op.hash))fail('STORE_INVALID','Invalid original operation reference.');
      seen.add(op.step);
    }
    if(r.proof!==null){
      exactObject(r.proof,['message','attestation','nonce','sourceTxHash','feeExecuted','amountReceived']);
      const burn=r.operations.find(x=>x.step==='burn');
      if(!hash(r.proof.nonce)||!burn||burn.hash!==r.proof.sourceTxHash||!/^0x(?:[0-9a-f]{130}){1,20}$/i.test(r.proof.attestation))fail('STORE_INVALID','Invalid recorded attestation.');
      const decoded=decodeAndValidateMessage(r.proof.message,{...r.binding,destinationBlockNumber:'0'});
      if(decoded.nonce!==r.proof.nonce||decoded.feeExecuted!==r.proof.feeExecuted||decoded.amountReceived!==r.proof.amountReceived)fail('STORE_INVALID','Recorded message fields differ from the original burn.');
    }
    if(r.state==='completed'){
      const mint=r.operations.find(x=>x.step==='mint'),receipt=r.destination?.receipt;
      if(r.destination?.state!=='finalized'||!r.proof||!mint||!hash(mint.hash)||receipt?.hash!==mint.hash||receipt.status!==1||receipt.confirmationScope!=='rpc-finalized-block'||!hash(receipt.blockHash)||!hash(receipt.finalizedBlockHash)||!uint(receipt.blockNumber)||!uint(receipt.finalizedBlockNumber)||BigInt(receipt.finalizedBlockNumber)<BigInt(receipt.blockNumber))fail('STORE_INVALID','Completion requires the original finalized destination receipt.');
    }
  }
  return value;
}

/** One instance per original Wallet main process; original profile files are not modified. */
export class CctpStore {
  constructor({filePath,file}={}){this.file=file??new AtomicMultiFile({filePath,initial:{version:1,records:[]},validate:validateCctpStore,maxBytes:4_000_000})}
  async list(account){return (await this.file.read()).records.filter(r=>r.binding.account===account).map(clone)}
  async pendingNetwork(networkId){return (await this.file.read()).records.filter(r=>unresolved(r)&&[r.binding.sourceNetwork.id,r.binding.destinationNetwork.id].includes(networkId)).length}
  async get(id){const r=(await this.file.read()).records.find(r=>r.id===id);if(!r)fail('NOT_FOUND','Original cross-chain transfer was not found.');return clone(r)}
  async insert(r){await this.file.mutate(v=>{if(v.records.some(x=>x.id===r.id||x.binding.account===r.binding.account&&unresolved(x)))fail('UNRESOLVED','Resolve the existing cross-chain transfer first.');v.records.push(clone(r));return v});return clone(r)}
  async update(id,revision,mutate){let result;await this.file.mutate(v=>{const r=v.records.find(x=>x.id===id);if(!r||r.revision!==revision)fail('CONFLICT','The original transfer changed. Read its current result.');const immutable=JSON.stringify(r.binding);mutate(r);if(JSON.stringify(r.binding)!==immutable)fail('BINDING_CHANGED','The original transfer inputs cannot change.');r.revision++;result=clone(r);return v});return result}
}

/**
 * wallet is the ORIGINAL MultichainService with the owner's closed CCTP extension:
 * context/assert/snapshot, prepareCctpStep, send, cancel, checkCctpStep.
 * It owns custody, nonce reservation, exact signed-byte verification and approvals.
 * This coordinator never handles a secret, raw transaction or signer callback.
 */
export class CctpFlow {
  #quotes=new Map(); #reviews=new Map(); #busy=new Set(); #uncertain=new Set(); #quoteRevision=0;
  constructor({wallet,reader,store,now=Date.now,id=randomUUID}){Object.assign(this,{wallet,reader,store,now,id})}
  routes(){return [{...clone(ROUTE),available:true,mode:'standard',slippageBps:0,refundSupported:false}];}
  async #live(q,guard){guard?.assert();await this.wallet.assert(q.context,q.configRevision);guard?.assert();}
  async #owned(id){const context=await this.wallet.context();const r=await this.store.get(id);if(context.account!==r.binding.account)fail('ACCOUNT_CHANGED','Select the account that owns this transfer.');return r}
  async #run(id,action){if(this.#busy.has(id))fail('BUSY','The original operation is still in progress.');this.#busy.add(id);try{return await action()}finally{this.#busy.delete(id)}}
  async #save(r,action){try{return await this.store.update(r.id,r.revision,v=>{action(v);v.updatedAt=Math.max(v.updatedAt,this.now())})}catch(e){this.#uncertain.add(r.id);throw e}}
  async quote(input){
    exactObject(input,['routeId','asset','amount','recipient','maxProtocolFee','maxSourceGasFeeWei','maxDestinationGasFeeWei']);
    if(input.routeId!==ROUTE.id||input.asset!=='USDC')fail('UNSUPPORTED_ROUTE','YNX and other routes are unavailable; no supported bridge is configured.');
    const ticket=++this.#quoteRevision,context=await this.wallet.context({unlocked:true}),snapshot=await this.wallet.snapshot();
    const pick=chain=>{const values=snapshot.networks.filter(n=>BigInt(n.chainId)===BigInt(chain));if(values.length!==1)fail('NETWORK_REQUIRED','Save exactly one verified network for each side of this route.');return clone(values[0])};
    const amountUnits=units(input.amount,6).toString(),maxFeeUnits=input.maxProtocolFee==='0'?'0':units(input.maxProtocolFee,6).toString();
    const q=validateCctpBinding({routeId:ROUTE.id,account:address(context.account),recipient:address(input.recipient),amountUnits,maxFeeUnits,maxSourceGasFeeWei:input.maxSourceGasFeeWei,maxDestinationGasFeeWei:input.maxDestinationGasFeeWei,sourceNetwork:pick(ROUTE.source.chainId),destinationNetwork:pick(ROUTE.destination.chainId),context:clone(context),configRevision:snapshot.revision,expiresAt:this.now()+120000,quoteId:this.id()});
    const availability=await this.reader.quote(q);await this.#live(q);
    if(ticket!==this.#quoteRevision)fail('QUOTE_REPLACED','A newer route review replaced this quote.');
    if(BigInt(availability.requiredFeeUnits)>BigInt(q.maxFeeUnits))fail('FEE_LIMIT','Protocol fee exceeds the reviewed maximum.');
    this.#quotes.clear();this.#quotes.set(q.quoteId,q);
    return {...clone(q),availability,minimumReceivedUnits:(BigInt(amountUnits)-BigInt(maxFeeUnits)).toString(),slippageBps:0,gasFees:'Each approve, burn and mint has a separate native ETH fee review.',service:'Circle CCTP V2 burn and mint; Circle attestation required; no automatic refund.'};
  }
  async start(quoteId){
    const q=this.#quotes.get(quoteId);if(!q||q.expiresAt<=this.now())fail('QUOTE_EXPIRED','Review current route fees again.');this.#quotes.delete(quoteId);await this.#live(q);
    const r={id:this.id(),revision:0,binding:clone(q),state:'ready',operations:[],proof:null,destination:null,firstError:null,createdAt:this.now(),updatedAt:this.now()};
    return this.store.insert(r);
  }
  async prepareStep(id){return this.#run(id,async()=>{
    let r=await this.#owned(id);
    if(this.#uncertain.has(id))fail('PERSISTENCE_UNKNOWN','Keep and query the original record; persistence is uncertain.');
    if(!['ready','burn-ready','mint-ready'].includes(r.state))fail('CHECK_ORIGINAL','Query the recorded operation; it cannot be sent again.');
    const context=await this.wallet.context({unlocked:true}),snapshot=await this.wallet.snapshot();
    if(address(context.account)!==r.binding.account||snapshot.account!==undefined&&address(snapshot.account)!==r.binding.account)fail('ACCOUNT_CHANGED','The original transfer belongs to the previously selected account.');
    // An old quote is never a current signing grant. Refresh original context,
    // while pinning every network/recipient/asset/amount and maximum fee.
    for(const n of [r.binding.sourceNetwork,r.binding.destinationNetwork])if(!snapshot.networks.some(x=>JSON.stringify(x)===JSON.stringify(n)))fail('NETWORK_CHANGED','Restore the original network identity before continuing.');
    const current={...r.binding,context,configRevision:snapshot.revision,expiresAt:this.now()+120000};
    const availability=r.state==='mint-ready'?null:await this.reader.quote(current);await this.#live(current);
    if(availability&&BigInt(availability.requiredFeeUnits)>BigInt(current.maxFeeUnits))fail('FEE_LIMIT','Current fee exceeds the original approved maximum.');
    let step=r.state==='mint-ready'?'mint':'burn';
    if(r.state==='ready'&&BigInt(availability.allowanceUnits)<BigInt(r.binding.amountUnits))step='approve';
    if(r.operations.some(o=>o.step===step))fail('CHECK_ORIGINAL','This step already has an original operation. Query it instead.');
    const review=await this.wallet.prepareCctpStep({intentId:r.id,step,binding:clone(current),proof:clone(r.proof)});
    await this.#live(current);
    if(!identifier(review?.id)||review.step!==step||review.intentId!==r.id)fail('REVIEW_MISMATCH','The original Wallet returned a different step review.');
    r=await this.#save(r,v=>{v.operations.push({step,id:review.id,state:'review',hash:null})});
    this.#reviews.set(review.id,{intentId:id,current,expiresAt:review.expiresAt});
    return clone(review);
  })}
  async confirmStep(input,guard){exactObject(input,['id','reviewId']);return this.#run(input.id,async()=>{
    let r=await this.#owned(input.id);const op=r.operations.find(x=>x.id===input.reviewId),review=this.#reviews.get(input.reviewId);
    if(this.#uncertain.has(r.id)||!op||op.state!=='review'||!review||review.intentId!==r.id||review.expiresAt<=this.now())fail('CHECK_ORIGINAL','Review is no longer live. Query the original operation.');
    await this.#live(review.current,guard);this.#reviews.delete(op.id);
    // Commit a non-replayable barrier BEFORE entering original Wallet send.
    r=await this.#save(r,v=>{v.operations.find(x=>x.id===op.id).state='dispatching';v.state=op.step==='approve'?'approval-pending':op.step==='burn'?'burn-pending':'mint-pending'});
    try{
      await this.#live(review.current,guard);
      const result=await this.wallet.send(op.id,guard);
      if(result?.id!==op.id||!hash(result.hash)||!['submitted','unknown','included','reverted'].includes(result.state))fail('RESULT_UNKNOWN','The original operation result needs reconciliation.');
      r=await this.#save(r,v=>{Object.assign(v.operations.find(x=>x.id===op.id),{state:result.state,hash:result.hash})});
    }catch(error){
      if(!this.#uncertain.has(r.id))r=await this.#save(r,v=>{v.operations.find(x=>x.id===op.id).state='unknown';v.firstError??=typeof error.code==='string'?error.code:'CCTP_OUTCOME_UNKNOWN'});
    }
    return r;
  })}
  async check(id){return this.#run(id,async()=>{
    let r=await this.#owned(id);if(!unresolved(r))return r;
    const op=r.operations.at(-1);
    if(op&&op.state!=='review'){
      // Even dispatching/UNKNOWN after restart only reaches the original lookup.
      const observed=await this.wallet.checkCctpStep({id:op.id,network:op.step==='mint'?r.binding.destinationNetwork:r.binding.sourceNetwork,account:r.binding.account});
      if(observed?.id!==op.id||op.hash&&observed.hash!==op.hash||observed.hash!==null&&!hash(observed.hash))fail('RESULT_MISMATCH','Original transaction identity changed.');
      if(['included','reverted','submitted','unknown','signing-unknown','prepared','signed'].includes(observed.state)){
        r=await this.#save(r,v=>{Object.assign(v.operations.find(x=>x.id===op.id),{state:['included','reverted','submitted'].includes(observed.state)?observed.state:'unknown',hash:observed.hash});if(observed.state==='reverted')v.state='failed';else if(observed.state==='included')v.state=op.step==='approve'?'burn-ready':op.step==='burn'?'attestation-pending':'mint-pending'});
      }else fail('RESULT_UNKNOWN','Keep the original transaction and its result.');
    }
    if(r.state==='attestation-pending'){
      const burn=r.operations.find(x=>x.step==='burn');
      const proof=await this.reader.attestation({...r.binding,sourceTxHash:burn.hash});
      if(proof){if(proof.sourceTxHash!==burn.hash||r.proof&&r.proof.nonce!==proof.nonce)fail('RESULT_MISMATCH','Attestation belongs to another source transaction or nonce.');r=await this.#save(r,v=>{v.proof=clone(proof);v.state='mint-ready'})}
    }
    if(r.state==='mint-pending'){
      const mint=r.operations.find(x=>x.step==='mint');
      if(mint.hash){const destination=await this.reader.destination({...r.binding,...r.proof,transactionHash:mint.hash});r=await this.#save(r,v=>{v.destination=clone(destination);if(destination.state==='finalized')v.state='completed';else if(destination.state==='reverted')v.state='failed'})}
    }
    this.#uncertain.delete(id);return r;
  })}
  async cancel(id){return this.#run(id,async()=>{
    const r=await this.#owned(id);if(r.operations.some(x=>x.state!=='review'))return {cancelled:false,reason:'query-original',record:r};
    for(const op of r.operations){const result=await this.wallet.cancel(op.id);if(!result?.cancelled&&result?.reason!=='review-only')fail('CANCEL_UNKNOWN','The original operation cancellation is not confirmed.');this.#reviews.delete(op.id)}
    return {cancelled:true,record:await this.#save(r,v=>{v.state='cancelled';for(const op of v.operations)op.state='cancelled'})};
  })}
  async history(){const context=await this.wallet.context();return this.store.list(context.account)}
}

/** Mount only through the existing trusted-frame handler and lifecycle wrappers. */
export function installCctpIPC({handle,safe,sensitive,flow,getGuard}){
  const read={routes:()=>flow.routes(),history:()=>flow.history(),check:id=>flow.check(id)};
  for(const [name,action] of Object.entries(read))handle('wallet:cross-chain-'+name,(_event,input)=>safe(()=>action(input)));
  const review={quote:input=>flow.quote(input),start:id=>flow.start(id),prepare:id=>flow.prepareStep(id),cancel:id=>flow.cancel(id)};
  for(const [name,action] of Object.entries(review))handle('wallet:cross-chain-'+name,(_event,input)=>sensitive(()=>action(input)));
  handle('wallet:cross-chain-confirm',(_event,input)=>sensitive(()=>flow.confirmStep(input,getGuard())));
}
