import {setWalletCopy} from './wallet-locale.mjs';
export function createTronSubmissionUI({document,parent,api,getContext,getSelection,isOpen}){
  const make=(tag,key)=>{const node=document.createElement(tag);if(key)setWalletCopy(node,key);return node;};
  const section=make('details'),summary=make('summary','Review transfer'),facts=make('div'),confirm=make('button','Confirm and send'),cancel=make('button','Cancel'),status=make('p');confirm.type=cancel.type='button';status.setAttribute('role','status');section.hidden=true;
  section.append(summary,facts,confirm,cancel,status,make('p','TRON budgets are conservative node estimates, not guaranteed fees.'),make('p','Block inclusion reported by RPC is not consensus finality. Unknown transactions are checked, never automatically resent.'));parent.append(section);
  let epoch=0,review=null,busy=false;
  const key=()=>{const c=getContext(),s=getSelection();return [c.account,c.revision,c.locked,s.family,s.network].join(':');};
  const current=(ticket,binding)=>ticket===epoch&&isOpen()&&binding===key();
  const update=()=>{confirm.disabled=busy||getContext().locked||!review;cancel.disabled=busy;};
  function invalidate(){epoch++;const original=review;review=null;busy=false;section.hidden=true;facts.replaceChildren();status.textContent='';update();if(original)void Promise.resolve(api.familyTronSubmissionCancel({reviewId:original.reviewId})).catch(()=>{});}
  async function reviewOriginal(id){
    if(busy||getContext().locked||getSelection().family!=='tron')return;
    invalidate();const ticket=++epoch,binding=key(),selection={...getSelection()},account=getContext().account;busy=true;section.hidden=false;update();
    try{const reply=await api.familyTronSubmissionReview({id});if(!current(ticket,binding)){if(reply?.ok)void Promise.resolve(api.familyTronSubmissionCancel({reviewId:reply.value.reviewId})).catch(()=>{});return;}if(!reply.ok){status.textContent=reply.error?.code??'FAMILY_RESOLUTION_REQUIRED';return;}const value=reply.value;
      if(value.id!==id||value.family!=='tron'||value.network!==selection.network||value.vaultAccount!==account||typeof value.reviewId!=='string')throw Error('FAMILY_RECOVERY_BINDING');review=value;
      for(const [label,text] of [['Network name',value.network],['HTTPS RPC',value.rpcUrl],['Receiving address',value.from],['Recipient',value.to],['Amount',value.amount+' '+value.symbol],['Maximum fee',value.maxFeeSun+' sun'],['TRON energy fee limit',value.energyFeeLimitSun+' sun']]){const row=make('p'),caption=make('span',label),data=make('span');data.dir='ltr';data.textContent=': '+text;row.append(caption,data);facts.append(row);}if(value.contract){const row=make('p');row.dir='ltr';row.textContent=value.contract;facts.append(row);}const hash=make('p');hash.dir='ltr';hash.textContent=value.txid;facts.append(hash);section.open=true;
    }catch(error){if(current(ticket,binding))status.textContent=error.message??'FAMILY_RESOLUTION_REQUIRED';}finally{if(ticket===epoch){busy=false;update();}}
  }
  confirm.addEventListener('click',async()=>{if(busy||!review||getContext().locked)return;const original=review,ticket=++epoch,binding=key();review=null;busy=true;update();try{const reply=await api.familyTronSubmit({reviewId:original.reviewId});if(!current(ticket,binding))return;if(!reply.ok){status.textContent=reply.error?.code??'FAMILY_SUBMISSION_UNKNOWN';return;}if(reply.value.id!==original.id||reply.value.txid!==original.txid||reply.value.family!=='tron'||reply.value.network!==original.network||!['unknown','submitted-unconfirmed'].includes(reply.value.state))throw Error('FAMILY_RECOVERY_BINDING');setWalletCopy(status,'Transaction status: {state}',{state:reply.value.state});}catch(error){if(current(ticket,binding))status.textContent=error.message??'FAMILY_SUBMISSION_UNKNOWN';}finally{if(ticket===epoch){busy=false;update();}}});
  cancel.addEventListener('click',()=>{if(!busy)invalidate();});update();return {invalidate,reviewOriginal};
}
