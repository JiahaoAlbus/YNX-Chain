// Finance-owned consumer state for the official Hosted Wallet adapter. This
// module does not create a provider, popup, session, signature or transaction.
// The adapter factory must come from a separately reviewed Wallet release.
const CHAIN_ID = '0x1917';
const ACCOUNT = /^0x[0-9a-f]{40}$/i;

function failure(code) {
  return Object.assign(new Error(code), {code});
}

export function createFinanceHostedWalletController({createHostedWalletAdapter, window: browserWindow, onChange = () => {}}) {
  if (typeof createHostedWalletAdapter !== 'function' || !browserWindow || typeof onChange !== 'function') {
    throw new TypeError('Finance Hosted Wallet requires the reviewed adapter, window and state callback');
  }
  let adapter = null;
  let generation = 0;
  let pending = null;
  let listeners = [];
  let state = Object.freeze({status: 'disconnected', account: null, chainId: null, error: null, transport: 'hosted-wallet-web'});

  function publish(status, account = null, chainId = null, error = null) {
    state = Object.freeze({status, account, chainId, error, transport: 'hosted-wallet-web'});
    onChange(state);
    return state;
  }
  function detach() {
    for (const [name, listener] of listeners) adapter?.removeListener(name, listener);
    listeners = [];
    const previous = adapter;
    adapter = null;
    if (previous) {
      try { Promise.resolve(previous.disconnect()).catch(() => {}).finally(() => previous.detach?.()); }
      catch { previous.detach?.(); }
    }
  }
  function subscribe(selected, token, onConnectingAccount, onConnectingSignal) {
    let closeBatch = 0;
    const accountChanged = accounts => {
      if (token !== generation || selected !== adapter) return;
      // The Wallet emits accountsChanged before connect() resolves. The
      // approval result plus chain readback, not this event, admits a session.
      const account = Array.isArray(accounts) && accounts.length === 1 ? accounts[0] : null;
      if (!ACCOUNT.test(account ?? '')) {
        if (state.status === 'connecting') { onConnectingSignal('empty'); return; }
        // The accepted adapter emits [] immediately before its typed close
        // event. Only that same synchronous batch may classify a transport
        // close; an independent empty-account event still fails closed.
        const batch = closeBatch;
        queueMicrotask(() => {
          if (token !== generation || selected !== adapter) return;
          if (batch !== closeBatch && state.status === 'transport-unavailable') return;
          generation++;
          detach();
          publish('disconnected', null, null, 'HOSTED_ACCOUNT_CHANGED');
        });
      } else if (state.status === 'connecting') onConnectingAccount(account.toLowerCase());
      else if (state.status === 'connected' && account.toLowerCase() !== state.account) {
        generation++;
        detach();
        publish('disconnected', null, null, 'HOSTED_ACCOUNT_CHANGED');
      }
    };
    const chainChanged = chainId => {
      if (token !== generation || selected !== adapter) return;
      if (chainId !== CHAIN_ID) {
        generation++;
        detach();
        publish('wrong-chain', null, null, 'WRONG_NETWORK');
      }
    };
    const disconnected = signal => {
      if (token !== generation || selected !== adapter) return;
      if (state.status === 'connecting') { onConnectingSignal('disconnected'); return; }
      const previous=state,transportClose=['HOSTED_POPUP_CLOSED','HOSTED_REQUEST_EXPIRED_OR_RELOADED'].includes(signal?.code);
      if (transportClose && previous.account && typeof selected.reserve === 'function') {
        closeBatch++;
        publish('transport-unavailable',previous.account,previous.chainId,signal.code);
        return;
      }
      generation++;
      detach();
      if(transportClose&&previous.status==='connected')publish('transport-unavailable',previous.account,previous.chainId,signal.code);
      else publish('disconnected', null, null, 'HOSTED_DISCONNECTED');
    };
    const reconnected = () => { if (token === generation && selected === adapter && ['transport-unavailable','selection-pending'].includes(state.status)) publish('connected',state.account,state.chainId); };
    listeners = [['accountsChanged', accountChanged], ['chainChanged', chainChanged], ['disconnect', disconnected], ['connect',reconnected]];
    for (const [name, listener] of listeners) selected.on(name, listener);
  }
  function connect() {
    if (pending) return pending;
    const token = ++generation;
    detach();
    publish('connecting');
    let selected;
    let approval;
    let announcedAccount = null;
    let connectingSignal = null;
    try {
      selected = createHostedWalletAdapter({window: browserWindow});
      if (!selected || typeof selected.connect !== 'function' || typeof selected.request !== 'function' || typeof selected.disconnect !== 'function' || typeof selected.on !== 'function' || typeof selected.removeListener !== 'function') throw failure('HOSTED_ADAPTER_INVALID');
      adapter = selected;
      subscribe(selected, token, account => { announcedAccount = account; }, signal => { connectingSignal = signal; });
      // Calling connect without an awaited preflight preserves the browser's
      // user gesture for the Wallet-owned popup and its real approval page.
      approval = selected.connect();
    } catch (error) {
      detach();
      publish('unavailable', null, null, error?.code ?? 'HOSTED_ADAPTER_UNAVAILABLE');
      return Promise.resolve(null);
    }
    const work = Promise.resolve(approval).then(async accounts => {
      if (token !== generation || selected !== adapter) return null;
      if (connectingSignal) throw failure('HOSTED_CONNECTION_INTERRUPTED');
      const account = Array.isArray(accounts) && accounts.length === 1 ? accounts[0] : null;
      if (!ACCOUNT.test(account ?? '')) throw failure('HOSTED_ACCOUNT_INVALID');
      if (announcedAccount !== null && announcedAccount !== account.toLowerCase()) throw failure('HOSTED_ACCOUNT_MISMATCH');
      const chainId = await selected.request({method: 'eth_chainId'});
      if (token !== generation || selected !== adapter) return null;
      if (chainId !== CHAIN_ID) throw failure('WRONG_NETWORK');
      return publish('connected', account.toLowerCase(), chainId);
    }).catch(error => {
      if (token !== generation || selected !== adapter) return null;
      detach();
      const code = typeof error?.code === 'string' ? error.code : 'HOSTED_CONNECTION_FAILED';
      return publish(code === 'USER_REJECTED' ? 'rejected' : code === 'WRONG_NETWORK' ? 'wrong-chain' : 'unavailable', null, null, code);
    }).finally(() => { if (pending === work) pending = null; });
    pending = work;
    return work;
  }
  function restoreSelection() {
    if(adapter)return state;
    const token=++generation,selected=createHostedWalletAdapter({window:browserWindow}),hint=selected.selection;
    if(!hint||!ACCOUNT.test(hint.account??'')||hint.chainId!==CHAIN_ID){selected.suspend?.();return state;}
    adapter=selected;subscribe(selected,token,()=>{},()=>{});
    // This is a public selection hint, not a connected Wallet or permission.
    return publish('selection-pending',hint.account,hint.chainId);
  }
  function suspend(){generation++;for(const [name,listener]of listeners)adapter?.removeListener(name,listener);listeners=[];adapter?.suspend?.();adapter=null;pending=null;}
  async function disconnect() {
    generation++;
    pending = null;
    const previous = adapter;
    for (const [name, listener] of listeners) previous?.removeListener(name, listener);
    listeners = [];
    adapter = null;
    try { await previous?.disconnect(); } catch { /* Local disconnect still wins. */ }
    finally { previous?.detach?.(); }
    return publish('disconnected', null, null, 'HOSTED_LOCAL_DISCONNECT');
  }
  async function request(input) {
    const selected = adapter, token = generation;
    if (!['connected','transport-unavailable','selection-pending'].includes(state.status) || !selected) throw failure('HOSTED_NOT_CONNECTED');
    const result = await selected.request(input);
    if (token !== generation || selected !== adapter || !['connected','transport-unavailable'].includes(state.status)) throw failure('HOSTED_CONTEXT_CHANGED');
    return result;
  }
  function reserve() {
    const selected = adapter, token = generation;
    if (!selected || !['connected','transport-unavailable','selection-pending'].includes(state.status) || typeof selected.reserve !== 'function') return Promise.reject(failure('HOSTED_NOT_CONNECTED'));
    // Called in the click stack, before any server/device proof await.
    return selected.reserve().then(accounts => {
      if (token !== generation || selected !== adapter || accounts?.[0] !== state.account) throw failure('HOSTED_CONTEXT_CHANGED');
      return accounts;
    });
  }
  async function revoke() {
    const selected = adapter, token = generation;
    if (!['connected','transport-unavailable'].includes(state.status) || typeof selected?.revoke !== 'function') return {status: 'unsupported', permissionRevoked: false, locallyDisconnected: false};
    const receipt = await selected.revoke();
    if (token !== generation || selected !== adapter) return {status:receipt?.revoked===true&&!adapter&&state.status==='disconnected'?'revoked':'superseded',permissionRevoked:receipt?.revoked===true,locallyDisconnected:!adapter&&state.status==='disconnected'};
    await disconnect();
    // Legacy adapters remain local-only. Only the new Wallet-origin durable
    // permission acknowledgement is reported as a remote revocation.
    return {status: receipt?.revoked === true ? 'revoked' : 'local-only', permissionRevoked: receipt?.revoked === true, locallyDisconnected: true};
  }
  return Object.freeze({connect, disconnect, revoke, reserve, request, restoreSelection, suspend, dispose: disconnect, getState: () => state});
}

export function mountFinanceHostedWalletUI({document, window: browserWindow, createHostedWalletAdapter, text, onAttempt = () => {}, onChange = () => {}}) {
  const panel = document?.querySelector('#wallet-connect');
  if (!panel || typeof text !== 'function') throw new TypeError('Finance Hosted Wallet panel is unavailable');
  const region = document.createElement('section');
  region.id = 'hosted-wallet';
  region.className = 'hosted-wallet';
  region.setAttribute('aria-label', 'YNX Wallet on Web');
  const intro = document.createElement('p');
  const connectButton = document.createElement('button');
  connectButton.id = 'connect-hosted-ynx';
  connectButton.className = 'ghost';
  connectButton.type = 'button';
  const disconnectButton = document.createElement('button');
  disconnectButton.id = 'disconnect-hosted-ynx';
  disconnectButton.className = 'ghost';
  disconnectButton.type = 'button';
  const status = document.createElement('p');
  status.id = 'hosted-wallet-state';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  region.append(intro, connectButton, disconnectButton, status);
  panel.insertBefore(region, panel.querySelector('#wallet-more'));

  const labels = {
    disconnected: 'hostedDisconnected', connecting: 'hostedConnecting', connected: 'hostedConnected',
    rejected: 'walletRejected', unavailable: 'walletActionUnavailable', 'wrong-chain': 'walletWrongChain',
  };
  let controller;
  function render() {
    const state = controller.getState();
    intro.textContent = text('hostedIntro');
    connectButton.textContent = text('hostedConnect');
    connectButton.disabled = state.status === 'connecting';
    disconnectButton.textContent = text('hostedDisconnect');
    disconnectButton.hidden = state.status !== 'connected' && state.status !== 'connecting';
    const statusKey = ['transport-unavailable','selection-pending'].includes(state.status) ? 'hostedResume'
      : state.error === 'HOSTED_POPUP_BLOCKED' ? 'hostedPopupBlocked'
      : state.error === 'HOSTED_POPUP_CLOSED' ? 'hostedPopupClosed'
      : state.error === 'HOSTED_REQUEST_EXPIRED_OR_RELOADED' ? 'hostedExpired'
      : labels[state.status];
    status.textContent = state.status === 'connected' ? `${text(labels.connected)} · ${state.account} · ${state.chainId}` : text(statusKey);
    status.title = state.error ?? '';
  }
  controller = createFinanceHostedWalletController({createHostedWalletAdapter, window: browserWindow, onChange: state => { render(); onChange(state); }});
  connectButton.addEventListener('click', () => { onAttempt(); void controller.connect(); });
  disconnectButton.addEventListener('click', () => { void controller.disconnect(); });
  document.addEventListener('finance:localechange', render);
  render();
  return controller;
}
