/** Explicit local backup operation. No SDK, wire, file path or automatic
 * clipboard persistence in renderer. Recovery credential is shown only after
 * verified export/readback and cleared on modal close or security change. */
export function createPQBackupUI({api,getKeyState,document:doc=document}){
 const panel=doc.createElement('section'),heading=doc.createElement('h3'),help=doc.createElement('p'),save=doc.createElement('button'),verify=doc.createElement('button'),result=doc.createElement('p'),dialog=doc.createElement('dialog'),notice=doc.createElement('p'),secret=doc.createElement('input'),show=doc.createElement('button'),confirm=doc.createElement('button'),close=doc.createElement('button');
 panel.id='pq-independent-backup';heading.textContent='独立 PQ 加密备份 / Independent encrypted PQ backup';
 help.textContent='需要已保存的独立 PQ 密钥。加密文件和独立恢复密钥必须分开保管；原助记词不能替代此恢复密钥。文件核对会尝试恢复并验证两把密钥，不替换当前账户、不签名、不发送。 / Keep the encrypted file and independent recovery credential separately. The original mnemonic is not a replacement. Verification restores both keys only for checking; no account replacement, signature or send.';
 save.type=verify.type=show.type=confirm.type=close.type='button';save.textContent='导出独立 PQ 加密文件 / Export encrypted PQ file';verify.textContent='核对备份并查看恢复密钥 / Verify backup and view recovery credential';result.setAttribute('role','status');
 secret.type='password';secret.readOnly=true;secret.autocomplete='off';secret.spellcheck=false;secret.setAttribute('aria-label','独立 PQ 恢复密钥 / Independent PQ recovery credential');show.textContent='显示／隐藏恢复密钥 / Show or hide';confirm.textContent='继续 / Continue';close.textContent='关闭 / Close';dialog.append(notice,secret,show,confirm,close);panel.append(heading,help,save,verify,result,dialog);doc.querySelector('#backup-section').append(panel);
 let busy=false,generation=0,review=null;
 const live=state=>{const now=getKeyState();return !now.locked&&!now.authenticating&&state.account===now.account&&state.revision===now.revision;};
 function clearSecret(){secret.value='';secret.type='password';secret.hidden=true;show.hidden=true;}
 function render(){const state=getKeyState();save.disabled=verify.disabled=busy||state.locked||state.authenticating;confirm.disabled=busy||!review||!live(review.security);if(review&&!live(review.security)){review=null;clearSecret();dialog.close();}}
 function begin(kind){if(busy||!live(getKeyState()))return;clearSecret();review={kind,security:{...getKeyState()}};confirm.hidden=false;notice.textContent=kind==='export'?'将选择一个新文件，现有文件不会被覆盖。完成读回与双密钥核对后，会单独显示恢复密钥，请勿与文件放在一起。 / Choose a new file; existing files are never overwritten. The separate recovery credential appears after exact readback and both-key verification. Store it separately.':'请选择原来导出的当前账户备份文件。只读核对成功后显示其独立恢复密钥，不修改钱包。 / Select this account’s original exported file. Read-only verification reveals its recovery credential without changing Wallet.';dialog.showModal();render();}
 save.addEventListener('click',()=>begin('export'));verify.addEventListener('click',()=>begin('verify'));
 close.addEventListener('click',()=>{review=null;clearSecret();dialog.close();render();});
 dialog.addEventListener('close',()=>{if(!dialog.open){review=null;clearSecret();}});
 dialog.addEventListener('cancel',()=>{review=null;clearSecret();});
 show.addEventListener('click',()=>{if(secret.value)secret.type=secret.type==='password'?'text':'password';});
 confirm.addEventListener('click',async()=>{
  if(busy||!review||!live(review.security))return;const chosen=review,token=generation;review=null;dialog.close();busy=true;render();
  try{
   const response=await (chosen.kind==='export'?api.exportPQBackup():api.verifyPQBackup());if(token!==generation||!live(chosen.security))return;
   const value=response?.value;
   if(response?.ok===true&&value?.verified===true&&value.walletChanged===false&&typeof value.credential==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.credential)){
    result.textContent='文件及两把密钥已核对；钱包未更换、未签名、未发送。请分开保管文件和恢复密钥。 / File and both keys verified; no Wallet replacement, signature or send. Store the file and credential separately.';
    notice.textContent='独立恢复密钥：与加密文件分开保管。请勿发送给聊天、网站或支持人员。此处核对不代表已迁移或获得链上授权。 / Independent recovery credential: keep separately from the file. Never send it to chat, websites or support. Verification is not migration or on-chain authority.';
    secret.value=value.credential;secret.hidden=false;show.hidden=false;confirm.hidden=true;dialog.showModal();
   }else result.textContent=response?.ok===true&&value?.saved===false?'已取消；没有确认备份。 / Cancelled; backup not confirmed.':'备份未确认；已有文件与原记录保留，不会自动重试。 / Backup unconfirmed; existing file and original records retained, no automatic retry.';
  }catch{if(token===generation&&live(chosen.security))result.textContent='备份通道不可用；不会自动重试。 / Backup unavailable; no automatic retry.';}
  finally{busy=false;render();}
 });
 clearSecret();return Object.freeze({render,invalidate(){generation++;review=null;clearSecret();dialog.close();result.textContent='';render();}});
}
