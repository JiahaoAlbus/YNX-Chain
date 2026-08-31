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
const publicAPI=`${location.origin}/video/api`,localAPI="http://127.0.0.1:8423";
const API=localStorage.getItem("ynx.video.api")||(location.hostname==="127.0.0.1"||location.hostname==="localhost"?localAPI:publicAPI),$=s=>document.querySelector(s);
const session=()=>sessionStorage.getItem("ynx.video.session")||new URLSearchParams(location.hash.slice(1)).get("gateway_session");let snapshot=null,currentAI=null;
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
async function api(path,opt={}){const headers={...(opt.headers||{})},method=(opt.method||"GET").toUpperCase();if(session())headers["X-YNX-App-Session"]=session();if(!["GET","HEAD"].includes(method))headers["Idempotency-Key"]||=crypto.randomUUID();let response;for(let attempt=0;attempt<2;attempt++){try{response=await fetch(API+path,{...opt,headers});break}catch(error){if(attempt===1){reduceWallet({type:"PRIVATE_SESSION_DEGRADED"});throw error}}}const data=await response.json().catch(()=>({error:"Invalid service response"}));if(!response.ok){if(response.status>=500)reduceWallet({type:"PRIVATE_SESSION_DEGRADED"});throw new Error(data.error||`HTTP ${response.status}`)}reduceWallet({type:"PRIVATE_SESSION_READY"});return data}
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
  walletConnect.textContent=connected?"Wallet details":"Connect wallet";
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
  sessionStorage.removeItem("ynx.video.session");disconnectWallet("Wallet permissions revoked locally.");
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
let walletConnecting=false;
if(location.pathname==="/video/studio/wallet-auth/callback"){
  const callbackParams=new URLSearchParams(location.search);
  const cbSession=callbackParams.get("gateway_session")||callbackParams.get("session");
  if(cbSession) sessionStorage.setItem("ynx.video.session",cbSession);
  const requested=callbackParams.get("redirect_to")||"/video/studio/";
  let next="/video/studio/";
  try{const candidate=new URL(requested,location.origin);if(candidate.origin===location.origin)next=`${candidate.pathname}${candidate.search}${candidate.hash}`}catch{}
  history.replaceState(null,"",`${next}${location.hash}`);
}
if(session()){sessionStorage.setItem("ynx.video.session",session());history.replaceState(null,"",location.pathname);$("#signin").textContent="Wallet connected"}
resetWalletFlow();
void restoreWalletConnection();
document.querySelectorAll("nav button").forEach(button=>button.onclick=()=>{document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x===button));document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===button.dataset.panel));$("#heading").textContent=button.textContent});

async function refresh(){try{snapshot=await api("/v1/studio");const a=snapshot.analytics;$("#views").textContent=a.views;$("#watch").textContent=`${a.watch_seconds}s`;$("#subs").textContent=a.subscribers;$("#revenue").textContent=`${a.revenue_ynxt} YNXT`;renderContent();renderTeam();renderRights();renderAudit();status("Studio state loaded from persistent records.")}catch(error){status(t("unavailable"),true)}}
function rightsFor(videoID){return(snapshot?.rights||[]).find(item=>get(item,"video_id","VideoID")===videoID)}
function openRights(video){const form=$("#rights-form");form.video_id.value=video.id;form.source_sha256.value=video.sha256||"";document.querySelector('nav button[data-panel="rights"]').click();status("Rights form prefilled with the persisted media source hash.")}
function renderContent(){const box=$("#videos"),videos=snapshot?.videos||[];box.replaceChildren();if(!videos.length){box.innerHTML='<p class="meta">No content records. Upload repository-owned media to begin.</p>';return}for(const video of videos){const row=document.createElement("div"),rights=rightsFor(video.id),rightsState=rights?get(rights,"state","State"):"missing",source=video.sha256?`${video.sha256.slice(0,16)}…`:"unavailable",workflow=get(video,"workflow_state","WorkflowState")||"draft",versions=get(video,"versions","Versions")||[];row.className="row lifecycle-row";const takedown=video.takedown?` · takedown ${video.takedown.state}`:"",scheduled=get(video,"scheduled_at","ScheduledAt"),history=versions.slice(-5).reverse().map(version=>`<li><b>v${esc(get(version,"sequence","Sequence"))}</b> ${esc(get(version,"kind","Kind"))} · ${esc(get(version,"recorded_at","RecordedAt"))}</li>`).join("");row.innerHTML=`<div><b>${esc(video.title)}</b><small>${esc(video.id)} · source ${esc(source)}</small><small>Workflow ${esc(workflow)} · version ${esc(get(video,"version","Version")||0)}${scheduled?` · scheduled ${esc(scheduled)}`:""}</small></div><span class="state">${esc(video.status)}${esc(takedown)}</span><span>${esc(video.visibility)} · rights ${esc(rightsState)}</span><div class="row-actions"><button data-action="edit">Edit</button><button data-action="rights">Rights</button>${["draft","rejected","unpublished"].includes(workflow)&&video.status==="ready"?'<button data-action="submit">Submit review</button>':""}${workflow==="in_review"?'<button data-action="review">Review</button>':""}${workflow==="approved"?'<button data-action="visibility">Publish now</button><button data-action="schedule">Schedule</button>':""}${workflow==="scheduled"?'<button data-action="due">Publish due</button>':""}${workflow==="published"?'<button data-action="unpublish" class="danger">Unpublish</button>':""}${video.status==="failed"?'<button data-action="retry">Retry</button>':""}</div><details><summary>Version history (${versions.length})</summary><ol>${history||"<li>No version evidence.</li>"}</ol></details>`;row.querySelector('[data-action="edit"]').onclick=()=>editVideo(video);row.querySelector('[data-action="rights"]').onclick=()=>openRights(video);row.querySelector('[data-action="submit"]')?.addEventListener("click",()=>submitReview(video));row.querySelector('[data-action="review"]')?.addEventListener("click",()=>reviewPublication(video));row.querySelector('[data-action="visibility"]')?.addEventListener("click",()=>publishVideo(video));row.querySelector('[data-action="schedule"]')?.addEventListener("click",()=>schedulePublication(video));row.querySelector('[data-action="due"]')?.addEventListener("click",()=>publishDue(video));row.querySelector('[data-action="unpublish"]')?.addEventListener("click",()=>unpublish(video));row.querySelector('[data-action="retry"]')?.addEventListener("click",()=>retryVideo(video));box.append(row)}}
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
function renderAudit(){rows("#revenue-list",snapshot.revenue||[],r=>`<div class="row"><b>${esc(get(r,"id","ID"))}</b><span>${get(r,"amount_ynxt","AmountYNXT")} YNXT</span><span>${esc(get(r,"pay_receipt_id","PayReceiptID"))}</span></div>`,"No verified revenue records.");rows("#payout-list",snapshot.payout_intents||[],p=>`<div class="row"><b>${esc(get(p,"id","ID"))}</b><span>${get(p,"amount_ynxt","AmountYNXT")} YNXT</span><span class="state">${esc(get(p,"state","State"))}</span></div>`,"No payout intents.");rows("#report-list",snapshot.reports||[],r=>`<div class="row"><b>${esc(get(r,"id","ID"))}</b><span>${esc(get(r,"reason","Reason"))}</span><span class="state">${esc(get(r,"state","State"))}</span></div>`,"No reports on owned videos.");rows("#appeal-list",snapshot.appeals||[],a=>`<div class="row"><b>${esc(get(a,"id","ID"))}</b><span>${esc(get(a,"reason","Reason"))}</span><span class="state">${esc(get(a,"state","State"))}</span></div>`,"No appeals.");rows("#dispute-list",snapshot.disputes||[],d=>`<div class="row"><b>${esc(get(d,"id","ID"))}</b><span>${esc(get(d,"reason","Reason"))}</span><span class="state">${esc(get(d,"state","State"))}</span></div>`,"No revenue disputes.")}

$("#refresh").onclick=refresh;$("#channel-form").onsubmit=async event=>{event.preventDefault();try{const channel=await api("/v1/channels",json({handle:event.target.handle.value,name:event.target.name.value}));$("#channel-result").textContent=JSON.stringify(channel,null,2);status("Channel persisted.");await refresh()}catch(error){status(error.message,true)}};
$("#team-invite-form").onsubmit=async event=>{event.preventDefault();const form=event.target;try{const expires=form.expires_at.value?new Date(form.expires_at.value).toISOString():undefined;await api(`/v1/channels/${encodeURIComponent(form.channel_id.value)}/team/invites`,json({account:form.account.value,role:form.role.value,expires_at:expires}));status("Bounded team invite persisted. The named Wallet account must accept it before access exists.");form.reset();await refresh()}catch(error){status(error.message,true)}};
$("#team-role-form").onsubmit=async event=>{event.preventDefault();const form=event.target;try{await api(`/v1/channels/${encodeURIComponent(form.channel_id.value)}/team/${encodeURIComponent(form.account.value)}/role`,json({role:form.role.value}));status("Role changed and channel authorization version advanced.");await refresh()}catch(error){status(error.message,true)}};
$("#team-revoke-form").onsubmit=async event=>{event.preventDefault();const form=event.target,account=form.account.value,channelID=form.channel_id.value;if(!confirm(`Revoke ${account} from ${channelID}? Their next request will fail closed.`))return;try{await api(`/v1/channels/${encodeURIComponent(channelID)}/team/${encodeURIComponent(account)}`,{method:"DELETE"});status("Team access revoked and session authority invalidated.");form.reset();await refresh()}catch(error){status(error.message,true)}};
$("#rights-form").onsubmit=async event=>{event.preventDefault();const form=event.target;try{let splits=[];if(form.splits.value.trim()){splits=JSON.parse(form.splits.value);if(!Array.isArray(splits))throw new Error("Contributor splits must be a JSON array.")}const body={basis:form.basis.value,license_reference:form.license_reference.value,territories:form.territories.value.split(",").map(value=>value.trim()).filter(Boolean),starts_at:form.starts_at.value?new Date(form.starts_at.value).toISOString():undefined,ends_at:form.ends_at.value?new Date(form.ends_at.value).toISOString():undefined,exclusive:form.exclusive.checked,contributor_splits:splits,evidence_sha256:form.evidence_sha256.value.toLowerCase(),source_sha256:form.source_sha256.value.toLowerCase()};const declaration=await api(`/v1/videos/${encodeURIComponent(form.video_id.value)}/rights`,json(body));status(`Rights declaration ${get(declaration,"id","ID")} persisted as ${get(declaration,"state","State")}. Commercial use still requires independent review.`);await refresh()}catch(error){status(error.message,true)}};
$("#upload-form").onsubmit=async event=>{event.preventDefault();const file=event.target.media.files[0];if(!["video/mp4","video/webm"].includes(file?.type)){status("Select an MP4 or WebM file.",true);return}try{status("Computing SHA-256 and validating rights metadata…");const checksum=await sha256Hex(file),expiry=event.target.rights_expires_at.value?new Date(event.target.rights_expires_at.value).toISOString():"",data=new FormData();for(const [key,value] of [["channel_id",event.target.channel_id.value],["media",file],["size",String(file.size)],["sha256",checksum],["title",event.target.title.value],["description",event.target.description.value],["rights_basis",event.target.rights_basis.value],["rights_source",event.target.rights_source.value],["rights_license",event.target.rights_license.value],["rights_territories",event.target.rights_territories.value],["rights_expires_at",expiry],["rights_evidence_sha256",event.target.rights_evidence_sha256.value],["owned_content_declaration",String(event.target.owned.checked)]])data.set(key,value);status("Uploading for malware scan and adaptive processing…");const video=await api("/v1/uploads",{method:"POST",body:data});status(`Processing state: ${video.status}. Publication still requires review.`);await refresh()}catch(error){status(error.message,true)}};
$("#thumbnail-form").onsubmit=async event=>{event.preventDefault();const file=event.target.thumbnail.files[0],data=new FormData();data.set("thumbnail",file);data.set("size",String(file.size));try{await api(`/v1/videos/${event.target.video_id.value}/thumbnail`,{method:"POST",body:data});status("Thumbnail stored.");await refresh()}catch(error){status(error.message,true)}};
$("#caption-form").onsubmit=async event=>{event.preventDefault();const file=event.target.captions.files[0],data=new FormData();data.set("captions",file);data.set("size",String(file.size));data.set("language",event.target.language.value);data.set("label",event.target.label.value);data.set("ai_proposed","false");try{await api(`/v1/videos/${event.target.video_id.value}/captions`,{method:"POST",body:data});status("Human-approved caption track stored.");await refresh()}catch(error){status(error.message,true)}};
$("#monetization").onsubmit=async event=>{event.preventDefault();try{const result=await api(`/v1/videos/${event.target.video_id.value}/monetization`,{method:"POST"});status(`${get(result,"state","State")}: ${get(result,"reason","Reason")}`);await refresh()}catch(error){status(error.message,true)}};
$("#payout").onsubmit=async event=>{event.preventDefault();try{const intent=await api("/v1/studio/payout-intents",json({amount_ynxt:Number(event.target.amount.value)}));status(`Pay intent ${get(intent,"pay_intent_id","PayIntentID")} awaits Wallet confirmation.`);await refresh()}catch(error){status(error.message,true)}};
$("#appeal").onsubmit=async event=>{event.preventDefault();try{await api(`/v1/reports/${event.target.report_id.value}/appeals`,json({reason:event.target.reason.value}));status("Appeal submitted for human review.");await refresh()}catch(error){status(error.message,true)}};
$("#dispute").onsubmit=async event=>{event.preventDefault();try{await api(`/v1/revenue/${event.target.record_id.value}/disputes`,json({reason:event.target.reason.value}));status("Revenue dispute persisted.");await refresh()}catch(error){status(error.message,true)}};

async function providerStatus(){try{const p=await api("/v1/ai/status");$("#ai-provider").textContent=p.configured?"AI Gateway configured. Provider/model are recorded with each result.":"AI Gateway unavailable. Requests will fail honestly until configured."}catch(error){$("#ai-provider").textContent="AI Gateway status unavailable."}}
function showAI(job){currentAI=job;$("#ai-result").textContent=JSON.stringify(job,null,2);const state=get(job,"state","State");$("#ai-run").disabled=!['awaiting_permission','failed'].includes(state);$("#ai-cancel").disabled=!['awaiting_permission','running'].includes(state);$("#ai-accept").disabled=state!=="review_required";$("#ai-reject").disabled=state!=="review_required";$("#ai-delete").disabled=state==="running"}
$("#ai-form").onsubmit=async event=>{event.preventDefault();try{const job=await api("/v1/ai/jobs",json({video_id:event.target.video_id.value,kind:event.target.kind.value,context_classes:event.target.metadata.checked?["metadata"]:[],output_language:localStorage.getItem("ynx.creator.ai-locale")||localStorage.getItem("ynx.creator.locale")||"en"}));showAI(job);status("Review context preview, output language and estimated units, then explicitly approve or reject.")}catch(error){status(error.message,true)}};
$("#ai-run").onclick=async()=>{if(!currentAI)return;const id=get(currentAI,"id","ID");showAI({...currentAI,State:"running",state:"running"});status("Provider stream running. Cancel remains available.");let streamed="",buffer="";
try{const response=await fetch(`${API}/v1/ai/jobs/${id}/stream`,{method:"POST",headers:{"X-YNX-App-Session":session()||"","Idempotency-Key":crypto.randomUUID(),Accept:"application/x-ndjson"}});
if(!response.ok)throw new Error(`HTTP ${response.status}`);const reader=response.body.getReader(),decoder=new TextDecoder();for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=buffer.split("\n");buffer=lines.pop()||"";for(const line of lines){if(!line)continue;const event=JSON.parse(line);if(event.error)throw new Error(event.error);if(event.delta){streamed+=event.delta;$("#ai-result").textContent=`Streaming provider output — review required\n\n${streamed}`};if(event.job)showAI(event.job)}if(done)break}if(!['review_required','cancelled'].includes(get(currentAI,"state","State")))showAI(await api(`/v1/ai/jobs/${id}`));status(get(currentAI,"state","State")==="review_required"?"AI stream finished; human review is required.":"AI stream ended without applying an action.")}catch(error){status(error.message,true);try{showAI(await api(`/v1/ai/jobs/${id}`))}catch{}}};
$("#ai-cancel").onclick=async()=>{if(!currentAI)return;try{showAI(await api(`/v1/ai/jobs/${get(currentAI,"id","ID")}/cancel`,{method:"POST"}));status("AI request cancelled and audited.")}catch(error){status(error.message,true)}};
async function reviewAI(apply){try{showAI(await api(`/v1/ai/jobs/${get(currentAI,"id","ID")}/review`,json({apply})));status(apply?"Suggestion accepted; publication still requires a separate human action.":"Suggestion rejected and audited.")}catch(error){status(error.message,true)}}$("#ai-accept").onclick=()=>reviewAI(true);$("#ai-reject").onclick=()=>reviewAI(false);
$("#ai-delete").onclick=async()=>{if(!currentAI||!confirm("Delete this AI context and result? The minimal deletion audit remains."))return;try{await api(`/v1/ai/jobs/${get(currentAI,"id","ID")}`,{method:"DELETE"});currentAI=null;$("#ai-result").textContent="AI context and result deleted.";for(const id of ["#ai-run","#ai-cancel","#ai-accept","#ai-reject","#ai-delete"])$(id).disabled=true;status("AI data deleted within the service retention boundary.");await refresh()}catch(error){status(error.message,true)}};
await i18nReady.catch(()=>null);refresh();providerStatus();
