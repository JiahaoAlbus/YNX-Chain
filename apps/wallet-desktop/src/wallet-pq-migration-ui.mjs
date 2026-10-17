/** Original account/backup panel -> same main pending approval queue. No keys,
 * policy, signing or network authority are constructed in this renderer. */
export function createPQMigrationReviewUI({api,getKeyState,document:doc=document}){
 const section=doc.querySelector('#backup-section'),form=doc.createElement('form'),label=doc.createElement('label'),height=doc.createElement('input'),button=doc.createElement('button'),result=doc.createElement('p'),help=doc.createElement('p');
 form.id='pq-migration-form';height.id='pq-migration-height';height.type='text';height.inputMode='numeric';height.autocomplete='off';label.htmlFor=height.id;label.textContent='PQ 首次迁移生效区块高度 / Initial PQ activation height';
 help.textContent='需先在受保护钱包中准备独立的新密钥对。这里只审查、签名并本地保存，不广播或激活。现有 PQ 账户轮换尚不可用。 / Requires a protected proposed key pair. Review, sign and save only; no broadcast or activation. Active PQ rotation is unavailable.';
 button.type='submit';button.textContent='审查首次 PQ 迁移（仅本地保存） / Review initial PQ migration (save only)';result.setAttribute('role','status');form.append(label,height,help,button,result);section.append(form);
 let busy=false,generation=0;const render=()=>{const state=getKeyState();button.disabled=busy||state.locked||state.authenticating;};
 height.addEventListener('input',()=>{generation++;});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const security={...getKeyState()},token=generation,activateAt=height.value.trim();
  if(security.locked||security.authenticating){result.textContent='请先解锁钱包 / Unlock Wallet first.';return;}
  if(!/^[1-9][0-9]{0,19}$/.test(activateAt)){result.textContent='请输入完整整数区块高度 / Enter a canonical integer block height.';return;}
  const live=()=>{const state=getKeyState();return token===generation&&state.account===security.account&&state.revision===security.revision&&!state.locked&&!state.authenticating;};
  busy=true;render();
  try{
   const response=await api.preparePQMigration({activateAt});if(!live())return;
   const code=response?.error?.data?.code??response?.error?.code;
   result.textContent=response?.ok===true&&typeof response.value?.requestId==='string'&&response.value?.submitted===false?'请在批准窗口核对生效高度和新公钥；尚未签名或发送。 / Review the height and new public keys in the approval window; nothing signed or sent yet.':code==='PASSWORD_VAULT_PQ_ORIGINAL_REQUIRED'?'请先完成独立 PQ 新密钥对的受保护准备与备份。 / Prepare and back up the protected proposed pair first.':code==='PQ_ROTATION_PROPOSAL_SLOT_REQUIRED'?'现有 PQ 账户轮换尚不可用；未使用旧式签名回退。 / Active PQ rotation unavailable; no classic fallback.':'无法准备迁移审查；未签名、未发送，不会自动重试。 / Migration review unavailable; nothing signed or sent; no automatic retry.';
  }catch{if(live())result.textContent='迁移审查通道不可用；不会自动重试。 / Migration review unavailable; no automatic retry.';}
  finally{busy=false;render();}
 });
 return Object.freeze({render,invalidate(){generation++;}});
}
