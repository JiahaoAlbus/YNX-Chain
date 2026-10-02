const actions={
 remove:{title:'Remove this contact?',approve:'Remove contact',body:'Your independent following relationship and original encrypted history are retained. New contact-only access is no longer granted. Downloaded copies cannot be recalled.'},
 block:{title:'Block this person?',approve:'Block person',body:'This removes the contact relationship and closes pending requests. New requests and contact-only access are blocked. Original encrypted history and downloaded copies are not erased.'},
 mute:{title:'Mute this person?',approve:'Mute notifications',body:'Only notification preferences change. Your contact and following relationships are retained.'},
 unmute:{title:'Unmute this person?',approve:'Unmute notifications',body:'Restore notifications without changing your contact or following relationship.'}
};
export function reviewContactAction(document,person,action,isCurrent){
 const copy=actions[action];if(!copy||!isCurrent())return Promise.resolve(false);
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='contact-review';
  const title=document.createElement('h2'),profile=document.createElement('p'),description=document.createElement('p'),cancel=document.createElement('button'),approve=document.createElement('button');
  title.textContent=copy.title;profile.textContent=person.displayName+' @'+person.handle;description.textContent=copy.body;
  cancel.type=approve.type='button';cancel.textContent='Cancel';approve.textContent=copy.approve;
  let done=false;const finish=accepted=>{if(done)return;done=true;document.removeEventListener('ynx-social-private-locked',locked);dialog.close();dialog.remove();resolve(accepted&&isCurrent())};
  const locked=()=>finish(false);document.addEventListener('ynx-social-private-locked',locked);
  cancel.onclick=()=>finish(false);approve.onclick=()=>finish(true);
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)});dialog.addEventListener('close',()=>finish(false));
  dialog.append(title,profile,description,cancel,approve);document.body.append(dialog);dialog.showModal();cancel.focus();
 });
}
