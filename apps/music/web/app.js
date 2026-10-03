import {createMusicSession} from './canonical-session.js';
import {loadCanonicalMusicRelease} from './canonical-release.js';
import {createMusicBusiness} from './business.js';
import {connectMusicWallet,WALLET_INSTALLATION_OPTIONS} from './wallet-connection.js';

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const status=$('#status');
const audio=$('#audio');
let wallet=null;

function tell(message,error=false){status.textContent=message;status.classList.toggle('error',error)}
function walletMessage(message,error=false){const target=$('#walletStatus');target.textContent=message;target.classList.toggle('error',error)}
async function connectWallet(choice){
  privateSession.invalidate();
  const buttons=$$('#walletDialog button[data-wallet]');
  buttons.forEach(button=>button.disabled=true);
  walletMessage(`Discovering ${choice==='ynx'?'YNX Wallet':'MetaMask'}…`);
  try{
    wallet=await connectMusicWallet(choice);
    const short=`${wallet.account.slice(0,6)}…${wallet.account.slice(-4)}`;
    $('#authButton').textContent=short;
    $('#authButton').setAttribute('aria-label',`${wallet.walletName} account ${short} connected on YNX Testnet; private Music services are unavailable`);
    walletMessage(`${wallet.walletName} connected to YNX Testnet as ${short}. Private library, upload, royalties and settlement remain unavailable.`);
    tell(`Standard Wallet connected · ${short} · public catalog remains available · private Music service degraded.`);
  }catch(error){
    const missing=error?.code==='WALLET_NOT_INSTALLED';
    walletMessage(missing?`${choice==='ynx'?'YNX Wallet':'MetaMask'} was not found. Choose the official install link below, then reconnect.`:`Connection was not completed: ${error?.message||'Wallet request failed'}. No Music account or private session was created.`,true);
  }finally{buttons.forEach(button=>button.disabled=false)}
}
function showView(view){business.showView(view)}

$$('[data-view]').forEach(control=>control.addEventListener('click',event=>{event.preventDefault();showView(control.dataset.view)}));
$('#seek').oninput=event=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(event.target.value)/100};
$('#volume').oninput=event=>audio.volume=Number(event.target.value);
$('#trackDialog .close').onclick=()=>$('#trackDialog').close();
$('#authButton').onclick=()=>$('#walletDialog').showModal();
$('#walletDialog .close').onclick=()=>$('#walletDialog').close();
$$('#walletDialog button[data-wallet]').forEach(button=>button.onclick=()=>connectWallet(button.dataset.wallet));
$('#ynxWalletDownload').href=WALLET_INSTALLATION_OPTIONS.ynx;
$('#metaMaskDownload').href=WALLET_INSTALLATION_OPTIONS.metamask;
const business=createMusicBusiness({document,audio,tell});
// Integration seam for the release owner's frozen canonical adapter. There is
// deliberately no invocation from StandardWalletConnection or browser storage.
export async function activateMusicBusiness(request){return business.activate(request)}
export function invalidateMusicBusiness(){privateSession.invalidate()}

fetch('health').then(async response=>{const health=await response.json();if(!response.ok)throw new Error('service integrity check failed');const release=health.build?.release||'local';if(business.isActive())return;tell(`Service healthy · ${release} · central registry merge pending. No licensed public catalog or production streaming is claimed.`)}).catch(error=>tell(`Service unavailable · ${error.message}`,true));

const privateSession=createMusicSession({load:loadCanonicalMusicRelease,activate:request=>business.activate(request),dispose:()=>business.dispose()});
const signIn=document.querySelector('#musicSignIn'),openWallet=document.querySelector('#musicOpenWallet'),signOutRetry=document.querySelector('#musicSignOutRetry');
function showSessionState(state){if(state.status==='superseded')return;signOutRetry.hidden=state.status!=='revocation-pending';signIn.disabled=state.status==='revocation-pending'}
async function restoreMusic(){try{const state=await privateSession.restore(navigator.onLine);showSessionState(state);if(state.status!=='connected'&&state.status!=='superseded')tell(state.message||'Sign in to open your Music library.')}catch(error){tell(error.message,true)}}
signIn.onclick=async()=>{signIn.disabled=true;openWallet.hidden=true;openWallet.removeAttribute('href');tell('Preparing your Music sign-in…');try{const state=await privateSession.begin();showSessionState(state);if(state.status==='connecting'&&state.route?.status==='ready'){openWallet.href=state.route.url;openWallet.hidden=false;tell('Open YNX Wallet to review your Music sign-in.')}else if(state.status!=='superseded')tell(state.message||'Sign-in was not completed.')}catch(error){tell(error.message,true)}finally{signIn.disabled=!signOutRetry.hidden}};
async function signOutMusic(){openWallet.hidden=true;openWallet.removeAttribute('href');signOutRetry.hidden=false;signOutRetry.disabled=true;signIn.disabled=true;tell('Signing out of Music…');try{const state=await privateSession.disconnect();showSessionState(state);tell(state.status==='disconnected'?'Signed out. Your Music library is preserved.':state.message||'Sign-out is pending; private operations are disabled.')}catch(error){tell('Sign-out is pending: '+error.message,true)}finally{signOutRetry.disabled=false}}
document.querySelector('#musicDisconnect').onclick=signOutMusic;signOutRetry.onclick=signOutMusic;
window.addEventListener('pageshow',()=>void restoreMusic());
window.addEventListener('online',()=>void restoreMusic());
window.addEventListener('offline',()=>privateSession.invalidate());
window.addEventListener('storage',()=>{privateSession.invalidate();void restoreMusic()});
