import {AIWalletClient} from './wallet-client.mjs';

const status=document.querySelector('#standard-wallet-status');
const client=new AIWalletClient({
 onChange(state){
  const name=state.kind==='metamask'?'MetaMask':state.kind==='ynx-wallet'?'YNX Wallet':'Wallet';
  status.textContent=[name+': '+state.status,state.account?'EVM account '+state.account:'',state.chainId?'Chain '+state.chainId:'',state.message??'Choose a wallet. Discovery does not request account access.'].filter(Boolean).join(' | ');
  document.querySelector('#standard-wallet-network').hidden=state.status!=='wrong-network';
 },
 onInvalidated(){window.dispatchEvent(new Event('ynx-ai-wallet-invalidated'))},
});
document.querySelector('#standard-wallet-ynx').onclick=()=>client.connect('ynx-wallet');
document.querySelector('#standard-wallet-metamask').onclick=()=>client.connect('metamask');
document.querySelector('#standard-wallet-refresh').onclick=()=>client.scan().catch(()=>{status.textContent='Wallet discovery failed. Retry when your wallet is available.'});
document.querySelector('#standard-wallet-disconnect').onclick=()=>client.disconnect();
document.querySelector('#standard-wallet-network').onclick=()=>client.switchNetwork();
window.addEventListener('pagehide',()=>client.dispose());
window.addEventListener('pageshow',event=>{if(event.persisted)void client.restore()});
client.restore().catch(()=>{status.textContent='Wallet connection is unavailable in this browser. Use the registered HTTPS product origin and retry.'});
