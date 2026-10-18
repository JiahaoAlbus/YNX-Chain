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
const activeOperations=r=>r.operations.filter(op=>op.state!=='cancelled');
const activeStep=(r,step)=>activeOperations(r).find(op=>op.step===step);
const pendingState=step=>step==='approve'?'approval-pending':step==='burn'?'burn-pending':'mint-pending';
const maxOperations=32;
const preflightErrors=new Set(['MULTICHAIN_NETWORK_MISMATCH','MULTICHAIN_RPC_TIMEOUT','MULTICHAIN_RPC_ERROR','CCTP_NETWORK_MISMATCH','CCTP_PREFLIGHT_TIMEOUT','CCTP_PREFLIGHT_UNAVAILABLE']);

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
    if(!identifier(r.id)||ids.has(r.id)||!Number.isSafeInteger(r.revision)||r.revision<0||!states.has(r.state)||!Array.isArray(r.operations)||r.operations.length>maxOperations||!Number.isSafeInteger(r.createdAt)||!Number.isSafeInteger(r.updatedAt)||r.updatedAt<r.createdAt)fail('STORE_INVALID','Invalid cross-chain record.');
    ids.add(r.id);
    const seen=new Set(),operationIds=new Set();
    for(const op of r.operations){
      exactObject(op,['step','id','state','hash']);
      if(!steps.includes(op.step)||op.state!=='cancelled'&&seen.has(op.step)||!identifier(op.id)||operationIds.has(op.id)||!['review','dispatching','unknown','submitted','included','reverted','cancelled'].includes(op.state)||op.hash!==null&&(!hash(op.hash)||['review','cancelled'].includes(op.state))||['included','submitted','reverted'].includes(op.state)&&!hash(op.hash))fail('STORE_INVALID','Invalid original operation reference.');
      operationIds.add(op.id);if(op.state!=='cancelled')seen.add(op.step);
    }
    if(r.proof!==null){
      exactObject(r.proof,['message','attestation','nonce','sourceTxHash','feeExecuted','amountReceived']);
      const burn=activeStep(r,'burn');
      if(!hash(r.proof.nonce)||!burn||burn.hash!==r.proof.sourceTxHash||!/^0x(?:[0-9a-f]{130}){1,20}$/i.test(r.proof.attestation))fail('STORE_INVALID','Invalid recorded attestation.');
      const decoded=decodeAndValidateMessage(r.proof.message,{...r.binding,destinationBlockNumber:'0'});
      if(decoded.nonce!==r.proof.nonce||decoded.feeExecuted!==r.proof.feeExecuted||decoded.amountReceived!==r.proof.amountReceived)fail('STORE_INVALID','Recorded message fields differ from the original burn.');
    }
    if(r.state==='completed'){
      const mint=activeStep(r,'mint'),receipt=r.destination?.receipt;
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
  #quotes=new Map(); #reviews=new Map(); #busy=new Set(); #uncertain=new Set(); #quoteRevision=0; #preflightRevision=0;
  constructor({wallet,reader,store,now=Date.now,id=randomUUID}){Object.assign(this,{wallet,reader,store,now,id})}
  routes(){return [{...clone(ROUTE),available:false,requiresPreflight:true,mode:'standard',slippageBps:0,refundSupported:false}];}
  async preflight(input){
    const ticket=++this.#preflightRevision;
    exactObject(input,['routeId']);
    if(input.routeId!==ROUTE.id)fail('UNSUPPORTED_ROUTE','Only the named USDC testnet route can be checked.');
    const current=()=>{if(ticket!==this.#preflightRevision)fail('PREFLIGHT_REPLACED','A newer route check replaced this request.')};
    const context=clone(await this.wallet.context({unlocked:true}));current();
    const live=async revision=>{current();await this.wallet.assert(context,revision);current()};
    await live();
    const snapshot=clone(await this.wallet.snapshot());current();
    if(!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||!Array.isArray(snapshot.networks)||snapshot.networks.length>32)fail('NETWORK_INVALID','The saved network snapshot is invalid.');
    await live(snapshot.revision);
    if(address(context.account)!==address(snapshot.account))fail('ACCOUNT_CHANGED','The route check account changed.');
    const side=async(name,route)=>{
      const report={side:name,chainId:route.chainId,networkId:null,genesis:null,status:'unverified',stage:'network-selection',errorCode:null};
      const matches=snapshot.networks.filter(network=>{try{return BigInt(network?.chainId)===BigInt(route.chainId)}catch{return false}});
      if(matches.length!==1)return {...report,errorCode:matches.length?'CCTP_NETWORK_AMBIGUOUS':'CCTP_NETWORK_REQUIRED'};
      let network;
      try{
        exactObject(matches[0],['id','family','name','rpcUrl','chainId','genesis','symbol','decimals']);
        const {id,family,...data}=matches[0];network=validateNetwork(data);
        if(family!=='evm'||id!==network.id)throw Error('Invalid saved network identity');
      }catch{return {...report,stage:'saved-network',errorCode:'CCTP_NETWORK_INVALID'}}
      Object.assign(report,{networkId:network.id,genesis:network.genesis,stage:'rpc-identity'});
      let result;
      try{result=await this.reader.preflightNetwork(network,route)}catch{result=null}
      await live(snapshot.revision);
      try{
        exactObject(result,['status','stage','errorCode']);
        if(Object.keys(result).length!==3||result.stage!=='rpc-identity'||result.status!=='verified'&&result.status!=='unverified'||result.status==='verified'&&result.errorCode!==null||result.status==='unverified'&&!preflightErrors.has(result.errorCode))throw Error('Invalid preflight result');
        return {...report,status:result.status,errorCode:result.errorCode};
      }catch{return {...report,errorCode:'CCTP_PREFLIGHT_UNAVAILABLE'}}
    };
    const [source,destination]=await Promise.all([side('source',ROUTE.source),side('destination',ROUTE.destination)]);
    await live(snapshot.revision);
    return {routeId:ROUTE.id,available:source.status==='verified'&&destination.status==='verified',source,destination,canSign:false,approved:false,canRetry:false,targetReceived:false};
  }
  async #live(q,guard){guard?.assert();await this.wallet.assert(q.context,q.configRevision);guard?.assert();}
  async #owned(id){const context=await this.wallet.context();const r=await this.store.get(id);if(context.account!==r.binding.account)fail('ACCOUNT_CHANGED','Select the account that owns this transfer.');await this.wallet.assert(context);return r}
  async #current(r,options){
    const context=await this.wallet.context(options),snapshot=await this.wallet.snapshot();
    if(address(context.account)!==r.binding.account||snapshot.account!==undefined&&address(snapshot.account)!==r.binding.account)fail('ACCOUNT_CHANGED','The original transfer belongs to the previously selected account.');
    for(const n of [r.binding.sourceNetwork,r.binding.destinationNetwork])if(!snapshot.networks.some(x=>JSON.stringify(x)===JSON.stringify(n)))fail('NETWORK_CHANGED','Restore the original network identity before continuing.');
    const current={...r.binding,context,configRevision:snapshot.revision,expiresAt:this.now()+120000};
    await this.#live(current);return current;
  }
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
    // Older persisted readiness may outlive a source receipt. Keep it readable,
    // but never let that label authorize a new review over an unresolved step.
    if(activeOperations(r).some(op=>op.state!=='included'||!hash(op.hash))||r.state==='mint-ready'&&(!activeStep(r,'burn')||!r.proof))fail('CHECK_ORIGINAL','Query the original steps before reviewing another transaction.');
    // An old quote is never a current signing grant. Refresh original context,
    // while pinning every network/recipient/asset/amount and maximum fee.
    const current=await this.#current(r,{unlocked:true});
    const availability=r.state==='mint-ready'?null:await this.reader.quote(current);await this.#live(current);
    if(availability&&BigInt(availability.requiredFeeUnits)>BigInt(current.maxFeeUnits))fail('FEE_LIMIT','Current fee exceeds the original approved maximum.');
    let step=r.state==='mint-ready'?'mint':'burn';
    if(r.state==='ready'&&BigInt(availability.allowanceUnits)<BigInt(r.binding.amountUnits))step='approve';
    if(activeStep(r,step))fail('CHECK_ORIGINAL','This step already has an original operation. Query it instead.');
    if(r.operations.length>=maxOperations)fail('REVIEW_HISTORY_FULL','Preserve the original review history; no further review can be created.');
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
    const current=await this.#current(r),op=activeOperations(r).at(-1);
    if(op&&op.state!=='review'){
      // Even dispatching/UNKNOWN after restart only reaches the original lookup.
      const observed=await this.wallet.checkCctpStep({id:op.id,network:op.step==='mint'?r.binding.destinationNetwork:r.binding.sourceNetwork,account:r.binding.account});
      await this.#live(current);
      if(observed?.id!==op.id||op.hash&&observed.hash!==op.hash||observed.hash!==null&&!hash(observed.hash)||['included','reverted','submitted'].includes(observed.state)&&!hash(observed.hash))fail('RESULT_MISMATCH','Original transaction identity changed.');
      if(['included','reverted','submitted','unknown','signing-unknown','prepared','signed'].includes(observed.state)){
        // A cached proof can expire while no mint has been reviewed or sent.
        // Re-read only this original burn; retain cached evidence while pending.
        r=await this.#save(r,v=>{Object.assign(v.operations.find(x=>x.id===op.id),{state:['included','reverted','submitted'].includes(observed.state)?observed.state:'unknown',hash:observed.hash});if(observed.state==='reverted')v.state='failed';else if(observed.state==='included')v.state=op.step==='approve'?'burn-ready':op.step==='burn'?'attestation-pending':'mint-pending';else v.state=pendingState(op.step)});
        await this.#live(current);
      }else fail('RESULT_UNKNOWN','Keep the original transaction and its result.');
    }
    if(r.state==='attestation-pending'){
      const burn=activeStep(r,'burn');
      const proof=await this.reader.attestation({...r.binding,sourceTxHash:burn.hash});
      await this.#live(current);
      if(proof){if(proof.sourceTxHash!==burn.hash||r.proof&&r.proof.nonce!==proof.nonce)fail('RESULT_MISMATCH','Attestation belongs to another source transaction or nonce.');r=await this.#save(r,v=>{v.proof=clone(proof);v.state='mint-ready'})}
    }
    if(r.state==='mint-pending'){
      const mint=activeStep(r,'mint');
      if(mint.hash){const destination=await this.reader.destination({...r.binding,...r.proof,transactionHash:mint.hash});await this.#live(current);r=await this.#save(r,v=>{v.destination=clone(destination);if(destination.state==='finalized')v.state='completed';else if(destination.state==='reverted')v.state='failed'})}
    }
    await this.#live(current);this.#uncertain.delete(id);return r;
  })}
  async cancel(id){return this.#run(id,async()=>{
    const r=await this.#owned(id),operations=activeOperations(r),review=operations.at(-1),prior=operations.filter(op=>op!==review);
    // Only discard an unsigned review. A completed prior transaction is retained;
    // dispatching, signed, UNKNOWN and reverted attempts stay query-only.
    if(!['ready','burn-ready','mint-ready'].includes(r.state)||review&&(review.state!=='review'||review.hash!==null)||prior.some(op=>op.state!=='included'))return {cancelled:false,reason:'query-original',record:r};
    const current=await this.#current(r);
    if(review){const result=await this.wallet.cancel(review.id);await this.#live(current);if(result?.reason!=='review-only'||typeof result.cancelled!=='boolean'||result.hash!=null)fail('CANCEL_UNKNOWN','The original operation cancellation is not confirmed as an unsigned review.');this.#reviews.delete(review.id)}
    const record=await this.#save(r,v=>{if(review)v.operations.find(op=>op.id===review.id).state='cancelled';if(!prior.length)v.state='cancelled'});
    await this.#live(current);
    return {cancelled:true,...(prior.length?{reason:'review-only'}:{}),record};
  })}
  async history(){const context=await this.wallet.context(),records=await this.store.list(context.account);await this.wallet.assert(context);return records}
}

/** Mount only through the existing trusted-frame handler and lifecycle wrappers. */
export function installCctpIPC({handle,safe,sensitive,flow,getGuard}){
  const read={routes:()=>flow.routes(),preflight:input=>flow.preflight(input),history:()=>flow.history(),check:id=>flow.check(id)};
  for(const [name,action] of Object.entries(read))handle('wallet:cross-chain-'+name,(_event,input)=>safe(()=>action(input)));
  const review={quote:input=>flow.quote(input),start:id=>flow.start(id),prepare:id=>flow.prepareStep(id),cancel:id=>flow.cancel(id)};
  for(const [name,action] of Object.entries(review))handle('wallet:cross-chain-'+name,(_event,input)=>sensitive(()=>action(input)));
  handle('wallet:cross-chain-confirm',(_event,input)=>sensitive(()=>flow.confirmStep(input,getGuard())));
}
