#!/usr/bin/env node
// Runtime-only gate. No injected provider, cookies, JavaScript, Pair API or URI.
// --run is intentionally unavailable on local/user devices. Only receipt.json
// may be uploaded. Raw UI, pairing text, PIN, QR and logcat are never saved.
// Synthetic backup alone is private, runner-local and deleted before receipt.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomInt} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
export const APK = Object.freeze({
  url: 'https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-android-testnet-preview-1.0.28-a9fff0d84/ynx-wallet-1.0.28-a9fff0d84-local-test-signed.apk',
  bytes: 117057650, sha256: '78c7221821add4cba78ece2069fea05a98b7c15cc3ba3e93a25fc0b0214f8509',
  certificate: 'd4e562610ecb4e304fa00ee07e7adae7da862ce108bda7bdfe933c28831f154e',
  package: 'com.ynxweb4.wallet', version: '1.0.28-testnet-preview', code: 34,
  source: 'a9fff0d84fe0e4b67a520136ab9c8d4721f6c23e',
});
const FINANCE = 'https://finance.ynxweb4.com';
const FINANCE_RECOVERY_PANEL = 'More account permissions and recovery';
const BROWSER = 'com.android.chrome';
const delay = ms => new Promise(r => setTimeout(r, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
class GateError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new GateError(code); };
const check = (condition, code) => { if (!condition) fail(code); };
const safeCode = value => /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : 'UNCLASSIFIED_GATE_FAILURE';

export function hostedOnly(env = process.env, platform = process.platform) {
  check(platform === 'linux' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.YNX_ANDROID_QA_EPHEMERAL === '1', 'DISPOSABLE_HOSTED_RUNNER_REQUIRED');
  check(env.YNX_ANDROID_QA_SERIAL === 'emulator-5554', 'EXACT_DISPOSABLE_SERIAL_REQUIRED');
}
function tempPath(envName) {
  const base = process.env.RUNNER_TEMP;
  const p = process.env[envName];
  check(base && path.isAbsolute(base) && p && path.isAbsolute(p) && path.dirname(p) === base, 'RUNNER_TEMP_PATH_REQUIRED');
  return p;
}
async function quiet(command, args, timeout = 20000) {
  try { return (await exec(command, args, {timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8'})).stdout; }
  catch { fail('COMMAND_FAILED_NO_RAW_OUTPUT'); } // child errors can contain secrets/URIs
}
async function verifyApk(file) {
  const bytes = await fs.readFile(file);
  check(bytes.length === APK.bytes && sha(bytes) === APK.sha256, 'IMMUTABLE_APK_IDENTITY_MISMATCH');
  const tools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools', '36.0.0');
  const certificate = await quiet(path.join(tools, 'apksigner'), ['verify', '--print-certs', file]);
  check(certificate.includes(`certificate SHA-256 digest: ${APK.certificate}`), 'APK_CERTIFICATE_MISMATCH');
  const manifest = await quiet(path.join(tools, 'aapt'), ['dump', 'badging', file]);
  check(manifest.includes(`name='${APK.package}' versionCode='${APK.code}' versionName='${APK.version}'`), 'APK_PACKAGE_VERSION_MISMATCH');
}
async function fetchApk() {
  hostedOnly();
  const dest = tempPath('YNX_ANDROID_QA_APK');
  const response = await fetch(APK.url, {signal: AbortSignal.timeout(120000)});
  check(response.ok, 'OFFICIAL_APK_DOWNLOAD_FAILED');
  const bytes = Buffer.from(await response.arrayBuffer());
  check(bytes.length === APK.bytes && sha(bytes) === APK.sha256, 'IMMUTABLE_APK_IDENTITY_MISMATCH');
  await fs.writeFile(dest, bytes, {mode: 0o600, flag: 'wx'});
  console.log('IMMUTABLE_PUBLIC_APK_HASH_AND_BYTES_VERIFIED');
}

const decode = value => String(value || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export function parseUI(xml) {
  const nodes = [], stack = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === '</node>') { stack.pop(); continue; }
    const n = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(v => [v[1], decode(v[2])]));
    n.parent = stack.at(-1); nodes.push(n); if (!m[2]) stack.push(n);
  }
  return nodes;
}
export function box(node) {
  const m = String(node?.bounds).match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b[2] > b[0] && b[3] > b[1] ? b : null;
}
function visible(n) { return n.enabled !== 'false' && !!box(n); }
const has = (nodes, text) => nodes.some(n => visible(n) && (n.text === text || n['content-desc'] === text));
export function target(nodes, label) {
  const targets = [];
  for (let n of nodes.filter(n => n.text === label || n['content-desc'] === label)) {
    if (!visible(n)) continue;
    while (n && n.clickable !== 'true') n = n.parent;
    if (n && visible(n) && !targets.some(t => t.bounds === n.bounds)) targets.push(n);
  }
  check(targets.length === 1, 'UI_TARGET_NOT_UNIQUE_OR_VISIBLE');
  return targets[0];
}
export function chromeFirstRunState(nodes) {
  const firstPackage=nodes.find(n=>visible(n)&&n.package)?.package;
  if(firstPackage!==BROWSER)return {foregroundChrome:false, explicitAcceptTerms:false, accountSetup:false, skipAccount:false};
  const chrome=nodes.filter(n=>n.package===BROWSER);
  return {foregroundChrome:true, explicitAcceptTerms:has(chrome,'Accept & continue'),
    accountSetup:['Make Chrome your own','Make Chrome your own.','Use without an account','Sign in to Chrome'].some(t=>has(chrome,t)),
    skipAccount:has(chrome,'Use without an account')};
}
export function safeUiEvidence(nodes) {
  // NEVER return unknown text, accessibility labels, request parameters or URI.
  const codes = nodes.flatMap(n => [...String(n.text || '').matchAll(/\b(?:YNX_PAIR_[A-Z_]{1,50}|ERR_[A-Z_]{1,50})\b/g)].map(m => m[0]));
  if (has(nodes, 'This request expired. Start again when you are ready.')) codes.push('PAIR_EXPIRED_UI');
  return {codes: [...new Set(codes)], qrOnly: has(nodes, 'Scan QR code'), openApp: has(nodes, 'Open YNX Wallet app'),
    locked: has(nodes, 'WALLET LOCKED'), connectReview: has(nodes, 'Connect this app?'), messageReview: has(nodes, 'Sign a message'),
    chromeFirstRun: chromeFirstRunState(nodes)};
}
export function safeSignInReview(nodes) {
  const prefix = 'YNX EVM Product Session authorization v1\n';
  const messages = nodes.filter(visible).map(n => n.text || '').filter(t => t.startsWith(prefix));
  if (!has(nodes, 'Sign a message') || messages.length !== 1) return false;
  try {
    const c = JSON.parse(messages[0].slice(prefix.length));
    const fields = ['version','chainId','account','productId','origin','callback','scope','deviceId','deviceAlgorithm','deviceKey','nonce','state','requestId','providerKind','issuedAt','expiresAt'];
    return JSON.stringify(Object.keys(c).sort()) === JSON.stringify(fields.sort()) &&
      c.version === '1' && c.chainId === 6423 && c.productId === 'finance' && c.origin === FINANCE &&
      c.callback === `${FINANCE}/wallet-auth/callback` && c.scope === 'finance.account.read' &&
      c.providerKind === 'ynx-wallet' && c.deviceAlgorithm === 'p256-sha256' && /^0x[0-9a-fA-F]{40}$/.test(c.account) &&
      /^[A-Za-z0-9._:-]{8,128}$/.test(c.deviceId) && /^[A-Za-z0-9_-]{44}$/.test(c.deviceKey) &&
      ['nonce','state'].every(k => /^[A-Za-z0-9_-]{32,64}$/.test(c[k])) && /^[A-Za-z0-9._~-]{16,128}$/.test(c.requestId) &&
      Number.isFinite(Date.parse(c.issuedAt)) && Date.parse(c.issuedAt) <= Date.now()+30000 && Date.parse(c.expiresAt) > Date.now() &&
      Date.parse(c.expiresAt) > Date.parse(c.issuedAt) && Date.parse(c.expiresAt) - Date.parse(c.issuedAt) <= 300000;
  } catch { return false; }
}
export function complete(checks) {
  return ['apk', 'disposableDevice', 'browserReady', 'biometricSetup', 'accountCreated', 'backup', 'coldAccountPreserved',
    'normalAppLink', 'realProposal', 'rejectReturned', 'approveReturned', 'noFundsReview', 'signatureReturned',
    'nativeSessionRestored', 'readOnlyIdentityRestored', 'backendReadRefreshed', 'sessionRecovered', 'browserRestored',
    'disconnected', 'nativeDisconnectObserved', 'finalLocked'].every(k => checks[k] === true);
}

const READ_READY = 'Read-only EVM account is authorized for this short session. This does not authorize private native Finance, orders, or transfers.';
export function readOnlyUiState(nodes, account) {
  check(/^0x[0-9a-fA-F]{40}$/.test(account), 'EXPECTED_READ_ONLY_IDENTITY_REQUIRED');
  const summaries = nodes.filter(visible).map(n => n.text || '').filter(t => /^0x[0-9a-fA-F]{40} · /.test(t));
  const summary = summaries.length === 1 ? summaries[0] : '';
  const sameIdentity = summary.startsWith(account + ' · ');
  const response = sameIdentity && (/ · [0-9]+(?:\.[0-9]+)? YNXT · Explorer$/.test(summary) || summary === account + ' · Explorer data unavailable');
  const needsApproval = ['Confirm the exact Finance read-only request in the selected wallet.', 'Sign a message',
    'Read-only EVM account is not authorized. Standard Wallet and guest markets remain available.',
    'Read-only EVM session expired. Start a new request to continue.',
    'Read-only EVM account request was not approved. Standard Wallet remains connected.'].some(t => has(nodes, t)) ||
    nodes.some(n => visible(n) && (n.password === 'true' || /^(?:username|password|email address)$/i.test(n.text || n['content-desc'] || '')));
  return {ready: has(nodes, READ_READY) && response && !needsApproval, sameIdentity,
    loading: has(nodes, 'Refresh account view') && has(nodes, 'Checking sources') && !has(nodes, READ_READY) && !summary, needsApproval,
    degraded: has(nodes, 'Read-only EVM service is unavailable. Standard Wallet remains connected.')};
}
export async function cleanupPrivateBackup(dir, backupCreated, runnerTemp = process.env.RUNNER_TEMP, io = fs) {
  // Only the exact dedicated directory created by this run; never recursive.
  check(path.isAbsolute(dir) && path.dirname(dir) === runnerTemp && path.basename(dir).startsWith('ynx-private-synthetic-'), 'PRIVATE_CLEANUP_PATH_NOT_OWNED');
  const result = {backupRemoved:false, backupNeverCreated:false, directoryRemoved:false, confirmed:false};
  try {
    try { await io.unlink(path.join(dir, 'recovery.private')); result.backupRemoved = true; }
    catch (error) { if (error?.code !== 'ENOENT' || backupCreated) throw error; result.backupNeverCreated = true; }
    await io.rmdir(dir); result.directoryRemoved = true; result.confirmed = true;
  } catch { /* preserve primary failure; caller records cleanup separately */ }
  return result;
}
export function retainCleanupResult(receipt, result) {
  receipt.privateQaCleanup = result;
  receipt.privateQaBackupRemovedAtRunnerEnd = result.backupRemoved;
  if (!result.confirmed) {
    receipt.cleanupFailureCode = 'PRIVATE_BACKUP_CLEANUP_NOT_CONFIRMED';
    receipt.status = 'FAIL_CLOSED'; receipt.failureCode ??= receipt.cleanupFailureCode; receipt.fullJourney = false;
  }
  return result.confirmed;
}

export class Driver {
  constructor(serial) { this.serial = serial; }
  adb(args, timeout) { return quiet('adb', ['-s', this.serial, ...args], timeout); }
  async ui() { return parseUI(await this.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'])); }
  async tap(label, nodes) {
    nodes ??= await this.ui();
    const b = box(target(nodes, label));
    await this.adb(['shell', 'input', 'tap', String(Math.floor((b[0] + b[2]) / 2)), String(Math.floor((b[1] + b[3]) / 2))]);
  }
  async wait(predicate, code, ms = 45000, {skipChromeAccountSetup=false}={}) {
    let accountSkipClicks=0;
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const nodes = await this.ui();
      const evidence = safeUiEvidence(nodes);
      if (evidence.chromeFirstRun.explicitAcceptTerms) fail('CHROME_EXPLICIT_TERMS_ACCEPTANCE_REQUIRED');
      if(evidence.chromeFirstRun.accountSetup){
        if(skipChromeAccountSetup && evidence.chromeFirstRun.skipAccount && accountSkipClicks++===0){await this.tap('Use without an account',nodes);await delay(300);continue;}
        fail('CHROME_ACCOUNT_SETUP_NORMAL_SKIP_NOT_AVAILABLE');
      }
      if (evidence.codes.length) fail(safeCode(evidence.codes[0]));
      if (predicate(nodes)) return nodes;
      await delay(300);
    }
    fail(code);
  }
  async find(label) {
    let nodes = await this.ui();
    if (has(nodes, label)) return nodes;
    for (let i = 0; i < 5; i++) {
      const scroll = nodes.find(n => n.scrollable === 'true' && box(n));
      if (!scroll) break;
      const b = box(scroll), x = Math.floor((b[0] + b[2]) / 2);
      await this.adb(['shell', 'input', 'swipe', String(x), String(b[3] - 120), String(x), String(b[1] + 160), '400']);
      nodes = await this.ui(); if (has(nodes, label)) return nodes;
    }
    fail('NORMAL_UI_ACTION_NOT_AVAILABLE');
  }
  async type(value) { await this.adb(['shell', 'input', 'text', value]); }
  async fingerprint() {
    for (let i = 0; i < 8; i++) {
      const n = await this.ui();
      if (has(n, 'Fingerprint sensor')) await this.adb(['emu', 'finger', 'touch', '1']);
      else return n;
    }
    fail('BIOMETRIC_AUTH_NOT_COMPLETED');
  }
  async unlock() {
    const n = await this.ui(); if (has(n, 'NATIVE ACCOUNT') || has(n, 'Connected apps') || has(n, 'Connect this app?') || has(n, 'Sign a message')) return;
    await this.tap('Unlock with biometrics', await this.wait(a => has(a, 'Unlock with biometrics'), 'WALLET_LOCKED_UI_MISSING'));
    await this.wait(a => has(a, 'Fingerprint sensor'), 'SYSTEM_BIOMETRIC_PROMPT_MISSING');
    await this.fingerprint(); await this.wait(a => has(a, 'NATIVE ACCOUNT') || has(a, 'Connected apps') || has(a, 'Connect this app?') || has(a, 'Sign a message'), 'NATIVE_ACCOUNT_UNLOCK_FAILED');
  }
  async browser() {
    let n = await this.ui(); if (n.some(a => a.class === 'android.webkit.WebView' && a.text === 'YNX Finance')) return;
    await this.adb(['shell', 'input', 'keyevent', 'KEYCODE_APP_SWITCH']);
    n = await this.wait(a => has(a, 'Chrome'), 'NORMAL_RECENTS_CHROME_NOT_AVAILABLE', 12000);
    await this.tap('Chrome', n);
    await this.wait(a => a.some(v => v.class === 'android.webkit.WebView' && v.text === 'YNX Finance'), 'ORIGINAL_FINANCE_TAB_NOT_RETURNED');
  }
  async wallet() {
    const n = await this.ui(); if (n.some(a => a.package === APK.package)) return;
    await this.adb(['shell', 'input', 'keyevent', 'KEYCODE_APP_SWITCH']);
    await this.tap('YNX Wallet', await this.wait(a => has(a, 'YNX Wallet'), 'NORMAL_RECENTS_WALLET_NOT_AVAILABLE', 12000));
    await this.wait(a => a.some(v => v.package === APK.package), 'NORMAL_WALLET_RETURN_NOT_OBSERVED');
    await this.unlock();
  }
}

async function setupBiometrics(d, pin) {
  // Only the fresh disposable CI AVD may enter these ordinary system settings.
  // No locksettings writes, settings DB changes, credential injection or bypass.
  await d.adb(['shell', 'am', 'start', '-a', 'android.settings.BIOMETRIC_ENROLL']);
  let n = await d.wait(a => ['Pixel Imprint + PIN', 'Fingerprint + PIN', 'PIN'].some(t => has(a, t)), 'NORMAL_SYSTEM_ENROLL_UI_NOT_AVAILABLE', 20000);
  const option = ['Pixel Imprint + PIN', 'Fingerprint + PIN', 'PIN'].find(t => has(n, t)); await d.tap(option, n);
  for (let step = 0; step < 2; step++) {
    n = await d.wait(a => a.some(v => v.class === 'android.widget.EditText' && visible(v)), 'SYSTEM_PIN_INPUT_NOT_AVAILABLE', 12000);
    const fields = n.filter(v => v.class === 'android.widget.EditText' && visible(v)); check(fields.length === 1, 'SYSTEM_PIN_INPUT_AMBIGUOUS');
    const b = box(fields[0]); await d.adb(['shell', 'input', 'tap', String((b[0] + b[2]) >> 1), String((b[1] + b[3]) >> 1)]); await d.type(pin);
    n = await d.ui(); const action = ['Next', 'Confirm'].find(t => has(n, t)); check(action, 'SYSTEM_PIN_CONFIRM_NOT_AVAILABLE'); await d.tap(action, n);
  }
  n = await d.ui(); if (has(n, 'Not now')) await d.tap('Not now', n); // notification visibility, not a permission
  for (let i = 0; i < 16; i++) {
    n = await d.ui();
    if (['Fingerprint added', 'Fingerprint added!'].some(t => has(n, t))) { if (has(n, 'Done')) await d.tap('Done', n); return; }
    if (['Next', 'I agree'].some(t => has(n, t))) {
      check(!has(n, 'I agree'), 'SYSTEM_ENROLL_ADDITIONAL_CONSENT_REQUIRES_REVIEW');
      await d.tap('Next', n); continue;
    }
    const sensorPrompt = n.some(v => visible(v) && /touch.*sensor|lift.*finger|touch.*again|fingerprint sensor/i.test(v.text || v['content-desc'] || ''));
    check(sensorPrompt, 'NORMAL_FINGERPRINT_ENROLL_STEP_UNSUPPORTED');
    await d.adb(['emu', 'finger', 'touch', '1']); await delay(350);
  }
  fail('NORMAL_FINGERPRINT_ENROLL_NOT_COMPLETED');
}
async function addressHash(d) {
  await d.tap('Receive', await d.find('Receive'));
  const n = await d.ui(), addresses = n.filter(v => /^ynx1[0-9a-z]+$/.test(v.text));
  check(addresses.length === 1, 'FULL_PUBLIC_ADDRESS_NOT_AVAILABLE');
  const hash = sha(addresses[0].text); await d.tap('Close Receive YNXT'); return hash;
}
async function createQa(d, privateDir, onBackupCreated = () => {}) {
  await d.adb(['shell', 'am', 'start', '-n', `${APK.package}/.MainActivity`]);
  let n = await d.wait(a => has(a, 'Create a new Wallet'), 'FRESH_QA_WELCOME_NOT_AVAILABLE');
  await d.tap('Create a new Wallet', n); n = await d.ui();
  const keys = n.filter(v => v['content-desc'] === 'YNX Wallet recovery key' && /^[0-9a-f]{64}$/.test(v.text));
  check(keys.length === 1, 'STRONG_BIOMETRIC_SETUP_OR_BACKUP_UI_FAILED');
  const key = keys[0].text; mask(key);
  await fs.writeFile(path.join(privateDir, 'recovery.private'), key, {mode: 0o600, flag: 'wx'});
  onBackupCreated();
  await d.tap('Type BACKED UP to confirm', n); await d.type('BACKED%sUP');
  const ime = await d.adb(['shell', 'dumpsys', 'input_method']); check(/mInputShown=true/.test(ime), 'BACKUP_IME_NOT_SHOWN');
  await d.tap('Confirm backup and save');
  await d.wait(a => has(a, 'Fingerprint sensor'), 'SAVE_SYSTEM_BIOMETRIC_PROMPT_MISSING'); await d.fingerprint();
  await d.wait(a => has(a, 'Account saved. Unlock with system biometrics to continue.'), 'EXPLICIT_QA_SAVE_NOT_CONFIRMED');
  await d.unlock(); return addressHash(d);
}
function mask(value) { if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${value}\n`); }
async function launchFinance(d) {
  await d.adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', FINANCE, '-p', BROWSER]);
  // Ordinary account setup may skip sign-in; never accept Chrome terms, grant a permission, change provider or
  // disable first-run checks. A ready ordinary browser is an execution gate.
  await d.wait(n => has(n, 'Connect a wallet'), 'NORMAL_PUBLIC_FINANCE_NOT_READY',45000,{skipChromeAccountSetup:true});
}
async function mobileProposal(d, mark = () => {}) {
  await d.tap('Connect a wallet', await d.find('Connect a wallet'));
  await d.tap('Mobile YNX Wallet QR code or app link Select');
  let n = await d.wait(a => has(a, 'Open YNX Wallet app'), 'PUBLIC_RELAY_OR_NORMAL_APP_LINK_NOT_READY', 55000);
  check(has(n, 'Open YNX Wallet app'), 'NO_NORMAL_MOBILE_APP_LINK');
  mark('mobile_link_visible');
  await d.tap('Open YNX Wallet app', n); // rendered link; no URI extraction/use
  mark('normal_mobile_link_clicked');
  n = await d.ui(); if (has(n, 'Open')) await d.tap('Open', n);
  n = await d.ui(); if (has(n, 'YNX Wallet')) { if (has(n, 'Just once')) await d.tap('Just once', n); }
  n = await d.wait(a => a.some(v => v.package === APK.package), 'NATIVE_DEEP_LINK_HANDOFF_NOT_OBSERVED');
  mark('native_handoff_observed');
  if (has(n, 'Unlock with biometrics')) { mark('normal_native_unlock_started'); await d.unlock(); mark('normal_native_unlock_finished'); }
  n = await d.wait(a => has(a, 'Pair WalletConnect URI') || has(a, 'Connect this app?'), 'ORIGINAL_APK_PAIR_UI_NOT_AVAILABLE');
  if (has(n, 'Pair WalletConnect URI')) { mark('native_pair_ui_ready'); await d.tap('Pair WalletConnect URI', await d.find('Pair WalletConnect URI')); mark('native_pair_ui_clicked'); }
  n = await d.wait(a => has(a, 'Connect this app?'), 'REAL_WALLETKIT_PROPOSAL_NOT_RECEIVED', 55000);
  check(n.some(v => v.package === APK.package && visible(v)), 'PROPOSAL_NOT_INSTALLED_NATIVE_UI');
  check(n.some(v => visible(v) && (v.text === FINANCE || v.text === FINANCE + '/')), 'PROPOSAL_FINANCE_PEER_NOT_EXACT');
  check(has(n, 'This connection does not approve any signature or transfer.'), 'PROPOSAL_BOUNDARY_NOT_VISIBLE');
  mark('real_proposal_review_visible');
  return n;
}
async function refreshBrowser(d) {
  let n = await d.ui(); if (!has(n, 'Customize and control Google Chrome')) {
    const scroll = n.find(v => v.class === 'android.webkit.WebView' && box(v)); check(scroll, 'BROWSER_SCROLL_VIEW_MISSING');
    const b = box(scroll); await d.adb(['shell', 'input', 'swipe', String((b[0] + b[2]) >> 1), String(b[1] + 300), String(b[1] + 900), '400']);
  }
  await d.tap('Customize and control Google Chrome'); await d.tap('Refresh');
}
async function openReadOnlyPanel(d) {
  let n = await d.ui();
  if (!has(n, 'Refresh account view')) {
    await d.tap(FINANCE_RECOVERY_PANEL, await d.find(FINANCE_RECOVERY_PANEL));
    n = await d.ui();
  }
  // Inspect any auth-required state before searching for the hidden refresh.
  return n;
}
export async function confirmReadOnlyRefresh(d, account, mark = () => {}) {
  let initial = await openReadOnlyPanel(d);
  const initialState = readOnlyUiState(initial, account);
  check(!initialState.needsApproval, 'READ_ONLY_RECOVERY_REQUIRES_NEW_AUTHORIZATION');
  initial = await d.find('Refresh account view');
  check(readOnlyUiState(initial, account).ready, 'SAME_READ_ONLY_IDENTITY_NOT_RESTORED');
  mark('same_server_read_only_identity_visible');
  await d.tap('Refresh account view', initial); mark('normal_read_only_refresh_clicked');
  // A stale ready label alone is not proof that a fresh backend read finished.
  // Require the ordinary UI's observable loading -> ready response cycle. If
  // transient feedback is too fast for UI automation, fail rather than infer.
  let loadingObserved = false;
  await d.wait(nodes => {
    const state = readOnlyUiState(nodes, account);
    check(!state.needsApproval, 'READ_ONLY_RECOVERY_REQUIRES_NEW_AUTHORIZATION');
    check(!state.degraded, 'READ_ONLY_BACKEND_REFRESH_UNAVAILABLE');
    if (state.loading && !loadingObserved) { loadingObserved = true; mark('read_only_refresh_loading_visible'); }
    if (loadingObserved && state.ready) { mark('same_identity_backend_refresh_response_visible'); return true; }
    return false;
  }, 'READ_ONLY_FRESH_REFRESH_CYCLE_NOT_OBSERVED');
}

async function run() {
  hostedOnly();
  const receiptPath = tempPath('YNX_ANDROID_QA_RECEIPT'), apkPath = tempPath('YNX_ANDROID_QA_APK');
  const receipt = {schemaVersion: 1, harnessCommit: process.env.GITHUB_SHA || null, immutableApk: APK,
    status: 'NOT_COMPLETED', stage: 'preflight', failureCode: null, checks: {}, events: [], addressSha256: null,
    privacy: {rawUiStored: false, screenshots: false, qrDecoded: false, pairingUriExtractedOrInjected: false, rawNetworkOrLogcatStored: false, backupUploaded: false},
    boundaries: {physicalAndroid: false, MONSTER: false, publicOverallAccepted: false, productRebuilt: false, protocolMocked: false}, fullJourney: false};
  const d = new Driver(process.env.YNX_ANDROID_QA_SERIAL); let privateDir, backupCreated = false, evmAccount;
  const stage = value => { receipt.stage = value; receipt.events.push({at: new Date().toISOString(), stage: value}); console.log(`ANDROID_QA_STAGE_${value.toUpperCase()}`); };
  try {
    await verifyApk(apkPath); receipt.checks.apk = true;
    const devices = await quiet('adb', ['devices']); check(devices.trim().split('\n').filter(v => /\tdevice$/.test(v)).length === 1 && devices.includes(`${d.serial}\tdevice`), 'SINGLE_DISPOSABLE_EMULATOR_REQUIRED');
    check((await d.adb(['shell', 'getprop', 'ro.kernel.qemu'])).trim() === '1', 'EMULATOR_ONLY');
    check((await d.adb(['emu', 'avd', 'name'])).split('\n')[0].trim() === 'ynx-wallet-installed-pair-qa', 'OWNED_AVD_NAME_REQUIRED');
    check(!(await d.adb(['shell', 'pm', 'list', 'packages', APK.package])).includes(APK.package), 'FRESH_DISPOSABLE_USERDATA_REQUIRED'); receipt.checks.disposableDevice = true;
    check((await d.adb(['shell', 'pm', 'list', 'packages', BROWSER])).includes(BROWSER), 'ORDINARY_CHROME_NOT_INSTALLED');
    stage('browser_readiness'); await launchFinance(d); receipt.checks.browserReady = true;
    stage('synthetic_system_protection'); const pin = String(randomInt(100000, 1000000)); mask(pin); await setupBiometrics(d, pin); receipt.checks.biometricSetup = true;
    stage('immutable_apk_install'); await d.adb(['install', apkPath], 120000); // no replace, clear, uninstall or product build
    const version = await d.adb(['shell', 'dumpsys', 'package', APK.package]); check(version.includes(`versionCode=${APK.code} `) && version.includes(`versionName=${APK.version}`), 'INSTALLED_APK_VERSION_MISMATCH');
    privateDir = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'ynx-private-synthetic-')); await fs.chmod(privateDir, 0o700);
    stage('normal_account_create_backup'); receipt.addressSha256 = await createQa(d, privateDir, () => { backupCreated = true; }); receipt.checks.accountCreated = true; receipt.checks.backup = true;
    await d.tap('Lock Wallet'); await d.adb(['shell', 'am', 'force-stop', APK.package]); await d.adb(['shell', 'am', 'start', '-n', `${APK.package}/.MainActivity`]);
    await d.unlock(); check(await addressHash(d) === receipt.addressSha256, 'COLD_QA_ADDRESS_CHANGED'); receipt.checks.coldAccountPreserved = true;
    stage('public_mobile_reject'); await launchFinance(d); await mobileProposal(d, value => stage('reject_'+value)); receipt.checks.normalAppLink = true; receipt.checks.realProposal = true;
    stage('explicit_reject_click'); await d.tap('Reject', await d.find('Reject')); await d.browser();
    await d.wait(n => has(n, 'You declined this request. Nothing was approved.') || n.some(v => /connection.*(?:reject|declined)|wallet.*reject/i.test(v.text || '')), 'REJECT_RESPONSE_NOT_RETURNED'); receipt.checks.rejectReturned = true;
    await d.tap('Cancel connection', await d.find('Cancel connection'));
    stage('public_mobile_approve'); await mobileProposal(d, value => stage('approve_'+value)); stage('explicit_approve_click'); await d.tap('Approve', await d.find('Approve')); await d.browser();
    await d.wait(n => has(n, 'Done') || has(n, 'Disconnect wallet'), 'SESSION_RESPONSE_NOT_RETURNED');
    let n = await d.ui(); if (has(n, 'Done')) await d.tap('Done', n); receipt.checks.approveReturned = true;
    stage('no_funds_identity_review');
    n = await d.ui();
    const identityAction = has(n, 'Verify Wallet identity') ? 'Verify Wallet identity' : 'Sign in to read my account';
    await d.tap(identityAction, await d.find(identityAction));
    // Existing connected app may receive the request while backgrounded. Use
    // normal recents only; never manufacture a URI or invoke SignClient.
    n = await d.ui(); if (has(n, 'Open YNX Wallet app')) await d.tap('Open YNX Wallet app', n);
    await d.wallet();
    n = await d.wait(a => has(a, 'Sign a message'), 'NO_FUNDS_NATIVE_REVIEW_NOT_DELIVERED');
    check(n.some(v => v.package === APK.package && visible(v)), 'SIGNATURE_REVIEW_NOT_INSTALLED_NATIVE_UI');
    check(safeSignInReview(n), 'SIGNATURE_NOT_EXACT_FINANCE_READ_ONLY'); receipt.checks.noFundsReview = true;
    // Read the public account only from the exact review of this freshly
    // created synthetic wallet. Only its hash may enter the receipt.
    evmAccount = JSON.parse(n.filter(visible).find(v => (v.text || '').startsWith('YNX EVM Product Session authorization v1\n')).text.split('\n').slice(1).join('\n')).account;
    receipt.readOnlyIdentitySha256 = sha(evmAccount);
    await d.tap('Approve', await d.find('Approve'));
    await d.wait(a => has(a, 'Fingerprint sensor'), 'SIGN_SYSTEM_BIOMETRIC_PROMPT_MISSING'); await d.fingerprint(); await d.browser();
    await d.wait(a => has(a, 'Signed in for read-only account records. Native planning and other product permissions require separate Wallet approval.') || has(a, 'Read-only EVM account is authorized for this short session. This does not authorize private native Finance, orders, or transfers.'), 'SIGNED_READ_ONLY_RESPONSE_NOT_CONFIRMED'); receipt.checks.signatureReturned = true;
    stage('installed_session_recovery'); await d.adb(['shell', 'am', 'force-stop', APK.package]); await d.adb(['shell', 'am', 'start', '-n', `${APK.package}/.MainActivity`]); await d.unlock();
    n = await d.ui(); if (!has(n, 'Connected apps')) await d.tap('WalletConnect and external dApps', await d.find('WalletConnect and external dApps'));
    await d.wait(a => has(a, 'Connected apps') && a.some(v => visible(v) && (v.text || '').startsWith(FINANCE)), 'INSTALLED_SESSION_NOT_RESTORED'); receipt.checks.nativeSessionRestored = true;
    await d.browser(); await refreshBrowser(d); await d.wait(a => has(a, 'Disconnect wallet'), 'BROWSER_STANDARD_CONNECTION_NOT_RESTORED');
    stage('same_read_only_backend_recovery'); await confirmReadOnlyRefresh(d, evmAccount, stage);
    receipt.checks.readOnlyIdentityRestored = true; receipt.checks.backendReadRefreshed = true;
    receipt.checks.sessionRecovered = true; receipt.checks.browserRestored = true;
    stage('normal_disconnect'); await d.tap('Disconnect wallet', await d.find('Disconnect wallet')); await d.wait(a => has(a, 'Connect a wallet') && !has(a, 'Disconnect wallet'), 'DAPP_DISCONNECT_NOT_CONFIRMED'); receipt.checks.disconnected = true;
    await d.adb(['shell', 'am', 'start', '-n', `${APK.package}/.MainActivity`]); await d.unlock();
    n = await d.ui(); if (!has(n, 'Connected apps')) await d.tap('WalletConnect and external dApps', await d.find('WalletConnect and external dApps'));
    await d.wait(a => has(a, 'No apps connected yet.'), 'NATIVE_REMOTE_DISCONNECT_NOT_CONFIRMED'); receipt.checks.nativeDisconnectObserved = true;
    await d.tap('Close WalletConnect'); await d.tap('Lock Wallet', await d.find('Lock Wallet'));
    await d.wait(a => has(a, 'Unlock with biometrics'), 'FINAL_WALLET_LOCK_NOT_CONFIRMED'); receipt.checks.finalLocked = true;
    check(complete(receipt.checks), 'INCOMPLETE_GATE_CANNOT_PASS'); receipt.fullJourney = true; receipt.status = 'HOSTED_EMULATOR_UI_JOURNEY_PASS_NOT_PHYSICAL_OR_MONSTER';
  } catch (error) {
    receipt.failureCode = safeCode(error?.code); receipt.status = 'FAIL_CLOSED';
    try { receipt.lastUi = safeUiEvidence(await d.ui()); } catch { receipt.lastUi = {unavailable: true}; }
    process.exitCode = 1;
  } finally {
    // No unknown fields are serialized, no backup/raw XML/logcat screenshot is
    // an artifact. Remove exactly the private file/directory created here.
    receipt.privateQaBackupRemovedAtRunnerEnd = false;
    if (privateDir) {
      const result = await cleanupPrivateBackup(privateDir, backupCreated);
      if (!retainCleanupResult(receipt, result)) process.exitCode = 1;
    }
    receipt.finishedAt = new Date().toISOString(); await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2), {mode: 0o600});
    console.log(JSON.stringify({status: receipt.status, stage: receipt.stage, failureCode: receipt.failureCode, fullJourney: receipt.fullJourney, physicalAndroid: false, MONSTER: false}));
  }
}

async function selfTest() {
  const {test} = await import('node:test');
  test('normal recovery panel label matches the actual Finance English locale', async () => {
    const {runInNewContext}=await import('node:vm');
    const window={}, document={readyState:'loading',addEventListener:()=>{}};
    const source=await fs.readFile(new URL('../../finance/web/finance-locale.js',import.meta.url),'utf8');
    runInNewContext(source,{window,document,localStorage:{getItem:()=>null}});
    assert.equal(window.YNXFinanceLocale.source('walletMore'),FINANCE_RECOVERY_PANEL);
    const calls=[];let reads=0;
    await openReadOnlyPanel({ui:async()=>++reads===1?[]:[],find:async label=>{calls.push(['find',label]);return[];},tap:async label=>calls.push(['tap',label])});
    assert.deepEqual(calls,[['find',FINANCE_RECOVERY_PANEL],['tap',FINANCE_RECOVERY_PANEL]]);
  });
  test('runtime refuses local/user devices and wrong serial before any adb', () => {
    assert.throws(() => hostedOnly({}, 'darwin'), /DISPOSABLE_HOSTED_RUNNER_REQUIRED/);
    assert.throws(() => hostedOnly({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',YNX_ANDROID_QA_EPHEMERAL:'1',YNX_ANDROID_QA_SERIAL:'emulator-5580'}, 'linux'), /EXACT_DISPOSABLE_SERIAL_REQUIRED/);
  });
  test('immutable public APK identity is fixed, not a disposable rebuilt fixture', () => {
    assert.equal(APK.code, 34); assert.equal(APK.bytes, 117057650); assert.equal(APK.sha256.length, 64); assert.equal(APK.certificate.length, 64);
    assert.match(APK.url, /wallet-android-testnet-preview-1\.0\.28-a9fff0d84/);
  });
  test('fresh UI child text resolves only to one real clickable parent', () => {
    const n = parseUI('<node clickable="true" enabled="true" bounds="[10,20][90,80]"><node text="Approve" clickable="false" bounds="[20,30][80,70]"/></node>');
    assert.equal(target(n, 'Approve'), n[0]); assert.deepEqual(box(n[0]), [10,20,90,80]);
    const second = parseUI('<node text="Approve" clickable="true" bounds="[100,20][190,80]"/>');
    assert.throws(() => target([...n,...second], 'Approve'), /NOT_UNIQUE/);
  });
  test('clipped/inverted/empty geometry cannot become a UI action', () => {
    assert.equal(box({bounds:'[44,722][676,682]'}), null); assert.equal(box({bounds:'[0,0][0,9]'}), null);
    assert.throws(() => target([{text:'Approve',clickable:'true',bounds:'[44,722][676,682]'}], 'Approve'), /NOT_UNIQUE/);
  });
  test('receipt evidence never serializes secret, URI, arbitrary errors or XML', () => {
    const secret='f'.repeat(64), pin='938471';
    const n=parseUI(`<node text="wc:${secret}@2?relay-protocol=irn&amp;symKey=${secret}" bounds="[0,0][1,1]"/><node text="${pin}" bounds="[0,0][1,1]"/><node text="YNX_PAIR_RELAY_TIMEOUT" bounds="[0,0][1,1]"/>`);
    const json=JSON.stringify(safeUiEvidence(n)); assert(!json.includes(secret)); assert(!json.includes(pin)); assert(!json.includes('wc:')); assert(json.includes('YNX_PAIR_RELAY_TIMEOUT'));
    assert.equal(safeCode('error wc:'+secret), 'UNCLASSIFIED_GATE_FAILURE');
  });
  test('Chrome consent is an explicit fail condition, never silently accepted', () => {
    const node=text=>({text,package:BROWSER,bounds:'[0,0][1,1]'});
    assert.deepEqual(chromeFirstRunState([node('Use without an account')]),{foregroundChrome:true,explicitAcceptTerms:false,accountSetup:true,skipAccount:true});
    assert.equal(chromeFirstRunState([node('Accept & continue')]).explicitAcceptTerms,true);
    assert.equal(chromeFirstRunState([{...node('Accept & continue'),package:APK.package}]).explicitAcceptTerms,false);
    assert.deepEqual(safeUiEvidence([{text:'This request expired. Start again when you are ready.',bounds:'[0,0][1,1]'}]).codes, ['PAIR_EXPIRED_UI']);
  });
  test('Chrome account skip uses its ordinary button only; terms remain blocked',async()=>{
    const d=new Driver('emulator-5554');let count=0;const calls=[];
    const chrome={text:'Use without an account',package:BROWSER,clickable:'true',bounds:'[0,0][1,1]'};
    d.ui=async()=>++count===1?[chrome]:[{text:'Connect a wallet',package:BROWSER,bounds:'[0,0][1,1]'}];d.tap=async label=>calls.push(label);
    await d.wait(n=>has(n,'Connect a wallet'),'NOT_READY',2000,{skipChromeAccountSetup:true});assert.deepEqual(calls,['Use without an account']);
    d.ui=async()=>[{...chrome,text:'Accept & continue'}];
    await assert.rejects(d.wait(()=>false,'NOT_READY',2000,{skipChromeAccountSetup:true}),/CHROME_EXPLICIT_TERMS_ACCEPTANCE_REQUIRED/);assert.equal(calls.length,1);
  });
  test('only exact Finance read-only identity message may be signed', () => {
    const challenge = {version:'1',chainId:6423,account:'0x'+'a'.repeat(40),productId:'finance',origin:FINANCE,callback:FINANCE+'/wallet-auth/callback',scope:'finance.account.read',deviceId:'qa-device',deviceAlgorithm:'p256-sha256',deviceKey:'a'.repeat(44),nonce:'a'.repeat(32),state:'b'.repeat(32),requestId:'synthetic-request',providerKind:'ynx-wallet',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+240000).toISOString()};
    const message='YNX EVM Product Session authorization v1\n'+JSON.stringify(challenge);
    const n=[{text:'Sign a message',bounds:'[0,0][9,9]'},{text:message,bounds:'[0,0][9,9]'}];
    assert.equal(safeSignInReview(n), true); assert.equal(safeSignInReview(n.map(v=>({...v,text:v.text.replace('"chainId":6423','"chainId":1')}))), false);
    assert.equal(safeSignInReview([...n,{text:message,bounds:'[0,0][9,9]'}]), false);
    assert.equal(safeSignInReview(n.map(v=>({...v,text:v.text+' finance.order.execute'}))), false);
    assert.equal(safeSignInReview(n.map(v=>({...v,text:v.text.replace('finance.account.read','finance.order.execute')}))), false);
    assert.equal(safeSignInReview(n.map(v=>({...v,text:v.text.replace('"productId":"finance"','"productId":"other"')}))), false);
  });
  test('geometry, SDK fixture or partial session can never make full pass', () => {
    assert.equal(complete({apk:true,realProposal:true,approveReturned:true}), false);
    assert.equal(complete({}), false);
    const all=Object.fromEntries(['apk','disposableDevice','browserReady','biometricSetup','accountCreated','backup','coldAccountPreserved','normalAppLink','realProposal','rejectReturned','approveReturned','noFundsReview','signatureReturned','nativeSessionRestored','readOnlyIdentityRestored','backendReadRefreshed','sessionRecovered','browserRestored','disconnected','nativeDisconnectObserved','finalLocked'].map(k=>[k,true]));
    assert.equal(complete(all), true);
    for(const key of Object.keys(all)) assert.equal(complete({...all,[key]:false}), false);
  });
  test('visible relay failure takes priority over success-looking UI', async () => {
    const d=new Driver('unused');
    d.ui=async()=>[{text:'Open YNX Wallet app',bounds:'[0,0][9,9]'},{text:'YNX_PAIR_RELAY_TIMEOUT',bounds:'[0,0][9,9]'}];
    await assert.rejects(d.wait(()=>true,'NO_RESULT'), {code:'YNX_PAIR_RELAY_TIMEOUT'});
  });
  const qaAccount='0x'+'a'.repeat(40);
  const uiTexts=(...texts)=>texts.map(text=>({text,bounds:'[0,0][99,99]'}));
  const readReady=()=>uiTexts(READ_READY, 'Refresh account view', `${qaAccount} · 0 YNXT · Explorer`);
  test('standard connection/static login and wrong identity cannot prove backend recovery', () => {
    assert.equal(readOnlyUiState(uiTexts('Disconnect wallet','Signed in for read-only account records. Native planning and other product permissions require separate Wallet approval.'),qaAccount).ready,false);
    assert.equal(readOnlyUiState(readReady(),qaAccount).ready,true);
    assert.equal(readOnlyUiState(readReady(),'0x'+'b'.repeat(40)).ready,false);
    assert.equal(readOnlyUiState([...readReady(),...uiTexts('Read-only EVM session expired. Start a new request to continue.')],qaAccount).ready,false);
    assert.equal(readOnlyUiState([...readReady(),{text:'',password:'true',bounds:'[0,0][99,99]'}],qaAccount).needsApproval,true);
    assert.equal(readOnlyUiState(uiTexts(READ_READY,'Refresh account view','Checking sources'),qaAccount).loading,false);
  });
  function fakeReadDriver(sequence) {
    return {ui:async()=>readReady(), find:async()=>readReady(), tap:async label=>assert.equal(label,'Refresh account view'),
      wait:async(predicate,code)=>{for(const nodes of sequence)if(predicate(nodes))return nodes;fail(code);}};
  }
  test('same backend identity recovery requires observable fresh read cycle, not stale ready', async () => {
    const events=[];
    await confirmReadOnlyRefresh(fakeReadDriver([uiTexts('Refresh account view','Checking sources'),readReady()]),qaAccount,event=>events.push(event));
    assert(events.includes('read_only_refresh_loading_visible')); assert(events.includes('same_identity_backend_refresh_response_visible'));
    await assert.rejects(confirmReadOnlyRefresh(fakeReadDriver([readReady(),readReady()]),qaAccount),{code:'READ_ONLY_FRESH_REFRESH_CYCLE_NOT_OBSERVED'});
    await assert.rejects(confirmReadOnlyRefresh(fakeReadDriver([uiTexts('Read-only EVM session expired. Start a new request to continue.')]),qaAccount),{code:'READ_ONLY_RECOVERY_REQUIRES_NEW_AUTHORIZATION'});
    await assert.rejects(confirmReadOnlyRefresh(fakeReadDriver([uiTexts('Read-only EVM service is unavailable. Standard Wallet remains connected.')]),qaAccount),{code:'READ_ONLY_BACKEND_REFRESH_UNAVAILABLE'});
  });
  test('never-created backup ENOENT still removes only owned directory and preserves primary failure', async () => {
    const calls=[], dir='/owned/temp/ynx-private-synthetic-fixture';
    const io={unlink:async p=>{calls.push(['unlink',p]);throw Object.assign(new Error(),{code:'ENOENT'});}, rmdir:async p=>calls.push(['rmdir',p])};
    const result=await cleanupPrivateBackup(dir,false,'/owned/temp',io);
    assert.deepEqual(result,{backupRemoved:false,backupNeverCreated:true,directoryRemoved:true,confirmed:true});
    assert.deepEqual(calls,[['unlink',dir+'/recovery.private'],['rmdir',dir]]);
    const receipt={status:'FAIL_CLOSED',failureCode:'STRONG_BIOMETRIC_SETUP_OR_BACKUP_UI_FAILED',fullJourney:false};
    assert.equal(retainCleanupResult(receipt,result),true); assert.equal(receipt.failureCode,'STRONG_BIOMETRIC_SETUP_OR_BACKUP_UI_FAILED');
    const missingCreated=await cleanupPrivateBackup(dir,true,'/owned/temp',io);
    assert.equal(retainCleanupResult(receipt,missingCreated),false); assert.equal(receipt.failureCode,'STRONG_BIOMETRIC_SETUP_OR_BACKUP_UI_FAILED');
    assert.equal(receipt.cleanupFailureCode,'PRIVATE_BACKUP_CLEANUP_NOT_CONFIRMED');
    await assert.rejects(cleanupPrivateBackup('/owned/temp',false,'/owned/temp',io),{code:'PRIVATE_CLEANUP_PATH_NOT_OWNED'});
  });
  test('successful backup cleanup and independent cleanup failure remain separately classified', async () => {
    const dir='/owned/temp/ynx-private-synthetic-fixture';
    const result=await cleanupPrivateBackup(dir,true,'/owned/temp',{unlink:async()=>{},rmdir:async()=>{}});
    assert.deepEqual(result,{backupRemoved:true,backupNeverCreated:false,directoryRemoved:true,confirmed:true});
    const failed=await cleanupPrivateBackup(dir,false,'/owned/temp',{unlink:async()=>{throw Object.assign(new Error(),{code:'EACCES'});},rmdir:async()=>assert.fail('must not broaden cleanup')});
    const receipt={status:'PASS',failureCode:null,fullJourney:true};
    assert.equal(retainCleanupResult(receipt,failed),false); assert.equal(receipt.failureCode,'PRIVATE_BACKUP_CLEANUP_NOT_CONFIRMED'); assert.equal(receipt.fullJourney,false);
  });
  test('runtime local guard stops before any device or filesystem mutation', async () => {
    const {stdout}=await exec(process.execPath,[fileURLToPath(import.meta.url),'--run'],{env:{PATH:process.env.PATH}}).catch(e=>({stdout:e.stdout}));
    assert.deepEqual(JSON.parse(stdout),{status:'FAIL_CLOSED',failureCode:'DISPOSABLE_HOSTED_RUNNER_REQUIRED'});
  });
  test('workflow uploads one safe file, pins actions and has dispatch-only explicit authority', async () => {
    const workflow=await fs.readFile(new URL('../../../.github/workflows/wallet-android-installed-pair-qa.yml', import.meta.url),'utf8');
    assert(workflow.includes('workflow_dispatch:')); assert(!/\n  (push|pull_request|schedule):/.test(workflow));
    assert(workflow.includes('authorize_ephemeral_synthetic_qa == true'));
    assert(!workflow.includes('upload-artifact\n')); assert(workflow.includes('path: ${{ runner.temp }}/ynx-android-installed-pair-receipt.json'));
    for(const match of workflow.matchAll(/uses: (\S+)/g)) assert.match(match[1], /@[0-9a-f]{40}$/);
    assert(!/logcat|screencap|--bugreport|continue-on-error/.test(workflow));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  try {
    if (mode === '--self-test') await selfTest();
    else if (mode === '--fetch-apk') await fetchApk();
    else if (mode === '--run') await run();
    else fail('EXPLICIT_MODE_REQUIRED');
  } catch (error) { console.log(JSON.stringify({status:'FAIL_CLOSED',failureCode:safeCode(error?.code)})); process.exitCode=1; }
}
