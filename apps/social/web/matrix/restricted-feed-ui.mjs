// Caller supplies the original guarded Matrix consumer and existing comment
// publication flow. This view never requests a Wallet grant or creates identity.
export function mountRestrictedFeed({root,consumer,loadIndexes,publishComment,commentDrafts,capture,assertCurrent}) {
  if(!root||typeof consumer?.read!=='function'||typeof loadIndexes!=='function'||typeof capture!=='function'||typeof assertCurrent!=='function')throw new Error('MATRIX_FEED_CONFIGURATION_REQUIRED');
  const document=root.ownerDocument;
  const section=document.createElement('section'),title=document.createElement('h2');
  title.textContent='Encrypted moments';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh encrypted moments';
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const list=document.createElement('div');
  section.append(title,refresh,status,list);root.append(section);
  let epoch=0,locked=false,busy=false,pendingIntent=null;
  const controls=new Set([refresh]);
  const gate=(generation,binding)=>{if(locked||generation!==epoch)throw new Error('MATRIX_FEED_STALE');assertCurrent(binding)};
  const setBusy=value=>{busy=value;for(const control of controls)control.disabled=locked||busy};
  const clear=()=>{list.replaceChildren();controls.clear();controls.add(refresh)};
  const addComment=(article,index,decoded)=>{
    if(!decoded.parent||typeof publishComment!=='function'||typeof commentDrafts?.load!=='function'||typeof commentDrafts?.save!=='function'||typeof commentDrafts?.clearConfirmed!=='function')return;
    const form=document.createElement('form'),input=document.createElement('textarea'),button=document.createElement('button');
    input.setAttribute('aria-label','Encrypted comment');input.maxLength=16000;
    button.type='submit';button.textContent='Publish encrypted comment';
    form.append(input,button);article.append(form);controls.add(input);controls.add(button);
    let uncertain=false;
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(locked||busy||uncertain||pendingIntent)return;
      const text=input.value;if(!text.trim()||text.length>16000)return;
      const generation=epoch,binding=capture();setBusy(true);
      try{
        gate(generation,binding);
        // Reauthorize the exact indexed parent, never a DOM-supplied event ID.
        const current=await consumer.read(index);gate(generation,binding);
        if(!current.parent||JSON.stringify(current.parent)!==JSON.stringify(decoded.parent))throw new Error('MATRIX_COMMENT_PARENT_CHANGED');
        const existing=await commentDrafts.load(binding);gate(generation,binding);
        if(existing){pendingIntent=existing;throw new Error('MATRIX_COMMENT_RECOVERY_REQUIRED')}
        const intent={transactionId:document.defaultView.crypto.randomUUID(),text,selection:{kind:index.audience.kind},status:'delivery-unknown',file:null,comment:{index:structuredClone(index),parent:structuredClone(current.parent)}};
        // Reserve before the storage await. Even uncertain storage completion
        // must not permit a replacement intent; no Matrix send precedes save.
        pendingIntent=intent;
        await commentDrafts.save(intent,binding);gate(generation,binding);
        uncertain=true;
        await publishComment({index,parent:current.parent,text,transactionId:intent.transactionId});gate(generation,binding);
        // publishComment must resolve only after the original encrypted event
        // readback/index confirmation, never merely after upload or dispatch.
        await commentDrafts.clearConfirmed(intent.transactionId,binding);gate(generation,binding);
        pendingIntent=null;uncertain=false;input.value='';status.textContent='Encrypted comment confirmed.';
      }catch{
        if(!locked&&generation===epoch)status.textContent=pendingIntent?'Protected intent requires recovery. Original draft retained; do not resend.':'Comment permission could not be verified. Draft retained.';
      }finally{if(!locked&&generation===epoch){setBusy(false);if(uncertain||pendingIntent){input.disabled=true;button.disabled=true}}}
    });
  };
  const reload=async()=>{
    if(locked||busy)return;
    const generation=++epoch,binding=capture();clear();setBusy(true);status.textContent='Checking current permissions...';
    try{
      gate(generation,binding);
      if(commentDrafts?.load){pendingIntent=await commentDrafts.load(binding);gate(generation,binding)}
      const feed=await loadIndexes();gate(generation,binding);
      if(!feed||!Array.isArray(feed.indexes)||feed.indexes.length>40)throw new Error('MATRIX_FEED_INVALID');
      const rendered=[];
      for(const index of feed.indexes){
        const decoded=await consumer.read(index);gate(generation,binding);
        if(typeof decoded?.text!=='string'||decoded.text.length>16000)throw new Error('MATRIX_FEED_INVALID');
        rendered.push({index,decoded});
      }
      gate(generation,binding);
      for(const {index,decoded} of rendered){
        const article=document.createElement('article'),body=document.createElement('p');
        article.setAttribute('data-event-id',index.eventId);body.textContent=decoded.text;article.append(body);
        if(decoded.attachment){const label=document.createElement('p');label.textContent='Encrypted attachment';article.append(label)}
        addComment(article,index,decoded);list.append(article);
      }
      status.textContent=pendingIntent?'Protected intent requires recovery. Original draft retained; do not resend.':rendered.length?'Encrypted moments verified.':'No accessible encrypted moments.';
    }catch{
      if(!locked&&generation===epoch){clear();status.textContent='Encrypted moments unavailable. No plaintext fallback.'}
    }finally{if(!locked&&generation===epoch){setBusy(false);if(pendingIntent)for(const control of controls)if(control!==refresh)control.disabled=true}}
  };
  refresh.addEventListener('click',reload);
  return Object.freeze({reload,lock(){locked=true;++epoch;clear();setBusy(false);status.textContent='Encrypted moments locked.'},destroy(){locked=true;++epoch;section.remove()}});
}
