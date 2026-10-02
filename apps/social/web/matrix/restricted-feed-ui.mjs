import {recoverIndexedComment} from './restricted-comment-recovery.mjs';
const protocol='ynx-social-matrix-moment/v1';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value};
const snapshot=value=>freeze(structuredClone(value));
const validDecoded=(index,decoded)=>{
  const audience=index?.audience,parent=decoded?.parent,kind=index.parentEventId?'comment':'moment';
  if(audience?.protocol!==protocol||!['contacts','group','selected','private'].includes(audience.kind)||!/^[a-f0-9]{64}$/.test(audience.revision)||typeof audience.owner!=='string'||!audience.owner.startsWith('@')||typeof audience.roomId!=='string'||!audience.roomId.startsWith('!')||!Array.isArray(audience.members)||!audience.members.length||audience.members.length>256||new Set(audience.members).size!==audience.members.length||!audience.members.includes(audience.owner)||audience.members.some(member=>typeof member!=='string'||!member.startsWith('@'))||audience.kind==='private'&&audience.members.length!==1||!/^\$[^\s\x00-\x1f]{1,254}$/.test(index.eventId)||decoded?.eventId!==index.eventId||typeof decoded.text!=='string'||!decoded.text.trim()||decoded.text.length>16000||decoded.protocol!==undefined&&decoded.protocol!==protocol||decoded.kind!==undefined&&decoded.kind!==kind)return false;
  return kind==='comment'?parent===null:parent?.protocol===protocol&&parent.eventId===index.eventId&&parent.roomId===audience.roomId&&parent.revision===audience.revision&&parent.owner===audience.owner;
};
// Caller supplies the original guarded Matrix consumer and existing comment
// publication flow. This view never requests a Wallet grant or creates identity.
export function mountRestrictedFeed({root,consumer,loadIndexes,publishComment,commentDrafts,commentSender,downloadAttachment,capture,assertCurrent}) {
  if(!root||typeof consumer?.read!=='function'||typeof loadIndexes!=='function'||typeof capture!=='function'||typeof assertCurrent!=='function')throw new Error('MATRIX_FEED_CONFIGURATION_REQUIRED');
  const document=root.ownerDocument;
  const section=document.createElement('section'),title=document.createElement('h2');
  title.textContent='Encrypted moments';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh encrypted moments';
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const list=document.createElement('div');
  const recovery=document.createElement('button'),draft=document.createElement('p');
  recovery.type='button';recovery.textContent='Verify original pending comment';recovery.hidden=true;
  section.append(title,refresh,status,draft,recovery,list);root.append(section);
  let epoch=0,locked=false,busy=false,pendingIntent=null;
  const controls=new Set([refresh,recovery]);
  const gate=(generation,binding)=>{if(locked||generation!==epoch)throw new Error('MATRIX_FEED_STALE');assertCurrent(binding)};
  const setBusy=value=>{busy=value;for(const control of controls)control.disabled=locked||busy};
  const clear=()=>{list.replaceChildren();draft.textContent='';recovery.hidden=true;controls.clear();controls.add(refresh);controls.add(recovery)};
  const addComment=(article,index,decoded)=>{
    index=snapshot(index);decoded=snapshot(decoded);
    if(!decoded.parent||typeof publishComment!=='function'||typeof commentSender!=='function'||typeof commentDrafts?.load!=='function'||typeof commentDrafts?.save!=='function'||typeof commentDrafts?.clearConfirmed!=='function')return;
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
        const current=snapshot(await consumer.read(index));gate(generation,binding);
        if(!validDecoded(index,current)||!current.parent||JSON.stringify(current.parent)!==JSON.stringify(decoded.parent))throw new Error('MATRIX_COMMENT_PARENT_CHANGED');
        const existing=await commentDrafts.load(binding);gate(generation,binding);
        if(existing){pendingIntent=existing;throw new Error('MATRIX_COMMENT_RECOVERY_REQUIRED')}
        const author=await commentSender(binding);gate(generation,binding);
        if(typeof author!=='string'||!author.startsWith('@'))throw new Error('MATRIX_COMMENT_IDENTITY_REQUIRED');
        const intent=snapshot({transactionId:document.defaultView.crypto.randomUUID(),text,selection:{kind:index.audience.kind},status:'delivery-unknown',file:null,comment:{author,index:structuredClone(index),parent:structuredClone(current.parent)}});
        // Reserve before the storage await. Even uncertain storage completion
        // must not permit a replacement intent; no Matrix send precedes save.
        pendingIntent=intent;
        await commentDrafts.save(intent,binding);gate(generation,binding);
        uncertain=true;
        await publishComment({index,parent:current.parent,text,transactionId:intent.transactionId,binding});gate(generation,binding);
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
      if(commentDrafts?.load){const stored=await commentDrafts.load(binding);gate(generation,binding);if(stored&&pendingIntent&&JSON.stringify(stored)!==JSON.stringify(pendingIntent))throw new Error('MATRIX_COMMENT_RECOVERY_REQUIRED');pendingIntent=stored?snapshot(stored):pendingIntent}
      const feed=await loadIndexes();gate(generation,binding);
      if(!feed||!Array.isArray(feed.indexes)||feed.indexes.length>40)throw new Error('MATRIX_FEED_INVALID');
      const rendered=[];
      for(const value of feed.indexes){
        const index=snapshot(value),decoded=snapshot(await consumer.read(index));gate(generation,binding);
        if(!validDecoded(index,decoded))throw new Error('MATRIX_FEED_INVALID');
        rendered.push({index,decoded});
      }
      gate(generation,binding);
      for(const {index,decoded} of rendered){
        const article=document.createElement('article'),body=document.createElement('p');
        article.setAttribute('data-event-id',index.eventId);body.textContent=decoded.text;article.append(body);
        if(decoded.attachment){
          const label=document.createElement('p');label.textContent='Encrypted attachment';article.append(label);
          if(typeof downloadAttachment==='function'){
            const originalIndex=snapshot(index),originalAttachment=snapshot(decoded.attachment),download=document.createElement('button');
            download.type='button';download.textContent='Download encrypted attachment';controls.add(download);article.append(download);
            download.addEventListener('click',async()=>{
              if(locked||busy)return;let bytes=null,url=null;setBusy(true);
              try{
                gate(generation,binding);
                bytes=await downloadAttachment({index:originalIndex,attachment:originalAttachment,binding,guard:()=>gate(generation,binding)});
                gate(generation,binding);if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>25*1024*1024)throw new Error('MATRIX_ATTACHMENT_INVALID');
                const browser=document.defaultView;
                url=browser.URL.createObjectURL(new browser.Blob([bytes],{type:'application/octet-stream'}));gate(generation,binding);
                const link=document.createElement('a');link.href=url;link.download=originalAttachment.body.replace(/[\x00-\x1f\x7f/\\]/g,'_');link.click();
                status.textContent='Encrypted attachment verified and downloaded.';
              }catch{if(!locked&&generation===epoch){clear();status.textContent='Encrypted attachment unavailable. No plaintext fallback.'}}
              finally{if(url)document.defaultView.URL.revokeObjectURL(url);if(bytes instanceof ArrayBuffer)new Uint8Array(bytes).fill(0);if(!locked&&generation===epoch)setBusy(false)}
            });
          }
        }
        addComment(article,index,decoded);list.append(article);
      }
      status.textContent=pendingIntent?'Protected intent requires recovery. Original draft retained; do not resend.':rendered.length?'Encrypted moments verified.':'No accessible encrypted moments.';
      if(pendingIntent?.comment){draft.textContent=pendingIntent.text;recovery.hidden=typeof commentSender!=='function'}
    }catch{
      if(!locked&&generation===epoch){clear();status.textContent='Encrypted moments unavailable. No plaintext fallback.'}
    }finally{if(!locked&&generation===epoch){setBusy(false);if(pendingIntent)for(const control of controls)if(control!==refresh&&control!==recovery)control.disabled=true}}
  };
  recovery.addEventListener('click',async()=>{
    if(locked||busy||!pendingIntent?.comment||typeof commentSender!=='function')return;
    const original=pendingIntent,generation=epoch,binding=capture();setBusy(true);
    try{
      gate(generation,binding);
      const expectedSender=await commentSender(binding);gate(generation,binding);
      const receipt=await recoverIndexedComment({intent:original,expectedSender,loadIndexes,consumer,guard:()=>gate(generation,binding),validateIdentity:async()=>{const sender=await commentSender(binding);gate(generation,binding);if(sender!==expectedSender)throw new Error('MATRIX_COMMENT_STALE')}});
      gate(generation,binding);if(pendingIntent!==original)throw new Error('MATRIX_COMMENT_STALE');
      await commentDrafts.clearConfirmed(receipt.transactionId,binding);gate(generation,binding);
      pendingIntent=null;draft.textContent='';recovery.hidden=true;status.textContent='Original encrypted comment confirmed. No resend performed.';
    }catch{if(!locked&&generation===epoch)status.textContent='Original comment not confirmed. Protected intent retained; no resend.'}
    finally{if(!locked&&generation===epoch){setBusy(false);if(pendingIntent)for(const control of controls)if(control!==refresh&&control!==recovery)control.disabled=true}}
  });
  refresh.addEventListener('click',reload);
  return Object.freeze({reload,lock(){locked=true;++epoch;clear();setBusy(false);status.textContent='Encrypted moments locked.'},destroy(){locked=true;++epoch;section.remove()}});
}
