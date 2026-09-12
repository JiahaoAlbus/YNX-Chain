import {StandardWalletConnection, discoverWalletProviders} from './vendor/standard-wallet-browser.mjs';

export function createDocsWalletController({environment = globalThis, render, discover = discoverWalletProviders}) {
  let generation = 0;
  let active = null;
  let unsubscribe;
  let kind = null;
  function emit(message = '') { render({kind, session: active?.current || null, message}); }
  function detach() {
    unsubscribe?.();
    unsubscribe = undefined;
    active?.disconnect();
    active = null;
  }
  async function select(selected, connect = false) {
    const attempt = ++generation;
    detach();
    kind = selected;
    emit('Checking the explicitly selected wallet...');
    try {
      if (!['ynx-wallet', 'metamask'].includes(selected)) throw new Error('Choose YNX Wallet or MetaMask explicitly.');
      try { environment.localStorage.setItem('ynx.docs.standard-wallet-choice', selected); } catch {}
      const discovery = await discover(environment, 160);
      if (attempt !== generation) return;
      const candidate = selected === 'ynx-wallet' ? discovery.ynx : discovery.metamask;
      if (!candidate) throw new Error('Selected wallet is missing or ambiguous. No other wallet was substituted.');
      const wallet = new StandardWalletConnection({provider: candidate.provider, origin: environment.location.origin, metadata: {name: 'YNX Docs', url: environment.location.origin}});
      active = wallet;
      unsubscribe = wallet.subscribe(() => { if (attempt === generation && active === wallet) emit(); });
      if (connect) await wallet.connect(); else await wallet.restore();
      if (attempt === generation && active === wallet) emit(wallet.current ? '' : 'No account is exposed. Connect only when you are ready.');
    } catch (error) {
      if (attempt === generation) emit(Number(error?.code) === 4001 ? 'Connection declined. You can retry.' : 'The selected wallet could not be connected or restored. Check its availability and retry.');
    }
  }
  return {
    select,
    async restoreSaved() {
      let selected;
      try { selected = environment.localStorage.getItem('ynx.docs.standard-wallet-choice'); } catch {}
      if (['ynx-wallet', 'metamask'].includes(selected)) return select(selected);
      emit('Choose a wallet. No connection permission has been requested.');
    },
    disconnect() { generation++; detach(); emit('Disconnected locally. Remote permissions and Docs authorization were not revoked.'); },
    async revoke() {
      const wallet = active;
      const attempt = generation;
      if (!wallet) { emit('Select and connect a wallet first.'); return; }
      const outcome = await wallet.revoke();
      if (attempt !== generation || active !== wallet) return;
      emit(outcome.permissionRevoked === true
        ? 'Wallet permission revoked and empty accounts confirmed. Docs authorization is separate.'
        : `Wallet permission revocation is not confirmed (${outcome.status}). You can retry or manage permissions in the wallet.`);
      return outcome;
    },
  };
}

if (typeof document !== 'undefined' && document.querySelector('#standard-wallet-kind')) {
  const output = document.querySelector('#provider-state');
  output.dataset.standardManaged = 'true';
  const picker = document.querySelector('#standard-wallet-kind');
  const controller = createDocsWalletController({render({kind, session, message}) {
    if (kind) picker.value = kind;
    const identity = kind === 'metamask' ? 'MetaMask' : kind === 'ynx-wallet' ? 'YNX Wallet' : 'Wallet';
    const connection = session
      ? `${identity}: ${session.selectedAccount} | ${session.selectedChain === '0x1917' ? 'YNX Testnet 6423' : `Different network (${session.selectedChain})`}. This is not Docs authorization.`
      : `${identity}: not connected.`;
    output.textContent = `${connection} ${message}`;
  }});
  picker.addEventListener('change', () => controller.select(picker.value));
  document.querySelector('#standard-connect').addEventListener('click', () => controller.select(picker.value, true));
  document.querySelector('#standard-restore').addEventListener('click', () => controller.select(picker.value));
  document.querySelector('#standard-disconnect').addEventListener('click', () => controller.disconnect());
  document.querySelector('#standard-revoke').addEventListener('click', () => controller.revoke());
  controller.restoreSaved();
  window.addEventListener('pagehide', () => controller.disconnect());
  window.addEventListener('pageshow', (event) => { if (event.persisted) controller.restoreSaved(); });
}
