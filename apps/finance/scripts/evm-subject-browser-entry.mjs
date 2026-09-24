import {
  createFinanceEvmSubjectHttpProofWith,
  createFinanceEvmSubjectLoginProofWith,
  createFinanceEvmSubjectRevokeProofWith,
  financeEvmSubjectSigningRequest,
  parseFinanceEvmSubjectChallenge,
  parseFinanceEvmSubjectSession,
} from '@ynx-chain/wallet-auth';

const SESSION_KEY = 'ynx.finance.evm-subject.session.v1';
const PENDING_KEY = 'ynx.finance.evm-subject.pending.v1';
const DEVICE_DATABASE = 'ynx-finance-evm-subject-device-v1';
const DEVICE_STORE = 'keys';
const READ_PATH = '/api/evm-subject/identity';
const REVOKE_PATH = '/api/evm-subject/revoke';
const EMPTY_BODY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const messages = Object.freeze({
  en: { heading: 'Private EVM-only identity', explanation: 'Optional five-minute access to your EVM-only Finance identity. This does not link a native account or authorize Broker orders, transfers, or trading.', begin: 'Authorize EVM-only identity', read: 'Refresh identity', end: 'End EVM-only session',
    disconnected: 'Not authorized. Standard Wallet and public markets remain available.', waiting: 'Confirm this exact Finance identity request in your selected wallet.', ready: 'EVM-only identity verified. Native Finance and Broker remain separate.', denied: 'Identity request rejected. Standard Wallet remains connected.', degraded: 'Private identity service is unavailable. Standard Wallet remains connected.', revoked: 'EVM-only session ended. Standard Wallet remains connected.', revokePending: 'Local access stopped; server revocation could not be confirmed. The session expires within five minutes.', expired: 'EVM-only session expired.' },
  'zh-CN': { heading: '仅 EVM 私有身份', explanation: '可选的五分钟 EVM-only Finance 身份访问；不关联原生账户，也不授权 Broker 订单、转账或交易。', begin: '授权 EVM-only 身份', read: '刷新身份', end: '结束 EVM-only 会话',
    disconnected: '尚未授权。标准钱包及公开市场仍可用。', waiting: '请在所选钱包中确认这项 Finance 身份请求。', ready: 'EVM-only 身份已验证；原生 Finance 与 Broker 保持独立。', denied: '身份请求已拒绝；标准钱包保持连接。', degraded: '私有身份服务不可用；标准钱包保持连接。', revoked: 'EVM-only 会话已结束；标准钱包保持连接。', revokePending: '本地访问已停止；服务端撤销未获确认。会话将在五分钟内过期。', expired: 'EVM-only 会话已过期。' },
});

let active = null;
let busy = false;
let stateKey = 'disconnected';
let revision = 0;
const language = () => document.querySelector('#finance-language')?.value === 'zh-CN' ? 'zh-CN' : 'en';
const label = key => messages[language()][key] || messages.en[key] || key;
function render() {
  for (const [id, key] of [['#evm-subject-heading', 'heading'], ['#evm-subject-explanation', 'explanation'], ['#evm-subject-begin', 'begin'], ['#evm-subject-read', 'read'], ['#evm-subject-end', 'end'], ['#evm-subject-state', stateKey]]) {
    const element = document.querySelector(id);
    if (element) element.textContent = label(key);
  }
  const standard = window.YNXFinanceWallet?.getStandardWalletState?.();
  const connected = standard?.status === 'connected' && standard.chainId === '0x1917';
  const beginButton = document.querySelector('#evm-subject-begin');
  const readButton = document.querySelector('#evm-subject-read');
  const endButton = document.querySelector('#evm-subject-end');
  if (beginButton) { beginButton.hidden = !connected || Boolean(active); beginButton.disabled = busy; }
  if (readButton) { readButton.hidden = !active; readButton.disabled = busy; }
  if (endButton) { endButton.hidden = !active; endButton.disabled = busy; }
}
function status(key) { stateKey = key; render(); }
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), character => character.charCodeAt(0));
const nowISO = value => new Date(value).toISOString();
function selectedWallet() {
  const state = window.YNXFinanceWallet?.getStandardWalletState?.();
  if (state?.status !== 'connected' || state.chainId !== '0x1917' || !/^0x[0-9a-f]{40}$/u.test(state.account || '') || !['ynx-wallet', 'metamask'].includes(state.providerKind)) throw new Error('STANDARD_WALLET_NOT_CONNECTED');
  return { account: state.account, providerKind: state.providerKind, revision: window.YNXFinanceWallet.getStandardRevision() };
}
function unchanged(selected) {
  const current = selectedWallet();
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
  const deviceId = `finance-subject-device-${randomToken()}`;
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
  const summary = document.querySelector('#evm-subject-summary');
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
  if (busy || active) return;
  busy = true; render();
  let requestId = '';
  try {
    const selected = selectedWallet();
    const device = await newDevice();
    unchanged(selected);
    const issued = await jsonRequest('/api/evm-subject/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: selected.account, accountType: 'eoa', deviceId: device.deviceId, deviceKey: device.deviceKey }) });
    const challenge = parseFinanceEvmSubjectChallenge(issued.challenge);
    const expected = financeEvmSubjectSigningRequest(challenge);
    unchanged(selected);
    if (issued.schemaVersion !== 'finance-evm-subject-challenge-v1' || issued.brokerAuthorized !== false || challenge.account !== selected.account || challenge.accountType !== 'eoa' || challenge.deviceId !== device.deviceId || challenge.deviceKey !== device.deviceKey || JSON.stringify(issued.signingRequest) !== JSON.stringify(expected)) throw new Error('CHALLENGE_BINDING_MISMATCH');
    requestId = challenge.requestId;
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ requestId, account: selected.account, deviceId: device.deviceId, expiresAt: challenge.expiresAt }));
    status('waiting');
    const walletSignature = await window.YNXFinanceWallet.signEVMLoginRequest(issued.signingRequest);
    unchanged(selected);
    const proof = await createFinanceEvmSubjectLoginProofWith(challenge, walletSignature, signer(device.privateKey));
    const response = await jsonRequest('/api/evm-subject/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proof }) });
    const session = parseFinanceEvmSubjectSession(response.session);
    unchanged(selected);
    if (response.schemaVersion !== 'finance-evm-subject-session-v1' || response.evmSubjectReadAuthorized !== true || response.brokerAuthorized !== false || session.nativeAccount !== null || session.account !== selected.account || session.deviceId !== device.deviceId || session.deviceKey !== device.deviceKey) throw new Error('SESSION_BINDING_MISMATCH');
    active = { session, deviceId: device.deviceId, account: selected.account, providerKind: selected.providerKind };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(active));
    sessionStorage.removeItem(PENDING_KEY);
    revision++;
    status('ready');
    await read();
  } catch (error) {
    if (!active) status(error?.code === 4001 ? 'denied' : 'degraded');
  } finally {
    if (requestId) { try { const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); if (pending?.requestId === requestId) sessionStorage.removeItem(PENDING_KEY); } catch {} }
    busy = false; render();
  }
}
async function read() {
  if (!active) return null;
  const current = active, at = Date.now(), expiresAt = Math.min(at + 30000, Date.parse(current.session.expiresAt));
  if (expiresAt <= at) { clearLocal(); status('expired'); return null; }
  try {
    const selected = selectedWallet();
    if (selected.account !== current.account || selected.providerKind !== current.providerKind) throw new Error('STANDARD_WALLET_CHANGED');
    const privateKey = await deviceKey(current.deviceId);
    if (!privateKey) throw new Error('DEVICE_KEY_UNAVAILABLE');
    const proof = await createFinanceEvmSubjectHttpProofWith(current.session, { method: 'GET', target: READ_PATH, bodyDigest: EMPTY_BODY_DIGEST, nonce: randomToken(), issuedAt: nowISO(at), expiresAt: nowISO(expiresAt) }, signer(privateKey));
    if (active !== current || window.YNXFinanceWallet.getStandardRevision() !== selected.revision) throw new Error('STANDARD_WALLET_CHANGED');
    const data = await jsonRequest(READ_PATH, { method: 'GET', headers: { 'X-YNX-EVM-Subject-Proof': encode(new TextEncoder().encode(JSON.stringify(proof))) } });
    if (active !== current || window.YNXFinanceWallet.getStandardRevision() !== selected.revision || data?.schemaVersion !== 'finance-evm-subject-identity-v1' || data.evmAccount !== current.account || data.subjectId !== current.session.subjectId || data.nativeAccount !== null || data.brokerAuthorized !== false) throw new Error('READ_BINDING_MISMATCH');
    const summary = document.querySelector('#evm-subject-summary');
    if (summary) summary.textContent = `${current.account} · ${data.subjectId} · EVM-only`;
    status('ready');
    return data;
  } catch { if (active === current) status('degraded'); return null; }
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
    const proof = await createFinanceEvmSubjectRevokeProofWith(previous.session, { bodyDigest: EMPTY_BODY_DIGEST, nonce: randomToken(), issuedAt: nowISO(at), expiresAt: nowISO(expiresAt) }, signer(privateKey));
    const result = await jsonRequest(REVOKE_PATH, { method: 'POST', headers: { 'X-YNX-EVM-Subject-Proof': encode(new TextEncoder().encode(JSON.stringify(proof))) }, body: '' });
    status(result?.revoked === true && result.standardWalletUnchanged === true ? 'revoked' : 'revokePending');
  } catch { status('revokePending'); }
}
async function restore() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch {}
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!stored) { status('disconnected'); return; }
    const session = parseFinanceEvmSubjectSession(stored.session);
    if (session.account !== stored.account || session.deviceId !== stored.deviceId || !await deviceKey(stored.deviceId)) throw new Error('SESSION_RESTORE_INVALID');
    if (Date.parse(session.expiresAt) <= Date.now()) { clearLocal(); status('expired'); return; }
    let selected;
    try { selected = selectedWallet(); } catch {}
    active = { session, deviceId: stored.deviceId, account: stored.account, providerKind: stored.providerKind };
    if (!selected || selected.account !== stored.account || selected.providerKind !== stored.providerKind) { await revoke(); return; }
    status('ready');
  } catch { clearLocal(); status('disconnected'); }
}
async function onStandardChange(event) {
  if (active && (event.detail?.status !== 'connected' || event.detail.account !== active.account || event.detail.chainId !== '0x1917' || event.detail.providerKind !== active.providerKind)) await revoke();
  render();
}
async function boot() {
  await window.YNXFinanceWallet?.ready;
  document.querySelector('#evm-subject-begin')?.addEventListener('click', begin);
  document.querySelector('#evm-subject-read')?.addEventListener('click', read);
  document.querySelector('#evm-subject-end')?.addEventListener('click', revoke);
  document.querySelector('#finance-language')?.addEventListener('change', render);
  window.addEventListener('ynx-finance-standard-state', onStandardChange);
  await restore();
}

window.YNXFinanceEVMSubject = Object.freeze({ begin, read, revoke, restore, state: () => ({ active: Boolean(active), account: active?.account || null, subjectId: active?.session.subjectId || null, revision }) });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
