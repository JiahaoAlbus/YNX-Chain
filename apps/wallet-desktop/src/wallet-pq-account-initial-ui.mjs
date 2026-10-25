// Public preview only. No Genesis, policy, permission, wire or signer is chosen
// by this UI. Confirmation remains the original normal provider review dialog.
const message='登记预览已打开；未签名、未提交，Native 许可尚未就绪。 / Registration preview opened; not signed or submitted. Native permission is not ready.';
export function createPQAccountInitialUI({api,getKeyState,document:doc=document}){
 const panel=doc.createElement('section'),title=doc.createElement('h3'),help=doc.createElement('p'),label=doc.createElement('label'),height=doc.createElement('input'),open=doc.createElement('button'),result=doc.createElement('p');
 panel.id='pq-account-initial';title.textContent='新账户登记预览（不是迁移） / Initial account registration preview (not migration)';
 help.textContent='仅为已在本地保存的独立 PQ 公钥准备登记请求。不生成密钥，不导入或导出私钥，不花费资金。签名与提交分别确认；原 Genesis、空闲账户与 Native 许可尚须验证。 / Preview using the existing protected PQ public pair only. No key generation, private-key import/export or spending. Signing and submission are separate; original Genesis, unused owner and Native permission still require verification.';
 label.textContent='拟生效高度 / Proposed activation height';height.type='text';height.inputMode='numeric';height.autocomplete='off';height.id='pq-account-initial-height';label.htmlFor=height.id;open.type='button';open.textContent='打开登记签名预览 / Preview registration signing';open.disabled=true;result.setAttribute('role','status');panel.append(title,help,label,height,open,result);doc.querySelector('#backup-section').append(panel);
 let busy=false,generation=0;
 const same=s=>{const now=getKeyState();return !now.locked&&!now.authenticating&&now.account===s.account&&now.revision===s.revision;};
 const render=()=>{const s=getKeyState();open.disabled=busy||s.locked||s.authenticating||!s.account;};
 open.addEventListener('click',async()=>{
  const state={...getKeyState()},token=generation;if(busy||!same(state)||!state.account)return;
  busy=true;render();
  try{const response=await api.preparePQAccountInitial({activateAt:height.value});if(token!==generation||!same(state))return;const v=response?.value;result.textContent=response?.ok===true&&v?.account===state.account&&v.effectReady===false&&v.signed===false&&v.submitted===false?message:'登记预览不可用；请检查高度及原本地公钥。没有签名或发送，不自动重试。 / Preview unavailable; check height and original protected public keys. No signing, send or automatic retry.';}
  catch{if(token===generation&&same(state))result.textContent='登记预览未打开；没有签名、发送或自动重试。 / Preview did not open; no signing, send or automatic retry.';}
  finally{busy=false;render();}
 });
 return Object.freeze({render,invalidate(){generation++;height.value='';result.textContent='';render();}});
}
export function appendPQAccountInitialReviewAction({row,record,api,getKeyState,isCurrent,onResult,document:doc=document}){
 if(record.kind!=='pq-account-initial'||record.status!=='pq-signed-unsubmitted'||!/^0x[0-9a-f]{64}$/.test(record.hash??''))return;
 const button=doc.createElement('button');button.type='button';button.textContent='预览提交原登记（另行确认） / Preview registration submission (separate approval)';button.disabled=getKeyState().locked;let busy=false;
 button.addEventListener('click',async()=>{
  const before={...getKeyState()},live=()=>{const s=getKeyState();return isCurrent()&&!s.locked&&!s.authenticating&&s.account===record.account&&s.account===before.account&&s.revision===before.revision;};
  if(busy||!live())return;busy=true;button.disabled=true;
  try{const response=await api.preparePQAccountInitialBroadcast(record.hash);if(!live())return;const v=response?.value;onResult(response?.ok===true&&v?.account===record.account&&v.action==='broadcast'&&v.effectReady===false&&v.signed===false&&v.submitted===false?message:'原登记提交预览未确认；保留同一原件，不签名、不发送、不自动重试。 / Original submission preview unconfirmed; retain the same Member without signing, sending or retrying.');}
  catch{if(live())onResult('原登记预览不可用；原件保留，不重签或重发。 / Original preview unavailable; retained without re-signing or sending.');}
  finally{busy=false;if(isCurrent())button.disabled=getKeyState().locked;}
 });row.append(button);
}
