import {canonicalJSON} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {StandardWalletConnection} from './standard-wallet-connection.js';
import {METAMASK_EVM_CHAIN} from './metamask-evm-adapter.js';
import {createWalletProviderDiscovery,WALLET_PROVIDER_KIND} from './wallet-provider-discovery.js';
import {parseCentralBrowserSignInChallenge,parseCentralBrowserSignInApproval} from './central-browser-session-contract.js';
import {WalletConnectDAppConnection} from './walletconnect-dapp-connection.js';
import QRCode from 'qrcode';

const context=JSON.parse(document.getElementById('context').textContent);
if(context.mode==='session'){
  const status=document.getElementById('status'),button=document.getElementById('global-logout');
  let pending=false;
  const read=async(path,options={})=>{const response=await fetch(`/v2/browser-sessions/${path}`,{credentials:'same-origin',...options,signal:AbortSignal.timeout(10000)});const value=await response.json();if(!response.ok)throw new Error(value.error?.code??'SSO_REQUEST_FAILED');return value;};
  const refresh=async()=>{try{const identity=await read('status');status.textContent=identity.account;button.disabled=false;}catch(error){status.textContent=error.message==='SSO_LOGIN_REQUIRED'?'You are signed out.':'Session status is unavailable. Retry checking before signing out.';button.disabled=error.message==='SSO_LOGIN_REQUIRED';}};
  button.addEventListener('click',async()=>{if(pending)return;pending=true;button.disabled=true;button.setAttribute('aria-busy','true');try{const boot=await read('bootstrap');await read('logout',{method:'POST',headers:{'content-type':'application/json','x-ynx-browser-csrf':boot.sessionCsrfToken},body:canonicalJSON({})});status.textContent='Signed out of all YNX products.';}catch{status.textContent='Global sign-out is not confirmed. Retry; no successful revocation is assumed.';button.disabled=false;}finally{pending=false;button.removeAttribute('aria-busy');}});
  window.addEventListener('focus',()=>{if(!pending)void refresh();});void refresh();
}else{
const challenge=parseCentralBrowserSignInChallenge(context.challenge,context.registry,{peerOrigin:location.origin});
const picker=document.getElementById('wallet'),approve=document.getElementById('approve'),cancel=document.getElementById('cancel'),status=document.getElementById('status');
const discovery=createWalletProviderDiscovery(window);
const restart=document.createElement('button');restart.id='restart';restart.hidden=true;restart.textContent='Return to product and retry';cancel.after(restart);restart.addEventListener('click',()=>cancel.click());
let providers=[],selected=null,pending=null,revision=0,cancelled=false;
const message=value=>{status.textContent=value;};
const pairButton=document.createElement('button');pairButton.id='pair';pairButton.type='button';pairButton.textContent='Connect mobile YNX Wallet';
const pairRegion=document.createElement('div');pairRegion.id='pair-request';pairRegion.hidden=true;
const pairLabel=document.createElement('p');pairLabel.textContent='Scan with YNX Wallet to approve this browser connection. Browser sign-in remains a separate approval.';
const pairCanvas=document.createElement('canvas');pairCanvas.setAttribute('role','img');pairCanvas.setAttribute('aria-label','Temporary YNX Wallet connection QR code');pairRegion.append(pairLabel,pairCanvas);picker.after(pairButton,pairRegion);
let pair=null,pairPending=null,pairProvider=null;
const clearPairQR=()=>{pairRegion.hidden=true;pairCanvas.width=pairCanvas.height=0;};
pairButton.addEventListener('click',()=>{
  if(cancelled||pending||pairPending){message('Finish or cancel your current request before opening another connection.');return;}
  const epoch=++revision;selected=null;approve.disabled=true;pairButton.setAttribute('aria-busy','true');message('Opening a mobile Wallet connection. No sign-in signature has been requested.');
  pair??=new WalletConnectDAppConnection({origin:location.origin,methods:['ynx_requestCentralBrowserSignIn'],deadlineMs:Math.max(1,Math.min(30000,Date.parse(challenge.expiresAt)-Date.now()))});
  pairPending=(async()=>{
    let provider=await pair.restore();if(epoch!==revision||cancelled)throw new Error('SSO_CONTEXT_CHANGED');
    if(!provider)provider=await pair.connect({onURI:uri=>{
      if(epoch!==revision||cancelled)return;
      // Pairing URI contains a temporary secret: only render it locally. It
      // must never enter diagnostics, URLs, business storage or telemetry.
      pairRegion.hidden=false;void QRCode.toCanvas(pairCanvas,uri,{width:240,margin:2,color:{dark:'#002FA7',light:'#FFFFFF'}}).catch(()=>{if(epoch!==revision||cancelled)return;clearPairQR();message('QR rendering is unavailable. Cancel and retry the connection.');});
      message('Scan this temporary QR in YNX Wallet and approve the connection.');
    }});
    if(epoch!==revision||cancelled){await pair.cancel();throw new Error('SSO_CONTEXT_CHANGED');}
    clearPairQR();pairProvider=provider;selected=provider;picker.value='';approve.disabled=false;message('Mobile Wallet connected. Continue to review browser sign-in on the same Wallet session.');
  })().catch(()=>{clearPairQR();if(epoch===revision&&!cancelled)message('Mobile connection did not finish. Retry or cancel; no browser sign-in was granted.');})
    .finally(()=>{pairPending=null;pairButton.removeAttribute('aria-busy');});
});
const request=async(path,input)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch(`/v2/browser-sessions/${path}`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-ynx-browser-csrf':context.csrfToken},body:canonicalJSON(input),signal:controller.signal});
    const value=await response.json();if(!response.ok)throw new Error(value.error?.code??'SSO_REQUEST_FAILED');return value;
  }finally{clearTimeout(timer);}
};
discovery.subscribe(snapshot=>{
  providers=snapshot.candidates.filter(value=>value.kind===WALLET_PROVIDER_KIND.YNX).map(value=>value.provider);
  const previous=selected;picker.replaceChildren();
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose YNX Wallet';picker.append(placeholder);
  providers.forEach((provider,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`YNX Wallet ${index+1}`;picker.append(option);});
  if(previous&&providers.includes(previous)){picker.value=String(providers.indexOf(previous));}else if(previous&&previous!==pairProvider){selected=null;revision++;}
  approve.disabled=!selected||cancelled;if(!providers.length&&!pairPending&&!selected)message('Installed YNX Wallet is unavailable. Install/unlock it or explicitly connect your mobile Wallet.');
});
picker.addEventListener('change',()=>{selected=picker.value===''?null:providers[Number(picker.value)];revision++;if(pairPending){clearPairQR();void pair.cancel();}approve.disabled=!selected||cancelled;message(pending?'Finish or cancel the current request before switching wallets.':'Connection is separate from browser sign-in approval.');});
approve.addEventListener('click',()=>{
  if(pending){message('Your request is already open in YNX Wallet.');return;}
  if(!selected||cancelled)return;
  const provider=selected,epoch=revision;let account=null,chain=null,invalid=false,unsubscribe=()=>{};
  const operationAbort=new AbortController();
  const walletWait=async(work)=>{let timer,onAbort;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SSO_REQUEST_TIMEOUT')),Math.max(1,Math.min(30000,Date.parse(challenge.expiresAt)-Date.now())));onAbort=()=>reject(new Error('SSO_CONTEXT_CHANGED'));operationAbort.signal.addEventListener('abort',onAbort,{once:true});})]);}finally{clearTimeout(timer);operationAbort.signal.removeEventListener('abort',onAbort);}};
  const connection=new StandardWalletConnection({provider,origin:location.origin,metadata:{name:'YNX browser sign-in',url:location.origin}});
  const changed=()=>{invalid=true;revision++;operationAbort.abort();};
  const assert=()=>{if(cancelled||invalid||epoch!==revision||selected!==provider)throw new Error('SSO_CONTEXT_CHANGED');if(Date.parse(challenge.expiresAt)<=Date.now())throw new Error('SSO_CHALLENGE_EXPIRED');};
  message('Opening YNX Wallet. Unlock and review browser sign-in.');approve.setAttribute('aria-busy','true');
  pending=(async()=>{
    assert();await walletWait(connection.connect());assert();
    if(connection.current?.selectedChain!==METAMASK_EVM_CHAIN.chainId){
      try{await walletWait(connection.request({method:'wallet_switchEthereumChain',params:[{chainId:METAMASK_EVM_CHAIN.chainId}]}));}
      catch(error){assert();if(Number(error?.code)!==4902)throw error;await walletWait(connection.request({method:'wallet_addEthereumChain',params:[METAMASK_EVM_CHAIN]}));assert();await walletWait(connection.request({method:'wallet_switchEthereumChain',params:[{chainId:METAMASK_EVM_CHAIN.chainId}]}));}
      assert();await walletWait(connection.restore());assert();
    }
    account=connection.current?.selectedAccount;chain=connection.current?.selectedChain;
    if(!account||chain!==METAMASK_EVM_CHAIN.chainId)throw new Error('PROVIDER_WRONG_CHAIN');
    unsubscribe=connection.subscribe(event=>{if(['accountsChanged','chainChanged','disconnect'].includes(event.event))changed();});
    const approval=parseCentralBrowserSignInApproval(await walletWait(provider.request({method:'ynx_requestCentralBrowserSignIn',params:[challenge]})));assert();
    const current=await walletWait(provider.request({method:'eth_accounts'})),currentChain=await walletWait(provider.request({method:'eth_chainId'}));assert();
    if(!Array.isArray(current)||current[0]?.toLowerCase()!==account||currentChain!==chain||approval.challengeId!==challenge.challengeId||evmAddressFromYNX(approval.account).toLowerCase()!==account)throw new Error('SSO_CONTEXT_CHANGED');
    await request('complete',approval);assert();message('Sign-in approved. Returning to your product.');location.reload();
  })().catch(async error=>{if(error?.message==='SSO_REQUEST_TIMEOUT'||error?.message==='SSO_CHALLENGE_EXPIRED'){invalid=true;revision++;operationAbort.abort();approve.disabled=true;restart.hidden=false;}
    if(invalid||cancelled||epoch!==revision){approve.disabled=true;restart.hidden=false;try{await request('cancel',{challengeId:challenge.challengeId});}catch{} }
    if(!cancelled)message(error?.code===4001||error?.code==='USER_REJECTED'?'Sign-in was declined. Your existing product permissions are unchanged.':`Sign-in could not finish (${error?.message==='SSO_CONTEXT_CHANGED'?'context changed':error?.message==='SSO_CHALLENGE_EXPIRED'?'request expired':error?.message==='SSO_REQUEST_TIMEOUT'?'request timed out':'wallet or service unavailable'}). Retry or cancel.`);})
    .finally(()=>{operationAbort.abort();unsubscribe();connection.disconnect();pending=null;approve.removeAttribute('aria-busy');});
});
cancel.addEventListener('click',async()=>{
  if(cancelled)return;cancelled=true;revision++;approve.disabled=true;cancel.disabled=true;message('Cancelling this sign-in request…');
  clearPairQR();if(pair)void pair.cancel();
  try{const result=await request('cancel',{challengeId:challenge.challengeId});const redirect=new URL(result.redirectUri);
    if(redirect.origin!==challenge.initiator.origin||redirect.pathname!==new URL(challenge.initiator.redirectUri).pathname||redirect.searchParams.get('state')!==challenge.initiator.state||redirect.searchParams.get('error')!=='access_denied')throw new Error('SSO_REDIRECT_INVALID');
    location.assign(redirect.href);
  }catch{message('Cancellation is not confirmed. Retry cancellation; no late approval will be used on this page.');cancelled=false;cancel.disabled=false;}
});
window.addEventListener('pagehide',()=>{revision++;cancelled=true;discovery.dispose();});
}
