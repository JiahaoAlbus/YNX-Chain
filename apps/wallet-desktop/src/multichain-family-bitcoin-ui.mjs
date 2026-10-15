import {setWalletCopy} from './wallet-locale.mjs';
export function createBitcoinTransferUI({document,parent,api,getContext,getSelection,isOpen}){
  const make=(tag,key)=>{const n=document.createElement(tag);if(key)setWalletCopy(n,key);return n;};
  const section=make('details'),title=make('summary','Review transfer');section.append(title);parent.append(section);
  const field=(key,unit)=>{const label=make('label'),caption=make('span',key),input=make('input');input.type='text';input.autocomplete='off';input.spellcheck=false;input.dir='ltr';input.maxLength=128;label.append(caption);if(unit){const hint=make('span');hint.textContent=' ('+unit+')';label.append(hint);}label.append(input);section.append(label);return input;};
  const to=field('Recipient'),amount=field('Amount','BTC'),rate=field('Fee rate','sat/vB'),maxFee=field('Maximum fee','sats');
  const prepare=make('button','Review transfer'),cancel=make('button','Cancel'),review=make('div'),status=make('p');prepare.type=cancel.type='button';status.setAttribute('role','status');
  section.append(prepare,review,cancel,status);
  const sign=make('button','Sign only');sign.type='button';section.append(sign,make('p','Signing does not submit a transaction.'));
  let epoch=0,busy=false,id=null,signingSupported=false;
  const key=()=>{const c=getContext(),s=getSelection();return [c.account,c.revision,c.locked,s.family,s.network].join(':');};
  const current=(ticket,binding)=>ticket===epoch&&isOpen()&&binding===key();
  const update=()=>{const disabled=busy||getContext().locked||getSelection().family!=='bitcoin';section.hidden=getSelection().family!=='bitcoin';prepare.disabled=disabled;for(const n of [to,amount,rate,maxFee])n.disabled=disabled;cancel.disabled=busy||!id;sign.hidden=!signingSupported;sign.disabled=disabled||!id||!signingSupported;};
  const discard=async original=>{if(!original)return;const reply=await api.familyBitcoinCancel({id:original});if(!reply?.ok)throw Error(reply?.error?.code??'FAMILY_CUSTODY_CONFLICT');};
  function invalidate(){epoch++;busy=false;const original=id;id=null;signingSupported=false;review.replaceChildren();status.textContent='';for(const n of [to,amount,rate,maxFee])n.value='';update();void discard(original).catch(()=>{});}
  prepare.addEventListener('click',async()=>{
    if(busy||getContext().locked||getSelection().family!=='bitcoin')return;
    const ticket=++epoch,binding=key(),selection={...getSelection()},context={...getContext()};busy=true;update();
    try{
      await discard(id);if(!current(ticket,binding))return;id=null;review.replaceChildren();
      const result=await api.familyBitcoinPrepare({network:selection.network,to:to.value.trim(),amount:amount.value.trim(),feeRateSatPerVbyte:rate.value.trim(),maxFeeSats:maxFee.value.trim()});
      if(!current(ticket,binding)){if(result?.ok)await discard(result.value.id);return;}
      if(!result.ok){status.textContent=result.error?.code??'FAMILY_PREVIEW_UNAVAILABLE';return;}
      const value=result.value;id=value.id;
      if(value.vaultAccount!==context.account||value.family!=='bitcoin'||value.network!==selection.network||value.state!=='prepared'||typeof value.signingSupported!=='boolean'||value.broadcastSupported!==false)throw Error('FAMILY_RECOVERY_BINDING');signingSupported=value.signingSupported&&typeof api.familyBitcoinSign==='function';
      for(const [label,text] of [['Network name',value.network],['HTTPS RPC',value.endpoint],['Receiving address',value.from],['Recipient',value.to],['Amount',value.amount+' BTC'],['Maximum fee',value.maxFeeSats+' sats']]){const row=make('p'),caption=make('span',label),data=make('span');data.textContent=': '+text;data.dir='ltr';row.append(caption,data);review.append(row);}
      const fee=make('p');fee.textContent=value.feeSats+' sats · '+value.estimatedVbytes+' vB';review.append(fee);status.textContent='prepared';
    }catch(error){if(current(ticket,binding))status.textContent=error.message??'FAMILY_PREVIEW_UNAVAILABLE';}
    finally{if(ticket===epoch){busy=false;update();}}
  });
  cancel.addEventListener('click',async()=>{if(busy||!id)return;const original=id,ticket=++epoch;busy=true;update();try{await discard(original);if(ticket!==epoch)return;id=null;review.replaceChildren();status.textContent='cancelled';}catch(error){if(ticket===epoch)status.textContent=error.message;}finally{if(ticket===epoch){busy=false;update();}}});
  sign.addEventListener('click',async()=>{if(busy||getContext().locked||!id||!signingSupported)return;const original=id,ticket=++epoch,binding=key(),selection={...getSelection()};id=null;signingSupported=false;busy=true;update();try{const reply=await api.familyBitcoinSign({id:original});if(!current(ticket,binding))return;if(!reply.ok){status.textContent=reply.error?.code??'FAMILY_SIGNING_OUTCOME_UNKNOWN';return;}if(reply.value.id!==original||reply.value.family!=='bitcoin'||reply.value.network!==selection.network||reply.value.state!=='signed-unsubmitted'||reply.value.broadcastAuthorized!==false)throw Error('FAMILY_RECOVERY_BINDING');status.textContent=reply.value.state+' · '+reply.value.txid;}catch(error){if(current(ticket,binding))status.textContent=error.message??'FAMILY_SIGNING_OUTCOME_UNKNOWN';}finally{if(ticket===epoch){busy=false;update();}}});
  for(const n of [to,amount,rate,maxFee])n.addEventListener('input',()=>{if(busy)return;const original=id;id=null;epoch++;review.replaceChildren();void discard(original).catch(()=>{});update();});
  update();return {invalidate};
}
