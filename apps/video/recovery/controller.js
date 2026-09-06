// This entry is deliberately independent of the normal application and callback.
// Construction performs no SDK initialization, storage access or network calls.
export function createRecoveryController({openClient, render}) {
  let pending, busy = false;
  return Object.freeze({async retrySignOut() {
    if (busy) return;
    busy = true;
    render({busy:true, message:'Retrying sign-out with Wallet Auth…'});
    try {
      pending ??= Promise.resolve().then(openClient).catch(error => {pending = null; throw error;});
      const browser = await pending;
      const state = await browser.client.disconnect();
      const confirmed = ['disconnected','expired'].includes(state.status) && state.revocationPending !== true;
      render({busy:false, confirmed, message:confirmed ? 'Sign-out confirmed. Sign-in remains paused while this service is being repaired.' : state.message || 'Sign-out is still pending. Keep this browser data and explicitly retry when connected.'});
    } catch(error) {
      render({busy:false, confirmed:false, message:error.message || 'Sign-out could not be confirmed. Keep this browser data and retry.'});
    } finally {busy = false;}
  }});
}
