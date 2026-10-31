// Only finishes an original local device record. No connection/sign/send grant.
export function bindDeviceFinalizationUI({root,api,readContext}){
 const button=root.querySelector('#app-device-finalize'),detail=root.querySelector('#app-device-finalize-status');
 let state={phase:'idle'},busy=false,generation=0,message=null;
 const snapshot=()=>{const s=readContext();return Object.freeze({account:s.account,revision:s.revision});};
 const same=s=>{const now=readContext();return !now.locked&&now.account===s.account&&now.revision===s.revision;};
 const sameSnapshot=s=>{const now=readContext();return now.account===s.account&&now.revision===s.revision;};
 function render(next){
  if(next)state=next;const context=readContext(),foreign=state.account&&state.account!==context.account;
  button.disabled=busy||context.locked||!context.account||Boolean(foreign)||state.effectEntered===true||state.cleanupUnresolved===true||state.cleanupFailureRetained===true;
  detail.textContent=context.locked||foreign?'':message&&same(message.selection)?message.text:state.cleanupUnresolved||state.cleanupFailureRetained?'原结果已保留，清理尚未确认，不会重复完成。 / Original retained; cleanup is unconfirmed, no repeat completion.':state.phase==='original-local-association-retained'&&state.outcome?.localAssociationFinalized===true?'本地设备记录已完成；应用连接仍需独立确认。 / Local device record finished; app connection still requires separate confirmation.':state.effectEntered?'原设备结果待核对，不会自动重试。 / Original device outcome requires reconciliation; no automatic retry.':'';
 }
 async function refresh(){
  const selected=snapshot(),epoch=++generation;
  try{const r=await api.deviceFinalizationStatus();if(epoch===generation&&sameSnapshot(selected)&&r?.ok)render(r.value);}catch{}finally{render();}
 }
 button.addEventListener('click',async()=>{
  if(button.disabled||busy)return;const selected=snapshot();busy=true;message=null;render();
  try{
   const r=await api.finalizeOriginalDevice();if(!same(selected))return;
   if(r?.ok&&r.value?.phase==='original-local-association-retained'&&r.value?.outcome?.localAssociationFinalized===true&&['SourceAdmission','connected','newSession','keyGenerated','registrationResent'].every(k=>r.value[k]===false))render(r.value);
   else message={selection:selected,text:'本地完成结果尚未确认，请核对原应用请求；不会重新创建或发送登记。 / Local completion unconfirmed; check the original app request. No creation or registration resend.'};
  }catch{if(same(selected))message={selection:selected,text:'原结果仍保留，请从原应用核对，不会自动重试。 / Original retained; check from the app. No automatic retry.'};}
  finally{busy=false;await refresh();render();}
 });
 render();return Object.freeze({render,refresh});
}
