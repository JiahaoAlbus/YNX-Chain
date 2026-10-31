// Renderer display and zero-input IPC only. Approval stays in the existing
// normal confirmation queue; this panel never approves, signs or submits.
export function bindDeviceRegistrationUI({root,api,readContext,readCreation}){
 const prepare=root.querySelector('#app-device-register'),cancel=root.querySelector('#app-device-register-cancel'),detail=root.querySelector('#app-device-register-status');
 let state={phase:'idle'},busy=false,error=null,generation=0,historyRows=[],historySelection=null;
 const history=root.querySelector('#app-device-registration-history'),outcomes=new Map();
 const snapshot=()=>{const value=readContext();return Object.freeze({account:value.account,revision:value.revision});};
 const same=before=>{const now=readContext();return !now.locked&&now.account===before.account&&now.revision===before.revision;};
 const rememberError=(selection,message)=>{error={selection,message};};
 function renderHistory(){
  if(!history)return;history.replaceChildren();if(!historySelection||!same(historySelection))return;
  for(const row of historyRows){
   const item=root.createElement('article'),title=root.createElement('p'),button=root.createElement('button'),result=root.createElement('p');
   title.textContent=`${row.productId} · ${row.createdAt}`;button.type='button';button.textContent='查看原记录（只读） / View original record';
   const cacheKey=historySelection.account+':'+historySelection.revision+':'+row.requestDigest;result.textContent=outcomes.get(cacheKey)??(row.pairEntered?'原请求已进入，未获得再次发送权限。 / Original request entered; resending is not authorized.':'原设备操作记录已保留；这里只能查询。 / Original device operation retained; query only.');
   button.addEventListener('click',async()=>{
    if(button.disabled)return;const selected=snapshot();button.disabled=true;
    try{const response=await api.deviceRegistrationOutcome(row.requestDigest);if(!same(selected))return;
     const value=response?.value,text=!response?.ok||!value?'原记录暂不可读，不会重新签名或发送。 / Original record unavailable; no signing or resending.':value.status==='response-retained'?'原响应已保存，尚未据此确认登记或连接成功。 / Original response retained; registration or connection is not established by this record.':'原操作仍待核对，只能查询，不会自动重试。 / Original operation requires reconciliation; query only, no automatic retry.';
     outcomes.set(cacheKey,text);result.textContent=text;
    }catch{if(same(selected)){const text='原记录暂不可读，不会重新签名或发送。 / Original record unavailable; no signing or resending.';outcomes.set(cacheKey,text);result.textContent=text;}}
    finally{button.disabled=false;}
   });item.append(title,button,result);history.append(item);
  }
 }
 function render(next){
  if(next)state=next;const context=readContext(),creation=readCreation(),foreign=Boolean(state.account&&state.account!==context.account),currentError=error&&same(error.selection)?error.message:null;
  prepare.disabled=busy||context.locked||!context.account||foreign||creation.phase!=='awaiting-original-registration'||creation.retired===true||state.queryOnly===true||state.cleanupUnresolved===true;
  cancel.hidden=state.phase!=='review'||foreign;cancel.disabled=busy||context.locked;
  detail.textContent=foreign?'请切回原账户查看设备登记记录。 / Select the original account to view its device record.':context.locked?'解锁后可查看或继续原设备请求。 / Unlock to view the original device request.':currentError??(state.cleanupUnresolved?'原记录已保留，清理尚未确认，请勿重复登记。 / Original retained; cleanup remains unconfirmed.':state.phase==='awaiting-original-challenge'?'账户批准和原请求已保存，等待原应用完成挑战；尚未连接。 / Approval and original request retained; waiting for the app challenge, not connected yet.':state.queryOnly?'原操作结果待核对，只能查询，不会自动重新签名或发送。 / Original outcome requires reconciliation; query only, no automatic signing or resending.':state.phase==='review'?'请在独立确认窗口核对账户批准和本次登记请求。 / Review the account approval and registration in the separate confirmation.':state.phase==='cancelled-before-account'?'已取消本次账户确认。 / Account confirmation cancelled.':'创建设备密钥后，可单独核对此应用的账户批准与登记。 / After device creation, review account approval and registration separately.');
  renderHistory();
 }
 async function refresh(){
  const selected=snapshot(),revision=++generation;if(readContext().locked){render();return;}
  try{const result=await api.deviceRegistrationStatus();if(revision!==generation||!same(selected))return;if(result?.ok)render(result.value);
   if(history&&typeof api.deviceRegistrationHistory==='function'){const rows=await api.deviceRegistrationHistory();if(revision!==generation||!same(selected))return;if(rows?.ok&&Array.isArray(rows.value)){historyRows=rows.value;historySelection=selected;}}
  }catch{}finally{render();}
 }
 prepare.addEventListener('click',async()=>{
  if(prepare.disabled||busy)return;const selected=snapshot();busy=true;error=null;render();
  try{const result=await api.prepareDeviceRegistration();if(!same(selected))return;if(!result?.ok)rememberError(selected,'暂时无法核对原设备登记请求，请从原应用发起连接。 / Original registration request unavailable; start from the app.');}
  catch{if(same(selected))rememberError(selected,'登记请求未准备完成，未获得账户批准。 / Registration review is incomplete; account approval was not granted.');}
  finally{busy=false;await refresh();render();}
 });
 cancel.addEventListener('click',async()=>{
  if(cancel.disabled||cancel.hidden||busy)return;const selected=snapshot();busy=true;error=null;render();
  try{const result=await api.cancelDeviceRegistration();if(!same(selected))return;if(result?.ok)render(result.value);else rememberError(selected,'取消结果待核对，原记录仍保留。 / Cancellation requires reconciliation; original records retained.');}
  catch{if(same(selected))rememberError(selected,'取消结果待核对，原记录仍保留。 / Cancellation requires reconciliation; original records retained.');}
  finally{busy=false;await refresh();render();}
 });
 render();return Object.freeze({render,refresh});
}
