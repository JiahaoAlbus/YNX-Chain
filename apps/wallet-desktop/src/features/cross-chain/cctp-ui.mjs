// Renderer-only view. No Node, ethers, key material, raw transactions or signing.
// api is the original preload's bounded cross-chain IPC surface.
const copy={
  en:{title:'Cross-chain test transfer',route:'Ethereum Sepolia → Base Sepolia',asset:'Circle native test USDC',notice:'Test networks only. Each approval, burn and claim requires its own Wallet confirmation. Once sent, check the original transaction; this route has no automatic refund.',amount:'Amount (USDC)',recipient:'Recipient on Base Sepolia',protocol:'Maximum protocol fee (USDC)',source:'Maximum ETH gas fee per source action (wei)',destination:'Maximum ETH gas fee for claim (wei)',quote:'Review route and fees',start:'Confirm route',prepare:'Review next transaction',confirm:'Confirm and send this transaction',check:'Check original transfer',cancel:'Cancel before sending',history:'Restore transfer history',busy:'Working…',waiting:'No automatic resend. Check the original transaction to continue.',completed:'Destination mint finalized and receipt verified.',failed:'This transaction reverted. The original records are retained.',minimum:'Minimum received (USDC units)',error:'Could not complete this action. The original transfer is retained.',state:'Transfer status',approve:'USDC approval',burn:'Send and burn test USDC',mint:'Claim original test USDC',cancelled:'Cancelled before sending'},
  zh:{title:'测试资产跨链',route:'Ethereum Sepolia → Base Sepolia',asset:'Circle 原生测试 USDC',notice:'仅测试网。授权、源链发送和目标领取均须分别确认。发送后只追踪原交易；这条路线不支持自动退款。',amount:'金额（USDC）',recipient:'Base Sepolia 收款地址',protocol:'协议费用上限（USDC）',source:'源链每次操作的 ETH 手续费上限（wei）',destination:'目标领取的 ETH 手续费上限（wei）',quote:'查询路线与费用',start:'确认跨链路线',prepare:'预览下一笔交易',confirm:'确认并发送此交易',check:'查询原跨链交易',cancel:'发送前取消',history:'恢复交易记录',busy:'处理中…',waiting:'不会自动重发，请查询原交易继续。',completed:'目标铸币已最终确认，到账凭据已核对。',failed:'此交易已回退，原记录已保留。',minimum:'最低到账（USDC 最小单位）',error:'本次操作未完成，原交易记录已保留。',state:'交易状态',approve:'USDC 授权',burn:'发送并销毁源链测试 USDC',mint:'领取原笔测试 USDC',cancelled:'已在发送前取消'}
};

export function mountCctpUI({root,api,locale='en'}){
  const text=copy[locale.startsWith('zh')?'zh':'en'],doc=root.ownerDocument;
  let disposed=false,generation=0,busy=false,quote=null,record=null,review=null;
  const el=(tag,value)=>{const node=doc.createElement(tag);if(value!==undefined)node.textContent=value;return node};
  const title=el('h2',text.title),route=el('p',text.route+' · '+text.asset),notice=el('p',text.notice),form=el('div'),status=el('p'),details=el('dl'),actions=el('div'),history=el('div');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const fields={};
  for(const [name,label,value] of [['amount','amount',''],['recipient','recipient',''],['maxProtocolFee','protocol','0'],['maxSourceGasFeeWei','source','1000000000000000'],['maxDestinationGasFeeWei','destination','1000000000000000']]){
    const wrap=el('label',text[label]),input=el('input');input.type='text';input.autocomplete='off';input.value=value;input.setAttribute('aria-label',text[label]);wrap.append(input);form.append(wrap);fields[name]=input;
    input.addEventListener('input',()=>{quote=null;generation++;render()});
  }
  root.replaceChildren(title,route,notice,form,status,details,actions,history);
  const show=(label,value)=>{details.append(el('dt',label),el('dd',String(value)))};
  const usdc=value=>{const raw=String(value);if(!/^(0|[1-9][0-9]*)$/.test(raw))return '—';const padded=raw.padStart(7,'0'),fraction=padded.slice(-6).replace(/0+$/,'');return padded.slice(0,-6)+(fraction?'.'+fraction:'')};
  const invoke=async(method,input)=>{const result=await api[method](input);if(result?.ok!==true)throw new Error(result?.error?.message??text.error);return result.value};
  const work=async(action)=>{
    if(busy||disposed)return;busy=true;const ticket=generation;status.textContent=text.busy;render();
    try{await action(ticket)}catch(error){if(!disposed&&ticket===generation)status.textContent=typeof error?.message==='string'?error.message:text.error}
    finally{busy=false;if(!disposed)render()}
  };
  const button=(label,action)=>{const b=el('button',label);b.type='button';b.disabled=busy;b.addEventListener('click',()=>work(action));actions.append(b);return b};
  function render(){
    if(disposed)return;details.replaceChildren();actions.replaceChildren();
    for(const input of Object.values(fields))input.disabled=busy||Boolean(record&&!['completed','failed','cancelled'].includes(record.state));
    if(quote){show(text.route,text.asset);show(text.amount,usdc(quote.amountUnits));show(text.minimum.replace(' (USDC units)',' (USDC)').replace('（USDC 最小单位）','（USDC）'),usdc(quote.minimumReceivedUnits));show(text.protocol,usdc(quote.maxFeeUnits));show(text.source,quote.maxSourceGasFeeWei);show(text.destination,quote.maxDestinationGasFeeWei);show(text.recipient,quote.recipient)}
    if(record){show(text.state,record.state);for(const op of record.operations??[]){show(text[op.step]??op.step,op.hash??op.state)}if(record.proof?.nonce)show('CCTP nonce',record.proof.nonce);if(record.destination?.balanceUnits)show('USDC balance (units)',record.destination.balanceUnits)}
    if(review){show(text[review.step]??review.step,review.transaction?.to??'');show('ETH fee (wei)',review.fee??'');show(text.recipient,record?.binding.recipient??'');button(text.confirm,async ticket=>{
      // Consume before IPC: a failed response cannot prove custody/send did not run.
      const original=review;review=null;
      record={...record,state:original.step==='approve'?'approval-pending':original.step==='burn'?'burn-pending':'mint-pending',operations:[...(record.operations??[]).filter(o=>o.id!==original.id),{id:original.id,step:original.step,state:'unknown',hash:null}]};
      render();
      const result=await invoke('confirm',{id:record.id,reviewId:original.id});if(disposed||ticket!==generation)return;record=result;status.textContent=text.waiting})}
    if(!record||['completed','failed','cancelled'].includes(record.state))button(text.quote,async ticket=>{const input=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value.trim()]));const result=await invoke('quote',{routeId:'cctp-v2-sepolia-base-sepolia-usdc',asset:'USDC',...input});if(disposed||ticket!==generation)return;quote=result;record=null;review=null;status.textContent=''});
    if(quote&&!record)button(text.start,async ticket=>{const result=await invoke('start',quote.quoteId);if(disposed||ticket!==generation)return;record=result;quote=null;status.textContent=''});
    if(record&&!['completed','cancelled'].includes(record.state)){
      if(!review&&['ready','burn-ready','mint-ready'].includes(record.state)&&!(record.operations??[]).some(o=>o.state==='review'))button(text.prepare,async ticket=>{const result=await invoke('prepare',record.id);if(disposed||ticket!==generation)return;review=result;status.textContent=''});
      button(text.check,async ticket=>{const result=await invoke('check',record.id);if(disposed||ticket!==generation)return;record=result;review=null;status.textContent=record.state==='completed'?text.completed:record.state==='failed'?text.failed:text.waiting});
      if(!(record.operations??[]).some(o=>o.state!=='review'))button(text.cancel,async ticket=>{const result=await invoke('cancel',record.id);if(disposed||ticket!==generation)return;record=result.record;review=null;status.textContent=result.cancelled?text.cancelled:text.waiting});
    }
    button(text.history,async ticket=>{const records=await invoke('history');if(disposed||ticket!==generation)return;history.replaceChildren();for(const item of [...records].reverse()){const b=el('button',`${item.state} · ${item.binding.recipient} · ${usdc(item.binding.amountUnits)} USDC`);b.type='button';b.addEventListener('click',()=>{if(busy)return;generation++;record=item;review=null;quote=null;status.textContent=text.waiting;render()});history.append(b)}status.textContent=''});
  }
  render();
  return {invalidate(){generation++;quote=null;review=null;record=null;history.replaceChildren();status.textContent='';render()},dispose(){disposed=true;generation++;root.replaceChildren()}};
}
