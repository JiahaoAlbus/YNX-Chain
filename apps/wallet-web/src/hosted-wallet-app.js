import { createHostedVaultStore } from "./hosted-vault-store.js";
import { withHostedAccountLock } from "./hosted-account-lock.js";
import { unlockEncryptedVault } from "./extension-vault.js";
import { validateYNXChainMutation } from "./extension-chain-params.js";
import { forwardExtensionRpc, broadcastExtensionTransaction, YNX_CHAIN_ID } from "./extension-rpc.js";
import { ExtensionBroadcastJournal } from "./extension-broadcast-journal.js";
import { extensionReviewText, prepareExtensionRequest, signExtensionRequest } from "./extension-signer.js";
import { parsePrivateRequest, privateProductName, privateReplayKey, rejectPrivateReturn, signPrivateReturn } from "./extension-product-session-v2.js";
import { HOSTED_PROTOCOL, HOSTED_SESSION_MS, HOSTED_WALLET_ORIGIN, hostedEnvelope, parseHostedConnect, validateHostedMessage } from "./hosted-protocol.js";
import { toYNXAddress } from "./wallet-address.js";

const $ = id => document.getElementById(id);
const status = $("status"), setup = $("setup"), review = $("review"), reviewText = $("review-text"), password = $("approval-password"), approve = $("approve"), reject = $("reject");
const store = createHostedVaultStore();
const broadcastJournal = new ExtensionBroadcastJournal(store.journalStorage);
let vault = null, session = null, currentReview = null, activeRequest = null, busy = false, needsBackupAcknowledgement = false, backupDownloaded = false;
const seen = new Set();
const chain = Object.freeze({ chainId: YNX_CHAIN_ID, chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: ["https://rpc-testnet.ynxweb4.com", "https://evm.ynxweb4.com"], blockExplorerUrls: ["https://explorer.ynxweb4.com"] });
function fail(code) { throw Object.assign(new Error(code), { code }); }
function message(value) { status.textContent = value; }
function assertRequestLive(context) {
  if (!context || context !== activeRequest || context.cancelled || Date.now() >= context.expiresAt || !session || window.opener?.closed || Date.now() >= session.expiresAt) fail("HOSTED_REQUEST_EXPIRED");
}
function cancelActiveRequest() {
  if (!activeRequest) return;
  activeRequest.cancelled = true;
  if (currentReview?.context === activeRequest) finishReview({ approved: false });
}
async function assertCurrentAccount() {
  const current = await store.read();
  if (!session || window.opener?.closed || Date.now() >= session.expiresAt || !current || current.account !== vault?.account || JSON.stringify(current) !== JSON.stringify(vault)) {
    reply("disconnected"); session = null; fail("HOSTED_ACCOUNT_CHANGED_OR_EXPIRED");
  }
}
async function assertSelectedAccount() {
  const current = await store.read();
  if (!current || current.account !== vault?.account || JSON.stringify(current) !== JSON.stringify(vault)) fail("HOSTED_ACCOUNT_CHANGED");
}
function displayAccount() {
  $("account-card").hidden = !vault;
  if (vault) { $("account-ynx").textContent = toYNXAddress(vault.account); $("account-evm").textContent = vault.account; }
}
async function refreshAccountList() {
  const section = $("account-switch-section"); section.hidden = !vault;
  if (!vault) return;
  const accounts = await store.listAccounts(), select = $("account-select"); select.replaceChildren();
  for (const account of accounts) { const option = document.createElement("option"); option.value = account; option.textContent = toYNXAddress(account); select.append(option); }
  select.value = vault.account;
}
async function refreshTransactionStatus(refresh = false) {
  if (!vault) return;
  try {
    const readStatus = () => broadcastJournal.status(vault.account, { rpc: forwardExtensionRpc, refresh });
    const record = refresh ? await withHostedAccountLock(vault.account, async () => { await assertSelectedAccount(); return readStatus(); }) : await readStatus();
    $("transaction-panel").hidden = !record;
    if (record) $("transaction-status").textContent = `${record.transactionHash} · ${record.status}${record.blocksNewSend ? " · New sends paused until original transaction is resolved." : ""}`;
  } catch (error) {
    $("transaction-panel").hidden = false;
    $("transaction-status").textContent = `Transaction history cannot be verified. Sending remains disabled. (${error?.code ?? "HOSTED_JOURNAL_UNAVAILABLE"})`;
  }
}
function reply(type, extra = {}) {
  if (!session || window.opener?.closed || Date.now() >= session.expiresAt) return;
  window.opener.postMessage(hostedEnvelope(session, type, extra), session.origin);
}
function finishReview(accepted) {
  if (!currentReview) return;
  const pending = currentReview; currentReview = null;
  if (pending.timer) window.clearTimeout(pending.timer);
  review.hidden = true; password.value = "";
  pending.resolve(accepted);
}
function askUser({ title, detail, secretRequired = false, context = null }) {
  if (context) assertRequestLive(context);
  if (currentReview) fail("HOSTED_APPROVAL_BUSY");
  $("review-title").textContent = title;
  reviewText.textContent = detail;
  $("approval-password-label").hidden = !secretRequired;
  password.hidden = !secretRequired;
  password.value = "";
  review.hidden = false;
  approve.disabled = false; reject.disabled = false;
  window.focus();
  return new Promise(resolve => {
    currentReview = { resolve, secretRequired, context, timer: context ? window.setTimeout(() => { context.cancelled = true; finishReview({ approved: false }); }, Math.max(0, context.expiresAt - Date.now())) : null };
  });
}
approve.addEventListener("click", () => {
  if (!currentReview) return;
  if (currentReview.context) { try { assertRequestLive(currentReview.context); } catch { cancelActiveRequest(); return; } }
  if (currentReview.secretRequired && (password.value.length < 12 || password.value.length > 256)) { message("Enter your local Wallet password to approve this exact request."); return; }
  const secret = currentReview.secretRequired ? password.value : null;
  finishReview(secretRequiredResult(secret));
});
function secretRequiredResult(secret) { return secret === null ? { approved: true } : { approved: true, password: secret }; }
reject.addEventListener("click", () => finishReview({ approved: false }));
window.addEventListener("pagehide", () => { cancelActiveRequest(); reply("disconnected"); finishReview({ approved: false }); password.value = ""; });

async function handleMethod(method, params, context) {
  assertRequestLive(context);
  await assertCurrentAccount();
  if (method === "eth_accounts" || method === "eth_requestAccounts") return [vault.account];
  if (method === "eth_chainId") return YNX_CHAIN_ID;
  if (method === "wallet_disconnect") { cancelActiveRequest(); reply("disconnected"); session = null; message("Disconnected. Reopen Wallet from the product to connect again."); return null; }
  if (method === "wallet_addEthereumChain" || method === "wallet_switchEthereumChain") { validateYNXChainMutation(method, params, chain); return null; }
  if (method === "ynx_requestProductSessionV2") {
    const request = parsePrivateRequest(params, session.origin);
    const replay = privateReplayKey(request);
    await store.consumeReplay(replay, Date.parse(request.expiresAt));
    const choice = await askUser({ title: `Approve ${privateProductName(request)} access?`, detail: `${session.origin}\n${request.purpose}\nScopes: ${request.scopes.join(", ")}\nExpires: ${request.expiresAt}`, secretRequired: true, context });
    assertRequestLive(context);
    if (!choice.approved) return rejectPrivateReturn(request);
    await assertCurrentAccount();
    const unlocked = await unlockEncryptedVault(vault, choice.password);
    assertRequestLive(context);
    await assertCurrentAccount();
    if (unlocked.account !== vault.account) fail("HOSTED_ACCOUNT_CHANGED");
    return signPrivateReturn(request, unlocked.secretHex);
  }
  if (["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"].includes(method)) {
    const perform = async () => {
    assertRequestLive(context);
    const prepared = await prepareExtensionRequest({ expectedAccount: vault.account, method, params, rpc: forwardExtensionRpc });
    assertRequestLive(context);
    const choice = await askUser({ title: method === "eth_sendTransaction" ? "Review transaction" : "Review signature", detail: `${session.origin}\n${extensionReviewText(prepared.review)}`, secretRequired: true, context });
    assertRequestLive(context);
    if (!choice.approved) fail("USER_REJECTED");
    await assertCurrentAccount();
    const unlocked = await unlockEncryptedVault(vault, choice.password);
    assertRequestLive(context);
    await assertCurrentAccount();
    if (unlocked.account !== vault.account) fail("HOSTED_ACCOUNT_CHANGED");
    const assertAuthorized = async () => { assertRequestLive(context); await assertCurrentAccount(); assertRequestLive(context); if (document.visibilityState !== "visible") fail("HOSTED_APPROVAL_CANCELLED"); };
    const signed = await signExtensionRequest({ secretHex: unlocked.secretHex, expectedAccount: vault.account, prepared, rpc: forwardExtensionRpc, assertAuthorized });
    if (method !== "eth_sendTransaction") return signed;
    assertRequestLive(context);
    await assertCurrentAccount();
    return broadcastJournal.broadcast({ account: vault.account, origin: session.origin, signed, broadcast: broadcastExtensionTransaction, assertAuthorized, rpc: forwardExtensionRpc });
    };
    return method === "eth_sendTransaction" ? withHostedAccountLock(vault.account, async () => { assertRequestLive(context); await assertCurrentAccount(); return broadcastJournal.run(vault.account, perform); }) : perform();
  }
  if (method.startsWith("eth_") || method.startsWith("net_") || method.startsWith("web3_")) return forwardExtensionRpc(method, params);
  fail("HOSTED_METHOD_UNSUPPORTED");
}

async function receive(event) {
  if (!session || Date.now() >= session.expiresAt || window.opener?.closed) return;
  let data;
  try { data = validateHostedMessage(event, window.opener, session, seen); } catch { return; }
  if (data.type === "ping" && session.approved === true) { try { await assertCurrentAccount(); reply("pong"); } catch { /* Disconnected by the account guard. */ } return; }
  if (data.type === "hello") {
    if (busy || vault === null) return;
    busy = true;
    try {
      await store.consumeReplay(`connect:${session.origin}:${session.requestId}`, session.expiresAt);
      const choice = await askUser({ title: "Connect YNX Wallet?", detail: `${session.origin}\nYNX account: ${toYNXAddress(vault.account)}\nEVM-compatible: ${vault.account}\nNetwork: YNX Testnet\nNo balance is required.` });
      if (!choice.approved) { reply("rejected", { replyTo: data.messageId }); return; }
      await assertCurrentAccount();
      const sessionExpiresAt = Date.now() + HOSTED_SESSION_MS;
      reply("connected", { replyTo: data.messageId, account: vault.account, chainId: YNX_CHAIN_ID, sessionExpiresAt });
      session.expiresAt = sessionExpiresAt;
      message(`Connected to ${session.origin}. Keep this window open while using the product.`);
      session.approved = true;
    } catch { reply("rejected", { replyTo: data.messageId }); message("Connection could not be saved safely. Try again."); }
    finally { busy = false; }
    return;
  }
  if (data.type !== "request" || session.approved !== true) return;
  if (data.method === "wallet_disconnect" && Array.isArray(data.params) && data.params.length === 0) { cancelActiveRequest(); reply("disconnected"); session = null; finishReview({ approved: false }); message("Disconnected. Reopen Wallet from the product to connect again."); return; }
  if (busy) { reply("response", { replyTo: data.messageId, ok: false, code: "HOSTED_APPROVAL_BUSY" }); return; }
  busy = true;
  const context = { messageId: data.messageId, expiresAt: data.expiresAt, cancelled: false };
  activeRequest = context;
  try {
    if (!Array.isArray(data.params) || JSON.stringify(data.params).length > 65536 || typeof data.method !== "string" || data.method.length > 80) fail("HOSTED_METHOD_INVALID");
    const result = await handleMethod(data.method, data.params, context);
    assertRequestLive(context);
    reply("response", { replyTo: data.messageId, ok: true, result });
  } catch (error) {
    reply("response", { replyTo: data.messageId, ok: false, code: typeof error?.code === "string" || Number.isInteger(error?.code) ? error.code : "HOSTED_REQUEST_FAILED" });
    message("The request was not approved or could not be completed. Your account remains protected.");
  } finally { if (activeRequest === context) activeRequest = null; busy = false; }
}

$("setup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector("button[type=submit]");
  if (submit.disabled) return;
  const localPassword = $("setup-password").value, confirm = $("setup-confirm").value;
  if (localPassword !== confirm || localPassword.length < 12) { message("Use a matching local password of at least 12 characters."); return; }
  const key = $("setup-key").value.trim();
  if (key && !$("import-confirm").checked) { message("Confirm that you have a separate recovery backup before importing."); return; }
  submit.disabled = true;
  try {
    const created = await store.create({ password: localPassword, ...(key ? { secretHex: key.replace(/^0x/u, "").toLowerCase() } : {}) });
    vault = created.vault; setup.hidden = true; displayAccount(); await refreshAccountList(); await refreshTransactionStatus();
    needsBackupAcknowledgement = !key;
    $("backup-confirmation").hidden = !needsBackupAcknowledgement;
    message(`Encrypted Wallet saved and read back. Public account: ${vault.account}. ${needsBackupAcknowledgement ? "Download and safeguard an encrypted backup before connecting." : "Your imported key remains encrypted here."}`);
    $("export-backup").hidden = false;
    if (session && !needsBackupAcknowledgement) reply("ready");
  } catch (error) { message(`Wallet was not created. Existing recovery data was retained. (${error?.code ?? "HOSTED_STORAGE_UNAVAILABLE"})`); }
  finally { $("setup-password").value = ""; $("setup-confirm").value = ""; $("setup-key").value = ""; submit.disabled = false; }
});
$("backup-import-form").addEventListener("submit", async event => {
  event.preventDefault();
  const file = $("backup-import-file").files?.[0], input = $("backup-import-password"), submit = event.currentTarget.querySelector("button[type=submit]");
  if (submit.disabled || !file || file.size < 100 || file.size > 20_000 || !$("backup-import-confirm").checked) { message("Choose a supported encrypted backup and confirm the restore."); return; }
  submit.disabled = true;
  try {
    const record = JSON.parse(await file.text());
    const imported = await store.importEncrypted({ record, password: input.value });
    vault = imported.vault; setup.hidden = true; displayAccount(); await refreshAccountList(); await refreshTransactionStatus(); $("export-backup").hidden = false;
    message(`Encrypted backup restored and read back. Public account: ${vault.account}.`);
    if (session) reply("ready");
  } catch (error) { message(`Backup was not restored. Existing data was retained. (${error?.code ?? "HOSTED_BACKUP_INVALID"})`); }
  finally { input.value = ""; $("backup-import-file").value = ""; submit.disabled = false; }
});
$("add-account-form").addEventListener("submit", async event => {
  event.preventDefault();
  const file = $("add-account-file").files?.[0], input = $("add-account-password"), submit = event.currentTarget.querySelector("button[type=submit]");
  if (submit.disabled || !file || file.size < 100 || file.size > 20_000) return;
  submit.disabled = true;
  try {
    const account = await store.addEncryptedAccount({ record: JSON.parse(await file.text()), password: input.value });
    await refreshAccountList(); message(`Encrypted account ${toYNXAddress(account)} added. Select it to switch.`);
  } catch (error) { message(`Account was not added. Existing accounts were retained. (${error?.code ?? "HOSTED_BACKUP_INVALID"})`); }
  finally { input.value = ""; $("add-account-file").value = ""; submit.disabled = false; }
});
$("switch-account").addEventListener("click", async () => {
  const account = $("account-select").value;
  if (!account || account === vault?.account) return;
  try {
    const selected = await store.selectAccount(account);
    cancelActiveRequest(); reply("disconnected"); session = null; finishReview({ approved: false });
    vault = selected; displayAccount(); await refreshAccountList();
    await refreshTransactionStatus();
    message(`Switched to ${toYNXAddress(account)}. Reconnect from the product and approve the new account.`);
  } catch (error) { message(`Account selection failed; current session is unchanged. (${error?.code ?? "HOSTED_ACCOUNT_UNAVAILABLE"})`); }
});
$("account-select").addEventListener("focus", () => { void refreshAccountList().catch(() => message("Account list could not be read. Existing accounts were retained.")); });
$("refresh-transaction").addEventListener("click", () => { void refreshTransactionStatus(true); });
$("export-backup").addEventListener("click", async () => {
  try {
    const record = await store.read();
    if (!record || record.account !== vault?.account) fail("HOSTED_BACKUP_ACCOUNT_MISMATCH");
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(record)}\n`], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `ynx-wallet-encrypted-${record.account}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    backupDownloaded = true;
    $("backup-continue").disabled = !$("backup-ack").checked;
    message("Encrypted backup downloaded. Keep its password and file separately.");
  } catch (error) { message(`Backup unavailable. Existing Wallet remains unchanged. (${error?.code ?? "HOSTED_STORAGE_READ_FAILED"})`); }
});
$("backup-ack").addEventListener("change", () => { $("backup-continue").disabled = !backupDownloaded || !$("backup-ack").checked; });
$("backup-continue").addEventListener("click", () => {
  if (!backupDownloaded || !$("backup-ack").checked) return;
  needsBackupAcknowledgement = false;
  $("backup-confirmation").hidden = true;
  message("Backup acknowledgement recorded for this connection. Wallet cannot verify external backup safety.");
  if (session) reply("ready");
});

async function start() {
  if (location.origin !== HOSTED_WALLET_ORIGIN || window.top !== window || !window.opener) { message("Open this Wallet from a registered product."); return; }
  const encoded = location.hash.startsWith("#connect=") ? location.hash.slice(9) : "";
  try { session = { ...parseHostedConnect(encoded), approved: false }; }
  catch { message("This connection request is invalid or expired."); return; }
  history.replaceState(null, "", location.pathname);
  $("product-origin").textContent = session.origin;
  try { vault = await store.read(); }
  catch (error) { message(`Wallet storage cannot be read. Existing data was retained. (${error?.code ?? "HOSTED_STORAGE_READ_FAILED"})`); return; }
  if (vault) { setup.hidden = true; displayAccount(); await refreshAccountList(); await refreshTransactionStatus(); $("export-backup").hidden = false; message(`Review the request for ${toYNXAddress(vault.account)}.`); reply("ready"); }
  else { setup.hidden = false; message("Create or import a local encrypted Wallet before connecting."); }
  window.addEventListener("message", event => { void receive(event); });
  window.setInterval(() => { if (session && (Date.now() >= session.expiresAt || window.opener?.closed)) { cancelActiveRequest(); finishReview({ approved: false }); session = null; message("The connection expired or its product window closed."); } }, 250);
}
void start();
