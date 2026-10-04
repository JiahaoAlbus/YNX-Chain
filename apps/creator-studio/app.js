import {createMediaBrowserIdentity} from './browser-identity.js';
import {serializeMediaBody} from './business-wire.js';
import {connectMediaWallet} from './session-events.js';
import {createHostedWalletAdapter, WalletConnectDAppConnection, QRCode} from './ynx-wallet-transports-2ece0cb329.mjs';
import {atRegisteredOrigin, dispatchPreparedProductRequest, finishProductReturn, prepareProductSignIn, restoreProductSession,restoreNativeProductReturn, productAuthorization, disconnectProductSession, subscribeProductSession, announceProductSession, rememberProductReturn} from "./product-session.js";
import {
  attachWalletLifecycle,
  connectStandardWallet,
  discoverWalletProviders,
  ensureYnxTestnet,
  request,
  requestAccountSwitch,
  requestPersonalSign,
  restoreStandardWallet,
  requestTypedDataSign,
  sendRuntimeProofTransaction,
} from "./wallet-auth.js";
import {
  createStandardWalletConnectState,
  reduceStandardWalletConnectState,
  STANDARD_WALLET_CONNECT_STATE_AUTHORITY,
} from "./standard-wallet-connect-state.js";
import{ready as i18nReady,t}from"./i18n.js";
const CREATOR_RUNTIME_BINDING="ynx-creator-studio-web-v1",CREATOR_BUNDLE_ID="com.ynxweb4.creator-studio.web";
const API=`${location.origin}/video/api`,$=s=>document.querySelector(s);
let snapshot=null,currentAI=null,walletConnecting=false;
let creatorSessionRevision=0,creatorAccount=null,creatorPrivateSession=null;
let siteAccountBusy=false;
const browserIdentity=createMediaBrowserIdentity({productId:"creator-studio",onExpiry:()=>renderProductState({status:"retry-required",message:"Your YNX account sign-in expired. Sign in and retry your saved product approval."})});
const authorizeCreator=(path,method,body)=>{const original=creatorPrivateSession,revision=creatorSessionRevision;return browserIdentity.authorization(original,()=>productAuthorization(path,method,body),()=>{if(original!==creatorPrivateSession||revision!==creatorSessionRevision)throw new DOMException("Creator account changed.","AbortError");});};
let payoutFlight=null;
let creatorExpiryTimer;
const creatorRequestFlights=new Set();
let currentUpload=null,activeAIRequest=null,aiSelectionRevision=0,aiCreateRevision=0;
function announceSession(){if(typeof announceProductSession==='function')announceProductSession();}
function rememberReturn(request){if(typeof rememberProductReturn==='function')rememberProductReturn(request,document.querySelector('nav button.active')?.dataset.panel||'overview');}
let selectedChannelId=null,channelReadRevision=0,studioReadRevision=0;
const channelAutofill=new Map();
function currentCreatorSession(revision){return creatorAccount!==null&&revision===creatorSessionRevision}
function assertCreatorSession(revision){if(!currentCreatorSession(revision))throw new Error("Creator account changed. Sign in and retry.")}
const walletProof=$("#wallet-proof");
const walletSummary=$("#wallet-summary");
const walletChooser=$("#wallet-chooser");
const walletChoices=$("#wallet-choices");
const walletStatus=$("#wallet-status");
const walletDisconnect=$("#wallet-disconnect");
const walletRevoke=$("#wallet-revoke");
const walletConnect=$("#signin");
const walletChooserHeading=$("#wallet-chooser-heading");
const walletDetails=$("#wallet-details");
const walletDetailLogo=$("#wallet-detail-logo");
const walletDetailName=$("#wallet-detail-name");
const walletDetailRdns=$("#wallet-detail-rdns");
const walletDetailAccount=$("#wallet-detail-account");
const walletDetailChain=$("#wallet-detail-chain");
const walletDetailPrivate=$("#wallet-detail-private");
const walletPersonalSign=$("#wallet-personal-sign");
const walletTypedData=$("#wallet-eip712-sign");
const walletSendTx=$("#wallet-send-tx");
let walletState=createStandardWalletConnectState(),walletSession={provider:null,account:null,chainId:null,kind:null,discovery:null},walletLifecycleDetach=()=>{},walletProviders=null,walletLastTrigger=null;
function beginCreatorRequest(timeout,externalSignal){
  const controller=new AbortController();
  const abort=()=>controller.abort(externalSignal?.reason||new DOMException('Request cancelled','AbortError'));
  if(externalSignal?.aborted)abort();else externalSignal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),timeout);
  creatorRequestFlights.add(controller);
  return {signal:controller.signal,abort:()=>controller.abort(new DOMException('Request cancelled','AbortError')),
    wait(promise){return new Promise((resolve,reject)=>{const cancelled=()=>reject(controller.signal.reason);if(controller.signal.aborted){Promise.resolve(promise).catch(()=>{});cancelled();return;}controller.signal.addEventListener('abort',cancelled,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',cancelled));});},
    finish(){clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);creatorRequestFlights.delete(controller);},
  };
}
async function api(path,opt={}){
  const revision=creatorSessionRevision;
  assertCreatorSession(revision);
  if(!path.startsWith('/v1/')||path.includes('..'))throw new Error('Invalid Creator service route.');
  const method=(opt.method||'GET').toUpperCase(),baseHeaders={...(opt.headers||{})};
  if(!['GET','HEAD'].includes(method))baseHeaders['Idempotency-Key']||=crypto.randomUUID();
  const processing=path==='/v1/uploads'||/^\/v1\/videos\/[^/]+\/retry-processing$/.test(path);
  const operation=beginCreatorRequest(processing?300000:15000,opt.signal);
  try{
    const wire=await operation.wait(serializeMediaBody(path,method,opt.body,baseHeaders,operation.signal));assertCreatorSession(revision);operation.signal.throwIfAborted();
    let response;
    for(let attempt=0;attempt<2;attempt++){
      const headers={...wire.headers,...await operation.wait(authorizeCreator(path,method,wire.body))};
      assertCreatorSession(revision);operation.signal.throwIfAborted();
      try{response=await operation.wait(fetch(API+path,{...opt,body:wire.body,headers,credentials:'same-origin',redirect:'error',signal:operation.signal}));break}
      catch(error){assertCreatorSession(revision);if(operation.signal.aborted)throw error;if(processing||opt.body instanceof FormData||attempt===1){reduceWallet({type:'PRIVATE_SESSION_DEGRADED'});throw error}}
    }
    const data=await operation.wait(response.json().catch(()=>({error:'Invalid service response'})));
    assertCreatorSession(revision);
    if(!response.ok){if(response.status===401){renderProductState({status:'retry-required',message:'Your Creator sign-in needs to be checked. Sign in again.'});status(data.error||'Your sign-in expired.',true);}if(response.status>=500)reduceWallet({type:'PRIVATE_SESSION_DEGRADED'});throw Object.assign(new Error(data.error||('HTTP '+response.status)),{status:response.status,details:data})}
    reduceWallet({type:'PRIVATE_SESSION_READY'});return data;
  }finally{operation.finish()}
}

const json=body=>({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),get=(x,lower,upper)=>x?.[lower]??x?.[upper],esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
async function sha256Hex(file){if(!crypto.subtle)throw new Error("SHA-256 verification requires HTTPS or localhost.");const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
function status(message,bad=false){$("#status").textContent=message;$("#status").style.color=bad?"#9b2335":"#344054"}
function rows(target,items,render,empty){$(target).innerHTML=items.length?items.map(render).join(""):`<p class="meta">${empty}</p>`}
function walletSummaryMessage() {
  if(!walletSession.account)return"Wallet not connected.";
  return `${walletSession.kind==="ynx-wallet"?"YNX Wallet":"MetaMask"} connected. Account ${walletSession.account.slice(0,10)}...${walletSession.account.slice(-6)} on ${walletSession.chainId}`;
}
function setWalletStatus(message,bad=false){walletStatus.textContent=message;walletStatus.style.color=bad?"#9b2335":"#173a80"}
function setConnectedVisibility(connected){
  walletDisconnect.hidden=!connected;
  walletRevoke.hidden=!connected;
  walletConnect.textContent=connected?"EVM wallet details":"Connect EVM wallet";
}
function setWalletButtons(enabled){
  walletPersonalSign.disabled=!enabled;
  walletTypedData.disabled=!enabled;
  walletSendTx.disabled=!enabled;
}
function resetWalletFlow(){
  walletSummary.textContent="Wallet not connected.";
  walletProof.textContent="Wallet proof actions will appear here after connection.";
  setConnectedVisibility(false);
  setWalletButtons(false);
}
function reduceWallet(event){walletState=reduceStandardWalletConnectState(walletState,event);return walletState}
function logoFor(kind){return kind==="ynx-wallet"?"assets/ynx-wallet.svg":"assets/metamask.svg"}
function labelFor(kind){return kind==="ynx-wallet"?"YNX Wallet":"MetaMask"}
function closeWalletChooser(message){
  reduceWallet({type:"CLOSE_CHOOSER"});
  walletChooser?.classList.remove("open");
  walletChooser?.setAttribute("aria-hidden","true");
  if(message)setWalletStatus(message);
  walletLastTrigger?.focus?.();
}
async function loadDiscovery(){
  const discovery=await discoverWalletProviders(globalThis,1500);
  walletProviders=discovery;
  return discovery;
}
function renderWalletChoices(discovery){
  const ynx=discovery?.ynx;
  const metamask=discovery?.metamask;
  const providers=[];
  if(ynx)providers.push(ynx);
  if(metamask)providers.push(metamask);
  const rows=[];
  if(!providers.length){
    rows.push(`<div class="wallet-empty">No compatible Wallet provider was detected. Install YNX Wallet or MetaMask on this browser.</div>`);
  }
  for(const provider of providers){
    const label=labelFor(provider.kind);
    const logo=`<img class="wallet-logo" src="${logoFor(provider.kind)}" alt="${label} logo">`;
    rows.push(`<button class="wallet-choice" data-provider-kind="${provider.kind}" type="button">${logo}<div><div>${label}</div><small>${esc(provider.name||"Injected wallet")}</small></div><small>Detected via ${esc(provider.source||"injector")}</small></button>`);
  }
  walletChoices.innerHTML=rows.join("");
}
function renderConnectionDetails(){
  const label=labelFor(walletSession.kind);
  walletChooserHeading.textContent="Wallet connection details";
  walletChoices.hidden=true;
  walletDetails.hidden=false;
  walletDetailLogo.src=logoFor(walletSession.kind);
  walletDetailLogo.alt=`${label} logo`;
  walletDetailName.textContent=label;
  walletDetailRdns.textContent=walletSession.discovery?.rdns||"Injected EIP-1193 provider";
  walletDetailAccount.textContent=walletSession.account;
  walletDetailChain.textContent=`YNX Testnet · ${walletSession.chainId}`;
  walletDetailPrivate.textContent=walletState.privateService==="degraded"?"Degraded (Wallet connection remains active)":"Independent from Wallet connection";
}
async function openWalletChooser(event){
  walletLastTrigger=event?.currentTarget||document.activeElement;
  reduceWallet({type:"OPEN_CHOOSER"});
  walletChooser.setAttribute("aria-hidden","false");
  walletChooser.classList.add("open");
  if(walletState.chooserMode==="connection-details"){
    renderConnectionDetails();
    return;
  }
  walletChooserHeading.textContent="Choose wallet provider";
  walletChoices.hidden=false;
  walletDetails.hidden=true;
  walletChoices.innerHTML='<p class="wallet-meta">Scanning for providers…</p>';
  renderWalletChoices(await loadDiscovery());
}
async function connectWithCandidate(candidate){
  if(walletSession.provider||walletConnecting) return;
  walletConnecting=true;
  try{
    reduceWallet({type:"BEGIN",pendingIntent:crypto.randomUUID().replaceAll("-","")});
    reduceWallet({type:"PROVIDER_SELECTED",provider:candidate.provider,providerKind:candidate.kind});
    const connected=await connectStandardWallet(candidate,{product:"ynx-creator-studio",scopes:["ai.video.propose","pay.payout.intent","video.creator","video.read"]});
    reduceWallet({type:"ACCOUNT_APPROVED",account:connected.account});
    reduceWallet({type:"CHAIN_CONFIRMED",chainId:connected.chainId});
    walletSession={provider:connected.provider,account:connected.account,chainId:connected.chainId,kind:connected.kind,discovery:candidate};
    setConnectedVisibility(true);
    setWalletButtons(true);
    setWalletStatus(`Connected with ${connected.kind==="ynx-wallet"?"YNX Wallet":"MetaMask"} on chain ${connected.chainId}.`);
    walletSummary.textContent=walletSummaryMessage();
    walletProof.textContent=`wallet.provider.kind=${connected.kind}  chain=${connected.chainId}  account=${connected.account}`;
    closeWalletChooser();
    status("Wallet session active. Use proof actions to test approve/reject and chain checks.");
    attachConnectedLifecycle(connected.provider);
  }catch(error){reduceWallet({type:"FAIL",error:error.code||"WALLET_ERROR"});setWalletStatus(error.message||"Wallet connection failed",true);closeWalletChooser();}
  finally{walletConnecting=false}
}
async function onWalletConnectClick(event){
  if(event.target.closest("button")?.dataset?.providerKind==null)return;
  const clicked=event.target.closest("button");
  const kind=clicked.dataset.providerKind;
  const candidate=walletProviders?.[kind];
  if(!candidate){setWalletStatus("Selected provider disappeared. Reopen to rescan.",true);return;}
  await connectWithCandidate(candidate);
}
function disconnectWallet(message="Wallet disconnected."){
  walletLifecycleDetach();
  reduceWallet({type:"DISCONNECT"});
  walletSession={provider:null,account:null,chainId:null,kind:null,discovery:null};
  resetWalletFlow();
  closeWalletChooser();
  status(message);
}
async function restoreWalletConnection(){
  const discovery=await loadDiscovery();
  for(const candidate of [discovery.ynx,discovery.metamask].filter(Boolean)){
    try{
      const restored=await restoreStandardWallet(candidate);
      if(!restored)continue;
      reduceWallet({type:"RESTORE",provider:restored.provider,providerKind:restored.kind,account:restored.account,chainId:restored.chainId});
      walletSession={provider:restored.provider,account:restored.account,chainId:restored.chainId,kind:restored.kind,discovery:candidate};
      setConnectedVisibility(true);setWalletButtons(true);walletSummary.textContent=walletSummaryMessage();setWalletStatus(`${labelFor(restored.kind)} connection restored on 0x1917.`);attachConnectedLifecycle(restored.provider);return;
    }catch(error){setWalletStatus(error.message||"Wallet restore failed",true)}
  }
}
function attachConnectedLifecycle(provider){
  const {detach}=attachWalletLifecycle(provider,{
    onAccountsChanged:(accounts)=>{reduceWallet({type:"ACCOUNTS_CHANGED",accounts});if(!accounts.length){disconnectWallet("All approved accounts were removed.");return;}walletSession.account=accounts[0];walletSummary.textContent=walletSummaryMessage();setWalletStatus(`accountsChanged: ${accounts.length} account(s) approved`);},
    onChainChanged:(chainId)=>{reduceWallet({type:"CHAIN_CHANGED",chainId});walletSession.chainId=chainId;walletSummary.textContent=walletSummaryMessage();setWalletStatus(chainId==="0x1917"?`chainChanged to ${chainId}`:`Wrong chain ${chainId}; testnet requires 0x1917.`,chainId!=="0x1917");},
    onDisconnect:()=>disconnectWallet("Wallet disconnected by provider."),
    onError:(error)=>status(error.message||"Wallet event processing error",true),
  });
  walletLifecycleDetach();walletLifecycleDetach=detach;
}
async function switchWalletAccount(){
  if(!walletSession.provider)return;
  try{
    const changed=await requestAccountSwitch(walletSession.provider);
    const chainId=changed.chainId==="0x1917"?changed.chainId:await ensureYnxTestnet(walletSession.provider);
    reduceWallet({type:"ACCOUNTS_CHANGED",accounts:[changed.account]});reduceWallet({type:"CHAIN_CHANGED",chainId});
    walletSession.account=changed.account;walletSession.chainId=chainId;walletSummary.textContent=walletSummaryMessage();renderConnectionDetails();setWalletStatus(`Account switched in ${labelFor(walletSession.kind)}.`);
  }catch(error){setWalletStatus(error.message||"Account switch failed",true)}
}
async function revokeWallet(){
  if(walletSession.provider){try{await request(walletSession.provider,"wallet_revokePermissions",[{eth_accounts:{}}])}catch(error){if(error.code!=="UNSUPPORTED_METHOD"&&error.code!=="UNAUTHORIZED"){setWalletStatus(error.message||"Permission revoke failed",true);return}}}
  disconnectWallet("Wallet permissions revoked locally.");
}

walletChoices.addEventListener("click",onWalletConnectClick);
walletChooser.addEventListener("click",(event)=>{if(event.target===walletChooser)closeWalletChooser("Wallet panel closed.")});
$("#wallet-chooser-close").addEventListener("click",()=>{
  closeWalletChooser("Wallet panel closed.");
});
walletConnect.addEventListener("click",openWalletChooser);
walletDisconnect.addEventListener("click",()=>disconnectWallet("Wallet disconnected by user."));
walletRevoke.addEventListener("click",revokeWallet);
$("#wallet-detail-disconnect").addEventListener("click",()=>disconnectWallet("Wallet disconnected by user."));
$("#wallet-switch-account").addEventListener("click",switchWalletAccount);
walletPersonalSign.addEventListener("click",async()=>{
  if(!walletSession.provider)return;
  try{
    const result=await requestPersonalSign(walletSession.provider,walletSession.account,"Creator Studio wallet approval");
    walletProof.textContent=`personal_sign result: ${result}`;
    status("personal_sign approved and callback confirmed.");
  }catch(error){
    setWalletStatus(error.message||"personal_sign failed",error.code==="USER_REJECTED");
    status(error.message||"personal_sign failed",error.code==="USER_REJECTED");
  }
});
walletTypedData.addEventListener("click",async()=>{
  if(!walletSession.provider)return;
  try{
    const result=await requestTypedDataSign(walletSession.provider,walletSession.account,"Creator Studio EIP-712 proof");
    walletProof.textContent=`eth_signTypedData_v4 result: ${result}`;
    status("EIP-712 approve/reject flow completed.");
  }catch(error){
    setWalletStatus(error.message||"eth_signTypedData_v4 failed",error.code==="USER_REJECTED");
    status(error.message||"eth_signTypedData_v4 failed",error.code==="USER_REJECTED");
  }
});
walletSendTx.addEventListener("click",async()=>{
  if(!walletSession.provider)return;
  try{
    const to=walletSession.account;
    const result=await sendRuntimeProofTransaction(walletSession.provider,walletSession.account,to);
    walletProof.textContent=`eth_sendTransaction result: ${result}`;
    status("Testnet tx request submitted. Approve/reject is user-owned.");
  }catch(error){
    setWalletStatus(error.message||"eth_sendTransaction failed",error.code==="USER_REJECTED");
    status(error.message||"eth_sendTransaction failed",error.code==="USER_REJECTED");
  }
});
async function changeSiteAccount(signIn){
 if(siteAccountBusy)return;siteAccountBusy=true;
 $("#browser-signin").disabled=true;$("#browser-disconnect").disabled=true;productConnect.disabled=true;
 try{const retired=await signOutCreatorAccount();if(!retired||!["disconnected","expired"].includes(retired.status)||retired.revocationPending||creatorSignOutPending)throw Error("Confirm Creator sign out before changing your YNX account.");
  browserIdentity.invalidate();if(signIn)browserIdentity.signIn("overview");else{await browserIdentity.logout();status("Your YNX account is signed out on this site.");}
 }catch(error){status(error.message,true);}finally{siteAccountBusy=false;$("#browser-signin").disabled=false;$("#browser-disconnect").disabled=false;productConnect.disabled=siteAccountBusy||creatorSignOutPending;}
}
$("#browser-disconnect").onclick=()=>changeSiteAccount(false);
$("#browser-signin").onclick=()=>changeSiteAccount(true);
const productStatus=$("#product-status"),productConnect=$("#product-signin"),productOpen=$("#product-open"),productDisconnect=$("#product-disconnect");
let creatorSignOutPending=false;
function clearCreatorSession(){
  creatorSessionRevision++;
  for(const request of creatorRequestFlights)request.abort(new Error("Creator account changed. Sign in and retry."));
  studioReadRevision++;channelReadRevision++;selectedChannelId=null;channelAutofill.clear();
  const channelChoice=document.getElementById("channel-select");if(channelChoice){channelChoice.replaceChildren();channelChoice.hidden=true;}
  creatorAccount=null;creatorPrivateSession=null;browserIdentity.invalidate();payoutFlight=null;
  snapshot=null;
  currentAI=null;aiSelectionRevision++;aiCreateRevision++;
  renderContent();renderTeam();renderRights();renderAudit();renderSavedAI();
  $("#ai-summary").textContent="";$("#ai-check-saved").disabled=true;
  for(const id of ["views","watch","subs","revenue"])$("#"+id).textContent="—";
  $("#channel-result").textContent="No channel loaded.";
  $("#ai-provider").textContent="Sign in to check AI availability.";
  $("#ai-result").textContent="No AI request prepared.";
  for(const id of ["#ai-run","#ai-cancel","#ai-accept","#ai-reject","#ai-delete"])$(id).disabled=true;
  document.querySelectorAll(".panel form").forEach(form=>form.reset());
  productOpen.hidden=true;
  productOpen.removeAttribute("href");
}
function renderProductState(state){
  clearTimeout(creatorExpiryTimer);
  if(state.revocationPending)creatorSignOutPending=true;
  if(["disconnected","expired"].includes(state.status))creatorSignOutPending=false;
  productConnect.disabled=siteAccountBusy||creatorSignOutPending;
  const connected=state.status==="connected";
  const account=connected?state.session.account:null;
  if(!connected||account!==creatorAccount)clearCreatorSession();
  creatorAccount=account;creatorPrivateSession=connected?state.session:null;
  productStatus.textContent=connected?`Signed in · ${state.session.account}`:state.status==="disconnected"?"Sign in to manage your channel.":state.message;
  productDisconnect.hidden=!connected&&!creatorSignOutPending&&!['retry-required','network-unavailable'].includes(state.status);
  productDisconnect.textContent=creatorSignOutPending?"Retry sign out":"Sign out";
  productConnect.textContent=connected?"Switch Creator account":"Sign in with YNX Wallet";
  if(connected)productOpen.hidden=true;
  if(connected&&Number.isFinite(Date.parse(state.session.expiresAt)))creatorExpiryTimer=setTimeout(()=>renderProductState({status:'expired',message:'Your Creator sign-in expired. Sign in again to continue.'}),Math.max(0,Date.parse(state.session.expiresAt)-Date.now()));
}
let creatorSignInIntent = 0;
let creatorSignInAbort, creatorTransportCancel, creatorPairConnection;
let nativePreparation = false, nativeExpiryTimer, nativeReturn, nativeRestoreFlight;
const productChooser = $("#product-wallet-chooser");
function clearProductPair() {
 $("#product-pair-panel").hidden = true;
 $("#product-pair-open").hidden = true;
 $("#product-pair-open").removeAttribute("href");
}
function clearNativeStep() {
 nativeReturn = null;
 clearTimeout(nativeExpiryTimer);
 $("#product-native-open").hidden = true;
 $("#product-native-open").removeAttribute('href');
 $("#product-native-open").onclick = null;
}
function cancelCreatorSignIn() {
 clearNativeStep();
 creatorSignInIntent++;
 creatorSignInAbort?.abort();
 const release = creatorTransportCancel; creatorTransportCancel = null;
 if (release) void Promise.resolve().then(release).catch(() => {});
 clearProductPair(); productChooser.close();
 $("#product-signin").disabled = creatorSignOutPending;
}
$("#product-wallet-cancel").onclick = cancelCreatorSignIn;
productChooser.addEventListener("cancel", cancelCreatorSignIn);
$("#product-wallet-back").onclick = () => {cancelCreatorSignIn(); return openCreatorSignIn();};
function productWalletFailure(error) {
 const code = String(error?.code ?? '');
 if (code === '4001' || code === 'USER_REJECTED') return 'You rejected the request. Choose another wallet or retry.';
 if (code.includes('RELAY') || code.includes('INITIALIZATION')) return 'The Wallet connection network is unavailable. Choose another wallet or try again later.';
 if (code.includes('DRAINING')) return 'The previous connection is still closing. Choose another wallet or try again shortly.';
 if (code.includes('TIMEOUT') || code.includes('EXPIRED')) return 'This request expired. Choose another wallet to start a fresh request.';
 if (code === 'HOSTED_POPUP_BLOCKED') return 'Allow the Wallet popup for this site, then choose Web Wallet again.';
 if (code === 'HOSTED_POPUP_CLOSED') return 'The Wallet window was closed. Choose Web Wallet again to continue.';
 return 'Sign-in could not complete. Choose another wallet or try again. No new account access has been confirmed.';
}
async function openCreatorSignIn() {
 if(siteAccountBusy)return;
 if(productChooser.open)return;
 creatorSignInAbort?.abort();
 if (creatorSignOutPending) return;
 if (creatorAccount) {await signOutCreatorAccount(); if (creatorSignOutPending) return;}
 creatorSessionRevision++;
 const intent = ++creatorSignInIntent, choices = $("#product-wallet-choices");
 choices.replaceChildren(); choices.hidden = false; clearProductPair(); clearNativeStep();
 $("#product-wallet-back").hidden = true;
 $("#product-wallet-status").textContent = 'Finding YNX Wallet…';
 if (!productChooser.open) productChooser.showModal();
 const current = () => intent === creatorSignInIntent && !creatorSignOutPending;
 const choose = (label, action) => {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.onclick = action; choices.append(button); return button;
 };
 const select = async (label, connect, release) => {
  if (!current()) return;
  if (nativePreparation) {$("#product-wallet-status").textContent = 'The previous request is still closing. Please wait, then choose your Wallet again.'; return;}
  choices.hidden = true; $("#product-wallet-back").hidden = false; clearProductPair();
  $("#product-wallet-status").textContent = label + ': connect your Wallet, then review the Creator Studio request.';
  const abort = new AbortController(); creatorSignInAbort = abort; creatorTransportCancel = release;
  let provider, invalidate;
  try {
   // Called synchronously by the actual click: Hosted opens before any fetch.
   provider = await connectMediaWallet({connect, release, signal: abort.signal, isCurrent: current});
   if (!current()) {release?.(); return;}
   clearProductPair();
   $("#product-wallet-status").textContent = 'Review the Creator Studio request in ' + label + '. You may approve or reject it.';
   invalidate = () => {if (intent === creatorSignInIntent) cancelCreatorSignIn();};
   for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.on?.(event, invalidate);
   const state = await dispatchPreparedProductRequest(provider, async()=>{const request=await prepareProductSignIn();rememberReturn(request);return request;}, finishProductReturn, current,
    {signal: abort.signal, revoke: disconnectProductSession, onRevocation: renderProductState});
   if (intent !== creatorSignInIntent) return;
   renderProductState(state);
   announceSession();
   if (state.status === 'connected') {productChooser.close(); await refresh(); await providerStatus();}
   else $("#product-wallet-status").textContent = state.message || 'Approval was not completed. Choose another wallet or retry.';
  } catch (error) {
   if (intent === creatorSignInIntent && error.productSessionState?.revocationPending) {cancelCreatorSignIn(); renderProductState(error.productSessionState);}
   else if (intent === creatorSignInIntent) {clearProductPair(); $("#product-wallet-status").textContent = productWalletFailure(error);}
  } finally {
   if (creatorSignInAbort === abort) creatorSignInAbort = null;
   if (provider && invalidate) for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.removeListener?.(event, invalidate);
  }
 };
 try {
  const candidates = (await discoverWalletProviders(globalThis,1500)).candidates.filter(item => item.kind === "ynx-wallet");
  if (!current()) return;
  $("#product-wallet-status").textContent = 'Choose how to open YNX Wallet. Each sign-in still requires your approval.';
  for (const candidate of candidates) choose(candidate.label || candidate.info?.name || candidate.name || 'YNX Wallet extension',
   () => select('YNX Wallet extension', () => candidate.provider));
  if (!candidates.length) {const missing = choose('YNX Wallet extension — not detected', () => {}); missing.disabled = true;}
  choose('YNX Web Wallet', () => {
   if (!current()) return;
   let adapter;
   return select('YNX Web Wallet', () => {adapter = createHostedWalletAdapter({window}); return adapter.connect().then(() => adapter);}, () => adapter?.suspend());
  });
  choose('YNX Wallet on my phone', () => {
   if (!current()) return;
   let pair;
   return select('YNX mobile Wallet', () => {
    creatorPairConnection ??= new WalletConnectDAppConnection({origin: location.origin, methods: ['ynx_requestProductSessionV2']});
    pair = creatorPairConnection;
    return pair.connect({restore: true, onURI: uri => {
    if (!current()) return;
    $("#product-pair-panel").hidden = false;
    $("#product-pair-open").href = 'ynxwallet://wc?uri=' + encodeURIComponent(uri);
    $("#product-pair-open").hidden = false;
    $("#product-wallet-status").textContent = 'Scan this code in YNX Wallet, or open the app on this phone. Review the connection there; the Creator Studio sign-in approval follows.';
    void QRCode.toCanvas($("#product-pair-qr"), uri, {width: 240, margin: 2, errorCorrectionLevel: 'M'}).catch(() => {
     if (current()) $("#product-wallet-status").textContent = 'The code could not be displayed. Use Open YNX Wallet or choose another wallet.';
    });
   }});}, () => pair?.cancel());
  });
  choose('YNX Wallet installed app', () => {if (!current()) return; return prepareNativeCreatorSignIn(intent);});
 } catch (error) {if (intent === creatorSignInIntent) $("#product-wallet-status").textContent = productWalletFailure(error);}
}

productConnect.addEventListener('click',openCreatorSignIn);
async function prepareNativeCreatorSignIn(intent) {
 if (creatorSignOutPending || intent !== creatorSignInIntent) return;
 if (nativePreparation) {$("#product-wallet-status").textContent = 'The previous request is still closing. Please wait and try again.'; return;}
 nativePreparation = true;
 $("#product-wallet-choices").hidden = true; $("#product-wallet-back").hidden = false;
 clearNativeStep();
 $("#product-wallet-status").textContent = 'Preparing a secure Creator Studio request. Next, select Open YNX Wallet to open the installed app.';
 const current = () => intent === creatorSignInIntent && !creatorSignOutPending;
 const revokeNative = async () => {
  renderProductState({status:'retry-required',revocationPending:true,message:'Cancelling sign-in securely. Confirmation is pending.'});
  try {const state = await disconnectProductSession();renderProductState({...state,revocationPending:!['disconnected','expired'].includes(state.status)});}
  catch {renderProductState({status:'retry-required',revocationPending:true,message:'Sign-out could not be confirmed. Retry sign out when connected.'});}
 };
 try {
  const request = await prepareProductSignIn();
  rememberReturn(request);announceSession();
  if (!current()) {await revokeNative(); return;}
  creatorTransportCancel = revokeNative;
  if (!Number.isFinite(Date.parse(request.expiresAt)) || Date.parse(request.expiresAt) <= Date.now() || !request.url.startsWith('ynxwallet://')) throw Object.assign(new Error('Native request unavailable'),{code:'PRODUCT_REQUEST_EXPIRED'});
  const launch = $("#product-native-open"); let launched = false;
  const returning = {intent, state: request.state, expiresAt: request.expiresAt, launched:false, revision:creatorSessionRevision};
  nativeReturn = returning;
  launch.href = request.url; launch.hidden = false; launch.removeAttribute('aria-disabled');
  $("#product-wallet-status").textContent = 'Your request is ready. Select Open YNX Wallet below, approve Creator Studio in the app, and return here. If it does not open, install YNX Wallet or choose another way.';
  launch.onclick = event => {
   if (launched) {event.preventDefault(); return;}
   if (!current() || launch.hidden || launch.href !== request.url || Date.parse(request.expiresAt) <= Date.now()) {
    event.preventDefault(); clearNativeStep();
    if (current()) $("#product-wallet-status").textContent = 'This open attempt is no longer available. Choose another wallet to start a fresh request.';
    return;
   }
   // The actual anchor click owns browser activation; preparation never navigates.
   launched = true; returning.launched = true; launch.setAttribute('aria-disabled','true');
   $("#product-wallet-status").textContent = 'Opening YNX Wallet was requested. Approve the request in the app and return here. If the browser blocked it or Wallet is not installed, choose another wallet or use the download link.';
  };
  launch.focus();
  nativeExpiryTimer = setTimeout(() => {if (current()) {clearNativeStep();$("#product-wallet-status").textContent = 'This sign-in request expired. Choose another wallet to start again.';}},Math.max(0,Date.parse(request.expiresAt)-Date.now()));
 } catch(error) {
  if (current() && error.productSessionState?.revocationPending) renderProductState(error.productSessionState);
  else if (current()) $("#product-wallet-status").textContent = productWalletFailure(error);
 } finally {nativePreparation = false;}
}

async function resumeNativeSignIn() {
 const returning = nativeReturn;
 const current = () => returning && nativeReturn === returning && returning.launched && returning.intent === creatorSignInIntent && returning.revision === creatorSessionRevision && !creatorSignOutPending && Date.parse(returning.expiresAt) > Date.now();
 if (!current()) return;
 if (nativeRestoreFlight) return nativeRestoreFlight;
 const operation = (async () => {
  try {
   const state = await restoreNativeProductReturn(returning.state);
   if (!current()) return;
   if (state?.status === 'connected') {
    if (!returning.state || state.session?.state !== returning.state) {$("#product-wallet-status").textContent = 'This return belongs to a different sign-in. Choose another wallet to start again.'; return;}
    clearNativeStep(); creatorTransportCancel = null;
    productChooser.close(); renderProductState(state);
    announceSession();
    if (await refresh()) await providerStatus();
   } else if (state?.revocationPending) {clearNativeStep(); renderProductState(state);}
   else $("#product-wallet-status").textContent = 'Approval has not been confirmed yet. Finish in YNX Wallet and return here, or choose another wallet.';
  } catch {if (current()) $("#product-wallet-status").textContent = 'Your sign-in could not be checked. Return here when connected, or choose another wallet.';}
 })();
 nativeRestoreFlight = operation;
 try {return await operation;} finally {if (nativeRestoreFlight === operation) nativeRestoreFlight = null;}
}
window.addEventListener?.('focus', () => void resumeNativeSignIn());
document.addEventListener?.('visibilitychange', () => {if (document.visibilityState === 'visible') void resumeNativeSignIn();});

productDisconnect.addEventListener("click",signOutCreatorAccount);
async function signOutCreatorAccount(){
  cancelCreatorSignIn();
  creatorSignOutPending=true;
  productDisconnect.disabled=true;
  productConnect.disabled=true;
  clearCreatorSession();
  announceSession();
  productStatus.textContent="Signing out…";
  const revision=creatorSessionRevision;
  try{const state=await disconnectProductSession();if(revision!==creatorSessionRevision)return;creatorSignOutPending=!["disconnected","expired"].includes(state.status);renderProductState(state);announceSession();if(state.status==="disconnected")status("Creator account disconnected.");return state;}
  catch(error){if(revision===creatorSessionRevision){productStatus.textContent=error.message;productDisconnect.hidden=false;productDisconnect.textContent="Retry sign out";}}
  finally{productDisconnect.disabled=false;productConnect.disabled=siteAccountBusy||creatorSignOutPending;}
}
async function restoreCreator(){
  browserIdentity.invalidate();
  if(creatorSignOutPending)return;
  if(!atRegisteredOrigin()){productStatus.textContent="Open creator.ynxweb4.com to sign in and manage your channel.";return;}
  const revision=creatorSessionRevision;
  try{const state=await restoreProductSession();if(revision!==creatorSessionRevision)return;renderProductState(state);if(state.status==="connected"){if(await refresh())await providerStatus();}else productStatus.textContent=state.message||"Sign in to manage your channel. Your Wallet will ask for approval.";}
  catch(error){if(revision===creatorSessionRevision)productStatus.textContent=error.message;}
}
void restoreCreator();
if(typeof subscribeProductSession==='function')subscribeProductSession(()=>{if(nativeReturn?.launched){void resumeNativeSignIn();return;}cancelCreatorSignIn();renderProductState({status:'retry-required',message:'Your Creator account changed in another tab. Checking your sign-in…'});void restoreCreator();});
window.addEventListener?.('focus',()=>{if(!nativeReturn&&!productChooser.open)void restoreCreator();});
resetWalletFlow();
void restoreWalletConnection();
document.querySelectorAll("nav button").forEach(button=>button.onclick=()=>{document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x===button));document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===button.dataset.panel));$("#heading").textContent=button.textContent});

async function refresh(){
  const revision=creatorSessionRevision,read=++studioReadRevision;
  if(!currentCreatorSession(revision))return false;
  try{
    const nextSnapshot=await api("/v1/studio");
    if(!currentCreatorSession(revision)||read!==studioReadRevision)return false;
    snapshot=nextSnapshot;
    await restoreChannelView(nextSnapshot,revision);
    if(!currentCreatorSession(revision)||read!==studioReadRevision)return false;
    const a=snapshot?.analytics||{};
    $("#views").textContent=a.views??"—";$("#watch").textContent=a.watch_seconds==null?"—":`${a.watch_seconds}s`;$("#subs").textContent=a.subscribers??"—";$("#revenue").textContent=a.revenue_ynxt==null?"—":`${a.revenue_ynxt} YNXT`;
    renderContent();renderTeam();renderRights();renderAudit();renderSavedAI();status("Studio state loaded from persistent records.");return true;
  }catch(error){if(currentCreatorSession(revision)&&read===studioReadRevision)status(error.message||t("unavailable"),true);return false}
}
const channelForms=["upload-form","team-invite-form","team-role-form","team-revoke-form"];
async function loadChannelView(channelID,revision){
 const read=++channelReadRevision;
 const view=await api("/v1/channels/"+encodeURIComponent(channelID));
 if(!currentCreatorSession(revision)||read!==channelReadRevision)return;
 const channel=get(view,"channel","Channel");
 if(!channel||get(channel,"id","ID")!==channelID)throw new Error("The channel could not be verified. Refresh Studio to try again.");
 selectedChannelId=channelID;
 $("#channel-result").textContent=String(get(channel,"name","Name")||"Channel")+" · "+channelID;
 for(const id of channelForms){const field=document.getElementById(id)?.elements.channel_id;if(field&&(!field.value||field.value===channelAutofill.get(id))){field.value=channelID;channelAutofill.set(id,channelID);}}
}
async function restoreChannelView(studio,revision){
 channelReadRevision++;
 // The actual Studio contract supplies authorized team channel IDs, not channels.
 // Membership is not ownership; all mutations still pass their original API guards.
 const ids=[...new Set((studio?.team||[]).map(team=>get(team,"channel_id","ChannelID")).filter(id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(id)))].sort();
 let choice=document.getElementById("channel-select");
 if(!ids.length){if(choice){choice.replaceChildren();choice.hidden=true;}$("#channel-result").textContent="No channel loaded.";return;}
 if(!choice){choice=document.createElement("select");choice.id="channel-select";choice.setAttribute("aria-label","Choose an authorized channel");$("#channel-result").before(choice);}
 choice.hidden=false;choice.replaceChildren();
 for(const id of ids){const option=document.createElement("option");option.value=id;option.textContent=id;choice.append(option);}
 const typed=channelForms.map(id=>document.getElementById(id)?.elements.channel_id?.value).find(id=>ids.includes(id));
 const selected=ids.includes(selectedChannelId)?selectedChannelId:typed||ids[0];choice.value=selected;
 choice.onchange=async()=>{if(!currentCreatorSession(revision)||!ids.includes(choice.value))return;try{await loadChannelView(choice.value,revision);}catch{if(currentCreatorSession(revision))status("The channel could not be loaded. Refresh Studio to try again.",true);}};
 await loadChannelView(selected,revision);
}

function rightsFor(videoID){return(snapshot?.rights||[]).find(item=>get(item,"video_id","VideoID")===videoID)}
function openRights(video){const form=$("#rights-form");form.video_id.value=video.id;form.source_sha256.value=video.sha256||"";document.querySelector('nav button[data-panel="rights"]').click();status("Rights form prefilled with the persisted media source hash.")}
function renderContent(){const box=$("#videos"),videos=snapshot?.videos||[];box.replaceChildren();if(!videos.length){box.innerHTML='<p class="meta">No videos yet. Create a channel, then upload your first video.</p>';return}for(const video of videos){const row=document.createElement("div"),rights=rightsFor(video.id),rightsState=rights?get(rights,"state","State"):"missing",source=video.sha256?`${video.sha256.slice(0,16)}…`:"unavailable",workflow=get(video,"workflow_state","WorkflowState")||"draft",versions=get(video,"versions","Versions")||[];row.className="row lifecycle-row";const takedown=video.takedown?` · takedown ${video.takedown.state}`:"",scheduled=get(video,"scheduled_at","ScheduledAt"),history=versions.slice(-5).reverse().map(version=>`<li><b>v${esc(get(version,"sequence","Sequence"))}</b> ${esc(get(version,"kind","Kind"))} · ${esc(get(version,"recorded_at","RecordedAt"))}</li>`).join("");row.innerHTML=`<div><b>${esc(video.title)}</b><small>${esc(video.id)} · source ${esc(source)}</small><small>Workflow ${esc(workflow)} · version ${esc(get(video,"version","Version")||0)}${scheduled?` · scheduled ${esc(scheduled)}`:""}</small></div><span class="state">${esc(video.status)}${esc(takedown)}</span><span>${esc(video.visibility)} · rights ${esc(rightsState)}</span><div class="row-actions"><button data-action="edit">Edit</button><button data-action="rights">Rights</button>${["draft","rejected","unpublished"].includes(workflow)&&video.status==="ready"?'<button data-action="submit">Submit review</button>':""}${workflow==="in_review"?'<button data-action="review">Review</button>':""}${workflow==="approved"?'<button data-action="visibility">Publish now</button><button data-action="schedule">Schedule</button>':""}${workflow==="scheduled"?'<button data-action="due">Publish due</button>':""}${workflow==="published"?'<button data-action="unpublish" class="danger">Unpublish</button>':""}${["failed","scanning","transcoding"].includes(video.status)?'<button data-action="retry">Retry processing</button>':""}</div><details><summary>Version history (${versions.length})</summary><ol>${history||"<li>No version evidence.</li>"}</ol></details>`;row.querySelector('[data-action="edit"]').onclick=()=>editVideo(video);row.querySelector('[data-action="rights"]').onclick=()=>openRights(video);row.querySelector('[data-action="submit"]')?.addEventListener("click",()=>submitReview(video));row.querySelector('[data-action="review"]')?.addEventListener("click",()=>reviewPublication(video));row.querySelector('[data-action="visibility"]')?.addEventListener("click",()=>publishVideo(video));row.querySelector('[data-action="schedule"]')?.addEventListener("click",()=>schedulePublication(video));row.querySelector('[data-action="due"]')?.addEventListener("click",()=>publishDue(video));row.querySelector('[data-action="unpublish"]')?.addEventListener("click",()=>unpublish(video));row.querySelector('[data-action="retry"]')?.addEventListener("click",async event=>{const button=event.currentTarget;button.disabled=true;try{await retryVideo(video)}finally{button.disabled=false}});box.append(row)}}
async function editVideo(video){const title=prompt("Title",video.title);if(!title)return;const description=prompt("Description",video.description||"");if(description===null)return;try{await api(`/v1/videos/${video.id}/metadata`,json({title,description}));await refresh()}catch(error){status(error.message,true)}}
async function publishVideo(video){const visibility=prompt("Visibility: private, unlisted, or public",video.visibility);if(!visibility)return;try{await api(`/v1/videos/${video.id}/publish`,json({visibility}));status("Human-reviewed visibility persisted.");await refresh()}catch(error){status(error.message,true)}}
async function submitReview(video){try{await api(`/v1/videos/${video.id}/submit-review`,{method:"POST"});status("Publication review submitted. A different moderator must decide.");await refresh()}catch(error){status(error.message,true)}}
async function reviewPublication(video){const approved=confirm("Approve this publication review? Choose Cancel to reject."),reason=prompt(approved?"Approval note (optional)":"Rejection reason (required)","");if(reason===null||(!approved&&!reason.trim()))return;try{await api(`/v1/videos/${video.id}/review-publication`,json({approved,reason}));status(approved?"Independent publication review approved.":"Publication review rejected with evidence.");await refresh()}catch(error){status(error.message,true)}}
async function schedulePublication(video){const visibility=prompt("Scheduled visibility: public or unlisted","public"),scheduled=prompt("UTC publication time (ISO 8601)",new Date(Date.now()+3600000).toISOString());if(!visibility||!scheduled)return;const parsed=new Date(scheduled);if(Number.isNaN(parsed.valueOf())){status("Enter a valid ISO 8601 publication time.",true);return}try{await api(`/v1/videos/${video.id}/schedule`,json({visibility,scheduled_at:parsed.toISOString()}));status("Publication schedule persisted with version evidence.");await refresh()}catch(error){status(error.message,true)}}
async function publishDue(video){try{await api(`/v1/videos/${video.id}/publish-due`,{method:"POST"});status("Due publication completed after rights and role checks.");await refresh()}catch(error){status(error.message,true)}}
async function unpublish(video){if(!confirm("Unpublish this video and return it to private state?"))return;try{await api(`/v1/videos/${video.id}/unpublish`,{method:"POST"});status("Video unpublished; version history remains intact.");await refresh()}catch(error){status(error.message,true)}}
async function retryVideo(video){try{status("Retrying malware scan and media processing…");await api(`/v1/videos/${video.id}/retry-processing`,{method:"POST"});await refresh()}catch(error){status(error.message,true)}}
function renderTeam(){const items=[];for(const team of snapshot?.team||[]){const channelID=get(team,"channel_id","ChannelID"),version=get(team,"auth_version","AuthVersion");items.push({kind:"channel",channelID,version});for(const member of get(team,"members","Members")||[])items.push({kind:"member",channelID,member});for(const invite of get(team,"invites","Invites")||[])items.push({kind:"invite",channelID,invite})}rows("#team-list",items,item=>{if(item.kind==="channel")return`<div class="row"><div><b>Channel ${esc(item.channelID)}</b><small>Authorization version ${esc(item.version)}</small></div><span class="state">team boundary</span></div>`;if(item.kind==="member"){const member=item.member;return`<div class="row"><div><b>${esc(get(member,"account","Account"))}</b><small>${esc(item.channelID)}</small></div><span>${esc(get(member,"role","Role"))}</span><span class="state">${esc(get(member,"state","State"))}</span></div>`}const invite=item.invite;return`<div class="row"><div><b>${esc(get(invite,"account","Account"))}</b><small>invite ${esc(get(invite,"id","ID"))}</small></div><span>${esc(get(invite,"role","Role"))}</span><span class="state">${esc(get(invite,"state","State"))}</span><span>${esc(get(invite,"expires_at","ExpiresAt"))}</span></div>`},"No channel team records available for this Wallet session.")}
function renderRights(){rows("#rights-list",snapshot?.rights||[],rights=>{const territories=get(rights,"territories","Territories")||[],evidence=String(get(rights,"evidence_sha256","EvidenceSHA256")||"");return`<div class="row"><div><b>${esc(get(rights,"video_id","VideoID"))}</b><small>evidence ${esc(evidence?`${evidence.slice(0,16)}…`:"unavailable")}</small></div><span>${esc(get(rights,"basis","Basis"))} · ${esc(territories.join(", "))}</span><span class="state">${esc(get(rights,"state","State"))}</span></div>`},"No rights declarations. Public or unlisted publication will fail closed.")}
function renderAudit(){rows("#revenue-list",snapshot?.revenue||[],r=>`<div class="row"><b>${esc(get(r,"id","ID"))}</b><span>${get(r,"amount_ynxt","AmountYNXT")} YNXT</span><span>${esc(get(r,"pay_receipt_id","PayReceiptID"))}</span></div>`,"No verified revenue records.");rows("#payout-list",snapshot?.payout_intents||[],p=>`<div class="row"><b>${esc(get(p,"id","ID"))}</b><span>${get(p,"amount_ynxt","AmountYNXT")} YNXT</span><span class="state">${esc(payoutStateLabel(get(p,"state","State")))}</span></div>`,"No payout intents.");rows("#report-list",snapshot?.reports||[],r=>`<div class="row"><b>${esc(get(r,"id","ID"))}</b><span>${esc(get(r,"reason","Reason"))}</span><span class="state">${esc(get(r,"state","State"))}</span></div>`,"No reports on owned videos.");rows("#appeal-list",snapshot?.appeals||[],a=>`<div class="row"><b>${esc(get(a,"id","ID"))}</b><span>${esc(get(a,"reason","Reason"))}</span><span class="state">${esc(get(a,"state","State"))}</span></div>`,"No appeals.");rows("#dispute-list",snapshot?.disputes||[],d=>`<div class="row"><b>${esc(get(d,"id","ID"))}</b><span>${esc(get(d,"reason","Reason"))}</span><span class="state">${esc(get(d,"state","State"))}</span></div>`,"No revenue disputes.")}

$("#refresh").onclick=refresh;$("#channel-form").onsubmit=async event=>{event.preventDefault();try{const channel=await api("/v1/channels",json({handle:event.target.handle.value,name:event.target.name.value}));const channelID=get(channel,"id","ID");selectedChannelId=channelID;channelReadRevision++;$("#channel-result").textContent=`${get(channel,"name","Name")} · ${channelID}`;for(const id of ["upload-form","team-invite-form","team-role-form","team-revoke-form"]){document.getElementById(id).elements.channel_id.value=channelID;channelAutofill.set(id,channelID);}await refresh();status("Channel created. You can upload a video or invite a reviewer.")}catch(error){status(error.message,true)}};
$("#team-invite-form").onsubmit=async event=>{event.preventDefault();const form=event.target;try{const expires=form.expires_at.value?new Date(form.expires_at.value).toISOString():undefined;await api(`/v1/channels/${encodeURIComponent(form.channel_id.value)}/team/invites`,json({account:form.account.value,role:form.role.value,expires_at:expires}));status("Bounded team invite persisted. The named Wallet account must accept it before access exists.");form.reset();await refresh()}catch(error){status(error.message,true)}};
$("#team-accept-form").onsubmit=async event=>{event.preventDefault();try{await api(`/v1/team/invites/${encodeURIComponent(event.target.invite_id.value)}/accept`,{method:"POST"});status("Invitation accepted. Your channel access is ready.");event.target.reset();await refresh()}catch(error){status(error.message,true)}};
$("#team-role-form").onsubmit=async event=>{event.preventDefault();const form=event.target;try{await api(`/v1/channels/${encodeURIComponent(form.channel_id.value)}/team/${encodeURIComponent(form.account.value)}/role`,json({role:form.role.value}));status("Role changed and channel authorization version advanced.");await refresh()}catch(error){status(error.message,true)}};
$("#team-revoke-form").onsubmit=async event=>{event.preventDefault();const form=event.target,account=form.account.value,channelID=form.channel_id.value;if(!confirm(`Revoke ${account} from ${channelID}? Their next request will fail closed.`))return;try{await api(`/v1/channels/${encodeURIComponent(channelID)}/team/${encodeURIComponent(account)}`,{method:"DELETE"});status("Team access revoked and session authority invalidated.");form.reset();await refresh()}catch(error){status(error.message,true)}};
$("#rights-form").onsubmit=async event=>{event.preventDefault();const form=event.target;try{let splits=[];if(form.splits.value.trim()){splits=JSON.parse(form.splits.value);if(!Array.isArray(splits))throw new Error("Contributor splits must be a JSON array.")}const body={basis:form.basis.value,license_reference:form.license_reference.value,territories:form.territories.value.split(",").map(value=>value.trim()).filter(Boolean),starts_at:form.starts_at.value?new Date(form.starts_at.value).toISOString():undefined,ends_at:form.ends_at.value?new Date(form.ends_at.value).toISOString():undefined,exclusive:form.exclusive.checked,contributor_splits:splits,evidence_sha256:form.evidence_sha256.value.toLowerCase(),source_sha256:form.source_sha256.value.toLowerCase()};const declaration=await api(`/v1/videos/${encodeURIComponent(form.video_id.value)}/rights`,json(body));status(`Rights declaration ${get(declaration,"id","ID")} persisted as ${get(declaration,"state","State")}. Commercial use still requires independent review.`);await refresh()}catch(error){status(error.message,true)}};
$('#upload-cancel').onclick=()=>currentUpload?.abort();
$('#upload-form').onsubmit=async event=>{
  event.preventDefault();if(currentUpload)return;
  const form=event.target,file=form.media.files[0],revision=creatorSessionRevision;
  if(!['video/mp4','video/webm'].includes(file?.type)){status('Select an MP4 or WebM file.',true);return}
  const operation=beginCreatorRequest(300000);currentUpload=operation;
  let submitted=false,submittedHash='',submittedChannel='';
  const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
  $('#upload-cancel').hidden=false;
  try{
    assertCreatorSession(revision);
    const expiry=form.rights_expires_at.value?new Date(form.rights_expires_at.value).toISOString():'',data=new FormData();
    for(const [key,value] of [['channel_id',form.channel_id.value],['media',file],['size',String(file.size)],['title',form.title.value],['description',form.description.value],['rights_basis',form.rights_basis.value],['rights_source',form.rights_source.value],['rights_license',form.rights_license.value],['rights_territories',form.rights_territories.value],['rights_expires_at',expiry],['rights_evidence_sha256',form.rights_evidence_sha256.value],['owned_content_declaration',String(form.owned.checked)]])data.set(key,value);
    status('Checking your video and rights details…');
    submittedHash=await operation.wait(sha256Hex(file));submittedChannel=data.get('channel_id');data.set('sha256',submittedHash);
    assertCreatorSession(revision);operation.signal.throwIfAborted();
    status('Uploading and processing your video. This can take a few minutes…');
    submitted=true;
    const video=await api('/v1/uploads',{method:'POST',body:data,signal:operation.signal});
    await refresh();if(!currentCreatorSession(revision))return;
    if(video.status==='ready'){openRights(video);status('Your video is ready. Complete the rights declaration, then submit it for review from Content.')}else status('Processing state: '+video.status+'. Open Content to check or retry processing.');
  }catch(error){
    if(!currentCreatorSession(revision))return;
    let recovered=null;
    if(submitted&&/^[A-Za-z0-9_-]{1,160}$/.test(error.details?.video_id||'')&&await refresh()){
      if(!currentCreatorSession(revision))return;
      recovered=(snapshot?.videos||[]).find(video=>video.sha256===submittedHash&&video.channel_id===submittedChannel&&video.id===error.details.video_id);
    }
    if(!currentCreatorSession(revision))return;
    if(recovered){document.querySelector('nav button[data-panel="content"]').click();status(['failed','scanning','transcoding'].includes(recovered.status)?'Your uploaded file is saved. Retry processing from Content; you do not need to upload it again.':'A matching upload is in Content. Check its processing state before uploading again.',recovered.status==='failed');}
    else status(operation.signal.aborted?'Upload stopped. Check Content before trying again; the service may already have received your video.':error.message,true);
  }
  finally{operation.finish();if(currentUpload===operation){currentUpload=null;$('#upload-cancel').hidden=true;if(submit)submit.disabled=false;}}
};
$("#thumbnail-form").onsubmit=async event=>{event.preventDefault();const file=event.target.thumbnail.files[0],data=new FormData();data.set("thumbnail",file);data.set("size",String(file.size));try{await api(`/v1/videos/${event.target.video_id.value}/thumbnail`,{method:"POST",body:data});status("Thumbnail stored.");await refresh()}catch(error){status(error.message,true)}};
$("#caption-form").onsubmit=async event=>{event.preventDefault();const file=event.target.captions.files[0],data=new FormData();data.set("captions",file);data.set("size",String(file.size));data.set("language",event.target.language.value);data.set("label",event.target.label.value);data.set("ai_proposed","false");try{await api(`/v1/videos/${event.target.video_id.value}/captions`,{method:"POST",body:data});status("Human-approved caption track stored.");await refresh()}catch(error){status(error.message,true)}};
$("#monetization").onsubmit=async event=>{event.preventDefault();try{const result=await api(`/v1/videos/${event.target.video_id.value}/monetization`,{method:"POST"});status(`${get(result,"state","State")}: ${get(result,"reason","Reason")}`);await refresh()}catch(error){status(error.message,true)}};
function payoutStateLabel(state){return state==="dispatching"?t("payoutDispatching"):state==="recovery_required"?t("payoutUnconfirmed"):state==="awaiting_wallet_confirmation"?t("payoutAwaitingWallet"):state}
$("#payout").onsubmit=async event=>{
 event.preventDefault();if(payoutFlight||creatorAccount===null)return;
 const revision=creatorSessionRevision,flight={};payoutFlight=flight;
 try{const intent=await api("/v1/studio/payout-intents",json({amount_ynxt:Number(event.target.amount.value)}));if(!currentCreatorSession(revision))return;status(payoutStateLabel(get(intent,"state","State")));await refresh()}
 catch(error){if(!currentCreatorSession(revision))return;status(error.message,true);try{await refresh();if(currentCreatorSession(revision)&&(snapshot?.payout_intents||[]).some(p=>["dispatching","recovery_required"].includes(get(p,"state","State"))))status(t("payoutUnconfirmed"),true)}catch{}}
 finally{if(payoutFlight===flight)payoutFlight=null}
};
$("#appeal").onsubmit=async event=>{event.preventDefault();try{await api(`/v1/reports/${event.target.report_id.value}/appeals`,json({reason:event.target.reason.value}));status("Appeal submitted for human review.");await refresh()}catch(error){status(error.message,true)}};
$("#dispute").onsubmit=async event=>{event.preventDefault();try{await api(`/v1/revenue/${event.target.record_id.value}/disputes`,json({reason:event.target.reason.value}));status("Revenue dispute persisted.");await refresh()}catch(error){status(error.message,true)}};

async function providerStatus(){const revision=creatorSessionRevision;try{const p=await api("/v1/ai/status");if(!currentCreatorSession(revision))return;$("#ai-provider").textContent=p.configured?"AI Gateway configured. Provider/model are recorded with each result.":"AI Gateway unavailable. Requests will fail honestly until configured."}catch(error){if(currentCreatorSession(revision))$("#ai-provider").textContent="AI Gateway status unavailable."}}
function currentAISelection(revision,id,selection){return currentCreatorSession(revision)&&get(currentAI,"id","ID")===id&&aiSelectionRevision===selection}
function aiStateLabel(state){return t("aiSaved_"+state)}
function renderSavedAI(){
 const select=$("#ai-saved-select"),selected=select.value;select.replaceChildren();
 const jobs=(Array.isArray(snapshot?.ai_jobs)?snapshot.ai_jobs:[]).filter(job=>get(job,"owner","Owner")===creatorAccount).sort((a,b)=>String(get(b,"created_at","CreatedAt")||"").localeCompare(String(get(a,"created_at","CreatedAt")||"")));
 for(const job of jobs){const option=document.createElement("option");option.value=get(job,"id","ID");option.textContent=String(get(job,"kind","Kind")||"AI").replaceAll("_"," ")+" · "+aiStateLabel(get(job,"state","State"));select.append(option)}
 select.value=jobs.some(j=>get(j,"id","ID")===selected)?selected:(jobs.length?get(jobs[0],"id","ID"):"");
 select.disabled=jobs.length===0;$("#ai-open-saved").disabled=jobs.length===0;
 if(!jobs.length){const option=document.createElement("option");option.textContent=t("aiNoSaved");option.value="";select.append(option);select.value="";}
}
async function openSavedAI(id){
 if(creatorAccount===null||!id||!/^[A-Za-z0-9_-]{1,160}$/.test(id))return;
 const revision=creatorSessionRevision,selection=++aiSelectionRevision;activeAIRequest?.abort();currentAI=null;
 const operation=beginCreatorRequest(15000);activeAIRequest=operation;
 for(const key of ["ai-run","ai-cancel","ai-accept","ai-reject","ai-delete","ai-check-saved"])$("#"+key).disabled=true;
 $("#ai-result").textContent=t("aiCheckingSaved");$("#ai-summary").textContent="";
 try{const job=await api("/v1/ai/jobs/"+encodeURIComponent(id),{signal:operation.signal});if(!currentCreatorSession(revision)||selection!==aiSelectionRevision)return;
  if(get(job,"id","ID")!==id||get(job,"owner","Owner")!==creatorAccount)throw new Error(t("aiWrongSavedAccount"));
  showAI(job);status(aiStateLabel(get(job,"state","State")));
 }catch(error){if(currentCreatorSession(revision)&&selection===aiSelectionRevision){$("#ai-result").textContent=t("aiSavedUnavailable");status(error.message,true)}}
 finally{operation.finish();if(activeAIRequest===operation)activeAIRequest=null}
}
$("#ai-open-saved").onclick=()=>openSavedAI($("#ai-saved-select").value);
$("#ai-check-saved").onclick=()=>openSavedAI(get(currentAI,"id","ID"));
function showAI(job){
 if(creatorAccount===null||!job)return;
 if(get(job,"owner","Owner")&&get(job,"owner","Owner")!==creatorAccount)return;
 if(get(currentAI,"id","ID")!==get(job,"id","ID")){aiSelectionRevision++;activeAIRequest?.abort();}
 currentAI=job;const state=get(job,"state","State");
 $("#ai-summary").textContent=aiStateLabel(state)+"\n"+String(get(job,"kind","Kind")||"AI")+" · "+String(get(job,"output_language","OutputLanguage")||"")+"\n"+t("aiSharedContext")+": "+String(get(job,"context_preview","ContextPreview")||"—")+"\n"+t("aiEstimatedUnits")+": "+String(get(job,"estimated_units","EstimatedUnits")??"—");
 $("#ai-result").textContent=String(get(job,"result","Result")||get(job,"partial","Partial")||t("aiNoSavedResult"));
 $("#ai-run").disabled=state!=="awaiting_permission";$("#ai-cancel").disabled=!['awaiting_permission','running'].includes(state);$("#ai-accept").disabled=state!=="review_required";$("#ai-reject").disabled=state!=="review_required";$("#ai-delete").disabled=state==="running";$("#ai-check-saved").disabled=false;
}
$("#ai-form").onsubmit=async event=>{event.preventDefault();const revision=creatorSessionRevision,creation=++aiCreateRevision;try{const job=await api("/v1/ai/jobs",json({video_id:event.target.video_id.value,kind:event.target.kind.value,context_classes:event.target.metadata.checked?["metadata"]:[],output_language:localStorage.getItem("ynx.creator.ai-locale")||localStorage.getItem("ynx.creator.locale")||"en"}));if(!currentCreatorSession(revision)||creation!==aiCreateRevision)return;showAI(job);status("Review context preview, output language and estimated units, then explicitly approve or reject.")}catch(error){if(currentCreatorSession(revision)&&creation===aiCreateRevision)status(error.message,true)}};
async function readCreatorAIWire(reader,operation,id,account,onDelta){
 const decoder=new TextDecoder("utf-8",{fatal:true});let pending="",total=0,outputBytes=0,complete=false;
 const line=raw=>{
  if(!raw.trim())return;if(complete)throw new Error(t("aiSavedUnavailable"));
  const event=JSON.parse(raw);if(!event||Array.isArray(event)||typeof event!=="object"||Object.keys(event).some(k=>!["state","delta","job","error"].includes(k)))throw new Error(t("aiSavedUnavailable"));
  if(event.error)throw new Error(String(event.error));
  if(event.delta!==undefined){if(typeof event.delta!=="string")throw new Error(t("aiSavedUnavailable"));outputBytes+=new TextEncoder().encode(event.delta).byteLength;if(outputBytes>200000)throw new Error(t("aiSavedUnavailable"));onDelta(event.delta)}
  if(event.job!==undefined){const job=event.job;if(!job||get(job,"id","ID")!==id||get(job,"owner","Owner")!==account||!["review_required","cancelled","recovery_required"].includes(get(job,"state","State"))||event.state!==get(job,"state","State"))throw new Error(t("aiSavedUnavailable"));complete=true}
 };
 for(;;){const {value,done}=await operation.wait(reader.read());if(value){total+=value.byteLength;if(total>1048576)throw new Error(t("aiSavedUnavailable"))}pending+=decoder.decode(value||new Uint8Array(),{stream:!done});if(pending.length>524288)throw new Error(t("aiSavedUnavailable"));const lines=pending.split("\n");pending=lines.pop()||"";for(const raw of lines)line(raw);if(done){if(pending)line(pending);break}}
 if(!complete)throw new Error(t("aiSavedUnavailable"));
}
$("#ai-run").onclick=async()=>{
 if(!currentAI||creatorAccount===null||activeAIRequest||get(currentAI,"state","State")!=="awaiting_permission")return;
 const id=get(currentAI,"id","ID"),revision=creatorSessionRevision,selection=aiSelectionRevision,account=creatorAccount,operation=beginCreatorRequest(30000);activeAIRequest=operation;
 showAI({...currentAI,State:"running",state:"running"});let streamed="",reader;
 const confirmSaved=async()=>{
 const recovery=beginCreatorRequest(15000);activeAIRequest=recovery;
 try{const job=await api(`/v1/ai/jobs/${id}`,{signal:recovery.signal});if(!currentAISelection(revision,id,selection))return;if(get(job,"id","ID")!==id||get(job,"owner","Owner")!==account)throw new Error(t("aiWrongSavedAccount"));showAI(job);status(aiStateLabel(get(job,"state","State")))}
 finally{recovery.finish();if(activeAIRequest===recovery)activeAIRequest=null}
 };
 try{
  const headers={...await operation.wait(authorizeCreator(`/v1/ai/jobs/${id}/stream`,"POST")),"Idempotency-Key":crypto.randomUUID(),Accept:"application/x-ndjson"};assertCreatorSession(revision);operation.signal.throwIfAborted();
  const response=await operation.wait(fetch(`${API}/v1/ai/jobs/${id}/stream`,{method:"POST",headers,credentials:"same-origin",redirect:"error",signal:operation.signal}));
  if(!currentAISelection(revision,id,selection)){await response.body?.cancel();return}if(!response.ok)throw new Error(`HTTP ${response.status}`);reader=response.body.getReader();
  await readCreatorAIWire(reader,operation,id,account,delta=>{if(!currentAISelection(revision,id,selection))throw new DOMException("Creator account changed","AbortError");streamed+=delta;$("#ai-result").textContent=streamed});
  if(currentAISelection(revision,id,selection))await confirmSaved();
 }catch(error){
  if(!currentAISelection(revision,id,selection))return;
  if(operation.signal.aborted&&operation.signal.reason?.name!=="TimeoutError")return;
  status(t("aiSavedUnavailable"),true);try{await confirmSaved()}catch{if(currentAISelection(revision,id,selection))status(t("aiSavedUnavailable"),true)}
 }finally{void reader?.cancel().catch(()=>{});reader?.releaseLock();operation.finish();if(activeAIRequest===operation)activeAIRequest=null}
};
$('#ai-cancel').onclick=async()=>{
  if(!currentAI)return;const id=get(currentAI,'id','ID'),revision=creatorSessionRevision,selection=aiSelectionRevision;activeAIRequest?.abort();
  try{const job=await api('/v1/ai/jobs/'+id+'/cancel',{method:'POST'});if(!currentAISelection(revision,id,selection))return;showAI(job);status('AI request cancelled and audited.')}catch(error){if(currentAISelection(revision,id,selection))status(error.message,true)}
};
async function reviewAI(apply){
  if(!currentAI)return;const id=get(currentAI,'id','ID'),revision=creatorSessionRevision,selection=aiSelectionRevision;
  try{const job=await api('/v1/ai/jobs/'+id+'/review',json({apply}));if(!currentAISelection(revision,id,selection))return;showAI(job);status(apply?'Suggestion accepted; publication still requires a separate human action.':'Suggestion rejected and audited.')}catch(error){if(currentAISelection(revision,id,selection))status(error.message,true)}
}
$('#ai-accept').onclick=()=>reviewAI(true);$('#ai-reject').onclick=()=>reviewAI(false);
$('#ai-delete').onclick=async()=>{
  if(!currentAI||!confirm('Delete this AI context and result? The minimal deletion audit remains.'))return;
  const id=get(currentAI,'id','ID'),revision=creatorSessionRevision,selection=aiSelectionRevision;
  try{await api('/v1/ai/jobs/'+id,{method:'DELETE'});if(!currentAISelection(revision,id,selection))return;currentAI=null;aiSelectionRevision++;$('#ai-result').textContent='AI context and result deleted.';for(const id of ['#ai-run','#ai-cancel','#ai-accept','#ai-reject','#ai-delete'])$(id).disabled=true;status('AI data deleted within the service retention boundary.');await refresh()}catch(error){if(currentAISelection(revision,id,selection))status(error.message,true)}
};
const returnedPanel=new URLSearchParams(location.search).get('mediaView') || location.hash.slice(1);
if(['overview','channel','team','rights','content','upload','assets','earn','moderation','disputes','ai'].includes(returnedPanel))document.querySelector('nav button[data-panel="'+returnedPanel+'"]')?.click();
await i18nReady.catch(()=>null);
