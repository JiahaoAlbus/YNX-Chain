// The review is a consent boundary, not a key-verification or friendship claim.
export function reviewContact(document,preview,isCurrent){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='contact-review';
    const heading=document.createElement('h3');heading.textContent='Send a contact request?';
    const name=document.createElement('p');name.textContent=`${preview.person.displayName} @${preview.person.handle}`;
    const note=document.createElement('p');note.textContent='This person must accept before you become contacts. This preview does not verify their encryption keys.';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.autofocus=true;
    const send=document.createElement('button');send.type='button';send.textContent='Send request';
    let settled=false;
    function finish(approved){if(settled)return;settled=true;const accepted=approved&&isCurrent();dialog.close();dialog.remove();resolve(accepted)}
    cancel.addEventListener('click',()=>finish(false));send.addEventListener('click',()=>finish(true));
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)});
    dialog.addEventListener('close',()=>finish(false));
    dialog.append(heading,name,note,cancel,send);document.body.append(dialog);
    if(!isCurrent()){finish(false);return}dialog.showModal();cancel.focus();
  });
}
