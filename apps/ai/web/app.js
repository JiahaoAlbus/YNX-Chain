const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={token:sessionStorage.getItem('ynx-ai-token')||'',deviceId:sessionStorage.getItem('ynx-ai-device')||'',account:sessionStorage.getItem('ynx-ai-account')||'',challengeId:'',conversationId:'',conversationArchived:false,conversations:[],generationId:'',abort:null,lastPrompt:'',archived:false,provider:null,signingOut:false};
const signoutNoticeKey='ynx-ai-signout-status';
function clearAISession(){for(const key of ['ynx-ai-token','ynx-ai-account','ynx-ai-device'])sessionStorage.removeItem(key);state.token='';state.account='';state.deviceId='';state.challengeId='';state.conversationId='';state.conversations=[];state.lastPrompt='';state.provider=null;state.abort?.abort();state.abort=null;state.generationId=''}
function showSignoutNotice(){const status=sessionStorage.getItem(signoutNoticeKey);if(status)$('#auth-error').textContent=status==='expired'?'Your AI session is no longer valid. Sign in again to continue.':status==='revoked'?'Signed out on this device. The server confirmed revocation of this AI session.':'Signed out on this device. Server revocation is not confirmed; this AI session may still be active on the server.'}
const scopes=['ai:conversations','ai:generate','ai:permissions','ai:data-control'];
async function api(path,options={}){if(state.signingOut)throw new Error('The AI session has ended.');const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(state.token?{Authorization:`Bearer ${state.token}`,'X-YNX-Device-ID':state.deviceId}:{})};const response=await fetch(path,{...options,headers:{...headers,...options.headers}});if(state.signingOut)throw new Error('The AI session has ended.');if(response.status===204)return null;const data=await response.json().catch(()=>({error:`HTTP ${response.status}`}));if(state.signingOut)throw new Error('The AI session has ended.');if(!response.ok){const error=new Error(data.error||`HTTP ${response.status}`);error.status=response.status;throw error}return data}
async function loadPublicStatus(){const badge=$('#public-status-badge');try{const response=await fetch('/api/public-status',{headers:{Accept:'application/json'}});const data=await response.json();if(!response.ok||!data.gatewayReady)throw new Error(data.status||'Gateway unavailable');badge.textContent='Gateway ready';badge.className='runtime-badge available';$('#public-gateway').textContent='Operational';$('#public-provider').textContent=`${data.provider} · ${data.model}`;$('#public-status-detail').textContent=`${data.status} ${data.providerGenerationEvidence}.`;badge.title=`Source: ${data.source} · ${data.asOf}`}catch(error){badge.textContent='Unavailable';badge.className='runtime-badge unavailable';$('#public-gateway').textContent='Unavailable';$('#public-provider').textContent='No substitute model';$('#public-status-detail').textContent=error.message}}
function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2200)}
function escapeHTML(value=''){return value.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

$('#challenge-form').addEventListener('submit',async event=>{event.preventDefault();if(state.signingOut)return;$('#auth-error').textContent='';try{const meta=await api('/api/meta');if(!meta.localFixtureAuthEnabled)throw new Error('Canonical YNX Wallet integration is not deployed. Sign-in is fail-closed; no local session was created.');const out=await api('/api/auth/challenges',{method:'POST',body:JSON.stringify({account:$('#account').value,deviceId:$('#device-id').value,deviceSigningPublicKey:$('#device-public').value,callback:meta.walletCallback,scopes})});if(state.signingOut)return;state.challengeId=out.challengeId;state.deviceId=$('#device-id').value;$('#wallet-link').href=out.walletUrl;$('#proof-step').classList.remove('hidden')}catch(error){if(!state.signingOut)$('#auth-error').textContent=error.message}});
$('#verify-form').addEventListener('submit',async event=>{event.preventDefault();if(state.signingOut)return;$('#auth-error').textContent='';try{const out=await api(`/api/auth/challenges/${encodeURIComponent(state.challengeId)}/verify`,{method:'POST',body:JSON.stringify({accountPublicKey:$('#account-public').value,accountSignature:$('#account-signature').value,deviceSignature:$('#device-signature').value})});if(state.signingOut)return;state.token=out.token;state.account=out.account;state.deviceId=out.deviceId;sessionStorage.setItem('ynx-ai-token',out.token);sessionStorage.setItem('ynx-ai-account',out.account);sessionStorage.setItem('ynx-ai-device',out.deviceId);sessionStorage.removeItem(signoutNoticeKey);await enterApp()}catch(error){if(!state.signingOut)$('#auth-error').textContent=error.message}});
let restoreTask=null;
function enterApp(){if(state.signingOut||!state.token)return Promise.resolve();if(!restoreTask)restoreTask=restoreSession().finally(()=>{restoreTask=null});return restoreTask}
async function restoreSession(){
 $('#app').classList.add('hidden');$('#signin').classList.remove('hidden');
 $('#challenge-form').classList.add('hidden');$('#proof-step').classList.add('hidden');
 $('#session-recovery').classList.remove('hidden');$('#session-retry').disabled=true;
 $('#session-recovery-status').textContent='Checking your existing session. No new wallet authorization is requested.';
 try{
  const session=await api('/api/auth/session');
  if(state.signingOut)return;
  if(session.account!==state.account||session.deviceId!==state.deviceId){const error=new Error('AI session identity changed.');error.status=401;throw error}
  $('#session-recovery').classList.add('hidden');$('#signin').classList.add('hidden');$('#app').classList.remove('hidden');
  $('#account-label').textContent=session.account;
  const results=await Promise.allSettled([loadConversations(),loadProvider(),loadPrivacy()]);
  if(!state.signingOut&&results.some(result=>result.status==='rejected'))toast('Your session is active. Some workspace data could not be loaded; retry without signing in again.');
 }catch(error){
  if(state.signingOut)return;
  if(error.status===401){clearAISession();sessionStorage.setItem(signoutNoticeKey,'expired');showSignoutNotice();$('#session-recovery').classList.add('hidden');$('#challenge-form').classList.remove('hidden')}
  else $('#session-recovery-status').textContent='Your session could not be checked. Retry when the service is available; your saved session has been kept. No new wallet authorization was requested.';
 }finally{if(!state.signingOut)$('#session-retry').disabled=false}
}
$('#session-retry').addEventListener('click',()=>enterApp());
async function signOut(){
 if(state.signingOut)return;
 state.signingOut=true;
 const token=state.token,deviceId=state.deviceId;
 sessionStorage.setItem(signoutNoticeKey,'unconfirmed');
 clearAISession();
 $('#signout').disabled=true;
 $('#session-signout').disabled=true;
 $('#session-recovery').classList.add('hidden');
 $('#app').classList.add('hidden');
 $('#signin').classList.remove('hidden');
 $('#challenge-form').inert=true;
 $('#verify-form').inert=true;
 if($('#modal').open)$('#modal').close();
 showSignoutNotice();
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),8000);
 try{
  if(token){const response=await fetch('/api/auth/revoke',{method:'POST',signal:controller.signal,redirect:'error',headers:{Authorization:`Bearer ${token}`,'X-YNX-Device-ID':deviceId}});if(response.status===204)sessionStorage.setItem(signoutNoticeKey,'revoked')}
 }catch{/* Local sign-out is complete; the server result remains unconfirmed. */}
 finally{clearTimeout(timer);clearAISession();showSignoutNotice();location.reload()}
}
$('#signout').addEventListener('click',signOut);
$('#session-signout').addEventListener('click',signOut);

async function loadConversations(){const query=$('#conversation-search')?.value?.trim()||'';const data=await api(`/api/conversations?archived=${state.archived}&q=${encodeURIComponent(query)}`);state.conversations=data.conversations;renderConversationList();if(!state.conversationId&&state.conversations.length)await selectConversation(state.conversations[0].id)}
$('#conversation-search').addEventListener('input',()=>{void loadConversations().catch(error=>toast(error.message))});
function renderConversationList(){const list=$('#conversation-list');if(!state.conversations.length){list.innerHTML=`<p class="cost-line">${state.archived?'No archived conversations.':'No conversations yet.'}</p>`;return}list.innerHTML=state.conversations.map(c=>`<button class="conversation-item ${c.id===state.conversationId?'active':''}" data-id="${c.id}"><strong>${escapeHTML(c.title)}</strong><small>${escapeHTML(c.lastPreview||`${c.messageCount} messages`)}</small></button>`).join('');$$('.conversation-item').forEach(b=>b.onclick=()=>selectConversation(b.dataset.id))}
async function selectConversation(id){const data=await api(`/api/conversations/${encodeURIComponent(id)}`);state.conversationId=id;state.conversationArchived=data.conversation.archived;$('#conversation-title').textContent=data.conversation.title;$('#conversation-kicker').textContent=`${data.conversation.messageCount} messages · ${data.conversation.retentionDays} day retention`;$('#conversation-actions').classList.remove('hidden');$('#archive-conversation').textContent=data.conversation.archived?'Unarchive':'Archive';renderMessages(data.messages);renderConversationList();if(matchMedia('(max-width: 900px)').matches)document.querySelector('.sessions').classList.remove('open')}
function renderMessages(messages){$('#empty-state').classList.toggle('hidden',messages.length>0);const node=$('#messages');node.innerHTML=messages.map(messageHTML).join('');node.scrollTop=node.scrollHeight}
function messageHTML(m){const label=m.role==='assistant'?'YNX AI':'You';const money=m.cost?.moneyKnown?`$${m.cost.moneyUsdEstimate.toFixed(6)} est.`:'money unknown';const cost=m.role==='assistant'?`<span class="cost-line">~${m.cost.inputTokensEstimate+m.cost.outputTokensEstimate} tokens · ${m.cost.resourceUnitsEstimate} resource · ${money} · actual usage not reported</span>`:'';return `<article class="message" data-message="${m.id}"><div class="message-head"><strong>${label}</strong>${cost}</div><div class="message-body">${escapeHTML(m.content)}</div><div class="message-actions"><button class="text-button copy" type="button">Copy</button>${m.role==='assistant'?'<button class="text-button retry" type="button">Retry</button><button class="text-button continue" type="button">Continue</button>':''}</div></article>`}
$('#messages').addEventListener('click',event=>{const article=event.target.closest('.message');if(!article)return;if(event.target.classList.contains('copy')){navigator.clipboard.writeText(article.querySelector('.message-body').textContent);toast('Copied')}if(event.target.classList.contains('retry'))sendPrompt(state.lastPrompt||article.previousElementSibling?.querySelector('.message-body')?.textContent||'',article.dataset.message);if(event.target.classList.contains('continue'))sendPrompt('','',article.dataset.message)});
$('#new-conversation').onclick=async()=>{const out=await api('/api/conversations',{method:'POST',body:JSON.stringify({title:'New conversation'})});state.conversationId=out.id;await loadConversations();await selectConversation(out.id);$('#prompt').focus()};
$$('.session-tabs button').forEach(button=>button.onclick=async()=>{$$('.session-tabs button').forEach(b=>b.classList.remove('active'));button.classList.add('active');state.archived=button.dataset.archive==='true';state.conversationId='';await loadConversations()});
$('#rename-conversation').onclick=()=>openModal('Rename conversation','<label>Title<input name="title" required maxlength="120"></label>',async data=>{await api(`/api/conversations/${encodeURIComponent(state.conversationId)}`,{method:'PATCH',body:JSON.stringify({title:data.title})});await selectConversation(state.conversationId);await loadConversations();toast('Conversation renamed')});
$('#branch-conversation').onclick=async()=>{const last=$$('#messages .message').at(-1)?.dataset.message||'';const branch=await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/branch`,{method:'POST',body:JSON.stringify({throughMessageId:last,title:`${$('#conversation-title').textContent} — branch`})});state.conversationId=branch.id;await loadConversations();await selectConversation(branch.id);toast('Independent encrypted branch created')};
$('#archive-conversation').onclick=async()=>{const wasArchived=state.conversationArchived;await api(`/api/conversations/${encodeURIComponent(state.conversationId)}`,{method:'PATCH',body:JSON.stringify({archived:!wasArchived})});state.conversationId='';$('#conversation-actions').classList.add('hidden');await loadConversations();toast(wasArchived?'Conversation unarchived':'Conversation archived')};
$('#delete-conversation').onclick=()=>openModal('Delete conversation','<p>This removes encrypted content and metadata. Type <strong>delete</strong> to confirm.</p><label>Confirmation<input name="confirmation" required></label>',async data=>{if(data.confirmation!=='delete')throw new Error('Exact confirmation is required');await api(`/api/conversations/${encodeURIComponent(state.conversationId)}?confirm=delete`,{method:'DELETE'});state.conversationId='';$('#conversation-actions').classList.add('hidden');await loadConversations();toast('Conversation deleted')});
$('#export-conversation').onclick=async()=>{const response=await fetch(`/api/conversations/${encodeURIComponent(state.conversationId)}/export`,{headers:{Authorization:`Bearer ${state.token}`,'X-YNX-Device-ID':state.deviceId}});if(!response.ok){toast('Export failed');return}const blob=await response.blob(),href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='ynx-ai-conversation.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000)};

$('#prompt').addEventListener('input',event=>{event.target.style.height='auto';event.target.style.height=Math.min(event.target.scrollHeight,180)+'px';const tokens=Math.ceil([...event.target.value].length/4);$('#estimate').textContent=`~${tokens} input tokens · ~${Math.ceil(tokens/1000)} resource · money/quota unknown`});
$('#context-details').onclick=()=>$('#exclusion-row').classList.toggle('hidden');
$('#composer').addEventListener('submit',event=>{event.preventDefault();sendPrompt($('#prompt').value)});
async function sendPrompt(prompt,retryOf='',continueFrom=''){
 prompt=prompt.trim();
 if(state.signingOut||!state.token||(!prompt&&!continueFrom)||state.generationId)return;
 const generationId=crypto.randomUUID(),controller=new AbortController();
 let conversationId=state.conversationId;
 const included=$$('.context-strip input:checked').map(n=>n.value),excluded=$$('.exclusion-row input:checked').map(n=>n.value);
 const provider=state.provider?.provider||'',model=state.provider?.model||'';
 state.generationId=generationId;state.abort=controller;
 $('#cancel-generation').classList.remove('hidden');
 try{
  if(!conversationId){
   const conversation=await api('/api/conversations',{method:'POST',signal:controller.signal,body:JSON.stringify({title:prompt.slice(0,64)})});
   if(controller.signal.aborted||state.signingOut)return;
   conversationId=conversation.id;
   if(!state.conversationId)state.conversationId=conversationId;
  }
  if(controller.signal.aborted||state.signingOut)return;
  if(prompt)state.lastPrompt=prompt;
  if($('#prompt').value.trim()===prompt)$('#prompt').value='';
  if(state.conversationId===conversationId){
   $('#empty-state').classList.add('hidden');
   const messages=$('#messages');
   messages.insertAdjacentHTML('beforeend',(prompt?messageHTML({id:'local-user',role:'user',content:prompt,cost:{}}):'')+'<article id="streaming-message" class="message streaming"><div class="message-head"><strong>YNX AI</strong><span class="cost-line">provider-backed stream pending</span></div><div class="message-body"></div></article>');
   messages.scrollTop=messages.scrollHeight;
  }
  const response=await fetch('/api/conversations/'+encodeURIComponent(conversationId)+'/generate',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token,'X-YNX-Device-ID':state.deviceId},body:JSON.stringify({generationId,prompt,continueFrom,provider,model,includedContext:included,excludedContext:excluded,retryOf})});
  if(controller.signal.aborted||state.signingOut)return;
  if(!response.ok){const data=await response.json();throw new Error(data.error||'Generation failed')}
  await consumeSSE(response.body,()=>!state.signingOut&&state.generationId===generationId&&state.conversationId===conversationId);
 }catch(error){
  if(!state.signingOut&&state.conversationId===conversationId){
   const body=$('#streaming-message .message-body');
   if(body)body.textContent=controller.signal.aborted?'Generation cancelled. You can retry safely.':error.message;
   if(!$('#prompt').value&&prompt)$('#prompt').value=prompt;
   toast(controller.signal.aborted?'Generation cancelled.':'Generation did not complete. Your prompt is available to retry.');
  }
 }finally{
  if(state.generationId===generationId){state.generationId='';state.abort=null}
  $('#cancel-generation').classList.add('hidden');
  if(!state.signingOut){
   $('#streaming-message')?.classList.remove('streaming');
   try{await loadConversations();if(conversationId&&state.conversationId===conversationId)await selectConversation(conversationId)}catch{toast('Could not refresh the conversation. Your session is still available.')}
  }
 }
}
async function consumeSSE(body,visible=()=>true){
 if(!body)throw new Error('Provider response had no stream; no completion was claimed.');
 const reader=body.getReader(),decoder=new TextDecoder();
 let buffer='',terminal=false;
 const deliver=block=>{
  let event='',data='';
  for(const line of block.split(/\r?\n/)){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data+=(data?'\n':'')+line.slice(5).trimStart()}
  if(!data||terminal)return;
  const payload=JSON.parse(data);
  if(event==='token'){
   if(typeof payload.text!=='string')throw new Error('Provider stream contained an invalid token.');
   if(visible()){const node=$('#streaming-message .message-body');if(node)node.textContent+=payload.text;$('#messages').scrollTop=$('#messages').scrollHeight}
  }
  if(event==='error'){terminal=true;throw new Error(payload.error||'Provider generation failed.')}
  if(event==='done'){terminal=true;if(visible())toast('Provider-backed response stored with encrypted policy')}
 };
 try{
  while(!terminal){
   const {done,value}=await reader.read();
   buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
   let match=buffer.match(/\r?\n\r?\n/);
   while(match&&match.index!==undefined&&!terminal){deliver(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);match=buffer.match(/\r?\n\r?\n/)}
   if(buffer.length>1048576)throw new Error('Provider stream event exceeded the size limit.');
   if(done){if(buffer.trim()&&!terminal)deliver(buffer);break}
  }
  if(!terminal)throw new Error('Provider stream ended without a terminal event; no completion was claimed.');
 }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
$('#cancel-generation').onclick=async()=>{if(!state.generationId)return;try{await api(`/api/generations/${encodeURIComponent(state.generationId)}/cancel`,{method:'POST'})}catch{}state.abort?.abort()};

async function loadProvider(){try{state.provider=await api('/api/provider');$('#provider-dot').classList.remove('offline');$('#provider-label').textContent=state.provider.provider||'Provider available';$('#model-label').textContent=`${state.provider.model||'configured model'} · quota unknown`}catch(error){state.provider={available:false};$('#provider-dot').classList.add('offline');$('#provider-label').textContent='Provider unavailable';$('#model-label').textContent='No substitute answers';}}

$$('.rail-button[data-panel]').forEach(button=>button.onclick=async()=>{$$('.rail-button').forEach(b=>b.classList.remove('active'));button.classList.add('active');$$('.panel').forEach(p=>p.classList.remove('active'));$(`#${button.dataset.panel}-panel`).classList.add('active');const sessions=document.querySelector('.sessions');if(button.dataset.panel==='chat'&&matchMedia('(max-width: 900px)').matches)sessions.classList.toggle('open');else sessions.classList.remove('open');if(button.dataset.panel==='review')await loadReviews();if(button.dataset.panel==='control')await loadPrivacy();if(button.dataset.panel==='audit')await loadAudit()});
async function loadReviews(){const [actions,permissions]=await Promise.all([api('/api/actions'),api('/api/permissions')]);$('#action-list').innerHTML=actions.actions.length?actions.actions.map(a=>`<article class="review-card"><header><div><strong>${escapeHTML(a.kind.replace('_',' '))}</strong><p>${escapeHTML(a.description)}</p></div><span class="badge">${escapeHTML(a.status)}</span></header><p><strong>Target:</strong> ${escapeHTML(a.target)} · <strong>Risk:</strong> ${escapeHTML(a.risk)} · <strong>Provider:</strong> ${escapeHTML(a.provider||'not reported')}</p><p><strong>Scope:</strong> ${escapeHTML(a.scope)}${a.walletStillNeeded?' · Wallet signature still required':''}</p><pre class="payload-preview">${escapeHTML(a.payloadPreview)}</pre><p><strong>Evidence:</strong> ${(a.evidence||[]).map(escapeHTML).join(' · ')||'none supplied'}</p>${a.status==='pending_review'?`<div class="review-actions"><button class="primary small review-approve" data-id="${a.id}">Approve review</button><button class="danger review-reject" data-id="${a.id}">Reject</button></div>`:''}</article>`).join(''):'<p class="cost-line">No tool or action proposals.</p>';$('#permission-list').innerHTML=permissions.permissions.length?permissions.permissions.map(p=>`<article class="review-card"><strong>${escapeHTML(p.scope)}</strong><p>${escapeHTML(p.purpose)} · ${escapeHTML(p.status)}</p><small>${new Date(p.expiresAt).toLocaleString()}</small></article>`).join(''):'<p class="cost-line">No permissions granted.</p>';$$('.review-approve').forEach(b=>b.onclick=()=>reviewAction(b.dataset.id,'approve',permissions.permissions));$$('.review-reject').forEach(b=>b.onclick=()=>reviewAction(b.dataset.id,'reject',permissions.permissions))}
$('#new-action').onclick=()=>openModal('Create explicit review',`<label>Kind<select name="kind"><option value="tool">Tool</option><option value="action">Product action</option><option value="chain_action">Chain action</option></select></label><label>Scope<input name="scope" required placeholder="read:selected_chain_record"></label><label>Target<input name="target" required placeholder="record:exact-id"></label><label>Risk<select name="risk"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Description<textarea name="description" required></textarea></label><label>Exact payload preview<textarea name="payloadPreview" required></textarea></label><label>Evidence references (one per line)<textarea name="evidence"></textarea></label><label>Provider<input name="provider" placeholder="YNX AI Gateway"></label>`,async data=>{data.evidence=data.evidence.split('\n').map(v=>v.trim()).filter(Boolean);await api('/api/actions',{method:'POST',body:JSON.stringify({...data,conversationId:state.conversationId||'standalone-review'})});await loadReviews();toast('Proposal created; nothing executed')});
function reviewAction(id,decision,permissions){const options=permissions.filter(p=>p.status==='active').map(p=>`<option value="${p.gatewayId}">${escapeHTML(p.scope)} · ${escapeHTML(p.purpose)}</option>`).join('');openModal(decision==='approve'?'Approve review, not execution':'Reject action',decision==='approve'?`<div class="boundary-banner"><strong>This will not execute the action.</strong> Chain actions still stop at YNX Wallet.</div><label>Explicit permission<select name="permissionGatewayId" required>${options}</select></label>`:'<p>Reject this proposal and preserve the audit record?</p>',async data=>{await api(`/api/actions/${id}/review`,{method:'POST',body:JSON.stringify({decision,...data})});await loadReviews();toast(decision==='approve'?'Approved, not executed':'Rejected')})}

async function loadPrivacy(){if(!state.token)return;try{const data=await api('/api/privacy');$('#retention').value=String(data.policy.retentionDays);$('#save-body').checked=data.policy.saveEncryptedBody;$$('.policy-context').forEach(n=>n.checked=data.policy.allowedContextTypes.includes(n.value))}catch{}}
$('#privacy-form').onsubmit=async event=>{event.preventDefault();await api('/api/privacy',{method:'PUT',body:JSON.stringify({retentionDays:Number($('#retention').value),saveEncryptedBody:$('#save-body').checked,allowedContextTypes:$$('.policy-context:checked').map(n=>n.value)})});toast('Data policy saved')};
$('#delete-all').onclick=()=>openModal('Delete all YNX AI data','<p>This cannot be undone. Type <strong>delete-all</strong> to remove local product data.</p><label>Confirmation<input name="confirmation" required></label>',async data=>{if(data.confirmation!=='delete-all')throw new Error('Exact confirmation is required');await api('/api/privacy/data?confirm=delete-all',{method:'DELETE'});state.conversationId='';await loadConversations();toast('All local YNX AI data deleted')});

async function loadAudit(){const [usage,audit,appeals]=await Promise.all([api('/api/usage'),api('/api/audit'),api('/api/appeals')]);const u=usage.usage;$('#usage-cards').innerHTML=[['Generations',u.generations],['Tokens',`~${u.inputTokensEstimate+u.outputTokensEstimate}`],['Resource',`~${u.resourceUnitsEstimate}`],['Money',u.moneyKnown?`$${u.moneyUsdEstimate.toFixed(6)}`:'Unknown']].map(([label,value])=>`<div class="usage-card"><strong>${value}</strong><small>${label}${label==='Tokens'||label==='Resource'?' estimate':''}</small></div>`).join('');$('#audit-list').innerHTML=audit.audit.slice().reverse().map(a=>`<div class="audit-row"><strong>${escapeHTML(a.type)}</strong><span>${escapeHTML(a.detail)}</span><small>#${a.sequence} · ${escapeHTML(a.hash.slice(0,8))}</small></div>`).join('')||'<p class="cost-line">No audit events.</p>';$('#appeal-list').innerHTML=appeals.appeals.map(a=>`<article class="review-card"><strong>${escapeHTML(a.status)}</strong><p>${escapeHTML(a.reason)}</p><a href="${escapeHTML(a.trustUrl)}" target="_blank" rel="noreferrer">Open Trust Center</a></article>`).join('')||'<p class="cost-line">No appeals.</p>'}
$('#new-appeal').onclick=()=>openModal('Submit Trust appeal','<label>Reason<textarea name="reason" required maxlength="1000" placeholder="Describe the disputed result or review outcome"></textarea></label>',async data=>{await api('/api/appeals',{method:'POST',body:JSON.stringify({...data,conversationId:state.conversationId})});await loadAudit();toast('Appeal recorded for Trust review')});

function openModal(title,body,onSubmit){$('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#modal-error').textContent='';const modal=$('#modal');const form=$('#modal-form');form.onsubmit=async event=>{event.preventDefault();if(event.submitter?.value==='cancel'){modal.close();return}const data=Object.fromEntries(new FormData(form));try{await onSubmit(data);modal.close()}catch(error){$('#modal-error').textContent=error.message}};modal.showModal()}

if(state.token)enterApp();
else {showSignoutNotice();loadPublicStatus()}
