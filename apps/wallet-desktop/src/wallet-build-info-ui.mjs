import {setWalletCopy} from './wallet-locale.mjs';
const valid=v=>v&&typeof v.version==='string'&&/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v.version)&&v.build&&Object.keys(v.build).sort().join(',')==='distribution,metadataOnly,sourceCommit,walletAuthTree,walletTree'&&v.build.distribution==='testnet-preview'&&v.build.metadataOnly===true&&['sourceCommit','walletTree','walletAuthTree'].every(k=>typeof v.build[k]==='string'&&/^[a-f0-9]{40}$/.test(v.build[k]));
/** Read-only public display in the existing settings dialog, including locked
 * Wallets. No account, vault, clipboard or network permission is requested. */
export function mountWalletBuildInfo({document,readInfo,setCopy=setWalletCopy}){
 const sheet=document.querySelector('#appearance-sheet');if(!sheet||document.querySelector('#wallet-build-info'))return null;
 const section=document.createElement('section'),heading=document.createElement('h3'),value=document.createElement('code'),status=document.createElement('p'),notice=document.createElement('p');
 section.id='wallet-build-info';heading.id='wallet-build-title';section.setAttribute('aria-labelledby',heading.id);value.id='wallet-build-value';value.dir='ltr';value.hidden=true;status.id='wallet-build-status';status.setAttribute('role','status');
 setCopy(heading,'Wallet build');setCopy(status,'Build information unavailable.');setCopy(notice,'Recorded package metadata only; this does not verify a signature or running features.');
 section.append(heading,value,status,notice);sheet.append(section);
 const ready=Promise.resolve().then(()=>readInfo()).then(info=>{
  if(section.isConnected===false||!valid(info))return;
  value.textContent=`v${info.version}\n${info.build.sourceCommit}`;value.hidden=false;status.textContent='';status.hidden=true;
 }).catch(()=>{});
 return Object.freeze({ready});
}
