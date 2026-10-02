import {RestrictedMoments} from './restricted-moments.mjs';
import {RestrictedMomentAttachments} from './restricted-attachments.mjs';

// resolveAudience/authorize must come from an approved integration, not from
// a room picker, follows, user-entered MXID or the chat permission alone.
/** @param {{container:any,transport:any,capture:Function,guard:Function,identity:Function,work:Function,resolveAudience?:Function|null,authorize?:Function|null,loadSelections?:Function|null,approvePublishing?:Function|null}} options */
export function createRestrictedMomentsUI({container,transport,capture,guard,identity,work,
  resolveAudience=null,authorize=null,loadSelections=null,approvePublishing=null}) {
  const document=container.ownerDocument,section=document.createElement('section');
  section.setAttribute('aria-label','Restricted Moments');
  const heading=document.createElement('h2');heading.textContent='Restricted Moments';
  const explanation=document.createElement('p');
  explanation.textContent='New restricted posts use encrypted Matrix rooms. Existing legacy posts are not retroactively encrypted.';
  const status=document.createElement('p');status.setAttribute('aria-live','polite');
  const form=document.createElement('form'),label=document.createElement('label');
  const input=document.createElement('textarea');input.maxLength=16000;input.rows=4;
  input.setAttribute('aria-label','Restricted Moment draft');
  label.textContent='Your post';label.append(input);
  const audienceLabel=document.createElement('label'),choice=document.createElement('select');
  audienceLabel.textContent='Audience';choice.setAttribute('aria-label','Restricted Moment audience');
  for(const [value,title] of [['contacts','Friends'],['group','Group'],['selected','Selected people'],['private','Only my verified devices']]) {
    const option=document.createElement('option');option.value=value;option.textContent=title;choice.append(option);
  }
  audienceLabel.append(choice);
  const selectors=document.createElement('div'),group=document.createElement('select'),people=document.createElement('select');
  group.setAttribute('aria-label','Existing group');people.setAttribute('aria-label','Accepted friends');people.multiple=true;
  selectors.append(group,people);
  const permission=document.createElement('button');permission.type='button';permission.textContent='Review publishing permissions';
  permission.disabled=typeof approvePublishing!=='function';
  const review=document.createElement('button');review.type='button';review.textContent='Review audience';
  const send=document.createElement('button');send.type='submit';send.textContent='Publish reviewed encrypted Moment';
  const fileLabel=document.createElement('label'),fileInput=document.createElement('input'),fileStatus=document.createElement('p');
  fileLabel.textContent='Encrypted attachment (optional, up to 25 MB)';fileInput.type='file';fileInput.setAttribute('aria-label','Restricted Moment attachment');fileLabel.append(fileInput);
  form.append(permission,audienceLabel,selectors,label,fileLabel,fileStatus,review,send);section.append(heading,explanation,status,form);container.append(section);
  const enabled=typeof resolveAudience==='function'&&typeof authorize==='function';
  const consumer=enabled?new RestrictedMoments({transport,authorize}):null;
  const attachments=consumer?new RestrictedMomentAttachments({consumer}):null;
  let reviewed=null,pending=null,visibleBinding=null,selectionRecords=null,selectedFile=null,reviewing=null,editEpoch=0;
  // Drafts remain in this process only. Durable protected recovery is separate.
  const drafts=new Map();
  function remember(){if(visibleBinding)drafts.set(visibleBinding,{text:input.value,file:selectedFile})}
  function refresh(){
    let view;try{view=capture();guard(view)}catch{lock();return}
    if(visibleBinding!==view.operation.binding){remember();visibleBinding=view.operation.binding;const saved=drafts.get(visibleBinding);input.value=saved?.text??'';selectedFile=saved?.file??null;fileInput.value='';reviewed=null;pending=null;selectionRecords=null;group.replaceChildren();people.replaceChildren()}
    group.hidden=choice.value!=='group';people.hidden=choice.value!=='selected';
    const busy=!!pending||!!reviewing;
    choice.disabled=!enabled||busy;group.disabled=!enabled||busy;people.disabled=!enabled||busy;input.disabled=!enabled||busy;review.disabled=!enabled||busy;
    fileInput.disabled=!enabled||busy;fileStatus.textContent=selectedFile?`Retained attachment: ${selectedFile.name}`:'No attachment selected.';
    send.disabled=!enabled||!reviewed||busy;
    if(!enabled)status.textContent='Restricted publishing is not enabled: live audience authorization is not connected. Chat approval does not authorize publishing.';
  }
  function lock(){editEpoch++;reviewing=null;remember();visibleBinding=null;input.value='';selectedFile=null;fileInput.value='';fileStatus.textContent='';fileInput.disabled=true;reviewed=null;pending=null;input.disabled=true;choice.disabled=true;group.disabled=true;people.disabled=true;review.disabled=true;send.disabled=true;status.textContent='Locked. Draft recovery is local to this open workspace; no plaintext was stored on the server.'}
  const invalidate=()=>{editEpoch++;reviewed=null;send.disabled=true;remember();status.textContent='Review the audience and current draft before publishing.'};
  input.addEventListener('input',invalidate);group.addEventListener('change',invalidate);people.addEventListener('change',invalidate);
  fileInput.addEventListener('change',()=>{selectedFile=fileInput.files?.[0]??null;invalidate();refresh()});
  choice.addEventListener('change',()=>{invalidate();refresh();if(['group','selected'].includes(choice.value))void work(async()=>{
    if(typeof loadSelections!=='function')throw new Error('Current friends and groups are unavailable; no manual Matrix identity is accepted');
    const view=capture();await identity(view);guard(view);const records=await loadSelections(view);guard(view);
    selectionRecords=records;group.replaceChildren();people.replaceChildren();
    for(const [node,items] of [[group,records.groups],[people,records.contacts]])for(const item of items){const option=document.createElement('option');option.value=item.id;option.textContent=item.title;node.append(option)}
    status.textContent='Choose from your current friends or existing groups, then review.';
  })});
  permission.onclick=()=>void work(async()=>{if(typeof approvePublishing==='function'){await approvePublishing();refresh()}});
  function selection(){
    const kind=choice.value;
    if(kind==='group'){if(!selectionRecords?.groups.some(item=>item.id===group.value))throw new Error('Choose an existing group first');return {kind,groupId:group.value}}
    if(kind==='selected'){const selected=[...people.selectedOptions].map(option=>option.value).sort();if(!selected.length||selected.some(id=>!selectionRecords?.contacts.some(item=>item.id===id)))throw new Error('Choose accepted friends first');return {kind,selected}}
    return {kind};
  }
  review.onclick=()=>void work(async()=>{
    if(!enabled||reviewing||pending)return;
    const view=capture(),draft=input.value,file=selectedFile,chosen=selection(),transactionId=crypto.randomUUID().replaceAll('-',''),epoch=editEpoch;
    const reviewIntent={view,draft,file,chosen,transactionId,epoch};reviewing=reviewIntent;reviewed=null;refresh();
    const unchanged=()=>{guard(view);if(reviewing!==reviewIntent||editEpoch!==epoch||input.value!==draft||selectedFile!==file||JSON.stringify(selection())!==JSON.stringify(chosen))throw new Error('Draft or audience changed; review again')};
    try{
    unchanged();await identity(view);unchanged();
    const audience=await resolveAudience(chosen);guard(view);
    unchanged();
    const operation=transport.capture();await consumer.check(audience,operation,{action:'read',transactionId});unchanged();
    if(audience.kind!==chosen.kind)throw new Error('Reviewed audience differs from your selection');
    reviewed={view,audience,draft,file,transactionId,chosen,epoch};
    status.textContent=`Reviewed ${chosen.kind}: ${audience.members.length} confirmed identities. Previously received keys cannot be recalled.`;
    }finally{if(reviewing===reviewIntent)reviewing=null;refresh()}
  });
  form.onsubmit=event=>{event.preventDefault();void work(async()=>{
    if(!enabled||!reviewed||pending)return;
    const intent=reviewed;guard(intent.view);
    const unchanged=()=>{guard(intent.view);if(editEpoch!==intent.epoch||input.value!==intent.draft||selectedFile!==intent.file||JSON.stringify(selection())!==JSON.stringify(intent.chosen))throw new Error('Review the changed draft or audience again')};
    unchanged();
    pending=intent;refresh();
    try{
      await identity(intent.view);unchanged();
      let receipt;
      if(intent.file){const bytes=await intent.file.arrayBuffer();unchanged();receipt=await attachments.publish({audience:intent.audience,text:intent.draft,bytes,name:intent.file.name,mimeType:intent.file.type||'application/octet-stream',transactionId:intent.transactionId})}
      else receipt=await consumer.publish({audience:intent.audience,text:intent.draft,transactionId:intent.transactionId});guard(intent.view);
      if(reviewed===intent){input.value='';selectedFile=null;fileInput.value='';remember();reviewed=null;status.textContent=`Encrypted Moment sent and authorized index confirmed: ${receipt.eventId}.`}
    }catch(error){
      // Delivery may have occurred: preserve the reviewed transaction and note.
      if(visibleBinding===intent.view.operation.binding)status.textContent='Publication not confirmed. The original reviewed draft and transaction are retained in this workspace; do not assume delivery was revoked.';
      throw error;
    }finally{if(pending===intent)pending=null;refresh()}
  })};
  refresh();return {refresh,lock,section};
}
