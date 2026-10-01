import {createSocialPrivateSession,SOCIAL_CHAT_SCOPES} from './private-session.js';
import {SocialWorkspace,browserChatDevices} from './chat-workspace.ts';
import {SocialAPI} from '../src/api.ts';
import {DurableOutbox} from '../src/durableOutbox.ts';

const privateSession=createSocialPrivateSession();
const chatSession=createSocialPrivateSession({scopes:SOCIAL_CHAT_SCOPES});
const byId=id=>document.getElementById(id);
const status=byId('private-auth-status'),account=byId('private-auth-account'),openWallet=byId('private-auth-open');
const buttons=['private-auth-begin','private-auth-restore','private-auth-disconnect'].map(byId);
const chatOpen=byId('chat-open-wallet'),workspaceStatus=byId('workspace-status');
const intentKey='ynx.social.request.intent.v2';
const outbox=new DurableOutbox({read:slot=>localStorage.getItem(`ynx.social.web.outbox.v2.${slot}`),write:(slot,value)=>localStorage.setItem(`ynx.social.web.outbox.v2.${slot}`,value),remove:slot=>localStorage.removeItem(`ynx.social.web.outbox.v2.${slot}`)});
const identity=async()=>{const response=await fetch('/sso/account',{credentials:'same-origin',cache:'no-store',redirect:'error'});if(!response.ok)throw new Error('Sign in with YNX identity first');const result=await response.json();if(!result.signedIn||typeof result.account!=='string'||typeof result.csrfToken!=='string')throw new Error('No verified shared identity');return result};
const workspace=new SocialWorkspace(chatSession,new SocialAPI(location.origin),browserChatDevices(),outbox,identity,view=>{
  workspaceStatus.textContent=view.status;
  if(view.account)localStorage.setItem('ynx.social.web.workspace.approved.v2','yes');
  byId('workspace-content').hidden=!view.account;
  byId('workspace-account').textContent=view.account?`Private account: ${view.account}`:'';
  const profile=byId('profile-form');
  for(const key of ['handle','displayName','bio'])profile.elements.namedItem(key).value=view.profile?.[key]??'';
  byId('contact-request-form').querySelector('button').disabled=!view.profile;
  const contacts=byId('contact-list');contacts.replaceChildren();
  for(const person of view.contacts??[]){const li=document.createElement('li'),button=document.createElement('button');li.append(document.createTextNode(`${person.displayName} @${person.handle} `));button.type='button';button.textContent='Start conversation';button.addEventListener('click',()=>void work(()=>workspace.createConversation(person.handle)));li.append(button);contacts.append(li)}
  const requests=byId('contact-request-list');requests.replaceChildren();
  for(const request of view.requests??[]){const li=document.createElement('li');li.append(document.createTextNode(`${request.direction==='incoming'?'From':'To'} @${request.person.handle}: ${request.status} `));if(request.status==='pending'){for(const action of request.direction==='incoming'?['accept','reject']:['withdraw']){const button=document.createElement('button');button.type='button';button.textContent=action[0].toUpperCase()+action.slice(1);button.addEventListener('click',()=>void work(()=>workspace.transitionContact(request.id,action)));li.append(button)}}requests.append(li)}
  const conversations=byId('conversation-list');conversations.replaceChildren();
  for(const item of view.conversations??[]){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=item.title||item.handle||'Conversation';button.addEventListener('click',()=>void work(()=>workspace.select(item.id)));li.append(button);conversations.append(li)}
  const messages=byId('message-list');messages.replaceChildren();
  for(const item of view.messages??[]){const li=document.createElement('li');li.textContent=`${item.record.sender===view.account?'You':'Participant'}: ${item.plaintext}`;messages.append(li)}
  byId('conversation-title').textContent=view.conversationId?'Encrypted conversation':'Choose a conversation';
});
function showRoute(anchor,result){anchor.hidden=true;anchor.removeAttribute('href');if(result.route?.status==='ready'){const url=new URL(result.route.url);if(url.protocol!=='ynxwallet:'||url.hostname!=='authorize')throw new Error('Unexpected Wallet launch route');anchor.href=url.href;anchor.hidden=false}}
function render(result){showRoute(openWallet,result);account.textContent=result.status==='connected'?`Signed in: ${result.session.account}`:'Sign in to keep your private workspace together.';status.textContent=result.status==='connected'?'You are signed in. Allow Social contacts and chat separately when you are ready.':result.message||`Private session: ${result.status}`}
async function perform(action){for(const button of buttons)button.disabled=true;try{render(await action())}catch(error){account.textContent='Private identity could not be confirmed.';showRoute(openWallet,{});status.textContent=error.message||'Private identity needs Retry. Standard wallet connection is unchanged.'}finally{for(const button of buttons)button.disabled=false}}
async function work(action){const controls=[...byId('social-workspace').querySelectorAll('button')];for(const button of controls)button.disabled=true;try{return await action()}catch(error){if(error.status===401||error.status===403)workspace.lock('Private permission is no longer verified; existing keys and ciphertext retained.');if(error.code==='CHAT_DEVICE_PROTECTION_REQUIRED')byId('protect-chat-device').hidden=false;workspaceStatus.textContent=error.message||'Private operation unavailable; existing ciphertext retained.'}finally{for(const button of controls)button.disabled=false;byId('contact-request-form').querySelector('button').disabled=!workspace.current.profile}}
buttons[0].addEventListener('click',()=>void perform(async()=>{const result=await privateSession.begin();localStorage.setItem(intentKey,'identity');return result}));
buttons[1].addEventListener('click',()=>void perform(()=>privateSession.restore()));
buttons[2].addEventListener('click',()=>void perform(()=>privateSession.disconnect()));
byId('chat-authorize').addEventListener('click',()=>void work(async()=>{await identity();const result=await workspace.authorize();if(result.status==='connected'){await workspace.restore();return;}localStorage.setItem(intentKey,'chat');showRoute(chatOpen,result);workspaceStatus.textContent=result.message||'Approve the exact profile, contacts and chat scopes in Wallet when ready. Nothing opens automatically.'}));
byId('chat-restore').addEventListener('click',()=>void work(()=>workspace.restore()));
byId('chat-logout').addEventListener('click',()=>void work(async()=>{workspace.lock('Signed out locally. Revocation is pending.');showRoute(chatOpen,{});const shared=await identity().catch(()=>null);const revoked=await Promise.allSettled([workspace.logout(),privateSession.disconnect()]);if(revoked[1].status==='fulfilled')render(revoked[1].value);if(shared){const response=await fetch('/sso/logout',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'X-YNX-SSO-CSRF':shared.csrfToken}});if(!response.ok)throw new Error('Shared identity revocation is pending. Private access remains locked.')}if(revoked.some(result=>result.status==='rejected')||revoked[1].value?.status!=='disconnected')throw new Error('Wallet revocation is pending. Keys and ciphertext were retained.');workspace.lock(shared?'Private workspace and shared identity signed out. Keys and pending ciphertext retained.':'Social permission revoked; shared identity sign-out could not be confirmed. Private access remains locked.')}));
byId('workspace-refresh').addEventListener('click',()=>void work(()=>workspace.refresh()));
byId('protect-chat-device').addEventListener('click',()=>{const confirmed=confirm('Protect this browser\'s existing Social chat device? The exact old keys are encrypted and read back before its old cleartext carrier is removed. Messages and pending ciphertext are preserved. No key import or administrator credential is required.');if(confirmed)void work(async()=>{await workspace.protectExistingDevice(true);byId('protect-chat-device').hidden=true})});
byId('contact-request-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,handle=String(new FormData(form).get('handle'));void work(async()=>{await workspace.requestContact(handle);form.reset()})});
byId('profile-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);void work(()=>workspace.updateProfile({handle:String(data.get('handle')),displayName:String(data.get('displayName')),bio:String(data.get('bio'))}))});
byId('conversation-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);void work(()=>workspace.createConversation(String(data.get('handle'))))});
byId('message-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,text=String(new FormData(form).get('message'));void work(async()=>{await workspace.send(text);form.reset()})});
byId('message-retry').addEventListener('click',()=>void work(()=>workspace.retry()));
// Only existing approved storage can restore; no guest key/request/approval creation.
if(location.pathname==='/wallet-auth/callback'){
  if(localStorage.getItem(intentKey)==='chat')void work(async()=>{await workspace.accept(location.href);history.replaceState(null,'','/#conversations');localStorage.removeItem(intentKey)});
  else void perform(async()=>{const result=await privateSession.handleReturn(location.href);history.replaceState(null,'','/wallet-auth/callback');localStorage.removeItem(intentKey);return result});
}else if(localStorage.getItem('ynx.social.web.workspace.approved.v2')==='yes')void work(()=>workspace.restore());
byId('workspace-content').addEventListener('focusin',()=>{if(workspace.current.account)localStorage.setItem('ynx.social.web.workspace.approved.v2','yes')});
addEventListener('storage',event=>{if(event.key==='ynx.social.web.workspace.signedout.v2')workspace.lock('Another tab signed out; reconnect explicitly')});
byId('chat-logout').addEventListener('click',()=>{localStorage.removeItem('ynx.social.web.workspace.approved.v2');localStorage.setItem('ynx.social.web.workspace.signedout.v2',String(Date.now()))});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')workspace.lock('Private workspace hidden; restore retained permission when you return');else if(localStorage.getItem('ynx.social.web.workspace.approved.v2')==='yes')void work(()=>workspace.restore())});
