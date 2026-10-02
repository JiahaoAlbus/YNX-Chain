import {MatrixSocialTransport,fetchMatrixBinding,MATRIX_PROTOCOL} from './transport.mjs';
import {matrixCryptoStore} from './crypto-store.mjs';
import {createSocialPrivateSession,SOCIAL_CHAT_SCOPES} from '../private-session.js';
import {createSsoReauthController} from './sso-reauth.mjs';
const root=document.getElementById('matrix-social-workspace');
if(root){
 const status=root.querySelector('[data-status]'),requests=root.querySelector('[data-verification]'),devices=root.querySelector('[data-devices]'),messages=root.querySelector('[data-messages]');
 const label=text=>{status.textContent=text},client=createSocialPrivateSession({scopes:SOCIAL_CHAT_SCOPES});let account=null,roomId=null,busy=false,reauth,pageEpoch=0,renderRunning=false,renderQueued=false,checkingIdentity=false;
 const transport=new MatrixSocialTransport({reauthenticateDevice:input=>reauth.request(input),publish:event=>{if(event.type==='sync')label(["PREPARED","SYNCING"].includes(event.state)?"Private chat connected":"Connection interrupted. Encrypted keys and history are retained.");if(event.type==='devices-changed')label('Device list changed. Verify new devices before sending.');if(event.type==='encrypted-event'&&roomId)void renderMessages()},onVerification:event=>{if(!event.id)return;let section=[...requests.children].find(node=>node.dataset.id===event.id);if(!section){section=document.createElement('div');section.dataset.id=event.id;requests.append(section)}section.replaceChildren();const text=document.createElement('p');text.textContent=event.sas?.decimal?`Compare on both devices: ${event.sas.decimal.join(' / ')}`:`Verification ${event.userId??''} ${event.deviceId??''}; phase ${event.phase??''}`;section.append(text);const button=(title,action)=>{const node=document.createElement('button');node.type='button';node.textContent=title;node.onclick=()=>void work(action);section.append(node)};if(event.needsConfirmation){button('Both displays match',()=>transport.confirmVerification(event.id,true));button('Do not match',()=>transport.confirmVerification(event.id,false))}else{button('Accept request',()=>transport.acceptVerification(event.id));button('Start SAS comparison',()=>transport.startVerification(event.id))}button('Reject',()=>transport.rejectVerification(event.id))}});
 const uiError=(code,message)=>Object.assign(new Error(message),{code});
 const stale=error=>['UI_STALE_VIEW','MATRIX_STALE_SESSION'].includes(error?.code);
 function captureView(){return {epoch:pageEpoch,account,roomId,operation:transport.capture()}}
 function currentView(view){return view.epoch===pageEpoch&&view.account===account&&view.roomId===roomId&&view.operation.client===transport.client&&view.operation.binding===transport.binding&&view.operation.generation===transport.generation}
 function guardView(view){if(!currentView(view))throw uiError('UI_STALE_VIEW','Previous encrypted view was discarded');transport.guard(view.operation)}
 function selectRoom(id){if(roomId!==id){pageEpoch++;roomId=id;messages.replaceChildren()}}
 async function identity(view=null){
  const base={epoch:pageEpoch,account,generation:transport.generation,client:transport.client};
  const guard=()=>{if(view){guardView(view);return}if(base.epoch!==pageEpoch||base.account!==account||base.generation!==transport.generation||base.client!==transport.client)throw uiError('UI_STALE_VIEW','Identity check belongs to a previous workspace')};
  try{
   const response=await fetch('/sso/account',{credentials:'same-origin',cache:'no-store'});guard();
   if(!response.ok)throw uiError([401,403].includes(response.status)?'UI_PRIVATE_PERMISSION_REQUIRED':'UI_IDENTITY_UNAVAILABLE','YNX identity unavailable; encrypted storage is retained');
   const verified=await response.json();guard();const permission=await client.restore();guard();
   if(permission.status==='network-unavailable'&&!permission.revocationPending)throw uiError('UI_IDENTITY_UNAVAILABLE','Private permission authority temporarily unavailable; encrypted storage is retained');
   if(permission.status!=='connected'||permission.session?.account!==verified.account||!['social.profile','social.contacts','social.messaging'].every(s=>permission.session?.scopes?.includes(s)))throw uiError('UI_PRIVATE_PERMISSION_REQUIRED','Use the existing explicit Social profile, contacts and chat approval first');
   if(account&&account!==verified.account)throw uiError('UI_PRIVATE_PERMISSION_REQUIRED','YNX account changed; previous encrypted workspace was locked');
   return verified;
  }catch(error){guard();if(['UI_PRIVATE_PERMISSION_REQUIRED','SESSION_EXPIRED','PERMISSION_REVOKED','GRANT_REVOKED','SSO_GRANT_EXPIRED'].includes(error?.code))lock();throw error}
 }
 function lock(){pageEpoch++;renderQueued=false;reauth?.cancel();transport.stop();account=null;roomId=null;requests.replaceChildren();devices.replaceChildren();messages.replaceChildren();label('Federated encrypted chat locked. Legacy v2 data is unchanged.')}
 async function work(action){if(busy)return;busy=true;const epoch=pageEpoch,buttons=[...root.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await action()}catch(error){if(epoch===pageEpoch&&!stale(error))label(error.message||'Federated chat unavailable')}finally{busy=false;buttons.forEach(b=>b.disabled=false)}}
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
    }guardView(view);messages.replaceChildren(...items);
   }catch(error){if(!stale(error)&&view&&currentView(view))label('Encrypted history temporarily unavailable; storage retained, no plaintext fallback')}
  }}finally{renderRunning=false}
 }
 async function renderDevices(userId){
  const view=captureView(),ownUser=view.operation.binding.userId;guardView(view);
  const list=await transport.devices(userId);guardView(view);const items=[];
  for(const device of list){
   guardView(view);const verified=await transport.crypto().getDeviceVerificationStatus(userId,device.deviceId);guardView(view);
   const item=document.createElement('div'),text=document.createElement('p');text.textContent=`${device.deviceId} / ${verified?.isVerified()?'verified':'unverified'} / ${device.getFingerprint()??'no fingerprint'}`;item.append(text);
   const button=document.createElement('button');button.textContent='Compare device using SAS';button.onclick=()=>void work(async()=>{guardView(view);await identity(view);guardView(view);await transport.requestVerification(userId,device.deviceId);guardView(view)});item.append(button);
   if(userId===ownUser){const remove=document.createElement('button');remove.textContent='Revoke this device';remove.onclick=()=>void work(async()=>{guardView(view);await identity(view);guardView(view);if(confirm('Revoke this Matrix device? Existing downloaded content cannot be recalled.')){guardView(view);await transport.revokeOwnDevice(device.deviceId,true)}});item.append(remove)}
   items.push(item);
  }
  guardView(view);devices.replaceChildren(...items);
 }
 reauth=createSsoReauthController({container:root,capture:()=>transport.capture(),guard:operation=>transport.guard(operation),validateIdentity:async operation=>{const verified=await identity();transport.guard(operation);if(verified.account!==operation.binding.account)throw new Error('YNX reauthentication account changed')}});
 root.querySelector('[data-connect]').onclick=()=>void work(async()=>{
  const epoch=pageEpoch,verified=await identity(),selected=verified.account,generation=transport.generation;
  const guard=()=>{if(epoch!==pageEpoch||account!==selected)throw uiError('UI_STALE_VIEW','Previous connection was discarded')};
  account=selected;const stored=await matrixCryptoStore(selected);
  try{
   guard();await identity();guard();if(generation!==transport.generation)throw uiError('UI_STALE_VIEW','Previous connection was discarded');
   const binding=await fetchMatrixBinding({account:selected,deviceId:stored.deviceId,client,csrfToken:verified.csrfToken});
   guard();await identity();guard();if(generation!==transport.generation)throw uiError('UI_STALE_VIEW','Previous connection was discarded');
   await transport.connect(binding,selected,stored.storageKey);guard();const operation=transport.capture();
   transport.guard(operation);await identity();guard();transport.guard(operation);
   label("YNX account verified. Compare peer devices before sending.");await renderDevices(binding.userId);
  }finally{stored.storageKey.fill(0)}
 });
 root.querySelector('[data-stop]').onclick=()=>lock();
 root.querySelector('[data-peer-form]').onsubmit=event=>{event.preventDefault();void work(async()=>{await identity();const peer=root.querySelector('[name=matrixPeer]').value.trim();if(!/^ynx1[0-9a-z]{38}$/.test(peer))throw new Error('Enter a canonical YNX peer account');const proof=await client.proof(['social.contacts','social.messaging']),response=await fetch('/social/v3/matrix/peer?account='+encodeURIComponent(peer),{credentials:'same-origin',headers:{'X-YNX-Product-Session-Proof-V2':proof.proofHeader}});if(!response.ok)throw new Error('Verified peer binding unavailable');const binding=await response.json();if(binding.account!==peer||binding.userId!==`@${peer}:${binding.serverName}`)throw new Error('Peer identity binding mismatch');selectRoom(await transport.createConversation(binding.userId));label('Encrypted room created. Peer must accept and both devices must complete SAS.');await renderDevices(binding.userId)})};
 root.querySelector('[data-rooms]').onclick=()=>void work(async()=>{await identity();requests.replaceChildren();for(const room of transport.client.getRooms()){const node=document.createElement('button');node.textContent=room.getMyMembership()==="invite"?"Review conversation invitation":"Open encrypted conversation";node.title=room.roomId;node.onclick=()=>void work(async()=>{await identity();if(room.getMyMembership()==='invite'){if(!confirm('Accept this encrypted conversation invitation?'))return;await transport.join(room.roomId)}selectRoom(room.roomId);await renderMessages();for(const member of room.getJoinedMembers())if(member.userId!==transport.binding.userId)await renderDevices(member.userId)});requests.append(node)}});
 root.querySelector('[data-send-form]').onsubmit=event=>{event.preventDefault();void work(async()=>{await identity();if(!roomId)throw new Error('Select an encrypted room first');const input=root.querySelector('[name=matrixText]');await transport.sendText(roomId,input.value);input.value='';await renderMessages()})};
 root.querySelector('[data-attachment]').onchange=event=>void work(async()=>{await identity();if(!roomId)throw new Error('Select an encrypted room first');const file=event.target.files?.[0];if(!file)return;await transport.sendAttachment(roomId,await file.arrayBuffer(),{name:file.name,mimeType:file.type||'application/octet-stream'});event.target.value='';await renderMessages()});
 setInterval(()=>{if(!account||checkingIdentity)return;checkingIdentity=true;void identity().catch(error=>{if(account&&!stale(error))label('Identity check unavailable; encrypted storage retained')}).finally(()=>{checkingIdentity=false})},15000);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&account)label('Session retained locally; permissions are rechecked on next operation')});
}
