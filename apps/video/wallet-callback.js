import {videoProductSession} from './product-session.js';

const status = document.querySelector('#callback-status');
const retry = document.querySelector('#callback-retry');
const returnedURL = location.href;
history.replaceState(null, '', location.pathname);

async function finish() {
  retry.hidden = true;
  status.textContent = 'Verifying your approval and securing this browser session…';
  try {
    const state = new URL(returnedURL).searchParams.has('result')
      ? await videoProductSession.finishReturn(returnedURL) : await videoProductSession.restore();
    if (state.status === 'connected') {status.textContent = 'Signed in. Opening Video…'; location.replace('/'); return;}
    status.textContent = state.status === 'disconnected' ? 'Approval was declined. You can continue watching as a guest.' : state.message;
    retry.hidden = !['network-unavailable', 'retry-required'].includes(state.status);
  } catch {status.textContent = 'This return could not be verified. Return to Video and start a new sign-in.';}
}
retry.addEventListener('click', finish);
void finish();
