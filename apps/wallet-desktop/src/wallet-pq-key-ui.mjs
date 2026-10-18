/** No SDK or key material in renderer. Explicit local preparation only;
 * encrypted custody does not mean independent backup or chain activation. */
export function createPQKeyPreparationUI({api,getKeyState,document:doc=document}){
 const section=doc.querySelector('#backup-section'),panel=doc.createElement('section'),title=doc.createElement('h3'),help=doc.createElement('p'),prepare=doc.createElement('button'),check=doc.createElement('button'),result=doc.createElement('p'),dialog=doc.createElement('dialog'),notice=doc.createElement('p'),confirm=doc.createElement('button'),cancel=doc.createElement('button');
 panel.id='pq-key-preparation';title.textContent='独立 PQ 密钥准备 / Independent PQ keys';
 help.textContent='新密钥与原助记词不同，仅加密保存在当前钱包。此操作不迁移账户、不签名、不发送，也不代表已完成独立备份。 / Separate from the mnemonic; encrypted local custody only. No migration, signature, send or independent backup claim.';
 prepare.type=check.type=confirm.type=cancel.type='button';prepare.textContent='准备独立 PQ 密钥 / Prepare independent PQ keys';check.textContent='核对原准备结果 / Check original preparation';result.setAttribute('role','status');
 notice.textContent='为当前选中账户生成一对新的独立 PQ 密钥并加密保存？不会覆盖已有密钥，不会注册、签名或广播。原助记词不能恢复这对新密钥。 / Generate and encrypt a separate pair for this selected account? Existing keys are never replaced. No registration, signing or broadcast. The original mnemonic cannot restore this pair.';
 confirm.textContent='确认仅生成并本地保存 / Generate and save locally';cancel.textContent='取消 / Cancel';dialog.append(notice,confirm,cancel);panel.append(title,help,prepare,check,result,dialog);section.append(panel);
 let busy=false,review=null,original=null,generation=0;
 const same=s=>{const now=getKeyState();return !now.locked&&!now.authenticating&&s.account===now.account&&s.revision===now.revision;};
 function render(){const security=getKeyState();if(review&&!same(review)){review=null;dialog.close();}prepare.disabled=busy||security.locked||security.authenticating||original?.phase&&original.phase!=='idle';check.disabled=busy||security.locked||security.authenticating;confirm.disabled=busy||!review||!same(review);}
 function display(value){original=value;result.textContent=value?.persisted===true?'独立密钥已加密保存在本地；未注册、未签名、未广播，尚非独立备份。 / Encrypted local custody verified; no registration, signature, broadcast or independent backup.':value?.persistenceAttempted?'原保存结果尚未确认；仅核对原记录，不会再次保存或生成。 / Original save unconfirmed; check only, without saving or generating again.':value?.preparationUnknown?'原生成结果未知；不会再次生成。 / Original generation unknown; no replacement generation.':value?.phase==='idle'?'当前进程尚未发起准备；已有密钥会由保险库拒绝覆盖。 / No preparation entered in this process; existing keys cannot be overwritten.':'原操作未完成；不会自动重试。 / Original operation incomplete; no automatic retry.';}
 async function perform(action){if(busy)return;const state={...getKeyState()},token=generation;if(!same(state))return;busy=true;render();try{const response=await action();if(token!==generation||!same(state))return;if(response?.ok===true)display(response.value);else result.textContent='操作未确认；保留原记录，不会自动重新生成或保存。 / Unconfirmed; originals retained, no automatic regeneration or save.';}catch{if(token===generation&&same(state))result.textContent='通道不可用；不会自动重试。 / Channel unavailable; no automatic retry.';}finally{busy=false;render();}}
 prepare.addEventListener('click',()=>{if(prepare.disabled)return;review={...getKeyState()};dialog.showModal();render();});
 cancel.addEventListener('click',()=>{review=null;dialog.close();render();});dialog.addEventListener('cancel',()=>{review=null;});
 confirm.addEventListener('click',()=>{if(!review||!same(review)||busy)return;review=null;dialog.close();void perform(()=>api.generatePQKeys());});
 check.addEventListener('click',()=>void perform(()=>api.recoverPQKeys()));
 return Object.freeze({render,invalidate(){generation++;review=null;original=null;dialog.close();result.textContent='';render();}});
}
