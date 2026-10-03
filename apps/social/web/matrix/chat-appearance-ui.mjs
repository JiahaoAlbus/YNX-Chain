import {ChatAppearanceStore,chatBackgrounds,chatCanvas,defaultChatAppearance,effectiveChatBackground} from '../../src/chatAppearance.ts';

// Browser-only local preferences. No API, bearer token, image URL or file path
// is sent to Social/Matrix/Wallet; IndexedDB commits are the durable boundary.
export function mountChatAppearance(root){
 const doc=root.ownerDocument,win=doc.defaultView;
 let database,epoch=0,scope=null,unsubscribe,displayUrl=null,previewUrl=null,editor=null,busy=false,requestedAccount,requestedRoom,paintRevision=0,previewRevision=0;
 const system=win.matchMedia('(prefers-color-scheme:dark)');
 const node=(tag,text)=>{const element=doc.createElement(tag);if(text!==undefined)element.textContent=text;return element};
 const digest=async text=>Array.from(new Uint8Array(await win.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
 function openDatabase(){
  if(database)return database;
  database=new Promise((resolve,reject)=>{
   const request=win.indexedDB.open('ynx-social-chat-appearance-v1',1);let finished=false;
   const deadline=win.setTimeout(()=>{if(!finished){finished=true;reject(Error('LOCAL_STORAGE_UNAVAILABLE'))}},5000);
   request.onupgradeneeded=()=>{request.result.createObjectStore('settings');request.result.createObjectStore('images')};
   request.onsuccess=()=>{win.clearTimeout(deadline);if(finished){request.result.close();return}finished=true;resolve(request.result)};
   request.onerror=()=>{win.clearTimeout(deadline);finished=true;reject(Error('LOCAL_STORAGE_UNAVAILABLE'))};
  }).catch(error=>{database=null;throw error});return database;
 }
 async function storage(bucket,key,value,writing=false){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
   const transaction=db.transaction(bucket,writing?'readwrite':'readonly'),store=transaction.objectStore(bucket);
   let result;const request=writing?(value===undefined?store.delete(key):store.put(value,key)):store.get(key);
   request.onsuccess=()=>{result=request.result};
   transaction.oncomplete=()=>resolve(result??null);
   transaction.onerror=transaction.onabort=()=>reject(Error('LOCAL_STORAGE_UNAVAILABLE'));
  });
 }
 const store=new ChatAppearanceStore({read:async slot=>{const raw=await storage('settings',slot);if(raw!==null&&typeof raw!=='string')throw Error('LOCAL_STORAGE_INVALID');return raw},write:async(slot,raw)=>{await storage('settings',slot,raw,true)}});
 const timeline=root.querySelector('[data-messages]');
 const globalButton=node('button','Chat appearance and background');globalButton.type='button';globalButton.className='chat-appearance-entry';
 const roomButton=node('button','Background');roomButton.type='button';roomButton.setAttribute('aria-label','Conversation background');roomButton.disabled=true;
 root.querySelector('.chat-conversation-header')?.append(roomButton);
 doc.querySelector('.social-appearance')?.after(globalButton);
 // Product shell may run after this module; fallback stays in its real Settings root.
 if(!globalButton.isConnected)doc.querySelector('#social-workspace')?.prepend(globalButton);
 const notice=node('p');notice.className='chat-appearance-notice';notice.setAttribute('role','status');globalButton.after(notice);
 const dialog=node('dialog');dialog.className='chat-appearance-dialog';
 const form=node('div'),header=node('div'),title=node('h2'),cancel=node('button','Cancel'),help=node('p','Images stay on this device. Social does not upload your background or share its original file path.');
 header.className='chat-appearance-header';cancel.type='button';cancel.setAttribute('aria-label','Cancel background changes');header.append(title,cancel);
 const themes=node('div'),preview=node('div'),choices=node('div'),inherit=node('button','Use global default'),pickLabel=node('label','Choose image from this device'),input=node('input'),reset=node('button'),error=node('p'),confirm=node('button','Confirm background');
 themes.className=choices.className='chat-appearance-options';preview.className='chat-appearance-preview';preview.setAttribute('aria-label','Background preview');
 const example=node('p','Preview only. Your conversations are unchanged.'),reply=node('p','Readable text on every background.');reply.className='own';preview.append(example,reply);
 input.type='file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('aria-label','Choose local background image');pickLabel.className='chat-appearance-file';pickLabel.append(input);
 inherit.type=reset.type=confirm.type='button';confirm.className='chat-appearance-confirm';error.className='chat-appearance-error';error.setAttribute('role','alert');
 // A native modal must not inherit the hidden Chats route when opened from
 // Settings. Keeping it under body avoids an inert, visually blank page.
 form.append(header,help,themes,preview,inherit,choices,pickLabel,reset,error,confirm);dialog.append(form);doc.body.append(dialog);
 const staged=new Set();
 const imageKey=(slot,id)=>JSON.stringify([slot,id]);
 function releaseUrl(name){if(name==='display'&&displayUrl){win.URL.revokeObjectURL(displayUrl);displayUrl=null}if(name==='preview'&&previewUrl){win.URL.revokeObjectURL(previewUrl);previewUrl=null}}
 async function discardStaged(retained){const entries=[...staged];staged.clear();for(const entry of entries)if(entry.id!==retained)try{await storage('images',imageKey(entry.slot,entry.id),undefined,true)}catch{/* Only our new local copy; original file is never touched. */}}
 function current(view){return scope===view.scope&&epoch===view.epoch}
 function close(){if(busy)return;dialog.close();editor=null;releaseUrl('preview');void discardStaged();input.value='';error.textContent='';globalButton.focus()}
 cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
 async function apply(){
  const expected=scope,revision=epoch,painting=++paintRevision;releaseUrl('display');
  const value=scope?.value??defaultChatAppearance(),background=effectiveChatBackground(value,scope?.roomSlot);
  timeline.style.backgroundColor=chatCanvas(background,value.theme,system.matches);timeline.style.backgroundImage='none';
  if(background.kind!=='image'||!expected)return;
  try{const blob=await storage('images',imageKey(expected.slot,background.id));if(scope!==expected||epoch!==revision||paintRevision!==painting)return;
   if(!(blob instanceof win.Blob)){notice.textContent='The saved local image is unavailable. Choose another image or reset the background.';return}
   displayUrl=win.URL.createObjectURL(blob);timeline.style.backgroundImage=`linear-gradient(${value.theme==='dark'||(value.theme==='system'&&system.matches)?'rgba(10,22,35,.42),rgba(10,22,35,.42)':'rgba(255,255,255,.2),rgba(255,255,255,.2)'}),url("${displayUrl}")`;
  }catch{if(scope===expected)notice.textContent='Local background could not be read. Your previous settings are retained.'}
 }
 async function renderPreview(){
  const review=editor,painting=++previewRevision;if(!review)return;releaseUrl('preview');
  const background=review.candidate??review.scope.value.background,dark=review.theme==='dark'||(review.theme==='system'&&system.matches);
  dialog.dataset.theme=dark?'dark':'light';preview.style.backgroundColor=chatCanvas(background,review.theme,system.matches);preview.style.backgroundImage='none';
  for(const button of themes.children)button.setAttribute('aria-checked',String(button.dataset.theme===review.theme));
  for(const button of choices.children)button.setAttribute('aria-checked',String(review.candidate?.kind==='preset'&&review.candidate.preset===button.dataset.preset));
  inherit.setAttribute('aria-checked',String(review.candidate===null));
  if(background.kind==='image')try{const blob=await storage('images',imageKey(review.scope.slot,background.id));if(editor!==review||!current(review)||previewRevision!==painting)return;
   if(!(blob instanceof win.Blob))throw Error('LOCAL_IMAGE_MISSING');previewUrl=win.URL.createObjectURL(blob);preview.style.backgroundImage=`url("${previewUrl}")`;
  }catch{if(editor===review)error.textContent='The local image is unavailable. Choose another image or reset.'}
 }
 function begin(room){
  if(!scope){notice.textContent='Local appearance storage is unavailable. Try opening settings again.';void setScope(requestedAccount??null,requestedRoom??null);return}
  if(room&&!scope.roomSlot)return;
  editor={scope,epoch,room:room?scope.roomSlot:null,candidate:room?scope.value.rooms[scope.roomSlot]??null:scope.value.background,theme:scope.value.theme};
  title.textContent=room?'Conversation background':'Chat appearance';reset.textContent=room?'Reset to global default':'Reset global background and theme';
  inherit.hidden=!room;themes.hidden=room;error.textContent='';dialog.showModal();void renderPreview();
 }
 globalButton.onclick=()=>begin(false);roomButton.onclick=()=>begin(true);
 for(const theme of ['system','light','dark']){const button=node('button',theme[0].toUpperCase()+theme.slice(1));button.type='button';button.dataset.theme=theme;button.setAttribute('role','radio');button.setAttribute('aria-label','Chat theme '+theme);button.onclick=()=>{if(editor&&!busy){editor.theme=theme;void renderPreview()}};themes.append(button)}
 for(const preset of chatBackgrounds){const button=node('button',preset);button.type='button';button.dataset.preset=preset;button.setAttribute('role','radio');button.setAttribute('aria-label','Background '+preset);button.style.backgroundColor=chatCanvas({kind:'preset',preset},'light');button.onclick=()=>{if(editor&&!busy){editor.candidate={kind:'preset',preset};void renderPreview()}};choices.append(button)}
 inherit.setAttribute('role','radio');inherit.onclick=()=>{if(editor&&!busy){editor.candidate=null;void renderPreview()}};
 reset.onclick=()=>{if(editor&&!busy){editor.candidate=editor.room?null:{kind:'preset',preset:'mist'};if(!editor.room)editor.theme='system';void renderPreview()}};
 function setBusy(value){busy=value;for(const button of dialog.querySelectorAll('button,input'))button.disabled=value;dialog.setAttribute('aria-busy',String(value))}
 input.onchange=async()=>{
  const review=editor,file=input.files?.[0];if(!review||!file||busy)return;setBusy(true);error.textContent='';let bitmap;
  try{
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<=0||file.size>8*1024*1024)throw Error('LOCAL_IMAGE_LIMIT');
   bitmap=await win.createImageBitmap(file);if(!current(review)||editor!==review)return;
   if(bitmap.width>8192||bitmap.height>8192)throw Error('LOCAL_IMAGE_DIMENSIONS');
   const canvas=node('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
   const context=canvas.getContext('2d');if(!context)throw Error('LOCAL_IMAGE_UNAVAILABLE');context.drawImage(bitmap,0,0);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.size>8*1024*1024)throw Error('LOCAL_IMAGE_LIMIT');
   if(!current(review)||editor!==review)return;
   const id=Array.from(win.crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
   const entry={slot:review.scope.slot,id};staged.add(entry);await storage('images',imageKey(entry.slot,id),blob,true);
   if(!current(review)||editor!==review){await storage('images',imageKey(entry.slot,id),undefined,true);staged.delete(entry);return}
   review.candidate={kind:'image',id};await renderPreview();
  }catch{if(editor===review)error.textContent='Choose a JPEG, PNG or WebP image up to 8 MB. Your current background has not changed.'}
  finally{bitmap?.close();if(editor===review){input.value='';setBusy(false)}}
 };
 confirm.onclick=async()=>{
  const review=editor;if(!review||busy||!current(review))return;setBusy(true);error.textContent='';
  const candidate=review.candidate;
  // Retain a possibly committed original-slot copy across a scope change.
  if(candidate?.kind==='image')for(const entry of staged)if(entry.id===candidate.id)staged.delete(entry);
  try{await store.save(review.scope.slot,{room:review.room,background:candidate,...(review.room?{}:{theme:review.theme})},()=>editor===review&&current(review));
   if(editor===review&&current(review)){await discardStaged(candidate?.kind==='image'?candidate.id:undefined);if(editor===review&&current(review)){setBusy(false);close()}}
  }catch{if(editor===review&&current(review))error.textContent='Background was not confirmed as saved. The previous setting is retained; retry or cancel.'}
  finally{if(editor===review)setBusy(false)}
 };
 async function setScope(account,room){
  if(account===requestedAccount&&room===requestedRoom&&scope)return;
  requestedAccount=account;requestedRoom=room;
  const revision=++epoch;scope=null;unsubscribe?.();unsubscribe=null;
  if(dialog.open)dialog.close();editor=null;setBusy(false);releaseUrl('preview');void discardStaged();roomButton.disabled=true;notice.textContent='';void apply();
  try{const slot=account?'a_'+await digest(account):'guest',roomSlot=account&&room?'r_'+await digest(room):null;
   if(epoch!==revision)return;await store.open(slot);if(epoch!==revision)return;
   scope={slot,roomSlot,value:store.snapshot(slot)};const expected=scope;
   unsubscribe=store.subscribe(slot,()=>{if(scope===expected){scope.value=store.snapshot(slot);void apply()}});roomButton.disabled=!roomSlot;void apply();
  }catch{if(epoch===revision)notice.textContent='Local appearance storage is unavailable. Previous settings are retained; reopen settings to retry.'}
 }
 system.addEventListener('change',()=>{void apply();if(editor)void renderPreview()});
 void setScope(null,null);
 return {setScope,refreshControls:()=>{roomButton.disabled=!scope?.roomSlot}};
}
