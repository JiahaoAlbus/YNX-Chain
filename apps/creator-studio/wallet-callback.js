import {finishProductReturn,restoreProductSession} from './product-session.js';
const status = document.querySelector('#callback-status');
const retry = document.querySelector('#callback-retry');
const returnedURL = location.href;
// Keep the signed callback in memory while hiding it from history and referrers.
history.replaceState(null, '', location.pathname);
async function finish() {
  retry.hidden = true;
  status.textContent = 'Checking your approval and securing this browser session…';
  try {
    const state = new URL(returnedURL).searchParams.has("result") ? await finishProductReturn(returnedURL) : await restoreProductSession();
    if (state.status === 'connected') { status.textContent = 'Signed in. Opening your Studio…'; location.replace('/'); return; }
    status.textContent = state.status === 'disconnected' ? 'Approval was declined. Your account remains disconnected.' : state.message;
    retry.hidden = !['network-unavailable','retry-required'].includes(state.status);
  } catch { status.textContent = 'This return could not be verified. Return to Studio and start a new sign-in.'; }
}
retry.addEventListener('click', finish);
void finish();
