import QRCode from 'qrcode/lib/browser.js';

export function profileLocator(profile){
 if(!/^sp_[A-Za-z0-9_-]{32}$/.test(profile?.id))throw new Error('Your existing Social profile identifier is required. No wallet address or replacement identity is shared.');
 const locator='https://social.ynxweb4.com/people/'+profile.id;
 if(profile.privacy?.profileQrPayload&&profile.privacy.profileQrPayload!==locator)throw new Error('Your saved personal code does not match the original Social profile.');
 return locator;
}

// A public discovery code only, never a Wallet Pair/payment code or E2EE key
// verification. The existing profile is read; no identity/key is generated.
export function createProfileShare(container,{encode=value=>QRCode.toDataURL(value,{errorCorrectionLevel:'M',width:240,margin:4,color:{dark:'#002FA7',light:'#FFFFFF'}})}={}){
 const document=container.ownerDocument,image=document.createElement('img'),link=document.createElement('input'),copy=document.createElement('button'),status=document.createElement('p'),note=document.createElement('p');
 image.width=image.height=240;image.alt='Your YNX Social personal discovery QR code';image.hidden=true;
 link.readOnly=true;link.setAttribute('aria-label','Your personal Social link');copy.type='button';copy.textContent='Copy my personal link';copy.disabled=true;
 status.setAttribute('role','status');note.textContent='This code shares your public profile only. The other person must review a request and you must accept. It does not add a friend, follow anyone or verify encryption keys.';
 container.append(image,link,copy,status,note);let revision=0,current=null;
 const active=value=>current===value&&value.revision===revision&&value.guard();
 copy.onclick=async()=>{const value=current;if(!value||!active(value))return;try{await globalThis.navigator.clipboard.writeText(value.locator);if(active(value))status.textContent='Personal link copied.'}catch{if(active(value))status.textContent='Clipboard access is unavailable. Your verified personal link is shown above.'}};
 return Object.freeze({
  async show(profile,guard=()=>true){
   const version=++revision;current=null;image.hidden=true;image.removeAttribute('src');link.value='';copy.disabled=true;status.textContent='';
   if(!profile||!guard())return;
   let locator;try{locator=profileLocator(profile)}catch(error){if(version===revision&&guard())status.textContent=error.message;return}
   const value={revision:version,locator,guard};current=value;link.value=locator;status.textContent='Preparing your personal discovery code.';
   try{const encoded=await encode(locator);if(!active(value))return;if(typeof encoded!=='string'||!encoded.startsWith('data:image/png;base64,'))throw new Error('Personal QR rendering was not confirmed.');image.src=encoded;image.hidden=false;copy.disabled=false;status.textContent='Share only with people you choose.'}catch(error){if(active(value))status.textContent=error.message||'Personal QR is unavailable; the original profile is unchanged.'}
  }
 });
}
