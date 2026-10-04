import React,{useEffect,useRef,useState} from 'react';
import {Modal,Platform,Pressable,ScrollView,StyleSheet,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {CardText as Text} from './cardTypography';
import type {Locale} from './i18n';
import {CardBusinessClient,type CardPrivateIdentity,type CardStatementView} from './cardBusinessClient';
import {canonicalCardOperationInput,parsePendingCardOperation,parseTestnetYnxt,type PendingCardOperation,type TestnetOperation} from './cardOperationJournal';
import {cardOperationsCopy} from './cardOperationsCopy';
import {cardOperationAvailabilityText} from './cardOperationAvailabilityCopy';
type Props={client:CardBusinessClient;identity:CardPrivateIdentity;statement:CardStatementView;locale:Locale;onUpdated:()=>void};
type Journal={pending:PendingCardOperation|null;history:PendingCardOperation[]};
const actions:readonly TestnetOperation[]=['freeze','unfreeze','recover','topup-intent','topup-confirm','authorization','capture','reverse','refund','controls'];
const label=(kind:TestnetOperation)=>kind==='controls'?10:actions.indexOf(kind)+1;
export function TestnetCardOperationsExperience({client,identity,statement,locale,onUpdated}:Props){
  const copy=cardOperationsCopy[locale],card=statement.card,binding=JSON.stringify([identity.owner,identity.sessionBinding,identity.expiresAt,card.id]);
  const recoveryAvailable=client.supportsOperationRecovery===true;
  const storageKey=`ynx-card.testnet-operation.v1.${identity.owner}`,alive=useRef(true),current=useRef({binding,client});current.current={binding,client};
  const valid=()=>alive.current&&current.current.binding===binding&&current.current.client===client&&Date.parse(identity.expiresAt)>Date.now();
  const [journal,setJournal]=useState<Journal|null>(null),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [kind,setKind]=useState<TestnetOperation|null>(null),[amount,setAmount]=useState(''),[reference,setReference]=useState(''),[event,setEvent]=useState<Record<string,unknown>|null>(null);
  const [canRetry,setCanRetry]=useState(false);
  const read=async()=>Platform.OS==='web'?window.localStorage.getItem(storageKey):SecureStore.getItemAsync(storageKey);
  const write=async(value:Journal)=>{const raw=JSON.stringify(value);if(raw.length>262144)throw Error('CARD_OPERATION_HISTORY_FULL');if(Platform.OS==='web')window.localStorage.setItem(storageKey,raw);else await SecureStore.setItemAsync(storageKey,raw,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});};
  useEffect(()=>{alive.current=true;void(async()=>{try{const raw=await read();let recovered:Journal={pending:null,history:[]};if(raw){if(raw.length>262144)throw Error();const data=JSON.parse(raw);if(!Array.isArray(data.history)||data.history.length>128)throw Error();recovered={pending:data.pending?parsePendingCardOperation(JSON.stringify(data.pending),identity.owner):null,history:data.history.map((item:unknown)=>parsePendingCardOperation(JSON.stringify(item),identity.owner))};}if(valid())setJournal(recovered);}catch{if(valid()){setBlocked(true);setNotice(copy[18]!);}}})();return()=>{alive.current=false;};},[binding,client]);
  const execute=async(pending:PendingCardOperation)=>{
    const {kind,input,resourceId}=pending;
    if(pending.cardId!==card.id)throw Error('CARD_CONTEXT_CHANGED');
    if(kind==='capture'||kind==='reverse'||kind==='refund'){
      const fresh=await client.statement(card.id);if(!valid()||!fresh.events.some(event=>{const details=event.details as Record<string,unknown>;return details?.[kind==='refund'?'captureId':'authorizationId']===resourceId;}))throw Error('CARD_RESOURCE_NOT_FOUND');
    }
    if(kind==='topup-confirm'){const fresh=await client.state();if(!valid()||!fresh.intents.some(intent=>intent.id===resourceId&&intent.cardId===card.id))throw Error('CARD_RESOURCE_NOT_FOUND');}
    if(!valid())throw Error('CARD_CONTEXT_CHANGED');
    if(kind==='freeze'||kind==='unfreeze'||kind==='recover')await client.changeCard(card.id,kind,pending.key);
    else if(kind==='controls')await client.updateControls(card.id,input,pending.key);
    else if(kind==='topup-intent')await client.createTopupIntent(card.id,String(input.amountWei),pending.key);
    else if(kind==='topup-confirm')await client.confirmTopup(resourceId,String(input.txHash),pending.key);
    else if(kind==='authorization')await client.authorize(card.id,input as Parameters<CardBusinessClient['authorize']>[1],pending.key);
    else await client.settle(resourceId,kind,String(input.amountWei),pending.key);
  };
  const finish=async(pending:PendingCardOperation)=>{if(!journal||!valid())return;const next={pending:null,history:[...journal.history,pending]};await write(next);if(valid()){setJournal(next);setCanRetry(false);setNotice(copy[19]!);onUpdated();}};
  const readBack=async()=>{if(!recoveryAvailable||!valid()||busy||!journal?.pending)return;const pending=journal.pending;setBusy(true);setCanRetry(false);try{const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,canonicalCardOperationInput(pending.input));if(!valid()||digest!==pending.digest)throw Error();const result=await client.operationResult(pending.kind,pending.resourceId,pending.key,pending.digest);if(!valid())return;if(result.status==='UNKNOWN'){setNotice(copy[16]!);setCanRetry(true);return;}await finish(pending);}catch{if(valid())setNotice(copy[18]!);}finally{if(valid())setBusy(false);}};
  const retryOriginal=async()=>{if(!recoveryAvailable||!valid()||busy||!canRetry||!journal?.pending||journal.pending.cardId!==card.id)return;const pending=journal.pending;setBusy(true);setCanRetry(false);try{const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,canonicalCardOperationInput(pending.input));if(!valid()||digest!==pending.digest)throw Error();const currentResult=await client.operationResult(pending.kind,pending.resourceId,pending.key,pending.digest);if(!valid())return;if(currentResult.status==='UNKNOWN')await execute(pending);if(valid())await finish(pending);}catch{if(valid())setNotice(copy[16]!);}finally{if(valid())setBusy(false);}};
  const perform=async()=>{
    if(!recoveryAvailable||!kind||!valid()||busy||blocked||!journal||journal.pending||journal.history.length>=128)return;
    setBusy(true);let pending:PendingCardOperation|null=null;
    try{
      let resourceId=card.id,input:Record<string,unknown>={};
      if(kind==='topup-intent'||kind==='authorization'||kind==='capture'||kind==='reverse'||kind==='refund')input.amountWei=parseTestnetYnxt(amount);
      if(kind==='controls')input={maxSingleWei:parseTestnetYnxt(amount)};
      if(kind==='authorization')input={...input,simulation:true,merchant:{id:'testnet-sandbox',name:'SIMULATED MERCHANT',mcc:'5812',country:'YN',channel:'online',recurring:false}};
      if(kind==='capture'||kind==='reverse'||kind==='refund'){if(!/^[A-Za-z][A-Za-z0-9_-]{1,159}$/.test(reference))throw Error();resourceId=reference;}
      if(kind==='topup-confirm'){const [intentId,txHash,...extra]=reference.trim().split(/\s+/);if(extra.length||!intentId||!txHash||!/^0x[0-9a-f]{64}$/.test(txHash))throw Error();resourceId=intentId;input={txHash};}
      const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,canonicalCardOperationInput(input));if(!valid())return;
      pending={version:1,owner:identity.owner,cardId:card.id,kind,resourceId,key:`card-op-${Crypto.randomUUID()}`,digest,input};
      const next={...journal,pending};await write(next);if(!valid())return;setJournal(next);setKind(null);
      await execute(pending);if(valid())await finish(pending);
    }catch{if(valid())setNotice(pending?copy[16]!:copy[18]!);}finally{if(valid())setBusy(false);}
  };
  const disabled=!recoveryAvailable||busy||blocked||!journal||Boolean(journal.pending)||Date.parse(identity.expiresAt)<=Date.now();
  const button=(title:string,action:()=>void,off=false)=><Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{disabled:off,busy:busy&&off}} disabled={off} onPress={action} style={[styles.button,off&&styles.disabled]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
  return <View testID="card-testnet-operations" style={styles.panel}>
    <Text accessibilityRole="header" style={styles.heading}>{copy[0]}</Text><Text>{copy[20]}</Text>
    {!recoveryAvailable?<Text accessibilityLiveRegion="polite">{cardOperationAvailabilityText(locale)}</Text>:null}
    <View style={styles.actions}>{actions.map(action=><View key={action}>{button(copy[label(action)]!,()=>{setKind(action);setAmount('');setReference('');},disabled||card.status==='CLOSED'&&action!=='recover'||['authorization','topup-intent'].includes(action)&&card.status!=='ACTIVE')}</View>)}</View>
    {notice?<Text accessibilityLiveRegion="polite">{notice}</Text>:null}{busy?<Text>{copy[23]}</Text>:null}
    {journal?.pending?<View><Text>{copy[16]}</Text><Text selectable>{journal.pending.cardId} · {journal.pending.kind} · {journal.pending.key}</Text>{button(copy[17]!,()=>void readBack(),!recoveryAvailable||busy||blocked)}{canRetry?button(retryLabels[locale],()=>void retryOriginal(),!recoveryAvailable||busy||blocked||journal.pending.cardId!==card.id):null}</View>:null}
    <Text accessibilityRole="header">{copy[21]}</Text>{statement.events.map(item=><View key={String(item.id)}>{button(`${String(item.occurredAt)} · ${String(item.name)}`,()=>setEvent(item))}</View>)}
    <Modal visible={Boolean(kind)||Boolean(event)} transparent animationType="fade" onRequestClose={()=>{if(!busy){setKind(null);setEvent(null);}}}>
      <View style={styles.backdrop}><ScrollView accessibilityViewIsModal style={styles.dialog} contentContainerStyle={styles.dialogContent}>
        <Text accessibilityRole="header" style={styles.heading}>{kind?copy[label(kind)]:copy[21]}</Text><Text>{copy[20]}</Text>
        <Text selectable>{card.alias} · {card.id}</Text>
        {event?<Text selectable>{JSON.stringify(event,null,2)}</Text>:<>
          {kind&&['topup-intent','authorization','capture','reverse','refund','controls'].includes(kind)?<><Text>{copy[11]}</Text><TextInput accessibilityLabel={copy[11]} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={styles.input}/></>:null}
          {kind&&['topup-confirm','capture','reverse','refund'].includes(kind)?<><Text>{copy[12]}</Text><TextInput accessibilityLabel={copy[12]} value={reference} onChangeText={setReference} autoCapitalize="none" style={styles.input}/></>:null}
          {kind==='topup-confirm'?<Text>intent_id 0x…</Text>:null}
          {button(copy[14]!,()=>void perform(),disabled)}
        </>}{button(copy[22]!,()=>{setKind(null);setEvent(null);},busy)}
      </ScrollView></View>
    </Modal>
  </View>;
}
const styles=StyleSheet.create({panel:{gap:12},heading:{fontSize:18,fontWeight:'700'},actions:{flexDirection:'row',flexWrap:'wrap',gap:8},button:{minHeight:44,paddingHorizontal:14,paddingVertical:12,borderRadius:8,backgroundColor:'#002FA7',justifyContent:'center'},buttonText:{color:'#FFF',fontSize:14},disabled:{opacity:0.45},backdrop:{flex:1,backgroundColor:'rgba(16,24,32,0.55)',padding:20,justifyContent:'center',alignItems:'center'},dialog:{maxHeight:'85%',width:'100%',maxWidth:560,borderRadius:16,backgroundColor:'#FFF'},dialogContent:{padding:20,gap:14},input:{minHeight:48,padding:12,borderWidth:1,borderColor:'#667085',borderRadius:8,fontSize:16}});
const retryLabels:Record<Locale,string>={en:'Retry original request with the same key','zh-CN':'使用原幂等键重试原请求','zh-TW':'使用原冪等鍵重試原請求',ja:'同じキーで元の要求を再試行',ko:'같은 키로 원래 요청 재시도',es:'Reintentar solicitud original con la misma clave',fr:'Réessayer la demande originale avec la même clé',de:'Originalanfrage mit demselben Schlüssel wiederholen',pt:'Repetir pedido original com a mesma chave',ru:'Повторить исходный запрос с тем же ключом',ar:'إعادة الطلب الأصلي بالمفتاح نفسه',id:'Ulangi permintaan asli dengan kunci yang sama'};
