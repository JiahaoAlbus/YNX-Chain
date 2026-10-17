/** Existing send form -> original-main pending approval. No policy, key,
 * signature bytes, automatic confirmation or network capability in renderer. */
export function createPQTransferReviewUI({api,getKeyState,document:doc=document}){
 const form=doc.querySelector('#transfer-form'),result=doc.querySelector('#transfer-result');
 const button=doc.createElement('button');button.id='review-pq-local';button.type='button';button.disabled=true;button.textContent='审查 PQ 转账（仅签名并本地保存） / Review PQ transfer (sign and save only)';form.append(button);
 let busy=false,generation=0;
 function render(){const state=getKeyState();button.disabled=busy||state.locked||state.authenticating;}
 for(const selector of ['#transfer-to','#transfer-amount'])doc.querySelector(selector).addEventListener('input',()=>{generation++;});
 button.addEventListener('click',async()=>{
  if(busy)return;const security={...getKeyState()},token=generation;
  if(security.locked||security.authenticating){result.textContent='请先解锁钱包 / Unlock Wallet first.';return;}
  const input={to:doc.querySelector('#transfer-to').value.trim(),amount:doc.querySelector('#transfer-amount').value.trim()};
  if(!input.to||! /^[1-9][0-9]{0,18}$/.test(input.amount)){result.textContent='请输入收款地址和整数 YNXT 金额 / Enter a recipient and whole-YNXT amount.';return;}
  const live=()=>{const current=getKeyState();return token===generation&&current.account===security.account&&current.revision===security.revision&&!current.locked&&!current.authenticating;};
  busy=true;button.disabled=true;
  try{
   const response=await api.preparePQTransfer(input);if(!live())return;
   const refusal=response?.error?.code??response?.error?.data?.code;
   result.textContent=response?.ok===true&&typeof response.value?.requestId==='string'&&response.value?.submitted===false?'请在批准窗口核对本次转账。此步骤不会提交交易。 / Review this exact transfer in the approval window. No transaction is submitted.':['PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED'].includes(refusal)?'可信交易策略来源尚未供给；未签名、未发送。 / Trusted transaction policy is not supplied; nothing signed or sent.':'无法准备本次审查；不会自动重试。 / Review unavailable; no automatic retry.';
  }catch{if(live())result.textContent='审查通道不可用；不会自动重试。 / Review channel unavailable; no automatic retry.';}
  finally{busy=false;render();}
 });
 for(const event of ['close','cancel'])doc.querySelector('#send-sheet')?.addEventListener(event,()=>{generation++;});
 return Object.freeze({render,invalidate(){generation++;}});
}
