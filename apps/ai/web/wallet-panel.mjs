import {AIWalletClient} from './wallet-client.mjs';
const status=document.querySelector('#standard-wallet-status');
const client=new AIWalletClient({
 onChange(state){status.textContent=[state.kind==='metamask'?'MetaMask':state.kind==='ynx-wallet'?'YNX Wallet':'',state.account?state.account.slice(0,8)+'...'+state.account.slice(-4):'',state.message??'Choose a wallet to connect.'].filter(Boolean).join(' · ');document.querySelector('#standard-wallet-network').hidden=state.status!=='wrong-network';window.dispatchEvent(new CustomEvent('ynx-ai-wallet-state',{detail:state}));},
 onInvalidated(detail){window.dispatchEvent(new CustomEvent('ynx-ai-wallet-invalidated',{detail}));},
 onPair(state){const panel=document.querySelector('#pair-panel'),qr=document.querySelector('#pair-qr'),open=document.querySelector('#pair-open');panel.hidden=['connected','cancelled'].includes(state.status);document.querySelector('#pair-status').textContent=state.message||({opening:'Preparing phone connection...',pairing:'Scan with YNX Wallet, then review the connection.',cancelling:'Cancelling phone connection...',connected:'Phone connected.',cancelled:'Connection cancelled.',rejected:'Connection declined.',failed:'Phone connection unavailable.', 'cancel-unconfirmed':'Remote cancellation is not confirmed.'}[state.status]??'Check the connection in your wallet.');qr.hidden=!state.qrDataURL;if(state.qrDataURL)qr.src=state.qrDataURL;else qr.removeAttribute('src');open.hidden=!state.deeplink;if(state.deeplink)open.href=state.deeplink;else open.removeAttribute('href');document.querySelector('#pair-cancel').hidden=!['opening','pairing','cancelling'].includes(state.status);},
});
window.YNXAIWallet=client;
document.querySelector('#standard-wallet-ynx').onclick=()=>client.connect('ynx-wallet');
document.querySelector('#standard-wallet-metamask').onclick=()=>client.connect('metamask');
document.querySelector('#standard-wallet-hosted').onclick=()=>client.connectHosted();
document.querySelector('#standard-wallet-pair').onclick=()=>client.connectPair();
document.querySelector('#pair-cancel').onclick=()=>client.cancelPair();
document.querySelector('#standard-wallet-refresh').onclick=()=>client.scan().catch(()=>{status.textContent='Wallet discovery failed. Retry when online.'});
document.querySelector('#standard-wallet-disconnect').onclick=()=>client.disconnect();
document.querySelector('#standard-wallet-revoke').onclick=()=>client.revoke();
document.querySelector('#standard-wallet-network').onclick=()=>client.switchNetwork();
window.addEventListener('pagehide',()=>client.dispose());
window.addEventListener('pageshow',event=>{if(event.persisted)void client.restore()});
void client.prepareTransports().catch(()=>{status.textContent='Web / phone connection could not be prepared. Reload when online; existing AI permission is not revoked.'});
void client.restore().catch(()=>{status.textContent='Wallet connection is unavailable. Retry or choose Web Wallet.'});
