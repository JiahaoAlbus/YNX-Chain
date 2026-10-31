// Renderer-only view. No Node, ethers, key material, raw transactions or signing.
// api is the original preload's bounded cross-chain IPC surface.
const copy={
  en:{title:'Cross-chain test transfer',route:'Ethereum Sepolia → Base Sepolia',asset:'Circle native test USDC',notice:'Test networks only. Each approval, burn and claim requires its own Wallet confirmation. Once sent, check the original transaction; this route has no automatic refund.',amount:'Amount (USDC)',recipient:'Recipient on Base Sepolia',protocol:'Maximum protocol fee (USDC)',source:'Maximum ETH gas fee per source action (wei)',destination:'Maximum ETH gas fee for claim (wei)',quote:'Review route and fees',start:'Confirm route',prepare:'Review next transaction',confirm:'Confirm and send this transaction',check:'Check original transfer',cancel:'Cancel before sending',history:'Restore transfer history',busy:'Working…',waiting:'No automatic resend. Check the original transaction to continue.',completed:'Destination mint finalized and receipt verified.',failed:'This transaction reverted. The original records are retained.',minimum:'Minimum received (USDC units)',error:'Could not complete this action. The original transfer is retained.',state:'Transfer status',approve:'USDC approval',burn:'Send and burn test USDC',mint:'Claim original test USDC',cancelled:'Cancelled before sending'},
  zh:{title:'测试资产跨链',route:'Ethereum Sepolia → Base Sepolia',asset:'Circle 原生测试 USDC',notice:'仅测试网。授权、源链发送和目标领取均须分别确认。发送后只追踪原交易；这条路线不支持自动退款。',amount:'金额（USDC）',recipient:'Base Sepolia 收款地址',protocol:'协议费用上限（USDC）',source:'源链每次操作的 ETH 手续费上限（wei）',destination:'目标领取的 ETH 手续费上限（wei）',quote:'查询路线与费用',start:'确认跨链路线',prepare:'预览下一笔交易',confirm:'确认并发送此交易',check:'查询原跨链交易',cancel:'发送前取消',history:'恢复交易记录',busy:'处理中…',waiting:'不会自动重发，请查询原交易继续。',completed:'目标铸币已最终确认，到账凭据已核对。',failed:'此交易已回退，原记录已保留。',minimum:'最低到账（USDC 最小单位）',error:'本次操作未完成，原交易记录已保留。',state:'交易状态',approve:'USDC 授权',burn:'发送并销毁源链测试 USDC',mint:'领取原笔测试 USDC',cancelled:'已在发送前取消'}
};

export function mountCctpUI({root,api,locale='en'}){
  const text=copy[locale.startsWith('zh')?'zh':'en'],doc=root.ownerDocument;
  const discard=locale.startsWith('zh')?'取消当前预览':'Discard current review';
  const discarded=locale.startsWith('zh')?'已取消当前预览，原交易记录仍保留；继续前请重新预览。':'Current review discarded. Original transactions are retained; review again to continue.';
  const recovering=locale.startsWith('zh')?'上次操作结果仍待核对，请恢复记录并查询原交易。':'The previous request needs reconciliation. Restore history and check the original transfer.';
  const timedOut=locale.startsWith('zh')?'等待钱包响应超时，请恢复记录或查询原交易。':'Wallet response timed out. Restore history or check the original transfer.';
  const receiptText=locale.startsWith('zh')?{
    quotedFee:'本次查询协议费（USDC）',rate:'本次查询费率（基点）',stepStatus:'状态',transaction:'交易哈希',destination:'目标回执状态',hash:'回执交易哈希',block:'回执区块高度',blockHash:'回执区块哈希',scope:'确认范围',finalized:'最终确认区块高度',finalizedHash:'最终确认区块哈希',fee:'证明中的协议费（USDC）',claim:'证明中的领取金额（USDC）',received:'本笔到账（USDC）',balance:'目标链当前余额（USDC）',balanceScope:'余额说明',balanceNote:'当前余额不能单独证明本笔跨链到账。'
  }:{
    quotedFee:'Quoted protocol fee (USDC)',rate:'Quoted fee rate (bps)',stepStatus:' status',transaction:' transaction',destination:'Destination receipt state',hash:'Receipt transaction',block:'Receipt block',blockHash:'Receipt block hash',scope:'Confirmation scope',finalized:'Finalized block',finalizedHash:'Finalized block hash',fee:'Attested protocol fee (USDC)',claim:'Attested claim amount (USDC)',received:'Received in this transfer (USDC)',balance:'Current target balance (USDC)',balanceScope:'Balance evidence',balanceNote:'Balance alone does not confirm this transfer.'
  };
  const isFinalized=value=>{
    const target=value?.destination,receipt=target?.receipt,mint=value?.operations?.find(op=>op.step==='mint'&&op.state!=='cancelled');
    const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v),height=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v);
    return value?.state==='completed'&&target?.state==='finalized'&&receipt?.status===1&&receipt.confirmationScope==='rpc-finalized-block'&&
      hash(receipt.hash)&&receipt.hash===mint?.hash&&hash(receipt.blockHash)&&hash(receipt.finalizedBlockHash)&&height(receipt.blockNumber)&&height(receipt.finalizedBlockNumber)&&BigInt(receipt.finalizedBlockNumber)>=BigInt(receipt.blockNumber)&&Boolean(value.proof);
  };
  const transferMessage=value=>isFinalized(value)?text.completed:value?.state==='failed'?text.failed:text.waiting;
  const mutations=new Set(['start','prepare','confirm','cancel']);
  const preflightText=locale.startsWith('zh')?{check:'检查路线可用性',stop:'停止路线检查',cancelled:'已停止本次路线检查。',unknown:'尚未核实两条链的身份与 genesis pin。',verified:'链身份与 genesis pin 已核实',unverified:'尚未核实',source:'源链 Ethereum Sepolia',destination:'目标链 Base Sepolia',scope:'此结果仅表示网络身份检查；报价、批准和到账均须单独核实。'}:{check:'Check route availability',stop:'Stop route check',cancelled:'Route check cancelled.',unknown:'Chain identities and genesis pins have not been checked.',verified:'Chain identity and genesis pin verified',unverified:'Unverified',source:'Source Ethereum Sepolia',destination:'Destination Base Sepolia',scope:'This checks network identity only. Fees, approval and arrival need separate verification.'};
  const preflightIssue=code=>{const zh=locale.startsWith('zh');if(code==='CCTP_NETWORK_REQUIRED')return zh?'请先在钱包网络设置中保存这条链及其已核实的 genesis pin。':'Save this chain and its verified genesis pin in Wallet network settings.';if(code==='CCTP_NETWORK_AMBIGUOUS')return zh?'这条链有多个网络配置，请先核对配置。':'Multiple saved networks match this chain; review the network configuration.';if(code==='CCTP_NETWORK_INVALID')return zh?'已保存的网络配置未通过校验，请核对原配置。':'The saved network configuration could not be validated.';if(code==='MULTICHAIN_NETWORK_MISMATCH'||code==='CCTP_NETWORK_MISMATCH')return zh?'RPC 返回的链身份与已保存的 pin 不匹配。':'The RPC identity does not match the saved chain and genesis pin.';if(code==='MULTICHAIN_RPC_TIMEOUT'||code==='CCTP_PREFLIGHT_TIMEOUT')return zh?'网络身份查询超时，本次仍为未核实。':'The network identity query timed out; this result remains unverified.';return zh?'RPC 暂时无法提供可核验的链身份与 genesis。':'The RPC could not provide verifiable chain identity and genesis.'};
  let disposed=false,generation=0,busy=null,recovery=null,quote=null,record=null,review=null,preflight=null;
  const el=(tag,value)=>{const node=doc.createElement(tag);if(value!==undefined)node.textContent=value;return node};
  const title=el('h2',text.title),route=el('p',text.route+' · '+text.asset),notice=el('p',text.notice),form=el('div'),status=el('p'),details=el('dl'),actions=el('div'),history=el('div'),availability=el('section');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const fields={};
  for(const [name,label,value] of [['amount','amount',''],['recipient','recipient',''],['maxProtocolFee','protocol','0'],['maxSourceGasFeeWei','source','1000000000000000'],['maxDestinationGasFeeWei','destination','1000000000000000']]){
    const wrap=el('label',text[label]),input=el('input');input.type='text';input.autocomplete='off';input.value=value;input.setAttribute('aria-label',text[label]);wrap.append(input);form.append(wrap);fields[name]=input;
    input.addEventListener('input',()=>{quote=null;preflight=null;generation++;render()});
  }
  root.replaceChildren(title,route,notice,availability,form,status,details,actions,history);
  const show=(label,value)=>{details.append(el('dt',label),el('dd',String(value)))};
  const usdc=value=>{const raw=String(value);if(!/^(0|[1-9][0-9]*)$/.test(raw))return '—';const padded=raw.padStart(7,'0'),fraction=padded.slice(-6).replace(/0+$/,'');return padded.slice(0,-6)+(fraction?'.'+fraction:'')};
  const retain=request=>{if(request&&mutations.has(request.method)&&(busy?.request===request||recovery===request))recovery=request};
  const invoke=async(method,input)=>{
    const task=busy,request={method,input,intentId:method==='confirm'?input.id:method==='start'?null:input,settled:false,result:null};
    task.request=request;let timer;
    // This deadline ends only the renderer wait. It does not cancel, retry or
    // replace the original main-process operation or its custody approval.
    const stopped=new Promise((_,reject)=>{
      task.stop=()=>{retain(request);reject(new Error(recovering))};
      timer=setTimeout(()=>{retain(request);reject(new Error(timedOut))},120000);
    });
    if(method==='preflight')render();
    const response=Promise.resolve().then(()=>api[method](input)).then(result=>{request.settled=true;request.result=result;return result},error=>{request.settled=true;retain(request);throw error});
    try{const result=await Promise.race([response,stopped]);if(result?.ok!==true)throw new Error(result?.error?.message??text.error);return result.value}
    finally{clearTimeout(timer);task.stop=null}
  };
  const recovered=(method,result)=>{
    if(!recovery)return;
    if(method==='history'&&recovery.method==='start'){
      const original=result.find(item=>item.binding?.quoteId===recovery.input);
      if(original)recovery.intentId=original.id;
      // A completed failed start followed by a fresh empty history has no
      // durable route to check. An unresolved start remains fenced.
      else if(recovery.settled&&recovery.result?.ok===false)recovery=null;
    }else if(method==='check'&&recovery.intentId===result.id)recovery=null;
  };
  const work=async(action,readOnly=false)=>{
    if(busy||disposed||recovery&&!readOnly)return;const task={request:null,stop:null};busy=task;const ticket=generation;status.textContent=text.busy;render();
    try{await action(ticket)}catch(error){if(!disposed&&ticket===generation)status.textContent=typeof error?.message==='string'?error.message:text.error}
    finally{if(busy===task)busy=null;if(!disposed)render()}
  };
  const button=(label,action,readOnly=false)=>{const b=el('button',label);b.type='button';b.disabled=Boolean(busy);b.addEventListener('click',()=>work(action,readOnly));actions.append(b);return b};
  const runPreflight=async ticket=>{
    quote=null;preflight=null;render();
    const result=await invoke('preflight',{routeId:'cctp-v2-sepolia-base-sepolia-usdc'});
    if(disposed||ticket!==generation)return false;
    if(!result||result.routeId!=='cctp-v2-sepolia-base-sepolia-usdc'||!['canSign','approved','canRetry','targetReceived'].every(key=>result[key]===false)||![['source',11155111],['destination',84532]].every(([side,chain])=>result[side]?.chainId===chain&&['verified','unverified'].includes(result[side]?.status))||result.available!==(result.source.status==='verified'&&result.destination.status==='verified'))throw new Error(text.error);
    preflight=result;status.textContent=recovery?recovering:'';render();return result.available===true;
  };
  function render(){
    if(disposed)return;details.replaceChildren();actions.replaceChildren();availability.replaceChildren();
    availability.append(el('h3',preflightText.check));
    if(!preflight)availability.append(el('p',preflightText.unknown));
    else for(const side of ['source','destination']){const value=preflight[side];availability.append(el('p',preflightText[side]+' · '+value.chainId+' · '+(value.status==='verified'?preflightText.verified:preflightText.unverified)),el('p','Genesis: '+(value.genesis??'—')));if(value.status!=='verified')availability.append(el('p',preflightIssue(value.errorCode)),el('p',value.stage+' · '+value.errorCode));}
    availability.append(el('p',preflightText.scope));
    button(preflightText.check,async ticket=>{await runPreflight(ticket);if(!disposed&&ticket===generation)status.textContent=recovery?recovering:''},true);
    if(busy?.request?.method==='preflight'){const stop=el('button',preflightText.stop);stop.type='button';stop.addEventListener('click',()=>{if(busy?.request?.method!=='preflight')return;generation++;busy.stop?.();busy=null;preflight=null;quote=null;status.textContent=recovery?recovering:preflightText.cancelled;render()});actions.append(stop);}
    for(const input of Object.values(fields))input.disabled=Boolean(busy||recovery||record&&!['completed','failed','cancelled'].includes(record.state));
    if(quote){show(text.route,text.asset);show(text.amount,usdc(quote.amountUnits));show(text.minimum.replace(' (USDC units)',' (USDC)').replace('（USDC 最小单位）','（USDC）'),usdc(quote.minimumReceivedUnits));show(receiptText.quotedFee,usdc(quote.availability?.requiredFeeUnits));show(receiptText.rate,typeof quote.availability?.feeBps==='string'&&/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,6})?$/.test(quote.availability.feeBps)?quote.availability.feeBps:'—');show(text.protocol,usdc(quote.maxFeeUnits));show(text.source,quote.maxSourceGasFeeWei);show(text.destination,quote.maxDestinationGasFeeWei);show(text.recipient,quote.recipient)}
    if(record){
      show(text.state,record.state);
      for(const op of record.operations??[]){const step=text[op.step]??op.step;show(step+receiptText.stepStatus,op.state);if(op.hash)show(step+receiptText.transaction,op.hash)}
      if(record.proof){if(record.proof.nonce)show('CCTP nonce',record.proof.nonce);show(receiptText.fee,usdc(record.proof.feeExecuted));show(isFinalized(record)?receiptText.received:receiptText.claim,usdc(record.proof.amountReceived))}
      const target=record.destination,receipt=target?.receipt;
      if(target){show(receiptText.destination,target.state);if(receipt){for(const [label,key] of [['hash','hash'],['block','blockNumber'],['blockHash','blockHash'],['scope','confirmationScope'],['finalized','finalizedBlockNumber'],['finalizedHash','finalizedBlockHash']])if(receipt[key]!=null)show(receiptText[label],receipt[key])}if(target.balanceUnits!=null){show(receiptText.balance,usdc(target.balanceUnits));show(receiptText.balanceScope,receiptText.balanceNote)}}
    }
    if(review&&!recovery){show(text[review.step]??review.step,review.transaction?.to??'');show('ETH fee (wei)',review.fee??'');show(text.recipient,record?.binding.recipient??'');button(text.confirm,async ticket=>{
      // Consume before IPC: a failed response cannot prove custody/send did not run.
      const original=review;review=null;
      record={...record,state:original.step==='approve'?'approval-pending':original.step==='burn'?'burn-pending':'mint-pending',operations:[...(record.operations??[]).filter(o=>o.id!==original.id),{id:original.id,step:original.step,state:'unknown',hash:null}]};
      render();
      const result=await invoke('confirm',{id:record.id,reviewId:original.id});if(disposed||ticket!==generation)return;record=result;status.textContent=text.waiting})}
    if(!recovery&&(!record||['completed','failed','cancelled'].includes(record.state)))button(text.quote,async ticket=>{quote=null;if(!await runPreflight(ticket))return;const input=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value.trim()]));const result=await invoke('quote',{routeId:'cctp-v2-sepolia-base-sepolia-usdc',asset:'USDC',...input});if(disposed||ticket!==generation)return;quote=result;record=null;review=null;status.textContent=''});
    if(!recovery&&quote&&!record)button(text.start,async ticket=>{const result=await invoke('start',quote.quoteId);if(disposed||ticket!==generation)return;record=result;quote=null;status.textContent=''});
    if(record&&(!['completed','cancelled'].includes(record.state)||recovery?.intentId===record.id)){
      if(!recovery&&!review&&['ready','burn-ready','mint-ready'].includes(record.state)&&!(record.operations??[]).some(o=>o.state==='review'))button(text.prepare,async ticket=>{const result=await invoke('prepare',record.id);if(disposed||ticket!==generation)return;review=result;record={...record,operations:[...(record.operations??[]),{id:result.id,step:result.step,state:'review',hash:null}]};status.textContent=''});
      button(text.check,async ticket=>{const result=await invoke('check',record.id);if(disposed||ticket!==generation)return;recovered('check',result);record=result;review=null;status.textContent=transferMessage(record)},true);
      const active=(record.operations??[]).filter(o=>o.state!=='cancelled'),current=active.at(-1),prior=active.slice(0,-1);
      if(!recovery&&['ready','burn-ready','mint-ready'].includes(record.state)&&(!current||current.state==='review'&&current.hash===null)&&prior.every(o=>o.state==='included'))button(prior.length?discard:text.cancel,async ticket=>{review=null;preflight=null;render();const result=await invoke('cancel',record.id);if(disposed||ticket!==generation)return;record=result.record;status.textContent=result.cancelled?(result.reason==='review-only'?discarded:text.cancelled):text.waiting});
    }
    button(text.history,async ticket=>{const records=await invoke('history');if(disposed||ticket!==generation)return;recovered('history',records);history.replaceChildren();for(const item of [...records].reverse()){const b=el('button',`${item.state} · ${item.binding.recipient} · ${usdc(item.binding.amountUnits)} USDC`);b.type='button';b.addEventListener('click',()=>{if(busy)return;generation++;record=item;review=null;quote=null;preflight=null;status.textContent=recovery?recovering:transferMessage(record);render()});history.append(b)}status.textContent=recovery?recovering:''},true);
  }
  render();
  return {invalidate(){generation++;retain(busy?.request);busy?.stop?.();busy=null;quote=null;review=null;record=null;preflight=null;history.replaceChildren();status.textContent=recovery?recovering:'';render()},dispose(){disposed=true;generation++;busy?.stop?.();busy=null;root.replaceChildren()}};
}
