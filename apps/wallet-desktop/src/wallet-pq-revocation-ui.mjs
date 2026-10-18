/** Local review entry only. Main derives policy, revisions, heights and nonce;
 * this renderer cannot sign, submit or manufacture a policy source. */
export function createPQRevocationReviewUI({api,getKeyState,document:doc=document}){
 const section=doc.querySelector('#backup-section'),form=doc.createElement('form'),help=doc.createElement('p'),label=doc.createElement('label'),ack=doc.createElement('input'),button=doc.createElement('button'),result=doc.createElement('p');
 form.id='pq-revocation-form';ack.type='checkbox';ack.id='pq-revocation-understood';label.htmlFor=ack.id;
 help.textContent='终止 PQ 账户授权：涵盖当前及所有已登记待生效密钥版本。此处仅审查、签名并本地保存，不广播；如日后另行提交并入链，将在下一执行高度撤销。不会删除密钥、转移资金或重置账户。 / Terminal PQ revocation includes current and registered pending keys. Review, sign and save only; no broadcast, fund transfer, key deletion or account reset.';
 label.textContent='我理解这是终止授权，不是退出登录或普通锁定。 / I understand this is terminal revocation, not sign-out or locking.';
 button.type='submit';button.textContent='审查终止 PQ 授权（仅本地保存） / Review terminal PQ revocation (save only)';result.setAttribute('role','status');form.append(help,ack,label,button,result);section.append(form);
 let busy=false,generation=0;
 const render=()=>{const state=getKeyState();button.disabled=busy||state.locked||state.authenticating||!ack.checked;ack.disabled=busy||state.locked||state.authenticating;};
 ack.addEventListener('change',()=>{generation++;render();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const state={...getKeyState()},token=generation;
  if(state.locked||state.authenticating||!ack.checked){result.textContent='请先解锁，并确认已理解终止授权的含义。 / Unlock and acknowledge terminal revocation first.';return;}
  const live=()=>{const now=getKeyState();return generation===token&&now.account===state.account&&now.revision===state.revision&&!now.locked&&!now.authenticating;};
  busy=true;render();
  try{
   const response=await api.preparePQRevocation({});if(!live())return;
   result.textContent=response?.ok===true&&typeof response.value?.requestId==='string'&&response.value?.submitted===false?'请在批准窗口核对账户、完整撤销版本范围及执行/生效高度；尚未签名或发送。 / Review account, all revisions and execution/effective heights in the approval window; nothing signed or sent yet.':'无法准备终止授权审查；未签名、未发送，不会自动重试。 / Revocation review unavailable; nothing signed or sent; no automatic retry.';
  }catch{if(live())result.textContent='终止授权审查通道不可用；不会自动重试。 / Revocation review unavailable; no automatic retry.';}
  finally{busy=false;render();}
 });
 button.disabled=true;ack.disabled=true;
 return Object.freeze({render,invalidate(){generation++;ack.checked=false;result.textContent='';render();}});
}
