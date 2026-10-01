const status=document.querySelector('#identity-status'),begin=document.querySelector('#identity-begin'),logout=document.querySelector('#identity-logout');
let current=null,epoch=0,busy=false,firstCheck=true;
const describe=text=>{status.textContent=text;logout.hidden=!current;};
async function restore(){
 const attempt=++epoch;
 try{const response=await fetch('/api/account',{credentials:'same-origin',cache:'no-store',redirect:'error'});const data=await response.json();if(attempt!==epoch)return;
  if(response.status===401){if(firstCheck){firstCheck=false;try{const config=await fetch('/api/wallet/config',{cache:'no-store',redirect:'error'}).then(value=>value.json());if(attempt!==epoch)return;if(config.browserSSOConfigured&&!sessionStorage.getItem('ynx-ai-sso-silent-attempt')){sessionStorage.setItem('ynx-ai-sso-silent-attempt','yes');location.replace('/sso/start?prompt=none&target=chat');return;}}catch{}}const previous=current;current=null;describe('Sign in to your YNX account. AI private access needs a separate approval.');if(previous)window.dispatchEvent(new CustomEvent('ynx-ai-wallet-invalidated',{detail:{reason:'identity-revoked'}}));return;}
  if(!response.ok)throw new Error('Account check is unavailable. Retry when online.');
  if(data.signedIn!==true||data.privateWorkspaceAuthorized!==false||data.scopes?.length!==1||data.scopes[0]!=='identity:read')throw new Error('Unexpected account permission response.');
  if(current&&current.account!==data.account)window.dispatchEvent(new CustomEvent('ynx-ai-wallet-invalidated',{detail:{reason:'account-changed'}}));
  current=data;describe('Signed in as '+data.account+'. AI access is approved separately.');
 }catch(error){if(attempt===epoch)describe(error.message+' Existing AI access has not been revoked.');}
}
logout.onclick=async()=>{if(busy||!current)return;busy=true;logout.disabled=true;++epoch;try{const response=await fetch('/api/account/logout',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'X-YNX-SSO-CSRF':current.csrfToken}});const result=await response.json();if(!response.ok||result.revoked!==true)throw new Error('Sign-out is not confirmed. Retry.');current=null;describe('Signed out of this site.');window.dispatchEvent(new CustomEvent('ynx-ai-wallet-invalidated',{detail:{reason:'identity-revoked'}}));}catch(error){describe(error.message);}finally{busy=false;logout.disabled=false;}};
window.addEventListener('focus',()=>{if(!busy)void restore()});window.addEventListener('pageshow',event=>{if(event.persisted)void restore()});window.addEventListener('pagehide',()=>epoch++);
void restore();
