import { createContext, useContext, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { getRandomBytesAsync } from "expo-crypto";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";
import { StatusBar } from "expo-status-bar";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ArrowUpRight, Check, ChevronDown, Copy, Fingerprint, History, KeyRound, Languages, Lock, Plus, QrCode, ShieldCheck, Sparkles, Trash2, X } from "lucide-react-native";
import QRCodeView from "react-native-qrcode-svg";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  evmAddressFromYNX, walletIdentity, ynxAddressFromEVM,
} from "@ynx-chain/wallet-auth";
import { GatewaySecurityReviewProvider, SecurityReviewController, type ReviewSnapshot } from "./src/ai/securityReview";
import { NativeChainClient, loadNativeChainState, isNativeReadCancelled, nativeChainClientForStoredOrigin, type NativeChainState } from "./src/chain/nativeTransfer";
import { walletDashboardCopy } from "./src/i18n/dashboardCopy";
import { walletAppFlowCopy } from "./src/i18n/appFlowCopy";
import { networkRecoveryCopy } from "./src/i18n/networkRecoveryCopy";
import { NativeTransferOutbox, type NativeTransferOutboxEntry, type NativeTransferHistoryRecord } from "./src/chain/nativeTransferOutbox";
import { WalletPayInvoiceClient, type WalletPayInvoice } from "./src/chain/walletPayInvoice";
import { WalletScanner } from "./src/state/WalletScanner";
import { WalletScanSession } from "./src/state/walletScanSession";
import type { WalletScanResult } from "./src/state/walletScan";
import { WalletConnectButton, walletConnectRuntime } from "./src/walletConnect/WalletConnectModal";
import { offerWalletConnectDeepLink } from "./src/walletConnect/inbox";
import { WalletPayFlow, type WalletPayReceipt } from "./src/state/walletPayFlow";
import type { WalletPayReview } from "./src/state/walletPayReview";
import { ModalActionGate } from "./src/state/modalActionGate";
import { WalletSignedPayFlow, type SignedPayRecovery } from "./src/state/walletSignedPayFlow";
import type { WalletSignedPayIntegration } from "./src/state/walletSignedPayIntegration";
import type { WalletSignedPayReceipt } from "./src/state/walletSignedPaySettlement";
import { verifyWalletPayQuote } from "./src/chain/walletPayQuote";
import { assertSignedPaySessionBinding, assertSignedPayExpectedPayer, type WalletPayAuthorityLease } from "./src/security/prepareSignedPayTransfer";
import { canonicalJSON, parseProductSession, type ProductSessionV2 } from "@ynx-chain/wallet-auth";
import { createPaymentURI, PaymentRequestError } from "./src/chain/paymentRequest";
import { PaymentRecipientInput, type PaymentRecipientInputAttempt } from "./src/state/paymentRecipientInput";
import { FaucetFlow, faucetStatusCopy, productionFaucetConfiguration, type FaucetAction } from "./src/state/faucetFlow";
import { faucetRecoveryCopy } from "./src/i18n/faucetRecoveryCopy";
import { EvmSimulationClient, type EvmSimulationResult } from "./src/chain/evmSimulation";
import { NativeContractClient, NativeContractError, bftNativeReadMethods, type NativeContractArtifact, type NativeContractRead, type BFTNativeContract, type BFTNativeContractRead } from "./src/chain/nativeContract";
import { buildWalletControlView, type CapitalReview } from "./src/control/controlSurface";
import { controlCopy } from "./src/control/controlCopy";
import { formatDateTime, formatYNXT, isRTL, loadLocale, localizeError, localizeProductSessionError, saveLocale, SUPPORTED_LOCALES, translate, walletAccessibilitySummary, walletCopy, walletDetailError, type WalletLocale } from "./src/i18n/i18n";
import { AuthorizationAuditStore, type AuthorizationAuditRecord } from "./src/protocol/authorizationAudit";
import { ProductSessionController, type ProductSessionReview, type MobileProductSessionRequest } from "./src/protocol/productSessionController";
import { ApplicationActionController, type ApplicationActionReview } from "./src/protocol/applicationActionController";
import { CardApplicationApprovalController, type CardApplicationApprovalReview } from "./src/protocol/cardApplicationApprovalController";
import { FinanceOrderApprovalController, type FinanceOrderApprovalReview } from "./src/protocol/financeOrderApprovalController";
import { scopeExplanation } from "./src/i18n/scopeCopy";
import { finiteServiceReview } from "./src/i18n/finiteServiceCopy";
import { authorizationCopy } from "./src/i18n/authorizationCopy";
import { applicationActionCopy } from "./src/i18n/applicationActionCopy";
import { cardApprovalCopy, cardApprovalLimitYNXT } from "./src/i18n/cardApprovalCopy";
import { financeOrderApprovalCopy } from "./src/i18n/financeOrderApprovalCopy";
import { WalletSessionInventoryClient, WalletSessionRevocationUnknown, type SessionInventoryItem, type WalletSessionInventory } from "./src/protocol/sessionInventory";
import { BiometricProtectionRequired, prepareProtectedWallet, type BiometricProtectionReason } from "./src/security/biometricProtection";
import { setupCopy } from "./src/i18n/setupCopy";
import { assertStrongBiometrics, authorizeLocalKeyUse } from "./src/security/localAuthorization";
import { createProductSessionKeyAccess } from "./src/security/productSessionKeyAccess";
import { prepareNativeTransfer } from "./src/security/prepareNativeTransfer";
import { CorruptWalletResetController } from "./src/security/corruptWalletReset";
import { RECOVERY_DISPLAY_MS, WalletOperationLifecycle, type WalletOperationLease } from "./src/security/operationLifecycle";
import { copyPublicValueWithExpiry } from "./src/security/clipboardPrivacy";
import { initialLockState, reduceLockState } from "./src/state/lockState";
import { needsOfflineKeyRecovery, reviewRecoveryKey } from "./src/state/recoveryReview";
import { assertSecureStorageAvailable, platformSecureStorage, platformStorageHealth } from "./src/storage/secureStorage";
import { type WalletAccount, type WalletManifest, WalletRepository } from "./src/storage/walletRepository";
import { COLORS, HIGH_CONTRAST_LIGHT } from "./src/theme";
import { UI_SIZES, appearanceCopy, loadUISize, saveUISize, textSizeScale, type UISize } from "./src/theme/appearance";

let ACTIVE_COLORS=COLORS;
let styles=createStyles();
let MODAL_ANIMATION:"none"|"slide"="slide";
let ACCESSIBILITY_SUMMARY="System contrast · standard motion · Klein blue and white appearance";

const WalletOperationsContext=createContext<WalletOperationLifecycle|null>(null);
const WalletLocaleContext=createContext<WalletLocale>("en");
const WalletRecoveryContext=createContext<()=>void>(()=>{});
const WalletSignedPayIntegrationContext=createContext<WalletSignedPayIntegration|null>(null);
const EMPTY_WALLET_ACCOUNTS:readonly WalletAccount[]=[];
function useWalletOperations(){const value=useContext(WalletOperationsContext);if(!value)throw new Error("Wallet operation lifecycle is unavailable");return value}
function useOperationScope(visible=true,account?:string){const operations=useWalletOperations(),scope=useMemo(()=>operations.scope(),[operations]);useEffect(()=>operations.subscribe(()=>scope.cancel()),[operations,scope]);useEffect(()=>{if(!visible)scope.cancel();return()=>scope.cancel()},[scope,visible,account]);return scope}
function useModalActionGate(account:string){const gate=useMemo(()=>new ModalActionGate(),[account]);useEffect(()=>{gate.open();return()=>gate.close()},[gate]);return gate}
const repository=new WalletRepository(platformSecureStorage);
const nativeOutbox=new NativeTransferOutbox(platformSecureStorage);
const walletPayFlow=new WalletPayFlow(platformSecureStorage,nativeOutbox,new WalletPayInvoiceClient());
const walletSignedPayFlow=new WalletSignedPayFlow(platformSecureStorage,nativeOutbox,walletPayFlow);
const authorizationAudit=new AuthorizationAuditStore(platformSecureStorage);
function chainClient(){const runtime=(globalThis as any).__YNX_WALLET_CHAIN_RUNTIME__ as {baseURL?:string;evmRpcURL?:string}|undefined;return new NativeChainClient(runtime?.baseURL)}
function storedChainClient(origin:string){const runtime=(globalThis as any).__YNX_WALLET_CHAIN_RUNTIME__ as {baseURL?:string;evmRpcURL?:string}|undefined;return nativeChainClientForStoredOrigin(origin,runtime?.baseURL)}
function evmSimulationClient(){const runtime=(globalThis as any).__YNX_WALLET_CHAIN_RUNTIME__ as {baseURL?:string;evmRpcURL?:string}|undefined;return new EvmSimulationClient(runtime?.evmRpcURL??runtime?.baseURL)}
function walletSessionInventoryClient(){return new WalletSessionInventoryClient({fetch:(input,init)=>fetch(input,init),randomBytes:getRandomBytesAsync,authorize:authorizeLocalKeyUse,accountSecret:(account,assertCurrent)=>repository.accountSecret(account,assertCurrent,{allowLegacyMigration:true})})}

export default function App(){return <WalletRoot payIntegration={null}/>}
/** Protected issuer composition only. Native/Expo launch props, QR and globals
 * cannot inject policy or service functions. A supplies this factory's input
 * only after its real registered canonical adapter is ready. */
export function createProtectedPayWalletApp(integration:WalletSignedPayIntegration){
  const captured=Object.freeze({...integration});
  return function ProtectedPayWalletApp(){return <WalletRoot payIntegration={captured}/>};
}
function WalletRoot({payIntegration}:{payIntegration:WalletSignedPayIntegration|null}){
  return <WalletSignedPayIntegrationContext.Provider value={payIntegration}><SafeAreaProvider><WalletApp/></SafeAreaProvider></WalletSignedPayIntegrationContext.Provider>;
}

function WalletApp(){
  const [reducedMotion,setReducedMotion]=useState(false);
  const [highContrast,setHighContrast]=useState(false);
  ACTIVE_COLORS=highContrast?HIGH_CONTRAST_LIGHT:COLORS;
  const [uiSize,setUISize]=useState<UISize>("standard");
  const [appearanceBusy,setAppearanceBusy]=useState(false);
  const appearanceWrite=useRef(false),appearanceRevision=useRef(0);
  styles=createStyles(textSizeScale(uiSize));
  useEffect(()=>{let current=true;const revision=appearanceRevision.current;void loadUISize(platformSecureStorage).then(size=>{if(current&&revision===appearanceRevision.current&&!platformStorageHealth.requiresRestart)setUISize(size)}).catch(()=>{});return()=>{current=false}},[]);
  const selectUISize=async(next:UISize)=>{if(appearanceWrite.current||platformStorageHealth.requiresRestart)return;appearanceWrite.current=true;appearanceRevision.current++;setAppearanceBusy(true);try{await saveUISize(platformSecureStorage,next);if(!platformStorageHealth.requiresRestart)setUISize(next)}catch(caught){if(!platformStorageHealth.requiresRestart)setError(localizeError(locale,caught))}finally{appearanceWrite.current=false;setAppearanceBusy(false)}};
  MODAL_ANIMATION=reducedMotion?"none":"slide";
  ACCESSIBILITY_SUMMARY=`${highContrast?"High":"System"} contrast · ${reducedMotion?"reduced":"standard"} motion · Klein blue and white appearance`;
  const [manifest,setManifest]=useState<WalletManifest|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [storageRestartRequired,setStorageRestartRequired]=useState(()=>platformStorageHealth.requiresRestart);
  const [notice,setNotice]=useState<string|null>(null);
  const [lockState,dispatchLock]=useReducer(reduceLockState,undefined,initialLockState);
  const [setup,setSetup]=useState<"closed"|"create"|"import"|"recover">("closed");
  const [pendingRecovery,setPendingRecovery]=useState<{secretHex:string;label:string}|null>(null);
  const [authorization,setAuthorization]=useState<ProductSessionReview|null>(null);
  const [applicationAction,setApplicationAction]=useState<ApplicationActionReview|null>(null);
  const [cardApproval,setCardApproval]=useState<CardApplicationApprovalReview|null>(null);
  const [financeOrderApproval,setFinanceOrderApproval]=useState<FinanceOrderApprovalReview|null>(null);
  const [authorizationError,setAuthorizationError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [locale,setLocale]=useState<WalletLocale>("en");
  const [settings,setSettings]=useState(false);
  const [protectionIntent,setProtectionIntent]=useState<{mode:"create"|"import"|"recover";reason:BiometricProtectionReason;error?:string}|null>(null);
  const [privacyAttempt,setPrivacyAttempt]=useState(0);
  const [privacyState,setPrivacyState]=useState<{ready:boolean;error:string|null}>({ready:false,error:null});
  const selected=useMemo(()=>manifest?.accounts.find((item)=>item.account===manifest.selectedAccountId)??null,[manifest]);
  const selectedRef=useRef<WalletAccount|null>(null);selectedRef.current=selected;
  const manifestRef=useRef(manifest);manifestRef.current=manifest;
  const operations=useMemo(()=>new WalletOperationLifecycle(),[]),rootScope=useMemo(()=>operations.scope(),[operations]);
  const corruptReset=useMemo(()=>new CorruptWalletResetController(repository,operations,()=>authorizeLocalKeyUse("wallet-reset")),[operations]);
  const loadRevision=useRef(0);
  useEffect(()=>operations.subscribe(()=>rootScope.cancel()),[operations,rootScope]);
  useEffect(()=>{const unsubscribe=operations.subscribe(()=>corruptReset.cancel());return()=>{unsubscribe();corruptReset.cancel()}},[operations,corruptReset]);
  const readyRef=useRef(false);readyRef.current=!loading&&manifest!==null&&!storageRestartRequired&&!platformStorageHealth.requiresRestart&&AppState.currentState==="active";
  const queuedLink=useRef<string|null>(null),initialLinkRead=useRef(false);
  const linkIntake=useRef(false),linkRevision=useRef(0);
  const productSessions=useMemo(()=>new ProductSessionController({platform:Platform.OS==="ios"?"ios":"android",storage:platformSecureStorage,selectedAccount:()=>selectedRef.current,withAccountSecret:createProductSessionKeyAccess({operations,repository,checkBiometrics:assertStrongBiometrics,authorizeLegacyMigration:()=>authorizeLocalKeyUse("wallet-authorization")}),openURL:(url)=>Linking.openURL(url),audit:(review,action,at)=>authorizationAudit.appendProductSession(review,{action,account:review.account.account,at:at.toISOString()})}),[operations]);
  const applicationActions=useMemo(()=>new ApplicationActionController({platform:Platform.OS==="ios"?"ios":"android",storage:platformSecureStorage,selectedAccount:()=>selectedRef.current,withAccountSecret:createProductSessionKeyAccess({operations,repository,checkBiometrics:assertStrongBiometrics,authorizeLegacyMigration:()=>authorizeLocalKeyUse("wallet-authorization")}),openURL:(url)=>Linking.openURL(url)}),[operations]);
  const cardApprovals=useMemo(()=>new CardApplicationApprovalController({platform:Platform.OS==="ios"?"ios":"android",storage:platformSecureStorage,selectedAccount:()=>selectedRef.current,withAccountSecret:createProductSessionKeyAccess({operations,repository,checkBiometrics:assertStrongBiometrics,authorizeLegacyMigration:()=>authorizeLocalKeyUse("wallet-authorization")}),openURL:(url)=>Linking.openURL(url)}),[operations]);
  const financeOrderApprovals=useMemo(()=>new FinanceOrderApprovalController({storage:platformSecureStorage,selectedAccount:()=>selectedRef.current,withAccountSecret:createProductSessionKeyAccess({operations,repository,checkBiometrics:assertStrongBiometrics,authorizeLegacyMigration:()=>authorizeLocalKeyUse("wallet-authorization")}),currentTime:(assertCurrent)=>walletSessionInventoryClient().currentTime(assertCurrent),openURL:(url)=>Linking.openURL(url)}),[operations]);
  const cancelAuthorization=useCallback(()=>{++linkRevision.current;productSessions.cancel();applicationActions.cancel();cardApprovals.cancel();financeOrderApprovals.cancel();setAuthorization(null);setApplicationAction(null);setCardApproval(null);setFinanceOrderApproval(null)},[productSessions,applicationActions,cardApprovals,financeOrderApprovals]);
  const lock=()=>{if(selected)walletConnectRuntime.pauseForLock(evmAddressFromYNX(selected.account));operations.lock();rootScope.cancel();cancelAuthorization();setPendingRecovery(null);setSetup("closed");setBusy(false);dispatchLock({type:"lock",reason:"user"})};
  useEffect(()=>{if(!selected||!lockState.locked||storageRestartRequired||platformStorageHealth.requiresRestart)return;walletConnectRuntime.pauseForLock(evmAddressFromYNX(selected.account));void walletConnectRuntime.restore().catch(()=>{});},[selected?.account,lockState.locked,storageRestartRequired]);
  const updateManifest=useCallback((next:WalletManifest,preserveUnchangedReload=false)=>{if(!preserveUnchangedReload||JSON.stringify(next)!==JSON.stringify(manifestRef.current))void walletConnectRuntime.rejectPendingForLock().catch(()=>{});operations.invalidate();operations.setAccount(next.selectedAccountId);selectedRef.current=next.accounts.find(item=>item.account===next.selectedAccountId)??null;cancelAuthorization();setManifest(next)},[operations,cancelAuthorization]);

  useEffect(()=>platformStorageHealth.subscribe(()=>{
    // Cancel scopes immediately, before React renders the restart page. Keep
    // the durable account/outbox records; an interrupted send can be unknown.
    ++loadRevision.current;readyRef.current=false;queuedLink.current=null;
    void walletConnectRuntime.rejectPendingForLock().catch(()=>{});operations.lock();rootScope.cancel();corruptReset.cancel();cancelAuthorization();
    setPendingRecovery(null);setSetup("closed");setSettings(false);setBusy(false);
    setNotice(null);setLoading(false);setStorageRestartRequired(true);
    dispatchLock({type:"lock",reason:"user"});
  }),[operations,rootScope,corruptReset,cancelAuthorization]);

  const load=useCallback(async()=>{
    if(platformStorageHealth.requiresRestart)return false;
    const revision=++loadRevision.current,generation=operations.capture();readyRef.current=false;setLoading(true);setError(null);
    try{await assertSecureStorageAvailable();if(revision!==loadRevision.current||generation!==operations.capture())return false;const [result,savedLocale]=await Promise.all([repository.load(),loadLocale(platformSecureStorage)]);if(revision!==loadRevision.current||generation!==operations.capture()||platformStorageHealth.requiresRestart)return false;setLocale(savedLocale);updateManifest(result.manifest,JSON.stringify(result.manifest)===JSON.stringify(manifestRef.current));return true;}
    catch(caught){if(revision===loadRevision.current&&generation===operations.capture())setError(localizeError(locale,caught));}
    finally{if(revision===loadRevision.current)setLoading(false)}
    return false;
  },[locale,updateManifest,operations]);

  const loadHandler=useRef(load);loadHandler.current=load;
  const handleLink=useCallback((url:string)=>{
    if(platformStorageHealth.requiresRestart)return;
    if(!readyRef.current||AppState.currentState!=="active"){queuedLink.current=url;return}
    if(linkIntake.current||productSessions.current||applicationActions.current||cardApprovals.current||financeOrderApprovals.current){setAuthorizationError(localizeError(locale,new Error("Finish or reject the current Wallet request before opening another")));return}
    let actionRoute=false,cardRoute=false,financeRoute=false,walletConnectRoute=false;
    try{const target=new URL(url);actionRoute=target.protocol==="ynxwallet:"&&target.hostname==="application-action";cardRoute=target.protocol==="ynxwallet:"&&target.hostname==="card-application-approval";financeRoute=target.protocol==="ynxwallet:"&&target.hostname==="finance-order-approval";walletConnectRoute=target.protocol==="ynxwallet:"&&target.hostname==="wc"}catch{}
    if(walletConnectRoute){offerWalletConnectDeepLink(url);return}
    const revision=++linkRevision.current;linkIntake.current=true;
    const pending=financeRoute?financeOrderApprovals.receive(url).then(review=>{if(revision===linkRevision.current&&financeOrderApprovals.current?.id===review.id){setFinanceOrderApproval(review);setAuthorizationError(null)}}):cardRoute?cardApprovals.receive(url).then(review=>{if(revision===linkRevision.current&&cardApprovals.current?.id===review.id){setCardApproval(review);setAuthorizationError(null)}}):actionRoute?applicationActions.receive(url).then(review=>{if(revision===linkRevision.current&&applicationActions.current?.id===review.id){setApplicationAction(review);setAuthorizationError(null)}}):productSessions.receive(url).then(review=>{if(revision===linkRevision.current&&productSessions.current?.id===review.id){setAuthorization(review);setAuthorizationError(null)}});
    void pending.catch(caught=>{if(revision===linkRevision.current)setAuthorizationError(localizeError(locale,caught))}).finally(()=>{linkIntake.current=false});
  },[locale,productSessions,applicationActions,cardApprovals,financeOrderApprovals]);

  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!initialLinkRead.current){initialLinkRead.current=true;void Linking.getInitialURL().then((url)=>{if(url)handleLink(url)})}const sub=Linking.addEventListener("url",({url})=>handleLink(url));return()=>sub.remove()},[handleLink]);
  useEffect(()=>{if(!storageRestartRequired&&!loading&&manifest&&queuedLink.current){const url=queuedLink.current;queuedLink.current=null;handleLink(url)}},[storageRestartRequired,loading,manifest,handleLink]);
  useEffect(()=>{operations.setAppState(AppState.currentState);let reloadOnActive=AppState.currentState==="background";const sub=AppState.addEventListener("change",(next)=>{operations.setAppState(next);if(next==="background"){if(selectedRef.current)walletConnectRuntime.pauseForLock(evmAddressFromYNX(selectedRef.current.account));reloadOnActive=true;rootScope.cancel();dispatchLock({type:"lock",reason:"background"});cancelAuthorization();setPendingRecovery(null);setSetup("closed");setBusy(false)}else if(next==="active"&&reloadOnActive){reloadOnActive=false;void loadHandler.current();void walletConnectRuntime.restore().catch(()=>{})}});return()=>{if(selectedRef.current)walletConnectRuntime.pauseForLock(evmAddressFromYNX(selectedRef.current.account));operations.lock();rootScope.cancel();sub.remove()}},[cancelAuthorization,operations,rootScope]);
  useEffect(()=>{if(!pendingRecovery)return;const timer=setTimeout(()=>{rootScope.cancel();operations.invalidate();setPendingRecovery(null);setSetup("closed");setBusy(false);setNotice("Recovery display expired. Generate a new account if it was not saved.")},RECOVERY_DISPLAY_MS);return()=>clearTimeout(timer)},[pendingRecovery,operations,rootScope]);
  useEffect(()=>{void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);void AccessibilityInfo.isHighTextContrastEnabled().then(setHighContrast);const sub=AccessibilityInfo.addEventListener("reduceMotionChanged",setReducedMotion);return()=>sub.remove()},[]);
  useEffect(()=>{let active=true;setPrivacyState({ready:false,error:null});void preventScreenCaptureAsync("wallet-runtime").then(()=>{if(active)setPrivacyState({ready:true,error:null})}).catch((caught)=>{if(active){operations.lock();dispatchLock({type:"lock",reason:"user"});setPrivacyState({ready:false,error:`Wallet privacy protection failed: ${message(caught)}`})}});return()=>{active=false;void allowScreenCaptureAsync("wallet-runtime")}},[privacyAttempt,operations]);

  const unlock=async()=>{
    if(!selected)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);
    try{lease=rootScope.begin({account:selected.account,requireUnlocked:false});await lease.step(()=>authorizeLocalKeyUse("unlock"));operations.unlock(lease);dispatchLock({type:"unlock",account:selected.account});}
    catch(caught){if(!lease||lease.ownsScope())setError(localizeError(locale,caught))}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}
  };
  const beginSetup=async(mode:"create"|"import"|"recover")=>{
    if(busy||AppState.currentState!=="active")return;
    let lease:WalletOperationLease|undefined,bytes:Uint8Array|undefined;setBusy(true);setError(null);
    try{
      lease=rootScope.begin({requireUnlocked:false});
      if(mode==="create"){
        bytes=await prepareProtectedWallet(()=>assertStrongBiometrics(lease!.assert),()=>getRandomBytesAsync(32),lease.assert,value=>value.fill(0));
        setPendingRecovery({secretHex:bytesToHex(bytes),label:"Account "+((manifest?.accounts.length??0)+1)});
      }else await lease.step(()=>assertStrongBiometrics(lease!.assert));
      lease.assert();setProtectionIntent(null);setSetup(mode);
    }catch(caught){if(!lease||lease.ownsScope()){
      if(caught instanceof BiometricProtectionRequired)setProtectionIntent({mode,reason:caught.reason});
      else setError(localizeError(locale,caught));
    }}finally{bytes?.fill(0);if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}
  };
  const create=()=>beginSetup("create");
  const openProtectionSettings=async()=>{
    if(!protectionIntent)return;
    const intent=protectionIntent;
    try{
      if(Platform.OS==="android"){
        try{await Linking.sendIntent("android.settings.BIOMETRIC_ENROLL",[{key:"android.provider.extra.BIOMETRIC_AUTHENTICATORS_ALLOWED",value:15}])}
        catch{await Linking.sendIntent("android.settings.SECURITY_SETTINGS")}
      }else await Linking.openSettings();
    }catch{setProtectionIntent(current=>current===intent?{...current,error:setupCopy(locale,"settingsUnavailable")}:current)}
  };
  const saved=(next:WalletManifest)=>{setError(null);updateManifest(next);operations.lock();setSetup("closed");setPendingRecovery(null);setBusy(false);dispatchLock({type:"lock",reason:"user"});setNotice("Account saved. Unlock with system biometrics to continue.")};
  const restoreLegacy=async()=>{let lease:WalletOperationLease|undefined;setBusy(true);setError(null);try{lease=rootScope.begin({requireUnlocked:false});await lease.step(()=>authorizeLocalKeyUse("account-import"));const result=await lease.step(()=>repository.migrateLegacyIdentity(lease!.assert));if(result.migrated)saved(result.manifest);else setNotice("No previous Wallet identity is stored on this device.")}catch(caught){if(!lease||lease.ownsScope())await recoverAfterMutation(localizeError(locale,caught))}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}};
  const recoverAfterMutation=async(text:string)=>{lock();if(await load()&&!platformStorageHealth.requiresRestart)setError(text)};
  const select=async(account:string)=>{operations.invalidate();rootScope.cancel();cancelAuthorization();let lease:WalletOperationLease|undefined;try{lease=rootScope.begin();const next=await lease.step(()=>repository.selectAccount(account));updateManifest(next);dispatchLock({type:"switch",account})}catch(caught){if(!lease||lease.ownsScope())setError(localizeError(locale,caught))}finally{lease?.finish()}};
  const reviewReset=async()=>{
    if(busy||corruptReset.active())return;const generation=operations.capture();setBusy(true);
    try{
      const review=await corruptReset.prepare();
      if(!corruptReset.isCurrent(review))return;
      const cancel=()=>{if(corruptReset.owns(review)){corruptReset.cancel(review);setBusy(false)}};
      const confirm=async()=>{
        if(!corruptReset.isCurrent(review)){if(corruptReset.owns(review)){cancel();void load()}return}
        try{await corruptReset.confirm(review)}catch(caught){if(corruptReset.owns(review))setNotice(localizeError(locale,caught))}
        finally{if(corruptReset.owns(review)){corruptReset.cancel(review);setBusy(false);void load()}}
      };
      Alert.alert("Reset local Wallet?","This deletes the unreadable Wallet you just reviewed. Continue only if every account has an offline recovery key. System authentication is required.",[{text:"Cancel",style:"cancel",onPress:cancel},{text:"Reset",style:"destructive",onPress:()=>void confirm()}],{cancelable:false});
    }catch(caught){if(generation===operations.capture()){setBusy(false);setError(localizeError(locale,caught))}}
  };

  if(!privacyState.ready)return privacyState.error?<Screen><Text style={styles.title}>Wallet privacy protection is required</Text><Text style={styles.error}>{privacyState.error}</Text><Button label="Retry screenshot protection" onPress={()=>setPrivacyAttempt((value)=>value+1)}/></Screen>:<Screen><ActivityIndicator color={ACTIVE_COLORS.blue}/><Text style={styles.muted}>Protecting Wallet screens</Text></Screen>;
  if(storageRestartRequired)return <SafeAreaView style={[styles.safe,isRTL(locale)&&styles.rtl]}><StatusBar style="dark"/><ScrollView contentContainerStyle={{flexGrow:1,paddingHorizontal:28,paddingVertical:32,alignItems:"center",justifyContent:"center"}}><View style={styles.heroIcon}><Lock color={ACTIVE_COLORS.blue} size={34}/></View><Text style={styles.title}>{walletCopy(locale,"Close and reopen Wallet")}</Text><Text accessibilityRole="alert" style={styles.centerText}>{walletCopy(locale,Platform.OS==="android"?"Wallet could not confirm a secure storage write. Open system app settings, force stop Wallet, then reopen it to check the saved account state.":"Wallet could not confirm a secure storage write. Fully close the app from recent apps, then reopen it to check the saved account state.")}</Text><Text style={styles.footnote}>{walletCopy(locale,"Do not clear app data or reinstall. Keep your offline recovery key. The last change may not have been saved.")}</Text>{Platform.OS==="android"?<Button label={walletCopy(locale,"Open system app settings")} onPress={()=>void Linking.openSettings().catch(()=>Alert.alert(walletCopy(locale,"Open system app settings"),walletCopy(locale,"Open Settings, choose Apps, then YNX Wallet and Force stop. Reopen Wallet afterward.")))}/>:null}</ScrollView></SafeAreaView>;
  if(loading)return <Screen><ActivityIndicator color={ACTIVE_COLORS.blue}/><Text style={styles.muted}>Verifying secure Wallet storage</Text></Screen>;
  if(error&&manifest===null)return <Screen><Text style={styles.title}>Wallet storage needs attention</Text><Text style={styles.error}>{error}</Text><Button label="Retry secure storage" disabled={busy} onPress={()=>void load()}/><DangerButton label="Reset unreadable local Wallet" disabled={busy} onPress={()=>void reviewReset()}/></Screen>;

  return <WalletOperationsContext.Provider value={operations}><WalletLocaleContext.Provider value={locale}><WalletRecoveryContext.Provider value={()=>{lock();setError(null);void beginSetup("recover")}}><SafeAreaView edges={["top","left","right"]} style={[styles.safe,isRTL(locale)&&styles.rtl]}>
    <StatusBar style="dark"/>
    <View style={styles.header}><Image source={require("../../assets/brand/ynx-logo.png")} style={styles.brandLogo} resizeMode="contain" accessibilityLabel="YNX"/><View style={styles.headerBrand}><Text style={styles.brand}>YNX Wallet</Text><Text style={styles.network}>YNX TESTNET · ynx_6423-1</Text></View><View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel={translate(locale,"settingsTitle")} onPress={()=>setSettings(true)} style={styles.iconButton}><Languages size={19} color={ACTIVE_COLORS.ink}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={translate(locale,"lockWallet")} onPress={lock} style={styles.iconButton}><Lock size={19} color={ACTIVE_COLORS.ink}/></Pressable></View></View>
    {error&&manifest?<><Text style={styles.error}>{error}</Text><RecoveryRequiredNotice error={error}/></>:null}
    {notice?<Pressable accessibilityLabel="Dismiss Wallet notice" onPress={()=>setNotice(null)} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><X size={16} color={ACTIVE_COLORS.blue}/></Pressable>:null}
    {authorizationError?<View style={styles.bannerError}><Text style={styles.error}>{authorizationError}</Text><Pressable accessibilityLabel="Dismiss invalid authorization" onPress={()=>setAuthorizationError(null)}><X size={17} color={ACTIVE_COLORS.danger}/></Pressable></View>:null}
    <RecoveryRequiredNotice error={authorizationError}/>
    {!manifest?.accounts.length?<EmptyWallet locale={locale} create={()=>void create()} importAccount={()=>void beginSetup("import")} recover={()=>void beginSetup("recover")} restoreLegacy={()=>void restoreLegacy()} busy={busy}/>:lockState.locked?<Locked locale={locale} account={selected!} busy={busy} unlock={()=>void unlock()} recovery={()=>void beginSetup("recover")}/>:<Dashboard key={selected!.account} locale={locale} manifest={manifest} selected={selected!} select={(account)=>void select(account)} add={()=>void beginSetup("import")} create={()=>void create()} lock={lock} onManifest={updateManifest} onMutationError={(text)=>void recoverAfterMutation(text)}/>}
    <Modal visible={protectionIntent!==null} transparent animationType={MODAL_ANIMATION} onRequestClose={()=>{rootScope.cancel();setProtectionIntent(null);setBusy(false)}}><Sheet title={setupCopy(locale,"protectTitle")} close={()=>{rootScope.cancel();setProtectionIntent(null);setBusy(false)}}>
      <InfoCard title={setupCopy(locale,protectionIntent?.reason==="hardware-unavailable"?"unsupportedTitle":"enrollTitle")} body={setupCopy(locale,protectionIntent?.reason==="hardware-unavailable"?"unsupportedBody":"enrollBody")}/>
      <Text style={styles.sheetText}>{setupCopy(locale,"preserved")}</Text>
      {protectionIntent?.error?<Text accessibilityRole="alert" style={styles.error}>{protectionIntent.error}</Text>:null}
      {protectionIntent?.reason!=="hardware-unavailable"?<SecondaryButton label={setupCopy(locale,"settings")} disabled={busy} onPress={()=>void openProtectionSettings()}/>:null}
      <Button label={setupCopy(locale,"continue")} disabled={busy} onPress={()=>{if(protectionIntent)void beginSetup(protectionIntent.mode)}}/>
      <SecondaryButton label={translate(locale,"close")} disabled={busy} onPress={()=>{rootScope.cancel();setProtectionIntent(null)}}/>
    </Sheet></Modal>
    <SetupModal mode={setup} accounts={manifest?.accounts??EMPTY_WALLET_ACCOUNTS} pending={pendingRecovery} close={()=>{setSetup("closed");setPendingRecovery(null);setBusy(false)}} saved={saved} busy={busy} setBusy={setBusy} setError={(value)=>{if(value)void recoverAfterMutation(value)}}/>
    {authorization&&manifest&&selected?<AuthorizationModal locale={locale} key={authorization.id} review={authorization} controller={productSessions} close={cancelAuthorization} onReturned={()=>setAuthorization(null)}/>:null}
    {applicationAction&&manifest&&selected?<ApplicationActionModal locale={locale} key={applicationAction.id} review={applicationAction} controller={applicationActions} close={cancelAuthorization} onReturned={()=>setApplicationAction(null)}/>:null}
    {cardApproval&&manifest&&selected?<CardApprovalModal locale={locale} key={cardApproval.id} review={cardApproval} controller={cardApprovals} close={cancelAuthorization} onReturned={()=>setCardApproval(null)}/>:null}
    {financeOrderApproval&&manifest&&selected?<FinanceOrderApprovalModal locale={locale} key={financeOrderApproval.id} review={financeOrderApproval} controller={financeOrderApprovals} close={cancelAuthorization} onReturned={()=>setFinanceOrderApproval(null)}/>:null}
    <LocaleSettings visible={settings} locale={locale} uiSize={uiSize} appearanceBusy={appearanceBusy} selectSize={next=>void selectUISize(next)} close={()=>setSettings(false)} select={(next)=>void saveLocale(platformSecureStorage,next).then(()=>{if(!platformStorageHealth.requiresRestart)setLocale(next)}).catch(caught=>{if(!platformStorageHealth.requiresRestart)setError(localizeError(locale,caught))})}/>
  </SafeAreaView></WalletRecoveryContext.Provider></WalletLocaleContext.Provider></WalletOperationsContext.Provider>;
}

function EmptyWallet({locale,create,importAccount,recover,restoreLegacy,busy}:{locale:WalletLocale;create:()=>void;importAccount:()=>void;recover:()=>void;restoreLegacy:()=>void;busy:boolean}){return <Screen><View style={styles.heroIcon}><KeyRound color={ACTIVE_COLORS.blue} size={34}/></View><Text style={styles.eyebrow}>{translate(locale,"welcome")}</Text><Text style={styles.title}>{translate(locale,"ownAccount")}</Text><Text style={styles.centerText}>{translate(locale,"privacy")}</Text><Button label={translate(locale,"createWallet")} onPress={create}/><SecondaryButton label={translate(locale,"importWallet")} onPress={importAccount}/><SecondaryButton label={translate(locale,"recoverReplacement")} onPress={recover}/><InfoCard title={translate(locale,"beforeBegin")} body={setupCopy(locale,"previousFailure")}/><SecondaryButton label={setupCopy(locale,"restorePrevious")} disabled={busy} onPress={restoreLegacy}/></Screen>}

function Locked({locale,account,busy,unlock,recovery}:{locale:WalletLocale;account:WalletAccount;busy:boolean;unlock:()=>void;recovery:()=>void}){return <Screen><View style={styles.heroIcon}><Lock color={ACTIVE_COLORS.blue} size={32}/></View><Text style={styles.eyebrow}>{translate(locale,"walletLocked")}</Text><Text style={styles.title}>{account.label}</Text><Text style={styles.address}>{short(account.account)}</Text><Button label={busy?translate(locale,"checkingBiometrics"):translate(locale,"unlock")} disabled={busy} onPress={unlock} icon={<Fingerprint color={ACTIVE_COLORS.white} size={19}/>}/><SecondaryButton label={translate(locale,"lostDeviceRecovery")} onPress={recovery}/><Text style={styles.footnote}>{translate(locale,"recovery")}</Text></Screen>}

function Dashboard({locale,manifest,selected,select,add,create,lock,onManifest,onMutationError}:{locale:WalletLocale;manifest:WalletManifest;selected:WalletAccount;select:(v:string)=>void;add:()=>void;create:()=>void;lock:()=>void;onManifest:(v:WalletManifest)=>void;onMutationError:(text:string)=>void}){
  const operations=useWalletOperations(),scanSession=useMemo(()=>new WalletScanSession(operations),[operations]);
  const publicCopyScope=useOperationScope(true,selected.account),publicCopyBusy=useRef(false),publicCopyNotice=useRef(0);
  const [copyError,setCopyError]=useState<string|null>(null);
  const walletConnectKeyAccess=useMemo(()=>createProductSessionKeyAccess({operations,repository,checkBiometrics:assertStrongBiometrics,authorizeLegacyMigration:()=>authorizeLocalKeyUse("wallet-authorization")}),[operations]);
  const [scanning,setScanning]=useState(false),[scanRecipient,setScanRecipient]=useState(""),[invoiceID,setInvoiceID]=useState<string|null>(null);
  const closeScan=()=>{scanSession.cancel();setScanning(false)};
  const openScan=()=>{scanSession.open(selected.account);setScanning(true)};
  useEffect(()=>operations.subscribe(()=>{scanSession.cancel();setScanning(false);setScanRecipient("");setInvoiceID(null);publicCopyBusy.current=false;publicCopyNotice.current++;setCopied(false);setCopyError(null)}),[operations,scanSession]);
  useEffect(()=>()=>{publicCopyNotice.current++},[]);
  const acceptScan=(result:WalletScanResult)=>{if(!scanSession.accept(result,value=>{setScanning(false);if(value.kind==="payment"){setScanRecipient(value.payment.recipient);setSend(true)}else if(value.kind==="invoice")setInvoiceID(value.invoiceID);else offerWalletConnectDeepLink(`ynxwallet://wc?uri=${encodeURIComponent(value.uri)}`)}))closeScan()};
  const [faucet,setFaucet]=useState(false);
  const [contracts,setContracts]=useState(false);
  const [payHistory,setPayHistory]=useState(false);
  const [nativeHistory,setNativeHistory]=useState(false);
  const [accountsOpen,setAccountsOpen]=useState(false),[copied,setCopied]=useState(false),[qr,setQR]=useState(false),[send,setSend]=useState(false),[evm,setEvm]=useState(false),[center,setCenter]=useState(false),[controls,setControls]=useState(false),[remove,setRemove]=useState(false),[rename,setRename]=useState(false),[recovery,setRecovery]=useState(false),[auditOpen,setAuditOpen]=useState(false),[records,setRecords]=useState<readonly AuthorizationAuditRecord[]>([]),[auditError,setAuditError]=useState<string|null>(null);
  const [chainState,setChainState]=useState<NativeChainState>({phase:"loading",activityPhase:"loading",activity:[]});
  const chainRefreshGeneration=useRef(0),chainMounted=useRef(false);
  const chainReadAbort=useRef<AbortController|null>(null);
  const refreshChain=useCallback(async()=>{
    if(!chainMounted.current||AppState.currentState!=="active")return;
    chainReadAbort.current?.abort();
    const controller=new AbortController();chainReadAbort.current=controller;
    const generation=++chainRefreshGeneration.current;
    setChainState({phase:"loading",activityPhase:"loading",activity:[]});
    try{const next=await loadNativeChainState(chainClient(),selected.account,controller.signal);if(chainMounted.current&&!controller.signal.aborted&&generation===chainRefreshGeneration.current)setChainState(next)}
    catch(caught){if(!isNativeReadCancelled(caught)&&chainMounted.current&&!controller.signal.aborted&&generation===chainRefreshGeneration.current)setChainState({phase:"failed",error:message(caught),activityPhase:"failed",activityError:message(caught),activity:[]})}
    finally{if(chainReadAbort.current===controller)chainReadAbort.current=null}
  },[selected.account]);
  useEffect(()=>{
    chainMounted.current=true;void refreshChain();
    const sub=AppState.addEventListener("change",state=>{if(state!=="active"){chainRefreshGeneration.current++;chainReadAbort.current?.abort()}else void refreshChain()});
    return()=>{chainMounted.current=false;chainRefreshGeneration.current++;chainReadAbort.current?.abort();sub.remove()};
  },[refreshChain]);
  const copy=async()=>{if(publicCopyBusy.current)return;publicCopyBusy.current=true;setCopyError(null);let lease:WalletOperationLease|undefined;try{lease=publicCopyScope.begin({account:selected.account});await lease.step(()=>copyPublicValueWithExpiry(Clipboard,selected.account,{guard:lease!.assert}));lease.assert();const revision=++publicCopyNotice.current;setCopied(true);setTimeout(()=>{if(publicCopyNotice.current===revision)setCopied(false)},1500)}catch{if(!lease||lease.isCurrent())setCopyError(walletDashboardCopy(locale,"clipboardUnavailable"))}finally{if(!lease||lease.ownsScope())publicCopyBusy.current=false;lease?.finish()}};
  const openAudit=async()=>{setAuditError(null);try{setRecords(await authorizationAudit.load());setAuditOpen(true)}catch(caught){setAuditError(localizeError(locale,caught));setAuditOpen(true)}};
  return <ScrollView contentContainerStyle={styles.dashboard}>
    {copyError?<Text accessibilityRole="alert" style={styles.error}>{copyError}</Text>:null}
    <Text style={styles.eyebrow}>{translate(locale,"nativeAccount")}</Text>
    <Pressable accessibilityLabel={walletCopy(locale,"Switch Wallet account")} accessibilityState={{expanded:accountsOpen}} onPress={()=>setAccountsOpen(!accountsOpen)} style={styles.accountPicker}><View><Text style={styles.accountLabel}>{selected.label}</Text><Text style={styles.address}>{short(selected.account)}</Text></View><ChevronDown color={ACTIVE_COLORS.ink}/></Pressable>
    {accountsOpen?<View style={styles.accountMenu}>{manifest.accounts.map((item)=><Pressable accessibilityRole="radio" accessibilityState={{checked:item.account===selected.account}} accessibilityLabel={`${translate(locale,"account")} ${item.label}`} key={item.account} onPress={()=>{select(item.account);setAccountsOpen(false)}} style={styles.accountRow}><View><Text style={styles.accountLabel}>{item.label}</Text><Text style={styles.smallAddress}>{short(item.account)}</Text></View>{item.account===selected.account?<Check color={ACTIVE_COLORS.blue}/>:null}</Pressable>)}<Pressable accessibilityLabel={translate(locale,"createAnother")} onPress={create} style={styles.accountRow}><Plus color={ACTIVE_COLORS.blue}/><Text style={styles.link}>{translate(locale,"createAnother")}</Text></Pressable><Pressable accessibilityLabel={translate(locale,"importAnother")} onPress={add} style={styles.accountRow}><KeyRound color={ACTIVE_COLORS.blue}/><Text style={styles.link}>{translate(locale,"importAnother")}</Text></Pressable></View>:null}
    <View style={styles.balanceCard}><Text style={styles.balanceLabel}>{walletCopy(locale,"Native asset · authoritative testnet")}</Text><Text style={styles.balance}>{chainState.account?formatYNXT(locale,chainState.account.balance):"— YNXT"}</Text><Text style={styles.balanceMeta}>{chainState.phase==="loading"?walletCopy(locale,"Loading balance and nonce…"):chainState.phase==="unrecorded"?`${walletCopy(locale,"This address has no on-chain account record yet. Receive testnet YNXT to get started. Balance and nonce are not available yet.")} ${walletCopy(locale,"Sending becomes available after balance and nonce are confirmed.")}`:chainState.phase==="failed"?`${walletCopy(locale,"Balance unavailable")}: ${networkRecoveryCopy(locale,chainState.error??"")}`:`${walletCopy(locale,"Nonce {nonce}",{nonce:chainState.account?chainState.account.nonce:"—"})} · ${chainState.activityPhase==="ready"?walletCopy(locale,"{count} matching transactions in the latest 25 chain transactions",{count:chainState.activity.length}):walletCopy(locale,"Activity · unavailable")}`}</Text></View>
    <SecondaryButton label={walletCopy(locale,"Refresh balance and activity")} disabled={chainState.phase==="loading"||chainState.activityPhase==="loading"} onPress={()=>void refreshChain()}/>
    <View style={styles.quickRow}><Quick icon={<ArrowUpRight color={ACTIVE_COLORS.blue}/>} label={translate(locale,"send")} onPress={()=>setSend(true)}/><Quick icon={<QrCode color={ACTIVE_COLORS.blue}/>} label={translate(locale,"receive")} onPress={()=>setQR(true)}/><Quick icon={<History color={ACTIVE_COLORS.blue}/>} label={translate(locale,"activity")} onPress={()=>setCenter(true)}/></View>
    <SecondaryButton label={walletCopy(locale,"Test YNXT")} onPress={()=>setFaucet(true)}/>
    <SecondaryButton label={walletDashboardCopy(locale,"scan")} onPress={openScan}/>
    <WalletConnectButton locale={locale} account={selected} withAccountSecret={walletConnectKeyAccess}/>
    <InfoCard title={translate(locale,"accountSafety")} body={walletCopy(locale,selected.backupConfirmed?"Offline backup confirmed. System biometrics protect unlock, authorization, recovery viewing and deletion.":"Backup is not confirmed. Do not receive assets until the recovery key is stored offline.")}/>
    <FaucetButton secondary label={walletCopy(locale,copied?"Native ynx1 address copied":"Copy native ynx1 address")} onPress={()=>void copy()}/>
    <FaucetButton secondary label={walletCopy(locale,"Rename account")} onPress={()=>setRename(true)}/>
    <FaucetButton secondary label={walletCopy(locale,"View offline recovery key")} onPress={()=>setRecovery(true)}/>
    <SecondaryButton label={walletDashboardCopy(locale,"contracts")} onPress={()=>setContracts(true)}/>
    <FaucetButton secondary label={walletCopy(locale,"0x EVM compatibility and contract simulation")} onPress={()=>setEvm(true)}/>
    <SecondaryButton label={walletCopy(locale,"Connected Apps, Sessions and Devices")} onPress={()=>setCenter(true)}/>
    <SecondaryButton label={walletCopy(locale,"Review stored transfer")} onPress={()=>setSend(true)}/>
    <SecondaryButton label={walletDashboardCopy(locale,"confirmedHistory")} onPress={()=>setNativeHistory(true)}/>
    <SecondaryButton label={walletDashboardCopy(locale,"payReceipts")} onPress={()=>setPayHistory(true)}/>
    <SecondaryButton label={controlCopy(locale,"open")} onPress={()=>setControls(true)}/>
    <SecondaryButton label={translate(locale,"lockWallet")} onPress={lock}/>
    <SecondaryButton label={translate(locale,"audit")} onPress={()=>void openAudit()}/>
    <DangerButton label={translate(locale,"removeAccountFromDevice")} onPress={()=>setRemove(true)}/>
    {qr?<NativeReceiveModal key={selected.account} account={selected} close={()=>setQR(false)}/>:null}
    <SendModal visible={send} account={selected} scannedRecipient={scanRecipient} close={()=>{setSend(false);setScanRecipient("")}} onSent={()=>void refreshChain()}/>
    {scanning?<WalletScanner locale={locale} textScale={styles.sheetText.fontSize/14} accept={acceptScan} close={closeScan}/>:null}
    {invoiceID?<WalletInvoiceReferenceModal account={selected} invoiceID={invoiceID} close={()=>setInvoiceID(null)}/>:null}
    {payHistory?<WalletPayHistoryModal key={selected.account} account={selected} close={()=>setPayHistory(false)}/>:null}
    {nativeHistory?<NativeTransferHistoryModal key={selected.account} account={selected} close={()=>setNativeHistory(false)}/>:null}
    {faucet?<FaucetModal account={selected} close={()=>{setFaucet(false);void refreshChain()}}/>:null}
    <EvmCompatibilityModal visible={evm} account={selected} close={()=>setEvm(false)}/>
    <NativeContractModal visible={contracts} account={selected} close={()=>setContracts(false)}/>
    <WalletCenter visible={center} account={selected} chainState={chainState} close={()=>setCenter(false)} openAudit={()=>void openAudit()} retry={()=>void refreshChain()}/>
    <WalletControlCenter visible={controls} locale={locale} close={()=>setControls(false)}/>
    <RecoveryExportModal visible={recovery} account={selected} close={()=>setRecovery(false)}/>
    <Modal visible={auditOpen} transparent animationType={MODAL_ANIMATION} onRequestClose={()=>setAuditOpen(false)}><Sheet title={translate(locale,"audit")} close={()=>setAuditOpen(false)}><InfoCard title="History on this device" body="These records show local approval decisions. They do not confirm whether an app session is still connected. View and revoke live sessions in Connected Apps."/>{auditError?<Text style={styles.error}>{auditError}</Text>:null}{records.length===0?<Text style={styles.sheetText}>No authorization decisions are stored on this device.</Text>:records.slice().reverse().map((record)=><View key={record.hash} style={styles.auditRow}><Text style={styles.infoTitle}>{record.action==="approval-revoked"?"Local approval record disabled":record.action} · {record.productClientId}</Text><Text style={styles.infoBody}>{formatDateTime(locale,record.at)} · {short(record.account)}{"\n"}{record.scopes.join(", ")}</Text></View>)}</Sheet></Modal>
    <DeleteModal visible={remove} account={selected} close={()=>setRemove(false)} deleted={(next)=>{setRemove(false);onManifest(next)}} failed={onMutationError}/>
    <RenameModal visible={rename} account={selected} close={()=>setRename(false)} renamed={(next)=>{setRename(false);onManifest(next)}}/>
  </ScrollView>
}

function SetupModal({mode,accounts,pending,close,saved,busy,setBusy,setError}:{mode:"closed"|"create"|"import"|"recover";accounts:readonly WalletAccount[];pending:{secretHex:string;label:string}|null;close:()=>void;saved:(v:WalletManifest)=>void;busy:boolean;setBusy:(v:boolean)=>void;setError:(v:string|null)=>void}){
  const locale=useContext(WalletLocaleContext),requestRecovery=useContext(WalletRecoveryContext);
  const operations=useWalletOperations(),scope=useOperationScope(mode!=="closed"),[confirmation,setConfirmation]=useState(""),[secret,setSecret]=useState(""),[label,setLabel]=useState(()=>walletCopy(locale,"Imported account"));
  const [restoring,setRestoring]=useState<WalletAccount|null>(null),[setupError,setSetupError]=useState<string|null>(null);
  const review=useMemo(()=>reviewRecoveryKey(secret,accounts),[secret,accounts]);
  const existing=review.kind==="existing"?review.account:restoring;
  const dismiss=()=>{scope.cancel();setSecret("");setConfirmation("");setRestoring(null);setSetupError(null);setBusy(false);close()};
  useEffect(()=>{scope.cancel();setSecret("");setConfirmation("");setRestoring(null);setSetupError(null);setLabel(walletCopy(locale,"Imported account"));setBusy(false)},[mode,scope,locale,accounts]);
  useEffect(()=>operations.subscribe(()=>{scope.cancel();setSecret("");setConfirmation("");setRestoring(null);setBusy(false)}),[operations,scope]);
  const persistCreate=async()=>{if(busy||!pending||confirmation!=="BACKED UP")return;let lease:WalletOperationLease|undefined;setBusy(true);setSetupError(null);try{lease=scope.begin({requireUnlocked:false});await lease.step(()=>assertStrongBiometrics(lease!.assert));const next=await lease.step(()=>repository.addAccount({secretHex:pending.secretHex,label:pending.label,createdAt:new Date().toISOString(),backupConfirmed:true},lease!.assert));saved(next)}catch(caught){if(!lease||lease.ownsScope()){if(caught instanceof BiometricProtectionRequired)setSetupError(setupCopy(locale,"changed"));else setError(message(caught))}}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}};
  const persistImport=async()=>{if(busy||review.kind!=="new")return;let lease:WalletOperationLease|undefined;const accountLabel=label.trim();setBusy(true);try{lease=scope.begin({requireUnlocked:false});const material=lease.holdSecret(secret.trim().toLowerCase());setSecret("");await lease.step(()=>authorizeLocalKeyUse("account-import"));const next=await lease.step(()=>repository.addAccount({secretHex:material.read(),label:accountLabel,createdAt:new Date().toISOString(),backupConfirmed:true},lease!.assert));material.clear();saved(next)}catch(caught){if(!lease||lease.ownsScope())setError(message(caught))}finally{if(!lease||lease.ownsScope()){setSecret("");setBusy(false)}lease?.finish()}};
  const persistRestore=async()=>{
    if(busy||mode!=="recover"||review.kind!=="existing")return;
    const target=review.account;let lease:WalletOperationLease|undefined;setBusy(true);setRestoring(target);
    try{lease=scope.begin({requireUnlocked:false});const material=lease.holdSecret(secret.trim().toLowerCase());setSecret("");await lease.step(()=>authorizeLocalKeyUse("account-import"));const next=await lease.step(()=>repository.restoreAccountSecret(target.account,material.read(),lease!.assert));material.clear();saved(next)}
    catch(caught){if(!lease||lease.ownsScope())setError(message(caught))}
    finally{if(!lease||lease.ownsScope()){setSecret("");setRestoring(null);setBusy(false)}lease?.finish()}
  };
  return <Modal visible={mode!=="closed"} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}>{mode==="create"&&pending?<RecoverySheet error={setupError} pending={pending} confirmation={confirmation} setConfirmation={setConfirmation} busy={busy} save={()=>void persistCreate()} close={dismiss}/>:<Sheet title={walletCopy(locale,mode==="recover"?"Recover Wallet":"Import account")} close={dismiss}><Text style={styles.sheetText}>{walletCopy(locale,mode==="recover"?"Replacement-device recovery restores only the native account. Connected Apps, sessions, device approvals and audit history must be re-created.":"Enter a 64-character YNX recovery key. Import requires system biometrics and does not restore product device sessions.")}</Text>{existing?<><ReviewRow label={translate(locale,"account")} value={`${existing.label}\n${existing.account}`}/><InfoCard title={walletCopy(locale,"This account is already stored in Wallet")} body={walletCopy(locale,mode==="recover"?"Confirm below to restore key protection for this exact existing account. Its label, account list and app sessions will not be replaced.":"Ordinary import cannot replace this account's protected key. Open account recovery and enter the offline key again to review an explicit restoration.")}/></>:<Field label={walletCopy(locale,"Account label")} value={label} onChangeText={setLabel}/>}<Field label={walletCopy(locale,"Recovery key")} value={secret} onChangeText={setSecret} secure multiline/>{mode==="recover"&&existing?<Button label={walletCopy(locale,"Restore key protection for this existing account")} disabled={busy||review.kind!=="existing"} onPress={()=>void persistRestore()}/>:existing?<SecondaryButton label={walletCopy(locale,"Open account recovery")} disabled={busy} onPress={()=>{dismiss();requestRecovery()}}/>:<Button label={walletCopy(locale,mode==="recover"?"Recover into secure storage":"Import into secure storage")} disabled={busy||review.kind!=="new"} onPress={()=>void persistImport()}/>}</Sheet>}</Modal>
}

function FaucetModal({account,close}:{account:WalletAccount;close:()=>void}){
  const locale=useContext(WalletLocaleContext),operations=useWalletOperations();
  const flow=useMemo(()=>new FaucetFlow({account:account.account,operations,storage:platformSecureStorage,
    health:platformStorageHealth,randomBytesAsync:getRandomBytesAsync,configuration:productionFaucetConfiguration()}),[account.account,operations]);
  const [,setRender]=useState(0),[details,setDetails]=useState(false);
  // Replacing a context invalidates the old owner during render, before effects.
  // Usually the Dashboard account key and synchronous operations event do this.
  const renderedFlow=useRef(flow);
  if(renderedFlow.current!==flow){renderedFlow.current.cancel();renderedFlow.current=flow}
  useEffect(()=>{
    const unsubscribe=flow.subscribe(()=>setRender(value=>value+1));
    const detach=flow.attach();
    const appState=AppState.addEventListener("change",next=>{if(next!=="active")flow.cancel();else setRender(value=>value+1)});
    if(AppState.currentState==="active")void flow.load();else flow.cancel();
    return()=>{unsubscribe();appState.remove();detach()};
  },[flow]);
  const state=flow.snapshot(),view=state.view,entry=view?.entry,status=view?faucetStatusCopy(view):null;
  const dismiss=()=>{flow.cancel();close()};
  const act=(action:FaucetAction)=>{void flow.act(action)};
  const textDirection={textAlign:isRTL(locale)?"right" as const:"left" as const,writingDirection:isRTL(locale)?"rtl" as const:"ltr" as const};
  const busyText=state.busy==="review"?"Preparing request…":state.busy==="submit"?"Sending this request…":state.busy==="check"?"Checking block receipt…":state.busy==="complete"?"Saving receipt review…":"Reading saved request…";
  const amount=entry?.amount??flow.amount();
  // These are already parser-validated controller fields. Only render complete
  // public values; neither balances nor an unbound hash can supply receipt data.
  const receipt=view?.evidence?.receipt as Readonly<Record<string,unknown>>|undefined;
  const proof=receipt?.ynxDurability as Readonly<Record<string,unknown>>|undefined;
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}>
    <Sheet title={walletCopy(locale,"Test YNXT")} close={dismiss}>
      <View style={{direction:isRTL(locale)?"rtl":"ltr",gap:14}}>
        <Text style={[styles.sheetText,textDirection]}>{walletCopy(locale,"This is a testnet request. Test YNXT has no monetary value.")}</Text>
        {!state.available?<Text accessibilityRole="alert" style={[styles.sheetText,textDirection]}>{walletCopy(locale,"Test YNXT requests are not available in this version.")}</Text>:null}
        <FaucetDetail label="Recipient account" value={account.account}/>
        <FaucetDetail label="Network" value="YNX Testnet · ynx_6423-1"/>
        <FaucetDetail label="Faucet service" value={state.route==="legacy"?"https://faucet.ynxweb4.com":"https://faucet-testnet.ynxweb4.com"}/>
        {amount!==null?<FaucetDetail label="Requested amount" value={formatYNXT(locale,amount)}/>:<Text style={[styles.muted,textDirection]}>{walletCopy(locale,"Request amount will be shown when this service becomes available.")}</Text>}
        {state.busy?<View accessibilityState={{busy:true}}><ActivityIndicator color={ACTIVE_COLORS.blue}/><Text accessibilityLiveRegion="polite" style={[styles.sheetText,textDirection]}>{walletCopy(locale,busyText)}</Text></View>:null}
        {state.phase==="paused"&&state.error!=="storage"?<Text accessibilityRole="alert" style={[styles.sheetText,textDirection]}>{faucetRecoveryCopy(locale).paused}</Text>:null}
        {state.error?<Text accessibilityRole="alert" style={[styles.error,textDirection]}>{walletCopy(locale,state.error==="unavailable"?"Test YNXT requests are not available in this version.":state.error==="read"||state.error==="storage"?"Saved request unavailable. Sending is paused.":"The request could not be checked. Keep the original request and try again manually.")}</Text>:null}
        {state.phase==="paused"&&state.error!=="storage"||state.phase==="failed"&&state.error==="read"?<FaucetButton secondary label={faucetRecoveryCopy(locale).reload} disabled={!flow.canReload()} onPress={()=>void flow.reload()}/>:null}
        {status?<View style={{gap:6}}><Text accessibilityLiveRegion="polite" style={[styles.infoTitle,textDirection]}>{walletCopy(locale,status.title)}</Text><Text style={[styles.sheetText,textDirection]}>{walletCopy(locale,status.body)}</Text></View>:null}
        {entry?<>
          <FaucetDetail label="Request ID" value={entry.requestId}/>
          <FaucetDetail label="Transaction hash" value={entry.transactionHash}/>
          {entry.acknowledgement?<>
            <FaucetDetail label="Request nonce" value={String(entry.acknowledgement.transaction.nonce)}/>
            <FaucetDetail label="Network fee" value={formatYNXT(locale,entry.acknowledgement.transaction.fee)}/>
            <FaucetButton label={walletCopy(locale,"Check block receipt")} disabled={!flow.allowed("check")} onPress={()=>act("check")}/>
            {view?.verification==="fresh-read"?<FaucetButton label={walletCopy(locale,"Confirm receipt reviewed")} disabled={!flow.allowed("complete")} onPress={()=>act("complete")}/>:null}
          </>:<FaucetButton label={walletCopy(locale,entry.phase==="prepared"&&entry.attempts===0?"Submit this request":"Review and retry original request")} disabled={!flow.allowed("submit")} onPress={()=>act("submit")}/>}
          {receipt&&proof?<>
            <Pressable accessibilityRole="button" accessibilityLabel={walletCopy(locale,"Receipt details")} accessibilityState={{expanded:details}} onPress={()=>setDetails(value=>!value)} style={styles.secondaryButton}><Text style={[styles.secondaryText,{flexShrink:1},textDirection]}>{walletCopy(locale,"Receipt details")}</Text></Pressable>
            {details?<View style={{gap:12}}>
              {view?.verification!=="fresh-read"?<Text style={[styles.sheetText,textDirection]}>{walletCopy(locale,"Saved receipt copy — check again")}</Text>:null}
              <FaucetDetail label="Block number" value={String(receipt.blockNumber)}/>
              <FaucetDetail label="Block hash" value={String(receipt.blockHash)}/>
              <FaucetDetail label="Snapshot block number" value={String(proof.checkpointBlockNumber)}/>
              <FaucetDetail label="Snapshot block hash" value={String(proof.checkpointBlockHash)}/>
              <FaucetDetail label="Snapshot integrity" value={String(proof.snapshotIntegrity)}/>
              <FaucetDetail label="RPC origin" value={String(view?.evidence?.origin)}/>
            </View>:null}
          </>:null}
        </>:<FaucetButton label={walletCopy(locale,"Review test YNXT request")} disabled={!flow.allowed("review")} onPress={()=>act("review")}/>}
        <FaucetButton secondary label={walletCopy(locale,"Close and keep request")} onPress={dismiss}/>
      </View>
    </Sheet>
  </Modal>;
}

function FaucetButton({label,onPress,disabled=false,secondary=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[secondary?styles.secondaryButton:styles.button,pressed&&styles.pressed,disabled&&styles.disabled]}>
    <Text style={[secondary?styles.secondaryText:styles.buttonText,{flexShrink:1,textAlign:"center"}]}>{label}</Text>
  </Pressable>;
}

function FaucetDetail({label,value}:{label:Parameters<typeof walletCopy>[1];value:string}){
  const locale=useContext(WalletLocaleContext);
  return <View style={{gap:5,width:"100%"}}>
    <Text style={[styles.reviewLabel,{width:"100%",textAlign:isRTL(locale)?"right":"left",writingDirection:isRTL(locale)?"rtl":"ltr"}]}>{walletCopy(locale,label)}</Text>
    <Text selectable style={[styles.reviewValue,{width:"100%",flex:0,textAlign:"left",writingDirection:"ltr"}]}>{value}</Text>
  </View>;
}

function NativeReceiveModal({account,close}:{account:WalletAccount;close:()=>void}){
  const locale=useContext(WalletLocaleContext),scope=useOperationScope(true,account.account);
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");
  const c=(en:string,_zh:string)=>walletAppFlowCopy(locale,en);
  const uri=createPaymentURI(account.account);
  const dismiss=()=>{scope.cancel();close()};
  const copy=async(link:boolean)=>{let lease:WalletOperationLease|undefined;setBusy(true);setFeedback("");try{
    lease=scope.begin({account:account.account});lease.assert();
    await copyPublicValueWithExpiry(Clipboard,link?uri:account.account,{guard:lease.assert});lease.assert();
    setFeedback(c(link?"Receiving link copied for 30 seconds.":"Address copied for 30 seconds.",link?"收款链接已复制，30 秒后自动清除。":"收款地址已复制，30 秒后自动清除。"));
  }catch{if(!lease||lease.isCurrent())setFeedback(c("Clipboard unavailable. Select and copy the address below.","暂时无法使用剪贴板，请选择并复制下方地址。"))}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}};
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={c("Receive YNXT","接收 YNXT")} close={dismiss}>
    <View style={styles.qr}><QRCodeView value={uri} size={210} color={ACTIVE_COLORS.ink} backgroundColor={ACTIVE_COLORS.white}/></View><Text selectable style={styles.fullAddress}>{account.account}</Text>
    <InfoCard title="YNX Testnet · YNXT" body={c("This code and link contain only your public receiving address, network and asset. They do not set an amount or authorize payment. A sender must enter an amount and review the transfer.","二维码和链接仅包含公开收款地址、网络及资产，不包含金额或付款授权。付款方仍须填写金额并核对转账。")}/>
    <Button label={c("Copy receiving link","复制收款链接")} disabled={busy} onPress={()=>void copy(true)}/><SecondaryButton label={c("Copy receiving address","复制收款地址")} disabled={busy} onPress={()=>void copy(false)}/>
    {feedback?<Text accessibilityRole="alert" style={styles.sheetText}>{feedback}</Text>:null}<Text style={styles.footnote}>Native network ynx_6423-1 · EVM chain ID 6423. An 0x address is shown only inside an explicit EVM compatibility view.</Text>
  </Sheet></Modal>;
}

function SendModal({visible,account,scannedRecipient="",close,onSent}:{visible:boolean;account:WalletAccount;scannedRecipient?:string;close:()=>void;onSent:()=>void}){
  const locale=useContext(WalletLocaleContext);
  const scope=useOperationScope(visible,account.account),[to,setTo]=useState(""),[amount,setAmount]=useState(""),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [stored,setStored]=useState<NativeTransferOutboxEntry|null>(null),[loaded,setLoaded]=useState(false),[reload,setReload]=useState(0);
  const operations=useWalletOperations(),recipientInput=useMemo(()=>new PaymentRecipientInput(operations),[operations]);
  const [pasting,setPasting]=useState(false),[recipientAdded,setRecipientAdded]=useState(false);
  const inputContext=useRef("");
  const onSentRef=useRef(onSent);onSentRef.current=onSent;
  const contextKey=JSON.stringify([visible,account.account,review,Boolean(stored),loaded]);
  // Invalidate an old clipboard result during a changed render, before effects.
  if(inputContext.current!==contextKey){recipientInput.cancel();inputContext.current=contextKey}
  const cancelInput=()=>{recipientInput.cancel();setPasting(false);setRecipientAdded(false)};
  const dismiss=()=>{cancelInput();scope.cancel();setBusy(false);close()};
  useEffect(()=>{recipientInput.cancel();scope.cancel();setTo("");setAmount("");setReview(false);setBusy(false);setPasting(false);setRecipientAdded(false);setError(null);setStored(null);setLoaded(false);if(!visible)return;let current=true,lease:WalletOperationLease|undefined;
    void (async()=>{try{
      lease=scope.begin({account:account.account});const activeLease=lease;setBusy(true);
      const value=await activeLease.step(()=>nativeOutbox.read(account.account));activeLease.assert();if(!current)return;
      let pending=value?.phase!=="done"?value:null;
      if(pending){
        const recovered=await activeLease.step(()=>nativeOutbox.recover(account.account,storedChainClient(pending!.origin),activeLease.assert));
        activeLease.assert();if(!current)return;pending=recovered?.phase!=="done"?recovered:null;
        if(recovered?.phase==="observed"||recovered?.phase==="accepted")onSentRef.current();
      }
      activeLease.assert();if(!current)return;setStored(pending);setLoaded(true);
      if(!pending&&scannedRecipient){activeLease.assert();setTo(scannedRecipient);setRecipientAdded(true)}
    }catch(caught){if(current&&(!lease||lease.isCurrent()))setError(message(caught))}
    finally{if(current&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}})();
    return()=>{current=false;recipientInput.cancel();lease?.finish()}
  },[visible,account.account,scope,reload,recipientInput,scannedRecipient,operations]);
  const pasteRecipient=async()=>{
    if(!visible||!loaded||stored||review||busy)return;
    let attempt:PaymentRecipientInputAttempt|undefined;
    try{attempt=recipientInput.begin(account.account);setPasting(true);setError(null);const parsed=await attempt.read(()=>Clipboard.getStringAsync());attempt.assert();setTo(parsed.recipient);setAmount("");setReview(false);setRecipientAdded(true)}
    catch(caught){if(!attempt||attempt.isCurrent())setError(walletCopy(locale,caught instanceof PaymentRequestError?(caught.code==="UNSUPPORTED_PAYMENT_NETWORK"?"This receiving link is for a different network or asset.":"Use a valid native ynx1 address or YNX Testnet receiving link."):"Clipboard could not be read. Paste the native address manually."))}
    finally{if(!attempt||attempt.ownsScope())setPasting(false);attempt?.finish()}
  };
  const changeRecipient=(value:string)=>{cancelInput();setTo(value);setReview(false);setError(null)};
  const changeAmount=(value:string)=>{cancelInput();setAmount(value);setReview(false);setError(null)};
  let valid=false;try{valid=evmAddressFromYNX(to)!==evmAddressFromYNX(account.account)&&/^\d+$/.test(amount)&&Number.isSafeInteger(Number(amount)+1)&&Number(amount)>0}catch{valid=false}
  const act=async(mode:"new"|"retry"|"done"|"check")=>{let lease:WalletOperationLease|undefined;setBusy(true);setError(null);const request=Object.freeze({account:account.account,accountPublicKey:account.accountPublicKey,to,amount:Number(amount)});
    try{lease=scope.begin({account:request.account});const activeLease=lease,client=stored&&mode!=="new"?storedChainClient(stored.origin):chainClient();let result:NativeTransferOutboxEntry;
      if(mode==="new"||mode==="done"){
        const payBinding=await activeLease.step(()=>walletPayFlow.hasRetainedPayment(request.account));
        if(payBinding)throw new Error("This account has a retained Pay payment. Complete its invoice review and receipt before starting another transfer.");
      }
      if(mode==="done"){
        if(!stored)throw new Error("Stored transfer is unavailable");
        result=await nativeOutbox.acknowledge(request.account,stored.hash,activeLease.assert);
      }else if(mode==="check"){
        if(!stored)throw new Error("Stored transfer is unavailable");
        result=await nativeOutbox.checkStatus(request.account,stored.hash,client,activeLease.assert);
      }else if(mode==="retry"){
        if(!stored)throw new Error("Stored transfer is unavailable");
        if(await activeLease.step(()=>walletPayFlow.hasSignedRetainedPayment(request.account)))throw new Error("This signed Pay payment requires its original account-session review. Checking the original transaction remains available; no replacement was signed.");
        result=await nativeOutbox.retry(request.account,stored.hash,client,activeLease.assert,()=>authorizeLocalKeyUse("transaction-retry"));
      }else{
        result=await nativeOutbox.sendNew(request.account,client,activeLease.assert,
          ()=>prepareNativeTransfer(request,activeLease,client,repository,()=>authorizeLocalKeyUse("transaction-sign")));
      }
      // The outbox records late network facts even when this screen has closed.
      // A cancelled lease only suppresses UI/callback updates, never that write.
      activeLease.assert();setStored(result.phase==="done"?null:result);if(result.phase==="observed"||result.phase==="accepted")onSent();if(mode==="done")dismiss();
    }catch(caught){if(lease?.isCurrent()||!lease){setError(message(caught));try{const value=await nativeOutbox.read(request.account);if(lease?.isCurrent()||!lease){setStored(value?.phase==="done"?null:value);setLoaded(true)}}catch{if(lease?.isCurrent()||!lease)setLoaded(false)}}}
    finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}
  };
  const problem=error?<><Text style={styles.error}>{needsOfflineKeyRecovery(error)?walletCopy(locale,"Key protection needs recovery"):networkRecoveryCopy(locale,error)}</Text><RecoveryRequiredNotice error={error}/></>:null;
  const title=stored?walletCopy(locale,stored.phase==="accepted"?"Transfer durably confirmed":"Stored transfer needs confirmation"):review?"Send Review":"Send YNXT";
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={title} close={dismiss}>{!loaded?<><Text style={styles.sheetText}>{walletCopy(locale,"Checking the stored transfer before allowing a new signature.")}</Text>{problem}<SecondaryButton label={walletCopy(locale,"Reload stored transfer")} disabled={busy} onPress={()=>setReload(value=>value+1)}/></>:stored?<>
    <ReviewRow label={translate(locale,"account")} value={stored.account}/><ReviewRow label="To" value={ynxAddressFromEVM(stored.transaction.to)}/><ReviewRow label="Amount" value={`${stored.transaction.amount} YNXT`}/><ReviewRow label="Network fee" value={`${stored.transaction.fee} YNXT`}/><ReviewRow label="Nonce" value={String(stored.transaction.nonce)}/><ReviewRow label="Transaction" value={stored.hash}/><ReviewRow label="RPC" value={stored.origin}/>
    <Text style={styles.sheetText}>{walletCopy(locale,stored.phase==="accepted"?"This mined transfer is covered by the node’s verified local snapshot checkpoint. This is not a consensus finality claim. Done acknowledges this result before another transfer can be signed.":stored.phase==="observed"||stored.replayed!==null?"The node reported this exact transfer as accepted. Durable confirmation is still unavailable. Keep this original transaction; do not create a replacement.":stored.phase==="prepared"?"The signed transfer was saved before sending. Closing Wallet preserves it. Review and authorize sending these same bytes.":"This transfer may already have reached the node. Its outcome is not durably confirmed. Closing or restarting Wallet preserves the original transaction.")}</Text>
    {stored.phase==="pending_durable"?<InfoCard title={walletCopy(locale,"Awaiting a mined block")} body={walletCopy(locale,"The node has saved the pending transfer locally. It has not confirmed mined inclusion. Keep this transaction and check again.")}/>:stored.phase==="memory_only"?<InfoCard title={walletCopy(locale,"Local durability unavailable")} body={walletCopy(locale,"This node only reports memory state. The original transfer remains unconfirmed and stored.")}/>:stored.phase==="not_found"?<InfoCard title={walletCopy(locale,"Transaction not observed by this node")} body={walletCopy(locale,"Not found does not prove rejection or allow a replacement transaction. Keep the original and check again.")}/>:stored.phase==="unsupported"?<InfoCard title={walletCopy(locale,"Durability capability unavailable")} body={walletCopy(locale,"This node does not provide the required versioned durability capability. The original transfer stays unconfirmed.")}/>:null}
    {problem}{stored.phase==="accepted"?<Button label="Done" disabled={busy} onPress={()=>void act("done")}/>:<><InfoCard title={walletCopy(locale,"Retry the original transaction")} body={walletCopy(locale,"After system biometric confirmation, Wallet resends only the stored signed request. It does not sign again or change its amount, recipient or nonce.")}/><Button label={walletCopy(locale,busy?"Waiting for the original transaction…":"Check transaction status")} disabled={busy} onPress={()=>void act("check")}/><SecondaryButton label={walletCopy(locale,"Authorize and resend original transaction")} disabled={busy} onPress={()=>void act("retry")}/></>}<SecondaryButton label={walletCopy(locale,"Close and keep transfer")} onPress={dismiss}/>
  </>:review?<><ReviewRow label="From" value={`${account.label}\n${account.account}`}/><ReviewRow label="To" value={to}/><ReviewRow label="Amount" value={`${amount} YNXT`}/><ReviewRow label="Network fee" value="1 YNXT"/><ReviewRow label="Network" value="ynx_6423-1"/><InfoCard title="Final biometric confirmation" body="Wallet will fetch the current authoritative nonce and balance, sign the exact canonical transfer, store and verify its original bytes, and POST it only to the configured YNX RPC origin."/>{problem}<SecondaryButton label="Edit transfer" disabled={busy} onPress={()=>{cancelInput();setReview(false)}}/><Button label={busy?"Signing and broadcasting…":"Sign and broadcast"} disabled={busy||!valid} onPress={()=>void act("new")}/></>:<><Text style={styles.sheetText}>{walletCopy(locale,"Copy a receiving link from a QR code, then paste it here.")}</Text>{problem}<SecondaryButton label={walletCopy(locale,pasting?"Reading clipboard…":"Paste address or receiving link")} disabled={pasting||busy} onPress={()=>void pasteRecipient()}/>{recipientAdded?<InfoCard title="YNX Testnet · YNXT" body={walletCopy(locale,"Recipient added. Enter an amount and review the transfer.")}/>:null}<Field label={walletCopy(locale,"Recipient ynx1 address")} value={to} onChangeText={changeRecipient}/><Field label={walletCopy(locale,"Whole YNXT amount")} value={amount} onChangeText={changeAmount}/><Button label={walletCopy(locale,"Review transfer")} disabled={!valid||pasting||busy} onPress={()=>{cancelInput();setReview(true)}}/></>}</Sheet></Modal>
}

function NativeTransferHistoryModal({account,close}:{account:WalletAccount;close:()=>void}){
  const locale=useContext(WalletLocaleContext),scope=useOperationScope(true,account.account);
  const gate=useModalActionGate(account.account);
  const [records,setRecords]=useState<readonly NativeTransferHistoryRecord[]>([]),[cursor,setCursor]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const c=(en:string,_zh:string)=>walletAppFlowCopy(locale,en);
  const dismiss=()=>{gate.close();scope.cancel();close()};
  const load=async(more:boolean)=>{const action=gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);try{
    lease=scope.begin({account:account.account});const page=await nativeOutbox.history(account.account,lease.assert,more?cursor:null,10);lease.assert();
    if(more&&page.records.some(item=>records.some(prior=>prior.hash===item.hash)))throw new Error("Repeated history page");
    setRecords(previous=>more?[...previous,...page.records]:page.records);setCursor(page.nextCursor);setLoaded(true);
  }catch{if(action.isCurrent()&&(!lease||lease.isCurrent()))setError(c("Saved transfers could not be verified. Existing records and the original transfer remain protected. Try again; no replacement is permitted.","暂时无法核对转账记录。已有记录和原交易仍受保护。请重试，不可签署替代交易。"))}finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}};
  useEffect(()=>{void load(false);return()=>scope.cancel()},[account.account,scope]);
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={c("Confirmed transfer history","已确认转账记录")} close={dismiss}>
    <ReviewRow label={c("Account","账户")} value={account.account}/><InfoCard title={c("Verified history saved on this device","本设备保存的已核对记录")} body={c("These original transfers were acknowledged after a verified local snapshot checkpoint. This is not consensus finality or complete chain history. Incoming transfers and older records never saved by this device are not implied. Unresolved transfers remain in Review stored transfer.","以下原交易经本地快照持久性核验后由你确认。此记录不代表共识最终确认或完整链上历史，也不包含本设备从未保存的收款及更早交易。未确认交易仍保留在原交易核对入口。")}/>
    {!loaded&&!error?<Text style={styles.sheetText}>{c("Reading saved transfer records…","正在读取已保存转账记录…")}</Text>:null}{loaded&&records.length===0?<Text style={styles.sheetText}>{c("No confirmed outgoing transfers saved for this account on this device.","本设备尚无此账户已保存的确认转出记录。")}</Text>:null}
    {records.map(record=><View key={record.hash} style={styles.auditRow}><ReviewRow label={c("Recipient","收款地址")} value={record.to}/><ReviewRow label={c("Amount / fee","金额 / 手续费")} value={`${record.amount} / ${record.fee} YNXT`}/><ReviewRow label={c("Original transaction","原交易")} value={record.hash}/><ReviewRow label={c("Nonce / block","序号 / 区块")} value={`${record.nonce} / ${record.blockNumber}`}/><ReviewRow label={c("RPC origin","RPC 来源")} value={record.origin}/><ReviewRow label={c("Checkpoint checked at","检查点核对时间")} value={formatDateTime(locale,record.verifiedAt)}/></View>)}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}<Button label={c(busy?"Reading history…":"Refresh saved transfers",busy?"正在读取记录…":"刷新已保存转账")} disabled={busy} onPress={()=>void load(false)}/>{cursor?<SecondaryButton label={c("Older transfers","更早的转账")} disabled={busy} onPress={()=>void load(true)}/>:null}
  </Sheet></Modal>;
}

function WalletPayHistoryModal({account,close}:{account:WalletAccount;close:()=>void}){
  const locale=useContext(WalletLocaleContext),scope=useOperationScope(true,account.account);
  const integration=useContext(WalletSignedPayIntegrationContext);
  const gate=useModalActionGate(account.account);
  const [receipts,setReceipts]=useState<readonly WalletPayReceipt[]>([]),[cursor,setCursor]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [recovery,setRecovery]=useState<WalletPayReview|null>(null);
  const [signedHistory,setSignedHistory]=useState(false);
  const c=(en:string,_zh:string)=>walletAppFlowCopy(locale,en);
  const dismiss=()=>{gate.close();scope.cancel();close()};
  const load=async(more:boolean)=>{const action=gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);try{lease=scope.begin({account:account.account});const retained=await walletPayFlow.recovery(account.account,lease.assert);lease.assert();setRecovery(retained);const page=await walletPayFlow.history(account.account,lease.assert,more?cursor:null,10);lease.assert();if(more&&page.receipts.some(item=>receipts.some(prior=>prior.binding.hash===item.binding.hash)))throw new Error("Repeated receipt page");setReceipts(previous=>more?[...previous,...page.receipts]:page.receipts);setCursor(page.nextCursor);setLoaded(true)}catch{if(action.isCurrent()&&(!lease||lease.isCurrent()))setError(c("Saved receipts could not be verified. Original records are kept; this does not permit paying again.","暂时无法核对已保存收据。原记录仍被保留，不代表可以重新付款。"))}finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}};
  useEffect(()=>{setRecovery(null);setReceipts([]);setCursor(null);setLoaded(false);void load(false);return()=>scope.cancel()},[account.account,scope]);
  const recover=async(mode:"check"|"done")=>{if(!recovery?.hash||!recovery.actions.includes(mode))return;const action=gate.acquire();if(!action)return;const reviewedHash=recovery.hash;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);try{lease=scope.begin({account:account.account});
    if(mode==="check")await walletPayFlow.checkOriginal(account.account,chainClient(),lease.assert);
    else await walletPayFlow.acknowledgeSettled(account.account,reviewedHash,lease.assert);
    lease.assert();const retained=await walletPayFlow.recovery(account.account,lease.assert);lease.assert();setRecovery(retained);
    const page=await walletPayFlow.history(account.account,lease.assert,null,10);lease.assert();setReceipts(page.receipts);setCursor(page.nextCursor);setLoaded(true);
  }catch{if(action.isCurrent()&&(!lease||lease.isCurrent()))setError(c("Recovery could not be verified. Keep the original payment and try again; no replacement was signed.","恢复结果暂时无法核对。请保留原付款后重试，未签署替代交易。"))}finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}};
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={c("Pay payment receipts","Pay 付款收据")} close={dismiss}>
    <ReviewRow label={c("Account","账户")} value={account.account}/><InfoCard title={c("Verified records on this device","本设备经核对的记录")} body={c("Every listed receipt binds the original signed transfer, local durability checkpoint and matching invoice settlement. A local checkpoint is not consensus finality. Records on other devices are not implied.","每张收据均绑定原签名交易、本地持久性检查点和相符的发票结算。本地检查点不代表共识最终确认，也不代表其他设备的记录。")}/>
    {recovery?<View style={styles.auditRow}><Text style={styles.infoTitle}>{c("Retained payment recovery","保留付款恢复")}</Text><ReviewRow label={c("Invoice / merchant","发票 / 商家")} value={`${recovery.invoice.id}\n${recovery.invoice.merchant}`}/><ReviewRow label={c("Recipient","收款地址")} value={recovery.invoice.payoutAddress}/><ReviewRow label={c("Amount / fee","金额 / 手续费")} value={`${recovery.invoice.amount} / 1 YNXT`}/><ReviewRow label={c("Original transaction","原交易")} value={recovery.hash!}/>
      <InfoCard title={c(recovery.state==="settled"?"Settlement verified":recovery.state==="settlement_pending"?"Settlement still required":recovery.state==="original_unavailable"?"Original journal unavailable":"Original transfer unconfirmed",recovery.state==="settled"?"结算已核对":recovery.state==="settlement_pending"?"仍需核对结算":recovery.state==="original_unavailable"?"原交易日志不可用":"原交易尚未确认")} body={c(recovery.state==="settled"?"Review this exact invoice and hash before saving its receipt. Archiving releases the retained journal only after the receipt is stored and verified.":recovery.state==="settlement_pending"?"Native durability alone is not invoice settlement. The original payment remains protected; settlement submission awaits the trusted Pay account-session integration.":"Keep this original payment. Checking reads its original hash only; it does not sign, resend, replace or settle a payment.",recovery.state==="settled"?"请核对这张发票和原交易哈希，再保存收据。仅在收据保存并核对后，归档才会释放保留日志。":recovery.state==="settlement_pending"?"原生交易持久性不等于发票结算。原付款仍受保护；结算提交等待可信 Pay 账户会话接入。":"请保留原付款。查询只读取原交易哈希，不签名、重发、替换或结算付款。")}/>
      {recovery.actions.includes("check")?<Button label={c("Check original payment","查询原付款")} disabled={busy} onPress={()=>void recover("check")}/>:null}{recovery.actions.includes("done")?<Button label={c("Save reviewed receipt and finish","保存已核对收据并完成")} disabled={busy} onPress={()=>void recover("done")}/>:null}
    </View>:null}
    {loaded&&receipts.length===0?<Text style={styles.sheetText}>{c("No saved payment receipts for this account on this device.","本设备尚无此账户的已保存付款收据。")}</Text>:null}
    {receipts.map(receipt=><View key={receipt.binding.hash} style={styles.auditRow}><Text style={styles.infoTitle}>{receipt.binding.invoice.merchant}</Text><ReviewRow label={c("Invoice","发票")} value={receipt.binding.invoice.id}/><ReviewRow label={c("Recipient","收款地址")} value={receipt.binding.invoice.payoutAddress}/><ReviewRow label={c("Amount / fee","金额 / 手续费")} value={`${receipt.binding.invoice.amount} / 1 YNXT`}/><ReviewRow label={c("Original transaction","原交易")} value={receipt.binding.hash}/><ReviewRow label={c("Settlement","结算")} value={receipt.binding.settlement!.id}/><ReviewRow label={c("Time","时间")} value={formatDateTime(locale,receipt.binding.settlement!.createdAt)}/></View>)}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}<Button label={c(busy?"Reading receipts…":loaded?"Refresh receipts":"Read saved receipts",busy?"正在读取收据…":loaded?"刷新收据":"读取已保存收据")} disabled={busy} onPress={()=>void load(false)}/>{cursor?<SecondaryButton label={c("Older receipts","更早的收据")} disabled={busy} onPress={()=>void load(true)}/>:null}
    {integration?<SecondaryButton label={c("Signed Pay receipts and recovery","签名 Pay 收据与恢复")} disabled={busy} onPress={()=>setSignedHistory(true)}/>:null}
    {signedHistory&&integration?<WalletSignedPayModal account={account} invoiceID={null} integration={integration} close={()=>setSignedHistory(false)}/>:null}
  </Sheet></Modal>;
}

function WalletInvoiceReferenceModal({account,invoiceID,close}:{account:WalletAccount;invoiceID:string;close:()=>void}){
  const integration=useContext(WalletSignedPayIntegrationContext);
  return integration?<WalletSignedPayModal account={account} invoiceID={invoiceID} integration={integration} close={close}/>:<WalletLegacyInvoiceReferenceModal account={account} invoiceID={invoiceID} close={close}/>;
}
function WalletLegacyInvoiceReferenceModal({account,invoiceID,close}:{account:WalletAccount;invoiceID:string;close:()=>void}){
  const locale=useContext(WalletLocaleContext),scope=useOperationScope(true,account.account);
  const gate=useModalActionGate(account.account);
  const [invoice,setInvoice]=useState<WalletPayInvoice|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const c=(en:string,_zh:string)=>walletAppFlowCopy(locale,en);
  const dismiss=()=>{gate.close();scope.cancel();close()};
  const load=async()=>{const action=gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);setInvoice(null);try{lease=scope.begin({account:account.account});const result=await new WalletPayInvoiceClient().invoice(invoiceID,lease.assert);lease.assert();setInvoice(result)}catch{if(action.isCurrent()&&(!lease||lease.isCurrent()))setError(c("The invoice could not be verified at the configured Pay service. Nothing was signed. Try again or cancel.","无法在指定 Pay 服务核对发票，未签署任何付款。请重试或取消。"))}finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}};
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={c("Review invoice reference","核对发票编号")} close={dismiss}>
    <ReviewRow label={c("Invoice","发票")} value={invoiceID}/><ReviewRow label={c("Selected account","当前账户")} value={account.account}/>
    <InfoCard title={c("A QR code is not payment authorization","二维码不是付款授权")} body={c("Only the invoice reference was read. QR-provided URLs, amounts and signing keys are not trusted. This view queries the configured Pay service and does not sign or transfer assets.","仅读取发票编号，不信任二维码中的服务地址、金额或签名公钥。此页面仅查询指定 Pay 服务，不签名、不转账。")}/>
    {invoice?<><ReviewRow label={c("Reported merchant","服务返回的商家")} value={invoice.merchant}/><ReviewRow label={c("Reported recipient","服务返回的收款地址")} value={invoice.payoutAddress}/><ReviewRow label={c("Reported amount","服务返回的金额")} value={`${invoice.amount} YNXT`}/><ReviewRow label={c("Expires","到期时间")} value={invoice.dueAt}/><ReviewRow label={c("Service status","服务状态")} value={invoice.status}/><InfoCard title={c("Payment verification is not complete","付款信任核验尚未完成")} body={c("This service projection is not a trusted signed merchant invoice or a payment receipt. Payment remains unavailable until the trusted merchant policy and account-bound Pay session are verified.","服务返回的信息不等于经信任策略核验的商家签名发票，也不是付款收据。商家信任策略及当前账户 Pay 会话核验完成前不可付款。")}/></>:null}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}<Button label={c(busy?"Checking invoice…":"Check at Pay service",busy?"正在核对发票…":"在 Pay 服务查询")} disabled={busy} onPress={()=>void load()}/><SecondaryButton label={c("Cancel without payment","取消，不付款")} onPress={dismiss}/>
  </Sheet></Modal>;
}

type SignedPayQuoteReview=Readonly<{verified:ReturnType<typeof verifyWalletPayQuote>;authority:WalletPayAuthorityLease;session:ProductSessionV2}>;
function WalletSignedPayModal({account,invoiceID,integration,close}:{account:WalletAccount;invoiceID:string|null;integration:WalletSignedPayIntegration;close:()=>void}){
  const locale=useContext(WalletLocaleContext),operations=useWalletOperations(),scope=useOperationScope(true,account.account),gate=useModalActionGate(account.account);
  const integrationRef=useRef(integration);integrationRef.current=integration;
  const [quote,setQuote]=useState<SignedPayQuoteReview|null>(null),[recovery,setRecovery]=useState<SignedPayRecovery|null>(null);
  const [receipts,setReceipts]=useState<readonly WalletSignedPayReceipt[]>([]),[cursor,setCursor]=useState<string|null>(null),[loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[time,setTime]=useState(Date.now());
  const c=(en:string,_zh:string)=>walletAppFlowCopy(locale,en);
  const dismiss=()=>{gate.close();scope.cancel();close()};
  const current=(lease:WalletOperationLease)=>{lease.assert();if(integrationRef.current!==integration)throw Error("PAY_PROTECTED_INTEGRATION_CHANGED")};
  const refreshSaved=async(lease:WalletOperationLease,more=false)=>{
    const guard=()=>current(lease);guard();
    const retained=await walletSignedPayFlow.recovery(account.account,integration.policy,guard);guard();
    const page=await walletSignedPayFlow.history(account.account,integration.policy,guard,more?cursor:null,10);guard();
    if(more&&page.receipts.some(item=>receipts.some(prior=>prior.record.transfer.hash===item.record.transfer.hash)))throw Error("Repeated signed receipt page");
    setRecovery(retained);setReceipts(previous=>more?[...previous,...page.receipts]:page.receipts);setCursor(page.nextCursor);setLoaded(true);
  };
  const readSaved=async(more=false)=>{
    const action=gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);
    try{lease=scope.begin({account:account.account});await refreshSaved(lease,more)}
    catch{if(action.isCurrent()&&(!lease||lease.isCurrent()))setError(c("Signed payment records could not be verified. Originals are kept; do not pay again.","暂时无法核对签名付款记录。原记录仍被保留，请勿再次付款。"))}
    finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}
  };
  const loadQuote=async()=>{
    const action=gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);setQuote(null);
    try{
      if(!invoiceID||!/^inv_[a-f0-9]{20}$/.test(invoiceID))throw Error("PAY_SIGNED_INVALID_INVOICE");
      lease=scope.begin({account:account.account});const guard=()=>current(lease!);guard();
      const retained=await walletSignedPayFlow.recovery(account.account,integration.policy,guard);guard();
      if(retained){setRecovery(retained);return}
      const legacy=await walletPayFlow.read(account.account);guard();if(legacy)throw Error("Review the retained legacy Pay receipt before another payment.");
      const raw=await integration.getQuote(invoiceID,account.account,guard);guard();
      const verified=verifyWalletPayQuote(raw.invoice,raw.intent,integration.policy,guard);
      if(verified.invoice.id!==invoiceID)throw Error("PAY_EXPLICIT_REVIEW_MISMATCH");
      const authority=raw.authority;
      if(!authority||typeof authority.assertCurrent!=="function"||typeof authority.refresh!=="function"||typeof authority.verifyInvoicePayable!=="function")throw Error("PAY_CURRENT_AUTHORITY_REQUIRED");
      const session=parseProductSession(authority.session),snapshot=canonicalJSON(session);
      assertSignedPaySessionBinding(session,verified.intent,account.account);assertSignedPayExpectedPayer(verified.invoice,account.account);
      const quoteGuard=()=>{guard();authority.assertCurrent();const at=Date.now();if(canonicalJSON(parseProductSession(authority.session))!==snapshot||at<Date.parse(session.issuedAt)||at>=Math.min(Date.parse(session.expiresAt),Date.parse(verified.intent.quoteExpiresAt)))throw Error("PAY_CURRENT_AUTHORITY_CHANGED_OR_EXPIRED")};
      quoteGuard();const fresh=await authority.refresh();quoteGuard();if(canonicalJSON(parseProductSession(fresh))!==snapshot)throw Error("PAY_CURRENT_SESSION_CHANGED");
      await authority.verifyInvoicePayable(verified.invoice,verified.intent);quoteGuard();
      setQuote(Object.freeze({verified,authority,session}));setRecovery(null);setTime(Date.now());
    }catch(caught){if(action.isCurrent()&&(!lease||lease.isCurrent()))setError(message(caught))}
    finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}
  };
  const approve=async()=>{
    if(!quote)return;const reviewed=quote,action=gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);
    try{
      lease=scope.begin({account:account.account});current(lease);reviewed.authority.assertCurrent();
      if(canonicalJSON(parseProductSession(reviewed.authority.session))!==canonicalJSON(reviewed.session))throw Error("PAY_CURRENT_SESSION_CHANGED");
      const chain=chainClient();await walletSignedPayFlow.payReviewed({rawInvoice:reviewed.verified.invoice,rawIntent:reviewed.verified.intent,reviewedIntentDigest:reviewed.verified.intentDigest,
        review:{account:account.account,accountPublicKey:account.accountPublicKey,to:reviewed.verified.intent.payoutAddress,amount:reviewed.verified.intent.amount},policy:integration.policy,authority:reviewed.authority,
        lease,chain,client:chain,repository,authorize:()=>authorizeLocalKeyUse("transaction-sign")});
      current(lease);setQuote(null);await refreshSaved(lease);
    }catch(caught){if(action.isCurrent()&&(!lease||lease.isCurrent())){setQuote(null);setError(message(caught));if(lease)try{await refreshSaved(lease)}catch{}}}
    finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}
  };
  const recover=async(mode:"check"|"read-receipt"|"settle"|"done")=>{
    if(!recovery||!recovery.actions.includes(mode))return;const reviewed=recovery,action=gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);
    try{
      lease=scope.begin({account:account.account});const guard=()=>current(lease!);guard();
      if(mode==="check")await walletSignedPayFlow.checkOriginal(account.account,integration.policy,storedChainClient(reviewed.record.origin),guard);
      else if(mode==="done")await walletSignedPayFlow.acknowledgeSettled(account.account,reviewed.record.transfer.hash,integration.policy,guard);
      else{const transport=await integration.getSettlementTransport(reviewed.record,guard);guard();
        if(mode==="settle")await walletSignedPayFlow.settleOriginal(account.account,integration.policy,guard,transport);
        else await walletSignedPayFlow.readOriginalReceipt(account.account,integration.policy,guard,transport);
      }
      guard();await refreshSaved(lease);
    }catch(caught){if(action.isCurrent()&&(!lease||lease.isCurrent()))setError(message(caught))}
    finally{const owns=action.finish();if(owns&&(!lease||lease.ownsScope()))setBusy(false);lease?.finish()}
  };
  useEffect(()=>operations.subscribe(()=>{scope.cancel();setQuote(null);setRecovery(null);setReceipts([]);setCursor(null);setLoaded(false)}),[operations,scope]);
  useEffect(()=>{const timer=setInterval(()=>setTime(Date.now()),1000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{scope.cancel();setQuote(null);setRecovery(null);setReceipts([]);setCursor(null);setLoaded(false);void readSaved();return()=>scope.cancel()},[account.account,invoiceID,integration,scope]);
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={c("Signed Pay · review and recovery","签名 Pay · 核对与恢复")} close={dismiss}>
    <ReviewRow label={c("Selected account","当前账户")} value={account.account}/>
    <InfoCard title={c("Explicit review, then protected approval","先明确核对，再受保护地批准")} body={c("QR codes provide only an invoice reference. Protected merchant policy, current account session and canonical business checks are required. Opening this view never signs, transfers or settles.","二维码仅提供发票编号。必须核对独立商家信任策略、当前账户会话和权威业务状态。打开本页不会签名、转账或结算。")}/>
    {invoiceID?<ReviewRow label={c("Requested invoice","请求的发票")} value={invoiceID}/>:null}
    {quote?<View style={styles.auditRow}><ReviewRow label={c("Merchant","商家")} value={`${quote.verified.invoice.merchantName}\n${quote.verified.invoice.merchantId}`}/><ReviewRow label={c("Invoice","发票")} value={`${quote.verified.invoice.id}\n${quote.verified.invoice.centralInvoiceId}`}/><ReviewRow label={c("Recipient","收款地址")} value={quote.verified.intent.payoutAddress}/><ReviewRow label={c("Amount / fee / total","金额 / 手续费 / 合计")} value={`${quote.verified.intent.amount} / ${quote.verified.intent.fee} / ${quote.verified.intent.total} YNXT`}/><ReviewRow label={c("Quote expires","报价到期")} value={formatDateTime(locale,quote.verified.intent.quoteExpiresAt)}/><ReviewRow label={c("Full approved session expires","完整批准会话到期")} value={formatDateTime(locale,quote.session.expiresAt)}/><ReviewRow label={c("Exact reviewed intent","已核对的精确付款意图")} value={quote.verified.intentDigest}/>
      {quote.verified.invoice.baseAmount!==undefined?<ReviewRow label={c("Base amount / tip","原金额 / 小费")} value={`${quote.verified.invoice.baseAmount} / ${quote.verified.invoice.tipAmount} YNXT`}/>:null}
      {quote.verified.invoice.splitShareId?<ReviewRow label={c("Split payment / share","分账 / 份额")} value={`${quote.verified.invoice.splitPaymentId}\n${quote.verified.invoice.splitShareId}`}/>:null}
      {quote.verified.invoice.serviceBillId?<ReviewRow label={c("Service bill / evidence","服务账单 / 证据")} value={`${quote.verified.invoice.serviceBillId}\n${quote.verified.invoice.serviceEvidenceDigest}`}/>:null}
      <InfoCard title={c("Nothing has been signed or paid","尚未签名或付款")} body={c("Approve only this displayed invoice, recipient and total. System-protected key access follows. Closing preserves any original transaction already recorded; it does not reverse a submission.","仅批准当前显示的发票、收款地址和合计金额，之后才访问系统保护的密钥。关闭会保留已记录的原交易，不会撤销已发生的提交。")}/>
      <Button label={c("Approve this exact payment","批准这笔精确付款")} disabled={busy||time>=Math.min(Date.parse(quote.session.expiresAt),Date.parse(quote.verified.intent.quoteExpiresAt))} onPress={()=>void approve()}/><SecondaryButton label={c("Discard this quote without payment","放弃此报价，不付款")} disabled={busy} onPress={()=>setQuote(null)}/>
    </View>:null}
    {recovery?<View style={styles.auditRow}><Text style={styles.infoTitle}>{c("Original payment recovery","原付款恢复")}</Text><ReviewRow label={c("Original invoice / merchant","原发票 / 商家")} value={`${recovery.record.invoice.id}\n${recovery.record.invoice.merchantName}`}/><ReviewRow label={c("Recipient / amount","收款地址 / 金额")} value={`${recovery.record.invoice.payoutAddress}\n${recovery.record.intent.amount} YNXT`}/><ReviewRow label={c("Original transaction","原交易")} value={recovery.record.transfer.hash}/><InfoCard title={recovery.state==="settled"?c("Matching settlement retained","已保留相符结算"):c("Original outcome needs review","原结果仍需核对")} body={c("Checking observes the original hash only. Settlement actions use its retained intent and result, never another native transaction. An unknown response cannot permit paying again. A verified local checkpoint is not consensus finality.","查询只读取原交易哈希。结算继续使用保留的付款意图和结果，不另建原生交易。未知响应不代表可以再次付款。本地检查点核验不等于共识最终确认。")}/>
      {recovery.actions.map(mode=><Button key={mode} label={c(mode==="check"?"Check original transaction":mode==="read-receipt"?"Read original settlement receipt":mode==="settle"?"Submit original settlement":"Save reviewed receipt and finish",mode==="check"?"查询原交易":mode==="read-receipt"?"读取原结算收据":mode==="settle"?"提交原付款结算":"保存已核对收据并完成")} disabled={busy||mode==="settle"&&time>=Math.min(Date.parse(recovery.record.intent.quoteExpiresAt),Date.parse(recovery.record.session.expiresAt))} onPress={()=>void recover(mode)}/>)}
    </View>:null}
    {invoiceID&&!recovery&&!quote?<Button label={c("Read and review signed quote","读取并核对签名报价")} disabled={busy} onPress={()=>void loadQuote()}/>:null}
    {loaded&&receipts.length===0?<Text style={styles.sheetText}>{c("No signed Pay receipts saved for this account on this device.","本设备尚无此账户已保存的签名 Pay 收据。")}</Text>:null}
    {receipts.map(receipt=><View key={receipt.record.transfer.hash} style={styles.auditRow}><Text style={styles.infoTitle}>{receipt.record.invoice.merchantName}</Text><ReviewRow label={c("Invoice","发票")} value={receipt.record.invoice.id}/><ReviewRow label={c("Amount / fee","金额 / 手续费")} value={`${receipt.record.intent.amount} / ${receipt.record.intent.fee} YNXT`}/><ReviewRow label={c("Original transaction","原交易")} value={receipt.record.transfer.hash}/><ReviewRow label={c("Settlement receipt","结算收据")} value={`${receipt.settlement.receiptId}\n${receipt.settlement.auditId}`}/><ReviewRow label={c("Settlement time","结算时间")} value={formatDateTime(locale,receipt.settlement.committedAt)}/><Text style={styles.sheetText}>{c("Local native checkpoint and matching authenticated business receipt; not consensus finality or complete chain history.","本地原生检查点及相符的已认证业务收据；不代表共识最终确认或完整链上历史。")}</Text></View>)}
    {error?<><Text accessibilityRole="alert" style={styles.error}>{error}</Text><RecoveryRequiredNotice error={error}/></>:null}
    <SecondaryButton label={c("Refresh saved original records","刷新已保存原记录")} disabled={busy} onPress={()=>void readSaved()}/>{cursor?<SecondaryButton label={c("Older signed receipts","更早的签名收据")} disabled={busy} onPress={()=>void readSaved(true)}/>:null}
    <SecondaryButton label={c("Close and keep original records","关闭并保留原记录")} onPress={dismiss}/>
  </Sheet></Modal>;
}

function EvmCompatibilityModal({visible,account,close}:{visible:boolean;account:WalletAccount;close:()=>void}){
  const from=evmAddressFromYNX(account.account),operations=useWalletOperations(),scope=useOperationScope(visible,account.account),copyScope=useOperationScope(visible,account.account);
  const simulationBusy=useRef(false),copyNoticeRevision=useRef(0);
  const[to,setTo]=useState(""),[data,setData]=useState("0x"),[valueWei,setValueWei]=useState("0"),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[result,setResult]=useState<EvmSimulationResult|null>(null),[error,setError]=useState<string|null>(null);
  const clearResult=()=>{simulationBusy.current=false;copyNoticeRevision.current++;setBusy(false);setCopied(false);setResult(null);setError(null)};
  useEffect(()=>{scope.cancel();copyScope.cancel();setTo("");setData("0x");setValueWei("0");clearResult()},[visible,account.account,scope,copyScope]);
  useEffect(()=>operations.subscribe(()=>{clearResult()}),[operations]);
  useEffect(()=>()=>{copyNoticeRevision.current++},[]);
  const dismiss=()=>{scope.cancel();copyScope.cancel();clearResult();close()};
  const edit=(setValue:(value:string)=>void,value:string)=>{scope.cancel();simulationBusy.current=false;setBusy(false);setResult(null);setError(null);setValue(value.trim())};
  const valid=/^0x[0-9a-f]{40}$/.test(to)&&to!==from&&/^0x(?:[0-9a-f]{2})*$/.test(data)&&/^(0|[1-9][0-9]{0,77})$/.test(valueWei);
  const copy=async()=>{let lease:WalletOperationLease|undefined;try{lease=copyScope.begin({account:account.account,requireUnlocked:false});await lease.step(()=>copyPublicValueWithExpiry(Clipboard,from,{guard:lease!.assert}));lease.assert();const revision=++copyNoticeRevision.current;setCopied(true);setTimeout(()=>{if(copyNoticeRevision.current===revision)setCopied(false)},1500)}catch(caught){if(lease?.isCurrent())setError(message(caught))}finally{lease?.finish()}};
  const simulate=async()=>{
    if(simulationBusy.current||!visible||!valid)return;simulationBusy.current=true;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);setResult(null);
    const input=Object.freeze({from,to,data,valueWei});
    try{lease=scope.begin({account:account.account,requireUnlocked:false});const current=lease;const next=await current.step(()=>evmSimulationClient().simulate(input,current.assert));current.assert();setResult(next)}
    catch(caught){if(!lease||lease.isCurrent())setError(message(caught))}
    finally{if(!lease||lease.ownsScope()){simulationBusy.current=false;setBusy(false)}lease?.finish()}
  };
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title="0x EVM compatibility" close={dismiss}><ReviewRow label="Default Wallet identity" value={account.account}/><ReviewRow label="Derived 0x address" value={from}/><SecondaryButton label={copied?"0x address copied for 30 seconds":"Copy 0x address for 30 seconds"} onPress={()=>void copy()}/><InfoCard title="Read-only simulation boundary" body="Wallet verifies chain ID 6423, deployed contract code, eth_call and eth_estimateGas. This view never signs or broadcasts an EVM transaction."/><Field label="Contract address (lowercase 0x)" value={to} onChangeText={value=>edit(setTo,value)}/><Field label="Calldata (lowercase even-length hex)" value={data} onChangeText={value=>edit(setData,value)} multiline/><Field label="Native value in wei" value={valueWei} onChangeText={value=>edit(setValueWei,value)}/>{error?<Text style={styles.error}>{error}</Text>:null}{result?<><Text style={[styles.eyebrow,styles.sectionLabel]}>PRECISE SIMULATION REVIEW</Text><ReviewRow label="Status" value={result.truthfulStatus}/><ReviewRow label="Chain / block" value={`${result.chainId} / ${result.blockNumber}`}/><ReviewRow label="From" value={result.from}/><ReviewRow label="Contract" value={result.to}/><ReviewRow label="Method selector" value={result.methodSelector}/><ReviewRow label="Value" value={`${result.valueWei} wei`}/><ReviewRow label="Gas estimate" value={result.gasEstimate}/><ReviewRow label="Code" value={`${result.contractCodeBytes} bytes\n${result.contractCodeHash}`}/><ReviewRow label="Return data" value={result.returnData}/><ReviewRow label="Source / as of" value={`${result.source}\n${result.asOf}`}/><InfoCard title="Simulation is not execution" body="State, gas, code and return values can change before a separately reviewed transaction is signed. No success, settlement or receipt is claimed here."/></>:null}<Button label={busy?"Verifying RPC and simulating…":"Run read-only contract simulation"} disabled={busy||!valid} onPress={()=>void simulate()}/></Sheet></Modal>
}

function NativeContractModal({visible,account,close}:{visible:boolean;account:WalletAccount;close:()=>void}){
  const locale=useContext(WalletLocaleContext),scope=useOperationScope(visible,account.account);
  const [target,setTarget]=useState(""),[method,setMethod]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [legacy,setLegacy]=useState(false);
  const [artifact,setArtifact]=useState<NativeContractArtifact|BFTNativeContract|null>(null),[result,setResult]=useState<NativeContractRead|BFTNativeContractRead|null>(null);
  const c=(en:string,_zh:string)=>walletAppFlowCopy(locale,en);
  const dismiss=()=>{scope.cancel();close()};
  useEffect(()=>{scope.cancel();setTarget("");setMethod("");setArtifact(null);setResult(null);setError(null);setBusy(false);setLegacy(false)},[visible,account.account,scope]);
  const run=async(read:boolean)=>{
    if(busy)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);setResult(null);
    const request=Object.freeze({target,method,legacy});
    try{
      lease=scope.begin({account:account.account});const current=lease,client=new NativeContractClient(chainClient().origin);
      if(read){const next=await(request.legacy?client.read(request.target,request.method,current.assert):client.readBFT(request.target,request.method,current.assert));current.assert();setArtifact(next.artifact);setResult(next)}
      else{const next=await(request.legacy?client.lookup(request.target,current.assert):client.lookupBFT(request.target,current.assert));current.assert();setArtifact(next);setMethod("")}
    }catch(caught){if(!lease||lease.isCurrent())setError(caught instanceof NativeContractError&&caught.code==="NATIVE_CONTRACT_PURE_VIEW_ONLY"?
      c("Only read-only pure/view methods can be used here.","此处仅支持 pure/view 只读方法。"):
      caught instanceof NativeContractError&&caught.code==="NATIVE_CONTRACT_CALLDATA_REQUIRED"?c("This method needs ABI-encoded arguments. Enter its complete calldata before reading.","此方法需要 ABI 编码参数，请输入完整 calldata 后查询。"):
      c("The contract or its read result could not be verified. Check the address and method, then retry. Nothing was signed or sent.","无法核对合约或读取结果。请检查地址和方法后重试，未签署或发送任何交易。"))}
    finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}
  };
  const valid=/^0x[0-9a-f]{40}$/.test(target);
  const functions=artifact?("functions" in artifact?artifact.functions:bftNativeReadMethods(artifact)):[];
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={c("Native contract reads","原生合约查询")} close={dismiss}>
    <InfoCard title={c("Read existing contract capabilities","读取现有合约能力")} body={c("Wallet checks the YNX network and original contract metadata. It reads only declared pure/view methods, without keys, transfers or gas estimates. This is not a full Ethereum execution simulator.","Wallet 将核对 YNX 网络和原始合约信息，仅查询声明的 pure/view 方法，不读取密钥、不转账、不估算 gas。这不是完整以太坊执行模拟器。")}/>
    <Field label={c("Contract address (lowercase 0x)","合约地址（小写 0x）")} value={target} onChangeText={value=>{if(busy)return;setTarget(value.trim());setArtifact(null);setResult(null);setMethod("");setError(null)}}/>
    <SecondaryButton label={c(busy?"Checking contract…":"Load contract",busy?"正在核对合约…":"加载合约")} disabled={busy||!valid} onPress={()=>void run(false)}/>
    {artifact?<><ReviewRow label={c("Contract","合约")} value={artifact.name}/><ReviewRow label={c("Runtime","读取模式")} value={"artifactKind" in artifact&&artifact.artifactKind==="source-analyzer-artifact"?c("Local source analyzer · literal returns","本地源码分析器 · 字面值返回"):c("Pinned artifact · bounded bytecode subset","固定编译产物 · 受限字节码子集")}/>
      {functions.filter(row=>["pure","view"].includes(row.stateMutability)).map(row=><SecondaryButton key={row.signature} label={`${row.signature} · ${row.stateMutability}`} disabled={busy||("artifactKind" in artifact&&artifact.artifactKind==="pinned-solc-bytecode-artifact"&&!row.bytecodeSelectorMatched)} onPress={()=>{
        setMethod(legacy?(row.inputCount===0?row.signature:row.selector):row.selector+(row.inputCount===1?evmAddressFromYNX(account.account).slice(2).padStart(64,"0"):""));setResult(null);setError(null)}}/>)}
      {functions.every(row=>!["pure","view"].includes(row.stateMutability))?<Text style={styles.sheetText}>{c("This contract exposes no supported read-only method.","此合约未提供受支持的只读方法。")}</Text>:null}
      <Field label={legacy?c("Method signature or complete ABI calldata","方法签名或完整 ABI calldata"):c("Read-only ABI calldata · account queries use your selected address","只读 ABI calldata · 账户查询默认填写当前地址")} value={method} onChangeText={value=>{if(!busy){setMethod(value.trim());setResult(null);setError(null)}}} multiline/>
      <Button label={c(busy?"Reading…":"Read without signing",busy?"正在读取…":"只读查询，不签名")} disabled={busy||!valid||!method} onPress={()=>void run(true)}/>
      {"limitations" in artifact?artifact.limitations.map((limitation,index)=><Text key={index} style={styles.footnote}>{limitation}</Text>):<Text style={styles.footnote}>{c("Original bounded consensus runtime only; arbitrary bytecode execution and remote consensus proof are not claimed.","仅支持既有的受限共识运行时，不宣称任意字节码执行或远端共识证明。")}</Text>}
    </>:null}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    {result?<>{result.returnValue!==null?<ReviewRow label={c("Return value","返回值")} value={result.returnValue}/>:null}<ReviewRow label={c("Encoded result","编码结果")} value={result.encodedResult}/><ReviewRow label={c("Execution evidence","执行依据")} value={"executionStatus" in result?result.executionStatus:c("Original bounded static-call interpreter","既有受限只读解释器")}/><ReviewRow label={c("Source / as of","来源 / 查询时间")} value={`${result.origin}\n${result.asOf}`}/><Text style={styles.footnote}>{c("Read-only local result. No transaction receipt or remote consensus proof is claimed.","这是本地只读结果，不代表交易收据或远端共识证明。")}</Text></>:null}
    <SecondaryButton label={legacy?c("Use BFT contract API","使用 BFT 合约接口"):c("Use legacy local contract API","使用原本地合约接口")} disabled={busy} onPress={()=>{scope.cancel();setLegacy(value=>!value);setArtifact(null);setResult(null);setMethod("");setError(null)}}/>
  </Sheet></Modal>;
}

function WalletCenter({visible,account,chainState,close,openAudit,retry}:{visible:boolean;account:WalletAccount;chainState:NativeChainState;close:()=>void;openAudit:()=>void;retry:()=>void}){
  const locale=useContext(WalletLocaleContext);
  const cancelSessions=useRef<()=>void>(()=>{});
  const dismiss=()=>{cancelSessions.current();close()};
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={walletCopy(locale,"Wallet Center")} close={dismiss}><Text style={styles.eyebrow}>{walletCopy(locale,"ASSETS / ACTIVITY")}</Text><InfoCard title={chainState.account?`${chainState.account.balance} YNXT`:chainState.phase==="loading"?walletCopy(locale,"YNXT · loading"):chainState.phase==="unrecorded"?walletCopy(locale,"YNXT · no account record"):walletCopy(locale,"YNXT · unavailable")} body={chainState.phase==="loading"?walletCopy(locale,"Loading balance and nonce…"):chainState.phase==="unrecorded"?walletCopy(locale,"This address has no on-chain account record yet. Receive testnet YNXT to get started. Balance and nonce are not available yet."):chainState.phase==="failed"?networkRecoveryCopy(locale,chainState.error??walletCopy(locale,"Balance unavailable")):walletCopy(locale,"Authoritative nonce {nonce} on ynx_6423-1.",{nonce:chainState.account?.nonce??"—"})}/>{chainState.activityPhase==="loading"?<InfoCard title={walletCopy(locale,"Activity · loading")} body={walletCopy(locale,"Loading recent chain transactions…")}/>:chainState.activityPhase==="failed"?<InfoCard title={walletCopy(locale,"Activity · unavailable")} body={networkRecoveryCopy(locale,chainState.activityError??walletCopy(locale,"Recent transactions could not be loaded."))}/>:chainState.activity.length===0?<InfoCard title={walletCopy(locale,"Activity · empty")} body={walletCopy(locale,"No matching account activity appears in the latest 25 chain transactions.")}/>:chainState.activity.map((item)=><View key={item.hash} style={styles.auditRow}><Text style={styles.infoTitle}>{item.to===evmAddressFromYNX(account.account)?walletCopy(locale,"Received"):walletCopy(locale,"Sent")} · {item.amount} YNXT</Text><Text style={styles.infoBody}>{short(item.hash)} · {walletCopy(locale,"fee {fee} · nonce {nonce}",{fee:item.fee,nonce:item.nonce})}</Text></View>)}<SecondaryButton label={walletCopy(locale,"Refresh balance and activity")} disabled={chainState.phase==="loading"||chainState.activityPhase==="loading"} onPress={retry}/>
    <ConnectedApps visible={visible} account={account} cancelRef={cancelSessions}/>
    <SecondaryButton label={walletCopy(locale,"Open Authorization Audit")} onPress={openAudit}/>
    <Text style={[styles.eyebrow,styles.sectionLabel]}>{walletCopy(locale,"RECOVERY / SECURITY / NETWORK")}</Text>
    <InfoCard title={walletCopy(locale,"Recovery")} body={walletCopy(locale,"Your offline key restores this account. Each app still needs its own sign-in approval. You can review existing app sessions above.")}/>
    <InfoCard title={walletCopy(locale,"Security")} body={walletCopy(locale,"Wallet locks in the background. Viewing app sessions, revoking a session and using a private key each require system biometrics.")}/>
    <InfoCard title={translate(locale,"network")} body={walletCopy(locale,"YNX testnet · ynx_6423-1 · native YNXT · rpc-testnet.ynxweb4.com. EVM chain ID 6423 is available in the compatibility view.")}/>
  </Sheet></Modal>
}

function ConnectedApps({visible,account,cancelRef}:{visible:boolean;account:WalletAccount;cancelRef:{current:()=>void}}){
  const locale=useContext(WalletLocaleContext);
  const operations=useWalletOperations(),scope=useOperationScope(visible,account.account),client=useMemo(()=>walletSessionInventoryClient(),[]);
  const [inventory,setInventory]=useState<{phase:"idle"|"loading"|"ready"|"failed";value?:WalletSessionInventory;error?:string}>({phase:"idle"});
  const [review,setReview]=useState<SessionInventoryItem|null>(null),[busy,setBusy]=useState(false),[revokeError,setRevokeError]=useState<string|null>(null),[unknown,setUnknown]=useState(false),[receipt,setReceipt]=useState<{asOf:string;alreadyRevoked:boolean}|null>(null);
  const busyRef=useRef(false);
  const reset=useCallback(()=>{scope.cancel();busyRef.current=false;setInventory({phase:"idle"});setReview(null);setBusy(false);setRevokeError(null);setUnknown(false);setReceipt(null)},[scope]);
  cancelRef.current=reset;
  useEffect(()=>{reset();return()=>scope.cancel()},[visible,account.account,reset,scope]);
  useEffect(()=>operations.subscribe(reset),[operations,reset]);
  const refresh=async()=>{
    if(!visible||busyRef.current)return;busyRef.current=true;setBusy(true);setInventory({phase:"loading"});setReview(null);setReceipt(null);let lease:WalletOperationLease|undefined;
    try{lease=scope.begin({account:account.account});const value=await client.load(account,lease);lease.assert();setInventory({phase:"ready",value})}
    catch(caught){if(!lease||lease.ownsScope())setInventory({phase:"failed",error:message(caught)})}
    finally{if(!lease||lease.ownsScope()){busyRef.current=false;setBusy(false)}lease?.finish()}
  };
  const revoke=async()=>{
    if(!visible||busyRef.current||!review)return;const target=review;busyRef.current=true;setBusy(true);setRevokeError(null);let lease:WalletOperationLease|undefined;
    try{lease=scope.begin({account:account.account});const result=await client.revoke(account,target.sessionBinding,lease);lease.assert();setReceipt({asOf:result.asOf,alreadyRevoked:result.alreadyRevoked});setUnknown(false);
      // This receipt confirms this target only; other session statuses still need
      // a separately authorized refresh before a new inventory can be claimed.
      setInventory({phase:"idle"});
    }catch(caught){if(!lease||lease.ownsScope()){setUnknown(previous=>previous||caught instanceof WalletSessionRevocationUnknown);setRevokeError(message(caught))}}
    finally{if(!lease||lease.ownsScope()){busyRef.current=false;setBusy(false)}lease?.finish()}
  };
  const openReview=(item:SessionInventoryItem)=>{if(busyRef.current)return;setReview(item);setReceipt(null);setRevokeError(null);setUnknown(false)};
  return <View>
    <Text style={[styles.eyebrow,styles.sectionLabel]}>{walletCopy(locale,"CONNECTED APPS / SESSIONS / DEVICES")}</Text>
    <ReviewRow label={walletCopy(locale,"Wallet account")} value={`${account.label}\n${account.account}`}/>
    {review?<>
      <Text style={styles.infoTitle}>{receipt?walletCopy(locale,"Session revoked"):walletCopy(locale,"Review session revocation")}</Text>
      <ReviewRow label={walletCopy(locale,"App")} value={`${review.displayName}\n${review.productId} · ${review.clientId}`}/>
      <ReviewRow label={translate(locale,"appIdentity")} value={`${review.applicationId}\n${review.platform} · ${review.origin}`}/>
      <ReviewRow label={walletCopy(locale,"Device")} value={`${review.deviceId}\n${review.deviceBinding}`}/>
      <ReviewRow label={walletCopy(locale,"Session")} value={review.sessionBinding}/>
      <ReviewRow label={translate(locale,"permissions")} value={review.scopes.join("\n")}/>
      <ReviewRow label={walletCopy(locale,"Issued / expires")} value={`${review.issuedAt}\n${review.expiresAt}`}/>
      {receipt?<InfoCard title={receipt.alreadyRevoked?walletCopy(locale,"Auth confirmed this session was already revoked"):walletCopy(locale,"Auth confirmed revocation")} body={walletCopy(locale,"Confirmed at {asOf}. This session can no longer authorize app requests. Other sessions keep their own status.",{asOf:receipt.asOf})}/>:<>
        <InfoCard title={walletCopy(locale,"Revoke this app session")} body={walletCopy(locale,"After your biometric confirmation, Wallet will sign a request to revoke only the session shown above. Other app sessions and your assets are unaffected.")}/>
        {unknown?<Text style={styles.sheetText}>{walletCopy(locale,"Revocation is not confirmed. Retry this same session to check the outcome.")}</Text>:null}
        {revokeError?<Text accessibilityRole="alert" style={styles.error}>{walletDetailError(locale,revokeError)}</Text>:null}
        <RecoveryRequiredNotice error={revokeError}/>
        <DangerButton label={busy?walletCopy(locale,"Confirming with Auth…"):unknown?walletCopy(locale,"Retry this session revocation"):walletCopy(locale,"Confirm session revocation")} disabled={busy} onPress={()=>void revoke()}/>
      </>}
      <SecondaryButton label={walletCopy(locale,"Back to Connected Apps")} disabled={busy} onPress={()=>{setReview(null);setRevokeError(null);setUnknown(false);setReceipt(null)}}/>
    </>:<>
      {inventory.phase==="idle"?<InfoCard title={walletCopy(locale,"View your connected apps")} body={walletCopy(locale,"Use your fingerprint or Face ID to let Wallet sign a request for this account's app sessions. This does not grant any app permission to use your assets.")}/>:inventory.phase==="loading"?<InfoCard title={walletCopy(locale,"Connected Apps · loading")} body={walletCopy(locale,"Confirm system biometrics, then wait for Auth to return this account's sessions.")}/>:inventory.phase==="failed"?<InfoCard title={walletCopy(locale,"Connected Apps · unavailable")} body={inventory.error?walletDetailError(locale,inventory.error):walletCopy(locale,"Auth could not confirm your sessions. Try again.")}/>:inventory.value?<>
        <ReviewRow label={walletCopy(locale,"Last checked with Auth")} value={`${inventory.value.asOf}\n${walletCopy(locale,"{count} sessions · {devices} app devices",{count:inventory.value.sessions.length,devices:new Set(inventory.value.sessions.map(item=>item.deviceBinding)).size})}`}/>
        {inventory.value.sessions.length===0?<InfoCard title={walletCopy(locale,"No connected app sessions")} body={walletCopy(locale,"Auth returned no app sessions for this account at the time shown above.")}/>:inventory.value.sessions.map(item=><View key={item.sessionBinding} style={styles.auditRow}>
          <Text style={styles.infoTitle}>{item.displayName} · {item.active?walletCopy(locale,"Active at last check"):walletCopy(locale,"Inactive at last check")}</Text>
          <Text style={styles.infoBody}>{item.origin}{"\n"}{item.platform} · {item.deviceId}{"\n"}{item.scopes.join(", ")}{"\n"}{walletCopy(locale,"Expires {expiresAt}",{expiresAt:item.expiresAt})}{item.inactiveReasons.length?`\n${item.inactiveReasons.map(reason=>sessionReason(locale,reason)).join(" · ")}`:""}</Text>
          <SecondaryButton label={walletCopy(locale,"Review {name} session",{name:item.displayName})} disabled={busy} onPress={()=>openReview(item)}/>
        </View>)}
      </>:null}
      <RecoveryRequiredNotice error={inventory.error}/>
      <SecondaryButton label={busy?walletCopy(locale,"Loading Connected Apps…"):inventory.phase==="failed"?walletCopy(locale,"Retry Connected Apps"):inventory.phase==="ready"?walletCopy(locale,"Refresh Connected Apps"):walletCopy(locale,"Show Connected Apps")} disabled={busy} onPress={()=>void refresh()}/>
    </>}
  </View>
}
function sessionReason(locale:WalletLocale,reason:string){return ({"session-revoked":walletCopy(locale,"Session revoked"),"device-revoked":walletCopy(locale,"Device revoked"),"device-logout":walletCopy(locale,"Device sessions signed out"),"account-revoked":walletCopy(locale,"Account access revoked"),expired:walletCopy(locale,"Expired"),"issued-in-future":walletCopy(locale,"Not yet active")} as Record<string,string>)[reason]??reason}

function WalletControlCenter({visible,locale,close}:{visible:boolean;locale:WalletLocale;close:()=>void}){
  const runtime=(globalThis as any).__YNX_WALLET_CONTROL_RUNTIME__ as {snapshot?:unknown}|undefined;
  const view=useMemo(()=>buildWalletControlView(runtime?.snapshot??null),[runtime?.snapshot,visible]);
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={close}><Sheet title={controlCopy(locale,"title")} close={close}>
    <Text style={styles.eyebrow}>{controlCopy(locale,"smart")}</Text>
    <View accessibilityRole="summary" style={styles.controlStatus}><View style={[styles.statusDot,{backgroundColor:view.smartAccountReady?ACTIVE_COLORS.success:ACTIVE_COLORS.warning}]}/><View style={styles.infoCopy}><Text style={styles.infoTitle}>{view.smartAccountReady?controlCopy(locale,"ready"):controlCopy(locale,"unavailable")}</Text><Text style={styles.infoBody}>{view.phase==="unavailable"?"No verified runtime snapshot is connected.":view.reason}</Text></View></View>
    {view.smartAccount?<><ReviewRow label="Account" value={view.smartAccount.account}/><ReviewRow label="EntryPoint" value={view.smartAccount.entryPoint}/><ReviewRow label="Paymaster" value={view.smartAccount.paymaster}/><ReviewRow label="Bundler" value={view.smartAccount.bundlerOrigin}/><ReviewRow label="Sponsored gas" value={view.sponsorshipReady?"Enabled by verified policy":"Disabled or unverified"}/><ReviewRow label="Evidence" value={`${view.smartAccount.source}\n${view.smartAccount.asOf} · ${view.smartAccount.version}`}/></>:null}
    <Text style={[styles.eyebrow,styles.sectionLabel]}>{controlCopy(locale,"capital")}</Text>
    <Text style={styles.sheetText}>{controlCopy(locale,"nonGuarantee")} {controlCopy(locale,"ai")}</Text>
    {view.capitalReviews.map((review)=><CapitalReviewRow key={review.productType} review={review} locale={locale} stale={view.staleCapitalProducts.includes(review.productType)}/>)}
    {view.missingCapitalProducts.length?<View style={styles.missingList}><Text style={styles.infoTitle}>{controlCopy(locale,"missing")}</Text>{view.missingCapitalProducts.map((type)=><Text key={type} style={styles.infoBody}>— {capitalName(type)}</Text>)}</View>:null}
  </Sheet></Modal>
}

function CapitalReviewRow({review,locale,stale}:{review:CapitalReview;locale:WalletLocale;stale:boolean}){const[open,setOpen]=useState(false);return <View style={styles.nativeList}><Pressable accessibilityRole="button" accessibilityLabel={`${capitalName(review.productType)} capital risk inspector`} accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={styles.nativeListHeader}><View style={styles.infoCopy}><Text style={styles.infoTitle}>{capitalName(review.productType)} · {review.name}</Text><Text style={styles.infoBody}>{review.provider} · {stale?"STALE":"VERIFIED"} · {review.asOf}</Text></View><ChevronDown color={ACTIVE_COLORS.ink}/></Pressable>{open?<View style={styles.riskInspector}><ReviewRow label="Yield source" value={review.yieldSource}/><ReviewRow label="Historical yield" value={review.historicalYieldRange}/><ReviewRow label="Fees" value={review.fees}/><ReviewRow label="Lock / cooldown" value={`${review.lock}\n${review.cooldown}`}/><ReviewRow label="Slashing / drawdown" value={`${review.slashing}\n${review.drawdown}`}/><ReviewRow label="Withdrawal / reserve" value={`${review.withdrawalDelay}\n${review.reserveRatio}`}/><ReviewRow label="Contract" value={review.contract}/><ReviewRow label="Governance" value={review.governance}/><ReviewRow label="Risk" value={review.risk}/><ReviewRow label={controlCopy(locale,"exit")} value={review.immediateExit}/><ReviewRow label={controlCopy(locale,"revoke")} value={review.revoke}/><ReviewRow label="Source" value={`${review.source}\n${review.version}`}/></View>:null}</View>}
function capitalName(value:string){return ({"native-staking":"Native Staking","liquid-staking-candidate":"Liquid Staking Candidate","withdrawal-queue":"Withdrawal Queue","safety-module":"Safety Module","service-security-pool":"Service Security Pool","dex-lp":"LP Position",vault:"Vault","trading-subaccount":"Trading Subaccount","api-wallet":"API Wallet","portfolio-margin":"Portfolio Margin",stablecoin:"Stablecoin","cross-chain-route":"Cross-chain Route","solver-auction":"Solver Auction","protocol-owned-liquidity":"Protocol-owned Liquidity","treasury-multisig":"Treasury Multisig"} as Record<string,string>)[value]??"Unsupported capital product"}

function RecoverySheet({error,pending,confirmation,setConfirmation,busy,save,close}:{error:string|null;pending:{secretHex:string;label:string};confirmation:string;setConfirmation:(v:string)=>void;busy:boolean;save:()=>void;close:()=>void}){
  useEffect(()=>{void preventScreenCaptureAsync("wallet-recovery");return()=>{void allowScreenCaptureAsync("wallet-recovery")}},[]);
  const locale=useContext(WalletLocaleContext);
  return <Sheet title={setupCopy(locale,"backupTitle")} close={close} actions={<Button label={setupCopy(locale,"save")} disabled={busy||confirmation!=="BACKED UP"} onPress={save}/>}><Text style={styles.sheetText}>{setupCopy(locale,"backupBody")}</Text><Text accessibilityLabel="YNX Wallet recovery key" style={styles.recoveryKey}>{pending.secretHex}</Text><Field label={setupCopy(locale,"backupConfirm")} value={confirmation} onChangeText={setConfirmation}/>{error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}</Sheet>
}

function RecoveryExportModal({visible,account,close}:{visible:boolean;account:WalletAccount;close:()=>void}){
  const operations=useWalletOperations(),scope=useOperationScope(visible,account.account),[phase,setPhase]=useState<"idle"|"authorizing"|"ready"|"failed">("idle"),[secret,setSecret]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const dismiss=()=>{scope.cancel();setSecret(null);setPhase("idle");close()};
  useEffect(()=>operations.subscribe(()=>{scope.cancel();setSecret(null);setPhase("idle")}),[operations,scope]);
  useEffect(()=>{scope.cancel();setSecret(null);setError(null);if(!visible){setPhase("idle");return}let lease:WalletOperationLease|undefined;setPhase("authorizing");const timer=setTimeout(()=>{scope.cancel();setSecret(null);setPhase("idle");close()},RECOVERY_DISPLAY_MS);
    void(async()=>{try{lease=scope.begin({account:account.account,ttlMs:RECOVERY_DISPLAY_MS});await lease.step(()=>preventScreenCaptureAsync("wallet-recovery-export"));await lease.step(()=>authorizeLocalKeyUse("recovery-view"));await lease.withSecret(()=>repository.accountSecret(account.account,lease!.assert,{allowLegacyMigration:true}),value=>{setSecret(value);setPhase("ready")})}catch(caught){if(!lease||lease.ownsScope()){setError(message(caught));setPhase("failed")}}})();
    return()=>{clearTimeout(timer);scope.cancel();setSecret(null);void allowScreenCaptureAsync("wallet-recovery-export")}
  },[visible,account.account,scope]);
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title="Offline recovery key" close={dismiss}>{phase==="authorizing"?<><ActivityIndicator color={ACTIVE_COLORS.blue}/><Text style={styles.sheetText}>Confirm strong system biometrics to decrypt this account's recovery key.</Text></>:phase==="ready"&&secret?<><Text style={styles.sheetText}>This view closes after 60 seconds. Write this key offline now. Clipboard export and screenshots are disabled. Product sessions, devices and approvals are not restored with it.</Text><Text accessibilityLabel="YNX Wallet offline recovery key" style={styles.recoveryKey}>{secret}</Text><InfoCard title="Replacement-device boundary" body="Importing this key restores only the native account. Re-authorize each product device through the canonical Gateway."/></>:<><Text style={styles.error}>{error??"Recovery key is unavailable"}</Text><RecoveryRequiredNotice error={error}/><SecondaryButton label="Close recovery view" onPress={dismiss}/></>}</Sheet></Modal>}

function RenameModal({visible,account,close,renamed}:{visible:boolean;account:WalletAccount;close:()=>void;renamed:(manifest:WalletManifest)=>void}){const[label,setLabel]=useState(account.label),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);useEffect(()=>{if(visible){setLabel(account.label);setError(null)}},[visible,account.label]);const save=async()=>{setBusy(true);setError(null);try{renamed(await repository.renameAccount(account.account,label.trim()))}catch(caught){setError(message(caught))}finally{setBusy(false)}};return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={close}><Sheet title="Rename account" close={close}><Text style={styles.sheetText}>The label is local metadata. It never changes the ynx1 address, public key, chain history or product authorization binding.</Text><Field label="Account label" value={label} onChangeText={setLabel}/>{error?<Text style={styles.error}>{error}</Text>:null}<Button label={busy?"Saving local label…":"Save account label"} disabled={busy||label.trim()===account.label||label.trim().length<1||label.trim().length>40} onPress={()=>void save()}/></Sheet></Modal>}

function DeleteModal({visible,account,close,deleted,failed}:{visible:boolean;account:WalletAccount;close:()=>void;deleted:(v:WalletManifest)=>void;failed:(text:string)=>void}){
  const locale=useContext(WalletLocaleContext);
  const scope=useOperationScope(visible,account.account),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false);
  const dismiss=()=>{scope.cancel();setConfirm("");setBusy(false);close()};
  useEffect(()=>{scope.cancel();setConfirm("");setBusy(false)},[scope,visible,account.account]);
  const remove=async()=>{let lease:WalletOperationLease|undefined;setBusy(true);try{lease=scope.begin({account:account.account});await lease.step(()=>authorizeLocalKeyUse("account-delete"));const next=await lease.step(()=>repository.deleteAccount(account.account,lease!.assert));deleted(next)}catch(caught){if(!lease||lease.ownsScope())failed(message(caught))}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}};
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={translate(locale,"removeAccountTitle")} close={dismiss}><Text style={styles.sheetText}>{translate(locale,"removeAccountWarning")}</Text><Field label={translate(locale,"typeAccountLabelToConfirm").replace("{label}",()=>account.label)} value={confirm} onChangeText={setConfirm}/><DangerButton label={translate(locale,"removeLocalAccount")} disabled={busy||confirm!==account.label} onPress={()=>void remove()}/></Sheet></Modal>}

function ApplicationActionModal({locale,review,controller,close,onReturned}:{locale:WalletLocale;review:ApplicationActionReview;controller:ApplicationActionController;close:()=>void;onReturned:()=>void}){
  const {request,account:selected}=review;
  const scope=useOperationScope(true,selected.account);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[returnReady,setReturnReady]=useState(()=>controller.hasReturn(review.id));
  const decide=async(action:"approve"|"reject"|"retryReturn")=>{
    if(busy||controller.current?.id!==review.id)return;
    let lease:WalletOperationLease;try{lease=scope.begin({account:selected.account,requireUnlocked:false})}catch{return}
    setBusy(true);setError(null);
    try{await controller[action](review.id);if(lease.ownsScope())onReturned()}
    catch(caught){if(lease.ownsScope()){setReturnReady(controller.hasReturn(review.id));setError(localizeError(locale,caught))}}
    finally{if(lease.ownsScope())setBusy(false);lease.finish()}
  };
  const dismiss=()=>{if(!busy){if(returnReady)close();else void decide("reject")}};
  const actionLabel=({dex_swap_exact_input:"swapInput",dex_swap_exact_output:"swapOutput",dex_liquidity_add:"addLiquidity",dex_liquidity_remove:"removeLiquidity"} as const)[request.action];
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={applicationActionCopy(locale,"title")} close={dismiss}>
    <Text style={styles.authorizationLead}>{applicationActionCopy(locale,"signOnly")}</Text>
    <ReviewRow label={translate(locale,"requestingApp")} value={request.productId}/>
    <ReviewRow label={authorizationCopy(locale,"origin")} value={request.origin}/>
    <Text style={styles.scopeExplain}>{applicationActionCopy(locale,"unverifiedOrigin")}</Text>
    <ReviewRow label={applicationActionCopy(locale,"action")} value={applicationActionCopy(locale,actionLabel)+"\n"+request.action}/>
    <ReviewRow label={translate(locale,"network")} value="YNX Testnet · 6423 · 0x1917"/>
    <ReviewRow label={translate(locale,"account")} value={selected.label+"\n"+selected.account}/>
    <ReviewRow label={applicationActionCopy(locale,"fee")} value="1 YNXT"/>
    <ReviewRow label={applicationActionCopy(locale,"nonce")} value={String(request.nonce)}/>
    <Text style={styles.sheetText}>{applicationActionCopy(locale,"units")}</Text>
    {Object.entries(request.payload).map(([name,value])=><ReviewRow key={name} label={name} value={String(value)}/>)}
    <ReviewRow label={translate(locale,"expires")} value={formatDateTime(locale,request.expiresAt)}/>
    <ReviewRow label={authorizationCopy(locale,"callback")} value={request.callback}/>
    {error?<><Text style={styles.error}>{error}</Text><RecoveryRequiredNotice error={error}/><SecondaryButton label={authorizationCopy(locale,"closeRequest")} disabled={busy} onPress={close}/></>:null}
    {returnReady?<Button label={authorizationCopy(locale,"retryReturn")} disabled={busy} onPress={()=>void decide("retryReturn")}/>:<View style={styles.approvalButtons}><SecondaryButton label={translate(locale,"reject")} disabled={busy} onPress={()=>void decide("reject")}/><Button label={applicationActionCopy(locale,"sign")} disabled={busy} onPress={()=>void decide("approve")}/></View>}
  </Sheet></Modal>
}

function CardApprovalModal({locale,review,controller,close,onReturned}:{locale:WalletLocale;review:CardApplicationApprovalReview;controller:CardApplicationApprovalController;close:()=>void;onReturned:()=>void}){
  const {request,account:selected}=review;
  const scope=useOperationScope(true,selected.account);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[returnReady,setReturnReady]=useState(()=>controller.hasReturn(review.id));
  const decide=async(action:"approve"|"reject"|"retryReturn")=>{
    if(busy||controller.current?.id!==review.id)return;
    let lease:WalletOperationLease;try{lease=scope.begin({account:selected.account,requireUnlocked:false})}catch{return}
    setBusy(true);setError(null);
    try{await controller[action](review.id);if(lease.ownsScope())onReturned()}
    catch(caught){if(lease.ownsScope()){setReturnReady(controller.hasReturn(review.id));setError(localizeError(locale,caught))}}
    finally{if(lease.ownsScope())setBusy(false);lease.finish()}
  };
  const dismiss=()=>{if(!busy){if(returnReady)close();else void decide("reject")}};
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={cardApprovalCopy(locale,"title")} close={dismiss}>
    <Text style={styles.authorizationLead}>{cardApprovalCopy(locale,"sandbox")}</Text>
    <ReviewRow label={translate(locale,"requestingApp")} value="YNX Card"/>
    <ReviewRow label={authorizationCopy(locale,"origin")} value={request.origin}/>
    <Text style={styles.scopeExplain}>{applicationActionCopy(locale,"unverifiedOrigin")}</Text>
    <ReviewRow label={translate(locale,"network")} value="YNX Testnet · 6423 · 0x1917"/>
    <ReviewRow label={translate(locale,"account")} value={selected.label+"\n"+selected.account}/>
    <ReviewRow label={cardApprovalCopy(locale,"application")} value={request.challenge.applicationId}/>
    <ReviewRow label={cardApprovalCopy(locale,"nickname")} value={request.details.nickname}/>
    <ReviewRow label={cardApprovalCopy(locale,"useCase")} value={request.details.useCase}/>
    <ReviewRow label={cardApprovalCopy(locale,"limit")} value={cardApprovalLimitYNXT(request.details.limitWei)+" YNXT\n"+request.details.limitWei+" wei"}/>
    <ReviewRow label={cardApprovalCopy(locale,"risk")} value={cardApprovalCopy(locale,"accepted")}/>
    <ReviewRow label={cardApprovalCopy(locale,"terms")} value={request.details.termsVersion}/>
    <ReviewRow label={translate(locale,"expires")} value={formatDateTime(locale,request.expiresAt)}/>
    <ReviewRow label={authorizationCopy(locale,"callback")} value={request.callback}/>
    {error?<><Text style={styles.error}>{error}</Text><RecoveryRequiredNotice error={error}/><SecondaryButton label={authorizationCopy(locale,"closeRequest")} disabled={busy} onPress={close}/></>:null}
    {returnReady?<Button label={authorizationCopy(locale,"retryReturn")} disabled={busy} onPress={()=>void decide("retryReturn")}/>:<View style={styles.approvalButtons}><SecondaryButton label={translate(locale,"reject")} disabled={busy} onPress={()=>void decide("reject")}/><Button label={cardApprovalCopy(locale,"approve")} disabled={busy} onPress={()=>void decide("approve")}/></View>}
  </Sheet></Modal>
}

function FinanceOrderApprovalModal({locale,review,controller,close,onReturned}:{locale:WalletLocale;review:FinanceOrderApprovalReview;controller:FinanceOrderApprovalController;close:()=>void;onReturned:()=>void}){
  const {request,account:selected}=review,approval=request.unsigned,order=approval.order;
  const scope=useOperationScope(true,selected.account);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[expired,setExpired]=useState(false),[returnReady,setReturnReady]=useState(()=>controller.hasReturn(review.id)),[revocable,setRevocable]=useState(()=>controller.canRevoke(review.id));
  useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>|undefined;const refresh=async()=>{try{const value=await controller.isExpired(review.id);if(active)setExpired(value)}catch(caught){if(active)setError(localizeError(locale,caught))}};void refresh();const delay=Math.max(0,Date.parse(approval.expiresAt)-Date.now())+50;timer=setTimeout(()=>void refresh(),Math.min(delay,2_147_483_647));return()=>{active=false;if(timer)clearTimeout(timer)}},[approval.expiresAt,controller,locale,review.id]);
  const decide=async(action:"approve"|"reject"|"retryReturn"|"revokeUnused")=>{
    if(busy||controller.current?.id!==review.id)return;
    let lease:WalletOperationLease;try{lease=scope.begin({account:selected.account,requireUnlocked:false})}catch{return}
    setBusy(true);setError(null);
    try{await controller[action](review.id);if(lease.ownsScope())onReturned()}
    catch(caught){if(lease.ownsScope()){setReturnReady(controller.hasReturn(review.id));setRevocable(controller.canRevoke(review.id));setError(localizeError(locale,caught))}}
    finally{if(lease.ownsScope())setBusy(false);lease.finish()}
  };
  const dismiss=()=>{if(!busy){if(returnReady)close();else void decide("reject")}};
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={financeOrderApprovalCopy(locale,"title")} close={dismiss}>
    <Text style={styles.authorizationLead}>{financeOrderApprovalCopy(locale,"boundary")}</Text>
    <ReviewRow label={financeOrderApprovalCopy(locale,"environment")} value="YNX Testnet · Broker Sandbox"/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"provider")} value="Alpaca Broker Sandbox"/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"source")} value={approval.origin+"\n"+approval.applicationId}/>
    <ReviewRow label={translate(locale,"account")} value={selected.label+"\n"+selected.account}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"subject")} value={approval.subjectId}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"broker")} value={approval.brokerAccountId}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"order")} value={order.orderId}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"asset")} value={order.symbol+"\n"+order.assetId}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"side")} value={order.side.toUpperCase()}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"quantity")} value={order.qty}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"price")} value={order.limitPrice+" USD"}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"limits")} value={order.maxCost+" USD / "+order.maxFee+" USD\n"+order.feeBoundSource}/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"session")} value="DAY · regular hours only"/>
    <ReviewRow label={financeOrderApprovalCopy(locale,"bindings")} value={`Chain: ${approval.chainId}\nAccount key: ${approval.accountPublicKey}\nRequest: ${approval.requestId}\nChallenge: ${approval.challengeId}\nNonce: ${approval.nonce}\nOrder hash: ${approval.orderHash}\nCallback state: ${approval.callbackStateHash}\nApproval digest: ${review.id}`}/>
    <ReviewRow label={translate(locale,"expires")} value={formatDateTime(locale,approval.expiresAt)}/>
    {expired?<Text style={styles.error}>{financeOrderApprovalCopy(locale,"expired")}</Text>:null}
    <Text style={styles.scopeExplain}>{financeOrderApprovalCopy(locale,"revokeBoundary")}</Text>
    {error?<><Text style={styles.error}>{error}</Text><RecoveryRequiredNotice error={error}/><SecondaryButton label={authorizationCopy(locale,"closeRequest")} disabled={busy} onPress={close}/></>:null}
    {expired?<SecondaryButton label={authorizationCopy(locale,"closeRequest")} disabled={busy} onPress={close}/>:returnReady?<View style={styles.approvalButtons}><SecondaryButton label={authorizationCopy(locale,"retryReturn")} disabled={busy} onPress={()=>void decide("retryReturn")}/>{revocable?<Button label={financeOrderApprovalCopy(locale,"revoke")} disabled={busy} onPress={()=>void decide("revokeUnused")}/>:null}</View>:<View style={styles.approvalButtons}><SecondaryButton label={translate(locale,"reject")} disabled={busy} onPress={()=>void decide("reject")}/><Button label={financeOrderApprovalCopy(locale,"approve")} disabled={busy} onPress={()=>void decide("approve")}/></View>}
  </Sheet></Modal>
}

function AuthorizationModal({locale,review,controller,close,onReturned}:{locale:WalletLocale;review:ProductSessionReview;controller:ProductSessionController;close:()=>void;onReturned:()=>void}){
  const {request,account:selected}=review;
  const scope=useOperationScope(true,selected.account);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[ai,setAI]=useState(false),[returnReady,setReturnReady]=useState(false);
  const decide=async(action:"approve"|"reject"|"retryReturn")=>{if(busy||controller.current?.id!==review.id)return;let lease:WalletOperationLease;try{lease=scope.begin({account:selected.account,requireUnlocked:false})}catch{return}setBusy(true);setError(null);try{await controller[action](review.id);if(lease.ownsScope())onReturned()}catch(caught){if(lease.ownsScope()){setReturnReady(controller.hasReturn(review.id));setError(localizeProductSessionError(locale,caught,action,controller.hasReturn(review.id)))}}finally{if(lease.ownsScope())setBusy(false);lease.finish()}};
  const dismiss=()=>{if(!busy){if(returnReady)close();else void decide("reject")}};
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={translate(locale,"signInTitle")} close={dismiss}><Text style={styles.authorizationLead}>{translate(locale,"authorizationLead")}</Text><ReviewRow label={translate(locale,"requestingApp")} value={request.productId}/><ReviewRow label={translate(locale,"appIdentity")} value={request.clientId+"\n"+request.applicationId+"\n"+request.platform}/><ReviewRow label={authorizationCopy(locale,"origin")} value={request.origin}/><ReviewRow label={authorizationCopy(locale,"callback")} value={request.callback}/><ReviewRow label={authorizationCopy(locale,"device")} value={request.deviceId}/><ReviewRow label={translate(locale,"network")} value={request.chainId+"\n"+authorizationCopy(locale,"evm")+": 6423"}/><ReviewRow label={translate(locale,"account")} value={selected.label+"\n"+selected.account}/><ReviewRow label={translate(locale,"permissions")} value={request.scopes.join("\n")}/><ReviewRow label={translate(locale,"purpose")} value={request.purpose}/><ReviewRow label={translate(locale,"expires")} value={formatDateTime(locale,request.expiresAt)}/>{request.serviceConsent?<Text selectable style={styles.sheetText}>{finiteServiceReview(locale,request)}</Text>:null}{request.scopes.map((scope)=><Text key={scope} style={styles.scopeExplain}>{scope}: {scopeExplanation(locale,scope)}</Text>)}<SecondaryButton label={translate(locale,"aiSecurity")} icon={<Sparkles color={ACTIVE_COLORS.blue}/>} disabled={busy||returnReady} onPress={()=>setAI(true)}/>{error?<><Text style={styles.error}>{needsOfflineKeyRecovery(error)?walletCopy(locale,"Key protection needs recovery"):error}</Text><RecoveryRequiredNotice error={error}/><SecondaryButton label={authorizationCopy(locale,"closeRequest")} disabled={busy} onPress={close}/></>:null}{returnReady?<Button label={authorizationCopy(locale,"retryReturn")} disabled={busy} onPress={()=>void decide("retryReturn")}/>:<View style={styles.approvalButtons}><SecondaryButton label={translate(locale,"reject")} disabled={busy} onPress={()=>void decide("reject")}/><Button label={translate(locale,"approve")} disabled={busy} onPress={()=>void decide("approve")}/></View>}<Text style={styles.footnote}>{translate(locale,"privacy")} {translate(locale,"aiCannotApprove")}</Text><AIReviewModal visible={ai} locale={locale} request={request} close={()=>setAI(false)}/></Sheet></Modal>
}

function AIReviewModal({visible,locale,request,close}:{visible:boolean;locale:WalletLocale;request:MobileProductSessionRequest;close:()=>void}){
  const [outputLocale,setOutputLocale]=useState<WalletLocale>(locale);
  const controller=useMemo(()=>new SecurityReviewController({nonce:request.nonce,chainId:request.chainId,requestingProduct:request.productId,productClientId:request.clientId,bundleId:request.applicationId,scopes:request.scopes,purpose:request.purpose,expiresAt:request.expiresAt},()=>new Date(),translate(outputLocale,"languageName")),[request,outputLocale]);const [snapshot,setSnapshot]=useState<ReviewSnapshot>(controller.snapshot());
  useEffect(()=>setSnapshot(controller.snapshot()),[controller]);
  const runtime=(globalThis as any).__YNX_WALLET_AI_RUNTIME__ as {baseURL?:string;productSessionToken?:string}|undefined;
  const provider=useMemo(()=>new GatewaySecurityReviewProvider(runtime?.baseURL??"",runtime?.productSessionToken??""),[runtime?.baseURL,runtime?.productSessionToken]);
  const update=(value:ReviewSnapshot)=>setSnapshot(value);
  const status=async()=>update(await controller.checkProvider(provider));const run=async()=>{const pending=controller.run(provider);update(controller.snapshot());update(await pending)};
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={close}><Sheet title="AI authorization review" close={close}><Text style={styles.sheetText}>Selected request: {request.productId} · {request.nonce}</Text><ReviewRow label={translate(locale,"aiOutputLanguage")} value={translate(outputLocale,"languageName")}/><SecondaryButton label={translate(outputLocale,"languageName")} onPress={()=>setOutputLocale(SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(outputLocale)+1)%SUPPORTED_LOCALES.length]!)}/><ReviewRow label="Data preview" value={snapshot.estimate.contextClasses.join(", ")}/><ReviewRow label="Provider / model" value={snapshot.provider?`${snapshot.provider.provider??"Unavailable"} / ${snapshot.provider.model??"Unavailable"}`:"Not checked"}/><ReviewRow label="Estimate" value={`${snapshot.estimate.resourceUnits} resource units · max ${snapshot.estimate.maximumMonetaryCostYNXT} YNXT`}/><ReviewRow label="State" value={snapshot.phase}/>{snapshot.output?<Text style={styles.aiOutput}>{snapshot.output}</Text>:null}{snapshot.error?<Text style={styles.error}>{snapshot.error}</Text>:null}{snapshot.phase==="selected"?<Button label="Preview selected request" onPress={()=>update(controller.preview())}/>:snapshot.phase==="preview"?<Button label="Check provider and model" onPress={()=>void status()}/>:snapshot.phase==="permission"&&!snapshot.allowed?<Button label="Allow this bounded AI review" onPress={()=>update(controller.allow())}/>:snapshot.phase==="permission"&&snapshot.allowed?<Button label="Start streaming review" onPress={()=>void run()}/>:snapshot.phase==="streaming"?<DangerButton label="Cancel stream" onPress={()=>controller.cancel()}/>:snapshot.phase==="review"?<><Button label="Apply advisory summary" onPress={()=>update(controller.apply())}/><SecondaryButton label="Reject AI result" onPress={()=>update(controller.reject())}/></>:(["failed","unavailable","cancelled"].includes(snapshot.phase))?<Button label={translate(locale,"retry")} onPress={()=>update(controller.retry())}/>:null}<Text style={styles.footnote}>Audit entries: {snapshot.audits.length}. Only request metadata is eligible. Private keys, recovery material and signing are structurally outside this provider interface.</Text></Sheet></Modal>
}

function LocaleSettings({visible,locale,close,select,uiSize,appearanceBusy,selectSize}:{visible:boolean;locale:WalletLocale;close:()=>void;select:(locale:WalletLocale)=>void;uiSize:UISize;appearanceBusy:boolean;selectSize:(size:UISize)=>void}){const copy=appearanceCopy(locale);const summary=walletAccessibilitySummary(locale,ACCESSIBILITY_SUMMARY);return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={close}><Sheet title={translate(locale,"settingsTitle")} close={close}><Text accessibilityLabel={`${walletCopy(locale,"Accessibility state")}: ${summary}`} style={styles.sheetText}>{walletCopy(locale,"System language is detected on first launch. A manual choice is stored locally and survives restart.")}{"\n"}{summary}. {walletCopy(locale,"Text follows the device font scale.")}</Text><Text style={[styles.infoTitle,styles.sectionLabel]}>{copy.title}</Text><Text style={styles.sheetText}>{copy.hint}</Text>{UI_SIZES.map(size=><Pressable key={size} accessibilityRole="radio" accessibilityState={{checked:size===uiSize,disabled:appearanceBusy}} accessibilityLabel={copy[size]} disabled={appearanceBusy} onPress={()=>selectSize(size)} style={styles.localeRow}><Text style={[styles.infoTitle,{flex:1,flexShrink:1}]}>{copy[size]}</Text>{size===uiSize?<Check color={ACTIVE_COLORS.blue}/>:null}</Pressable>)}{SUPPORTED_LOCALES.map((item)=><Pressable accessibilityRole="radio" accessibilityState={{checked:item===locale}} accessibilityLabel={translate(item,"languageName")} key={item} onPress={()=>select(item)} style={styles.localeRow}><Text style={styles.infoTitle}>{translate(item,"languageName")}</Text>{item===locale?<Check color={ACTIVE_COLORS.blue}/>:null}</Pressable>)}</Sheet></Modal>}

function RecoveryRequiredNotice({error}:{error:string|null|undefined}){
  const locale=useContext(WalletLocaleContext),recover=useContext(WalletRecoveryContext);
  if(!error||!needsOfflineKeyRecovery(error))return null;
  return <><InfoCard title={walletCopy(locale,"Key protection needs recovery")} body={walletCopy(locale,"Your public account is still stored. Restore its protected key with the matching offline recovery key. App sessions are not restored or revoked by this action.")}/><SecondaryButton label={walletCopy(locale,"Open account recovery")} onPress={recover}/></>;
}

function Screen({children}:{children:React.ReactNode}){return <ScrollView style={{flex:1}} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">{children}</ScrollView>}
function Sheet({title,close,children,actions}:{title:string;close:()=>void;children:React.ReactNode;actions?:React.ReactNode}){
  const locale=useContext(WalletLocaleContext);
  const scroll=useRef<ScrollView>(null),focused=useRef<number|null>(null);
  const revealFocused=useCallback(()=>{
    if(Keyboard.isVisible()&&focused.current!==null)scroll.current?.scrollResponderScrollNativeHandleToKeyboard(focused.current,16,true);
  },[]);
  useEffect(()=>{
    // Focus can arrive before the keyboard or the resized Modal viewport. Recheck
    // the same focused field on the actual keyboard/layout events, without timers.
    const shown=Keyboard.addListener("keyboardDidShow",revealFocused);
    return()=>{shown.remove();focused.current=null};
  },[revealFocused]);
  return <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS==="ios"?"padding":"height"} onLayout={revealFocused}>
    <SafeAreaView edges={["bottom","left","right"]} style={styles.sheetFrame}>
      <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${translate(locale,"close")} ${title}`} onPress={close} style={styles.iconButton}><X color={ACTIVE_COLORS.ink}/></Pressable></View>
      <ScrollView ref={scroll} style={styles.sheetViewport} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==="ios"?"interactive":"on-drag"}
        onFocus={event=>{focused.current=event.nativeEvent.target;revealFocused()}} onBlur={event=>{if(focused.current===event.nativeEvent.target)focused.current=null}}>
        {children}
      </ScrollView>
      {actions?<View style={styles.sheetActions}>{actions}</View>:null}
    </SafeAreaView>
  </KeyboardAvoidingView>
}
function Button({label,onPress,disabled=false,icon}:{label:string;onPress:()=>void;disabled?:boolean;icon?:React.ReactNode}){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,pressed&&styles.pressed,disabled&&styles.disabled]}>{icon}<Text style={styles.buttonText}>{label}</Text></Pressable>}
function SecondaryButton({label,onPress,disabled=false,icon}:{label:string;onPress:()=>void;disabled?:boolean;icon?:React.ReactNode}){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.secondaryButton,pressed&&styles.pressed,disabled&&styles.disabled]}>{icon}<Text style={styles.secondaryText}>{label}</Text></Pressable>}
function DangerButton({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[styles.dangerButton,disabled&&styles.disabled]}><Trash2 color={ACTIVE_COLORS.danger} size={18}/><Text style={styles.dangerText}>{label}</Text></Pressable>}
function Quick({icon,label,onPress,disabled=false}:{icon:React.ReactNode;label:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[styles.quick,disabled&&styles.disabled]}><View style={styles.quickIcon}>{icon}</View><Text style={styles.quickText}>{label}</Text></Pressable>}
function Field({label,value,onChangeText,secure=false,multiline=false}:{label:string;value:string;onChangeText:(v:string)=>void;secure?:boolean;multiline?:boolean}){const effectiveMultiline=multiline&&!secure;return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} secureTextEntry={secure} multiline={effectiveMultiline} autoCapitalize="none" autoCorrect={false} style={[styles.input,effectiveMultiline&&styles.multiline]}/></View>}
function InfoCard({title,body}:{title:string;body:string}){return <View style={styles.info}><ShieldCheck color={ACTIVE_COLORS.blue}/><View style={styles.infoCopy}><Text style={styles.infoTitle}>{title}</Text><Text style={styles.infoBody}>{body}</Text></View></View>}
function ReviewRow({label,value}:{label:string;value:string}){return <View style={styles.reviewRow}><Text style={styles.reviewLabel}>{label}</Text><Text selectable style={styles.reviewValue}>{value}</Text></View>}
function short(value:string){return `${value.slice(0,11)}…${value.slice(-8)}`}
function message(value:unknown){return value instanceof Error?value.message:String(value)}

function createStyles(scale=1){const base=StyleSheet.create({
  brandLogo:{flexShrink:0,width:41.8,height:22},
  safe:{flex:1,backgroundColor:ACTIVE_COLORS.white},rtl:{direction:"rtl"},header:{minHeight:66,paddingVertical:10,paddingHorizontal:20,flexDirection:"row",alignItems:"center",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line,gap:12},headerBrand:{flex:1,minWidth:0,flexShrink:1},headerActions:{flexShrink:0,flexDirection:"row",gap:8},mark:{flexShrink:0,width:44,height:44,borderRadius:10,backgroundColor:ACTIVE_COLORS.white,alignItems:"center",justifyContent:"center"},markText:{color:ACTIVE_COLORS.white,fontWeight:"800",fontSize:20},brand:{color:ACTIVE_COLORS.ink,fontSize:17,fontWeight:"700"},network:{color:ACTIVE_COLORS.muted,fontSize:10,fontWeight:"700",letterSpacing:.7,marginTop:2},iconButton:{flexShrink:0,width:44,height:44,alignItems:"center",justifyContent:"center",borderRadius:12,backgroundColor:ACTIVE_COLORS.surface},notice:{margin:12,marginBottom:0,padding:13,borderRadius:10,backgroundColor:"#EEF3FF",flexDirection:"row",alignItems:"center",gap:10},noticeText:{flex:1,color:ACTIVE_COLORS.blue,fontSize:12,lineHeight:17},bannerError:{margin:12,marginBottom:0,padding:13,borderRadius:10,backgroundColor:"#FEF3F2",flexDirection:"row",gap:10},screen:{flexGrow:1,paddingHorizontal:24,paddingVertical:24,alignItems:"center",justifyContent:"center"},heroIcon:{width:76,height:76,borderRadius:24,backgroundColor:"#EEF3FF",alignItems:"center",justifyContent:"center",marginBottom:24},eyebrow:{color:ACTIVE_COLORS.blue,fontSize:11,fontWeight:"800",letterSpacing:1.1},sectionLabel:{marginTop:30},title:{color:ACTIVE_COLORS.ink,fontSize:22,fontWeight:"700",letterSpacing:-.4,marginTop:8,textAlign:"center"},centerText:{color:ACTIVE_COLORS.muted,fontSize:15,lineHeight:23,textAlign:"center",maxWidth:410,marginTop:14},muted:{color:ACTIVE_COLORS.muted,marginTop:12},footnote:{color:ACTIVE_COLORS.muted,fontSize:12,lineHeight:18,textAlign:"center",marginTop:18},address:{color:ACTIVE_COLORS.muted,fontSize:13,marginTop:5},button:{width:"100%",maxWidth:420,minHeight:50,borderRadius:12,backgroundColor:ACTIVE_COLORS.blue,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9,paddingHorizontal:20,paddingVertical:14,marginTop:18},buttonText:{color:ACTIVE_COLORS.white,fontSize:15,fontWeight:"700",flexShrink:1,textAlign:"center"},secondaryButton:{width:"100%",maxWidth:420,minHeight:48,borderRadius:12,borderWidth:1,borderColor:ACTIVE_COLORS.line,backgroundColor:ACTIVE_COLORS.white,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9,paddingHorizontal:18,paddingVertical:13,marginTop:12},secondaryText:{color:ACTIVE_COLORS.ink,fontSize:14,fontWeight:"600",flexShrink:1,textAlign:"center"},dangerButton:{width:"100%",minHeight:48,borderRadius:12,borderWidth:1,borderColor:"#FECDCA",alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9,paddingHorizontal:18,paddingVertical:12,marginTop:12},dangerText:{color:ACTIVE_COLORS.danger,fontWeight:"600",flexShrink:1,textAlign:"center"},pressed:{opacity:.72},disabled:{opacity:.38},info:{width:"100%",maxWidth:420,marginTop:22,padding:16,borderRadius:14,backgroundColor:ACTIVE_COLORS.surface,flexDirection:"row",gap:12},infoCopy:{flex:1},infoTitle:{color:ACTIVE_COLORS.ink,fontWeight:"700",fontSize:14},infoBody:{color:ACTIVE_COLORS.muted,fontSize:14,lineHeight:21,marginTop:5},error:{color:ACTIVE_COLORS.danger,fontSize:13,lineHeight:19,marginTop:12},dashboard:{padding:24,paddingBottom:48},accountPicker:{minHeight:62,flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:8},accountLabel:{color:ACTIVE_COLORS.ink,fontSize:18,fontWeight:"700"},accountMenu:{borderWidth:1,borderColor:ACTIVE_COLORS.line,borderRadius:14,overflow:"hidden",marginBottom:16},accountRow:{minHeight:64,paddingHorizontal:16,flexDirection:"row",alignItems:"center",gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},smallAddress:{color:ACTIVE_COLORS.muted,fontSize:11,marginTop:3},link:{color:ACTIVE_COLORS.blue,fontWeight:"600"},balanceCard:{backgroundColor:ACTIVE_COLORS.blue,borderRadius:20,padding:24,marginTop:18},balanceLabel:{color:ACTIVE_COLORS.white,fontSize:12},balance:{color:ACTIVE_COLORS.white,fontSize:30,fontWeight:"700",marginTop:12},balanceMeta:{color:ACTIVE_COLORS.white,fontSize:11,lineHeight:17,marginTop:10},quickRow:{flexDirection:"row",justifyContent:"space-around",marginTop:22},quick:{alignItems:"center",flex:1,minWidth:0,paddingHorizontal:4},quickIcon:{width:50,height:50,borderRadius:16,backgroundColor:"#EEF3FF",alignItems:"center",justifyContent:"center"},quickText:{color:ACTIVE_COLORS.ink,fontSize:13,fontWeight:"600",marginTop:8,textAlign:"center",flexShrink:1},backdrop:{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(0,47,167,.12)"},sheetFrame:{height:"92%",backgroundColor:ACTIVE_COLORS.white,borderTopLeftRadius:24,borderTopRightRadius:24,overflow:"hidden"},sheetViewport:{flex:1,minHeight:0,backgroundColor:ACTIVE_COLORS.white},sheet:{paddingHorizontal:22,paddingBottom:24},sheetHeader:{flexShrink:0,flexDirection:"row",alignItems:"center",minHeight:48,paddingHorizontal:22,paddingTop:18,paddingBottom:12,gap:12},sheetActions:{flexShrink:0,paddingHorizontal:22,paddingBottom:16,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:ACTIVE_COLORS.line,alignItems:"center"},sheetTitle:{color:ACTIVE_COLORS.ink,fontSize:22,fontWeight:"700",flex:1},sheetText:{color:ACTIVE_COLORS.muted,fontSize:14,lineHeight:21,marginTop:14},localeRow:{minHeight:52,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},auditRow:{paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},field:{marginTop:18},fieldLabel:{color:ACTIVE_COLORS.ink,fontSize:12,fontWeight:"600",marginBottom:7},input:{minHeight:50,paddingVertical:12,borderWidth:1,borderColor:ACTIVE_COLORS.line,borderRadius:12,paddingHorizontal:14,color:ACTIVE_COLORS.ink,fontSize:15},multiline:{minHeight:96,textAlignVertical:"top",paddingTop:14},recoveryKey:{fontFamily:Platform.select({ios:"Menlo",android:"monospace"}),fontSize:13,lineHeight:21,color:ACTIVE_COLORS.ink,backgroundColor:ACTIVE_COLORS.surface,padding:16,borderRadius:12,marginTop:18},qr:{alignItems:"center",padding:20,marginTop:18},fullAddress:{fontSize:12,lineHeight:18,color:ACTIVE_COLORS.ink,textAlign:"center"},authorizationLead:{color:ACTIVE_COLORS.muted,fontSize:13,lineHeight:19,marginVertical:12},reviewRow:{paddingVertical:11,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line,flexDirection:"row",gap:14},reviewLabel:{color:ACTIVE_COLORS.muted,fontSize:14,maxWidth:"40%",flexShrink:1,width:105},reviewValue:{color:ACTIVE_COLORS.ink,fontSize:14,lineHeight:21,flex:1,textAlign:"right"},scopeExplain:{color:ACTIVE_COLORS.muted,fontSize:11,lineHeight:17,marginTop:8},approvalButtons:{width:"100%"},aiOutput:{color:ACTIVE_COLORS.ink,fontSize:14,lineHeight:21,backgroundColor:ACTIVE_COLORS.surface,padding:14,borderRadius:12,marginTop:14},controlStatus:{marginTop:14,paddingVertical:14,flexDirection:"row",alignItems:"flex-start",gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},statusDot:{width:10,height:10,borderRadius:5,marginTop:4},nativeList:{borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},nativeListHeader:{minHeight:64,paddingVertical:12,flexDirection:"row",alignItems:"center",gap:10},riskInspector:{paddingBottom:12},missingList:{paddingVertical:16}
});return StyleSheet.create(Object.fromEntries(Object.entries(base).map(([name,rule])=>[name,{...rule,...("fontSize" in rule?{fontSize:rule.fontSize*scale}:{}),...("lineHeight" in rule?{lineHeight:rule.lineHeight*scale}:{})}]))) as typeof base;}
