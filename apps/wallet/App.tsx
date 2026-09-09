import { createContext, useContext, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { getRandomBytesAsync } from "expo-crypto";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";
import { StatusBar } from "expo-status-bar";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ArrowUpRight, Check, ChevronDown, Copy, Fingerprint, History, KeyRound, Languages, Lock, Plus, QrCode, ShieldCheck, Sparkles, Trash2, X } from "lucide-react-native";
import QRCodeView from "react-native-qrcode-svg";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  createSignedNativeTransfer, evmAddressFromYNX, walletIdentity, ynxAddressFromEVM,
} from "@ynx-chain/wallet-auth";
import { GatewaySecurityReviewProvider, SecurityReviewController, type ReviewSnapshot } from "./src/ai/securityReview";
import { NativeChainClient, loadNativeChainState, type NativeChainState } from "./src/chain/nativeTransfer";
import { NativeTransferOutbox, type NativeTransferOutboxEntry } from "./src/chain/nativeTransferOutbox";
import { createPaymentURI, PaymentRequestError } from "./src/chain/paymentRequest";
import { PaymentRecipientInput, type PaymentRecipientInputAttempt } from "./src/state/paymentRecipientInput";
import { FaucetFlow, faucetStatusCopy, productionFaucetConfiguration, type FaucetAction } from "./src/state/faucetFlow";
import { EvmSimulationClient, type EvmSimulationResult } from "./src/chain/evmSimulation";
import { buildWalletControlView, type CapitalReview } from "./src/control/controlSurface";
import { controlCopy } from "./src/control/controlCopy";
import { formatDateTime, formatYNXT, isRTL, loadLocale, localizeError, localizeProductSessionError, saveLocale, SUPPORTED_LOCALES, translate, walletAccessibilitySummary, walletCopy, walletDetailError, type WalletLocale } from "./src/i18n/i18n";
import { AuthorizationAuditStore, type AuthorizationAuditRecord } from "./src/protocol/authorizationAudit";
import { ProductSessionController, type ProductSessionReview, type MobileProductSessionRequest } from "./src/protocol/productSessionController";
import { scopeExplanation } from "./src/i18n/scopeCopy";
import { WalletSessionInventoryClient, WalletSessionRevocationUnknown, type SessionInventoryItem, type WalletSessionInventory } from "./src/protocol/sessionInventory";
import { assertStrongBiometrics, authorizeLocalKeyUse } from "./src/security/localAuthorization";
import { createProductSessionKeyAccess } from "./src/security/productSessionKeyAccess";
import { CorruptWalletResetController } from "./src/security/corruptWalletReset";
import { RECOVERY_DISPLAY_MS, WalletOperationLifecycle, type WalletOperationLease } from "./src/security/operationLifecycle";
import { copyPublicValueWithExpiry } from "./src/security/clipboardPrivacy";
import { initialLockState, reduceLockState } from "./src/state/lockState";
import { needsOfflineKeyRecovery, reviewRecoveryKey } from "./src/state/recoveryReview";
import { assertSecureStorageAvailable, platformSecureStorage, platformStorageHealth } from "./src/storage/secureStorage";
import { type WalletAccount, type WalletManifest, WalletRepository } from "./src/storage/walletRepository";
import { COLORS, HIGH_CONTRAST_LIGHT } from "./src/theme";

let ACTIVE_COLORS=COLORS;
let styles=createStyles();
let MODAL_ANIMATION:"none"|"slide"="slide";
let ACCESSIBILITY_SUMMARY="System contrast · standard motion · Klein blue and white appearance";

const WalletOperationsContext=createContext<WalletOperationLifecycle|null>(null);
const WalletLocaleContext=createContext<WalletLocale>("en");
const WalletRecoveryContext=createContext<()=>void>(()=>{});
const EMPTY_WALLET_ACCOUNTS:readonly WalletAccount[]=[];
function useWalletOperations(){const value=useContext(WalletOperationsContext);if(!value)throw new Error("Wallet operation lifecycle is unavailable");return value}
function useOperationScope(visible=true,account?:string){const operations=useWalletOperations(),scope=useMemo(()=>operations.scope(),[operations]);useEffect(()=>operations.subscribe(()=>scope.cancel()),[operations,scope]);useEffect(()=>{if(!visible)scope.cancel();return()=>scope.cancel()},[scope,visible,account]);return scope}
const repository=new WalletRepository(platformSecureStorage);
const nativeOutbox=new NativeTransferOutbox(platformSecureStorage);
const authorizationAudit=new AuthorizationAuditStore(platformSecureStorage);
function chainClient(){const runtime=(globalThis as any).__YNX_WALLET_CHAIN_RUNTIME__ as {baseURL?:string;evmRpcURL?:string}|undefined;return new NativeChainClient(runtime?.baseURL)}
function evmSimulationClient(){const runtime=(globalThis as any).__YNX_WALLET_CHAIN_RUNTIME__ as {baseURL?:string;evmRpcURL?:string}|undefined;return new EvmSimulationClient(runtime?.evmRpcURL??runtime?.baseURL)}
function walletSessionInventoryClient(){return new WalletSessionInventoryClient({fetch:(input,init)=>fetch(input,init),randomBytes:getRandomBytesAsync,authorize:authorizeLocalKeyUse,accountSecret:(account,assertCurrent)=>repository.accountSecret(account,assertCurrent,{allowLegacyMigration:true})})}

export default function App(){return <SafeAreaProvider><WalletApp/></SafeAreaProvider>}

function WalletApp(){
  const [reducedMotion,setReducedMotion]=useState(false);
  const [highContrast,setHighContrast]=useState(false);
  ACTIVE_COLORS=highContrast?HIGH_CONTRAST_LIGHT:COLORS;
  styles=createStyles();
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
  const [authorizationError,setAuthorizationError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [locale,setLocale]=useState<WalletLocale>("en");
  const [settings,setSettings]=useState(false);
  const [privacyAttempt,setPrivacyAttempt]=useState(0);
  const [privacyState,setPrivacyState]=useState<{ready:boolean;error:string|null}>({ready:false,error:null});
  const selected=useMemo(()=>manifest?.accounts.find((item)=>item.account===manifest.selectedAccountId)??null,[manifest]);
  const selectedRef=useRef<WalletAccount|null>(null);selectedRef.current=selected;
  const operations=useMemo(()=>new WalletOperationLifecycle(),[]),rootScope=useMemo(()=>operations.scope(),[operations]);
  const corruptReset=useMemo(()=>new CorruptWalletResetController(repository,operations,()=>authorizeLocalKeyUse("wallet-reset")),[operations]);
  const loadRevision=useRef(0);
  useEffect(()=>operations.subscribe(()=>rootScope.cancel()),[operations,rootScope]);
  useEffect(()=>{const unsubscribe=operations.subscribe(()=>corruptReset.cancel());return()=>{unsubscribe();corruptReset.cancel()}},[operations,corruptReset]);
  const readyRef=useRef(false);readyRef.current=!loading&&manifest!==null&&!storageRestartRequired&&!platformStorageHealth.requiresRestart&&AppState.currentState==="active";
  const queuedLink=useRef<string|null>(null),initialLinkRead=useRef(false);
  const productSessions=useMemo(()=>new ProductSessionController({platform:Platform.OS==="ios"?"ios":"android",storage:platformSecureStorage,selectedAccount:()=>selectedRef.current,withAccountSecret:createProductSessionKeyAccess({operations,repository,checkBiometrics:assertStrongBiometrics,authorizeLegacyMigration:()=>authorizeLocalKeyUse("wallet-authorization")}),openURL:(url)=>Linking.openURL(url),audit:(review,action,at)=>authorizationAudit.appendProductSession(review,{action,account:review.account.account,at:at.toISOString()})}),[operations]);
  const cancelAuthorization=useCallback(()=>{productSessions.cancel();setAuthorization(null)},[productSessions]);
  const lock=()=>{operations.lock();rootScope.cancel();cancelAuthorization();setPendingRecovery(null);setSetup("closed");setBusy(false);dispatchLock({type:"lock",reason:"user"})};
  const updateManifest=useCallback((next:WalletManifest)=>{operations.invalidate();operations.setAccount(next.selectedAccountId);selectedRef.current=next.accounts.find(item=>item.account===next.selectedAccountId)??null;cancelAuthorization();setManifest(next)},[operations,cancelAuthorization]);

  useEffect(()=>platformStorageHealth.subscribe(()=>{
    // Cancel scopes immediately, before React renders the restart page. Keep
    // the durable account/outbox records; an interrupted send can be unknown.
    ++loadRevision.current;readyRef.current=false;queuedLink.current=null;
    operations.lock();rootScope.cancel();corruptReset.cancel();cancelAuthorization();
    setPendingRecovery(null);setSetup("closed");setSettings(false);setBusy(false);
    setNotice(null);setLoading(false);setStorageRestartRequired(true);
    dispatchLock({type:"lock",reason:"user"});
  }),[operations,rootScope,corruptReset,cancelAuthorization]);

  const load=useCallback(async()=>{
    if(platformStorageHealth.requiresRestart)return false;
    const revision=++loadRevision.current,generation=operations.capture();readyRef.current=false;setLoading(true);setError(null);
    try{await assertSecureStorageAvailable();if(revision!==loadRevision.current||generation!==operations.capture())return false;const [result,savedLocale]=await Promise.all([repository.load(),loadLocale(platformSecureStorage)]);if(revision!==loadRevision.current||generation!==operations.capture()||platformStorageHealth.requiresRestart)return false;setLocale(savedLocale);updateManifest(result.manifest);return true;}
    catch(caught){if(revision===loadRevision.current&&generation===operations.capture())setError(localizeError(locale,caught));}
    finally{if(revision===loadRevision.current)setLoading(false)}
    return false;
  },[locale,updateManifest,operations]);

  const loadHandler=useRef(load);loadHandler.current=load;
  const handleLink=useCallback((url:string)=>{
    if(platformStorageHealth.requiresRestart)return;
    if(!readyRef.current||AppState.currentState!=="active"){queuedLink.current=url;return}
    void productSessions.receive(url).then((review)=>{if(productSessions.current?.id===review.id){setAuthorization(review);setAuthorizationError(null)}}).catch((caught)=>{setAuthorization(productSessions.current);setAuthorizationError(localizeError(locale,caught))});
  },[locale,productSessions]);

  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!initialLinkRead.current){initialLinkRead.current=true;void Linking.getInitialURL().then((url)=>{if(url)handleLink(url)})}const sub=Linking.addEventListener("url",({url})=>handleLink(url));return()=>sub.remove()},[handleLink]);
  useEffect(()=>{if(!storageRestartRequired&&!loading&&manifest&&queuedLink.current){const url=queuedLink.current;queuedLink.current=null;handleLink(url)}},[storageRestartRequired,loading,manifest,handleLink]);
  useEffect(()=>{operations.setAppState(AppState.currentState);let reloadOnActive=AppState.currentState==="background";const sub=AppState.addEventListener("change",(next)=>{operations.setAppState(next);if(next==="background"){reloadOnActive=true;rootScope.cancel();dispatchLock({type:"lock",reason:"background"});cancelAuthorization();setPendingRecovery(null);setSetup("closed");setBusy(false)}else if(next==="active"&&reloadOnActive){reloadOnActive=false;void loadHandler.current()}});return()=>{operations.lock();rootScope.cancel();sub.remove()}},[cancelAuthorization,operations,rootScope]);
  useEffect(()=>{if(!pendingRecovery)return;const timer=setTimeout(()=>{rootScope.cancel();operations.invalidate();setPendingRecovery(null);setSetup("closed");setBusy(false);setNotice("Recovery display expired. Generate a new account if it was not saved.")},RECOVERY_DISPLAY_MS);return()=>clearTimeout(timer)},[pendingRecovery,operations,rootScope]);
  useEffect(()=>{void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);void AccessibilityInfo.isHighTextContrastEnabled().then(setHighContrast);const sub=AccessibilityInfo.addEventListener("reduceMotionChanged",setReducedMotion);return()=>sub.remove()},[]);
  useEffect(()=>{let active=true;setPrivacyState({ready:false,error:null});void preventScreenCaptureAsync("wallet-runtime").then(()=>{if(active)setPrivacyState({ready:true,error:null})}).catch((caught)=>{if(active){operations.lock();dispatchLock({type:"lock",reason:"user"});setPrivacyState({ready:false,error:`Wallet privacy protection failed: ${message(caught)}`})}});return()=>{active=false;void allowScreenCaptureAsync("wallet-runtime")}},[privacyAttempt,operations]);

  const unlock=async()=>{
    if(!selected)return;let lease:WalletOperationLease|undefined;setBusy(true);setError(null);
    try{lease=rootScope.begin({account:selected.account,requireUnlocked:false});await lease.step(()=>authorizeLocalKeyUse("unlock"));operations.unlock(lease);dispatchLock({type:"unlock",account:selected.account});}
    catch(caught){if(!lease||lease.ownsScope())setError(localizeError(locale,caught))}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}
  };
  const create=async()=>{let lease:WalletOperationLease|undefined,bytes:Uint8Array|undefined;try{lease=rootScope.begin({requireUnlocked:false});bytes=await getRandomBytesAsync(32);lease.assert();setPendingRecovery({secretHex:bytesToHex(bytes),label:`Account ${(manifest?.accounts.length??0)+1}`});setSetup("create")}catch(caught){if(!lease||lease.ownsScope())setError(localizeError(locale,caught))}finally{bytes?.fill(0);lease?.finish()}};
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

  return <WalletOperationsContext.Provider value={operations}><WalletLocaleContext.Provider value={locale}><WalletRecoveryContext.Provider value={()=>{lock();setError(null);setSetup("recover")}}><SafeAreaView edges={["top","left","right"]} style={[styles.safe,isRTL(locale)&&styles.rtl]}>
    <StatusBar style="dark"/>
    <View style={styles.header}><View style={styles.mark}><Text style={styles.markText}>Y</Text></View><View style={styles.headerBrand}><Text style={styles.brand}>YNX Wallet</Text><Text style={styles.network}>YNX TESTNET · ynx_6423-1</Text></View><View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel={translate(locale,"settingsTitle")} onPress={()=>setSettings(true)} style={styles.iconButton}><Languages size={19} color={ACTIVE_COLORS.ink}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={translate(locale,"lockWallet")} onPress={lock} style={styles.iconButton}><Lock size={19} color={ACTIVE_COLORS.ink}/></Pressable></View></View>
    {error&&manifest?<><Text style={styles.error}>{error}</Text><RecoveryRequiredNotice error={error}/></>:null}
    {notice?<Pressable accessibilityLabel="Dismiss Wallet notice" onPress={()=>setNotice(null)} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><X size={16} color={ACTIVE_COLORS.blue}/></Pressable>:null}
    {authorizationError?<View style={styles.bannerError}><Text style={styles.error}>{authorizationError}</Text><Pressable accessibilityLabel="Dismiss invalid authorization" onPress={()=>setAuthorizationError(null)}><X size={17} color={ACTIVE_COLORS.danger}/></Pressable></View>:null}
    <RecoveryRequiredNotice error={authorizationError}/>
    {!manifest?.accounts.length?<EmptyWallet locale={locale} create={()=>void create()} importAccount={()=>setSetup("import")} recover={()=>setSetup("recover")}/>:lockState.locked?<Locked locale={locale} account={selected!} busy={busy} unlock={()=>void unlock()} recovery={()=>setSetup("recover")}/>:<Dashboard key={selected!.account} locale={locale} manifest={manifest} selected={selected!} select={(account)=>void select(account)} add={()=>setSetup("import")} create={()=>void create()} lock={lock} onManifest={updateManifest} onMutationError={(text)=>void recoverAfterMutation(text)}/>}
    {!manifest?.accounts.length?<SecondaryButton label="Restore previous Wallet identity" disabled={busy} onPress={()=>void restoreLegacy()}/>:null}
    <SetupModal mode={setup} accounts={manifest?.accounts??EMPTY_WALLET_ACCOUNTS} pending={pendingRecovery} close={()=>{setSetup("closed");setPendingRecovery(null);setBusy(false)}} saved={saved} busy={busy} setBusy={setBusy} setError={(value)=>{if(value)void recoverAfterMutation(value)}}/>
    {authorization&&manifest&&selected?<AuthorizationModal locale={locale} key={authorization.id} review={authorization} controller={productSessions} close={cancelAuthorization} onReturned={()=>setAuthorization(null)}/>:null}
    <LocaleSettings visible={settings} locale={locale} close={()=>setSettings(false)} select={(next)=>void saveLocale(platformSecureStorage,next).then(()=>{if(!platformStorageHealth.requiresRestart)setLocale(next)}).catch(caught=>{if(!platformStorageHealth.requiresRestart)setError(localizeError(locale,caught))})}/>
  </SafeAreaView></WalletRecoveryContext.Provider></WalletLocaleContext.Provider></WalletOperationsContext.Provider>;
}

function EmptyWallet({locale,create,importAccount,recover}:{locale:WalletLocale;create:()=>void;importAccount:()=>void;recover:()=>void}){return <Screen><View style={styles.heroIcon}><KeyRound color={ACTIVE_COLORS.blue} size={34}/></View><Text style={styles.eyebrow}>{translate(locale,"welcome")}</Text><Text style={styles.title}>{translate(locale,"ownAccount")}</Text><Text style={styles.centerText}>{translate(locale,"privacy")}</Text><Button label={translate(locale,"createWallet")} onPress={create}/><SecondaryButton label={translate(locale,"importWallet")} onPress={importAccount}/><SecondaryButton label={translate(locale,"recoverReplacement")} onPress={recover}/><InfoCard title={translate(locale,"beforeBegin")} body={translate(locale,"recovery")}/></Screen>}

function Locked({locale,account,busy,unlock,recovery}:{locale:WalletLocale;account:WalletAccount;busy:boolean;unlock:()=>void;recovery:()=>void}){return <Screen><View style={styles.heroIcon}><Lock color={ACTIVE_COLORS.blue} size={32}/></View><Text style={styles.eyebrow}>{translate(locale,"walletLocked")}</Text><Text style={styles.title}>{account.label}</Text><Text style={styles.address}>{short(account.account)}</Text><Button label={busy?translate(locale,"checkingBiometrics"):translate(locale,"unlock")} disabled={busy} onPress={unlock} icon={<Fingerprint color={ACTIVE_COLORS.white} size={19}/>}/><SecondaryButton label={translate(locale,"lostDeviceRecovery")} onPress={recovery}/><Text style={styles.footnote}>{translate(locale,"recovery")}</Text></Screen>}

function Dashboard({locale,manifest,selected,select,add,create,lock,onManifest,onMutationError}:{locale:WalletLocale;manifest:WalletManifest;selected:WalletAccount;select:(v:string)=>void;add:()=>void;create:()=>void;lock:()=>void;onManifest:(v:WalletManifest)=>void;onMutationError:(text:string)=>void}){
  const [faucet,setFaucet]=useState(false);
  const [accountsOpen,setAccountsOpen]=useState(false),[copied,setCopied]=useState(false),[qr,setQR]=useState(false),[send,setSend]=useState(false),[evm,setEvm]=useState(false),[center,setCenter]=useState(false),[controls,setControls]=useState(false),[remove,setRemove]=useState(false),[rename,setRename]=useState(false),[recovery,setRecovery]=useState(false),[auditOpen,setAuditOpen]=useState(false),[records,setRecords]=useState<readonly AuthorizationAuditRecord[]>([]),[auditError,setAuditError]=useState<string|null>(null);
  const cancelClipboardClear=useRef<null|(()=>void)>(null);
  const [chainState,setChainState]=useState<NativeChainState>({phase:"loading",activityPhase:"loading",activity:[]});
  const chainRefreshGeneration=useRef(0),chainMounted=useRef(false);
  const refreshChain=useCallback(async()=>{
    if(!chainMounted.current)return;
    const generation=++chainRefreshGeneration.current;
    setChainState({phase:"loading",activityPhase:"loading",activity:[]});
    try{const next=await loadNativeChainState(chainClient(),selected.account);if(chainMounted.current&&generation===chainRefreshGeneration.current)setChainState(next)}
    catch(caught){if(chainMounted.current&&generation===chainRefreshGeneration.current)setChainState({phase:"failed",error:message(caught),activityPhase:"failed",activityError:message(caught),activity:[]})}
  },[selected.account]);
  useEffect(()=>{chainMounted.current=true;void refreshChain();return()=>{chainMounted.current=false;chainRefreshGeneration.current++}},[refreshChain]);
  const copy=async()=>{cancelClipboardClear.current?.();cancelClipboardClear.current=await copyPublicValueWithExpiry(Clipboard,selected.account);setCopied(true);setTimeout(()=>setCopied(false),1500)};
  const openAudit=async()=>{setAuditError(null);try{setRecords(await authorizationAudit.load());setAuditOpen(true)}catch(caught){setAuditError(localizeError(locale,caught));setAuditOpen(true)}};
  return <ScrollView contentContainerStyle={styles.dashboard}>
    <Text style={styles.eyebrow}>{translate(locale,"nativeAccount")}</Text>
    <Pressable accessibilityLabel={walletCopy(locale,"Switch Wallet account")} accessibilityState={{expanded:accountsOpen}} onPress={()=>setAccountsOpen(!accountsOpen)} style={styles.accountPicker}><View><Text style={styles.accountLabel}>{selected.label}</Text><Text style={styles.address}>{short(selected.account)}</Text></View><ChevronDown color={ACTIVE_COLORS.ink}/></Pressable>
    {accountsOpen?<View style={styles.accountMenu}>{manifest.accounts.map((item)=><Pressable accessibilityRole="radio" accessibilityState={{checked:item.account===selected.account}} accessibilityLabel={`${translate(locale,"account")} ${item.label}`} key={item.account} onPress={()=>{select(item.account);setAccountsOpen(false)}} style={styles.accountRow}><View><Text style={styles.accountLabel}>{item.label}</Text><Text style={styles.smallAddress}>{short(item.account)}</Text></View>{item.account===selected.account?<Check color={ACTIVE_COLORS.blue}/>:null}</Pressable>)}<Pressable accessibilityLabel={translate(locale,"createAnother")} onPress={create} style={styles.accountRow}><Plus color={ACTIVE_COLORS.blue}/><Text style={styles.link}>{translate(locale,"createAnother")}</Text></Pressable><Pressable accessibilityLabel={translate(locale,"importAnother")} onPress={add} style={styles.accountRow}><KeyRound color={ACTIVE_COLORS.blue}/><Text style={styles.link}>{translate(locale,"importAnother")}</Text></Pressable></View>:null}
    <View style={styles.balanceCard}><Text style={styles.balanceLabel}>{walletCopy(locale,"Native asset · authoritative testnet")}</Text><Text style={styles.balance}>{chainState.account?formatYNXT(locale,chainState.account.balance):"— YNXT"}</Text><Text style={styles.balanceMeta}>{chainState.phase==="loading"?walletCopy(locale,"Loading balance and nonce…"):chainState.phase==="unrecorded"?`${walletCopy(locale,"This address has no on-chain account record yet. Receive testnet YNXT to get started. Balance and nonce are not available yet.")} ${walletCopy(locale,"Sending becomes available after balance and nonce are confirmed.")}`:chainState.phase==="failed"?`${walletCopy(locale,"Balance unavailable")}: ${chainState.error}`:`${walletCopy(locale,"Nonce {nonce}",{nonce:chainState.account?chainState.account.nonce:"—"})} · ${chainState.activityPhase==="ready"?walletCopy(locale,"{count} matching transactions in the latest 25 chain transactions",{count:chainState.activity.length}):walletCopy(locale,"Activity · unavailable")}`}</Text></View>
    <View style={styles.quickRow}><Quick icon={<ArrowUpRight color={ACTIVE_COLORS.blue}/>} label={translate(locale,"send")} onPress={()=>setSend(true)}/><Quick icon={<QrCode color={ACTIVE_COLORS.blue}/>} label={translate(locale,"receive")} onPress={()=>setQR(true)}/><Quick icon={<History color={ACTIVE_COLORS.blue}/>} label={translate(locale,"activity")} onPress={()=>setCenter(true)}/></View>
    <SecondaryButton label={walletCopy(locale,"Test YNXT")} onPress={()=>setFaucet(true)}/>
    <InfoCard title={translate(locale,"accountSafety")} body={walletCopy(locale,selected.backupConfirmed?"Offline backup confirmed. System biometrics protect unlock, authorization, recovery viewing and deletion.":"Backup is not confirmed. Do not receive assets until the recovery key is stored offline.")}/>
    <FaucetButton secondary label={walletCopy(locale,copied?"Native ynx1 address copied":"Copy native ynx1 address")} onPress={()=>void copy()}/>
    <FaucetButton secondary label={walletCopy(locale,"Rename account")} onPress={()=>setRename(true)}/>
    <FaucetButton secondary label={walletCopy(locale,"View offline recovery key")} onPress={()=>setRecovery(true)}/>
    <FaucetButton secondary label={walletCopy(locale,"0x EVM compatibility and contract simulation")} onPress={()=>setEvm(true)}/>
    <SecondaryButton label={walletCopy(locale,"Connected Apps, Sessions and Devices")} onPress={()=>setCenter(true)}/>
    <SecondaryButton label={walletCopy(locale,"Review stored transfer")} onPress={()=>setSend(true)}/>
    <SecondaryButton label={controlCopy(locale,"open")} onPress={()=>setControls(true)}/>
    <SecondaryButton label={translate(locale,"lockWallet")} onPress={lock}/>
    <SecondaryButton label={translate(locale,"audit")} onPress={()=>void openAudit()}/>
    <DangerButton label="Remove account from this device" onPress={()=>setRemove(true)}/>
    <Modal visible={qr} transparent animationType={MODAL_ANIMATION} onRequestClose={()=>setQR(false)}><Sheet title="Receive YNXT" close={()=>setQR(false)}><View style={styles.qr}><QRCodeView value={createPaymentURI(selected.account)} size={210} color={ACTIVE_COLORS.ink} backgroundColor={ACTIVE_COLORS.white}/></View><Text selectable style={styles.fullAddress}>{selected.account}</Text><Text style={styles.footnote}>Native network ynx_6423-1 · EVM chain ID 6423. An 0x address is shown only inside an explicit EVM compatibility view.</Text></Sheet></Modal>
    <SendModal visible={send} account={selected} close={()=>setSend(false)} onSent={()=>void refreshChain()}/>
    {faucet?<FaucetModal account={selected} close={()=>setFaucet(false)}/>:null}
    <EvmCompatibilityModal visible={evm} account={selected} close={()=>setEvm(false)}/>
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
  const [restoring,setRestoring]=useState<WalletAccount|null>(null);
  const review=useMemo(()=>reviewRecoveryKey(secret,accounts),[secret,accounts]);
  const existing=review.kind==="existing"?review.account:restoring;
  const dismiss=()=>{scope.cancel();setSecret("");setConfirmation("");setRestoring(null);setBusy(false);close()};
  useEffect(()=>{scope.cancel();setSecret("");setConfirmation("");setRestoring(null);setLabel(walletCopy(locale,"Imported account"));setBusy(false)},[mode,scope,locale,accounts]);
  useEffect(()=>operations.subscribe(()=>{scope.cancel();setSecret("");setConfirmation("");setRestoring(null);setBusy(false)}),[operations,scope]);
  const persistCreate=async()=>{if(!pending||confirmation!=="BACKED UP")return;let lease:WalletOperationLease|undefined;setBusy(true);try{lease=scope.begin({requireUnlocked:false});const next=await lease.step(()=>repository.addAccount({secretHex:pending.secretHex,label:pending.label,createdAt:new Date().toISOString(),backupConfirmed:true},lease!.assert));saved(next)}catch(caught){if(!lease||lease.ownsScope())setError(message(caught))}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}};
  const persistImport=async()=>{if(busy||review.kind!=="new")return;let lease:WalletOperationLease|undefined;const accountLabel=label.trim();setBusy(true);try{lease=scope.begin({requireUnlocked:false});const material=lease.holdSecret(secret.trim().toLowerCase());setSecret("");await lease.step(()=>authorizeLocalKeyUse("account-import"));const next=await lease.step(()=>repository.addAccount({secretHex:material.read(),label:accountLabel,createdAt:new Date().toISOString(),backupConfirmed:true},lease!.assert));material.clear();saved(next)}catch(caught){if(!lease||lease.ownsScope())setError(message(caught))}finally{if(!lease||lease.ownsScope()){setSecret("");setBusy(false)}lease?.finish()}};
  const persistRestore=async()=>{
    if(busy||mode!=="recover"||review.kind!=="existing")return;
    const target=review.account;let lease:WalletOperationLease|undefined;setBusy(true);setRestoring(target);
    try{lease=scope.begin({requireUnlocked:false});const material=lease.holdSecret(secret.trim().toLowerCase());setSecret("");await lease.step(()=>authorizeLocalKeyUse("account-import"));const next=await lease.step(()=>repository.restoreAccountSecret(target.account,material.read(),lease!.assert));material.clear();saved(next)}
    catch(caught){if(!lease||lease.ownsScope())setError(message(caught))}
    finally{if(!lease||lease.ownsScope()){setSecret("");setRestoring(null);setBusy(false)}lease?.finish()}
  };
  return <Modal visible={mode!=="closed"} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}>{mode==="create"&&pending?<RecoverySheet pending={pending} confirmation={confirmation} setConfirmation={setConfirmation} busy={busy} save={()=>void persistCreate()} close={dismiss}/>:<Sheet title={walletCopy(locale,mode==="recover"?"Recover Wallet":"Import account")} close={dismiss}><Text style={styles.sheetText}>{walletCopy(locale,mode==="recover"?"Replacement-device recovery restores only the native account. Connected Apps, sessions, device approvals and audit history must be re-created.":"Enter a 64-character YNX recovery key. Import requires system biometrics and does not restore product device sessions.")}</Text>{existing?<><ReviewRow label={translate(locale,"account")} value={`${existing.label}\n${existing.account}`}/><InfoCard title={walletCopy(locale,"This account is already stored in Wallet")} body={walletCopy(locale,mode==="recover"?"Confirm below to restore key protection for this exact existing account. Its label, account list and app sessions will not be replaced.":"Ordinary import cannot replace this account's protected key. Open account recovery and enter the offline key again to review an explicit restoration.")}/></>:<Field label={walletCopy(locale,"Account label")} value={label} onChangeText={setLabel}/>}<Field label={walletCopy(locale,"Recovery key")} value={secret} onChangeText={setSecret} secure multiline/>{mode==="recover"&&existing?<Button label={walletCopy(locale,"Restore key protection for this existing account")} disabled={busy||review.kind!=="existing"} onPress={()=>void persistRestore()}/>:existing?<SecondaryButton label={walletCopy(locale,"Open account recovery")} disabled={busy} onPress={()=>{dismiss();requestRecovery()}}/>:<Button label={walletCopy(locale,mode==="recover"?"Recover into secure storage":"Import into secure storage")} disabled={busy||review.kind!=="new"} onPress={()=>void persistImport()}/>}</Sheet>}</Modal>
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
    const appState=AppState.addEventListener("change",next=>{if(next!=="active")flow.cancel()});
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
        {amount!==null?<FaucetDetail label="Requested amount" value={formatYNXT(locale,amount)}/>:<Text style={[styles.muted,textDirection]}>{walletCopy(locale,"Request amount will be shown when this service becomes available.")}</Text>}
        {state.busy?<View accessibilityState={{busy:true}}><ActivityIndicator color={ACTIVE_COLORS.blue}/><Text accessibilityLiveRegion="polite" style={[styles.sheetText,textDirection]}>{walletCopy(locale,busyText)}</Text></View>:null}
        {state.phase==="paused"?<Text accessibilityRole="alert" style={[styles.sheetText,textDirection]}>{walletCopy(locale,"Close and reopen this request to continue.")}</Text>:null}
        {state.error?<Text accessibilityRole="alert" style={[styles.error,textDirection]}>{walletCopy(locale,state.error==="unavailable"?"Test YNXT requests are not available in this version.":state.error==="read"||state.error==="storage"?"Saved request unavailable. Sending is paused.":"The request could not be checked. Keep the original request and try again manually.")}</Text>:null}
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

function SendModal({visible,account,close,onSent}:{visible:boolean;account:WalletAccount;close:()=>void;onSent:()=>void}){
  const locale=useContext(WalletLocaleContext);
  const scope=useOperationScope(visible,account.account),[to,setTo]=useState(""),[amount,setAmount]=useState(""),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [stored,setStored]=useState<NativeTransferOutboxEntry|null>(null),[loaded,setLoaded]=useState(false),[reload,setReload]=useState(0);
  const operations=useWalletOperations(),recipientInput=useMemo(()=>new PaymentRecipientInput(operations),[operations]);
  const [pasting,setPasting]=useState(false),[recipientAdded,setRecipientAdded]=useState(false);
  const inputContext=useRef("");
  const contextKey=JSON.stringify([visible,account.account,review,Boolean(stored),loaded]);
  // Invalidate an old clipboard result during a changed render, before effects.
  if(inputContext.current!==contextKey){recipientInput.cancel();inputContext.current=contextKey}
  const cancelInput=()=>{recipientInput.cancel();setPasting(false);setRecipientAdded(false)};
  const dismiss=()=>{cancelInput();scope.cancel();setBusy(false);close()};
  useEffect(()=>{recipientInput.cancel();scope.cancel();setTo("");setAmount("");setReview(false);setBusy(false);setPasting(false);setRecipientAdded(false);setError(null);setStored(null);setLoaded(false);if(!visible)return;let current=true;
    void nativeOutbox.read(account.account).then(value=>{if(current){setStored(value?.phase==="done"?null:value);setLoaded(true)}}).catch(caught=>{if(current)setError(message(caught))});return()=>{current=false;recipientInput.cancel()}
  },[visible,account.account,scope,reload,recipientInput]);
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
    try{lease=scope.begin({account:request.account});const activeLease=lease,client=chainClient();let result:NativeTransferOutboxEntry;
      if(mode==="done"){
        if(!stored)throw new Error("Stored transfer is unavailable");
        result=await nativeOutbox.acknowledge(request.account,stored.hash,activeLease.assert);
      }else if(mode==="check"){
        if(!stored)throw new Error("Stored transfer is unavailable");
        result=await nativeOutbox.checkStatus(request.account,stored.hash,client,activeLease.assert);
      }else if(mode==="retry"){
        if(!stored)throw new Error("Stored transfer is unavailable");
        result=await nativeOutbox.retry(request.account,stored.hash,client,activeLease.assert,()=>authorizeLocalKeyUse("transaction-retry"));
      }else{
        result=await nativeOutbox.sendNew(request.account,client,activeLease.assert,async()=>{
          await activeLease.step(()=>authorizeLocalKeyUse("transaction-sign"));
          const remote=await activeLease.step(()=>client.account(request.account));
          if(!Number.isSafeInteger(request.amount+1)||remote.balance<request.amount+1)throw new Error("Insufficient YNXT to cover the reviewed amount and 1 YNXT fee");
          if(!Number.isSafeInteger(remote.nonce+1))throw new Error("The next account nonce exceeds the supported range");
          await activeLease.step(()=>client.requireDurabilityCapability());
          return activeLease.withSecret(()=>repository.accountSecret(request.account,activeLease.assert,{allowLegacyMigration:true}),secret=>{activeLease.assert();const identity=walletIdentity(secret);if(identity.account!==request.account||identity.accountPublicKey!==request.accountPublicKey)throw new Error("Signing account changed after review");return createSignedNativeTransfer({accountSecret:secret,to:request.to,amount:request.amount,nonce:remote.nonce+1})});
        });
      }
      // The outbox records late network facts even when this screen has closed.
      // A cancelled lease only suppresses UI/callback updates, never that write.
      activeLease.assert();setStored(result.phase==="done"?null:result);if(result.phase==="observed"||result.phase==="accepted")onSent();if(mode==="done")dismiss();
    }catch(caught){if(lease?.isCurrent()||!lease){setError(message(caught));try{const value=await nativeOutbox.read(request.account);if(lease?.isCurrent()||!lease){setStored(value?.phase==="done"?null:value);setLoaded(true)}}catch{if(lease?.isCurrent()||!lease)setLoaded(false)}}}
    finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}
  };
  const problem=error?<><Text style={styles.error}>{needsOfflineKeyRecovery(error)?walletCopy(locale,"Key protection needs recovery"):error}</Text><RecoveryRequiredNotice error={error}/></>:null;
  const title=stored?walletCopy(locale,stored.phase==="accepted"?"Transfer durably confirmed":"Stored transfer needs confirmation"):review?"Send Review":"Send YNXT";
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={title} close={dismiss}>{!loaded?<><Text style={styles.sheetText}>{walletCopy(locale,"Checking the stored transfer before allowing a new signature.")}</Text>{problem}<SecondaryButton label={walletCopy(locale,"Reload stored transfer")} disabled={busy} onPress={()=>setReload(value=>value+1)}/></>:stored?<>
    <ReviewRow label={translate(locale,"account")} value={stored.account}/><ReviewRow label="To" value={ynxAddressFromEVM(stored.transaction.to)}/><ReviewRow label="Amount" value={`${stored.transaction.amount} YNXT`}/><ReviewRow label="Network fee" value={`${stored.transaction.fee} YNXT`}/><ReviewRow label="Nonce" value={String(stored.transaction.nonce)}/><ReviewRow label="Transaction" value={stored.hash}/><ReviewRow label="RPC" value={stored.origin}/>
    <Text style={styles.sheetText}>{walletCopy(locale,stored.phase==="accepted"?"This mined transfer is covered by the node’s verified local snapshot checkpoint. This is not a consensus finality claim. Done acknowledges this result before another transfer can be signed.":stored.phase==="observed"||stored.replayed!==null?"The node reported this exact transfer as accepted. Durable confirmation is still unavailable. Keep this original transaction; do not create a replacement.":stored.phase==="prepared"?"The signed transfer was saved before sending. Closing Wallet preserves it. Review and authorize sending these same bytes.":"This transfer may already have reached the node. Its outcome is not durably confirmed. Closing or restarting Wallet preserves the original transaction.")}</Text>
    {stored.phase==="pending_durable"?<InfoCard title={walletCopy(locale,"Awaiting a mined block")} body={walletCopy(locale,"The node has saved the pending transfer locally. It has not confirmed mined inclusion. Keep this transaction and check again.")}/>:stored.phase==="memory_only"?<InfoCard title={walletCopy(locale,"Local durability unavailable")} body={walletCopy(locale,"This node only reports memory state. The original transfer remains unconfirmed and stored.")}/>:stored.phase==="not_found"?<InfoCard title={walletCopy(locale,"Transaction not observed by this node")} body={walletCopy(locale,"Not found does not prove rejection or allow a replacement transaction. Keep the original and check again.")}/>:stored.phase==="unsupported"?<InfoCard title={walletCopy(locale,"Durability capability unavailable")} body={walletCopy(locale,"This node does not provide the required versioned durability capability. The original transfer stays unconfirmed.")}/>:null}
    {problem}{stored.phase==="accepted"?<Button label="Done" disabled={busy} onPress={()=>void act("done")}/>:<><InfoCard title={walletCopy(locale,"Retry the original transaction")} body={walletCopy(locale,"After system biometric confirmation, Wallet resends only the stored signed request. It does not sign again or change its amount, recipient or nonce.")}/><Button label={walletCopy(locale,busy?"Waiting for the original transaction…":"Check transaction status")} disabled={busy} onPress={()=>void act("check")}/><SecondaryButton label={walletCopy(locale,"Authorize and resend original transaction")} disabled={busy} onPress={()=>void act("retry")}/></>}<SecondaryButton label={walletCopy(locale,"Close and keep transfer")} onPress={dismiss}/>
  </>:review?<><ReviewRow label="From" value={`${account.label}\n${account.account}`}/><ReviewRow label="To" value={to}/><ReviewRow label="Amount" value={`${amount} YNXT`}/><ReviewRow label="Network fee" value="1 YNXT"/><ReviewRow label="Network" value="ynx_6423-1"/><InfoCard title="Final biometric confirmation" body="Wallet will fetch the current authoritative nonce and balance, sign the exact canonical transfer, store and verify its original bytes, and POST it only to the configured YNX RPC origin."/>{problem}<SecondaryButton label="Edit transfer" disabled={busy} onPress={()=>{cancelInput();setReview(false)}}/><Button label={busy?"Signing and broadcasting…":"Sign and broadcast"} disabled={busy||!valid} onPress={()=>void act("new")}/></>:<><Text style={styles.sheetText}>{walletCopy(locale,"Copy a receiving link from a QR code, then paste it here.")}</Text>{problem}<SecondaryButton label={walletCopy(locale,pasting?"Reading clipboard…":"Paste address or receiving link")} disabled={pasting||busy} onPress={()=>void pasteRecipient()}/>{recipientAdded?<InfoCard title="YNX Testnet · YNXT" body={walletCopy(locale,"Recipient added. Enter an amount and review the transfer.")}/>:null}<Field label={walletCopy(locale,"Recipient ynx1 address")} value={to} onChangeText={changeRecipient}/><Field label={walletCopy(locale,"Whole YNXT amount")} value={amount} onChangeText={changeAmount}/><Button label={walletCopy(locale,"Review transfer")} disabled={!valid||pasting||busy} onPress={()=>{cancelInput();setReview(true)}}/></>}</Sheet></Modal>
}

function EvmCompatibilityModal({visible,account,close}:{visible:boolean;account:WalletAccount;close:()=>void}){const from=evmAddressFromYNX(account.account);const[to,setTo]=useState(""),[data,setData]=useState("0x"),[valueWei,setValueWei]=useState("0"),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[result,setResult]=useState<EvmSimulationResult|null>(null),[error,setError]=useState<string|null>(null);useEffect(()=>{if(!visible){setTo("");setData("0x");setValueWei("0");setBusy(false);setCopied(false);setResult(null);setError(null)}},[visible]);const valid=/^0x[0-9a-f]{40}$/.test(to)&&to!==from&&/^0x(?:[0-9a-f]{2})*$/.test(data)&&/^(0|[1-9][0-9]{0,77})$/.test(valueWei);const copy=async()=>{await copyPublicValueWithExpiry(Clipboard,from);setCopied(true);setTimeout(()=>setCopied(false),1500)};const simulate=async()=>{setBusy(true);setError(null);setResult(null);try{setResult(await evmSimulationClient().simulate({from,to,data,valueWei}))}catch(caught){setError(message(caught))}finally{setBusy(false)}};return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={close}><Sheet title="0x EVM compatibility" close={close}><ReviewRow label="Default Wallet identity" value={account.account}/><ReviewRow label="Derived 0x address" value={from}/><SecondaryButton label={copied?"0x address copied for 30 seconds":"Copy 0x address for 30 seconds"} onPress={()=>void copy()}/><InfoCard title="Read-only simulation boundary" body="Wallet verifies chain ID 6423, deployed contract code, eth_call and eth_estimateGas. This view never signs or broadcasts an EVM transaction."/><Field label="Contract address (lowercase 0x)" value={to} onChangeText={(value)=>{setTo(value.trim());setResult(null)}}/><Field label="Calldata (lowercase even-length hex)" value={data} onChangeText={(value)=>{setData(value.trim());setResult(null)}} multiline/><Field label="Native value in wei" value={valueWei} onChangeText={(value)=>{setValueWei(value.trim());setResult(null)}}/>{error?<Text style={styles.error}>{error}</Text>:null}{result?<><Text style={[styles.eyebrow,styles.sectionLabel]}>PRECISE SIMULATION REVIEW</Text><ReviewRow label="Status" value={result.truthfulStatus}/><ReviewRow label="Chain / block" value={`${result.chainId} / ${result.blockNumber}`}/><ReviewRow label="From" value={result.from}/><ReviewRow label="Contract" value={result.to}/><ReviewRow label="Method selector" value={result.methodSelector}/><ReviewRow label="Value" value={`${result.valueWei} wei`}/><ReviewRow label="Gas estimate" value={result.gasEstimate}/><ReviewRow label="Code" value={`${result.contractCodeBytes} bytes\n${result.contractCodeHash}`}/><ReviewRow label="Return data" value={result.returnData}/><ReviewRow label="Source / as of" value={`${result.source}\n${result.asOf}`}/><InfoCard title="Simulation is not execution" body="State, gas, code and return values can change before a separately reviewed transaction is signed. No success, settlement or receipt is claimed here."/></>:null}<Button label={busy?"Verifying RPC and simulating…":"Run read-only contract simulation"} disabled={busy||!valid} onPress={()=>void simulate()}/></Sheet></Modal>}

function WalletCenter({visible,account,chainState,close,openAudit,retry}:{visible:boolean;account:WalletAccount;chainState:NativeChainState;close:()=>void;openAudit:()=>void;retry:()=>void}){
  const locale=useContext(WalletLocaleContext);
  const cancelSessions=useRef<()=>void>(()=>{});
  const dismiss=()=>{cancelSessions.current();close()};
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={walletCopy(locale,"Wallet Center")} close={dismiss}><Text style={styles.eyebrow}>{walletCopy(locale,"ASSETS / ACTIVITY")}</Text><InfoCard title={chainState.account?`${chainState.account.balance} YNXT`:chainState.phase==="loading"?walletCopy(locale,"YNXT · loading"):chainState.phase==="unrecorded"?walletCopy(locale,"YNXT · no account record"):walletCopy(locale,"YNXT · unavailable")} body={chainState.phase==="loading"?walletCopy(locale,"Loading balance and nonce…"):chainState.phase==="unrecorded"?walletCopy(locale,"This address has no on-chain account record yet. Receive testnet YNXT to get started. Balance and nonce are not available yet."):chainState.phase==="failed"?chainState.error??walletCopy(locale,"Balance unavailable"):walletCopy(locale,"Authoritative nonce {nonce} on ynx_6423-1.",{nonce:chainState.account?.nonce??"—"})}/>{chainState.activityPhase==="loading"?<InfoCard title={walletCopy(locale,"Activity · loading")} body={walletCopy(locale,"Loading recent chain transactions…")}/>:chainState.activityPhase==="failed"?<InfoCard title={walletCopy(locale,"Activity · unavailable")} body={chainState.activityError??walletCopy(locale,"Recent transactions could not be loaded.")}/>:chainState.activity.length===0?<InfoCard title={walletCopy(locale,"Activity · empty")} body={walletCopy(locale,"No matching account activity appears in the latest 25 chain transactions.")}/>:chainState.activity.map((item)=><View key={item.hash} style={styles.auditRow}><Text style={styles.infoTitle}>{item.to===evmAddressFromYNX(account.account)?walletCopy(locale,"Received"):walletCopy(locale,"Sent")} · {item.amount} YNXT</Text><Text style={styles.infoBody}>{short(item.hash)} · {walletCopy(locale,"fee {fee} · nonce {nonce}",{fee:item.fee,nonce:item.nonce})}</Text></View>)}{chainState.phase==="failed"||chainState.phase==="unrecorded"||chainState.activityPhase==="failed"?<SecondaryButton label={walletCopy(locale,"Refresh balance and activity")} onPress={retry}/>:null}
    <ConnectedApps visible={visible} account={account} cancelRef={cancelSessions}/>
    <SecondaryButton label={walletCopy(locale,"Open Authorization Audit")} onPress={openAudit}/>
    <Text style={[styles.eyebrow,styles.sectionLabel]}>{walletCopy(locale,"RECOVERY / SECURITY / NETWORK")}</Text>
    <InfoCard title={walletCopy(locale,"Recovery")} body={walletCopy(locale,"Your offline key restores this account. Each app still needs its own sign-in approval. You can review existing app sessions above.")}/>
    <InfoCard title={walletCopy(locale,"Security")} body={walletCopy(locale,"Wallet locks in the background. Viewing app sessions, revoking a session and using a private key each require system biometrics.")}/>
    <InfoCard title={translate(locale,"network")} body={walletCopy(locale,"YNX testnet · ynx_6423-1 · native YNXT · rpc.ynxweb4.com. EVM chain ID 6423 is available in the compatibility view.")}/>
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

function RecoverySheet({pending,confirmation,setConfirmation,busy,save,close}:{pending:{secretHex:string;label:string};confirmation:string;setConfirmation:(v:string)=>void;busy:boolean;save:()=>void;close:()=>void}){
  useEffect(()=>{void preventScreenCaptureAsync("wallet-recovery");return()=>{void allowScreenCaptureAsync("wallet-recovery")}},[]);
  return <Sheet title="Back up before saving" close={close}><Text style={styles.sheetText}>Write this recovery key offline. Clipboard export is disabled. Never paste it into Social, support, AI, a website or another product. YNX cannot recover it.</Text><Text accessibilityLabel="YNX Wallet recovery key" style={styles.recoveryKey}>{pending.secretHex}</Text><Field label="Type BACKED UP to confirm" value={confirmation} onChangeText={setConfirmation}/><Button label="Confirm backup and save" disabled={busy||confirmation!=="BACKED UP"} onPress={save}/></Sheet>
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
  const scope=useOperationScope(visible,account.account),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false);
  const dismiss=()=>{scope.cancel();setConfirm("");setBusy(false);close()};
  useEffect(()=>{scope.cancel();setConfirm("");setBusy(false)},[scope,visible,account.account]);
  const remove=async()=>{let lease:WalletOperationLease|undefined;setBusy(true);try{lease=scope.begin({account:account.account});await lease.step(()=>authorizeLocalKeyUse("account-delete"));const next=await lease.step(()=>repository.deleteAccount(account.account,lease!.assert));deleted(next)}catch(caught){if(!lease||lease.ownsScope())failed(message(caught))}finally{if(!lease||lease.ownsScope())setBusy(false);lease?.finish()}};
  return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title="Remove account?" close={dismiss}><Text style={styles.sheetText}>This permanently removes local key material and revokes its availability in Wallet. It does not erase chain history. Recovery requires the offline key.</Text><Field label={`Type ${account.label} to confirm`} value={confirm} onChangeText={setConfirm}/><DangerButton label="Remove local account" disabled={busy||confirm!==account.label} onPress={()=>void remove()}/></Sheet></Modal>}

function AuthorizationModal({locale,review,controller,close,onReturned}:{locale:WalletLocale;review:ProductSessionReview;controller:ProductSessionController;close:()=>void;onReturned:()=>void}){
  const {request,account:selected}=review;
  const scope=useOperationScope(true,selected.account);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[ai,setAI]=useState(false),[returnReady,setReturnReady]=useState(false);
  const decide=async(action:"approve"|"reject"|"retryReturn")=>{if(busy||controller.current?.id!==review.id)return;let lease:WalletOperationLease;try{lease=scope.begin({account:selected.account,requireUnlocked:false})}catch{return}setBusy(true);setError(null);try{await controller[action](review.id);if(lease.ownsScope())onReturned()}catch(caught){if(lease.ownsScope()){setReturnReady(controller.hasReturn(review.id));setError(localizeProductSessionError(locale,caught,action,controller.hasReturn(review.id)))}}finally{if(lease.ownsScope())setBusy(false);lease.finish()}};
  const dismiss=()=>{if(!busy){if(returnReady)close();else void decide("reject")}};
  return <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={dismiss}><Sheet title={translate(locale,"signInTitle")} close={dismiss}><Text style={styles.authorizationLead}>{translate(locale,"authorizationLead")}</Text><ReviewRow label={translate(locale,"requestingApp")} value={request.productId}/><ReviewRow label={translate(locale,"appIdentity")} value={request.clientId+"\n"+request.applicationId+"\n"+request.platform}/><ReviewRow label="Origin" value={request.origin}/><ReviewRow label="Return to product" value={request.callback}/><ReviewRow label="Product device" value={request.deviceId}/><ReviewRow label={translate(locale,"network")} value={request.chainId+"\nEVM compatibility: 6423"}/><ReviewRow label={translate(locale,"account")} value={selected.label+"\n"+selected.account}/><ReviewRow label={translate(locale,"permissions")} value={request.scopes.join("\n")}/><ReviewRow label={translate(locale,"purpose")} value={request.purpose}/><ReviewRow label={translate(locale,"expires")} value={formatDateTime(locale,request.expiresAt)}/>{request.scopes.map((scope)=><Text key={scope} style={styles.scopeExplain}>{scope}: {scopeExplanation(locale,scope)}</Text>)}<SecondaryButton label={translate(locale,"aiSecurity")} icon={<Sparkles color={ACTIVE_COLORS.blue}/>} disabled={busy||returnReady} onPress={()=>setAI(true)}/>{error?<><Text style={styles.error}>{needsOfflineKeyRecovery(error)?walletCopy(locale,"Key protection needs recovery"):error}</Text><RecoveryRequiredNotice error={error}/><SecondaryButton label="Close request" disabled={busy} onPress={close}/></>:null}{returnReady?<Button label="Retry return to product" disabled={busy} onPress={()=>void decide("retryReturn")}/>:<View style={styles.approvalButtons}><SecondaryButton label={translate(locale,"reject")} disabled={busy} onPress={()=>void decide("reject")}/><Button label={translate(locale,"approve")} disabled={busy} onPress={()=>void decide("approve")}/></View>}<Text style={styles.footnote}>{translate(locale,"privacy")} {translate(locale,"aiCannotApprove")}</Text><AIReviewModal visible={ai} locale={locale} request={request} close={()=>setAI(false)}/></Sheet></Modal>
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

function LocaleSettings({visible,locale,close,select}:{visible:boolean;locale:WalletLocale;close:()=>void;select:(locale:WalletLocale)=>void}){const summary=walletAccessibilitySummary(locale,ACCESSIBILITY_SUMMARY);return <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={close}><Sheet title={translate(locale,"settingsTitle")} close={close}><Text accessibilityLabel={`${walletCopy(locale,"Accessibility state")}: ${summary}`} style={styles.sheetText}>{walletCopy(locale,"System language is detected on first launch. A manual choice is stored locally and survives restart.")}{"\n"}{summary}. {walletCopy(locale,"Text follows the device font scale.")}</Text>{SUPPORTED_LOCALES.map((item)=><Pressable accessibilityRole="radio" accessibilityState={{checked:item===locale}} accessibilityLabel={translate(item,"languageName")} key={item} onPress={()=>select(item)} style={styles.localeRow}><Text style={styles.infoTitle}>{translate(item,"languageName")}</Text>{item===locale?<Check color={ACTIVE_COLORS.blue}/>:null}</Pressable>)}</Sheet></Modal>}

function RecoveryRequiredNotice({error}:{error:string|null|undefined}){
  const locale=useContext(WalletLocaleContext),recover=useContext(WalletRecoveryContext);
  if(!error||!needsOfflineKeyRecovery(error))return null;
  return <><InfoCard title={walletCopy(locale,"Key protection needs recovery")} body={walletCopy(locale,"Your public account is still stored. Restore its protected key with the matching offline recovery key. App sessions are not restored or revoked by this action.")}/><SecondaryButton label={walletCopy(locale,"Open account recovery")} onPress={recover}/></>;
}

function Screen({children}:{children:React.ReactNode}){return <View style={styles.screen}>{children}</View>}
function Sheet({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
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
    <ScrollView ref={scroll} style={styles.sheetViewport} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==="ios"?"interactive":"on-drag"}
      onFocus={event=>{focused.current=event.nativeEvent.target;revealFocused()}} onBlur={event=>{if(focused.current===event.nativeEvent.target)focused.current=null}}>
      <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${translate(locale,"close")} ${title}`} onPress={close} style={styles.iconButton}><X color={ACTIVE_COLORS.ink}/></Pressable></View>{children}
    </ScrollView>
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

function createStyles(){return StyleSheet.create({
  safe:{flex:1,backgroundColor:ACTIVE_COLORS.white},rtl:{direction:"rtl"},header:{minHeight:66,paddingVertical:10,paddingHorizontal:20,flexDirection:"row",alignItems:"center",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line,gap:12},headerBrand:{flex:1,minWidth:0,flexShrink:1},headerActions:{flexShrink:0,flexDirection:"row",gap:8},mark:{flexShrink:0,width:36,height:36,borderRadius:10,backgroundColor:ACTIVE_COLORS.blue,alignItems:"center",justifyContent:"center"},markText:{color:ACTIVE_COLORS.white,fontWeight:"800",fontSize:20},brand:{color:ACTIVE_COLORS.ink,fontSize:17,fontWeight:"700"},network:{color:ACTIVE_COLORS.muted,fontSize:10,fontWeight:"700",letterSpacing:.7,marginTop:2},iconButton:{flexShrink:0,width:42,height:42,alignItems:"center",justifyContent:"center",borderRadius:12,backgroundColor:ACTIVE_COLORS.surface},notice:{margin:12,marginBottom:0,padding:13,borderRadius:10,backgroundColor:"#EEF3FF",flexDirection:"row",alignItems:"center",gap:10},noticeText:{flex:1,color:ACTIVE_COLORS.blue,fontSize:12,lineHeight:17},bannerError:{margin:12,marginBottom:0,padding:13,borderRadius:10,backgroundColor:"#FEF3F2",flexDirection:"row",gap:10},screen:{flex:1,paddingHorizontal:28,alignItems:"center",justifyContent:"center"},heroIcon:{width:76,height:76,borderRadius:24,backgroundColor:"#EEF3FF",alignItems:"center",justifyContent:"center",marginBottom:24},eyebrow:{color:ACTIVE_COLORS.blue,fontSize:11,fontWeight:"800",letterSpacing:1.1},sectionLabel:{marginTop:30},title:{color:ACTIVE_COLORS.ink,fontSize:32,fontWeight:"700",letterSpacing:-.8,marginTop:8,textAlign:"center"},centerText:{color:ACTIVE_COLORS.muted,fontSize:15,lineHeight:23,textAlign:"center",maxWidth:410,marginTop:14},muted:{color:ACTIVE_COLORS.muted,marginTop:12},footnote:{color:ACTIVE_COLORS.muted,fontSize:12,lineHeight:18,textAlign:"center",marginTop:18},address:{color:ACTIVE_COLORS.muted,fontSize:13,marginTop:5},button:{width:"100%",maxWidth:420,minHeight:50,borderRadius:12,backgroundColor:ACTIVE_COLORS.blue,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9,paddingHorizontal:20,marginTop:22},buttonText:{color:ACTIVE_COLORS.white,fontSize:15,fontWeight:"700"},secondaryButton:{width:"100%",maxWidth:420,minHeight:48,borderRadius:12,borderWidth:1,borderColor:ACTIVE_COLORS.line,backgroundColor:ACTIVE_COLORS.white,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9,paddingHorizontal:18,marginTop:12},secondaryText:{color:ACTIVE_COLORS.ink,fontSize:14,fontWeight:"600"},dangerButton:{width:"100%",minHeight:48,borderRadius:12,borderWidth:1,borderColor:"#FECDCA",alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9,paddingHorizontal:18,marginTop:12},dangerText:{color:ACTIVE_COLORS.danger,fontWeight:"600"},pressed:{opacity:.72},disabled:{opacity:.38},info:{width:"100%",maxWidth:420,marginTop:22,padding:16,borderRadius:14,backgroundColor:ACTIVE_COLORS.surface,flexDirection:"row",gap:12},infoCopy:{flex:1},infoTitle:{color:ACTIVE_COLORS.ink,fontWeight:"700",fontSize:14},infoBody:{color:ACTIVE_COLORS.muted,fontSize:12,lineHeight:18,marginTop:5},error:{color:ACTIVE_COLORS.danger,fontSize:13,lineHeight:19,marginTop:12},dashboard:{padding:24,paddingBottom:48},accountPicker:{minHeight:62,flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:8},accountLabel:{color:ACTIVE_COLORS.ink,fontSize:19,fontWeight:"700"},accountMenu:{borderWidth:1,borderColor:ACTIVE_COLORS.line,borderRadius:14,overflow:"hidden",marginBottom:16},accountRow:{minHeight:64,paddingHorizontal:16,flexDirection:"row",alignItems:"center",gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},smallAddress:{color:ACTIVE_COLORS.muted,fontSize:11,marginTop:3},link:{color:ACTIVE_COLORS.blue,fontWeight:"600"},balanceCard:{backgroundColor:ACTIVE_COLORS.blue,borderRadius:20,padding:24,marginTop:18},balanceLabel:{color:ACTIVE_COLORS.white,fontSize:12},balance:{color:ACTIVE_COLORS.white,fontSize:34,fontWeight:"700",marginTop:12},balanceMeta:{color:ACTIVE_COLORS.white,fontSize:11,lineHeight:17,marginTop:10},quickRow:{flexDirection:"row",justifyContent:"space-around",marginTop:22},quick:{alignItems:"center",minWidth:78},quickIcon:{width:50,height:50,borderRadius:16,backgroundColor:"#EEF3FF",alignItems:"center",justifyContent:"center"},quickText:{color:ACTIVE_COLORS.ink,fontSize:12,fontWeight:"600",marginTop:8},backdrop:{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(0,47,167,.12)"},sheetViewport:{maxHeight:"94%",flexGrow:0,backgroundColor:ACTIVE_COLORS.white,borderTopLeftRadius:24,borderTopRightRadius:24,overflow:"hidden"},sheet:{padding:22,paddingBottom:40},sheetHeader:{flexDirection:"row",alignItems:"center",minHeight:48},sheetTitle:{color:ACTIVE_COLORS.ink,fontSize:23,fontWeight:"700",flex:1},sheetText:{color:ACTIVE_COLORS.muted,fontSize:14,lineHeight:21,marginTop:14},localeRow:{minHeight:52,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},auditRow:{paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},field:{marginTop:18},fieldLabel:{color:ACTIVE_COLORS.ink,fontSize:12,fontWeight:"600",marginBottom:7},input:{minHeight:48,borderWidth:1,borderColor:ACTIVE_COLORS.line,borderRadius:12,paddingHorizontal:14,color:ACTIVE_COLORS.ink,fontSize:15},multiline:{minHeight:96,textAlignVertical:"top",paddingTop:14},recoveryKey:{fontFamily:Platform.select({ios:"Menlo",android:"monospace"}),fontSize:13,lineHeight:21,color:ACTIVE_COLORS.ink,backgroundColor:ACTIVE_COLORS.surface,padding:16,borderRadius:12,marginTop:18},qr:{alignItems:"center",padding:20,marginTop:18},fullAddress:{fontSize:12,lineHeight:18,color:ACTIVE_COLORS.ink,textAlign:"center"},authorizationLead:{color:ACTIVE_COLORS.muted,fontSize:13,lineHeight:19,marginVertical:12},reviewRow:{paddingVertical:11,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line,flexDirection:"row",gap:14},reviewLabel:{color:ACTIVE_COLORS.muted,fontSize:12,width:105},reviewValue:{color:ACTIVE_COLORS.ink,fontSize:12,lineHeight:18,flex:1,textAlign:"right"},scopeExplain:{color:ACTIVE_COLORS.muted,fontSize:11,lineHeight:17,marginTop:8},approvalButtons:{width:"100%"},aiOutput:{color:ACTIVE_COLORS.ink,fontSize:14,lineHeight:21,backgroundColor:ACTIVE_COLORS.surface,padding:14,borderRadius:12,marginTop:14},controlStatus:{marginTop:14,paddingVertical:14,flexDirection:"row",alignItems:"flex-start",gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},statusDot:{width:10,height:10,borderRadius:5,marginTop:4},nativeList:{borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:ACTIVE_COLORS.line},nativeListHeader:{minHeight:64,paddingVertical:12,flexDirection:"row",alignItems:"center",gap:10},riskInspector:{paddingBottom:12},missingList:{paddingVertical:16}
})}
