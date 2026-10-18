import { DesktopKeyLifecycle } from "./key-lifecycle.mjs";
import {createProductWalletReturnPublisher} from '@ynx-chain/wallet-auth/product-wallet-connection';
import {createOriginalAdmissionController} from './original-admission-controller.mjs';
import {openOriginalAdmissionSupply,closeOriginalAdmissionSupply,readOriginalAdmissionSummary,originalAdmissionSelectionUnresolved} from './original-admission-supply.mjs';
import {MultiConfigStore} from './multichain-config.mjs';
import {MultiJournal} from './multichain-journal.mjs';
import {EVMAdapter} from './multichain-evm.mjs';
import {MultichainService,installMultichainIPC} from './multichain-service.mjs';
import {createMnemonicFamilyAccounts} from './multichain-family-accounts.mjs';
import {createTronReceiveCode} from './multichain-tron-receive.mjs';
import {FamilyNetworks} from './multichain-family-networks.mjs';
import {FamilyRead} from './multichain-family-read.mjs';
import {FamilyTokens} from './multichain-family-tokens.mjs';
import {FamilyRecovery} from './multichain-family-recovery.mjs';
import {FamilyBitcoinTransfer} from './multichain-family-bitcoin-transfer.mjs';
import {FamilyTronTransfer} from './multichain-family-tron-transfer.mjs';
import {FamilyTronSubmission} from './multichain-family-tron-submit.mjs';
import {FamilyOperationGate} from './multichain-family-operation-gate.mjs';
import {FamilyBitcoinSubmission} from './multichain-family-bitcoin-submit.mjs';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, powerMonitor, safeStorage, shell } from "electron";
import {configureWalletRuntimeBranding} from "./wallet-runtime-branding.mjs";
import { createHash, randomUUID } from "node:crypto";
import {createRecipientCameraPermission} from "./recipient-camera-permission.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {installReceivingPNGDownloadOptions} from './receiving-png-download-options.mjs';
import { CANONICAL_RPC_URL, probeYNXTestnetRPC } from "./rpc.mjs";
import { YNX_TESTNET_CHAIN_QUANTITY, WALLET_AUTH_PROTOCOL_SOURCE } from "./wallet-auth-contract.mjs";
import { DesktopAuthorizationController, parseWalletConnectActivation } from "./callback-policy.mjs";
import { PasswordWalletVault } from "./password-wallet-vault.mjs";
import {createPQKeyPreparationEntry} from './wallet-pq-key-entry.mjs';
import {createPQBackupActions} from './pq-backup-actions.mjs';
import {PQBackupFile} from './pq-backup-file.mjs';
import {createRegisteredPQRestore} from './wallet-pq-registered-restore.mjs';
import {acquireOriginalWalletRegisteredBinding,isOriginalWalletRegisteredBinding} from './original-policy-supplier/registered-binding-resource.mjs';
import * as pqKeySDK from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import * as pqBackupSDK from '@ynx-chain/wallet-auth/pq-wallet-backup';
import * as pqContractSDK from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {acquireOriginalWalletTransactionPolicy,isOriginalWalletTransactionPolicy} from './original-policy-supplier/transaction-resource.mjs';
import {acquireOriginalAccountPolicy,isOriginalAccountPolicyResource} from './original-policy-supplier/session-resource.mjs';
import {CANONICAL_NETWORK_ID as PQ_CANONICAL_NETWORK_ID,readOriginalTransaction} from './original-policy-supplier/operator-query.mjs';
import {initializeOriginalAuthIdentityStartup} from './original-auth-identity-startup.mjs';
import {originalAuthIdentityStartupUnresolved} from '../../../packages/wallet-auth/src/original-auth-identity-private-joint-registration.js';
import { assertWalletIPC } from "./wallet-ipc-policy.mjs";
import { DesktopWalletAuthority } from "./desktop-wallet-authority.mjs";
import { FilePermissionStore } from "./desktop-permission-store.mjs";
import { CanonicalTransactionSender } from "./canonical-transaction-sender.mjs";
import { FileTransactionIntentStore } from "./transaction-intent-store.mjs";
import { CanonicalAccountNetwork, NativeWalletService } from "./native-wallet-service.mjs";
import { WalletConnectTransport } from "./walletconnect-transport.mjs";
import { loadPublicWalletConnectConfig } from "./walletconnect-public-config.mjs";
import { WalletConnectRequestInbox } from "./walletconnect-request-inbox.mjs";
import { decodeWalletConnectQR } from "./walletconnect-qr-decoder.mjs";
import { createReceiveCode, createBitcoinReceiveCode, createEVMReceiveCode } from "./receive-code.mjs";
import { NativeContractClient } from "./native-contract.mjs";
import { createNativeContractService } from "./native-contract-service.mjs";
import { WalletPayInvoiceClient } from "./wallet-pay-invoice-reference.mjs";
import { createInvoiceReferenceService } from "./wallet-invoice-reference-service.mjs";
import { decodeInvoiceReferenceQR } from "./wallet-invoice-reference-qr.mjs";
import {createDesktopPayService,installDesktopPayIPC} from "./wallet-pay-service.mjs";
import {DesktopNativePayChain} from "./native-pay-chain.mjs";
import { parsePaymentRecipient, decodePaymentRecipientQR, decodeEVMRecipientQR, decodeFamilyRecipientQR } from "./payment-recipient.mjs";
import { canonicalizeWindowsYNXWalletProtocolUrl, extractYNXWalletProtocolUrl } from "./protocol-activation.mjs";

// AppImage launchers may add --no-sandbox on hosts without user namespaces.
// Electron documents that this disables OS sandboxing even with sandbox:true.
// Stop before profile selection, key lifecycle, IPC or any Wallet window exists.
if (app.commandLine.hasSwitch("no-sandbox")) {
  console.error("YNX_WALLET_SANDBOX_REQUIRED: YNX Wallet cannot run with --no-sandbox. Use the native installer on a system with sandbox support.");
  app.exit(78);
  throw new Error("YNX_WALLET_SANDBOX_REQUIRED");
}
app.enableSandbox();

const directory = path.dirname(fileURLToPath(import.meta.url));
function handleWalletIPC(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { assertWalletIPC(event, mainWindow?.webContents, pathToFileURL(path.join(directory, "index.html")).href); }
    catch (error) { return safeIPC(() => { throw error; }); }
    return handler(event, ...args);
  });
}
const isolatedProfile = process.env.YNX_WALLET_PROFILE_PATH;
if (isolatedProfile) {
  if (!path.isAbsolute(isolatedProfile)) throw new Error("YNX_WALLET_PROFILE_PATH must be an absolute path");
  app.setPath("userData", isolatedProfile);
}
// Canonical public RPC from Central endpoint matrix d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59.
const configuredRpcUrl = process.env.YNX_WALLET_RPC_URL;
const rpcUrl = configuredRpcUrl || CANONICAL_RPC_URL;
const evidencePath = process.env.YNX_WALLET_EVIDENCE_PATH;
let mainWindow;
let walletWindowTitle=app.isPackaged?"YNX Wallet":"YNX Wallet · 测试构建 / QA · 源码未验证";
let authorizationController;
let protocolReady = false;
let lastCallback = null;
let walletAuthority;
let nativeWallet;
let multichain;
let familyAccounts;
let familyRead;
let familyRecovery;
let familyBitcoinTransfer;
let familyTronTransfer;
let familyTronSubmission;
let familyBitcoinSubmission;
let multichainSecurityContext=null;
let walletConnect;
let pqKeyPreparation;
let pqBackupActions;
let pqRegisteredRestore;
const keyAccess = new DesktopKeyLifecycle({ focused: () => mainWindow?.isFocused() === true });
// No lawful SAME-Vault custodian or inherited IDE control stream is provisioned
// in R8/R9. Only the original main owner may replace this fixed source binding
// after Auth/IDE integration. Never accept a renderer/ENV provider or key.
let originalAdmissionSupply = null;
let originalAdmissionVault = null;
let originalAdmissionEntry = null;
const originalAdmission = createOriginalAdmissionController({
  getSupply:()=>originalAdmissionSupply,
  run:operation=>keyAccess.run(operation),
  getContext:()=>({...keyAccess.status(),focused:mainWindow?.isFocused()===true,changing:accountChangeInProgress}),
  id:randomUUID,
  onState:()=>originalAdmissionEntry?.emit(),
});
// Actual normal caller adapter. This owns preparation/selection, not a second
// Vault or a renderer-supplied provider. Controller's effect machinery is kept.
function createOriginalAdmissionEntry({controller,keyAccess,getVault,getWindow,openSupply,closeSupply,readSummary,setSupply,selectionUnresolved,notify,now=Date.now}){
  let epoch=0,viewRevision=0,preparing=false,reading=false,recovery={state:'not-read',records:null,runtimeRecords:null,unresolved:null},selected=null,cleanupDebt=false,firstCause=null,firstCausePresent=false;
  const entered=new Set();let selectionClose=null,shuttingDown=false,shutdownPass=null,unavailableReason=null;
  function publicSupplyFailure(cause){
    // Only fixed public codes, never supplier messages, paths or accessors.
    let descriptor;try{descriptor=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'code'):null;}catch{return null;}
    const code=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:null;
    return ['AUTH_IDENTITY_IDE_EXTERNAL_ORIGINALS_NOT_PROTECTED','AUTH_IDENTITY_ORIGINAL_PROFILE_NOT_SUPPLIED','ADMISSION_SUMMARY_NOT_SUPPLIED','WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'].includes(code)?code:null;
  }
  function operation(action){
    if(shuttingDown)return Promise.reject(error('ADMISSION_SHUTDOWN_ENTERED'));
    const pass=Promise.resolve().then(()=>{if(shuttingDown)throw error('ADMISSION_SHUTDOWN_ENTERED');return action();});entered.add(pass);
    void pass.then(()=>entered.delete(pass),()=>entered.delete(pass));return pass;
  }
  const error=code=>Object.assign(new Error(code),{code});
  const context=()=>({...keyAccess.status(),focused:getWindow()?.isFocused()===true,changing:accountChangeInProgress});
  const retain=e=>{if(!firstCausePresent){firstCause=e;firstCausePresent=true;}};
  function unresolved(){const s=controller.status();return s.busy||s.hasReview||s.outcomeUnknown||s.ownerRetained||s.publicationRetained&&!['acknowledged','retired'].includes(s.phase)||s.cleanupIncomplete||cleanupDebt||selectionUnresolved();}
  function status(){const c=context(),s=controller.status();return Object.freeze({...s,unavailableReason,revision:viewRevision,account:c.account,securityRevision:c.revision,locked:c.locked,preparing,recovery,cleanupIncomplete:s.cleanupIncomplete||cleanupDebt||selectionUnresolved(),canPrepareReview:!shuttingDown&&!c.locked&&!c.authenticating&&c.focused&&!c.changing&&!preparing&&!reading&&!unresolved()&&recovery.unresolved!==true});}
  function emit(){viewRevision++;try{notify(status());}catch{}return status();}
  function fence(c,token,guard){guard.assert();const next=context(),at=now();if(!Number.isSafeInteger(at)||!Number.isSafeInteger(c.unlockExpiresAt)||at>=c.unlockExpiresAt||epoch!==token||next.locked||next.authenticating||!next.focused||next.changing||next.account!==c.account||next.revision!==c.revision||next.unlockExpiresAt!==c.unlockExpiresAt)throw error('ADMISSION_PREPARATION_RETIRED');}
  function releaseSelection(){
    if(selectionClose)return selectionClose;
    if(!selected)return Promise.resolve();
    const original=selected;
    selectionClose=Promise.resolve().then(()=>closeSupply(original)).then(()=>{if(selected===original){selected=null;setSupply(null);}selectionClose=null;},e=>{retain(e);cleanupDebt=true;throw error('ADMISSION_CONFIGURATION_CLEANUP_UNKNOWN');});
    void selectionClose.catch(()=>{});return selectionClose;
  }
  async function refresh(){
    const c=context(),operation=controller.status();if(c.locked||c.authenticating||!c.focused||c.changing||preparing||reading||operation.busy||operation.hasReview)return status();
    const token=epoch;reading=true;
    try{await keyAccess.run(async guard=>{fence(c,token,guard);const value=await readSummary(getVault(),guard);fence(c,token,guard);recovery=value;});}
    catch(e){retain(e);if(epoch===token)recovery={state:'unavailable',records:null,runtimeRecords:null,unresolved:null};}
    finally{reading=false;emit();}return status();
  }
  async function review(){
    if(preparing||reading||unresolved())throw error('ADMISSION_OPERATION_UNRESOLVED');
    const c=context(),token=epoch;
    if(c.locked||c.authenticating||!c.focused||c.changing)throw error('WALLET_LOCKED');
    unavailableReason=null;preparing=true;emit();
    try{
      await keyAccess.run(async guard=>{
        fence(c,token,guard);
        const summary=await readSummary(getVault(),guard);fence(c,token,guard);recovery=summary;
        if(summary.state!=='read')throw error('ADMISSION_SUMMARY_NOT_SUPPLIED');
        if(summary.unresolved)throw error('ADMISSION_OPERATION_UNRESOLVED');
        await releaseSelection();fence(c,token,guard);
        const acquired=await openSupply(getVault(),guard);
        selected=acquired; // Retain late returned custody before generation check.
        fence(c,token,guard);
        if(!acquired){setSupply(null);throw error('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');}
        setSupply(acquired);controller.review();fence(c,token,guard);
      });
    }catch(e){retain(e);unavailableReason=publicSupplyFailure(e);controller.cancel();try{await releaseSelection();}catch{}emit();throw error('ADMISSION_REVIEW_UNAVAILABLE');}
    finally{preparing=false;emit();}
    return status();
  }
  async function releaseIdleSelection(){const s=controller.status();if(!preparing&&!s.busy&&!s.ownerRetained&&!s.cleanupIncomplete)try{await releaseSelection();}catch{}emit();}
  async function cancel(){epoch++;controller.cancel();emit();await releaseIdleSelection();return status();}
  function securityChanged(){epoch++;unavailableReason=null;controller.cancel();recovery={state:'locked',records:null,runtimeRecords:null,unresolved:null};emit();void releaseIdleSelection();}
  async function confirm(id){
    if(preparing||reading||cleanupDebt||selectionUnresolved()||recovery.unresolved===true||recovery.state!=='read')throw error('ADMISSION_OPERATION_UNRESOLVED');
    try{await controller.confirm(id);}finally{await releaseIdleSelection();emit();}
    return status();
  }
  function shutdown(){
    if(shutdownPass)return shutdownPass;
    shuttingDown=true;
    let resolve,reject;shutdownPass=new Promise((yes,no)=>{resolve=yes;reject=no;});
    // Reserve the drain before a cancellation can synchronously reenter it.
    epoch++;controller.cancel();emit();
    void (async()=>{
      try{
        while(entered.size)await Promise.allSettled([...entered]);
        const s=controller.status();
        if(s.busy||s.ownerRetained||s.cleanupIncomplete||cleanupDebt)throw error('ADMISSION_SHUTDOWN_INCOMPLETE');
        await releaseSelection();
        if(controller.status().outcomeUnknown||selectionUnresolved()||cleanupDebt)throw error('ADMISSION_SHUTDOWN_INCOMPLETE');
        resolve(status());
      }catch(e){retain(e);emit();reject(error('ADMISSION_SHUTDOWN_INCOMPLETE'));}
    })();
    void shutdownPass.catch(()=>{});return shutdownPass;
  }
  return Object.freeze({status,refresh:()=>operation(refresh),review:()=>operation(review),confirm:id=>operation(()=>confirm(id)),cancel,securityChanged,emit,shutdown});
}
originalAdmissionEntry=createOriginalAdmissionEntry({controller:originalAdmission,keyAccess,getVault:()=>originalAdmissionVault,getWindow:()=>mainWindow,openSupply:openOriginalAdmissionSupply,closeSupply:closeOriginalAdmissionSupply,readSummary:readOriginalAdmissionSummary,setSupply:value=>{originalAdmissionSupply=value;},selectionUnresolved:()=>originalAdmissionSelectionUnresolved()||originalAuthIdentityStartupUnresolved(originalAdmissionVault),notify:state=>mainWindow?.webContents.send('wallet:original-admission-state',state)});
handleWalletIPC('wallet:original-admission-status',()=>safeIPC(()=>originalAdmissionEntry.refresh()));
handleWalletIPC('wallet:original-admission-review',()=>safeIPC(()=>originalAdmissionEntry.review()));
handleWalletIPC('wallet:original-admission-confirm',(_event,reviewId)=>safeIPC(()=>originalAdmissionEntry.confirm(reviewId)));
handleWalletIPC('wallet:original-admission-cancel',()=>safeIPC(()=>originalAdmissionEntry.cancel()));
function createOriginalAdmissionExitGate({entry,lock,quit,report,shutdownWallet=async()=>{}}){
  let pass=null,allowed=false,quitEntered=false;const closingWindows=new WeakSet();
  const quitOnce=()=>{if(!quitEntered){quitEntered=true;setImmediate(quit);}};
  function request(){
    if(pass)return pass;
    let resolve,reject;pass=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const failed=()=>{try{report();}catch{}reject(Object.assign(new Error('Original admission cleanup is incomplete'),{code:'ADMISSION_SHUTDOWN_INCOMPLETE'}));};
    // Lock/cancel synchronously in the original close event, after reserving.
    try{lock();void Promise.all([entry.shutdown(),shutdownWallet()]).then(()=>{allowed=true;resolve();},failed);}catch{failed();}
    void pass.catch(()=>{});return pass;
  }
  return Object.freeze({close(event,window){if(allowed)return;event.preventDefault();if(closingWindows.has(window))return;closingWindows.add(window);void request().then(()=>window.destroy(),()=>{});},beforeQuit(event){if(allowed)return;event.preventDefault();void request().then(quitOnce,()=>{});},allClosed(){void request().then(quitOnce,()=>{});},request});
}
const originalAdmissionExit=createOriginalAdmissionExitGate({entry:originalAdmissionEntry,shutdownWallet:()=>walletAuthority?.shutdownPQReviews(),lock:()=>keyAccess.lock('closed'),quit:()=>app.quit(),report:()=>dialog.showErrorBox('Wallet cleanup incomplete','The original operation has not finished cleanup. Wallet remains open; no operation will be retried. 原操作尚未完成清理，钱包保持打开，不会重试。')});
app.on('before-quit',event=>originalAdmissionExit.beforeQuit(event));
const recipientCameraPermission = createRecipientCameraPermission({
  getContext: () => ({...keyAccess.status(), focused: mainWindow?.isFocused() === true, changing: accountChangeInProgress}),
  getContents: () => mainWindow?.webContents,
  expectedURL: pathToFileURL(path.join(directory, "index.html")).href,
  id: randomUUID,
});
handleWalletIPC("wallet:camera-begin", () => safeIPC(() => recipientCameraPermission.begin()));
handleWalletIPC("wallet:camera-end", (_event, id) => safeIPC(() => {recipientCameraPermission.end(id); return null;}));
let lastReviewAccount = null;
let originalAdmissionSecurityStamp = null;
keyAccess.subscribe(state => {
  const admissionStamp=[state.revision,state.locked,state.account,state.authenticating].join(':');
  if(admissionStamp!==originalAdmissionSecurityStamp){originalAdmissionSecurityStamp=admissionStamp;originalAdmissionEntry.securityChanged();}
  const context=[state.revision,state.locked,state.account,state.authenticating].join(':');
  if(context!==multichainSecurityContext){multichainSecurityContext=context;multichain?.invalidate();familyBitcoinTransfer?.invalidate();familyBitcoinSubmission?.invalidate();familyTronTransfer?.invalidate();familyTronSubmission?.invalidate();}
  recipientCameraPermission.invalidate();
  if (state.account !== lastReviewAccount) {
    lastReviewAccount = state.account;
    authorizationController?.cancel();
    for (const entry of walletConnectInbox.pending()) { walletConnectInbox.finish(entry.key); void terminateWalletConnectReview(entry, "ACCOUNT_CHANGED"); }
    walletConnectProposalAccounts.clear();
  }
  if (state.locked && !state.authenticating) {
    walletConnect?.cancelPair(true);
    authorizationController?.suspend(); nativeWallet?.clear();
  }
  mainWindow?.webContents.send("wallet:security-state", state);
  if (!state.locked && !state.authenticating) void drainWalletConnectInbox();
});
const sensitiveIPC = (action, options, displayOptions) => safeIPC(() => keyAccess.run(action, options), displayOptions);
handleWalletIPC('wallet:family-account', (_event, input) => sensitiveIPC(() => {
  if (!familyAccounts) throw new Error('Wallet is starting.');
  return familyAccounts.account(input);
}));
handleWalletIPC('wallet:family-tron-receive-code', (_event, input) => sensitiveIPC(() => {
  if (!familyAccounts || !familyRead) throw new Error('Wallet is starting.');
  return createTronReceiveCode(input, {readAccount: value => familyAccounts.account(value), readNetworks: () => familyRead.snapshot(), getContext: () => familyRead.getContext()});
}));
handleWalletIPC('wallet:family-networks', () => safeIPC(() => familyRead.snapshot()));
handleWalletIPC('wallet:family-network', (_event, input) => safeIPC(() => familyRead.configure(input)));
handleWalletIPC('wallet:family-balances', (_event, input) => sensitiveIPC(() => familyRead.balances(input)));
handleWalletIPC('wallet:family-token', (_event, input) => sensitiveIPC(() => familyRead.importToken(input)));
handleWalletIPC('wallet:family-tokens', (_event, input) => safeIPC(() => familyRead.tokenCatalog(input)));
handleWalletIPC('wallet:family-token-remove', (_event, input) => sensitiveIPC(() => familyRead.removeToken(input)));
handleWalletIPC('wallet:family-records', (_event, input) => safeIPC(() => familyRecovery.list(input)));
handleWalletIPC('wallet:family-check', (_event, input) => safeIPC(() => familyRecovery.check(input)));
handleWalletIPC('wallet:family-btc-prepare', (_event, input) => sensitiveIPC(() => familyBitcoinTransfer.prepare(input)));
handleWalletIPC('wallet:family-btc-cancel', (_event, input) => safeIPC(() => familyBitcoinTransfer.cancel(input)));
handleWalletIPC('wallet:family-btc-sign', (_event, input) => sensitiveIPC(() => familyBitcoinTransfer.sign(input)));
handleWalletIPC('wallet:family-tron-prepare', (_event, input) => sensitiveIPC(() => familyTronTransfer.prepare(input)));
handleWalletIPC('wallet:family-tron-cancel', (_event, input) => safeIPC(() => familyTronTransfer.cancel(input)));
handleWalletIPC('wallet:family-tron-sign', (_event, input) => sensitiveIPC(() => familyTronTransfer.sign(input)));
handleWalletIPC('wallet:family-tron-submit-review', (_event, input) => sensitiveIPC(() => familyTronSubmission.review(input)));
handleWalletIPC('wallet:family-tron-submit-cancel', (_event, input) => safeIPC(() => familyTronSubmission.cancel(input)));
handleWalletIPC('wallet:family-tron-submit', (_event, input) => sensitiveIPC(() => familyTronSubmission.send(input,keyAccess.current())));
handleWalletIPC('wallet:family-btc-submit-review', (_event, input) => sensitiveIPC(() => familyBitcoinSubmission.review(input)));
handleWalletIPC('wallet:family-btc-submit-cancel', (_event, input) => safeIPC(() => familyBitcoinSubmission.cancel(input)));
handleWalletIPC('wallet:family-btc-submit', (_event, input) => sensitiveIPC(() => familyBitcoinSubmission.send(input,keyAccess.current())));
installMultichainIPC({handle:handleWalletIPC,safe:safeIPC,sensitive:sensitiveIPC,getGuard:()=>keyAccess.current(),service:new Proxy({}, {get:(_target,name)=>(...args)=>{if(!multichain)throw new Error('Wallet is starting.');return multichain[name](...args)}})});
const readNativeContract = createNativeContractService({
  client: new NativeContractClient(CANONICAL_RPC_URL, net.fetch.bind(net)),
  getContext: () => ({...keyAccess.status(), focused: mainWindow?.isFocused() === true, changing: accountChangeInProgress}),
});
const readInvoiceReference=createInvoiceReferenceService({
  client:new WalletPayInvoiceClient("https://api.ynxweb4.com",net.fetch.bind(net)),
  getContext:()=>({...keyAccess.status(),focused:mainWindow?.isFocused()===true,changing:accountChangeInProgress}),
});
const walletConnectRequests = new Map();
const walletConnectInbox = new WalletConnectRequestInbox({ onExpire: terminateWalletConnectReview });
let drainingWalletConnectInbox = false;
const walletConnectProposalAccounts = new Map();
const walletConnectProposalActions = new Set();
let accountChangeInProgress = false;
const desktopPayService=createDesktopPayService({
  getContext:()=>({...keyAccess.status(),focused:mainWindow?.isFocused()===true,changing:accountChangeInProgress}),
  getIdentity:()=>walletAuthority.accountStatus(),
  getRuntime:()=>({vault:walletAuthority.vault,lifecycle:keyAccess,store:walletAuthority.transactionSender.submissions.intentStore,client:new DesktopNativePayChain({fetchImpl:net.fetch.bind(net)})}),
});
installDesktopPayIPC({handleWalletIPC,safeIPC,service:desktopPayService});
// Main-process boot composition only. Sole issuer A supplies its admitted real
// policy, quote/current-authority/business and authenticated settlement ports.
// This function is NOT an IPC, renderer, CLI or environment activation path.
export function composeProtectedDesktopPay(integration){desktopPayService.compose(integration)}
const startupProtocolUrls = [];
let protocolRegistration = { platform: process.platform, attempted: false, registered: false };
const initialProtocolUrl = extractYNXWalletProtocolUrl(process.argv);
if (initialProtocolUrl) queueStartupProtocolUrl(initialProtocolUrl);

function queueStartupProtocolUrl(url) {
  if (startupProtocolUrls.length < 16) startupProtocolUrls.push(url);
}

async function rpcStatus() {
  return probeYNXTestnetRPC({ rpcUrl: configuredRpcUrl, expectedChainId: YNX_TESTNET_CHAIN_QUANTITY, fetchImpl: net.fetch.bind(net) });
}

async function recordEvidence(status, window, { launch = false } = {}) {
  if (!evidencePath) return;
  let prior = { launches: 0 };
  try { prior = JSON.parse(await readFile(evidencePath, "utf8")); } catch {}
  const accountRead = walletAuthority ? await safeIPC(() => walletAuthority.accountStatus()) : null;
  const authority = accountRead?.ok ? accountRead.value : { initialized: null, account: null, custody: "unavailable", accountReadFailed: true };
  const evidence = {
    schemaVersion: 1,
    appVersion: app.getVersion(),
    launches: Number(prior.launches || 0) + (launch ? 1 : 0),
    visibleShellReady: true,
    window: {
      title: window.getTitle(),
      visible: window.isVisible(),
      destroyed: window.isDestroyed()
    },
    walletAuthContract: { ...WALLET_AUTH_PROTOCOL_SOURCE, imported: true, expectedChainId: YNX_TESTNET_CHAIN_QUANTITY },
    rpc: status,
    providerAuthority: {
      accountCreated: authority.initialized,
      approvedAccount: authority.account,
      custody: authority.custody,
      externalAccountExposureRequiresOriginApproval: true,
      supportedMethods: ["eth_chainId", "eth_accounts", "eth_requestAccounts", "wallet_getPermissions", "wallet_requestPermissions", "wallet_revokePermissions", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]
    },
    accountCreated: false,
    balanceClaimed: false,
    transactionCreated: false,
    signingEnabled: authority.initialized === true && !authority.recoveryRequired && !keyAccess.status().locked,
    keySecurity: keyAccess.status(),
    callback: lastCallback ?? prior.callback ?? {
      received: false,
      acceptedForReview: false,
      callbackEmitted: false,
      authorityGranted: false
    },
    protocolRegistration
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

handleWalletIPC("wallet:status", rpcStatus);
handleWalletIPC("wallet:app-info", () => ({ version: app.getVersion() }));
handleWalletIPC("wallet:security-status", () => keyAccess.status());
handleWalletIPC("wallet:unlock", (_event, input) => safeIPC(() => {
  if (accountChangeInProgress) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  return keyAccess.unlock(input);
}));
handleWalletIPC("wallet:lock", () => { keyAccess.lock(); return keyAccess.status(); });
handleWalletIPC('wallet:session-publication-records',()=>sensitiveIPC(()=>walletAuthority.canonicalPublicationRecords()));
handleWalletIPC('wallet:session-publication-outcome',(_event,digest)=>sensitiveIPC(()=>walletAuthority.readCanonicalPublicationOutcome(digest)));
handleWalletIPC("wallet:password-setup", (_event, input) => safeIPC(() => custodyChange((guard, beforePublish) => walletAuthority.vault.setup(input, guard, { beforePublish }))));
handleWalletIPC("wallet:recovery-history", () => safeIPC(() => walletAuthority.vault.recoveryHistory()));
handleWalletIPC("wallet:recovery-preview", (_event, input) => safeIPC(() => {
  if (accountChangeInProgress) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  return keyAccess.custody(guard => walletAuthority.vault.prepareRecovery(input, guard));
}));
handleWalletIPC("wallet:recovery-commit", (_event, previewId) => safeIPC(() => custodyChange((guard, beforePublish) => walletAuthority.vault.commitRecovery(previewId, guard, { beforePublish }))));
handleWalletIPC("wallet:authorization-action", async (_event, input) => {
  const action = typeof input === "string" ? input : input?.action;
  try {
    if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: "ACCOUNT_CHANGED" });
    const result = await keyAccess.run(() => authorizationController.act(input));
    lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: result.callbackEmitted, callbackReceivedProved: false, authorityGranted: result.authorityGranted, productSessionCreated: false };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(walletWindowTitle);
      await recordEvidence(await rpcStatus(), mainWindow);
    }
    return result;
  } catch (error) {
    return authorizationFailure(error.authorizationStage ?? error.code ?? "CANONICAL_AUTHORIZATION_SIGN_FAILED", action, error);
  }
});

async function authorizationFailure(stageCode, action, error) {
  const underlyingCode = safeCode(error);
  let sessionOriginal=null;const review=authorizationController?.pending;
  if(review?.account&&review?.request)try{sessionOriginal=await walletAuthority.canonicalAuthorizationStatus(review.request,review.account);}catch{}
  const outcomeUnknown = error?.data?.outcomeUnknown === true||sessionOriginal?.deliveryAttempted===true;
  const result = { acceptedForReview: Boolean(authorizationController?.pending), action, code: stageCode, underlyingCode, failureClass: safeErrorClass(error), failureCategory: safeFailureCategory(error), sessionOriginal, callbackEmitted: outcomeUnknown ? null : false, callbackOutcomeUnknown: outcomeUnknown, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false };
  lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: result.callbackEmitted, callbackOutcomeUnknown: outcomeUnknown, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false };
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return result;
}

handleWalletIPC("wallet:account-status", () => safeIPC(() => walletAuthority.accountStatus()));
handleWalletIPC("wallet:import-account", async (_event, input) => {
  let importView=null;
  const response=await safeIPC(() => changeActiveAccount(() => walletAuthority.importAccount(input),({before,after})=>{
    // Public error-display checkpoint only. Never return imported key/words.
    if(['private-key','recovery-phrase','encrypted-json'].includes(input?.kind))importView={kind:input.kind,account:before.account,revision:before.revision,retiredRevision:after.revision};
  }));
  return importView?{...response,importView}:response;
});
handleWalletIPC("wallet:balance", () => safeIPC(() => nativeWallet.balance()));
handleWalletIPC("wallet:native-contract", (_event, input) => safeIPC(() => readNativeContract(input)));
handleWalletIPC("wallet:invoice-reference",(_event,reference)=>safeIPC(()=>readInvoiceReference(reference)));
handleWalletIPC("wallet:invoice-reference-qr",(_event,input)=>safeIPC(()=>{
  if(!(input?.bytes instanceof ArrayBuffer)||input.bytes.byteLength>10*1024*1024)throw Object.assign(new Error("Choose a supported QR image up to 10 MB."),{code:"INVALID_QR_IMAGE"});
  return decodeInvoiceReferenceQR({bytes:Buffer.from(input.bytes),mimeType:input.mimeType,createImage:bytes=>nativeImage.createFromBuffer(bytes)});
}));
handleWalletIPC("wallet:pending-transactions", () => safeIPC(async () => walletAuthority.transactionSender.submissions.list((await walletAuthority.accountStatus()).account)));
// The custody controller owns its lifecycle.run; do not nest sensitiveIPC.
handleWalletIPC('wallet:pq-keys-status',()=>safeIPC(()=>pqKeyPreparation.status()));
handleWalletIPC('wallet:pq-keys-recover',()=>safeIPC(()=>pqKeyPreparation.recover()));
handleWalletIPC('wallet:pq-keys-generate',()=>safeIPC(()=>pqKeyPreparation.generate()));
handleWalletIPC('wallet:pq-keys-reconcile',()=>safeIPC(()=>pqKeyPreparation.reconcile()));
handleWalletIPC('wallet:pq-keys-cancel',()=>safeIPC(()=>pqKeyPreparation.cancel()));
handleWalletIPC('wallet:pq-backup-export',()=>safeIPC(()=>pqBackupActions.export()));
handleWalletIPC('wallet:pq-backup-verify',()=>safeIPC(()=>pqBackupActions.verify()));
handleWalletIPC('wallet:pq-restore',(_event,input)=>safeIPC(()=>pqRegisteredRestore.restore(input)));
handleWalletIPC('wallet:pq-restore-recover',()=>safeIPC(()=>pqRegisteredRestore.recover()));
handleWalletIPC('wallet:pq-restore-resume',()=>safeIPC(()=>pqRegisteredRestore.resume()));
handleWalletIPC('wallet:pq-transaction-status',(_event,hash)=>sensitiveIPC(async()=>{
  const guard=keyAccess.current(),status=await walletAuthority.accountStatus();guard.assert();
  if(guard.account!==status.account)throw Object.assign(Error('Select the original account.'),{data:{code:'ACCOUNT_CHANGED'}});
  return walletAuthority.transactionSender.submissions.checkPQ(hash,status.account,guard);
}));
handleWalletIPC('wallet:pq-transfer-review',(_event,input)=>sensitiveIPC(async()=>{
  const response=await walletAuthority.requestPQTransfer(input);
  keyAccess.current().assert();mainWindow?.webContents.send('wallet:provider-request',response.request);
  return {requestId:response.request.id,submitted:false};
}));
handleWalletIPC('wallet:pq-migration-review',(_event,input)=>sensitiveIPC(async()=>{
  const response=await walletAuthority.requestPQMigration(input);
  keyAccess.current().assert();mainWindow?.webContents.send('wallet:provider-request',response.request);
  return {requestId:response.request.id,submitted:false};
}));
handleWalletIPC('wallet:pq-revocation-review',(_event,input)=>sensitiveIPC(async()=>{
  const response=await walletAuthority.requestPQRevocation(input);
  keyAccess.current().assert();mainWindow?.webContents.send('wallet:provider-request',response.request);
  return {requestId:response.request.id,submitted:false};
}));
handleWalletIPC('wallet:pq-original-save',(_event,hash)=>sensitiveIPC(async()=>{
  const guard=keyAccess.current(),status=await walletAuthority.accountStatus();guard.assert();
  return walletAuthority.transactionSender.submissions.recoverPQOriginal(hash,status.account,guard);
}));
handleWalletIPC('wallet:pq-original-reconcile',(_event,hash)=>sensitiveIPC(async()=>{
  const guard=keyAccess.current(),status=await walletAuthority.accountStatus();guard.assert();
  return walletAuthority.transactionSender.submissions.recoverPQOriginal(hash,status.account,guard,{readOnly:true});
}));
handleWalletIPC("wallet:transaction-history", (_event, cursor) => safeIPC(async () => {
  const account = (await walletAuthority.accountStatus()).account;
  const page = await walletAuthority.transactionSender.submissions.history(account, cursor ?? null);
  if ((await walletAuthority.accountStatus()).account !== account) throw Object.assign(new Error("The selected account changed. Refresh its transaction history."), { data: { code: "ACCOUNT_CHANGED" } });
  return page;
}));
handleWalletIPC("wallet:transaction-status", (_event, hash) => safeIPC(async () => walletAuthority.transactionSender.submissions.check(hash, (await walletAuthority.accountStatus()).account)));
handleWalletIPC("wallet:save-transaction-original", (_event, hash) => sensitiveIPC(async () => {
  const lease=keyAccess.current(),status=await walletAuthority.accountStatus();
  lease.assert();
  return walletAuthority.transactionSender.submissions.saveOriginal(hash,status.account,lease);
}));
handleWalletIPC("wallet:retry-transaction", (_event, hash) => sensitiveIPC(async () => {
  const lease = keyAccess.current(), status = await walletAuthority.accountStatus();
  lease.assert();
  return walletAuthority.transactionSender.submissions.retry(hash, status.account, lease);
}));
handleWalletIPC("wallet:prepare-transfer", (_event, input) => sensitiveIPC(() => nativeWallet.prepareTransfer(input), undefined, { localTransferPreparation: true }));
handleWalletIPC("wallet:transfer-action", async (_event, id, action) => {
  const attempt=nativeWallet.beginTransferAttempt(id,action);
  const result=await sensitiveIPC(() => nativeWallet.transferAction(id, action));
  nativeWallet.finishTransferAttempt(attempt,result);
  return result;
});
handleWalletIPC("wallet:transfer-attempts", (_event, account) => safeIPC(async () => {
  if(account!==(await walletAuthority.vault.status()).account)throw Object.assign(new Error("Selected account changed"),{code:4100,data:{code:"ACCOUNT_CHANGED"}});
  return nativeWallet.transferAttempts(account);
}));
handleWalletIPC("wallet:save-backup", (_event, password) => sensitiveIPC(async () => {
  const status = await walletAuthority.accountStatus();
  if (!status.initialized) throw new Error("Create or import an account first");
  const encrypted = await walletAuthority.vault.encryptedBackup(password);
  const selected = await keyAccess.withOwnedDialog(() => dialog.showSaveDialog(mainWindow, { title: "Save encrypted Wallet backup", defaultPath: `ynx-wallet-${status.account.slice(2, 10)}.json`, filters: [{ name: "Encrypted JSON wallet", extensions: ["json"] }] }));
  if (selected.canceled || !selected.filePath) return { saved: false };
  await keyAccess.current().step(() => writeFile(selected.filePath, encrypted, { mode: 0o600, flag: "wx" }));
  return { saved: true, account: status.account };
}));
handleWalletIPC("wallet:create-account", () => safeIPC(async () => {
  if (authorizationController.inFlight) throw Object.assign(new Error("Finish the current authorization first"), { code: "AUTHORIZATION_ACTION_IN_PROGRESS" });
  const result = await keyAccess.run(() => walletAuthority.createAccount());
  keyAccess.setAccount(result.account);
  mainWindow?.webContents.send("wallet:account-status-result", result);
  const review = await authorizationController.refreshAccount();
  if (review?.acceptedForReview) mainWindow?.webContents.send("wallet:authorization-request", review);
  else if (review) mainWindow?.webContents.send("wallet:authorization-error", review);
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return result;
}));
handleWalletIPC("wallet:add-account", () => safeIPC(() => changeActiveAccount(() => walletAuthority.addAccountAndSelect())));
handleWalletIPC("wallet:prepare-mnemonic-account", (_event,input) => sensitiveIPC(() => walletAuthority.vault.prepareMnemonicAccount(input)));
handleWalletIPC("wallet:cancel-mnemonic-account", () => safeIPC(() => {walletAuthority.vault.cancelMnemonicAccount();return {cancelled:true}}));
handleWalletIPC("wallet:commit-mnemonic-account", async (_event,input) => {
  let creationView=null;
  const response=await safeIPC(async()=>{
    const commit=walletAuthority.vault.consumeMnemonicCommit(input,true);
    let result;
    try{result=await changeActiveAccount(commit,({before,after})=>{
      // Public error-display binding only; never return confirmation words.
      if(typeof input?.id==='string'&&input.id.length<=128)creationView={id:input.id,account:before.account,revision:before.revision,retiredRevision:after.revision};
    })}finally{commit.dispose()}
    const review=await authorizationController.refreshAccount();
    if(review?.acceptedForReview)mainWindow?.webContents.send("wallet:authorization-request",review);
    return result;
  });
  return creationView?{...response,creationView}:response;
});
handleWalletIPC("wallet:recovery-phrase", (_event,password) => sensitiveIPC(() => walletAuthority.vault.recoveryPhrase(password)));
handleWalletIPC("wallet:receive-code", (_event, expectedAccount) => typeof expectedAccount==='string'
  ? safeIPC(() => createReceiveCode(expectedAccount, () => walletAuthority.accountStatus()))
  : sensitiveIPC(() => {if(Object.getOwnPropertyDescriptor(expectedAccount??{},'family')?.value==='evm'){if(!multichain)throw new Error('Wallet is starting.');return createEVMReceiveCode(expectedAccount,{readSnapshot:()=>multichain.snapshot(),getContext:()=>({...keyAccess.status(),networkEpoch:multichain.epoch})});}if(!familyAccounts||!familyRead)throw new Error('Wallet is starting.');return createBitcoinReceiveCode(expectedAccount,{readAccount:value=>familyAccounts.account(value),readNetworks:()=>familyRead.snapshot(),getContext:()=>familyRead.getContext()});}));
handleWalletIPC("wallet:payment-recipient", (_event, input) => safeIPC(() => parsePaymentRecipient(input)));
handleWalletIPC("wallet:payment-qr", (_event, input) => safeIPC(() => {
  if (!(input?.bytes instanceof ArrayBuffer) || input.bytes.byteLength > 10 * 1024 * 1024) throw new Error("Invalid QR image");
  const image={ bytes: Buffer.from(input.bytes), mimeType: input.mimeType, createImage: bytes => nativeImage.createFromBuffer(bytes) };
  if(input.target==='bitcoin'||input.target==='tron'){
    if(!familyRead||!familyRecovery)throw Error('Wallet is starting.');
    return familyRead.gate.run(()=>decodeFamilyRecipientQR(image,{expected:{family:input.target,account:input.account,revision:input.revision,network:input.network,configRevision:input.configRevision},readNetworks:()=>familyRead.snapshot(),getContext:()=>familyRead.getContext(),getSecurity:()=>keyAccess.status(),readRecords:()=>familyRecovery.list({family:input.target,network:input.network})}));
  }
  if(input.target==='evm'){if(!multichain)throw Error('Wallet is starting.');return decodeEVMRecipientQR(image,{expected:{account:input.account,revision:input.revision,networkId:input.networkId,configRevision:input.configRevision},readSnapshot:()=>multichain.snapshot(),getContext:()=>({...keyAccess.status(),networkEpoch:multichain.epoch})})}
  return decodePaymentRecipientQR(image);
}));
handleWalletIPC("wallet:select-account", async (_event, account) => {
  let selectionView=null;
  const result=await safeIPC(()=>changeActiveAccount(()=>walletAuthority.selectAccount(account),({before,after})=>{
    // Public display ownership only, never a key/session or an authorization.
    if(typeof account==='string'&&account.length<=128)selectionView={account:before.account,target:account,revision:before.revision,retiredRevision:after.revision};
  }));
  return selectionView?{...result,selectionView}:result;
});
handleWalletIPC("wallet:permissions", (_event, origin) => safeIPC(() => walletAuthority.request({ origin, method: "wallet_getPermissions" })));
handleWalletIPC("wallet:walletconnect-status", () => safeIPC(() => walletConnect.status()));
handleWalletIPC("wallet:walletconnect-sessions", () => safeIPC(() => walletConnect.sessions()));
handleWalletIPC("wallet:walletconnect-pair", (_event, uri) => safeIPC(() => walletConnect.pair(uri)));
handleWalletIPC("wallet:walletconnect-cancel-pair", () => safeIPC(() => walletConnect.cancelPair()));
handleWalletIPC("wallet:walletconnect-decode-qr", (_event, input) => safeIPC(() => decodeWalletConnectQR({
  bytes: Buffer.from(input?.bytes ?? []),
  mimeType: input?.mimeType,
  createImage: bytes => nativeImage.createFromBuffer(bytes)
})));
handleWalletIPC("wallet:walletconnect-disconnect", (_event, topic) => safeIPC(async () => {
  const origin = walletConnect.sessionOrigin(topic);
  for (const entry of walletConnectInbox.pending()) if (entry.event.topic === topic) {
    walletConnectInbox.finish(entry.key);
    await terminateWalletConnectReview(entry, "WALLETCONNECT_SESSION_DISCONNECTED");
  }
  await walletAuthority.revokeOrigin(origin);
  const result = await walletConnect.disconnectSession(topic);
  mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "disconnected", topic, origin });
  return { ...result, localPermissionRevoked: true };
}));
handleWalletIPC("wallet:walletconnect-proposal-action", (_event, id, action, expectedAccount) => sensitiveIPC(async () => {
  const key = String(id);
  if (!["approve", "reject"].includes(action)) throw Object.assign(new Error("Invalid proposal action"), { code: "INVALID_PROPOSAL_ACTION" });
  if (accountChangeInProgress || !walletConnectProposalAccounts.has(key)) throw Object.assign(new Error("The proposal account changed. Connect again from the app."), { code: "ACCOUNT_CHANGED" });
  if (walletConnectProposalActions.has(key)) throw Object.assign(new Error("This proposal is already being processed"), { code: "WALLETCONNECT_PROPOSAL_ACTION_IN_PROGRESS" });
  walletConnectProposalActions.add(key);
  try {
    if (action === "reject") { await walletConnect.rejectSession(id); walletConnectProposalAccounts.delete(key); return { rejected: true }; }
    const account = await walletAuthority.accountStatus();
    if (!account.initialized) throw Object.assign(new Error("Create an account before approving the session"), { code: "ACCOUNT_NOT_CREATED" });
    if (expectedAccount !== walletConnectProposalAccounts.get(key) || expectedAccount !== account.account) throw Object.assign(new Error("The selected account changed. Review a new connection."), { code: "ACCOUNT_CHANGED" });
    const origin = walletConnect.proposalOrigin(id);
    await walletConnect.decideProposal(id,expectedAccount,keyAccess.current().assert);
    await walletAuthority.approveOrigin(origin, expectedAccount);
    try {
      const lease = keyAccess.current();
      const session = await lease.deliver(() => walletConnect.approveSession(id, expectedAccount,lease.assertEffectCurrent));
      walletConnectProposalAccounts.delete(key);
      mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "approved", topic: session.topic, origin });
      return { approved: true, topic: session.topic, origin, account: expectedAccount };
    } catch (error) {
      await walletAuthority.revokeOrigin(origin);
      throw error;
    }
  } finally { walletConnectProposalActions.delete(key); }
}));

handleWalletIPC("wallet:provider-action", (_event, id, action) => sensitiveIPC(async () => {
  const lease = keyAccess.current();
  const transport = walletConnectRequests.get(id);
  if(transport){const entry=walletConnectInbox.get(transport.entryKey);await walletConnectInbox.markDecided(entry,lease.assert);}
  let response;
  try {
    if (accountChangeInProgress) throw Object.assign(new Error("The selected account changed"), { code: 4100 });
    response = action === "approve" ? await walletAuthority.approve(id) : rejectProviderRequest(id);
  } catch (error) {
    response = { status: "error", code: Number.isInteger(error?.code) ? error.code : 4001, message: error?.message ?? "Provider request failed", ...(error?.data ? { data: error.data } : {}) };
  }
  if (transport) {
    try {
      const send = () => { walletConnectInbox.finish(transport.entryKey); return walletConnect.respond(transport.topic, transport.jsonRpcId, response); };
      await lease.deliver(send);
    }
    catch (error) {
      const entry = walletConnectInbox.finish(transport.entryKey);
      const terminalResponseDelivered = entry ? await terminateWalletConnectReview(entry, "WALLET_OPERATION_CANCELLED") : false;
      throw Object.assign(error, { data: { ...error?.data, terminalResponseDelivered } });
    } finally { walletConnectRequests.delete(id); walletAuthority.expire(id); }
  }
  return { ...response, responseDelivered: Boolean(transport) };
}, { assertCurrent: () => {
  const transport = walletConnectRequests.get(id);
  if (!transport) return;
  const entry = walletConnectInbox.get(transport.entryKey);
  walletConnectInbox.assertLive(entry);
  const current = walletConnect.authorizeRequest(entry.event, entry.account);
  if (current.origin !== entry.origin||current.sessionBinding!==entry.sessionBinding) throw Object.assign(new Error("WalletConnect session changed"), { code: 4100 });
} }));

async function handleCallback(rawValue) {
  try {
    const walletConnectActivation = parseWalletConnectActivation(rawValue);
    if (walletConnectActivation) {
      mainWindow?.show(); mainWindow?.focus();
      if (walletConnectActivation.uri) await walletConnect.pair(walletConnectActivation.uri);
      mainWindow?.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
      return;
    }
  } catch (error) {
    mainWindow?.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: safeCode(error) });
    return;
  }
  const review = await authorizationController.receive(canonicalizeWindowsYNXWalletProtocolUrl(rawValue));
  // Keep the current consent visible when another app tries to open a request.
  if (review.code === "AUTHORIZATION_REQUEST_IN_PROGRESS") {
    if (authorizationController.pending && !authorizationController.pending.loadingAccount) mainWindow?.webContents.send("wallet:authorization-request", authorizationController.pending);
    mainWindow?.show(); mainWindow?.focus();
    return;
  }
  lastCallback = {
    received: true, acceptedForReview: review.acceptedForReview, code: review.code,
    callbackEmitted: false, authorityGranted: false,
    requestingProduct: review.request?.productId ?? null,
    activation: protocolActivationFingerprint(rawValue)
  };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show(); mainWindow.focus(); mainWindow.setTitle(walletWindowTitle);
  if (review.acceptedForReview) mainWindow.webContents.send("wallet:authorization-request", review);
  else mainWindow.webContents.send("wallet:authorization-error", review);
  await recordEvidence(await rpcStatus(), mainWindow);
}

async function changeActiveAccount(change, onInvalidated) {
  if (accountChangeInProgress || walletConnectProposalActions.size) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  keyAccess.assertUnlocked();
  accountChangeInProgress = true;
  const displayBefore=onInvalidated?keyAccess.status():null;
  keyAccess.cancelOperations();
  const invalidatedAuthorizationId = authorizationController.pending?.id;
  if (authorizationController.cancel()) mainWindow?.webContents.send("wallet:authorization-error", { acceptedForReview: false, code: "ACCOUNT_CHANGED", requestId: invalidatedAuthorizationId, callbackEmitted: false, authorityGranted: false });
  accountChangeInProgress = true;
  try {
    onInvalidated?.({before:displayBefore,after:keyAccess.status()});
    nativeWallet?.clear();
    for (const entry of walletConnectInbox.pending()) { walletConnectInbox.finish(entry.key); await terminateWalletConnectReview(entry, "ACCOUNT_CHANGED"); }
    const proposals = [...walletConnectProposalAccounts.keys()];
    walletConnectProposalAccounts.clear();
    for (const id of proposals) { try { await walletConnect.rejectSession(id); } catch {} }
    for (const [id, transport] of walletConnectRequests) {
      walletAuthority.expire(id);
      mainWindow?.webContents.send("wallet:provider-request-expired", { id, code: "ACCOUNT_CHANGED" });
      try { await walletConnect.respond(transport.topic, transport.jsonRpcId, { status: "error", code: 4100, message: "The selected account changed" }); } catch {}
    }
    walletConnectRequests.clear();
    const sessions = walletConnect?.sessions?.() ?? [];
    const remoteDisconnectFailures = [];
    for (const session of sessions) {
      try { await walletConnect.disconnectSession(session.topic); } catch (error) { remoteDisconnectFailures.push({ topic: session.topic, code: safeCode(error) }); }
    }
    const status = await keyAccess.run(change);
    keyAccess.setAccount(status.account);
    mainWindow?.webContents.send("wallet:account-status-result", status);
    mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "account-switched", cancelledProposalIds: proposals, disconnectedSessions: sessions.length - remoteDisconnectFailures.length, remoteDisconnectFailures });
    if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
    return { ...status, dappPermissionsRevoked: true, disconnectedSessions: sessions.length - remoteDisconnectFailures.length, remoteDisconnectFailures };
  } finally { accountChangeInProgress = false; }
}

async function custodyChange(change) {
  if (accountChangeInProgress || walletConnectProposalActions.size) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  accountChangeInProgress = true;
  try {
    for (const entry of walletConnectInbox.pending()) { walletConnectInbox.finish(entry.key); await terminateWalletConnectReview(entry, "ACCOUNT_CHANGED"); }
    const status = await keyAccess.custody(async guard => {
      // The repository first validates the exact review, file identity and staged
      // readback. Revoke only that live commit, still before publishing new keys.
      return change(guard, () => guard.step(() => walletAuthority.permissions.revokeAll()));
    });
    keyAccess.setAccount(status.account); keyAccess.lock("account-changed");
    mainWindow?.webContents.send("wallet:account-status-result", status);
    const remoteDisconnectFailures = [];
    for (const session of walletConnect?.sessions?.() ?? []) {
      try { await walletConnect.disconnectSession(session.topic); }
      catch (error) { remoteDisconnectFailures.push({ topic: session.topic, code: safeCode(error) }); }
    }
    mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "custody-changed", remoteDisconnectFailures });
    return { ...status, remoteDisconnectFailures };
  } finally { accountChangeInProgress = false; }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!protocolReady) queueStartupProtocolUrl(url);
  else void handleCallback(url);
});

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
app.on("second-instance", (_event, argv) => {
  const url = extractYNXWalletProtocolUrl(argv);
  if (url) {
    if (!protocolReady) queueStartupProtocolUrl(url);
    else void handleCallback(url);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
});

if (singleInstanceLock) app.whenReady().then(async () => {
  if (process.platform === "win32" && !isolatedProfile) {
    const accepted = app.setAsDefaultProtocolClient("ynxwallet");
    protocolRegistration = { platform: process.platform, attempted: true, registered: accepted && app.isDefaultProtocolClient("ynxwallet") };
  }
  const userData = app.getPath("userData");
  const accountNetwork = new CanonicalAccountNetwork({ fetchImpl: net.fetch.bind(net) });
  const passwordVault = new PasswordWalletVault({ filePath: path.join(userData, "wallet-vault-v3.json"), legacyFilePaths: [path.join(userData, "wallet-vault-v2.json"), path.join(userData, "wallet-vault-v1.json")], safeStorage, authorization: keyAccess, pqSDK:Object.freeze({...pqKeySDK,...pqBackupSDK,...pqContractSDK}) });
  originalAdmissionVault=passwordVault;
  const originalIdentityStartup=initializeOriginalAuthIdentityStartup(passwordVault);
  if(!originalIdentityStartup.implementingModuleAvailable)console.warn('AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED');
  familyAccounts = createMnemonicFamilyAccounts({
    vault: passwordVault,
    getContext: async () => ({ account: (await passwordVault.status()).account, ...keyAccess.status() }),
  });
  const familyContext = async () => ({account: (await passwordVault.status()).account, ...keyAccess.status()});
  familyRecovery = new FamilyRecovery({filePath: path.join(userData, 'multichain-family-custody-v1.json'), getContext: familyContext});
  const familyOperationGate=new FamilyOperationGate();
  familyRead = new FamilyRead({networks: new FamilyNetworks({filePath: path.join(userData, 'multichain-family-networks-v1.json')}), tokens: new FamilyTokens({filePath: path.join(userData, 'multichain-family-tokens-v1.json')}), accounts: familyAccounts, getContext: familyContext, assertNetworkEditable: network => familyRecovery.assertNetworkEditable(network),gate:familyOperationGate});
  familyBitcoinTransfer = new FamilyBitcoinTransfer({networks: familyRead.networks, accounts: familyAccounts, journal: familyRecovery.journal, getContext: familyContext,withMnemonic:(action,permission)=>passwordVault.withMnemonic(action,permission),gate:familyOperationGate});
  familyTronTransfer = new FamilyTronTransfer({networks:familyRead.networks,tokens:familyRead.tokens,accounts:familyAccounts,journal:familyRecovery.journal,getContext:familyContext,withMnemonic:(action,permission)=>passwordVault.withMnemonic(action,permission),getGuard:()=>keyAccess.current(),gate:familyOperationGate});
  familyTronSubmission = new FamilyTronSubmission({networks:familyRead.networks,journal:familyRecovery.journal,getContext:familyContext,gate:familyOperationGate});
  familyBitcoinSubmission = new FamilyBitcoinSubmission({networks:familyRead.networks,journal:familyRecovery.journal,getContext:familyContext,gate:familyOperationGate});
  keyAccess.authorizer = passwordVault.authorizer();
  pqKeyPreparation = createPQKeyPreparationEntry({lifecycle:keyAccess,vault:passwordVault,sdk:Object.freeze({...pqKeySDK,...pqContractSDK}),networkId:PQ_CANONICAL_NETWORK_ID,id:randomUUID});
  pqBackupActions=createPQBackupActions({lifecycle:keyAccess,vault:passwordVault,sdk:Object.freeze({...pqKeySDK,...pqContractSDK}),networkId:PQ_CANONICAL_NETWORK_ID,files:new PQBackupFile(),
    chooseExportFile:async account=>{const selected=await keyAccess.withOwnedDialog(()=>dialog.showSaveDialog(mainWindow,{title:'Save independent encrypted PQ backup / 保存独立 PQ 加密备份',defaultPath:`ynx-pq-${account.slice(2,10)}.ynxpq`,filters:[{name:'Encrypted PQ backup (credential stored separately)',extensions:['ynxpq']}]}));return selected.canceled?null:selected.filePath??null;},
    chooseVerifyFile:async()=>{const selected=await keyAccess.withOwnedDialog(()=>dialog.showOpenDialog(mainWindow,{title:'Verify original PQ backup / 核对原 PQ 备份',properties:['openFile'],filters:[{name:'Encrypted PQ backup',extensions:['ynxpq']}]}));return selected.canceled?null:selected.filePaths?.[0]??null;},
  });
  pqRegisteredRestore=createRegisteredPQRestore({lifecycle:keyAccess,vault:passwordVault,sdk:Object.freeze({...pqKeySDK,...pqBackupSDK,...pqContractSDK}),networkId:PQ_CANONICAL_NETWORK_ID,id:randomUUID,
    acquire:acquireOriginalWalletRegisteredBinding,isOriginal:isOriginalWalletRegisteredBinding,files:new PQBackupFile(),
    chooseFile:async()=>{const selected=await keyAccess.withOwnedDialog(()=>dialog.showOpenDialog(mainWindow,{title:'Restore original registered PQ keys / 恢复已登记的原 PQ 密钥',properties:['openFile'],filters:[{name:'Original encrypted PQ backup',extensions:['ynxpq']}]}));return selected.canceled?null:selected.filePaths?.[0]??null;},
  });
  walletAuthority = new DesktopWalletAuthority({
    // The existing SDK owns the fixed normal HTTPS caller. No renderer URL,
    // fake provider, second Host or private Native-op substitute is accepted.
    sessionReturnClient:createProductWalletReturnPublisher({gatewayTimeoutMs:15000}),
    // Auth's fixed normal factory enforces pinned node/build/genesis. Its
    // undeployed or unhealthy query is a refusal, never a substitute policy.
    pqPolicySource:acquireOriginalWalletTransactionPolicy,
    pqPolicyRecognized:isOriginalWalletTransactionPolicy,
    pqSessionSource:acquireOriginalAccountPolicy,
    pqSessionRecognized:isOriginalAccountPolicyResource,
    pqNetworkId:PQ_CANONICAL_NETWORK_ID,
    vault: passwordVault,
    permissions: new FilePermissionStore(path.join(userData, "wallet-permissions-v1.json")),
    transactionSender: new CanonicalTransactionSender({ network: accountNetwork, fetchImpl: net.fetch.bind(net), pqReadOriginal:readOriginalTransaction, intentStore: new FileTransactionIntentStore({ filePath: path.join(userData, "transaction-intents-v1.json") }) })
  });
  authorizationController = new DesktopAuthorizationController({ authority: walletAuthority, openExternal: url => keyAccess.current().deliver(() => shell.openExternal(url)) });
  nativeWallet = new NativeWalletService({ vault: walletAuthority.vault, sender: walletAuthority.transactionSender, network: accountNetwork, onTransferAttempt: record => { mainWindow?.webContents.send("wallet:transfer-attempt",record); } });
  multichain=new MultichainService({config:new MultiConfigStore({filePath:path.join(userData,'multichain-config-v1.json')}),journal:new MultiJournal({filePath:path.join(userData,'multichain-transactions-v1.json')}),adapter:new EVMAdapter(),getContext:async()=>({account:(await walletAuthority.accountStatus()).account,...keyAccess.status()}),withSecret:action=>passwordVault.withSecret(action)});
  let pairConfig, pairConfigurationError = null;
  try { pairConfig = await loadPublicWalletConnectConfig({ resourcesPath: process.resourcesPath }); }
  catch { pairConfigurationError = "WALLETCONNECT_CONFIG_INVALID"; }
  walletConnect = new WalletConnectTransport({
    projectId: pairConfig?.projectId,
    storagePath: path.join(app.getPath("userData"), "walletconnect", "sdk-store"),
    configurationError: pairConfigurationError,
    metadata: { name: "YNX Wallet", description: "YNX Testnet self-custody Wallet", url: "https://wallet.ynxweb4.com", icons: ["https://www.ynxweb4.com/ynx-icon-512.png"], redirect: { native: "ynxwallet://wc" } }
  });
  const branding=configureWalletRuntimeBranding({app,Menu,nativeImage,directory});
  walletWindowTitle=branding.title;
  const window = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    title: branding.title,
    icon: branding.icon,
    backgroundColor: "#ffffff",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 20, y: 18 } } : {}),
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  installReceivingPNGDownloadOptions(window,pathToFileURL(path.join(directory,'index.html')).href);
  // Preserve non-capture permissions; video capture requires a current explicit
  // local-window permit. Microphone/display capture are never part of scanning.
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    permission === "media" ? recipientCameraPermission.allows(contents, permission, details, true) : true);
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(permission === "media" ? recipientCameraPermission.allows(contents, permission, details) : permission !== "display-capture"));
  window.on("blur", () => keyAccess.setFocused(false));
  window.on("focus", () => keyAccess.setFocused(true));
  window.on("minimize", () => keyAccess.lock("minimized"));
  window.on("close", event => originalAdmissionExit.close(event,window));
  for (const event of ["suspend", "lock-screen"]) powerMonitor.on(event, () => keyAccess.lock(event));
  const initialAccount = await safeIPC(() => walletAuthority.accountStatus());
  if (initialAccount.ok) keyAccess.setAccount(initialAccount.value.account);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== pathToFileURL(path.join(directory, "index.html")).href) event.preventDefault();
  });
  window.removeMenu();
  await window.loadFile(path.join(directory, "index.html"));
  window.setTitle(branding.title);
  window.webContents.on("page-title-updated",event=>{event.preventDefault();window.setTitle(branding.title)});
  const status = await rpcStatus();
  await recordEvidence(status, window, { launch: true });
  window.webContents.send("wallet:status-result", status);
  window.webContents.send("wallet:account-status-result", await safeIPC(() => walletAuthority.accountStatus()));
  window.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
  if (walletConnect.status().configured) {
    try {
      await walletConnect.start({
        onPairState: status => window.webContents.send("wallet:walletconnect-status-result", status),
        onSessionProposal: async proposal => {
          try { const review=await sanitizeProposal(proposal);await walletConnect.bindProposalAccount(proposal.id,review.account);window.webContents.send("wallet:walletconnect-proposal",review); }
          catch (error) { window.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: safeCode(error) }); }
        },
        onSessionRequest: event => void handleWalletConnectRequest(event),
        onSessionDelete: async event => {
          for (const entry of walletConnectInbox.pending()) if (entry.event.topic === event.topic) { walletConnectInbox.finish(entry.key); await terminateWalletConnectReview(entry, "WALLETCONNECT_SESSION_DELETED", false); }
          if (event.origin) await walletAuthority.revokeOrigin(event.origin);
          window.webContents.send("wallet:walletconnect-session-changed", { type: "deleted", topic: event.topic, origin: event.origin, localPermissionRevoked: Boolean(event.origin) });
        },
        onSessionRestore: session => window.webContents.send("wallet:walletconnect-session-changed", { type: "restored", topic: session.topic, origin: session.origin }),
        onRequestExpire: event => expireWalletConnectRequest(event.id, window, event.topic)
      });
      window.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
    } catch (error) {
      window.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: safeCode(error) });
    }
  }
  protocolReady = true;
  for (const url of startupProtocolUrls.splice(0, 16)) await handleCallback(url);
});

app.on("window-all-closed", () => originalAdmissionExit.allClosed());

async function handleWalletConnectRequest(event) {
  const { topic, id } = event ?? {};
  try {
    if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: 4100 });
    const account = keyAccess.status().account;
    const authorized = walletConnect.authorizeRequest(event, account);
    await walletConnectInbox.start(walletConnect.reviewStorage(),walletConnect.pendingRequestKeys());
    const accepted = walletConnectInbox.accept(event, authorized, account);
    await walletConnectInbox.persist();
    if (!accepted.duplicate) await drainWalletConnectInbox();
  } catch (error) {
    await walletConnect.respond(topic, id, { status: "error", code: Number.isInteger(error?.code) ? error.code : 4200, message: error?.message ?? "Provider request failed" }).catch(() => { mainWindow?.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: "WALLETCONNECT_RESPONSE_UNCONFIRMED" }); });
  }
}
async function drainWalletConnectInbox() {
  if (drainingWalletConnectInbox || accountChangeInProgress || keyAccess.status().locked || keyAccess.status().authenticating) return;
  drainingWalletConnectInbox = true;
  try { for (const entry of walletConnectInbox.pending()) {
    if (entry.stage !== "received" || keyAccess.status().locked) continue;
    try { await keyAccess.run(async lease => {
      walletConnectInbox.assertLive(entry);
      const selected = await walletAuthority.accountStatus();
      lease.assert();
      if (selected.account !== entry.account || accountChangeInProgress) throw Object.assign(new Error("The selected account changed"), { code: 4100 });
      const authorized = walletConnect.authorizeRequest(entry.event, selected.account);
      if (authorized.origin !== entry.origin||authorized.sessionBinding!==entry.sessionBinding) throw Object.assign(new Error("WalletConnect session changed"), { code: 4100 });
      const response = await walletAuthority.request({ origin: authorized.origin, method: authorized.method, params: authorized.params });
      if (response.status === "success") { await walletConnectInbox.markDecided(entry,lease.assert);await lease.deliver(() => { walletConnectInbox.finish(entry.key); return walletConnect.respond(authorized.topic, authorized.jsonRpcId, response); }); return; }
      try { walletConnectInbox.stage(entry, response.request.id); } catch (error) { walletAuthority.expire(response.request.id); throw error; }
      walletConnectRequests.set(response.request.id, { topic: authorized.topic, jsonRpcId: authorized.jsonRpcId, entryKey: entry.key });
      mainWindow?.webContents.send("wallet:provider-request", response.request);
    }, { assertCurrent: () => walletConnectInbox.assertLive(entry) }); }
    catch (error) {
      if (!walletConnectInbox.get(entry.key) || entry.stage === "review") continue;
      if (["WALLET_LOCKED", "WALLET_OPERATION_BUSY", "WALLET_OPERATION_CANCELLED"].includes(safeCode(error))) continue;
      walletConnectInbox.finish(entry.key); await terminateWalletConnectReview(entry, safeCode(error));
    }
  } } finally { drainingWalletConnectInbox = false; }
}
async function terminateWalletConnectReview(entry, code, respond = true) {
  try{await walletConnectInbox.persist();}catch{mainWindow?.webContents.send("wallet:walletconnect-status-result",{...walletConnect.status(),code:"WALLETCONNECT_REVIEW_WRITE_UNCONFIRMED"});return false;}
  if (entry.requestId) { walletConnectRequests.delete(entry.requestId); walletAuthority?.expire(entry.requestId); mainWindow?.webContents.send("wallet:provider-request-expired", { id: entry.requestId, code }); }
  if (!respond) return false;
  try { await walletConnect.respond(entry.event.topic, entry.event.id, { status: "error", code: 4100, message: "Wallet request ended before approval. Check the app and any existing submission before requesting again." }); return true; }
  catch { mainWindow?.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: "WALLETCONNECT_RESPONSE_UNCONFIRMED" }); return false; }
}
function expireWalletConnectRequest(jsonRpcId, window = mainWindow, topic) {
  const matches = walletConnectInbox.pending().filter(entry => String(entry.event.id) === String(jsonRpcId) && (!topic || entry.event.topic === topic));
  if (!topic && matches.length > 1) return Object.freeze({ jsonRpcId: String(jsonRpcId), expiredRequestIds: Object.freeze([]) });
  for (const entry of matches) { walletConnectInbox.finish(entry.key); void terminateWalletConnectReview(entry, "WALLETCONNECT_REQUEST_EXPIRED"); }
  const expired = matches.map(entry => entry.requestId).filter(Boolean);
  return Object.freeze({ jsonRpcId: String(jsonRpcId), expiredRequestIds: Object.freeze(expired) });
}
async function sanitizeProposal(proposal) {
  if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: "ACCOUNT_CHANGED" });
  const metadata = proposal?.params?.proposer?.metadata ?? {};
  const namespace = walletConnect.proposalPermissions(proposal.id);
  const selected = await walletAuthority.accountStatus();
  if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: "ACCOUNT_CHANGED" });
  const permissions = { chains: boundedArray(namespace.chains), methods: boundedArray(namespace.methods), events: boundedArray(namespace.events) };
  walletConnectProposalAccounts.set(String(proposal.id), selected.account);
  return { verification:proposal.verifyContext?.verified?.validation??"UNKNOWN",id: String(proposal.id), account: selected.account, name: boundedText(metadata.name, "Unknown DApp"), url: boundedText(metadata.url, null), expiresAt: new Date(walletConnect.proposalReviewDeadline(proposal.id)).toISOString(), requested: permissions, permissions, methods: permissions.methods };
}
function rejectProviderRequest(id) { walletAuthority.reject(id); }
function protocolActivationFingerprint(value) {
  const text = typeof value === "string" ? value : "";
  let route = { scheme: null, host: null, pathname: null, queryKeys: [], hasHash: false };
  try { const url = new URL(text); route = { scheme: url.protocol, host: url.hostname, pathname: url.pathname, queryKeys: [...url.searchParams.keys()], hasHash: Boolean(url.hash) }; } catch {}
  return Object.freeze({ bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"), ...route });
}
async function safeIPC(action, displayOptions) {
  try { return { ok: true, value: await action() }; }
  catch (error) {
    const storageStage = error?.data?.storageStage;
    // Only the existing preparation route opts in. Require the exact native
    // refusal shape, not merely matching display text or a projected code.
    // RPC responses carry extra provenance data and cannot acquire this tag.
    const localRefusal = displayOptions?.localTransferPreparation === true &&
      error?.data?.code === "INSUFFICIENT_FUNDS" &&
      Object.keys(error.data).length === 1 &&
      !("rpcResponse" in error.data) && !("transactionHash" in error.data) && !("outcomeUnknown" in error.data) &&
      !error.outcomeUnknown && error.transactionHash == null &&
      ((error.code === -32000 && [
        "Insufficient YNXT for this amount. Add Testnet funds before sending.",
        "Insufficient YNXT to cover the amount and network fee"
      ].includes(error.message)) ||
       (error.code === 4900 && error.message === "Insufficient YNXT to cover this transaction and its maximum network fee"));
    return { ok: false, error: {
      code: safeCode(error), message: error?.message ?? "Wallet request failed",
      ...(typeof storageStage === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(storageStage) ? { storageStage } : {}),
      ...(error?.data?.outcomeUnknown ? { outcomeUnknown: true, transactionHash: error.data.transactionHash ?? null } : {}),
      ...(localRefusal ? { displayOrigin: "LOCAL_TRANSFER_PREPARATION" } : {})
    } };
  }
}
function safeCode(error) { return error?.data?.code ?? error?.code ?? "WALLET_REQUEST_FAILED"; }
function safeErrorClass(error) { return typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "Error"; }
function safeFailureCategory(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/decrypt|ciphertext|safeStorage/i.test(message)) return "OS_SECRET_DECRYPT_FAILED";
  if (/expir|issued.*time|time.*window/i.test(message)) return "AUTHORIZATION_TIME_INVALID";
  if (/secret|private key|signing key/i.test(message)) return "WALLET_SECRET_INVALID";
  return "SIGNING_RUNTIME_ERROR";
}
function boundedText(value, fallback) { return typeof value === "string" && value.length <= 512 ? value : fallback; }
function boundedArray(value) { return Array.isArray(value) && value.length <= 64 ? value.filter(item => typeof item === "string" && item.length <= 128) : []; }

