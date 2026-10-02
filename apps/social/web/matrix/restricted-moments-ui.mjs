import {RestrictedMoments} from './restricted-moments.mjs';

// resolveAudience/authorize must come from an approved integration, not from
// a room picker, follows, user-entered MXID or the chat permission alone.
export function createRestrictedMomentsUI({container,transport,capture,guard,identity,work,
  resolveAudience=null,authorize=null}) {
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
  const review=document.createElement('button');review.type='button';review.textContent='Review audience';
  const send=document.createElement('button');send.type='submit';send.textContent='Publish reviewed encrypted Moment';
  form.append(audienceLabel,label,review,send);section.append(heading,explanation,status,form);container.append(section);
  const enabled=typeof resolveAudience==='function'&&typeof authorize==='function';
  const consumer=enabled?new RestrictedMoments({transport,authorize}):null;
  let reviewed=null,pending=null,visibleBinding=null;
  // Drafts remain in this process only. Durable protected recovery is separate.
  const drafts=new Map();
  function remember(){if(visibleBinding)drafts.set(visibleBinding,input.value)}
  function refresh(){
    let view;try{view=capture();guard(view)}catch{lock();return}
    if(visibleBinding!==view.operation.binding){remember();visibleBinding=view.operation.binding;input.value=drafts.get(visibleBinding)??'';reviewed=null;pending=null}
    choice.disabled=!enabled;input.disabled=!enabled;review.disabled=!enabled||!!pending;
    send.disabled=!enabled||!reviewed||!!pending;
    if(!enabled)status.textContent='Restricted publishing is not enabled: live audience authorization is not connected. Chat approval does not authorize publishing.';
  }
  function lock(){remember();visibleBinding=null;input.value='';reviewed=null;pending=null;input.disabled=true;choice.disabled=true;review.disabled=true;send.disabled=true;status.textContent='Locked. Draft recovery is local to this open workspace; no plaintext was stored on the server.'}
  const invalidate=()=>{reviewed=null;send.disabled=true;remember();status.textContent='Review the audience and current draft before publishing.'};
  input.addEventListener('input',invalidate);choice.addEventListener('change',invalidate);
  review.onclick=()=>void work(async()=>{
    if(!enabled)return;
    const view=capture(),draft=input.value,kind=choice.value;guard(view);await identity(view);guard(view);
    const audience=await resolveAudience({kind,account:view.account});guard(view);
    if(input.value!==draft||choice.value!==kind)throw new Error('Draft changed; review again');
    const operation=transport.capture();await consumer.check(audience,operation);guard(view);
    if(audience.kind!==kind)throw new Error('Reviewed audience differs from your selection');
    reviewed={view,audience,draft,transactionId:crypto.randomUUID().replaceAll('-','')};
    status.textContent=`Reviewed ${kind}: ${audience.members.length} Matrix identities, revision ${audience.revision}. Only confirmed members with verified devices may receive future sends. Previously received keys cannot be recalled.`;
    refresh();
  });
  form.onsubmit=event=>{event.preventDefault();void work(async()=>{
    if(!enabled||!reviewed||pending)return;
    const intent=reviewed;guard(intent.view);
    if(input.value!==intent.draft)throw new Error('Review the changed draft again');
    pending=intent;refresh();
    try{
      await identity(intent.view);guard(intent.view);
      const receipt=await consumer.publish({audience:intent.audience,text:intent.draft,transactionId:intent.transactionId});guard(intent.view);
      if(reviewed===intent){input.value='';remember();reviewed=null;status.textContent=`Encrypted Moment sent: ${receipt.eventId}. Feed indexing is not yet connected.`}
    }catch(error){
      // Delivery may have occurred: preserve the reviewed transaction and note.
      if(visibleBinding===intent.view.operation.binding)status.textContent='Publication not confirmed. The original reviewed draft and transaction are retained in this workspace; do not assume delivery was revoked.';
      throw error;
    }finally{if(pending===intent)pending=null;refresh()}
  })};
  refresh();return {refresh,lock,section};
}
