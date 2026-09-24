import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import type { WalletAccount } from "../storage/walletRepository";
import { createWalletConnectSessionApproval,evmAddressFromYNX,parseWalletConnectPairingUri,reviewWalletConnectSessionProposal,walletConnectRejection,type WalletConnectRequestReview,type WalletConnectSessionReview } from "@ynx-chain/wallet-auth";
import { consumeWalletConnectDeepLink, subscribeWalletConnectDeepLinks } from "./inbox";
import { WalletConnectRuntime, walletConnectRuntimeConfig, type WalletConnectSnapshot } from "./runtime";
import { platformSecureStorage } from "../storage/secureStorage";
import { WalletConnectSecurityStore, type WalletConnectResponseRecord } from "./securityStore";
import { prepareEvmRequest,signPreparedEvmRequest,WalletConnectBroadcastJournal,type BroadcastRecord,type PreparedEvmRequest,type SignedEvmTransaction } from "./evm";
import { reviewWalletConnectQrPayload } from "./qr";
import { createPersistAndPublishWalletConnectSession,revokeAndDisconnectWalletConnectSession } from "./sessionApproval";
import { currentWalletConnectDelivery } from "./deliveryGuard";
import { getBytes,verifyMessage,verifyTypedData } from "ethers";
import type { WalletOperationLifecycle } from "../security/operationLifecycle";

let configError: string | null = null;
let config = null;
try { config = walletConnectRuntimeConfig(); } catch (error) { configError = error instanceof Error ? error.message : "WalletConnect configuration is invalid."; }
export const walletConnectRuntime = new WalletConnectRuntime(config);
const securityStore=new WalletConnectSecurityStore(platformSecureStorage),broadcastJournal=new WalletConnectBroadcastJournal(platformSecureStorage);
const deliveriesInFlight=new Set<string>();
const deliveryRetryCounts=new Map<string,number>();
let lockRecovery:Promise<void>=Promise.resolve();
type SecretAccess=<T>(account:string,assertCurrent:()=>void,use:(secret:string,assertKeyCurrent:()=>void)=>T|Promise<T>)=>Promise<T>;
const recoverableRecord=(item:WalletConnectResponseRecord,account:string)=>item.account===account&&item.expiresAt>new Date().toISOString()&&["reviewing","authorized","executing"].includes(item.stage);

export function closeWalletConnectForLock(nativeAccount?:string):Promise<void>{
  const current=walletConnectRuntime.snapshot(),pending=current.request??current.sessionEvent?.pendingRequest;
  walletConnectRuntime.clearSensitiveReview();
  void walletConnectRuntime.rejectProposal().catch(()=>{});
  if(!pending)return lockRecovery;
  lockRecovery=lockRecovery.then(async()=>{const rows=await securityStore.outbox();
    const record=rows.find(item=>item.topic===pending.topic&&item.requestId===pending.id&&item.stage==="reviewing");
    if(record)await securityStore.recoverReviewingResponse(record.key);
    else if(!rows.some(item=>item.topic===pending.topic&&item.requestId===pending.id)&&nativeAccount){
      try{await securityStore.rejectUnreviewedRequest(pending,evmAddressFromYNX(nativeAccount),new Date(),{code:5000,message:"Wallet locked before review."})}
      catch{const latest=(await securityStore.outbox()).find(item=>item.topic===pending.topic&&item.requestId===pending.id&&item.stage==="reviewing");if(latest)await securityStore.recoverReviewingResponse(latest.key);else await securityStore.recoverOrphanReservation(pending,evmAddressFromYNX(nativeAccount))}
    }
  }).catch(()=>{});
  return lockRecovery;
}

async function deliverReadyResponse(key:string,account:string,nativeAccount:string,operations:WalletOperationLifecycle,expectedPending:WalletConnectSnapshot["request"]=null):Promise<void>{
  if(deliveriesInFlight.has(key))return;
  deliveriesInFlight.add(key);
  const scope=operations.scope();
  try{
    const lease=scope.begin({account:nativeAccount});
    try{
    lease.assert();
    const record=(await securityStore.readyResponses()).find(item=>item.key===key);
    lease.assert();
    if(!record||record.account!==account||!record.response)return;
    const snapshot=walletConnectRuntime.snapshot();
    if(snapshot.phase!=="ready"||!snapshot.sessions.some(item=>item.topic===record.topic))return;
    if(snapshot.request?.topic===record.topic&&snapshot.request.id===record.requestId&&snapshot.request!==expectedPending)return;
    if(expectedPending&&snapshot.request!==expectedPending)return;
    if(await securityStore.reconcileSession(record.topic,snapshot.sessions.find(item=>item.topic===record.topic)!.namespaces,account)!=="current")return;
    lease.assert();
    const claim=await securityStore.recordDeliveryAttempt(key);
    lease.assert();
    if(!await currentWalletConnectDelivery(walletConnectRuntime,securityStore,record,account,expectedPending))return;
    lease.assert();
    const beforeRelay=walletConnectRuntime.snapshot();
    if(beforeRelay.sessions!==snapshot.sessions||beforeRelay.sessionEvent?.revision!==snapshot.sessionEvent?.revision)return;
    await walletConnectRuntime.sendStoredResponse(record.topic,record.response);
    lease.assert();
    await securityStore.markResponseDelivered(key,{attempt:claim.attempts,responseDigest:claim.responseDigest!});
    deliveryRetryCounts.delete(key);
    }finally{lease.finish()}
  }catch(error){
    const retries=deliveryRetryCounts.get(key)??0;
    if(retries<3&&operations.isActive()&&operations.isUnlocked()&&operations.selectedAccount()===nativeAccount){
      deliveryRetryCounts.set(key,retries+1);
      const retryPending=walletConnectRuntime.snapshot().request===expectedPending?expectedPending:null;
      setTimeout(()=>{void deliverReadyResponse(key,account,nativeAccount,operations,retryPending).catch(()=>{})},[2_000,5_000,10_000][retries]);
    }
    throw error;
  }finally{deliveriesInFlight.delete(key)}
}

export function WalletConnectButton({ account,withAccountSecret,operations }: { account: WalletAccount;withAccountSecret:SecretAccess;operations:WalletOperationLifecycle }) {
  const [visible, setVisible] = useState(false), [inbound, setInbound] = useState<string | null>(null);
  const evmAddress=useMemo(()=>evmAddressFromYNX(account.account),[account.account]);
  useEffect(() => subscribeWalletConnectDeepLinks(url => { setInbound(url); setVisible(true); }), []);
  useEffect(()=>{let active=true;const unsubscribe=walletConnectRuntime.subscribe(snapshot=>{if(active&&(snapshot.proposal||snapshot.request))setVisible(true)});void walletConnectRuntime.restore().catch(()=>{});return()=>{active=false;unsubscribe()}},[]);
  useEffect(()=>{
    let active=true,reconciliation:Promise<void>=Promise.resolve(),lastUpdateRevision=0;
    const reconcile=async(snapshot:WalletConnectSnapshot)=>{
      if(snapshot.phase!=="ready")return;
      const generation=operations.capture(),deadline=Date.now()+120_000;
      const assertOwner=()=>{if(!active)throw new Error("WalletConnect reconciliation stopped.");operations.assert(generation,account.account,true,deadline)};
      const assertCurrent=()=>{assertOwner();if(walletConnectRuntime.snapshot().sessions!==snapshot.sessions)throw new Error("WalletConnect sessions changed during reconciliation.")};
      try{
        await lockRecovery;
        assertOwner();
        const update=snapshot.sessionEvent;
        if(update?.kind==="updated"&&update.pendingRequest&&update.revision>lastUpdateRevision){
          try{await securityStore.rejectPendingForSessionUpdate(update.pendingRequest,evmAddress)}
          catch{await revokeAndDisconnectWalletConnectSession(walletConnectRuntime,securityStore,update.topic).catch(()=>{});return}
          lastUpdateRevision=update.revision;
          walletConnectRuntime.clearPersistedSessionUpdateRequest(update.revision);
          assertOwner();
        }
        if(update?.kind==="updated"&&update.namespaces&&await securityStore.reconcileSession(update.topic,update.namespaces,evmAddress)!=="current"){
          assertOwner();
          await revokeAndDisconnectWalletConnectSession(walletConnectRuntime,securityStore,update.topic).catch(()=>{});
          return;
        }
        assertCurrent();
        const result=await securityStore.reconcileActiveSessions(snapshot.sessions,evmAddress);
        assertCurrent();
        if(result.disconnectTopics.length){await walletConnectRuntime.disconnectSessions(result.disconnectTopics);return}
        for(const record of await securityStore.readyResponses()){assertCurrent();await deliverReadyResponse(record.key,evmAddress,account.account,operations).catch(()=>{})}
        assertCurrent();
        if((await securityStore.outbox()).some(item=>recoverableRecord(item,evmAddress)||item.account===evmAddress&&item.stage==="ready"&&item.expiresAt>new Date().toISOString()))setVisible(true);
      }catch{/* No stale session snapshot may authorize delivery. */}
    };
    const unsubscribe=walletConnectRuntime.subscribe(snapshot=>{reconciliation=reconciliation.then(()=>reconcile(snapshot)).catch(()=>{})});
    return()=>{active=false;unsubscribe()};
  },[evmAddress,account.account,operations]);
  useEffect(()=>()=>{closeWalletConnectForLock(account.account)},[account.account]);
  return <><Pressable accessibilityRole="button" accessibilityLabel="WalletConnect and external dApps" onPress={() => setVisible(true)} style={s.button}><Text style={s.buttonText}>WalletConnect and external dApps</Text></Pressable>{visible ? <WalletConnectSheet account={account} withAccountSecret={withAccountSecret} operations={operations} inbound={inbound} clearInbound={() => { if (inbound) consumeWalletConnectDeepLink(inbound); setInbound(null); }} close={() => setVisible(false)} /> : null}</>;
}

function WalletConnectSheet({ account,withAccountSecret,operations,inbound,clearInbound,close }: { account: WalletAccount;withAccountSecret:SecretAccess;operations:WalletOperationLifecycle;inbound: string | null; clearInbound: () => void; close: () => void }) {
  const [snapshot, setSnapshot] = useState<WalletConnectSnapshot>(() => walletConnectRuntime.snapshot()), [uri, setUri] = useState(""), [busy, setBusy] = useState(false), [scanning,setScanning]=useState(false),[error, setError] = useState<string | null>(configError),[proposalReview,setProposalReview]=useState<WalletConnectSessionReview|null>(null),[requestReview,setRequestReview]=useState<WalletConnectRequestReview|null>(null),[prepared,setPrepared]=useState<PreparedEvmRequest|null>(null),[broadcast,setBroadcast]=useState<BroadcastRecord|null>(null),[incomplete,setIncomplete]=useState<readonly WalletConnectResponseRecord[]>([]),[pendingResponses,setPendingResponses]=useState<readonly WalletConnectResponseRecord[]>([]);
  const evmAddress = useMemo(() => evmAddressFromYNX(account.account), [account.account]);
  const reviewedRequestRef=useRef<WalletConnectSnapshot["request"]>(null);
  useEffect(() => walletConnectRuntime.subscribe(setSnapshot), []);
  useEffect(()=>{let active=true;void broadcastJournal.read(evmAddress).then(value=>{if(active)setBroadcast(value)}).catch(caught=>{if(active)setError(message(caught))});return()=>{active=false}},[evmAddress]);
  useEffect(()=>{let active=true;void securityStore.outbox().then(rows=>{if(active)setIncomplete(rows.filter(item=>recoverableRecord(item,evmAddress)))}).catch(caught=>{if(active)setError(message(caught))});return()=>{active=false}},[evmAddress]);
  useEffect(()=>{let active=true;void securityStore.readyResponses().then(rows=>{if(active)setPendingResponses(rows.filter(item=>item.account===evmAddress))}).catch(caught=>{if(active)setError(message(caught))});return()=>{active=false}},[evmAddress]);
  useEffect(() => { if (!inbound) return; try { const target = new URL(inbound); const pairing = target.searchParams.get("uri") ?? ""; parseWalletConnectPairingUri(pairing,new Date());setUri(pairing);setError(null); } catch { setUri("");setError("WalletConnect deep link is invalid or expired. Pairing was not attempted.");clearInbound(); } }, [inbound]);
  useEffect(()=>{if(!snapshot.proposal){setProposalReview(null);return}try{setProposalReview(reviewWalletConnectSessionProposal(snapshot.proposal,{account:evmAddress,now:new Date()}));setError(null)}catch(caught){const rejection=walletConnectRejection(caught);setError(message(caught));void walletConnectRuntime.rejectProposal();setProposalReview(null)}},[snapshot.proposal,evmAddress]);
  useEffect(()=>{
    let active=true;reviewedRequestRef.current=null;setRequestReview(null);setPrepared(null);
    if(!snapshot.request)return()=>{active=false};
    const request=snapshot.request,scope=operations.scope();
    void(async()=>{
      let review:WalletConnectRequestReview|null=null;
      try{
        const lease=scope.begin({account:account.account});
        try{
          const live=walletConnectRuntime.snapshot().sessions.find(item=>item.topic===request.topic);
          if(walletConnectRuntime.snapshot().phase!=="ready"||!live||await securityStore.reconcileSession(live.topic,live.namespaces,evmAddress)!=="current")throw new Error("WalletConnect request has no current approved session.");
          lease.assert();review=await securityStore.reserveRequest(request,evmAddress,new Date());lease.assert();
          const next=["personal_sign","eth_signTypedData_v4","eth_sendTransaction"].includes(review.method)?await prepareEvmRequest(evmAddress,review.method,review.params):null;
          lease.assert();
          if(active&&walletConnectRuntime.snapshot().request===request){reviewedRequestRef.current=request;setRequestReview(review);setPrepared(next);setError(null)}
        }finally{lease.finish()}
      }catch(caught){
        if(!active)return;
        setError(message(caught));
        if(review&&walletConnectRuntime.snapshot().request===request&&operations.isActive()&&operations.isUnlocked()&&operations.selectedAccount()===account.account){
          try{await securityStore.commitRequestDecision(review,false,new Date(),{code:-32000,message:"Wallet could not prepare this request."});await deliverReadyResponse(`${review.topic}:${review.requestId}`,evmAddress,account.account,operations,request)}catch{}
        }else if(!review&&walletConnectRuntime.snapshot().request===request&&operations.isActive()&&operations.isUnlocked()&&operations.selectedAccount()===account.account){
          try{
            const existing=(await securityStore.outbox()).find(item=>item.topic===request.topic&&item.requestId===request.id);
            if(existing?.stage==="reviewing"){const recovered=await securityStore.recoverReviewingResponse(existing.key);await deliverReadyResponse(recovered.key,evmAddress,account.account,operations,request);walletConnectRuntime.clearSensitiveReview();return}
            if(existing){await revokeAndDisconnectWalletConnectSession(walletConnectRuntime,securityStore,request.topic);return}
            const live=walletConnectRuntime.snapshot().sessions.find(item=>item.topic===request.topic);
            if(!live||await securityStore.reconcileSession(live.topic,live.namespaces,evmAddress)!=="current")throw new Error("WalletConnect session is not current.");
            let record:WalletConnectResponseRecord;
            try{record=await securityStore.rejectUnreviewedRequest(request,evmAddress)}
            catch(caught){record=await securityStore.recoverOrphanReservation(request,evmAddress).catch(()=>{throw caught})}
            await deliverReadyResponse(record.key,evmAddress,account.account,operations,request);
          }catch{const durable=await securityStore.outbox().then(rows=>rows.some(item=>item.topic===request.topic&&item.requestId===request.id&&item.stage==="ready")).catch(()=>false);if(!durable)await revokeAndDisconnectWalletConnectSession(walletConnectRuntime,securityStore,request.topic).catch(()=>{})}
        }
        walletConnectRuntime.clearSensitiveReview();
      }
    })();
    return()=>{active=false;scope.cancel();reviewedRequestRef.current=null};
  },[snapshot.request,evmAddress,account.account,operations]);
  const pair = async () => { setBusy(true); setError(null); try { parseWalletConnectPairingUri(uri.trim(),new Date());await walletConnectRuntime.pair(uri.trim()); clearInbound(); setUri(""); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } };
  const disconnect = async (topic: string) => { setBusy(true); setError(null); try { await revokeAndDisconnectWalletConnectSession(walletConnectRuntime,securityStore,topic); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } };
  const rejectProposal=async()=>{setBusy(true);try{await walletConnectRuntime.rejectProposal();setProposalReview(null)}catch(caught){setError(message(caught))}finally{setBusy(false)}};
  const approveProposal=async()=>{if(!proposalReview)return;setBusy(true);setError(null);let approved=false;try{const session=await walletConnectRuntime.approveProposal(proposalReview.namespaces as any);approved=true;await createPersistAndPublishWalletConnectSession(walletConnectRuntime,securityStore,session.topic,()=>createWalletConnectSessionApproval(proposalReview,{approved:true,topic:session.topic},new Date()));setProposalReview(null)}catch(caught){setError(message(caught));if(!approved)await walletConnectRuntime.rejectProposal().catch(()=>{})}finally{setBusy(false)}};
  const decideRequest=async(approved:boolean)=>{
    if(!requestReview||busy)return;
    const review=requestReview,key=`${review.topic}:${review.requestId}`;
    setBusy(true);setError(null);
    let ready=false;
    const scope=operations.scope();
    try{
      const lease=scope.begin({account:account.account});
      try{
        const assertReviewCurrent=()=>{lease.assert();const current=walletConnectRuntime.snapshot().request;if(current!==reviewedRequestRef.current||current?.topic!==review.topic||current.id!==review.requestId)throw new Error("WalletConnect request changed during authorization.");};
        assertReviewCurrent();
        await securityStore.commitRequestDecision(review,approved);
        assertReviewCurrent();
        if(approved){
          await securityStore.beginRequestExecution(key);
          assertReviewCurrent();
          let result:unknown;
          if(["eth_accounts","eth_requestAccounts"].includes(review.method))result=[evmAddress];
          else if(review.method==="eth_chainId")result="0x1917";
          else if(["wallet_switchEthereumChain","wallet_addEthereumChain"].includes(review.method))result=null;
          else if(prepared){
            result=await withAccountSecret(account.account,assertReviewCurrent,async(secret,assertKeyCurrent)=>{
              const guard=()=>{assertReviewCurrent();assertKeyCurrent()};
              const signed=await signPreparedEvmRequest(secret,prepared,guard);
              if(prepared.method==="personal_sign"){
                if(verifyMessage(getBytes(prepared.params[0] as string),signed as string).toLowerCase()!==evmAddress)throw new Error("WalletConnect signature did not match the reviewed account.");
                return signed;
              }
              if(prepared.method==="eth_signTypedData_v4"){
                const typed=JSON.parse(prepared.params[1] as string),types={...typed.types};delete types.EIP712Domain;
                if(verifyTypedData(typed.domain,types,typed.message,signed as string).toLowerCase()!==evmAddress)throw new Error("WalletConnect typed-data signature did not match the reviewed account.");
                return signed;
              }
              const hash=await broadcastJournal.broadcastAuthorized(evmAddress,signed as SignedEvmTransaction,guard,{topic:review.topic,requestId:review.requestId,sessionBinding:review.sessionBinding,requestDigest:review.requestDigest});
              guard();const journal=await broadcastJournal.read(evmAddress);guard();
              if(!journal||journal.version!==3||journal.binding?.topic!==review.topic||journal.binding.requestId!==review.requestId||journal.binding.sessionBinding!==review.sessionBinding||journal.binding.requestDigest!==review.requestDigest||journal.transactionHash!==hash||(signed as SignedEvmTransaction).transactionHash!==hash)throw new Error("WalletConnect broadcast response did not match the saved transaction.");
              setBroadcast(journal);return hash;
            });
          }else throw new Error("WalletConnect request has no executable reviewed content.");
          assertReviewCurrent();
          await securityStore.completeRequestResponse(key,{jsonrpc:"2.0",id:review.requestId,result});
        }
        ready=true;
      }finally{lease.finish()}
      setRequestReview(null);setPrepared(null);
      if(ready)await deliverReadyResponse(key,evmAddress,account.account,operations,reviewedRequestRef.current);
    }catch(caught){
      setBroadcast(await broadcastJournal.read(evmAddress).catch(()=>null));
      setError(message(caught));walletConnectRuntime.clearSensitiveReview();
    }finally{setBusy(false);void securityStore.outbox().then(rows=>setIncomplete(rows.filter(item=>recoverableRecord(item,evmAddress)))).catch(()=>{});void securityStore.readyResponses().then(rows=>setPendingResponses(rows.filter(item=>item.account===evmAddress))).catch(()=>{})}
  };
  const recoverIncomplete=async(record:WalletConnectResponseRecord)=>{
    setBusy(true);setError(null);
    const scope=operations.scope();
    try{
      const lease=scope.begin({account:account.account});
      try{
        const runtimeSnapshot=walletConnectRuntime.snapshot(),live=runtimeSnapshot.sessions.find(item=>item.topic===record.topic);
        if(runtimeSnapshot.request?.topic===record.topic&&runtimeSnapshot.request.id===record.requestId)throw new Error("Close the current request before recovering its prior response.");
        if(!live||await securityStore.reconcileSession(record.topic,live.namespaces,evmAddress)!=="current")throw new Error("WalletConnect session is no longer current.");
        lease.assert();
        const journal=record.stage==="executing"&&record.method==="eth_sendTransaction"?await broadcastJournal.read(evmAddress):null;
        lease.assert();
        if(record.stage==="reviewing")await securityStore.recoverReviewingResponse(record.key);
        else if(journal?.version===3&&journal.binding?.topic===record.topic&&journal.binding.requestId===record.requestId&&journal.binding.sessionBinding===record.sessionBinding&&journal.binding.requestDigest===record.requestDigest&&["acknowledged","confirmed"].includes(journal.status)){
          await securityStore.completeRequestResponse(record.key,{jsonrpc:"2.0",id:record.requestId,result:journal.transactionHash});
        }else await securityStore.recoverIncompleteResponse(record.key);
        lease.assert();
      }finally{lease.finish()}
      setIncomplete((await securityStore.outbox()).filter(item=>recoverableRecord(item,evmAddress)));
      await deliverReadyResponse(record.key,evmAddress,account.account,operations);
    }catch(caught){setError(message(caught))}finally{setBusy(false);void securityStore.readyResponses().then(rows=>setPendingResponses(rows.filter(item=>item.account===evmAddress))).catch(()=>{})}
  };
  const retrySavedResponse=async(record:WalletConnectResponseRecord)=>{
    setBusy(true);setError(null);
    try{
      const pending=walletConnectRuntime.snapshot().request;
      if(pending?.topic===record.topic&&pending.id===record.requestId)throw new Error("Close the current request before retrying its stored response.");
      await deliverReadyResponse(record.key,evmAddress,account.account,operations);
      setPendingResponses((await securityStore.readyResponses()).filter(item=>item.account===evmAddress));
    }catch(caught){setError(message(caught))}finally{setBusy(false)}
  };
  const closeReviewSheet=()=>{
    if(busy)return;
    const pending=walletConnectRuntime.snapshot().request;
    walletConnectRuntime.clearSensitiveReview();close();
    if(!pending)return;
    void(async()=>{
      const existing=(await securityStore.outbox()).find(item=>item.topic===pending.topic&&item.requestId===pending.id);
      if(existing&&existing.stage!=="reviewing"){await revokeAndDisconnectWalletConnectSession(walletConnectRuntime,securityStore,pending.topic);return}
      let record:WalletConnectResponseRecord;
      if(existing)record=await securityStore.recoverReviewingResponse(existing.key);
      else try{record=await securityStore.rejectUnreviewedRequest(pending,evmAddress,new Date(),{code:5000,message:"User closed WalletConnect review."})}
      catch(caught){const latest=(await securityStore.outbox()).find(item=>item.topic===pending.topic&&item.requestId===pending.id&&item.stage==="reviewing");if(latest)record=await securityStore.recoverReviewingResponse(latest.key);else record=await securityStore.recoverOrphanReservation(pending,evmAddress).catch(()=>{throw caught})}
      if(record.stage==="ready")await deliverReadyResponse(record.key,evmAddress,account.account,operations);
    })().catch(()=>{void securityStore.outbox().then(rows=>{if(!rows.some(item=>item.topic===pending.topic&&item.requestId===pending.id&&item.stage==="ready"))return revokeAndDisconnectWalletConnectSession(walletConnectRuntime,securityStore,pending.topic)}).catch(()=>{})});
  };
  const checkBroadcast=async()=>{setBusy(true);setError(null);try{setBroadcast(await broadcastJournal.refresh(evmAddress))}catch(caught){setError(message(caught))}finally{setBusy(false)}};
  const retryBroadcast=async()=>{setBusy(true);setError(null);try{await withAccountSecret(account.account,()=>{},async(_secret,assertCurrent)=>{assertCurrent();const hash=await broadcastJournal.retryOriginalAuthorized(evmAddress,assertCurrent);assertCurrent();return hash});setBroadcast(await broadcastJournal.read(evmAddress))}catch(caught){setBroadcast(await broadcastJournal.read(evmAddress).catch(()=>null));setError(message(caught))}finally{setBusy(false)}};
  const acknowledgeBroadcast=async()=>{setBusy(true);setError(null);try{await broadcastJournal.acknowledgeTerminal(evmAddress);setBroadcast(null)}catch(caught){setError(message(caught))}finally{setBusy(false)}};
  return <Modal visible transparent animationType="slide" onRequestClose={closeReviewSheet}><View style={s.backdrop}><ScrollView contentContainerStyle={s.sheet} keyboardShouldPersistTaps="handled"><View style={s.header}><Text style={s.title}>WalletConnect</Text><Pressable accessibilityRole="button" accessibilityLabel="Close WalletConnect" disabled={busy} onPress={closeReviewSheet}><Text style={s.close}>Close</Text></Pressable></View>
    <Text style={s.body}>Connect YNX Wallet to external dApps on EVM chain 6423. Pairing and account discovery do not require a balance. Every signature and transaction still requires a separate review and local biometric approval.</Text>
    <View style={s.status}><Text style={s.label}>Relay status</Text><Text style={s.value}>{snapshot.phase}{snapshot.error ? ` · ${snapshot.error}` : ""}</Text></View>
    {snapshot.retryAvailable?<Pressable accessibilityRole="button" accessibilityLabel="Retry WalletConnect initialization" disabled={busy} onPress={()=>{setBusy(true);setError(null);void walletConnectRuntime.retryStart().catch(caught=>setError(message(caught))).finally(()=>setBusy(false))}}><Text style={s.approve}>Retry WalletConnect initialization</Text></Pressable>:null}
    <View style={s.status}><Text style={s.label}>Selected account</Text><Text selectable style={s.value}>{account.account}{"\n"}{evmAddress}</Text><Text style={s.caption}>This exact 0x projection is bound during protocol review; switching accounts invalidates pending requests.</Text></View>
    <Text style={s.label}>WalletConnect pairing URI</Text><TextInput accessibilityLabel="WalletConnect pairing URI" value={uri} onChangeText={setUri} autoCapitalize="none" autoCorrect={false} multiline style={s.input}/>
    <Pressable accessibilityRole="button" accessibilityLabel="Scan WalletConnect QR code" accessibilityState={{disabled:busy||snapshot.phase!=="ready"}} disabled={busy||snapshot.phase!=="ready"} onPress={()=>setScanning(true)} style={[s.secondary,(busy||snapshot.phase!=="ready")&&s.disabled]}><Text style={s.buttonText}>Scan QR code</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Pair WalletConnect URI" accessibilityState={{ disabled: busy || snapshot.phase !== "ready" || !uri.trim() }} disabled={busy || snapshot.phase !== "ready" || !uri.trim()} onPress={() => void pair()} style={[s.primary, (busy || snapshot.phase !== "ready" || !uri.trim()) && s.disabled]}>{busy ? <ActivityIndicator color="#fff"/> : <Text style={s.primaryText}>Pair</Text>}</Pressable>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    {broadcast?<View style={s.card}><Text style={s.cardTitle}>Stored original transaction</Text><Text style={s.caption}>Hash: {broadcast.transactionHash}{"\n"}Status: {broadcast.status}{"\n"}Broadcast attempt: {broadcast.attempt}{"\n"}Unknown network history: {broadcast.unknownHistory?"yes":"no"}</Text><Text style={s.body}>Wallet will not sign a replacement while this record is unresolved. Status checks never send a transaction. Retry resends the exact saved raw transaction after biometric authorization.</Text><Pressable disabled={busy} onPress={()=>void checkBroadcast()}><Text style={s.approve}>Check transaction status</Text></Pressable>{["broadcasting","acknowledged","uncertain"].includes(broadcast.status)?<Pressable disabled={busy} onPress={()=>void retryBroadcast()}><Text style={s.approve}>Authorize and resend original transaction</Text></Pressable>:null}{["confirmed","rejected","cancelled"].includes(broadcast.status)?<Pressable disabled={busy} onPress={()=>void acknowledgeBroadcast()}><Text style={s.approve}>Acknowledge result and unlock new sends</Text></Pressable>:null}</View>:null}
    {pendingResponses.map(record=><View key={record.key} style={s.card}><Text style={s.cardTitle}>Saved dApp response awaiting delivery</Text><Text style={s.caption}>{record.method} · request {record.requestId} · attempt {record.attempts}</Text><Text style={s.body}>Retry sends the exact stored response. It does not sign or broadcast again.</Text><Pressable accessibilityRole="button" accessibilityLabel={`Retry saved response ${record.requestId}`} disabled={busy} onPress={()=>void retrySavedResponse(record)}><Text style={s.approve}>Retry saved response</Text></Pressable></View>)}
    {incomplete.map(record=><View key={record.key} style={s.card}><Text style={s.cardTitle}>Interrupted WalletConnect request</Text><Text style={s.caption}>{record.method} · {record.stage}{"\n"}Request {record.requestId} · expires {record.expiresAt}</Text><Text style={s.body}>This request will not be signed again automatically. An acknowledged original transaction can return its saved hash; an unknown outcome returns an uncertainty error. Check transaction status before requesting another transfer.</Text><Pressable accessibilityRole="button" accessibilityLabel={`Recover interrupted request ${record.requestId}`} disabled={busy} onPress={()=>void recoverIncomplete(record)}><Text style={s.approve}>Recover saved response</Text></Pressable></View>)}
    <Text style={s.section}>Active sessions</Text>{snapshot.sessions.length === 0 ? <Text style={s.body}>No dApp sessions are connected.</Text> : snapshot.sessions.map(session => <View key={session.topic} style={s.card}><Text style={s.cardTitle}>{session.peer.metadata.name}</Text><Text style={s.caption}>{session.peer.metadata.url}{"\n"}{session.topic.slice(0, 12)}…{session.topic.slice(-8)}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Disconnect ${session.peer.metadata.name}`} disabled={busy} onPress={() => void disconnect(session.topic)}><Text style={s.danger}>Disconnect</Text></Pressable></View>)}
    {proposalReview ? <View style={s.card}><Text style={s.cardTitle}>Connection request</Text><Text style={s.body}>{proposalReview.peer.metadata.name}{"\n"}{proposalReview.peer.metadata.url}</Text><Text style={s.caption}>Verify: {proposalReview.verification.validation} · {proposalReview.verification.origin||"origin unavailable"}{"\n"}Chain: eip155:6423{"\n"}Methods: {proposalReview.namespaces.eip155.methods.join(", ")||"none"}{"\n"}Events: {proposalReview.namespaces.eip155.events.join(", ")||"none"}{"\n"}Expires: {new Date(proposalReview.expiryTimestamp*1000).toISOString()}{"\n"}Digest: {proposalReview.proposalDigest}</Text><View style={s.actions}><Pressable disabled={busy} onPress={()=>void rejectProposal()}><Text style={s.danger}>Reject</Text></Pressable><Pressable disabled={busy} onPress={()=>void approveProposal()}><Text style={s.approve}>Approve connection</Text></Pressable></View></View> : null}
    {requestReview ? <View style={s.card}><Text style={s.cardTitle}>dApp request</Text><Text style={s.body}>{requestReview.peer.metadata.name} · {requestReview.method}</Text><Text style={s.caption}>Verify: {requestReview.verification.validation} · {requestReview.verification.origin||"origin unavailable"}{"\n"}Expires ({requestReview.expirySource}): {requestReview.expiresAt}{"\n"}Digest: {requestReview.requestDigest}</Text><Text selectable style={s.code}>{JSON.stringify(prepared?.review??requestReview.params,null,2)}</Text><View style={s.actions}><Pressable disabled={busy} onPress={()=>void decideRequest(false)}><Text style={s.danger}>Reject</Text></Pressable><Pressable disabled={busy} onPress={()=>void decideRequest(true)}><Text style={s.approve}>{prepared?"Approve and use protected key":"Approve response"}</Text></Pressable></View></View> : null}
    <Text style={s.foot}>Manual paste and camera QR scanning use the same strict WalletConnect URI parser. Project ID is injected at build/runtime and is never hard-coded in source.</Text>
  </ScrollView>{scanning?<WalletConnectScanner close={()=>setScanning(false)} accept={value=>{setUri(value);setScanning(false);setError(null)}} fail={caught=>{setScanning(false);setError(message(caught))}}/>:null}</View></Modal>;
}
function WalletConnectScanner({accept,fail,close}:{accept:(uri:string)=>void;fail:(error:unknown)=>void;close:()=>void}){
  const [permission,requestPermission]=useCameraPermissions(),[mountError,setMountError]=useState<string|null>(null),handled=useRef(false);
  const scanned=(result:BarcodeScanningResult)=>{if(handled.current)return;handled.current=true;try{accept(reviewWalletConnectQrPayload(result.data,"ready",new Date()))}catch(caught){fail(caught)}};
  if(!permission)return <View style={s.scanner}><ActivityIndicator color="#fff"/><Text style={s.scannerText}>Checking camera permission…</Text></View>;
  if(!permission.granted)return <View style={s.scanner}><Text style={s.scannerTitle}>Camera permission required</Text><Text style={s.scannerText}>Permission denial never starts pairing. You can continue with manual paste.</Text>{permission.canAskAgain?<Pressable onPress={()=>void requestPermission()}><Text style={s.scannerAction}>Allow camera</Text></Pressable>:null}<Pressable onPress={()=>{fail(new Error("Camera permission was denied. WalletConnect pairing was not attempted."));close()}}><Text style={s.scannerAction}>Use manual paste</Text></Pressable></View>;
  if(mountError)return <View style={s.scanner}><Text style={s.scannerTitle}>Camera unavailable</Text><Text style={s.scannerText}>{mountError}</Text><Pressable onPress={()=>{fail(new Error("No camera is available. WalletConnect pairing was not attempted."));close()}}><Text style={s.scannerAction}>Use manual paste</Text></Pressable></View>;
  return <View style={s.scanner}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}} onBarcodeScanned={scanned} onMountError={event=>setMountError(event.message)}/><View style={s.scannerOverlay}><Text style={s.scannerTitle}>Scan WalletConnect QR</Text><Text style={s.scannerText}>Only a strict wc: v2 pairing URI is accepted.</Text><Pressable onPress={close}><Text style={s.scannerAction}>Cancel scan</Text></Pressable></View></View>
}
function message(value: unknown) { return value instanceof Error ? value.message : String(value); }
const s = StyleSheet.create({ backdrop:{flex:1,backgroundColor:"rgba(10,22,50,.44)",justifyContent:"flex-end"},sheet:{backgroundColor:"#fff",padding:24,gap:14,minHeight:"82%"},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},title:{fontSize:28,fontWeight:"800",color:"#111c35"},close:{color:"#0747d8",fontWeight:"700"},body:{fontSize:15,lineHeight:22,color:"#44516b"},status:{borderWidth:1,borderColor:"#dbe3f2",borderRadius:14,padding:14,gap:5},label:{fontSize:13,fontWeight:"700",color:"#111c35"},value:{fontSize:13,color:"#44516b"},caption:{fontSize:12,lineHeight:17,color:"#6f7d98"},code:{fontSize:11,lineHeight:16,color:"#111c35",backgroundColor:"#f5f7fb",padding:10,borderRadius:8},input:{borderWidth:1,borderColor:"#b8c5dc",borderRadius:12,minHeight:82,padding:12,color:"#111c35"},primary:{backgroundColor:"#0747d8",borderRadius:12,padding:15,alignItems:"center"},secondary:{borderWidth:1,borderColor:"#7a9cec",borderRadius:12,padding:13,alignItems:"center"},primaryText:{color:"#fff",fontWeight:"800"},disabled:{opacity:.45},error:{color:"#b42318",lineHeight:20},section:{fontSize:18,fontWeight:"800",color:"#111c35",marginTop:8},card:{borderWidth:1,borderColor:"#dbe3f2",borderRadius:14,padding:14,gap:8},cardTitle:{fontSize:15,fontWeight:"800",color:"#111c35"},actions:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:18},approve:{color:"#0747d8",fontWeight:"800",paddingVertical:4},danger:{color:"#b42318",fontWeight:"800",paddingVertical:4},foot:{fontSize:12,lineHeight:17,color:"#6f7d98",paddingBottom:30},button:{borderWidth:1,borderColor:"#7a9cec",borderRadius:12,padding:14,alignItems:"center"},buttonText:{color:"#0747d8",fontWeight:"800"},scanner:{position:"absolute",top:0,right:0,bottom:0,left:0,backgroundColor:"#07132c",zIndex:20,justifyContent:"center",alignItems:"center",padding:28,gap:16},scannerOverlay:{position:"absolute",left:24,right:24,bottom:40,backgroundColor:"rgba(7,19,44,.88)",borderRadius:16,padding:18,gap:10},scannerTitle:{color:"#fff",fontSize:20,fontWeight:"800",textAlign:"center"},scannerText:{color:"#dbe6ff",fontSize:14,lineHeight:20,textAlign:"center"},scannerAction:{color:"#8fb1ff",fontWeight:"800",padding:10,textAlign:"center"} });
