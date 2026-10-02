// Product UI only. Approval never substitutes for homeserver UIA or deletion.
export function createChatConfirmation({container,environment=globalThis,text=key=>key}={}){
 let current=null;
 function close(frame){
  if(current!==frame)return;current=null;frame.signal?.removeEventListener('abort',frame.abort);
  try{frame.dialog.close()}catch{}frame.dialog.remove();
  if(frame.focus?.isConnected)frame.focus.focus?.();
 }
 function cancel(){const frame=current;if(!frame)return;close(frame);frame.resolve?.(false)}
 function make(input){
  cancel();input.guard?.();
  const document=environment.document,dialog=document.createElement('dialog');dialog.className='chat-confirmation';
  dialog.setAttribute('aria-labelledby','chat-confirm-title');
  const mark=document.createElement('div');mark.className='chat-confirm-brand';
  const logo=document.createElement('img');logo.src='/assets/ynx-logo.png';logo.alt='YNX';logo.width=40;logo.height=40;
  const brand=document.createElement('span');brand.textContent='YNX Social';mark.append(logo,brand);
  const heading=document.createElement('h3');heading.id='chat-confirm-title';heading.textContent=input.title;
  const description=document.createElement('p');description.textContent=input.description;
  const context=document.createElement('dl');context.className='chat-confirm-context';
  for(const [key,value] of [['account',input.account],['site',input.site],['device',input.deviceId],['conversation',input.roomId]]){
   if(!value)continue;const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=text(key);detail.textContent=value;context.append(term,detail);
  }
  const actions=document.createElement('div');actions.className='chat-confirm-actions';
  dialog.append(mark,heading,description,context,actions);
  const frame={dialog,actions,focus:document.activeElement,signal:input.signal,guard:input.guard};current=frame;
  container.append(dialog);return frame;
 }
 function button(frame,title,action){const node=environment.document.createElement('button');node.type='button';node.textContent=title;node.onclick=action;frame.actions.append(node);return node}
 function request(input){
  if(current?.resolve)return Promise.reject(Object.assign(new Error('Another confirmation is open'),{code:'CHAT_CONFIRM_BUSY'}));
  if(input.signal?.aborted)return Promise.resolve(false);
  return new Promise((resolve,reject)=>{
   let frame;
   try{
    frame=make(input);frame.resolve=resolve;
    const finish=approved=>{if(current!==frame)return;try{if(approved){if(frame.signal?.aborted)return cancel();frame.guard?.()}close(frame);resolve(approved)}catch(error){close(frame);reject(error)}};
    frame.abort=()=>finish(false);frame.signal?.addEventListener('abort',frame.abort,{once:true});
    const decline=button(frame,text('cancel'),()=>finish(false));decline.className='chat-button-secondary';
    const approve=button(frame,input.approveText??text('remove'),()=>finish(true));approve.className='chat-button-danger';
    frame.dialog.oncancel=event=>{event.preventDefault();finish(false)};frame.dialog.onclose=()=>finish(false);
    if(frame.signal?.aborted){finish(false);return}
    frame.dialog.showModal();decline.focus?.();
   }catch(error){if(frame)close(frame);reject(Object.assign(new Error('Confirmation could not open. No request was sent.'),{code:'CHAT_CONFIRM_UNAVAILABLE'}))}
  });
 }
 function display(input,modal){
  try{
   const frame=make(input);frame.dialog.dataset.phase=modal?'result':'progress';
   const done=button(frame,text(modal?'done':'hide'),()=>close(frame));done.className='chat-button-secondary';
   frame.dialog.oncancel=event=>{event.preventDefault();close(frame)};frame.dialog.onclose=()=>close(frame);
   // Standard UIA controls mount in the workspace. Progress must NOT make that
   // workspace inert; it is a non-modal live panel until real completion.
   if(modal)frame.dialog.showModal();else{frame.dialog.setAttribute('aria-live','polite');frame.dialog.show()}
  }catch{cancel()}
 }
 return {request,cancel,progress:input=>display(input,false),result:input=>display(input,true)};
}
