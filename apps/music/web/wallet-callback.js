import {createMusicSession} from './canonical-session.js';
import {loadCanonicalMusicRelease} from './canonical-release.js';
const returnedURL=location.href;
history.replaceState(null,'',location.pathname);
const status=document.querySelector('#callbackStatus'),retry=document.querySelector('#callbackRetry');
// The root separately restores the SDK grant and reads the original /api/me.
const session=createMusicSession({load:loadCanonicalMusicRelease,activate:async()=>{},dispose:()=>{}});
async function finish(){retry.hidden=true;try{const state=await session.finishReturn(returnedURL);if(state.status==='connected'){location.replace('https://music.ynxweb4.com/app.html');return}status.textContent=state.message||'Approval was not completed. You can return to Music.';retry.hidden=!['network-unavailable','retry-required'].includes(state.status)}catch(error){status.textContent=error.message;retry.hidden=false}}
retry.onclick=finish;void finish();
