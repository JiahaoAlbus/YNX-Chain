import {setWalletCopy} from './wallet-locale.mjs';
import {createBitcoinTransferUI} from './multichain-family-bitcoin-ui.mjs';
import {createBitcoinSubmissionUI} from './multichain-family-bitcoin-submit-ui.mjs';
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
  const tokenSection = make('details'), tokenTitle = make('summary', 'Import TRC20 token'), tokenLabel = make('label', 'Token contract'), tokenContract = make('input'), importToken = make('button', 'Import TRC20 token');
  tokenContract.id = 'family-token-contract'; tokenContract.autocomplete = 'off'; tokenContract.dir = 'ltr'; tokenLabel.htmlFor = tokenContract.id; importToken.type = 'button';
  tokenSection.append(tokenTitle, tokenLabel, tokenContract, importToken); content.append(tokenSection);
  const history = make('details'), historyTitle = make('summary', 'Transfer history'), historyRefresh = make('button', 'Refresh history'), records = make('div'); historyRefresh.type = 'button';
  history.append(historyTitle, historyRefresh, records, make('p', 'Block inclusion reported by RPC is not consensus finality. Unknown transactions are checked, never automatically resent.')); content.append(history);
  const transferUI=createBitcoinTransferUI({document,parent:content,api,getContext,getSelection:()=>({family:family.value,network:network.value}),isOpen:()=>sheet.open});
  const submissionUI=createBitcoinSubmissionUI({document,parent:content,api,getContext,getSelection:()=>({family:family.value,network:network.value}),isOpen:()=>sheet.open});
  function invalidate() { epoch++; busy = false; transferUI.invalidate(); submissionUI.invalidate(); address.value = ''; path.textContent = ''; status.textContent = ''; balance.textContent = ''; records.replaceChildren(); button.disabled = Boolean(getContext().locked); refresh.disabled = button.disabled; importToken.disabled = button.disabled; tokenSection.hidden = family.value !== 'tron'; }
  function showRecord(node, record) {
    node.replaceChildren(); const state = make('p'); setWalletCopy(state, 'Transaction status: {state}', {state: record.state}); node.append(state);
    if (record.txid) {const hash = make('p'); hash.dir = 'ltr'; hash.textContent = record.txid; node.append(hash);}
    if (record.evidence?.queryError) {const error = make('p'); error.textContent = record.evidence.queryError; node.append(error);}
    const check = make('button', 'Check original transaction'); check.type = 'button'; check.disabled = getContext().locked || !record.queryable; node.append(check);
    if(record.family==='bitcoin'&&record.state==='signed-unsubmitted'){const sendReview=make('button','Review transfer');sendReview.type='button';sendReview.disabled=getContext().locked;sendReview.addEventListener('click',()=>submissionUI.reviewOriginal(record.id));node.append(sendReview);}
    if(record.family==='bitcoin'&&record.state==='prepared'){
      const cancel=make('button','Cancel');cancel.type='button';node.append(cancel);
      cancel.addEventListener('click',async()=>{if(busy)return;const token=++epoch,context={...getContext()};busy=true;cancel.disabled=true;try{const reply=await api.familyBitcoinCancel({id:record.id});const current=getContext();if(token!==epoch||!sheet.open||current.account!==context.account||current.revision!==context.revision)return;if(!reply.ok){status.textContent=reply.error?.code??'FAMILY_CUSTODY_CONFLICT';return;}if(reply.value.id!==record.id||reply.value.state!=='cancelled')throw Error('FAMILY_RECOVERY_BINDING');showRecord(node,{...record,state:'cancelled',queryable:false});}catch(error){if(token===epoch)status.textContent=error.message??'FAMILY_CUSTODY_CONFLICT';}finally{if(token===epoch){busy=false;cancel.disabled=false;}}});
    }
    check.addEventListener('click', async () => {
      if (busy || getContext().locked || !record.queryable) return;
      const token = ++epoch, context = {...getContext()}; busy = true; check.disabled = true;
      try {
        const reply = await api.familyCheck({id: record.id}); const current = getContext();
        if (token !== epoch || !sheet.open || current.locked || current.account !== context.account || current.revision !== context.revision) return;
        if (!reply.ok) {status.textContent = reply.error?.code ?? 'FAMILY_QUERY_UNAVAILABLE'; return;}
        if (reply.value.id !== record.id || reply.value.family !== family.value || reply.value.network !== network.value || reply.value.txid !== record.txid) {status.textContent = 'FAMILY_RECOVERY_BINDING'; return;}
        showRecord(node, reply.value);
      } catch (error) {if (token === epoch) status.textContent = error.code ?? 'FAMILY_QUERY_UNAVAILABLE';}
      finally {if (token === epoch) {busy = false; check.disabled = getContext().locked || !record.queryable;}}
    });
  }
  historyRefresh.addEventListener('click', async () => {
    if (busy) return;
    const token = ++epoch, context = {...getContext()}; busy = true; historyRefresh.disabled = true; records.replaceChildren();
    try {
      const reply = await api.familyRecords({family: family.value, network: network.value}); const current = getContext();
      if (token !== epoch || !sheet.open || current.account !== context.account || current.revision !== context.revision) return;
      if (!reply.ok) {status.textContent = reply.error?.code ?? 'FAMILY_RECOVERY_UNAVAILABLE'; return;}
      for (const record of reply.value) {if (record.family !== family.value || record.network !== network.value) {status.textContent = 'FAMILY_RECOVERY_BINDING'; records.replaceChildren(); return;} const row = make('div'); showRecord(row, record); records.append(row);}
    } catch (error) {if (token === epoch) status.textContent = error.code ?? 'FAMILY_RECOVERY_UNAVAILABLE';}
    finally {if (token === epoch) busy = false; historyRefresh.disabled = false;}
  });
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
  tokenContract.addEventListener('input', invalidate);
  importToken.addEventListener('click', async () => {
    if (busy || getContext().locked || family.value !== 'tron') return;
    const token = ++epoch, context = {...getContext()}; busy = true; importToken.disabled = true; setWalletCopy(status, 'Checking account…');
    try {
      const reply = await api.familyToken({family: 'tron', network: network.value, contract: tokenContract.value.trim()});
      const current = getContext(); if (token !== epoch || !sheet.open || current.locked || current.account !== context.account || current.revision !== context.revision) return;
      if (!reply.ok) {status.textContent = reply.error?.code ?? 'FAMILY_TOKEN_READ_FAILED'; return;}
      if (reply.value.family !== 'tron' || reply.value.network !== network.value) {status.textContent = 'FAMILY_ACCOUNT_CHANGED'; return;}
      status.textContent = `${reply.value.name} (${reply.value.symbol}) · ${reply.value.decimals}`; tokenContract.value = ''; tokenSection.open = false;
    } catch (error) {if (token === epoch) status.textContent = error.code ?? 'FAMILY_TOKEN_READ_FAILED';}
    finally {if (token === epoch) {busy = false; importToken.disabled = Boolean(getContext().locked);}}
  });
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
      balance.textContent = [...reply.value.assets.map(asset => `${asset.display} ${asset.symbol}`), ...(reply.value.errors ?? []).map(error => `${error.symbol}: ${error.code}`)].join(' · ');
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
