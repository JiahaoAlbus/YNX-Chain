import {setWalletCopy} from './wallet-locale.mjs';
export function createFamilyUI({document, api, getContext}) {
  const entry = document.createElement('button'); entry.type = 'button'; entry.id = 'open-family'; entry.textContent = 'BTC / TRON'; document.querySelector('.toolbar').append(entry);
  const sheet = document.querySelector('#family-sheet'), content = document.querySelector('#family-content');
  let epoch = 0, busy = false;
  const make = (tag, text) => { const node = document.createElement(tag); if (text) setWalletCopy(node, text); return node; };
  const family = make('select'), network = make('select');
  family.setAttribute('aria-label', 'Chain'); network.setAttribute('aria-label', 'Network');
  for (const [value, label] of [['bitcoin', 'Bitcoin (BTC)'], ['tron', 'TRON (TRX)']]) { const option = make('option'); option.value = value; option.textContent = label; family.append(option); }
  const button = make('button', 'Show receiving address'); button.type = 'button';
  const status = make('p'); status.setAttribute('role', 'status');
  const address = make('input'); address.readOnly = true; address.dir = 'ltr'; address.setAttribute('aria-label', 'Receiving address');
  const path = make('p'); path.dir = 'ltr';
  const notice = make('p', 'A receiving address does not verify the network or balance. Never send assets on another network.');
  content.append(family, network, button, status, address, path, notice);
  const settings = make('details'), summary = make('summary', 'HTTPS RPC');
  const rpcLabel = make('label', 'HTTPS RPC'), rpc = make('input'); rpc.type = 'url'; rpc.id = 'family-rpc'; rpc.autocomplete = 'off'; rpcLabel.htmlFor = rpc.id;
  const genesisLabel = make('label', 'Genesis block hash'), genesis = make('input'); genesis.id = 'family-genesis'; genesis.autocomplete = 'off'; genesis.dir = 'ltr'; genesisLabel.htmlFor = genesis.id;
  const save = make('button', 'Verify and save network'); save.type = 'button'; settings.append(summary, rpcLabel, rpc, genesisLabel, genesis, save);
  const refresh = make('button', 'Refresh'), balance = make('p'); refresh.type = 'button'; balance.setAttribute('role', 'status'); content.append(settings, refresh, balance);
  function invalidate() { epoch++; busy = false; address.value = ''; path.textContent = ''; status.textContent = ''; balance.textContent = ''; button.disabled = Boolean(getContext().locked); refresh.disabled = button.disabled; }
  function networks() {
    invalidate(); network.replaceChildren();
    for (const value of family.value === 'bitcoin' ? ['mainnet', 'testnet3', 'testnet4', 'signet'] : ['mainnet', 'shasta', 'nile']) { const option = make('option'); option.value = value; option.textContent = value; network.append(option); }
    void readSettings();
  }
  async function readSettings() {
    const token = epoch; rpc.value = ''; genesis.value = ''; genesis.hidden = genesisLabel.hidden = family.value === 'bitcoin';
    if (!api.familyNetworks) return;
    try { const reply = await api.familyNetworks(); if (token !== epoch || !reply.ok) return; const saved = reply.value.networks.find(n => n.family === family.value && n.network === network.value); if (saved) {rpc.value = saved.rpcUrl; genesis.value = saved.genesis ?? '';} } catch { if (token === epoch) status.textContent = 'FAMILY_NETWORK_UNAVAILABLE'; }
  }
  family.addEventListener('change', networks); network.addEventListener('change', () => {invalidate(); void readSettings();});
  rpc.addEventListener('input', invalidate); genesis.addEventListener('input', invalidate);
  save.addEventListener('click', async () => {
    invalidate(); const token = epoch; save.disabled = true;
    try { const reply = await api.familyNetwork({family: family.value, network: network.value, rpcUrl: rpc.value.trim(), genesis: family.value === 'bitcoin' ? null : genesis.value.trim().toLowerCase()}); if (token !== epoch || !sheet.open) return; if (!reply.ok) status.textContent = reply.error?.code ?? 'FAMILY_NETWORK_UNAVAILABLE'; else { setWalletCopy(status, 'Verify and save network'); settings.open = false; } } catch (error) { if (token === epoch) status.textContent = error.code ?? 'FAMILY_NETWORK_UNAVAILABLE'; } finally { save.disabled = false; }
  });
  refresh.addEventListener('click', async () => {
    if (busy || getContext().locked) return;
    const token = ++epoch, context = {...getContext()}; busy = true; refresh.disabled = true; balance.textContent = ''; setWalletCopy(status, 'Checking account…');
    try {
      const reply = await api.familyBalances({family: family.value, network: network.value});
      const current = getContext(); if (token !== epoch || !sheet.open || current.locked || current.account !== context.account || current.revision !== context.revision) return;
      if (!reply.ok) { status.textContent = reply.error?.code ?? 'FAMILY_BALANCE_UNAVAILABLE'; return; }
      if (reply.value.vaultAccount !== context.account || reply.value.family !== family.value || reply.value.network !== network.value) {status.textContent = 'FAMILY_ACCOUNT_CHANGED'; return;}
      balance.textContent = reply.value.assets.map(asset => `${asset.display} ${asset.symbol}`).join(' · ');
      address.value = reply.value.account; status.textContent = reply.value.assets.map(asset => asset.verification).join(' · ');
    } catch (error) { if (token === epoch) status.textContent = error.code ?? 'FAMILY_BALANCE_UNAVAILABLE'; }
    finally { if (token === epoch) {busy = false; refresh.disabled = Boolean(getContext().locked);} }
  });
  button.addEventListener('click', async () => {
    if (busy || getContext().locked) return;
    const token = ++epoch, context = {...getContext()}; busy = true; button.disabled = true; address.value = ''; path.textContent = ''; setWalletCopy(status, 'Checking account…');
    try {
      const reply = await api.familyAccount({family: family.value, network: network.value, index: 0, account: 0});
      if (token !== epoch || !sheet.open) return;
      const current = getContext(); if (current.locked || current.account !== context.account || current.revision !== context.revision) return;
      if (!reply.ok) { status.textContent = reply.error?.code ?? 'FAMILY_ACCOUNT_UNAVAILABLE'; return; }
      if (reply.value.vaultAccount !== context.account || reply.value.family !== family.value || reply.value.network !== network.value) { status.textContent = 'FAMILY_ACCOUNT_CHANGED'; return; }
      address.value = reply.value.address; path.textContent = reply.value.path; setWalletCopy(status, 'Receiving address');
    } catch (error) { if (token === epoch && sheet.open) status.textContent = error.code ?? 'FAMILY_ACCOUNT_UNAVAILABLE'; }
    finally { if (token === epoch) { busy = false; button.disabled = Boolean(getContext().locked); } }
  });
  document.querySelector('#open-family').addEventListener('click', () => { networks(); sheet.showModal(); });
  document.querySelector('#family-close').addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', invalidate); sheet.addEventListener('cancel', invalidate); networks();
  return {invalidate};
}
