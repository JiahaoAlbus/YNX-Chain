import React,{useCallback,useEffect,useRef,useState}from"react";
import{ActivityIndicator,Alert,FlatList,Linking,Modal,Platform,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,useColorScheme,View}from"react-native";
import{SafeAreaProvider,SafeAreaView}from"react-native-safe-area-context";
import{StatusBar}from"expo-status-bar";
import* as LocalAuthentication from"expo-local-authentication";
import{ArrowUpRight,CreditCard,Globe2,LifeBuoy,LockKeyhole,ReceiptText,RefreshCw,ShieldCheck,SlidersHorizontal,WalletCards,X}from"lucide-react-native";
import{action,apply as applyForCard,createTestnetTopupIntent,dispute as openDispute,explain,reviewAI,state as loadState,topupTestnet,type Card,type CardEvent,type CardState,type TestnetTopupIntent,type TopupInput, simulateAuthorization, simulateCapture, simulateReversal, simulateRefund, updateControls}from"./src/api";
import{catalogs,date,isLocale,isRTL,localeNames,locales,money,t as translate,type Locale}from"./src/i18n";
import{loadLocale,loadPendingAuthorization,loadSession,loadSimulationAudit,saveLocale,savePendingAuthorization,saveSession,saveSimulationAudit}from"./src/secureState";
import{createRuntimeCardProductWalletConnection,type CardProductWalletConnection}from"./src/productWalletRuntime";
import{createStandardWalletConnectState,discoverWalletProviders,reduceStandardWalletConnectState}from"@ynx-chain/wallet-auth";
import{approveTestnetTopup,classifyCardWalletError,connectEip1193Wallet,connectMetaMaskWallet,disconnectEip1193Wallet,loadTestnetTopupEvidence,parseWalletAuthorizationCallback,parseYnxtAmountToWei,resolveEip1193Provider,restoreEip1193Wallet,switchEip1193WalletAccount,watchEip1193Provider,YNX_TESTNET_CHAIN_ID,type CardSession,type Eip1193Provider,type Eip1193WalletSession,type PendingAuthorizationRequest,type ProductSessionRuntime,type TopupEvidence,type WalletProviderKind}from"./src/wallet";
import{isFailure,recoverLastFailed,replayAwareAppend,SimulationAuditRecord,TESTNET_SIMULATION_CURRENCY,TESTNET_SIMULATION_MAX_EVENTS,type SimulationInput as LedgerSimulationInput}from"./src/simulation";
import{GuestExperience}from"./src/GuestExperience";

const BLUE="#002FA7",RED="#B42318",GREEN="#067647",ORANGE="#B54708";
type Tab="card"|"activity"|"controls"|"simulation"|"support";
type SimulationAction="authorization"|"capture"|"reversal"|"refund";

type SimulationPayload={operation:SimulationAction;cardId:string;merchant:string;amountMinor:number;currency:string;idempotencyKey:string;walletAddress?:string;topupTxHash?:string;};

export default function App(){
  const scheme=useColorScheme(),dark=scheme==="dark";const c=dark?darkColors:lightColors;
  // A guest's device language must not silently choose the product language.
  // English is the safe first-run default; an explicit saved preference may override it.
  const[locale,setLocaleState]=useState<Locale>("en");
  const tr=useCallback((key:keyof typeof catalogs.en)=>translate(locale,key),[locale]);
  const rtl=isRTL(locale);

  const[session,setSession]=useState<CardSession|null>(null);
  const[pending,setPending]=useState(false);
  const[tab,setTab]=useState<Tab>("card");
  const[snapshot,setSnapshot]=useState<CardState|null>(null);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const[settings,setSettings]=useState(false);
  const[revealed,setRevealed]=useState(false);
  const[applyOpen,setApplyOpen]=useState(false);

  const[walletSession,setWalletSession]=useState<Eip1193WalletSession|null>(null);
  const[walletBusy,setWalletBusy]=useState(false);
  const[walletError,setWalletError]=useState("");
  const[privateSession,setPrivateSession]=useState<ProductSessionRuntime|null>(null);
  const[standardWalletState,setStandardWalletState]=useState(()=>createStandardWalletConnectState());
  const resolveSharedProvider=async(kind:"metamask"|"ynx-wallet"):Promise<Eip1193Provider|null>=>{
    if(Platform.OS!=="web")return null;
    const discovery=await discoverWalletProviders(globalThis,1600);
    const candidate=kind==="metamask"?discovery.metamask:discovery.ynx;
    return candidate?.provider as Eip1193Provider|null ?? null;
  };

  const[topupAmount,setTopupAmount]=useState("1");
  const[topupIntent,setTopupIntent]=useState<TestnetTopupIntent|null>(null);
  const[topupHash,setTopupHash]=useState("");
  const[topupEvidence,setTopupEvidence]=useState<TopupEvidence|null>(null);

  const[simulationLedger,setSimulationLedger]=useState<readonly SimulationAuditRecord[]>([]);
  const[simulationMessage,setSimulationMessage]=useState("");
  const[simulationBusy,setSimulationBusy]=useState(false);
  const[opMerchant,setOpMerchant]=useState("YNX Demo Merchant");
  const[opAmount,setOpAmount]=useState("10.00");
  const[opIdempotency,setOpIdempotency]=useState("");
  const[opAction,setOpAction]=useState<SimulationAction>("authorization");

  const mounted=useRef(true);
  const productWallet=useRef<CardProductWalletConnection|null>(null);
  const walletProvider=useRef<Eip1193Provider|null>(null);
  const walletProviderKind=useRef<WalletProviderKind|null>(null);
  const pendingAuthorization=useRef<PendingAuthorizationRequest|null>(null);
  useEffect(()=>{
    if(Platform.OS!=="web")return;
    const probe=()=>{void discoverWalletProviders(globalThis,0).catch(()=>{});};
    probe();
    const timers=[250,750,1500].map(delay=>setTimeout(probe,delay));
    const initialized=()=>probe();
    globalThis.addEventListener?.("ethereum#initialized",initialized);
    return()=>{timers.forEach(clearTimeout);globalThis.removeEventListener?.("ethereum#initialized",initialized);};
  },[]);
  const persistSimulationLedger=useCallback(async(next:readonly SimulationAuditRecord[])=>{
    const normalized=Object.freeze(next.slice(0,TESTNET_SIMULATION_MAX_EVENTS));
    await saveSimulationAudit(normalized);
    if(mounted.current)setSimulationLedger(normalized);
  },[]);

  const refresh=useCallback(async(current=session)=>{
    if(!current){setSnapshot(null);return;}
    setBusy(true);
    setError("");
    try{
      const next=await loadState(current);
      if(mounted.current)setSnapshot(next);
    }catch(e){if(mounted.current)setError(message(e,tr("offline")));}
    finally{if(mounted.current)setBusy(false)}
  },[session,tr]);

  const handleURL=useCallback(async(url:string)=>{
    if(!isCardWalletCallback(url))return;
    if(isCanonicalAuthorizationCallback(url)){
      const pendingAuthorizationValue=pendingAuthorization.current??await loadPendingAuthorization();
      if(!pendingAuthorizationValue){if(mounted.current)setWalletError("No pending YNX Wallet authorization matches this callback.");return;}
      try{
        const result=parseWalletAuthorizationCallback(url,pendingAuthorizationValue,new Date());
        pendingAuthorization.current=null;
        await savePendingAuthorization(null);
        if(mounted.current)setWalletError("decision" in result&&result.decision==="rejected"?"YNX Wallet authorization was rejected. No Card session was created.":"YNX Wallet authorization returned. Private Card service remains unavailable until separate Card API acceptance.");
      }catch(e){if(mounted.current)setWalletError(classifyCardWalletError(e).safeMessage);}
      finally{if(mounted.current)setPending(false);}
      return;
    }
    const connection=productWallet.current;
    if(!connection)return;
    setBusy(true);
    setError("");
    try{
      const outcome=await connection.handleReturn(url);
      if(mounted.current){setPrivateSession(productRuntime(outcome));setPending(false);}
    }catch(e){
      if(mounted.current){const classified=classifyCardWalletError(e);if(walletSession)setPrivateSession({state:"PRIVATE_SERVICE_DEGRADED",...classified});setPending(false);setError(classified.safeMessage);}
    }finally{
      if(mounted.current)setBusy(false);
    }
  },[refresh,tr,walletSession]);

  useEffect(()=>{
    mounted.current=true;
    void(async()=>{
      const[savedLocale,savedSession,savedLedger,savedAuthorization]=await Promise.all([
        loadLocale(),
        loadSession(),
        loadSimulationAudit(),
        loadPendingAuthorization(),
      ]);
      if(!mounted.current)return;
      if(isLocale(savedLocale))setLocaleState(savedLocale);
      setSession(savedSession);
      setSimulationLedger(savedLedger);
      pendingAuthorization.current=savedAuthorization;
      if(savedSession)await refresh(savedSession);
    })();
    const sub=Linking.addEventListener("url",event=>void handleURL(event.url));
    void Linking.getInitialURL().then(url=>{if(url)void handleURL(url);});
    return()=>{mounted.current=false;sub.remove();};
  },[handleURL,refresh]);

  const parseAmount=(value:string)=>{
    const parsed=Number(value);
    if(!Number.isFinite(parsed)||parsed<=0)throw new Error("Amount must be greater than 0");
    return Math.round(parsed*100);
  };
  const replaceRecord=(records:readonly SimulationAuditRecord[],entry:SimulationAuditRecord)=>Object.freeze(records.map(item=>item.id===entry.id?entry:item));

  const openWalletChooser=async()=>{setWalletError("");setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"OPEN_CHOOSER"}));};
  const closeWalletChooser=()=>setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"CLOSE_CHOOSER"}));
  const connectSelectedWallet=async(kind:WalletProviderKind):Promise<boolean>=>{
    setWalletBusy(true);
    setWalletError("");
    try{
      const provider=await resolveSharedProvider(kind);
      if(!provider){setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"FAIL",code:"PROVIDER_NOT_INJECTED"}));setWalletError(`No ${kind==="metamask"?"MetaMask":"YNX Wallet"} provider was announced or injected in this page. Card cannot infer whether it is uninstalled, disabled, locked, or denied site access.`);return false;}
      let connection=reduceStandardWalletConnectState(createStandardWalletConnectState(),{type:"BEGIN",pendingIntent:`card_${kind.replace("-","")}_connect_20260822`});
      connection=reduceStandardWalletConnectState(connection,{type:"PROVIDER_SELECTED",providerKind:kind});
      const next=kind==="metamask"?await connectMetaMaskWallet(new Date(),provider):await connectEip1193Wallet(provider,new Date());
      connection=reduceStandardWalletConnectState(connection,{type:"ACCOUNT_APPROVED",account:next.address});
      connection=reduceStandardWalletConnectState(connection,{type:"CHAIN_CONFIRMED",chainId:next.chainId});
      setStandardWalletState(connection);
      walletProvider.current=provider;
      walletProviderKind.current=kind;
      setWalletSession(next);
      setPrivateSession(null);
      setTopupIntent(null);
      setTopupHash("");
      setTopupEvidence(null);
      return true;
    }catch(e){setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"FAIL",code:"CONNECTION_FAILED"}));setWalletError(classifyCardWalletError(e).safeMessage);return false;}
    finally{if(mounted.current)setWalletBusy(false);}
  };
  const connectMetaMask=async()=>{await connectSelectedWallet("metamask");};

  const disconnectWallet=async()=>{
    const provider=walletProvider.current,kind=walletProviderKind.current;
    if(!provider||!kind){setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"DISCONNECT"}));setWalletSession(null);return;}
    setWalletBusy(true);setWalletError("");
    try{const result=await disconnectEip1193Wallet(provider,kind);setWalletError(result==="local-only"?"Card cleared its local Wallet connection. The Wallet still reports this site's account permission; revoke Card in the Wallet if needed.":"");setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"DISCONNECT"}));setWalletSession(null);walletProvider.current=null;walletProviderKind.current=null;setPrivateSession(null);}
    catch(e){setWalletError(classifyCardWalletError(e).safeMessage);}
    finally{if(mounted.current)setWalletBusy(false);}
  };

  const switchWalletAccount=async()=>{
    const provider=walletProvider.current,kind=walletProviderKind.current;
    if(!provider||!kind)return;
    setWalletBusy(true);setWalletError("");
    try{const accounts=await switchEip1193WalletAccount(provider,kind);const chainId=String(await provider.request({method:"eth_chainId",params:[]})??"").toLowerCase();setStandardWalletState(current=>reduceStandardWalletConnectState(reduceStandardWalletConnectState(current,{type:"ACCOUNTS_CHANGED",accounts}),{type:"CHAIN_CHANGED",chainId}));setWalletSession({address:accounts[0]!,chainId,connectedAt:new Date().toISOString(),provider:"eip1193"});}
    catch(e){setWalletError(classifyCardWalletError(e).safeMessage);}
    finally{if(mounted.current)setWalletBusy(false);}
  };

  useEffect(()=>{
    const kind=walletProviderKind.current;if(!kind||!walletSession)return;
    return watchEip1193Provider(walletProvider.current,kind,{
      accountsChanged:accounts=>{if(!mounted.current)return;setStandardWalletState(current=>current.providerKind&&current.account?reduceStandardWalletConnectState(current,{type:"ACCOUNTS_CHANGED",accounts}):current);if(!accounts[0]){setWalletSession(null);setWalletError(`${kind==="metamask"?"MetaMask":"YNX Wallet"} account access was removed.`);return;}setWalletSession(current=>current?{...current,address:accounts[0]??current.address,connectedAt:new Date().toISOString()}:current);},
      chainChanged:chainId=>{if(!mounted.current)return;setStandardWalletState(current=>current.providerKind&&current.account?reduceStandardWalletConnectState(current,{type:"CHAIN_CHANGED",chainId}):current);if(chainId!==YNX_TESTNET_CHAIN_ID){setWalletSession(null);setWalletError(`${kind==="metamask"?"MetaMask":"YNX Wallet"} switched away from YNX Testnet.`);}else setWalletSession(current=>current?{...current,chainId,connectedAt:new Date().toISOString()}:current);},
      disconnect:()=>{if(mounted.current){setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"PROVIDER_DISCONNECT"}));setWalletSession(null);setWalletError(`${kind==="metamask"?"MetaMask":"YNX Wallet"} disconnected. Reconnect to continue.`);}},
    });
  },[walletSession]);

  useEffect(()=>{
    if(Platform.OS!=="web")return;
    const restore=async()=>{if(walletSession)return;const preferred=walletProviderKind.current;const kinds:readonly WalletProviderKind[]=preferred?[preferred]:["ynx-wallet","metamask"];const restored=[] as {kind:WalletProviderKind;provider:Eip1193Provider;session:Eip1193WalletSession}[];for(const kind of kinds){const provider=await resolveSharedProvider(kind);const sessionValue=await restoreEip1193Wallet(provider,kind,new Date());if(provider&&sessionValue)restored.push({kind,provider,session:sessionValue});}if(!mounted.current)return;if(restored.length>1){setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"OPEN_CHOOSER"}));setWalletError("More than one approved Wallet was restored. Choose YNX Wallet or MetaMask to continue.");return;}if(restored.length!==1)return;const selected=restored[0]!;walletProvider.current=selected.provider;walletProviderKind.current=selected.kind;setStandardWalletState(reduceStandardWalletConnectState(createStandardWalletConnectState(),{type:"RESTORE",providerKind:selected.kind,accounts:[selected.session.address],chainId:selected.session.chainId}));setWalletSession(selected.session);setWalletError("");};
    void restore().catch(()=>{});
    const resume=()=>{if(document.visibilityState==="visible")void restore().catch(()=>{});};
    document.addEventListener("visibilitychange",resume);
    return()=>document.removeEventListener("visibilitychange",resume);
  },[walletSession]);

  const requestTopupIntent=async()=>{
    if(!session)throw new Error(tr("sessionExpired"));
    if(!walletSession)throw new Error(tr("walletNotAvailable"));
    setWalletBusy(true);
    setWalletError("");
    try{
      const amountWei=parseYnxtAmountToWei(topupAmount);
      const intent=await createTestnetTopupIntent(session,{amountWei,idempotencyKey:`topup-intent-${walletSession.address}-${amountWei}`});
      setTopupIntent(intent);
      setTopupHash("");
      setTopupEvidence(null);
      setSimulationMessage(tr("topupIntentReady"));
    }catch(e){setWalletError(message(e,tr("topupNoIntent")));}
    finally{if(mounted.current)setWalletBusy(false);}
  };

  const approveTopup=async()=>{
    if(!walletSession)throw new Error(tr("walletNotAvailable"));
    if(!topupIntent)throw new Error(tr("topupNoIntent"));
    const provider=walletProvider.current??resolveEip1193Provider();
    if(!provider){setWalletError(tr("walletNotAvailable"));return;}
    setWalletBusy(true);
    setWalletError("");
    try{
      const txHash=await approveTestnetTopup(provider,walletSession,topupIntent);
      setTopupHash(txHash);
      setTopupEvidence(null);
      setSimulationMessage(tr("topupPending"));
    }catch(e){setWalletError(message(e,tr("topupPending")));}
    finally{if(mounted.current)setWalletBusy(false);}
  };

  const verifyTopup=async()=>{
    if(!topupHash.trim()||!topupIntent||!walletSession)throw new Error(tr("topupNoIntent"));
    const provider=walletProvider.current??resolveEip1193Provider();
    if(!provider){setWalletError(tr("walletNotAvailable"));return;}
    setWalletBusy(true);
    setWalletError("");
    try{
      const evidence=await loadTestnetTopupEvidence(provider,topupHash.trim(),{...topupIntent,sender:walletSession.address});
      setTopupEvidence(evidence);
      setSimulationMessage(tr("topupEvidence"));
    }catch(e){setWalletError(message(e,tr("topupMissing")));}
    finally{if(mounted.current)setWalletBusy(false);}
  };

  const submitTopup=async()=>{
    if(!session)throw new Error(tr("sessionExpired"));
    if(!topupEvidence||!topupIntent)throw new Error(tr("topupMissing"));
    if(!walletSession)throw new Error(tr("walletNotAvailable"));
    setSimulationBusy(true);
    setSimulationMessage("");
    try{
      const input:TopupInput={intentId:topupIntent.id,txHash:topupEvidence.txHash,idempotencyKey:`topup-${topupIntent.id}-${topupEvidence.txHash}`};
      await topupTestnet(session,input);
      setSimulationMessage(tr("topupEvidence"));
      await refresh();
    }catch(e){setSimulationMessage(message(e,tr("gatewayUnavailable")));}
    finally{if(mounted.current)setSimulationBusy(false);}
  };

  const runSimulation=async(operation:SimulationAction,merchant:string,amountText:string,idempotency:string)=>{
    if(!session)throw new Error(tr("sessionExpired"));
    if(!walletSession)throw new Error(tr("walletNotAvailable"));
    if(!topupEvidence)throw new Error(tr("topupRequired"));
    const activeCard=snapshot?.cards.find(item=>item.status!=="closed")??snapshot?.cards[0];
    if(!activeCard)throw new Error(tr("unavailableTruth"));

    const amountMinor=parseAmount(amountText);
    const idempotencyKey=(idempotency.trim()||`${operation}-${activeCard.id}-${Date.now()}`).trim();

    const auditInput:LedgerSimulationInput={
      kind:operation,
      cardId:activeCard.id,
      merchant:merchant.trim(),
      amountMinor,
      currency:TESTNET_SIMULATION_CURRENCY,
      idempotencyKey,
      txHash:topupEvidence.txHash,
      chainId:topupEvidence.chainId,
    };

    const candidate=replayAwareAppend(simulationLedger,auditInput,`${operation} simulation`,new Date());
    let next=candidate.next;
    let record=candidate.entry;
    await persistSimulationLedger(next);

    if(candidate.duplicate&&record.status==="duplicate"){
      setSimulationMessage(tr("replayDetected"));
      return;
    }

    const request:SimulationPayload={
      operation,
      cardId:activeCard.id,
      merchant:merchant.trim(),
      amountMinor,
      currency:TESTNET_SIMULATION_CURRENCY,
      idempotencyKey,
      walletAddress:walletSession.address,
      topupTxHash:topupEvidence.txHash,
    };

    try{
      setSimulationBusy(true);
      if(operation==="authorization")await simulateAuthorization(session,request);
      else if(operation==="capture")await simulateCapture(session,request);
      else if(operation==="reversal")await simulateReversal(session,request);
      else await simulateRefund(session,request);
      record={...record,status:"accepted",reason:`${operation} accepted`,updatedAt:new Date().toISOString(),createdAt:record.createdAt};
      next=replaceRecord(next,record);
      await persistSimulationLedger(next);
      await refresh();
      setSimulationMessage(`${operation} ${tr("runOperation").toLowerCase()} ok`);
    }catch(e){
      record={...record,status:"failed",reason:message(e,"Operation failed"),updatedAt:new Date().toISOString(),createdAt:record.createdAt};
      next=replaceRecord(next,record);
      await persistSimulationLedger(next);
      setSimulationMessage(message(e,"Operation failed"));
    }finally{if(mounted.current)setSimulationBusy(false)}
  };

  const recoverSimulations=async()=>{
    const failed=simulationLedger.filter(isFailure);
    if(!failed.length){setSimulationMessage("");return;}
    if(!session)throw new Error(tr("sessionExpired"));
    setSimulationBusy(true);
    setSimulationMessage("");

    let next=recoverLastFailed(simulationLedger);
    await persistSimulationLedger(next);

    for(const record of failed){
      if(record.kind==="topup")continue;
      const request:SimulationPayload={
        operation:record.kind,
        cardId:record.cardId,
        merchant:record.merchant,
        amountMinor:record.amountMinor,
        currency:record.currency,
        idempotencyKey:record.idempotencyKey,
        topupTxHash:record.txHash,
      };
      try{
        if(record.kind==="authorization")await simulateAuthorization(session,request);
        else if(record.kind==="capture")await simulateCapture(session,request);
        else if(record.kind==="reversal")await simulateReversal(session,request);
        else await simulateRefund(session,request);
        next=replaceRecord(next,{...record,status:"accepted",reason:"Recovered",updatedAt:new Date().toISOString(),createdAt:record.createdAt});
      }catch(e){
        next=replaceRecord(next,{...record,status:"failed",reason:message(e,"Recovery failed"),updatedAt:new Date().toISOString(),createdAt:record.createdAt});
      }
    }

    await persistSimulationLedger(next);
    await refresh();
    if(mounted.current)setSimulationMessage(tr("recoverSimulations"));
    if(mounted.current)setSimulationBusy(false);
  };

  const beginYNXWalletAuthorization=async():Promise<"wallet-opened"|"wallet-unavailable"|"wallet-open-failed">=>{
    if(Platform.OS!=="web"){setWalletError("YNX Wallet app handoff is unavailable until a verified Universal Link or WalletConnect route is accepted.");return "wallet-unavailable";}
    return await connectSelectedWallet("ynx-wallet")?"wallet-opened":"wallet-unavailable";
  };

  const signIn=async()=>{
    if(!walletSession){setError(tr("connectWalletFirst"));return;}
    setBusy(true);
    setError("");
    setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"PRIVATE_SESSION_CONNECTING"}));
    try{
      if(Platform.OS==="web"){
        setPrivateSession({state:"PRIVATE_SERVICE_DEGRADED",...classifyCardWalletError("GATEWAY_UNAVAILABLE")});
        setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"PRIVATE_SESSION_DEGRADED",code:"GATEWAY_UNAVAILABLE"}));
        return;
      }
      const connection=await createRuntimeCardProductWalletConnection();
      productWallet.current=connection;
      const outcome=await connection.beginYNX();
      if(mounted.current){const runtime=productRuntime(outcome);setPrivateSession(runtime);setPending(productRuntimeState(outcome)==="connecting");setStandardWalletState(current=>reduceStandardWalletConnectState(current,runtime.state==="PRIVATE_SERVICE_DEGRADED"?{type:"PRIVATE_SESSION_DEGRADED",code:runtime.code}:{type:"PRIVATE_SESSION_READY"}));}
    }catch(e){
      setPending(false);
      const classified=classifyCardWalletError(e);setPrivateSession({state:"PRIVATE_SERVICE_DEGRADED",...classified});setStandardWalletState(current=>reduceStandardWalletConnectState(current,{type:"PRIVATE_SESSION_DEGRADED",code:classified.code}));setError(classified.safeMessage);
    }finally{setBusy(false)}
  };

  const setLocale=async(value:Locale)=>{setLocaleState(value);await saveLocale(value)};
  const card=snapshot?.cards.find(item=>item.status!=="closed")??snapshot?.cards[0]??null;

  const reveal=async()=>{
    if(revealed){setRevealed(false);return}
    const result=await LocalAuthentication.authenticateAsync({promptMessage:tr("reveal"),disableDeviceFallback:false,cancelLabel:tr("hide")});
    if(result.success)setRevealed(true);else setError(tr("biometricFailed"));
  };

  if(settings)return <SafeAreaProvider><Language locale={locale} setLocale={setLocale} close={()=>setSettings(false)} c={c} tr={tr}/></SafeAreaProvider>;

  return <SafeAreaProvider><SafeAreaView style={[s.safe,{backgroundColor:c.canvas},rtl&&s.rtl]}>
    <StatusBar style={dark?"light":"dark"}/>
    <View style={[s.header,{borderBottomColor:c.separator},rtl&&s.rowRTL]}>
      <View>
        <Text style={[s.eyebrow,{color:c.secondary},rtl&&s.textRTL]}>{tr("sandbox")}</Text>
        <Text style={[s.brand,{color:c.text},rtl&&s.textRTL]}>{tr("app")}</Text>
      </View>
      <View style={[s.headerActions,rtl&&s.rowRTL]}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("settings")} onPress={()=>setSettings(true)} style={[s.round,{backgroundColor:c.surface}]}> <Globe2 color={BLUE} size={19}/></Pressable>
        {session?<Pressable accessibilityRole="button" accessibilityLabel={tr("retry")} onPress={()=>void refresh()} style={[s.round,{backgroundColor:c.surface}]}> {busy?<ActivityIndicator size="small" color={BLUE}/>:<RefreshCw color={BLUE} size={19}/>} </Pressable>:null}
      </View>
    </View>

    {!session?
      <GuestExperience locale={locale} connectWallet={openWalletChooser} connectMetaMaskWallet={connectMetaMask} connectYNXWallet={beginYNXWalletAuthorization} enablePrivateServices={signIn} walletSession={walletSession} walletBusy={walletBusy} walletError={walletError} privateSession={privateSession} standardWalletState={standardWalletState} selectedWalletKind={walletProviderKind.current} closeWalletChooser={closeWalletChooser} disconnectWallet={disconnectWallet} switchWalletAccount={switchWalletAccount}/>
    :
      <>
        <View style={s.stage}>
          {tab==="card"?<CardHome c={c} tr={tr} card={card} state={snapshot} busy={busy} error={error} revealed={revealed} reveal={reveal} refresh={refresh} openApply={()=>setApplyOpen(true)} mutate={async(kind)=>{if(!card)return;if(kind==="close"&&!await confirmClose(tr("confirmClose"),tr("cancel"),tr("close")))return;await run(()=>action(session,card.id,kind,`${kind}-${card.id}-${Date.now()}`),refresh,setError)}}/>:null}
          {tab==="activity"?<Activity c={c} tr={tr} events={snapshot?.events??[]} locale={locale} card={card} session={session} refresh={refresh} setError={setError}/>:null}
          {tab==="controls"?<ControlPanel c={c} tr={tr} card={card} session={session} refresh={refresh} setError={setError}/>:null}
          {tab==="simulation"?<SimulationPanel
            c={c}
            tr={tr}
            session={session}
            card={card}
            walletSession={walletSession}
            walletBusy={walletBusy}
            walletError={walletError}
            topupAmount={topupAmount}
            setTopupAmount={setTopupAmount}
            topupIntent={topupIntent}
            topupHash={topupHash}
            topupEvidence={topupEvidence}
            connectWallet={openWalletChooser}
            requestTopupIntent={requestTopupIntent}
            approveTopup={approveTopup}
            verifyTopup={verifyTopup}
            submitTopup={submitTopup}
            simulationBusy={simulationBusy}
            simulationMessage={simulationMessage}
            simulationLedger={simulationLedger}
            opMerchant={opMerchant}
            setOpMerchant={setOpMerchant}
            opAmount={opAmount}
            setOpAmount={setOpAmount}
            opIdempotency={opIdempotency}
            setOpIdempotency={setOpIdempotency}
            opAction={opAction}
            setOpAction={setOpAction}
            runSimulation={runSimulation}
            recoverSimulations={recoverSimulations}
          />:null}
          {tab==="support"?<Support c={c} tr={tr} state={snapshot} session={session} refresh={refresh} setError={setError}/>:null}
        </View>
        <TabBar tab={tab} setTab={setTab} c={c} tr={tr}/>
      </>
    }

    <ApplySheet visible={applyOpen} close={()=>setApplyOpen(false)} c={c} tr={tr} submit={async(reference)=>{await run(()=>applyForCard(session!,{eligibilityReference:reference,legalConsentVersion:"card-testnet-v1",idempotencyKey:`apply-${Date.now()}`}),refresh,setError);setApplyOpen(false)}}/>
  </SafeAreaView></SafeAreaProvider>
}

function productRuntime(value:unknown):ProductSessionRuntime{
  const result=record(value),state=record(result?.sessionState),session=record(state?.session);
  if(state?.status==="connected"&&typeof session?.sessionBinding==="string"&&typeof session?.expiresAt==="string")return{state:"PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY",sessionBinding:session.sessionBinding,expiresAt:session.expiresAt};
  return{state:"PRIVATE_SERVICE_DEGRADED",...classifyCardWalletError({code:productRuntimeState(value)==="disconnected"?"USER_REJECTED":"PRODUCT_SESSION_GATEWAY_UNREACHABLE"})};
}
function productRuntimeState(value:unknown):string|undefined{return record(record(value)?.sessionState)?.status as string|undefined}
function record(value:unknown):Record<string,unknown>|null{return typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null}
function isCardWalletCallback(value:string):boolean{try{const callback=new URL(value);return(callback.protocol==="ynxcard:"&&callback.hostname==="wallet-auth"&&callback.pathname==="/callback")||(callback.protocol==="https:"&&callback.hostname==="card.ynxweb4.com"&&callback.pathname==="/wallet-auth/callback"&&!callback.username&&!callback.password&&!callback.hash)}catch{return false}}
function isCanonicalAuthorizationCallback(value:string):boolean{try{return new URL(value).searchParams.has("response")}catch{return false}}

function SignedOut({c,tr,busy,pending,error,signIn,walletSession,walletBusy,walletError,privateSession,connectWallet}:{c:Colors;tr:T;busy:boolean;pending:boolean;error:string;signIn:()=>Promise<void>;walletSession:Eip1193WalletSession|null;walletBusy:boolean;walletError:string;privateSession:ProductSessionRuntime|null;connectWallet:()=>Promise<void>}){
  return <ScrollView contentContainerStyle={s.center}>
    <View style={[s.securityMark,{backgroundColor:c.surface}]}><ShieldCheck color={BLUE} size={38}/></View>
    <Text style={[s.heroTitle,{color:c.text}]}>{tr("app")}</Text>
    <Text style={[s.heroBody,{color:c.secondary}]}>{tr("security")}</Text>
    <View style={[s.truth,{backgroundColor:c.surface,borderColor:c.separator}]}><Text style={[s.truthText,{color:c.secondary}]}>{tr("unavailableTruth")}</Text></View>
    {walletSession?<View style={[s.truth,{backgroundColor:c.surface,borderColor:c.separator}]}><Text style={[s.truthText,{color:c.secondary}]}>{tr("standardConnected")} · {walletSession.address.slice(0,6)}...{walletSession.address.slice(-4)} · {walletSession.chainId}</Text></View>:null}
    {privateSession?.state==="PRIVATE_SERVICE_DEGRADED"?<View style={[s.truth,{backgroundColor:c.surface,borderColor:c.separator}]}><Text accessibilityRole="alert" style={[s.truthText,{color:ORANGE}]}>{tr("privateServiceDegraded")} · {privateSession.safeMessage} · {privateSession.userAction} · {privateSession.code}{privateSession.requestId?` · ${privateSession.requestId}`:""}</Text></View>:null}
    {privateSession?.state==="PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY"?<View style={[s.truth,{backgroundColor:c.surface,borderColor:c.separator}]}><Text accessibilityRole="alert" style={[s.truthText,{color:ORANGE}]}>Private Product Session v2 source-only · Card migration remains disabled · {privateSession.sessionBinding.slice(0,12)}...</Text></View>:null}
    {walletError?<Text accessibilityRole="alert" style={s.error}>{walletError}</Text>:null}
    {error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}
    <Pressable accessibilityRole="button" disabled={walletBusy||Boolean(walletSession)} onPress={()=>void connectWallet()} style={[s.secondary,(walletBusy||Boolean(walletSession))&&s.disabled]}>{walletBusy?<ActivityIndicator color={BLUE}/>:<Text style={s.secondaryText}>{walletSession?tr("standardConnected"):tr("walletConnect")}</Text>}</Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={tr("signIn")} disabled={busy||pending} onPress={()=>void signIn()} style={[s.primary,(busy||pending)&&s.disabled]}>
      {busy?<ActivityIndicator color="white"/>:<><WalletCards color="white" size={20}/><Text style={s.primaryText}>{pending?tr("signingIn"):tr("signIn")}</Text></>}
    </Pressable>
  </ScrollView>
}

function CardHome({c,tr,card,state,busy,error,revealed,reveal,refresh,openApply,mutate}:{c:Colors;tr:T;card:Card|null;state:CardState|null;busy:boolean;error:string;revealed:boolean;reveal:()=>Promise<void>;refresh:()=>Promise<void>;openApply:()=>void;mutate:(kind:"activate"|"freeze"|"unfreeze"|"replace"|"close")=>Promise<void>}){
  if(busy&&!state)return <Loading c={c} tr={tr}/>;
  if(error&&!state)return <Failure c={c} text={error} retry={refresh} tr={tr}/>;

  if(!card){
    const status=state?.applications.at(-1)?.status;
    return <ScrollView contentContainerStyle={s.center}>
      <CreditCard color={BLUE} size={42}/>
      <Text style={[s.stateTitle,{color:c.text}]}>{status?statusLabel(status,tr):tr("apply")}</Text>
      <Text style={[s.stateBody,{color:c.secondary}]}>{status==="provider_unavailable"?tr("unavailableTruth"):tr("security")}</Text>
      {!status||status==="rejected"||status==="provider_unavailable"?<Pressable onPress={openApply} style={s.primary}><Text style={s.primaryText}>{tr("apply")}</Text></Pressable>:null}
    </ScrollView>
  }

  return <ScrollView contentContainerStyle={s.content}>
    <View style={[s.virtualCard,{backgroundColor:BLUE}]} accessible accessibilityLabel={`${tr("sandbox")}, ${statusLabel(card.status,tr)}`}>
      <View style={s.cardTop}><Text style={s.cardSandbox}>{tr("sandbox")}</Text><CreditCard color="white" size={25}/></View>
      <Text style={s.cardBrand}>YNX</Text>
      <Text style={s.cardNumber}>{revealed?`••••  ••••  ••••  ${card.last4}`:"••••  ••••  ••••  ••••"}</Text>
      <View style={s.cardBottom}>
        <View><Text style={s.cardMeta}>{tr("provider")}</Text><Text style={s.cardValue}>{revealed?card.provider:"••••••"}</Text></View>
        <View><Text style={s.cardMeta}>{tr("expires")}</Text><Text style={s.cardValue}>{revealed?`${String(card.expiryMonth).padStart(2,"0")}/${String(card.expiryYear).slice(-2)}`:"••/••"}</Text></View>
      </View>
    </View>
    <Pressable onPress={()=>void reveal()} style={s.reveal}><LockKeyhole color={BLUE} size={17}/><Text style={s.revealText}>{revealed?tr("hide"):tr("reveal")}</Text></Pressable>
      <View style={[s.statusRow,{borderColor:c.separator}]}>
      <View><Text style={[s.caption,{color:c.secondary}]}>{tr("network")}</Text><Text style={[s.rowValue,{color:c.text}]}>{card.network}</Text></View>
      <Text style={[s.status,{color:statusColor(card.status)}]}>{statusLabel(card.status,tr)}</Text>
    </View>
    {error?<Text style={s.error}>{error}</Text>:null}
    <View style={s.actionRow}>
      {card.status==="issued_sandbox"?<Action icon={<ArrowUpRight color={BLUE}/>} label={tr("activate")} onPress={()=>void mutate("activate")} c={c}/>:null}
      {card.status==="active"?<Action icon={<ShieldCheck color={BLUE}/>} label={tr("freeze")} onPress={()=>void mutate("freeze")} c={c}/>:null}
      {card.status==="frozen"?<Action icon={<ShieldCheck color={BLUE}/>} label={tr("unfreeze")} onPress={()=>void mutate("unfreeze")} c={c}/>:null}
      <Action icon={<RefreshCw color={BLUE}/>} label={tr("replace")} onPress={()=>void mutate("replace")} c={c}/>
      <Action icon={<X color={RED}/>} label={tr("close")} onPress={()=>void mutate("close")} c={c}/>
    </View>
  </ScrollView>
}

function Activity({c,tr,events,locale,card,session,refresh,setError}:{c:Colors;tr:T;events:readonly CardEvent[];locale:Locale;card:Card|null;session:CardSession;refresh:()=>Promise<void>;setError:(v:string)=>void}){
  const[selected,setSelected]=useState<CardEvent|null>(null),[reason,setReason]=useState(""),[submitting,setSubmitting]=useState(false);
  if(!events.length)return <Empty c={c} icon={<ReceiptText color={BLUE} size={38}/>} title={tr("emptyActivity")} body={tr("security")}/>;
  return <><FlatList contentContainerStyle={s.list} data={events} keyExtractor={item=>item.id} renderItem={({item})=><View style={[s.event,{borderBottomColor:c.separator}]}>
    <View style={[s.eventIcon,{backgroundColor:item.type==="decline"?"#FEF3F2":"#ECFDF3"}]}><ReceiptText color={item.type==="decline"?RED:GREEN} size={18}/></View>
    <View style={s.eventMain}><Text style={[s.rowValue,{color:c.text}]}>{item.merchant}</Text><Text style={[s.caption,{color:c.secondary}]}>{eventLabel(item.type,tr)} · {date(locale,item.occurredAt)}</Text>{item.reasonCode?<Text style={[s.caption,{color:ORANGE}]}>{item.reasonCode}</Text>:null}</View>
    <View style={s.eventAmount}><Text style={[s.rowValue,{color:c.text}]}>{money(locale,item.amountMinor,item.currency)}</Text>{item.type==="decline"?<View style={s.inline}><Pressable onPress={()=>void run(()=>explain(session,{workflow:"card_decline_explanation",contextEventId:item.id,outputLanguage:locale,permission:"allow_once"}),refresh,setError)}><Text style={s.link}>{tr("explain")}</Text></Pressable>{card?<Pressable onPress={()=>{setReason("");setSelected(item)}}><Text style={s.link}>{tr("dispute")}</Text></Pressable>:null}</View>:null}</View>
  </View>}/><Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={()=>setSelected(null)}><View style={s.modalShade}><View style={[s.sheet,{backgroundColor:c.surface}]}><View style={s.sheetHandle}/><Text style={[s.sectionTitle,{color:c.text}]}>{tr("dispute")}</Text><Text style={[s.caption,{color:c.secondary}]}>{selected?.merchant} · {selected?money(locale,selected.amountMinor,selected.currency):""}</Text><TextInput accessibilityLabel={tr("dispute")} multiline value={reason} onChangeText={setReason} style={[s.input,s.disputeInput,{color:c.text,borderColor:c.separator,backgroundColor:c.canvas}]}/><Pressable disabled={reason.trim().length<8||submitting} onPress={async()=>{if(!selected||!card)return;setSubmitting(true);try{await run(()=>openDispute(session,card.id,{eventId:selected.id,reason:reason.trim(),idempotencyKey:`dispute-${Date.now()}`}),refresh,setError);setSelected(null)}finally{setSubmitting(false)}}} style={[s.primary,(reason.trim().length<8||submitting)&&s.disabled]}>{submitting?<ActivityIndicator color="white"/>:<Text style={s.primaryText}>{tr("dispute")}</Text>}</Pressable><Pressable onPress={()=>setSelected(null)} style={s.secondary}><Text style={s.secondaryText}>{tr("done")}</Text></Pressable></View></View></Modal></>
}

function ControlPanel({c,tr,card,session,refresh,setError}:{c:Colors;tr:T;card:Card|null;session:CardSession;refresh:()=>Promise<void>;setError:(v:string)=>void}){
  const[limit,setLimit]=useState(card?String(card.controls.spendLimitMinor/100):"0"),[online,setOnline]=useState(card?.controls.online??false),[international,setInternational]=useState(card?.controls.international??false),[atm,setATM]=useState(card?.controls.atm??false),[allowedMcc,setAllowedMcc]=useState(card?.controls.allowedMcc.join(", ")??""),[blockedMcc,setBlockedMcc]=useState(card?.controls.blockedMcc.join(", ")??""),[countries,setCountries]=useState(card?.controls.allowedCountries.join(", ")??"");
  useEffect(()=>{if(card){setLimit(String(card.controls.spendLimitMinor/100));setAllowedMcc(card.controls.allowedMcc.join(", "));setBlockedMcc(card.controls.blockedMcc.join(", "));setCountries(card.controls.allowedCountries.join(", "))}},[card?.id,card?.updatedAt]);
  if(!card)return <Empty c={c} icon={<SlidersHorizontal color={BLUE} size={38}/>} title={tr("controls")} body={tr("unavailableTruth")}/>;
  const toggle=(label:string,value:boolean,setter:(v:boolean)=>void)=><View style={[s.setting,{borderBottomColor:c.separator}]}><Text style={[s.rowValue,{color:c.text}]}>{label}</Text><Switch value={value} onValueChange={setter} trackColor={{true:BLUE}}/></View>;
  const values=(v:string)=>v.split(",").map(item=>item.trim().toUpperCase()).filter(Boolean);
  const valid=Number.isFinite(Number(limit))&&Number(limit)>=0&&values(allowedMcc).every(v=>/^\d{4}$/.test(v))&&values(blockedMcc).every(v=>/^\d{4}$/.test(v))&&values(countries).every(v=>/^[A-Z]{2}$/.test(v));
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={[s.sectionTitle,{color:c.text}]}>{tr("controls")}</Text>
    <Text style={[s.caption,{color:c.secondary}]}>{tr("controlHint")}</Text>
    <Text style={[s.label,{color:c.secondary}]}>{tr("spendLimit")} (USD)</Text>
    <TextInput keyboardType="decimal-pad" value={limit} onChangeText={setLimit} style={[s.input,{color:c.text,backgroundColor:c.surface,borderColor:c.separator}]}/>
    {toggle(tr("online"),online,setOnline)}
    {toggle(tr("international"),international,setInternational)}
    {toggle(tr("atm"),atm,setATM)}
    <ControlInput label={tr("allowedMcc")} value={allowedMcc} setValue={setAllowedMcc} c={c}/>
    <ControlInput label={tr("blockedMcc")} value={blockedMcc} setValue={setBlockedMcc} c={c}/>
    <ControlInput label={tr("allowedCountries")} value={countries} setValue={setCountries} c={c}/>
    <Pressable disabled={!valid} onPress={()=>void run(()=>updateControls(session,card.id,{spendLimitMinor:Math.round(Number(limit)*100),currency:"USD",online,international,atm,allowedMcc:values(allowedMcc),blockedMcc:values(blockedMcc),allowedCountries:values(countries),idempotencyKey:`controls-${Date.now()}`}),refresh,setError)} style={[s.primary,!valid&&s.disabled]}><Text style={s.primaryText}>{tr("save")}</Text></Pressable>
  </ScrollView>
}

function ControlInput({label,value,setValue,c}:{label:string;value:string;setValue:(v:string)=>void;c:Colors}){
  return <><Text style={[s.label,{color:c.secondary}]}>{label}</Text><TextInput autoCapitalize="characters" autoCorrect={false} value={value} onChangeText={setValue} style={[s.input,{color:c.text,backgroundColor:c.surface,borderColor:c.separator}]}/></>
}

function SimulationPanel({
  c,tr,session,card,walletSession,walletBusy,walletError,topupAmount,setTopupAmount,topupIntent,topupHash,topupEvidence,connectWallet,requestTopupIntent,approveTopup,verifyTopup,submitTopup,simulationBusy,simulationMessage,simulationLedger,opMerchant,setOpMerchant,opAmount,setOpAmount,opIdempotency,setOpIdempotency,opAction,setOpAction,runSimulation,recoverSimulations,
}:{
  c:Colors;tr:T;session:CardSession;card:Card|null;walletSession:Eip1193WalletSession|null;walletBusy:boolean;walletError:string;topupAmount:string;setTopupAmount:(v:string)=>void;topupIntent:TestnetTopupIntent|null;topupHash:string;topupEvidence:TopupEvidence|null;connectWallet:()=>Promise<void>;requestTopupIntent:()=>Promise<void>;approveTopup:()=>Promise<void>;verifyTopup:()=>Promise<void>;submitTopup:()=>Promise<void>;simulationBusy:boolean;simulationMessage:string;simulationLedger:readonly SimulationAuditRecord[];opMerchant:string;setOpMerchant:(v:string)=>void;opAmount:string;setOpAmount:(v:string)=>void;opIdempotency:string;setOpIdempotency:(v:string)=>void;opAction:SimulationAction;setOpAction:(v:SimulationAction)=>void;runSimulation:(operation:SimulationAction,merchant:string,amount:string,idempotency:string)=>Promise<void>;recoverSimulations:()=>Promise<void>;
}){
  const failed=simulationLedger.filter(isFailure);
  const operationLabel:(operation:SimulationAction)=>string=operation=>"authorization"===operation?tr("simulateAuthorization"):operation==="capture"?tr("simulateCapture"):operation==="reversal"?tr("simulateReversal"):tr("simulateRefund");
  const shortAddress=(address:string)=>`${address.slice(0,6)}...${address.slice(-4)}`;

  return <ScrollView contentContainerStyle={s.content}>
    <Text style={[s.sectionTitle,{color:c.text}]}>{tr("simulation")}</Text>
    <Text style={[s.caption,{color:c.secondary}]}>{tr("testnetSimulation")}</Text>

    <View style={s.simSection}>
      <Text style={[s.label,{color:c.secondary}]}>{tr("walletConnect")}</Text>
      {walletSession?<Text style={[s.caption,{color:c.text}]}>{tr("walletConnected")} · {shortAddress(walletSession.address)} ({walletSession.chainId})</Text>:null}
      {walletError?<Text style={s.error}>{walletError}</Text>:null}
      <Pressable accessibilityRole="button" disabled={walletBusy||Boolean(walletSession)} onPress={()=>void connectWallet()} style={[s.secondary,(walletBusy||Boolean(walletSession))&&s.disabled]}>{walletBusy?<ActivityIndicator color={BLUE}/>:<Text style={s.secondaryText}>{tr("walletConnect")}</Text>}</Pressable>
    </View>

    <View style={s.simSection}>
      <Text style={[s.label,{color:c.secondary}]}>{tr("topupAmount")}</Text>
      <TextInput autoCapitalize="none" keyboardType="decimal-pad" value={topupAmount} onChangeText={setTopupAmount} style={[s.input,{color:c.text,backgroundColor:c.surface,borderColor:c.separator}]}/>
      <Pressable accessibilityRole="button" disabled={walletBusy||!walletSession||!session} onPress={()=>void requestTopupIntent()} style={[s.primary,(walletBusy||!walletSession||!session)&&s.disabled]}>{walletBusy?<ActivityIndicator color="white"/>:<Text style={s.primaryText}>{tr("topupIntent")}</Text>}</Pressable>
      {topupIntent?<Text style={[s.caption,{color:c.secondary}]}>{tr("topupIntentReady")} · {topupIntent.recipient} · {topupIntent.amountWei} wei</Text>:null}
      <Pressable accessibilityRole="button" disabled={walletBusy||!walletSession||!topupIntent} onPress={()=>void approveTopup()} style={[s.secondary,(walletBusy||!walletSession||!topupIntent)&&s.disabled]}>{walletBusy?<ActivityIndicator color={BLUE}/>:<Text style={s.secondaryText}>{tr("approveTopup")}</Text>}</Pressable>
      {topupHash?<Text style={[s.caption,{color:c.secondary}]}>{tr("topupTxHash")}: {topupHash}</Text>:null}
      <Pressable accessibilityRole="button" disabled={walletBusy||!topupHash.trim()||!topupIntent} onPress={()=>void verifyTopup()} style={[s.primary,(walletBusy||!topupHash.trim()||!topupIntent)&&s.disabled]}>{walletBusy?<ActivityIndicator color="white"/>:<Text style={s.primaryText}>{tr("verifyTopup")}</Text>}</Pressable>
      {topupEvidence?
        <Text style={[s.caption,{color:c.secondary}]}>Chain {tr("topupEvidence")}: {topupEvidence.txHash} ({topupEvidence.chainId})</Text>
        :null}
      <Text style={[s.caption,{color:c.secondary}]}>{tr("chainRequirement")}</Text>
      <Pressable accessibilityRole="button" disabled={simulationBusy||!topupEvidence||!session} onPress={()=>void submitTopup()} style={[s.secondary,(simulationBusy||!topupEvidence||!session)&&s.disabled]}>{simulationBusy?<ActivityIndicator color={BLUE}/>:<Text style={s.secondaryText}>{tr("topupEvidence")}</Text>}</Pressable>
    </View>

    <View style={s.simSection}>
      <Text style={[s.label,{color:c.secondary}]}>{tr("merchant")}</Text>
      <TextInput autoCapitalize="words" value={opMerchant} onChangeText={setOpMerchant} style={[s.input,{color:c.text,backgroundColor:c.surface,borderColor:c.separator}]}/>
      <Text style={[s.label,{color:c.secondary}]}>{tr("amountMinor")}</Text>
      <TextInput keyboardType="decimal-pad" value={opAmount} onChangeText={setOpAmount} style={[s.input,{color:c.text,backgroundColor:c.surface,borderColor:c.separator}]}/>
      <Text style={[s.label,{color:c.secondary}]}>{tr("idempotencyHint")}</Text>
      <TextInput autoCapitalize="none" value={opIdempotency} onChangeText={setOpIdempotency} style={[s.input,{color:c.text,backgroundColor:c.surface,borderColor:c.separator}]}/>
      <Text style={[s.label,{color:c.secondary}]}>{tr("simulationOperations")}</Text>
      <View style={s.simActionRow}>
        {(["authorization","capture","reversal","refund"] as SimulationAction[]).map(kind=><Pressable key={kind} onPress={()=>setOpAction(kind)} style={[s.simAction,opAction===kind&&s.simActionActive]}><Text style={[s.simActionText,{color:opAction===kind?BLUE:c.text}]}>{operationLabel(kind)}</Text></Pressable>)}
      </View>
      {(!walletSession||!topupEvidence||!topupHash)?<Text style={s.caption}>{tr("topupRequired")}</Text>:null}
      <Pressable accessibilityRole="button" disabled={!walletSession||!topupEvidence||!card||simulationBusy} onPress={async()=>{await runSimulation(opAction,opMerchant,opAmount,opIdempotency)} } style={[s.primary,(!walletSession||!topupEvidence||!card||simulationBusy)&&s.disabled]}>
        {simulationBusy?<ActivityIndicator color="white"/>:<Text style={s.primaryText}>{tr("runOperation")}</Text>}
      </Pressable>
      {simulationMessage?<Text style={[s.caption,{color:c.secondary}]}>{simulationMessage}</Text>:null}
    </View>

    <View style={s.simSection}>
      <View style={s.rowBetween}><Text style={[s.label,{color:c.secondary}]}>{tr("simulationAudit")}</Text><Text style={s.badge}>{failed.length?`${failed.length} failed`:""}</Text></View>
      {(!simulationLedger.length)?<Text style={[s.caption,{color:c.secondary}]}>{tr("noAuditRecords")}</Text>:null}
      <FlatList data={simulationLedger} keyExtractor={item=>item.id} renderItem={({item})=><View style={[s.simItem,{borderBottomColor:c.separator}]}><View style={s.simItemHeader}><Text style={[s.rowValue,{color:c.text}]}>{item.kind} · {item.merchant}</Text><Text style={[s.smallTag,{color:statusColor(item.status)}]}>{item.status}</Text></View><Text style={[s.caption,{color:c.secondary}]}>${money("en",item.amountMinor,item.currency)} · {item.idempotencyKey} · {item.reason}</Text></View>} contentContainerStyle={s.list}/>
      <Pressable accessibilityRole="button" disabled={!failed.length||simulationBusy} onPress={()=>void recoverSimulations()} style={[s.secondary,(!failed.length||simulationBusy)&&s.disabled]}><Text style={s.secondaryText}>{tr("recoverSimulations")}</Text></Pressable>
    </View>
  </ScrollView>
}

function Support({c,tr,state,session,refresh,setError}:{c:Colors;tr:T;state:CardState|null;session:CardSession;refresh:()=>Promise<void>;setError:(v:string)=>void}){
  const pending=state?.aiRuns.filter(run=>run.status==="review")??[];
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={[s.sectionTitle,{color:c.text}]}>{tr("support")}</Text>
    <View style={[s.supportBlock,{borderColor:c.separator}]}> <ShieldCheck color={BLUE} size={24}/><View style={s.supportCopy}><Text style={[s.rowValue,{color:c.text}]}>{tr("security")}</Text><Text style={[s.caption,{color:c.secondary}]}>{tr("reviewOnly")}</Text></View></View>
    <Text style={[s.label,{color:c.secondary}]}>{"Notifications"}</Text>
    {state?.notifications.length?state.notifications.map(item=><View key={item.id} style={[s.notice,{borderBottomColor:c.separator}]}><Text style={[s.rowValue,{color:c.text}]}>{item.title}</Text><Text style={[s.caption,{color:c.secondary}]}>{item.body}</Text></View>):<Text style={[s.caption,{color:c.secondary}]}>No notifications</Text>}
    <Text style={[s.label,{color:c.secondary}]}>{"AI review"}</Text>
    {pending.map(run=><View key={run.id} style={[s.review,{borderColor:c.separator}]}><Text style={[s.rowValue,{color:c.text}]}>{run.draft}</Text><Text style={[s.caption,{color:c.secondary}]}>{run.provider} · {run.model} · {run.costUnits??0}</Text><View style={s.reviewActions}><Pressable onPress={()=>void runAction(()=>reviewAI(session,run.id,"reject"),refresh,setError)}><Text style={[s.link,{color:RED}]}>Reject</Text></Pressable><Pressable onPress={()=>void runAction(()=>reviewAI(session,run.id,"apply"),refresh,setError)}><Text style={s.link}>Approve</Text></Pressable></View></View>)}
    {!pending.length?<Text style={[s.caption,{color:c.secondary}]}>No AI review</Text>:null}
    <Text style={[s.caption,{color:c.secondary,marginTop:20}]}>{`${tr("auditEvents")}: ${state?.audit.length??0}`}</Text>
  </ScrollView>
}

function ApplySheet({visible,close,c,tr,submit}:{visible:boolean;close:()=>void;c:Colors;tr:T;submit:(reference:string)=>Promise<void>}){
  const[reference,setReference]=useState("");
  const[consent,setConsent]=useState(false);
  const[busy,setBusy]=useState(false);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}><View style={s.modalShade}><View style={[s.sheet,{backgroundColor:c.surface}]}><View style={s.sheetHandle}/><Text style={[s.sectionTitle,{color:c.text}]}>{tr("apply")}</Text>
    <Text style={[s.label,{color:c.secondary}]}>{tr("eligibilityReference")}</Text>
    <TextInput autoCapitalize="none" value={reference} onChangeText={setReference} style={[s.input,{color:c.text,borderColor:c.separator,backgroundColor:c.canvas}]}/>
    <Pressable onPress={()=>setConsent(!consent)} style={s.consent}><View style={[s.check,consent&&{backgroundColor:BLUE,borderColor:BLUE}]}>{consent?<Text style={{color:"white"}}>✓</Text>:null}</View><Text style={[s.consentText,{color:c.text}]}>{tr("consent")}</Text></Pressable>
    <Pressable disabled={!consent||reference.trim().length<8||busy} onPress={async()=>{setBusy(true);try{await submit(reference.trim())}finally{setBusy(false)}}} style={[s.primary,(!consent||reference.trim().length<8||busy)&&s.disabled]}>{busy?<ActivityIndicator color="white"/>:<Text style={s.primaryText}>{tr("submitApplication")}</Text>}</Pressable>
    <Pressable onPress={close} style={s.secondary}><Text style={s.secondaryText}>{tr("done")}</Text></Pressable>
  </View></View></Modal>
}

function TabBar({tab,setTab,c,tr}:{tab:Tab;setTab:(v:Tab)=>void;c:Colors;tr:T}){
  const items:[Tab,React.ReactNode,string][]=[
    ["card",<CreditCard/>,tr("overview")],
    ["activity",<ReceiptText/>,tr("activity")],
    ["controls",<SlidersHorizontal/>,tr("controls")],
    ["simulation",<RefreshCw/>,tr("simulation")],
    ["support",<LifeBuoy/>,tr("support")]
  ];
  return <View style={[s.tabs,{backgroundColor:c.surface,borderTopColor:c.separator}]}>
    {items.map(([value,icon,label])=><Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:tab===value}} onPress={()=>setTab(value)} style={s.tab}>{React.cloneElement(icon as React.ReactElement<{color:string;size:number}>,{color:tab===value?BLUE:c.secondary,size:21})}<Text style={[s.tabText,{color:tab===value?BLUE:c.secondary}]}>{label}</Text></Pressable>)}
  </View>
}

function Language({locale,setLocale,close,c,tr}:{locale:Locale;setLocale:(v:Locale)=>Promise<void>;close:()=>void;c:Colors;tr:T}){
  return <SafeAreaView style={[s.safe,{backgroundColor:c.canvas}]}><View style={[s.header,{borderBottomColor:c.separator}]}><Text style={[s.sectionTitle,{color:c.text}]}>{tr("settings")}</Text><Pressable onPress={close}><Text style={s.link}>{tr("done")}</Text></Pressable></View><FlatList data={locales} keyExtractor={v=>v} renderItem={({item})=><Pressable accessibilityRole="radio" accessibilityState={{checked:item===locale}} onPress={()=>void setLocale(item)} style={[s.locale,{borderBottomColor:c.separator}]}><Text style={[s.rowValue,{color:c.text}]}>{localeNames[item]}</Text>{item===locale?<Text style={s.link}>✓</Text>:null}</Pressable>}/></SafeAreaView>
}

function Action({icon,label,onPress,c}:{icon:React.ReactNode;label:string;onPress:()=>void;c:Colors}){return <Pressable accessibilityRole="button" onPress={onPress} style={s.action}><View style={[s.actionIcon,{backgroundColor:c.surface}]}>{icon}</View><Text style={[s.actionText,{color:c.text}]}>{label}</Text></Pressable>}

function Loading({c,tr}:{c:Colors;tr:T}){return <View style={s.center}><ActivityIndicator color={BLUE}/><Text style={[s.stateBody,{color:c.secondary}]}>{tr("loading")}</Text></View>}
function Failure({c,text,retry,tr}:{c:Colors;text:string;retry:()=>Promise<void>;tr:T}){return <View style={s.center}><Text style={s.error}>{text}</Text><Pressable onPress={()=>void retry()} style={s.primary}><Text style={s.primaryText}>{tr("retry")}</Text></Pressable></View>}
function Empty({c,icon,title,body}:{c:Colors;icon:React.ReactNode;title:string;body:string}){return <View style={s.center}>{icon}<Text style={[s.stateTitle,{color:c.text}]}>{title}</Text><Text style={[s.stateBody,{color:c.secondary}]}>{body}</Text></View>}

async function run(operation:()=>Promise<unknown>,refresh:()=>Promise<void>,setError:(v:string)=>void){setError("");try{await operation();await refresh()}catch(e){setError(message(e,"Operation failed"));}}
const runAction=run;
async function confirmClose(text:string,cancel:string,close:string):Promise<boolean>{return await new Promise(resolve=>Alert.alert("YNX Card",text,[{text:cancel,style:"cancel",onPress:()=>resolve(false)},{text:close,style:"destructive",onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}))}
function message(error:unknown,fallback:string):string{return error instanceof Error&&error.message?error.message:fallback}
function statusLabel(value:string,tr:T):string{const map:Record<string,keyof typeof catalogs.en>={provider_unavailable:"providerUnavailable",pending_review:"pendingReview",rejected:"rejected",issued_sandbox:"issued",active:"active",frozen:"frozen",closed:"closed"};return tr(map[value]??"providerUnavailable")}
function eventLabel(value:CardEvent["type"],tr:T):string{return tr(({authorization:"authorized",reversal:"reversed",clearing:"cleared",decline:"declined",refund:"refunded"}as const)[value])}
function statusColor(value:string):string{return value==="active"?GREEN:value==="frozen"?ORANGE:value==="closed"?RED:BLUE}
type T=(key:keyof typeof catalogs.en)=>string;type Colors={canvas:string;surface:string;text:string;secondary:string;separator:string};
const lightColors={canvas:"#F7F7F8",surface:"#FFFFFF",text:"#1D1D1F",secondary:"#6E6E73",separator:"#D2D2D7"};
const darkColors={canvas:"#000000",surface:"#1C1C1E",text:"#F5F5F7",secondary:"#AEAEB2",separator:"#38383A"};

const s=StyleSheet.create({
  safe:{flex:1},
  rtl:{direction:"rtl"},
  rowRTL:{flexDirection:"row-reverse"},
  textRTL:{textAlign:"right"},
  header:{minHeight:72,paddingHorizontal:20,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  eyebrow:{fontSize:11,fontWeight:"700",letterSpacing:1.1},
  brand:{fontSize:25,fontWeight:"700",letterSpacing:-.5},
  headerActions:{flexDirection:"row",gap:10},
  round:{width:42,height:42,borderRadius:21,alignItems:"center",justifyContent:"center"},
  stage:{flex:1},
  content:{padding:20,paddingBottom:40},
  center:{flexGrow:1,alignItems:"center",justifyContent:"center",padding:28,gap:14},
  securityMark:{width:72,height:72,borderRadius:36,alignItems:"center",justifyContent:"center"},
  heroTitle:{fontSize:32,fontWeight:"700",letterSpacing:-.8,textAlign:"center"},
  heroBody:{fontSize:16,lineHeight:23,textAlign:"center",maxWidth:360},
  truth:{padding:14,borderRadius:12,borderWidth:StyleSheet.hairlineWidth,maxWidth:390},
  truthText:{fontSize:13,lineHeight:19,textAlign:"center"},
  primary:{minHeight:50,borderRadius:13,paddingHorizontal:20,backgroundColor:BLUE,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9,marginTop:12},
  primaryText:{color:"white",fontSize:16,fontWeight:"600"},
  secondary:{minHeight:46,alignItems:"center",justifyContent:"center",marginTop:6,borderWidth:StyleSheet.hairlineWidth,borderRadius:13},
  secondaryText:{color:BLUE,fontSize:16,fontWeight:"600"},
  disabled:{opacity:.45},
  error:{color:RED,fontSize:14,lineHeight:20,textAlign:"center"},
  virtualCard:{aspectRatio:1.586,borderRadius:22,padding:22,justifyContent:"space-between",shadowColor:"#000",shadowOpacity:.2,shadowRadius:18,shadowOffset:{width:0,height:9},elevation:8},
  cardTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  cardSandbox:{color:"white",fontSize:11,fontWeight:"800",letterSpacing:1.2},
  cardBrand:{color:"white",fontSize:28,fontWeight:"800"},
  cardNumber:{color:"white",fontSize:20,letterSpacing:2,fontVariant:["tabular-nums"]},
  cardBottom:{flexDirection:"row",justifyContent:"space-between"},
  cardMeta:{color:"rgba(255,255,255,.68)",fontSize:10,textTransform:"uppercase",letterSpacing:.8},
  cardValue:{color:"white",fontSize:13,fontWeight:"600",marginTop:3,maxWidth:180},
  reveal:{flexDirection:"row",gap:7,alignItems:"center",alignSelf:"center",padding:14},
  revealText:{color:BLUE,fontWeight:"600"},
  statusRow:{borderTopWidth:StyleSheet.hairlineWidth,borderBottomWidth:StyleSheet.hairlineWidth,paddingVertical:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  caption:{fontSize:12,lineHeight:17},
  rowValue:{fontSize:15,fontWeight:"600"},
  status:{fontSize:13,fontWeight:"700"},
  actionRow:{flexDirection:"row",justifyContent:"space-around",marginTop:20},
  action:{width:92,alignItems:"center",gap:8},
  actionIcon:{width:48,height:48,borderRadius:24,alignItems:"center",justifyContent:"center"},
  actionText:{fontSize:12,textAlign:"center"},
  stateTitle:{fontSize:23,fontWeight:"700",textAlign:"center"},
  stateBody:{fontSize:15,lineHeight:22,textAlign:"center"},
  tabs:{height:72,borderTopWidth:StyleSheet.hairlineWidth,flexDirection:"row",paddingBottom:6},
  tab:{flex:1,alignItems:"center",justifyContent:"center",gap:4},
  tabText:{fontSize:10,fontWeight:"600"},
  list:{paddingHorizontal:20,paddingBottom:30},
  event:{minHeight:78,borderBottomWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",gap:12},
  eventIcon:{width:38,height:38,borderRadius:19,alignItems:"center",justifyContent:"center"},
  eventMain:{flex:1},
  eventAmount:{alignItems:"flex-end",gap:5},
  inline:{flexDirection:"row",gap:10},
  link:{color:BLUE,fontSize:12,fontWeight:"600"},
  sectionTitle:{fontSize:24,fontWeight:"700",letterSpacing:-.4},
  label:{fontSize:12,fontWeight:"600",marginTop:20,marginBottom:7},
  input:{minHeight:48,borderWidth:StyleSheet.hairlineWidth,borderRadius:11,paddingHorizontal:13,fontSize:16},
  disputeInput:{minHeight:110,textAlignVertical:"top",paddingTop:12,marginTop:14},
  setting:{minHeight:56,borderBottomWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  supportBlock:{borderTopWidth:StyleSheet.hairlineWidth,borderBottomWidth:StyleSheet.hairlineWidth,paddingVertical:18,flexDirection:"row",gap:14,marginTop:18},
  supportCopy:{flex:1,gap:5},
  notice:{paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,gap:4},
  review:{padding:14,borderWidth:StyleSheet.hairlineWidth,borderRadius:12,marginTop:10,gap:7},
  reviewActions:{flexDirection:"row",justifyContent:"flex-end",gap:20,marginTop:7},
  modalShade:{flex:1,backgroundColor:"rgba(0,0,0,.45)",justifyContent:"flex-end"},
  sheet:{padding:20,paddingBottom:34,borderTopLeftRadius:24,borderTopRightRadius:24},
  sheetHandle:{width:38,height:5,borderRadius:3,backgroundColor:"#8E8E93",opacity:.5,alignSelf:"center",marginBottom:18},
  consent:{flexDirection:"row",gap:10,alignItems:"center",marginTop:18},
  check:{width:22,height:22,borderRadius:6,borderWidth:1,borderColor:"#8E8E93",alignItems:"center",justifyContent:"center"},
  consentText:{flex:1,fontSize:14,lineHeight:20},
  locale:{minHeight:56,paddingHorizontal:20,borderBottomWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  simSection:{paddingVertical:12,gap:10},
  simActionRow:{flexDirection:"row",flexWrap:"wrap",gap:6},
  simAction:{minHeight:38,borderRadius:10,paddingHorizontal:12,justifyContent:"center",borderWidth:StyleSheet.hairlineWidth,borderColor:"#DADCE0",backgroundColor:"#FAFBFD"},
  simActionActive:{borderColor:BLUE,backgroundColor:"#E8F0FF"},
  simActionText:{fontSize:12,fontWeight:"600"},
  smallTag:{fontSize:10,textTransform:"capitalize",backgroundColor:"#ECEFF3",paddingHorizontal:8,paddingVertical:2,borderRadius:8},
  simItem:{borderBottomWidth:StyleSheet.hairlineWidth,paddingVertical:10,gap:6},
  simItemHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  rowBetween:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  badge:{fontSize:12,color:ORANGE,paddingHorizontal:8,paddingVertical:2,borderRadius:8,backgroundColor:"#fff4ec"},
});
