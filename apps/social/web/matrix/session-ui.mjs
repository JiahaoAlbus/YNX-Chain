import {MatrixSocialTransport,MATRIX_PROTOCOL} from './transport.mjs';
import {fetchMatrixLoginMetadata,createMatrixLoginController,handleMatrixLoginCallback,validMatrixUserId} from './login.mjs';
import {matrixCryptoStore} from './crypto-store.mjs';
import {createSocialPrivateSession,SOCIAL_CHAT_SCOPES,SOCIAL_AUDIENCE_SCOPES} from '../private-session.js';
import {createSsoReauthController} from './sso-reauth.mjs';
import {createChatConfirmation} from './chat-confirmation.mjs';
import {createChatCopy} from './chat-copy.mjs';
import {createRestrictedMomentsUI} from './restricted-moments-ui.mjs';
import {createSocialAudienceHTTPClient} from './audience-client.mjs';
import {openProtectedMomentDrafts} from './protected-drafts.mjs';
const root=document.getElementById('matrix-social-workspace');
const loginCallback=handleMatrixLoginCallback();
if(root&&!loginCallback){
 const status=root.querySelector('[data-status]'),requests=root.querySelector('[data-verification]'),devices=root.querySelector('[data-devices]'),messages=root.querySelector('[data-messages]');
 const copy=createChatCopy(document),confirmation=createChatConfirmation({container:root,text:copy.text});
 for(const node of root.querySelectorAll('[data-chat-copy]'))if(node.dataset.chatCopy)node.textContent=copy.text(node.dataset.chatCopy);
 const label=text=>{status.textContent=copy.message(text)},client=createSocialPrivateSession({scopes:SOCIAL_CHAT_SCOPES});let account=null,roomId=null,activeWork=null,reauth,login,pageEpoch=0,renderRunning=false,renderQueued=false,checkingIdentity=false,sendReady=false;
 let momentComposer=null;
 function controls(){root.querySelector('[data-send-form] button').disabled=!sendReady||!!activeWork;root.querySelector('[data-attachment]').disabled=!sendReady||!!activeWork;momentComposer?.refresh()}
 function phase(value,text){status.dataset.phase=value;root.dataset.chatPhase=value;root.querySelector('[data-connection-label]').textContent=copy.text('state'+value[0].toUpperCase()+value.slice(1));label(text??copy.text(value));controls()}
 function diagnostic(error){const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)?error.code:'ACTION_UNAVAILABLE';root.querySelector('[data-diagnostic-code]').textContent=code}
 const transport=new MatrixSocialTransport({reauthenticateDevice:input=>reauth.request(input),publish:event=>{if(event.type==='sync'){sendReady=false;phase(["PREPARED","SYNCING"].includes(event.state)?'connected':'offline');if(roomId&&["PREPARED","SYNCING"].includes(event.state))void renderMessages()}if(event.type==='devices-changed'){sendReady=false;phase('verifying');}if(event.type==='encrypted-event'&&roomId)void renderMessages()},onVerification:event=>{if(!event.id)return;const view=captureView();guardView(view);let section=[...requests.children].find(node=>node.dataset.id===event.id);if(!section){section=document.createElement('div');section.dataset.id=event.id;requests.append(section)}section.replaceChildren();const text=document.createElement('p');text.textContent=event.sas?.decimal?`Compare on both devices: ${event.sas.decimal.join(' / ')}`:`Compare this device with the other person: ${event.userId??''} ${event.deviceId??''}`;section.append(text);const button=(title,action)=>{const node=document.createElement('button');node.type='button';node.textContent=title;node.onclick=()=>void work(async()=>{guardView(view);await identity(view);guardView(view);await action();guardView(view)});section.append(node)};if(event.needsConfirmation){button('Both displays match',()=>transport.confirmVerification(event.id,true));button('Do not match',()=>transport.confirmVerification(event.id,false))}else{button('Accept request',()=>transport.acceptVerification(event.id));button('Start SAS comparison',()=>transport.startVerification(event.id))}button('Reject',()=>transport.rejectVerification(event.id))}});
 const uiError=(code,message)=>Object.assign(new Error(message),{code});
 function guardWork(intent){if(!intent)return;if(activeWork!==intent)throw uiError('UI_STALE_VIEW','Previous operation was discarded');if(intent.controller.signal.aborted)throw intent.controller.signal.reason??uiError('UI_STALE_VIEW','Previous operation was discarded')}
 function waitIntent(promise,intent,timeoutMs=15000){
  return new Promise((resolve,reject)=>{
   let done=false,timer;const signal=intent?.controller.signal;
   const finish=(error,value)=>{if(done)return;done=true;if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)};
   const abort=()=>finish(signal.reason??uiError('UI_STALE_VIEW','Previous operation was discarded'));
   Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));
   if(signal?.aborted){abort();return}signal?.addEventListener('abort',abort,{once:true});
   if(timeoutMs>0)timer=setTimeout(()=>{const error=uiError('UI_IDENTITY_UNAVAILABLE','Identity or Matrix metadata temporarily unavailable. Retry explicitly; encrypted storage is retained.');intent?.controller.abort(error);finish(error)},timeoutMs);
  });
 }
 const stale=error=>['UI_STALE_VIEW','MATRIX_STALE_SESSION'].includes(error?.code);
 function captureView(){return {epoch:pageEpoch,account,roomId,operation:transport.capture()}}
 function currentView(view){return view.epoch===pageEpoch&&view.account===account&&view.roomId===roomId&&view.operation.client===transport.client&&view.operation.binding===transport.binding&&view.operation.generation===transport.generation}
 function guardView(view){if(!currentView(view))throw uiError('UI_STALE_VIEW','Previous encrypted view was discarded');transport.guard(view.operation)}
 function selectRoom(id){if(roomId!==id){pageEpoch++;roomId=id;sendReady=false;messages.replaceChildren();phase('verifying')}}
 async function identity(view=null,intent=activeWork){
  const base={epoch:pageEpoch,account,generation:transport.generation,client:transport.client};
  const guard=()=>{guardWork(intent);if(view){guardView(view);return}if(base.epoch!==pageEpoch||base.account!==account||base.generation!==transport.generation||base.client!==transport.client)throw uiError('UI_STALE_VIEW','Identity check belongs to a previous workspace')};
  try{
   const response=await waitIntent(fetch('/sso/account',{credentials:'same-origin',cache:'no-store',signal:intent?.controller.signal}),intent);guard();
   if(!response.ok)throw uiError([401,403].includes(response.status)?'UI_PRIVATE_PERMISSION_REQUIRED':'UI_IDENTITY_UNAVAILABLE','YNX identity unavailable; encrypted storage is retained');
   const verified=await waitIntent(response.json(),intent);guard();const permission=await waitIntent(client.restore(),intent);guard();
   if(permission.status==='network-unavailable'&&!permission.revocationPending)throw uiError('UI_IDENTITY_UNAVAILABLE','Private permission authority temporarily unavailable; encrypted storage is retained');
   if(permission.status!=='connected'||permission.session?.account!==verified.account||!['social.profile','social.contacts','social.messaging'].every(s=>permission.session?.scopes?.includes(s)))throw uiError('UI_PRIVATE_PERMISSION_REQUIRED','Use the existing explicit Social profile, contacts and chat approval first');
   if(account&&account!==verified.account)throw uiError('UI_PRIVATE_PERMISSION_REQUIRED','YNX account changed; previous encrypted workspace was locked');
   return verified;
  }catch(error){guard();if(['UI_PRIVATE_PERMISSION_REQUIRED','SESSION_EXPIRED','PERMISSION_REVOKED','GRANT_REVOKED','SSO_GRANT_EXPIRED'].includes(error?.code)){lock();phase('approval')}throw error}
 }
 function lock(){pageEpoch++;renderQueued=false;sendReady=false;confirmation.cancel();const intent=activeWork;if(intent){activeWork=null;intent.controller.abort(uiError('UI_STALE_VIEW','Previous operation was stopped'));intent.buttons.forEach(button=>button.disabled=false)}reauth?.cancel();login?.cancel();transport.stop();account=null;roomId=null;requests.replaceChildren();devices.replaceChildren();messages.replaceChildren();phase('locked')}
 async function work(action){
  if(activeWork)return;const intent={epoch:pageEpoch,controller:new AbortController(),buttons:[...root.querySelectorAll('button')].filter(button=>button!==root.querySelector('[data-stop]'))};activeWork=intent;intent.buttons.forEach(button=>button.disabled=true);
  controls();try{await waitIntent(action(intent),intent,0)}catch(error){if(activeWork===intent&&intent.epoch===pageEpoch&&!stale(error)){diagnostic(error);sendReady=false;if(error?.code==='MATRIX_LOGIN_CANCELLED'){phase(transport.client?'connected':'locked','Sign-in cancelled. Open private chat again when you are ready. Your encrypted history is retained.')}else phase(error?.code==='UI_IDENTITY_UNAVAILABLE'?'offline':error?.code==='MATRIX_PERMISSION_REQUIRED'?'approval':error?.code==='MATRIX_UNVERIFIED_DEVICE'||error?.code==='MATRIX_DEVICE_CHANGED'?'verifying':'error',error?.code==='UI_IDENTITY_UNAVAILABLE'?copy.text('offline'):error?.code==='MATRIX_PERMISSION_REQUIRED'?copy.text('approval'):copy.text('failed'))}}
  finally{if(activeWork===intent){activeWork=null;intent.buttons.forEach(button=>button.disabled=false);controls()}}
 }
 async function readiness(view){guardView(view);sendReady=false;if(!view.roomId){phase('connected');return}try{await transport.assertTrusted(view.roomId);guardView(view);sendReady=true;phase('ready')}catch(error){guardView(view);diagnostic(error);phase(error?.code==='MATRIX_OFFLINE'?'offline':'verifying')}}
 async function renderMessages(){
  if(!roomId||!account)return;renderQueued=true;if(renderRunning)return;renderRunning=true;
  try{while(renderQueued){renderQueued=false;if(!roomId||!account)break;let view;
   try{
    view=captureView();await identity(view);guardView(view);const records=await transport.messages(view.roomId);guardView(view);
    await identity(view);guardView(view);
    const items=[];for(const record of records){const item=document.createElement('li');item.textContent=`${record.sender}: ${record.content.body??'Encrypted attachment'}${record.verification?.shieldColour?' / identity assurance warning':''}`;
     if(record.content.file){const download=document.createElement('button');download.type='button';download.textContent='Download encrypted attachment';download.onclick=()=>void work(async()=>{
      guardView(view);await identity(view);guardView(view);const bytes=await transport.downloadAttachment(record.content);guardView(view);
      await identity(view);guardView(view);const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),link=document.createElement('a');
      try{link.href=url;link.download=record.content.body||'attachment';link.click()}finally{setTimeout(()=>URL.revokeObjectURL(url),10000)}
     });item.append(download)}items.push(item)
    }guardView(view);messages.replaceChildren(...items);await readiness(view);
   }catch(error){if(!stale(error)&&view&&currentView(view)){sendReady=false;phase('offline')}}
  }}finally{renderRunning=false}
 }
 async function renderDevices(userId){
  const view=captureView(),ownUser=view.operation.binding.userId;guardView(view);
  const list=await transport.devices(userId);guardView(view);const items=[];
  for(const device of list){
   guardView(view);const verified=await transport.crypto().getDeviceVerificationStatus(userId,device.deviceId);guardView(view);
   const item=document.createElement('div'),text=document.createElement('p');text.textContent=`${device.deviceId} / ${verified?.isVerified()?'verified':'unverified'} / ${device.getFingerprint()??'no fingerprint'}`;item.append(text);
   const button=document.createElement('button');button.textContent='Compare device using SAS';button.onclick=()=>void work(async()=>{guardView(view);await identity(view);guardView(view);await transport.requestVerification(userId,device.deviceId);guardView(view)});item.append(button);
   if(userId===ownUser){const remove=document.createElement('button');remove.type='button';remove.textContent=copy.text('remove');remove.onclick=()=>void work(async intent=>{
    const context={account:view.account,site:view.operation.binding.homeserver,deviceId:device.deviceId};
    guardView(view);await identity(view);guardView(view);
    if(!await confirmation.request({...context,title:copy.text('removeTitle'),description:copy.text(device.deviceId===view.operation.binding.deviceId?'currentBody':'removeBody'),signal:intent.controller.signal,guard:()=>{guardWork(intent);guardView(view)}}))return;
    guardWork(intent);guardView(view);await identity(view);guardWork(intent);guardView(view);
    sendReady=false;phase('removing');confirmation.progress({...context,title:copy.text('stateRemoving'),description:copy.text('removing'),guard:()=>{guardWork(intent);guardView(view)}});
    try{await transport.revokeOwnDevice(device.deviceId,true)}catch(error){guardWork(intent);guardView(view);confirmation.result({...context,title:copy.text('failedTitle'),description:copy.text('failedBody'),guard:()=>{guardWork(intent);guardView(view)}});throw error}
    if(device.deviceId===view.operation.binding.deviceId){
     if(view.epoch===pageEpoch&&view.account===account&&view.roomId===roomId&&transport.generation===view.operation.generation+1&&transport.client===null&&transport.binding===null){lock();label('This device was revoked. Your encrypted history is retained. Sign in again to continue.');confirmation.result({...context,title:copy.text('removedTitle'),description:copy.text('removedBody')})}
     return;
    }
    guardView(view);
    try{await identity(view);guardView(view);await renderDevices(userId);guardView(view);await readiness(view);label('Device revoked. Your device list is up to date.')}
    catch(error){if(stale(error)||!currentView(view))throw error;sendReady=false;phase('offline','Device revoked; device list refresh unavailable. Your encrypted history is retained.')}
    guardWork(intent);guardView(view);confirmation.result({...context,title:copy.text('removedTitle'),description:copy.text('removedBody'),guard:()=>{guardWork(intent);guardView(view)}});
   });item.append(remove)}
   items.push(item);
  }
  guardView(view);devices.replaceChildren(...items);
 }
 reauth=createSsoReauthController({container:root,capture:()=>transport.capture(),guard:operation=>transport.guard(operation),validateIdentity:async operation=>{const verified=await identity();transport.guard(operation);if(verified.account!==operation.binding.account)throw new Error('YNX reauthentication account changed')}});
 login=createMatrixLoginController({container:root});
 root.querySelector('[data-connect]').onclick=()=>void work(async intent=>{
  phase('connecting');
  const epoch=pageEpoch,verified=await identity(),selected=verified.account,generation=transport.generation;
  const guard=()=>{guardWork(intent);if(epoch!==pageEpoch||account!==selected)throw uiError('UI_STALE_VIEW','Previous connection was discarded')};
  const guardPending=()=>{guard();if(generation!==transport.generation)throw uiError('UI_STALE_VIEW','Previous connection was discarded')};
  account=selected;const stored=await matrixCryptoStore(selected);
  try{
   guard();await identity();guard();if(generation!==transport.generation)throw uiError('UI_STALE_VIEW','Previous connection was discarded');
   const metadata=await waitIntent(fetchMatrixLoginMetadata({account:selected,deviceId:stored.deviceId,client,csrfToken:verified.csrfToken,guard:guardPending,signal:intent.controller.signal}),intent);
   guardPending();await identity();guardPending();
   phase('waiting');const binding=await login.request({metadata,deviceId:stored.deviceId,guard:guardPending,validateIdentity:()=>identity()});
   guardPending();await identity();guardPending();
   await transport.connect(binding,selected,stored.storageKey,{expectedUserId:metadata.userId});guard();const operation=transport.capture();
   transport.guard(operation);await identity();guard();transport.guard(operation);
   phase('connected');await renderDevices(binding.userId);const view=captureView();await readiness(view);
  }finally{stored.storageKey.fill(0)}
 });
 root.querySelector('[data-stop]').onclick=()=>lock();
 root.querySelector('[data-peer-form]').onsubmit=event=>{event.preventDefault();void work(async()=>{
  const view=captureView();await identity(view);guardView(view);const peer=root.querySelector('[name=matrixPeer]').value.trim();if(!/^ynx1[0-9a-z]{38}$/.test(peer))throw new Error('Enter a canonical YNX peer account');
  const proof=await client.proof(['social.contacts','social.messaging']);guardView(view);const response=await fetch('/social/v3/matrix/peer?account='+encodeURIComponent(peer),{credentials:'same-origin',headers:{'X-YNX-Product-Session-Proof-V2':proof.proofHeader}});guardView(view);
  if(!response.ok)throw new Error(response.status===401||response.status===403?'Chat approval or an accepted contact is required. Return to Social contacts and retry explicitly.':response.status===409?'The contact needs an existing Matrix identity mapping. No new account was created.':'Peer connection is temporarily unavailable. Retry explicitly; encrypted history is retained.');const binding=await response.json();guardView(view);if(binding.account!==peer||!validMatrixUserId(binding.userId,binding.serverName))throw new Error('Peer identity binding mismatch');
  const room=await transport.createConversation(binding.userId,{verifiedPeer:binding});guardView(view);selectRoom(room);label('Encrypted room created. Peer must accept and both devices must complete SAS.');await renderDevices(binding.userId)
 })};
 function renderRoomButtons(){
  const view=captureView();guardView(view);const items=[];
  for(const room of view.operation.client.getRooms()){
   const node=document.createElement('button');node.textContent=room.getMyMembership()==="invite"?"Review conversation invitation":"Open encrypted conversation";node.title=room.roomId;
   node.onclick=()=>void work(async()=>{
    guardView(view);await identity(view);guardView(view);
    if(room.getMyMembership()==='invite'){if(!await confirmation.request({title:copy.text('invitationTitle'),description:copy.text('invitationBody'),approveText:copy.text('accept'),account:view.account,site:view.operation.binding.homeserver,roomId:room.roomId,signal:activeWork.controller.signal,guard:()=>guardView(view)}))return;guardView(view);await identity(view);guardView(view);await transport.join(room.roomId);guardView(view)}
    selectRoom(room.roomId);const selected=captureView();renderRoomButtons();await renderMessages();guardView(selected);
    for(const member of room.getJoinedMembers())if(member.userId!==selected.operation.binding.userId){await renderDevices(member.userId);guardView(selected)}
   });items.push(node);
  }
  guardView(view);requests.replaceChildren(...items);
 }
 root.querySelector('[data-rooms]').onclick=()=>void work(async()=>{const view=captureView();await identity(view);guardView(view);renderRoomButtons()});
 root.querySelector('[data-show-devices]').onclick=()=>void work(async()=>{const view=captureView();await identity(view);guardView(view);await renderDevices(view.operation.binding.userId);guardView(view)});
 root.querySelector('[data-send-form]').onsubmit=event=>{event.preventDefault();void work(async()=>{const view=captureView();await identity(view);guardView(view);if(!view.roomId)throw new Error('Select an encrypted room first');const input=root.querySelector('[name=matrixText]'),draft=input.value;await transport.sendText(view.roomId,draft);guardView(view);if(input.value===draft)input.value='';await renderMessages()})};
 root.querySelector('[data-attachment]').onchange=event=>void work(async()=>{const view=captureView();await identity(view);guardView(view);if(!view.roomId)throw new Error('Select an encrypted room first');const file=event.target.files?.[0];if(!file)return;const bytes=await file.arrayBuffer();guardView(view);await transport.sendAttachment(view.roomId,bytes,{name:file.name,mimeType:file.type||'application/octet-stream'});guardView(view);if(event.target.files?.[0]===file)event.target.value='';await renderMessages()});
 const publishing=createSocialPrivateSession({scopes:SOCIAL_AUDIENCE_SCOPES});
 const audienceHTTP=createSocialAudienceHTTPClient({session:publishing,capture:captureView,guard:guardView,csrfToken:async view=>(await identity(view)).csrfToken});
 async function draftAccess(view,action){guardView(view);const vault=await openProtectedMomentDrafts({account:view.account,deviceId:view.operation.binding.deviceId});try{guardView(view);return await action(vault,()=>guardView(view))}finally{vault.close()}}
 async function audienceChoices(view){
  if(publishing.current?.status!=='connected')throw new Error('Review and approve publishing permissions first');
  const read=async(path,scope)=>{const proof=await publishing.proof([scope]);guardView(view);const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'X-YNX-Product-Session-Proof-V2':proof.proofHeader}});guardView(view);if(!response.ok)throw new Error('Current friends or groups are unavailable; original draft is retained');const result=await response.json();guardView(view);return result};
  const contacts=await read('/social/v1/contacts','social.contacts'),groups=await read('/social/v1/conversations','social.messaging');
  return {contacts:(contacts.contacts??[]).filter(person=>/^sp_[A-Za-z0-9_-]{32}$/.test(person.id)).map(person=>({id:person.id,title:person.displayName||person.handle||'Friend'})),groups:(groups.conversations??[]).filter(record=>/^group_[a-f0-9]{24}$/.test(record.id)).map(record=>({id:record.id,title:record.title||'Group'}))};
 }
 momentComposer=createRestrictedMomentsUI({container:root,transport,capture:captureView,guard:guardView,identity,work,
  resolveAudience:selection=>audienceHTTP.resolve(selection),authorize:(expected,action)=>audienceHTTP.authorize(expected,action),loadSelections:audienceChoices,
  drafts:{save:(view,payload)=>draftAccess(view,(vault,guard)=>vault.save(payload,guard)),load:view=>draftAccess(view,(vault,guard)=>vault.load(guard)),clearConfirmed:(view,transactionId)=>draftAccess(view,(vault,guard)=>vault.clearConfirmed(transactionId,guard))},
  approvePublishing:async()=>{const view=captureView();await identity(view);guardView(view);const result=await publishing.begin();guardView(view);if(result?.status!=='connected')throw new Error('Publishing approval is not confirmed; chat permission was not upgraded')}});
 phase('locked');
 setInterval(()=>{if(!account||checkingIdentity)return;checkingIdentity=true;void identity().catch(error=>{if(account&&!stale(error)){sendReady=false;phase('offline')}}).finally(()=>{checkingIdentity=false})},15000);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&account)label('Session retained locally; permissions are rechecked on next operation')});
}
