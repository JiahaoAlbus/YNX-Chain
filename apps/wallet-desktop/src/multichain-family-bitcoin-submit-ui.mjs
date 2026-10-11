import {setWalletCopy} from './wallet-locale.mjs';
export function createBitcoinSubmissionUI({document,parent,api,getContext,getSelection,isOpen}){
  const make=(tag,key)=>{const node=document.createElement(tag);if(key)setWalletCopy(node,key);return node;};
  const section=make('details'),summary=make('summary','Review transfer'),facts=make('div'),status=make('p'),confirm=make('button','Confirm and send'),cancel=make('button','Cancel');confirm.type=cancel.type='button';status.setAttribute('role','status');section.hidden=true;
  section.append(summary,facts,confirm,cancel,status,make('p','Block inclusion reported by RPC is not consensus finality. Unknown transactions are checked, never automatically resent.'));parent.append(section);
  let epoch=0,review=null,busy=false;
  const key=()=>{const c=getContext(),s=getSelection();return [c.account,c.revision,c.locked,s.family,s.network].join(':');};
  const current=(token,context)=>token===epoch&&isOpen()&&key()===context;
  const update=()=>{confirm.disabled=busy||getContext().locked||!review;cancel.disabled=busy;};
  function invalidate(){epoch++;const original=review;review=null;busy=false;section.hidden=true;facts.replaceChildren();status.textContent='';update();if(original)void Promise.resolve(api.familyBitcoinSubmissionCancel({reviewId:original.reviewId})).catch(()=>{});}
  async function reviewOriginal(id){
    if(busy||getContext().locked||getSelection().family!=='bitcoin')return;
    invalidate();const token=++epoch,context=key(),selection={...getSelection()},account=getContext().account;busy=true;section.hidden=false;update();
    try{const reply=await api.familyBitcoinSubmissionReview({id});if(!current(token,context)){if(reply?.ok)void Promise.resolve(api.familyBitcoinSubmissionCancel({reviewId:reply.value.reviewId})).catch(()=>{});return;}
      if(!reply.ok){status.textContent=reply.error?.code??'FAMILY_RESOLUTION_REQUIRED';return;}const value=reply.value;
      if(value.id!==id||value.family!=='bitcoin'||value.network!==selection.network||value.vaultAccount!==account||typeof value.reviewId!=='string')throw Error('FAMILY_RECOVERY_BINDING');review=value;
      for(const [label,text] of [['Network name',value.network],['HTTPS RPC',value.rpcUrl],['Receiving address',value.from],['Recipient',value.to],['Amount',value.amount+' BTC'],['Maximum fee',value.feeSats+' sats']]){const row=make('p'),caption=make('span',label),data=make('span');data.dir='ltr';data.textContent=': '+text;row.append(caption,data);facts.append(row);}const hash=make('p');hash.dir='ltr';hash.textContent=value.txid;facts.append(hash);section.open=true;
    }catch(error){if(current(token,context))status.textContent=error.message??'FAMILY_RESOLUTION_REQUIRED';}finally{if(token===epoch){busy=false;update();}}
  }
  confirm.addEventListener('click',async()=>{if(busy||!review||getContext().locked)return;const original=review,token=++epoch,context=key();review=null;busy=true;update();try{const reply=await api.familyBitcoinSubmit({reviewId:original.reviewId});if(!current(token,context))return;if(!reply.ok){status.textContent=reply.error?.code??'FAMILY_SUBMISSION_UNKNOWN';return;}if(reply.value.id!==original.id||reply.value.txid!==original.txid||reply.value.family!=='bitcoin'||reply.value.network!==original.network||!['unknown','submitted-unconfirmed'].includes(reply.value.state))throw Error('FAMILY_RECOVERY_BINDING');setWalletCopy(status,'Transaction status: {state}',{state:reply.value.state});}catch(error){if(current(token,context))status.textContent=error.message??'FAMILY_SUBMISSION_UNKNOWN';}finally{if(token===epoch){busy=false;update();}}});
  cancel.addEventListener('click',()=>{if(!busy)invalidate();});update();return {invalidate,reviewOriginal};
}
