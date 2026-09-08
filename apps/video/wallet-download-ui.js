import {ready, t} from './i18n.js';
import {verifiedWalletDownloads, suggestedWalletDownload} from './wallet-downloads.js';

const select = document.querySelector('#wallet-download-choice');
const primary = document.querySelector('#get-wallet');
const details = document.querySelector('#wallet-download-details');
const limits = document.querySelector('#wallet-download-limits');
let artifacts = [], selected = null;

function choose() {
  selected = artifacts.find(row => row.id === select.value) || null;
  primary.removeAttribute('href'); primary.removeAttribute('download'); primary.setAttribute('aria-disabled', 'true');
  if (!selected) { details.textContent = t('downloadChooseHint'); limits.textContent = ''; return; }
  primary.href = selected.url; primary.download = selected.filename; primary.removeAttribute('aria-disabled');
  details.textContent = `${selected.filename} · ${(selected.bytes / 1048576).toFixed(1)} MB`;
  const limitKey = selected.platform === 'macos' ? 'downloadMac' : selected.platform === 'web-extension' ? 'downloadExtension' : selected.platform === 'android' ? 'downloadAndroid' : selected.installation === 'appimage' ? 'downloadAppImage' : 'downloadNative';
  limits.textContent = t(limitKey);
}

// Late EVM-install hints share the selected direct link. No redirect, account
// request or download occurs until the user explicitly activates an anchor.
document.addEventListener('click', event => {
  const link = event.target.closest?.('[data-wallet-download-shortcut]');
  if (!link) return;
  if (!selected) { event.preventDefault(); select.focus(); return; }
  link.href = selected.url; link.download = selected.filename;
}, true);

try {
  await ready;
  const read = async name => {
    const response = await fetch(new URL(name, import.meta.url), {cache:'no-store'});
    if (!response.ok) throw new Error('Wallet releases unavailable');
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 1048576) throw new Error('Wallet release metadata exceeds its limit');
    return text;
  };
  const [manifest, preview] = await Promise.all([read('./wallet-download-manifest.json'), read('./wallet-download-preview.json')]);
  artifacts = verifiedWalletDownloads(manifest, JSON.parse(preview));
  const labels = {'web-extension':'Chrome / Edge', macos:'macOS', windows:'Windows', linux:'Linux', android:'Android'};
  select.replaceChildren(new Option(t('downloadChoose'), ''), ...artifacts.map(row => new Option(`${labels[row.platform] || row.platform} · ${row.architecture} · ${row.installation === 'extension-unpacked' ? 'ZIP' : row.installation.toUpperCase()}`, row.id)));
  select.value = suggestedWalletDownload(artifacts, navigator) || '';
  select.disabled = false; select.onchange = choose; choose();
} catch {
  details.textContent = t('downloadUnavailable');
  primary.removeAttribute('href'); primary.setAttribute('aria-disabled','true');
}
