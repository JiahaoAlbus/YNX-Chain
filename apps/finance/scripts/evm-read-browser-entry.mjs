import {
  createEvmProductSessionHttpProofWith,
  createEvmProductSessionLoginProofWith,
  createEvmProductSessionRevokeProofWith,
  createEvmProductSessionSigningRequest,
  parseEvmProductSession,
  parseEvmProductSessionChallenge,
} from '@ynx-chain/wallet-auth';

const SESSION_KEY = 'ynx.finance.evm-read.session.v1';
const PENDING_KEY = 'ynx.finance.evm-read.pending.v1';
const DEVICE_DATABASE = 'ynx-finance-evm-read-device-v1';
const DEVICE_STORE = 'keys';
const READ_PATH = '/api/evm-read/portfolio';
const REVOKE_PATH = '/api/wallet-login/revoke';
const EMPTY_BODY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const copy = Object.freeze({
  en: { disconnected: 'Read-only EVM account is not authorized. Standard Wallet and guest markets remain available.',
    ready: 'Read-only EVM account is authorized for this short session. This does not authorize private native Finance, orders, or transfers.',
    waiting: 'Confirm the exact Finance read-only request in the selected wallet.',
    denied: 'Read-only EVM account request was not approved. Standard Wallet remains connected.',
    degraded: 'Read-only EVM service is unavailable. Standard Wallet remains connected.',
    revoked: 'Read-only EVM session ended. Standard Wallet remains connected.',
    revokePending: 'Local read-only access stopped. Server revoke was not confirmed; the short session will expire.',
    expired: 'Read-only EVM session expired. Start a new request to continue.' },
  'zh-CN': { disconnected: 'EVM 账户只读访问未授权。标准钱包和访客市场仍可使用。',
    ready: '此短期会话已授权 EVM 账户只读访问；不授权原生 Finance 私有功能、订单或转账。',
    waiting: '请在所选钱包中确认 Finance 的精确只读请求。',
    denied: 'EVM 账户只读请求未获批准；标准钱包仍保持连接。',
    degraded: 'EVM 只读服务不可用；标准钱包仍保持连接。',
    revoked: 'EVM 只读会话已结束；标准钱包仍保持连接。',
    revokePending: '本地只读访问已停止，服务端撤销尚未确认；短期会话到期后失效。',
    expired: 'EVM 只读会话已过期，请重新发起请求。' },
});

let active = null;
let busy = false;
let revision = 0;
let statusKey = 'disconnected';

function language() { return document.querySelector('#finance-language')?.value === 'zh-CN' ? 'zh-CN' : 'en'; }
function message(key) { return copy[language()][key] || copy.en[key] || key; }
function status(key) {
  statusKey = key;
  const element = document.querySelector('#evm-read-state');
  if (element) element.textContent = message(key);
  render();
}
function render() {
  const standard = window.YNXFinanceWallet?.getStandardWalletState();
  const connected = standard?.status === 'connected' && standard.chainId === '0x1917';
  const begin = document.querySelector('#evm-read-begin');
  const read = document.querySelector('#evm-read-refresh');
  const end = document.querySelector('#evm-read-end');
  if (begin) { begin.hidden = !connected; begin.disabled = busy; }
  if (read) { read.hidden = !active; read.disabled = busy; }
  if (end) { end.hidden = !active; end.disabled = busy; }
  const state = document.querySelector('#evm-read-state');
  if (state) state.textContent = message(statusKey);
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''); }
function decode(value) {
  const text = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, '=')), character => character.charCodeAt(0));
}
function nowISO(value = Date.now()) { return new Date(value).toISOString(); }
function standardSnapshot() {
  const value = window.YNXFinanceWallet?.getStandardWalletState();
  if (value?.status !== 'connected' || value.chainId !== '0x1917' || !/^0x[0-9a-f]{40}$/u.test(value.account || '') || !['ynx-wallet', 'metamask'].includes(value.providerKind)) throw new Error('STANDARD_WALLET_NOT_CONNECTED');
  return { account: value.account, providerKind: value.providerKind, revision: window.YNXFinanceWallet.getStandardRevision() };
}
function unchanged(selected) {
  const current = standardSnapshot();
  if (current.account !== selected.account || current.providerKind !== selected.providerKind || current.revision !== selected.revision) throw new Error('STANDARD_WALLET_CHANGED');
}
function openDeviceStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DEVICE_STORE)) request.result.createObjectStore(DEVICE_STORE); };
    request.onerror = () => reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function deviceKey(deviceId, value) {
  const database = await openDeviceStore();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DEVICE_STORE, value ? 'readwrite' : 'readonly');
      const request = value ? transaction.objectStore(DEVICE_STORE).put(value, deviceId) : transaction.objectStore(DEVICE_STORE).get(deviceId);
      request.onerror = () => reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));
      transaction.onerror = () => reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));
      transaction.oncomplete = () => resolve(value || request.result);
    });
  } finally { database.close(); }
}
async function newDevice() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('DEVICE_KEY_INVALID');
  const compressed = new Uint8Array(33);
  compressed[0] = 2 | (raw[64] & 1);
  compressed.set(raw.slice(1, 33), 1);
  const deviceId = `finance-device-${randomToken()}`;
  await deviceKey(deviceId, pair.privateKey);
  return { deviceId, deviceKey: encode(compressed), privateKey: pair.privateKey };
}
function signer(privateKey) {
  return async ({ payload }) => encode(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, decode(payload))));
}
function clearLocal() {
  active = null;
  revision++;
  try { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(PENDING_KEY); } catch {}
  const summary = document.querySelector('#evm-read-summary');
  if (summary) summary.textContent = '';
  render();
}
async function jsonRequest(path, options) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000), ...options });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result?.code || `HTTP_${response.status}`), { status: response.status });
  return result;
}
async function begin() {
  if (busy) return;
  busy = true; render();
  let requestId = '';
  try {
    const selected = standardSnapshot();
    const device = await newDevice();
    unchanged(selected);
    const issued = await jsonRequest('/api/evm-read/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: selected.account, providerKind: selected.providerKind, deviceId: device.deviceId, deviceKey: device.deviceKey }) });
    const challenge = parseEvmProductSessionChallenge(issued.challenge);
    unchanged(selected);
    const expectedSigningRequest = createEvmProductSessionSigningRequest(challenge);
    if (issued.schemaVersion !== 'finance-evm-read-challenge-v1' || issued.privateFinanceAuthorized !== false || challenge.account !== selected.account || challenge.providerKind !== selected.providerKind || challenge.deviceId !== device.deviceId || challenge.deviceKey !== device.deviceKey || JSON.stringify(issued.signingRequest) !== JSON.stringify(expectedSigningRequest)) throw new Error('CHALLENGE_BINDING_MISMATCH');
    requestId = challenge.requestId;
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ requestId, account: selected.account, deviceId: device.deviceId, expiresAt: challenge.expiresAt }));
    status('waiting');
    const walletSignature = await window.YNXFinanceWallet.signEVMLoginRequest(issued.signingRequest);
    unchanged(selected);
    const proof = await createEvmProductSessionLoginProofWith(challenge, walletSignature, signer(device.privateKey));
    unchanged(selected);
    const response = await jsonRequest('/api/evm-read/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proof }) });
    const session = parseEvmProductSession(response.session);
    if (response.schemaVersion !== 'finance-evm-read-session-v1' || response.evmAccountReadAuthorized !== true || response.privateFinanceAuthorized !== false || response.extensionLiveStateAttested !== false || session.account !== selected.account || session.deviceId !== device.deviceId || session.deviceKey !== device.deviceKey) throw new Error('SESSION_BINDING_MISMATCH');
    active = { session, deviceId: device.deviceId, account: selected.account, providerKind: selected.providerKind };
    try { unchanged(selected); } catch (error) { await revoke(); throw error; }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(active));
    sessionStorage.removeItem(PENDING_KEY);
    revision++;
    status('ready');
    await read();
  } catch (error) {
    if (!active) status(error?.code === 4001 ? 'denied' : 'degraded');
  } finally {
    if (requestId) {
      try { const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); if (pending?.requestId === requestId) sessionStorage.removeItem(PENDING_KEY); } catch {}
    }
    busy = false; render();
  }
}
async function read() {
  if (!active) return null;
  const current = active, at = Date.now(), expiresAt = Math.min(at + 30000, Date.parse(current.session.expiresAt));
  if (expiresAt <= at) { clearLocal(); status('expired'); return null; }
  try {
    const selected = standardSnapshot();
    if (selected.account !== current.account || selected.providerKind !== current.providerKind) throw new Error('STANDARD_WALLET_CHANGED');
    const privateKey = await deviceKey(current.deviceId);
    if (!privateKey) throw new Error('DEVICE_KEY_UNAVAILABLE');
    const proof = await createEvmProductSessionHttpProofWith(current.session, { method: 'GET', target: READ_PATH, bodyDigest: EMPTY_BODY_DIGEST, nonce: randomToken(), issuedAt: nowISO(at), expiresAt: nowISO(expiresAt) }, signer(privateKey));
    if (active !== current || window.YNXFinanceWallet.getStandardRevision() !== selected.revision) throw new Error('STANDARD_WALLET_CHANGED');
    const data = await jsonRequest(READ_PATH, { method: 'GET', headers: { 'X-YNX-EVM-Read-Proof': encode(new TextEncoder().encode(JSON.stringify(proof))) } });
    if (active !== current || window.YNXFinanceWallet.getStandardRevision() !== selected.revision || data?.schemaVersion !== 'finance-evm-account-read-v1' || data.account !== current.account || data.evmAccountReadAuthorized !== true || data.privateFinanceAuthorized !== false || data.extensionLiveStateAttested !== false) throw new Error('READ_BINDING_MISMATCH');
    const portfolio = data.portfolio;
    const summary = document.querySelector('#evm-read-summary');
    if (summary) summary.textContent = portfolio?.explorerStatus?.available === true ? `${current.account} · ${portfolio.balanceYnxt} YNXT · Explorer` : `${current.account} · Explorer data unavailable`;
    status('ready');
    return data;
  } catch {
    if (active === current) status('degraded');
    return null;
  }
}
async function revoke() {
  const previous = active;
  if (!previous) return;
  clearLocal();
  try {
    const privateKey = await deviceKey(previous.deviceId);
    if (!privateKey) throw new Error('DEVICE_KEY_UNAVAILABLE');
    const at = Date.now(), expiresAt = Math.min(at + 30000, Date.parse(previous.session.expiresAt));
    if (expiresAt <= at) { status('expired'); return; }
    const proof = await createEvmProductSessionRevokeProofWith(previous.session, { bodyDigest: EMPTY_BODY_DIGEST, nonce: randomToken(), issuedAt: nowISO(at), expiresAt: nowISO(expiresAt) }, signer(privateKey));
    const result = await jsonRequest(REVOKE_PATH, { method: 'POST', headers: { 'X-YNX-EVM-Read-Proof': encode(new TextEncoder().encode(JSON.stringify(proof))) }, body: '' });
    status(result?.revoked === true && result.standardWalletUnchanged === true ? 'revoked' : 'revokePending');
  } catch { status('revokePending'); }
}
async function restore() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!stored) { status('disconnected'); return; }
    const session = parseEvmProductSession(stored.session);
    if (session.account !== stored.account || session.deviceId !== stored.deviceId || !await deviceKey(stored.deviceId)) throw new Error('SESSION_RESTORE_INVALID');
    if (Date.parse(session.expiresAt) <= Date.now()) { clearLocal(); status('expired'); return; }
    let selected;
    try { selected = standardSnapshot(); } catch {}
    if (!selected || session.account !== selected.account || stored.providerKind !== selected.providerKind) {
      active = { session, deviceId: stored.deviceId, account: stored.account, providerKind: stored.providerKind };
      await revoke();
      return;
    }
    active = { session, deviceId: stored.deviceId, account: selected.account, providerKind: selected.providerKind };
    status('ready');
  } catch { clearLocal(); status('disconnected'); }
}
async function onStandardChange(event) {
  const previous = active;
  if (!previous) { render(); return; }
  const next = event.detail;
  if (next?.status !== 'connected' || next.account !== previous.account || next.chainId !== '0x1917' || next.providerKind !== previous.providerKind) await revoke();
  render();
}
async function boot() {
  await window.YNXFinanceWallet?.ready;
  document.querySelector('#evm-read-begin')?.addEventListener('click', begin);
  document.querySelector('#evm-read-refresh')?.addEventListener('click', read);
  document.querySelector('#evm-read-end')?.addEventListener('click', revoke);
  document.querySelector('#finance-language')?.addEventListener('change', render);
  window.addEventListener('ynx-finance-standard-state', onStandardChange);
  await restore();
}

window.YNXFinanceEVMRead = Object.freeze({ begin, read, revoke, restore, state: () => ({ active: Boolean(active), account: active?.account || null, expiresAt: active?.session.expiresAt || null, revision }) });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
