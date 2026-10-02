import {StandardWalletConnection} from './vendor/standard-wallet-browser-c97f85e9.mjs';
import {createWalletProviderDiscovery} from '../../../packages/wallet-auth/src/wallet-provider-discovery.js';
import {METAMASK_EVM_CHAIN} from '../../../packages/wallet-auth/src/metamask-evm-adapter.js';
import {toYNXAddress,toEVMAddress} from '../../../sdk/js/index.js';
import {createHostedWalletAdapter} from '../../wallet-web/src/hosted-adapter.js';
import {mountFinanceHostedWalletUI} from './hosted-wallet-controller.js';
import {privateFinance,bindPrivateFinanceUI} from './private-wallet-entry.js';
import {WalletConnectDAppConnection} from '../../../packages/wallet-auth/src/walletconnect-dapp-connection.js';
import QRCode from 'qrcode';

const ORIGIN='https://finance.ynxweb4.com';
const PROVIDER_KEY='ynx.finance.standard-wallet.provider.v2';
const DOWNLOAD='https://www.ynxweb4.com/dapp/download',METAMASK='https://metamask.io/download/';
const CHAIN=METAMASK_EVM_CHAIN;
let connection=null,selectedProvider=null,providerRegistry=null,hosted=null,activeTransport=null,unsubscribe=()=>{},intent=0,revision=0,busy=false,revoking=null;
let standard=Object.freeze({status:'disconnected',providerKind:null,account:null,chainId:null});
let lastMessage='';
let pendingConnection=null;
let pair=null,pairOperation=null,pairState=Object.freeze({status:'idle'});
function publishPair(next){pairState=Object.freeze({...next});window.dispatchEvent(new CustomEvent('ynx-finance-pair-state',{detail:pairState}));}
function pairClient(){
  if(pair)return pair;
  pair=new WalletConnectDAppConnection({origin:ORIGIN,methods:['personal_sign','ynx_requestProductSessionV2']});
  pair.on('stage',event=>{if(pairOperation&&pairOperation.revision===intent&&!pairOperation.uriReady&&event.stage!=='approval')publishPair({status:'opening',stage:event.stage});});
  pair.on('cancelUnconfirmed',event=>{if(event.current!==false&&event.userCancelled===true)publishPair({status:'cancel-unconfirmed',errorCode:'PAIR_CANCEL_UNCONFIRMED'});});
  pair.on('disconnect',()=>{if(activeTransport!=='pair')return;privateFinance.guest();preference(null);publishPair({status:'disconnected'});publish({status:'disconnected',providerKind:'ynx-wallet',account:null,chainId:null,transport:'walletconnect',disconnectReason:'permission-revoked'});});
  return pair;
}
function connectPair(){
  if(pairOperation)return pairOperation.promise;
  if(pendingConnection||busy)return Promise.resolve(null);
  const operation={revision:++intent,promise:null,uriReady:false};pairOperation=operation;
  activeTransport='pair';detach();void hosted?.disconnect();preference(null);busy=true;
  publishPair({status:'opening'});publish({status:'connecting',providerKind:'ynx-wallet',account:null,chainId:null,transport:'walletconnect'});
  operation.promise=(async()=>{
    try{
      const provider=await pairClient().connect({onURI:uri=>{
        if(pairOperation!==operation||operation.revision!==intent)return;
        operation.uriReady=true;const expiresAt=Date.now()+30000,deeplink=`ynxwallet://wc?uri=${encodeURIComponent(uri)}`;publishPair({status:'pairing',expiresAt,deeplink});
        void QRCode.toDataURL(uri,{width:240,margin:2,color:{dark:'#002FA7',light:'#FFFFFF'}}).then(qrDataURL=>{
          if(pairOperation===operation&&operation.revision===intent&&pairState.status==='pairing')publishPair({status:'pairing',qrDataURL,expiresAt,deeplink});
        }).catch(()=>{if(pairOperation===operation&&operation.revision===intent)publishPair({status:'failed',errorCode:'PAIR_QR_UNAVAILABLE'});});
      }});
      if(pairOperation!==operation||operation.revision!==intent){if(!pairOperation)await pair.disconnect();return null;}
      const selected=attach(provider,'ynx-wallet');await selected.restore();isCurrent(operation.revision,selected);
      const next={...snapshot(selected,'ynx-wallet'),transport:'walletconnect'};
      if(next.status!=='connected'||next.chainId!=='0x1917')throw new Error('WRONG_NETWORK');
      preference('ynx-pair');publishPair({status:'connected'});publish(next);return standard;
    }catch(error){if(pairOperation===operation&&operation.revision===intent){detach();const code=[4001,5000,5001,5002,5003].includes(Number(error?.code))||error?.code==='USER_REJECTED'?'USER_REJECTED':/^[A-Z][A-Z_0-9]{0,80}$/.test(error?.message??'')?error.message:'PAIR_UNAVAILABLE';publishPair({status:'failed',errorCode:code});publish({status:'disconnected',providerKind:'ynx-wallet',account:null,chainId:null,transport:'walletconnect'},code);}return null;}
    finally{if(pairOperation===operation){pairOperation=null;busy=false;render();}}
  })();return operation.promise;
}
async function cancelPair(){
  if(!pairOperation)return;
  const operation=pairOperation;pairOperation=null;++intent;busy=false;activeTransport=null;detach();publishPair({status:'cancelling'});
  try{await pair?.cancel();if(!pairOperation&&intent===operation.revision+1&&pairState.status!=='cancel-unconfirmed')publishPair({status:'idle'});}
  catch{if(!pairOperation)publishPair({status:'cancel-unconfirmed',errorCode:'PAIR_CANCEL_UNCONFIRMED'});}
  if(!pairOperation&&activeTransport===null)publish({status:'disconnected',providerKind:null,account:null,chainId:null,disconnectReason:'explicit-local'});
}
function label(key){return window.YNXFinanceLocale?.text(key)??key;}
function message(code){
  const key=({REQUEST_PENDING:'standardBusy',WALLET_NOT_FOUND:'walletNotFound',USER_REJECTED:'walletRejected',WRONG_NETWORK:'walletWrongChain',LOCAL_DISCONNECT_ONLY:'standardDisconnected',PERMISSION_REVOKED:'walletRevoked',WALLET_DETAILS_ONLY:'walletDetailsOnly',PROVIDER_ACCOUNT_UNAVAILABLE:'walletAccountUnavailable'})[code];
  return key?label(key):code?.startsWith('REVOCATION_')?label('walletRevocationUnconfirmed'):code?label('walletActionUnavailable'):'';
}
const ready=new Promise(resolve=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',resolve,{once:true}):resolve()).then(boot);
window.YNXFinanceWallet=Object.freeze({
  ready,connect:connectYNXWallet,connectMetaMask:()=>connect('metamask'),
  connectPair,cancelPair,getPairState:()=>pairState,
  restoreStandardWallet,disconnectStandardWallet,revokeStandardWallet,
  getStandardWalletState:()=>standard,getStandardRevision:()=>revision,getRevision:()=>revision+privateFinance.revision(),
  signEVMLoginRequest,requestProductSessionV2,
  privateProviderAvailable:()=>standard.status==='connected'&&standard.providerKind==='ynx-wallet'&&standard.chainId==='0x1917'&&(['injected','pair'].includes(activeTransport)&&!!selectedProvider||activeTransport==='hosted'&&['connected','transport-unavailable'].includes(hosted?.getState().status)),
  reserveHostedRequest:()=>activeTransport==='hosted'?hosted.reserve():Promise.resolve(null),
  connected:privateFinance.connected,session:privateFinance.session,requireProof:privateFinance.proof,
  privateAccountMatchesSelected:privateFinance.accountMatchesSelected,
  browserIdentityMatchesSelected:account=>{try{return !standard.account||toEVMAddress(account).toLowerCase()===standard.account.toLowerCase();}catch{return false;}},
  disconnect:privateFinance.disconnect,reportPrivateFailure:privateFinance.reportFailure,
  beginPrivate:privateFinance.begin,retryPrivate:privateFinance.retry,restorePrivate:privateFinance.restore,
  guestPrivate:privateFinance.guest,getPrivateState:privateFinance.state,
});
function preference(value){try{if(value===undefined){const saved=localStorage.getItem(PROVIDER_KEY);return ['ynx-wallet','metamask','ynx-pair','ynx-hosted'].includes(saved)?saved:null;}if(value)localStorage.setItem(PROVIDER_KEY,value);else localStorage.removeItem(PROVIDER_KEY);}catch{}return null;}
function isCurrent(value,selected=connection){if(value!==intent||selected!==connection)throw new Error('WALLET_REQUEST_SUPERSEDED');}
function detach(){unsubscribe();unsubscribe=()=>{};const old=connection;connection=null;selectedProvider=null;old?.disconnect();}
function hostedStateChanged(next){
  if(activeTransport!=='hosted')return;
  if(next.status==='selection-pending'){publish({status:'selection-pending',providerKind:'ynx-wallet',account:next.account,chainId:next.chainId,transport:'hosted-wallet-web'});return;}
  busy=next.status==='connecting';
  // Account changes invalidate the old local private subject; this is not a
  // claim that Wallet/Gateway permission was revoked remotely.
  if(next.error==='HOSTED_ACCOUNT_CHANGED'||next.error==='HOSTED_DISCONNECTED')privateFinance.guest();
  if(next.error==='HOSTED_LOCAL_DISCONNECT'){
    privateFinance.guest();
    publish({status:'disconnected',providerKind:'ynx-wallet',account:null,chainId:null,transport:'hosted-wallet-web',disconnectReason:'explicit-local'},next.error);return;
  }
  if(next.status==='transport-unavailable'&&['HOSTED_POPUP_CLOSED','HOSTED_REQUEST_EXPIRED_OR_RELOADED'].includes(next.error)&&standard.account&&standard.chainId==='0x1917'){
    // The signing channel closed, not the selected account or separately
    // approved business identity. Preserve the identity revision for requests.
    lastMessage=next.error;render();return;
  }
  const connected=next.status==='connected'&&next.chainId==='0x1917'&&/^0x[0-9a-f]{40}$/.test(next.account??'');
  if(connected){
    preference('ynx-hosted');
    try{if(toEVMAddress(toYNXAddress(next.account))!==next.account)throw new Error('HOSTED_ADDRESS_ROUNDTRIP_FAILED');}
    catch{void hosted?.disconnect();publish({status:'unavailable',providerKind:'ynx-wallet',account:null,chainId:null,transport:'hosted-wallet-web'},'HOSTED_ADDRESS_INVALID');return;}
  }
  if(connected&&standard.status==='connected'&&standard.transport==='hosted-wallet-web'&&standard.account===next.account&&standard.chainId===next.chainId){lastMessage='';render();return;}
  publish({status:connected?'connected':next.status,providerKind:'ynx-wallet',account:connected?next.account:null,chainId:connected?next.chainId:null,transport:'hosted-wallet-web'},next.error??'');
  if(connected){document.querySelector('#wallet-choice')?.classList.add('hidden');document.querySelector('#wallet-details')?.focus();}
}
function hostedAttempt(){
  if(pairOperation)void cancelPair();
  ++intent;detach();preference(null);activeTransport='hosted';busy=true;
  publish({status:'connecting',providerKind:'ynx-wallet',account:null,chainId:null,transport:'hosted-wallet-web'});
}
function connectYNXWallet(){
  // Installed/provider choice never silently switches to the independent
  // Hosted Wallet. Hosted remains available through its explicit own button.
  return connect('ynx-wallet');
}
async function providers(){
  if(!providerRegistry||providerRegistry.disposed)providerRegistry=createWalletProviderDiscovery(window);
  providerRegistry.request();
  await new Promise(resolve=>setTimeout(resolve,160));
  return providerRegistry.snapshot();
}
function publish(next,message=''){standard=Object.freeze({...next});revision++;lastMessage=message;render();window.dispatchEvent(new CustomEvent('ynx-finance-standard-state',{detail:{...standard,revision,errorCode:/^[A-Z][A-Z_0-9]{0,80}$/.test(message)?message:null}}));}
function snapshot(selected,kind){const session=selected.current;return session?{status:session.selectedChain==='0x1917'?'connected':'wrong-chain',providerKind:kind,account:session.selectedAccount,chainId:session.selectedChain}:{status:'disconnected',providerKind:kind,account:null,chainId:null};}
function attach(provider,kind){
  const selected=new StandardWalletConnection({provider,origin:ORIGIN,metadata:{name:'YNX Finance',url:ORIGIN}});
  connection=selected;
  selectedProvider=provider;
  unsubscribe=selected.subscribe(({event})=>{
    if(selected!==connection||!['accountsChanged','chainChanged','disconnect'].includes(event))return;
    const next=snapshot(selected,kind);
    if(event==='disconnect'&&!provider.isYNXPair&&standard.account&&standard.chainId==='0x1917'){
      publish({...standard,status:'transport-unavailable',disconnectReason:'transport-unavailable'});return;
    }
    if(event==='accountsChanged'&&standard.account&&next.account!==standard.account){
      privateFinance.guest();
      next.disconnectReason='account-changed';
    }
    if(event==='chainChanged'&&standard.account&&next.chainId!==standard.chainId){
      privateFinance.guest();
      next.disconnectReason='chain-changed';
    }
    if(next.status==='disconnected'&&selected!==revoking)preference(null);
    if(JSON.stringify(next)!==JSON.stringify(standard))publish(next);
  });
  return selected;
}
async function ensureChain(selected,value){
  try{await selected.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN.chainId}]});}
  catch(error){isCurrent(value,selected);if(Number(error?.code)!==4902)throw error;await selected.request({method:'wallet_addEthereumChain',params:[CHAIN]});isCurrent(value,selected);await selected.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN.chainId}]});}
  isCurrent(value,selected);
  if(await selected.request({method:'eth_chainId'})!=='0x1917')throw new Error('WRONG_NETWORK');
  isCurrent(value,selected);
}
async function signEVMLoginRequest(request){
  const selected=connection,value=intent,account=standard.account;
  const useHosted=activeTransport==='hosted'&&['connected','transport-unavailable'].includes(hosted?.getState().status);
  if((!selected&&!useHosted)||standard.status!=='connected'||standard.chainId!=='0x1917'||!/^0x[0-9a-f]{40}$/.test(account||''))throw new Error('STANDARD_WALLET_NOT_CONNECTED');
  if(request?.method!=='personal_sign'||!Array.isArray(request.params)||request.params.length!==2||typeof request.message!=='string'||request.message.length>8192||!/^0x(?:[0-9a-fA-F]{2})+$/.test(request.params[0])||request.params[1]!==account)throw new Error('WALLET_LOGIN_REQUEST_INVALID');
  const exactMessageHex='0x'+Array.from(new TextEncoder().encode(request.message),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(request.params[0].toLowerCase()!==exactMessageHex)throw new Error('WALLET_LOGIN_MESSAGE_MISMATCH');
  const requestWallet=input=>useHosted?hosted.request(input):selected.request(input);
  const assertWallet=()=>{if(value!==intent||standard.account!==account||standard.status!=='connected'||(useHosted?activeTransport!=='hosted'||hosted?.getState().account!==account:selected!==connection))throw new Error('WALLET_REQUEST_SUPERSEDED')};
  if(await requestWallet({method:'eth_chainId'})!=='0x1917')throw new Error('WRONG_NETWORK');
  assertWallet();
  const signature=await requestWallet({method:'personal_sign',params:request.params});
  assertWallet();
  if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new Error('WALLET_LOGIN_SIGNATURE_INVALID');
  return signature;
}
async function requestProductSessionV2(url){
  const transport=activeTransport,useHosted=transport==='hosted',provider=useHosted?hosted:selectedProvider,selected=useHosted?hosted:connection,value=intent,account=standard.account,chain=standard.chainId,atRevision=revision;
  if(!provider||!selected||!['injected','hosted','pair'].includes(transport)||standard.providerKind!=='ynx-wallet'||standard.status!=='connected'||chain!=='0x1917'||useHosted&&!['connected','transport-unavailable'].includes(hosted.getState().status))throw new Error('PRIVATE_TRANSPORT_UNAVAILABLE');
  if(typeof url!=='string'||url.length>16384)throw new Error('PRIVATE_REQUEST_INVALID');
  const assertSelected=()=>{const hostedState=useHosted?hosted?.getState():null;if(value!==intent||transport!==activeTransport||(useHosted?selected!==hosted||!['connected','transport-unavailable'].includes(hostedState?.status)||hostedState.account!==account||hostedState.chainId!==chain:selected!==connection||provider!==selectedProvider)||atRevision!==revision||standard.account!==account||standard.chainId!==chain||standard.status!=='connected')throw new Error('FINANCE_CONTEXT_CHANGED')};
  assertSelected();
  // The Wallet owns parsing, review and the native account signature. This
  // sends the official SDK route as data, not a browser scheme navigation.
  const result=typeof provider.requestProductSessionV2==='function'?await provider.requestProductSessionV2(url):await provider.request({method:'ynx_requestProductSessionV2',params:[url]});
  assertSelected();
  if(result?.version!==2||typeof result.returnUrl!=='string'||result.returnUrl.length>16384||Object.keys(result).sort().join(',')!=='returnUrl,version')throw new Error('PRIVATE_RETURN_INVALID');
  return result;
}
function connect(kind){
  if(pairOperation)return Promise.resolve(null);
  if(pendingConnection){
    lastMessage='REQUEST_PENDING';render();document.querySelector('#wallet-state')?.focus();
    return pendingConnection.kind===kind&&!pendingConnection.cancelled?pendingConnection.promise:Promise.resolve(null);
  }
  const pending={kind,promise:null,cancelled:false};
  pendingConnection=pending;
  pending.promise=performConnect(kind).finally(()=>{if(pendingConnection===pending)pendingConnection=null});
  return pending.promise;
}
async function performConnect(kind){
  if(!['ynx-wallet','metamask'].includes(kind))throw new Error('WALLET_SELECTION_INVALID');
  const value=++intent;activeTransport='injected';void hosted?.disconnect();detach();preference(null);busy=true;publish({status:'connecting',providerKind:kind,account:null,chainId:null,transport:'injected'});
  try{
    const discovery=await providers();isCurrent(value);
    const provider=(kind==='ynx-wallet'?discovery.ynx:discovery.metamask)?.provider;
    if(!provider){publish({status:'unavailable',providerKind:kind,account:null,chainId:null},'WALLET_NOT_FOUND');return null;}
    const selected=attach(provider,kind);
    await ensureChain(selected,value);
    await selected.connect();isCurrent(value,selected);
    const next=snapshot(selected,kind);publish(next);
    if(next.status!=='connected')throw new Error('WRONG_NETWORK');
    preference(kind);document.querySelector('#wallet-choice')?.classList.add('hidden');
    document.querySelector('#wallet-details')?.focus();return standard;
  }catch(error){if(value===intent){detach();const recovery=kind==='ynx-wallet'&&error?.data?.walletCode==='PROVIDER_ACCOUNT_UNAVAILABLE'&&error.data?.stage==='eth_requestAccounts'&&error.data?.recovery==='open-wallet-vault';publish({status:'disconnected',providerKind:kind,account:null,chainId:null},recovery?'PROVIDER_ACCOUNT_UNAVAILABLE':error?.code===4001?'USER_REJECTED':error.message||'WALLET_UNAVAILABLE');}return null;}
  finally{if(value===intent){busy=false;render();}}
}
async function restoreStandardWallet(){
  const kind=preference(),value=++intent;activeTransport=kind?'injected':null;detach();busy=false;publish({status:'disconnected',providerKind:kind,account:null,chainId:null});
  if(!kind)return null;
  try{
    if(kind==='ynx-hosted'){activeTransport='hosted';hosted.restoreSelection();if(hosted.getState().status==='disconnected')preference(null);return standard;}
    if(kind==='ynx-pair'){
      activeTransport='pair';const provider=await pairClient().restore();isCurrent(value);
      if(!provider){preference(null);return null;}
      const selected=attach(provider,'ynx-wallet');await selected.restore();isCurrent(value,selected);
      publish({...snapshot(selected,'ynx-wallet'),transport:'walletconnect'});publishPair({status:standard.status});return standard;
    }
    const discovery=await providers();isCurrent(value);
    const provider=(kind==='ynx-wallet'?discovery.ynx:discovery.metamask)?.provider;
    if(!provider){lastMessage='WALLET_NOT_FOUND';render();return null;}
    const selected=attach(provider,kind);await selected.restore();isCurrent(value,selected);
    publish(snapshot(selected,kind));if(standard.status!=='connected')preference(null);return standard;
  }catch(error){if(value===intent){detach();publish({status:'disconnected',providerKind:kind,account:null,chainId:null},error.message||'WALLET_UNAVAILABLE');}return null;}
}
function disconnectStandardWallet(){if(pairOperation)void cancelPair();else if(activeTransport==='pair')void pair?.disconnect().catch(()=>publishPair({status:'cancel-unconfirmed',errorCode:'PAIR_CANCEL_UNCONFIRMED'}));if(pendingConnection){pendingConnection.cancelled=true;pendingConnection=null;}intent++;activeTransport=null;busy=false;preference(null);detach();void hosted?.disconnect();publish({status:'disconnected',providerKind:null,account:null,chainId:null,disconnectReason:'explicit-local'},'LOCAL_DISCONNECT_ONLY');}
async function revokeStandardWallet(){
  if(activeTransport==='pair'){
    try{await pair.disconnect();disconnectStandardWallet();return {status:'revoked',permissionRevoked:true,locallyDisconnected:true};}
    catch{publishPair({status:'cancel-unconfirmed',errorCode:'PAIR_CANCEL_UNCONFIRMED'});return {status:'unconfirmed',permissionRevoked:false,locallyDisconnected:false};}
  }
  if(activeTransport==='hosted'){
    busy=true;render();
    try{const result=await hosted.revoke();disconnectStandardWallet();return result;}
    finally{busy=false;render();}
  }
  const selected=connection,value=intent;if(!selected)return {status:'unsupported',permissionRevoked:false,locallyDisconnected:true};
  busy=true;revoking=selected;render();
  try{
    const result=await selected.revoke();
    if(value!==intent||selected!==connection)return {status:'superseded',permissionRevoked:false,locallyDisconnected:standard.status!=='connected'};
    if(result.permissionRevoked){preference(null);detach();publish({status:'disconnected',providerKind:null,account:null,chainId:null,disconnectReason:'permission-revoked'},'PERMISSION_REVOKED');}
    else {lastMessage='REVOCATION_'+result.status.toUpperCase();render();}
    return result;
  }finally{if(value===intent){busy=false;revoking=null;render();}}
}
function render(){
  const connected=standard.status==='connected';
  const status=document.querySelector('#wallet-state');
  let accountLabel=standard.account;
  if(connected&&standard.providerKind==='ynx-wallet'){
    try{const native=toYNXAddress(standard.account);if(toEVMAddress(native)===standard.account)accountLabel=`${native} · EVM ${standard.account}`;}catch{}
  }
  if(status){status.textContent=(lastMessage&&lastMessage!=='LOCAL_DISCONNECT_ONLY'?message(lastMessage)+' · ':'')+(connected?(standard.providerKind==='metamask'?'MetaMask':standard.transport==='hosted-wallet-web'?'YNX Wallet Web':'YNX Wallet')+' · '+accountLabel+' · '+standard.chainId+' · '+label('standardOnly'):busy?label('standardBusy'):label('standardDisconnected'));status.title=lastMessage||'';}
  for(const element of document.querySelectorAll('.connect,#connect-metamask'))element.disabled=busy;
  for(const id of ['wallet-details','wallet-disconnect','wallet-revoke','wallet-switch']){const element=document.querySelector('#'+id);if(element)element.hidden=!(connected||id==='wallet-disconnect'&&busy);}
  const revoke=document.querySelector('#wallet-revoke');if(revoke){revoke.disabled=busy;revoke.hidden=!connected||standard.transport==='hosted-wallet-web';}
  const disconnect=document.querySelector('#wallet-disconnect');if(disconnect)disconnect.textContent=label(busy?'walletCancel':'walletDisconnect');
  const choice=document.querySelector('#wallet-choice');if(choice)choice.classList.toggle('hidden',connected);
}
async function boot(){
  hosted=mountFinanceHostedWalletUI({document,window,createHostedWalletAdapter,text:label,onAttempt:hostedAttempt,onChange:hostedStateChanged});
  document.querySelector('#wallet-connection-details')?.append(document.querySelector('#hosted-wallet'));
  window.YNXFinanceHostedWallet=hosted;
  providerRegistry=createWalletProviderDiscovery(window);
  providerRegistry.subscribe(()=>render());
  document.querySelector('#connect-metamask')?.addEventListener('click',()=>connect('metamask'));
  document.querySelector('#wallet-disconnect')?.addEventListener('click',disconnectStandardWallet);
  document.querySelector('#wallet-revoke')?.addEventListener('click',()=>revokeStandardWallet());
  document.querySelector('#wallet-switch')?.addEventListener('click',()=>{disconnectStandardWallet();document.querySelector('#connect-ynx')?.focus();});
  document.querySelector('#wallet-details')?.addEventListener('click',()=>{lastMessage='WALLET_DETAILS_ONLY';render();});
  document.addEventListener('click',event=>{
    const action=event.target?.closest?.('#signin,#wallet-entry,#wallet-picker-action,#wallet-login-verify,#evm-read-begin,#private-begin,#private-retry');
    if(activeTransport!=='hosted'||!action)return;
    // Capture runs while the real click still grants popup activation. The
    // subsequent async challenge remains data-only until explicit approval.
    if(standard.status==='selection-pending'){
      // Pause only this explicit operation until the Wallet has verified its
      // own grant. Never admit cached selection as connected/private access.
      event.preventDefault();event.stopImmediatePropagation();
      const selectedIntent=intent;
      void hosted.reserve().then(()=>{if(selectedIntent===intent&&activeTransport==='hosted'&&standard.status==='connected'&&action.isConnected)action.click();}).catch(error=>{lastMessage=error.code;render();});
      return;
    }
    void hosted.reserve().catch(()=>{});
  },true);
  document.addEventListener('finance:localechange',render);
  document.addEventListener('click',event=>{
    const link=event.target?.closest?.('#browser-signin-start');if(!link)return;
    // The product handler sets its target first. Add only a display preference
    // to the same-origin start URL; the backend owns every return destination.
    const url=new URL(link.href,location.origin),language=document.documentElement.lang;
    if(url.origin===location.origin&&url.pathname==='/sso/start'&&['en','zh-CN','zh-Hant'].includes(language)){url.searchParams.set('lang',language);link.href=url.href;}
  });
  document.querySelector('#install-wallet')?.setAttribute('href',DOWNLOAD);
  document.querySelector('#install-metamask')?.setAttribute('href',METAMASK);
  await restoreStandardWallet();
  bindPrivateFinanceUI();
}
window.addEventListener('pagehide',()=>{if(pairOperation)void cancelPair();publishPair({status:'idle'});intent++;activeTransport=null;detach();hosted?.suspend();});
window.addEventListener('pageshow',event=>{if(event.persisted)restoreStandardWallet();});
