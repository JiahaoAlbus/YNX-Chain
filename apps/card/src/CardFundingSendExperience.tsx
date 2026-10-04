import React,{useEffect,useRef,useState} from 'react';
import {Platform,Pressable,StyleSheet,View} from 'react-native';
import {CardText as Text} from './cardTypography';
import type {Locale} from './i18n';
import type {CardBusinessClient,CardPrivateIdentity,CardFundingView} from './cardBusinessClient';
import {discoverWalletProviders,standardWalletConnection} from './standardWalletSdk';
import {parseFundingSendRecord,sendExactCardFunding,type FundingSendRecord,type FundingSendWallet,type FundingSendStorage} from './cardFundingSend';
import {cardFundingSendCopy,cardFundingPlatformCopy} from './cardFundingSendCopy';
type Props={client:CardBusinessClient;identity:CardPrivateIdentity;intent:CardFundingView;locale:Locale;onVerified:()=>void};
/** Protected owner intent only. No automatic connection, account prompt or send. */
export function CardFundingSendExperience({client,identity,intent,locale,onVerified}:Props){
  const copy=cardFundingSendCopy[locale],binding=JSON.stringify([client.sourceCommit,identity.owner,identity.sessionBinding,identity.expiresAt,intent.id,intent.cardId,intent.sender,intent.recipient,intent.amountWei,intent.expiresAt]);
  const current=useRef({client,binding,alive:true});current.current={client,binding,alive:true};
  const [wallet,setWallet]=useState<FundingSendWallet|null>(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(false),[saved,setSaved]=useState<{binding:string;record:FundingSendRecord}|null>(null);
  const valid=()=>current.current.alive&&current.current.client===client&&current.current.binding===binding&&intent.owner===identity.owner&&Date.parse(identity.expiresAt)>Date.now()&&Date.parse(intent.expiresAt)>Date.now();
  const context={...identity,sourceCommit:client.sourceCommit};
  const key=`ynx-card.funding-send.v1.${identity.owner}.${intent.id}`;
  const sendAvailable=Platform.OS==='web'&&typeof navigator!=='undefined'&&!!navigator.locks;
  const storage=():FundingSendStorage=>{
    if(Platform.OS!=='web'||typeof navigator==='undefined'||!navigator.locks)throw Error('CARD_FUNDING_LOCK_UNAVAILABLE');
    return {read:async()=>window.localStorage.getItem(key),write:async raw=>window.localStorage.setItem(key,raw),exclusive:operation=>navigator.locks.request(key,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw Error('CARD_FUNDING_BUSY');return operation()})};
  };
  useEffect(()=>{setWallet(null);setBusy(false);setFailure(false);setSaved(null);try{if(Platform.OS==='web'){const raw=window.localStorage.getItem(key);if(raw)setSaved({binding,record:parseFundingSendRecord(raw,intent,context)})}}catch{setFailure(true)}return()=>{current.current.alive=false}},[client,binding]);
  const choose=async(kind:'ynx-wallet'|'metamask')=>{
    if(!valid()||busy||!sendAvailable)return;setBusy(true);setFailure(false);
    try{const discovery=await discoverWalletProviders(window);if(!valid())return;const candidate=kind==='ynx-wallet'?discovery.ynx:discovery.metamask;if(!candidate||discovery.ambiguities.includes(kind))throw Error('CARD_FUNDING_PROVIDER_UNAVAILABLE');const connection=standardWalletConnection(candidate.provider);if(!await connection.restore())throw Error('CARD_FUNDING_APPROVED_ACCOUNT_REQUIRED');if(valid())setWallet(connection)}catch{if(valid())setFailure(true)}finally{if(valid())setBusy(false)};
  };
  const send=async()=>{
    if(!sendAvailable||!wallet||!valid()||busy||saved?.binding===binding)return;setBusy(true);setFailure(false);
    try{const record=await sendExactCardFunding({intent,context,wallet,storage:storage(),isCurrent:valid,onRecoveryRecord:record=>{if(valid()){setSaved({binding,record});setFailure(false)}}});if(valid())setSaved({binding,record})}
    catch{if(valid()){setFailure(true);try{const raw=await storage().read();if(raw)setSaved({binding,record:parseFundingSendRecord(raw,intent,context)})}catch{}}}
    finally{if(valid())setBusy(false)};
  };
  const verify=async()=>{
    const record=saved?.binding===binding?saved.record:null;if(!record?.txHash||record.status!=='RETURNED'||!valid()||busy)return;
    setBusy(true);setFailure(false);
    try{await client.confirmTopup(intent.id,record.txHash,`card-funding-confirm-${record.txHash.slice(2)}`);if(valid())onVerified()}
    catch{if(valid())setFailure(true)}finally{if(valid())setBusy(false)};
  };
  const record=saved?.binding===binding?saved.record:null;
  const button=(text:string,action:()=>void,disabled:boolean)=><Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityState={{disabled,busy}} disabled={disabled} onPress={action} style={[styles.button,disabled&&styles.disabled]}><Text style={styles.buttonText}>{text}</Text></Pressable>;
  return <View testID="card-exact-funding-send" style={styles.panel}>
    <Text accessibilityRole="header">{copy[0]}</Text><Text selectable>{intent.sender} → {intent.recipient}</Text><Text selectable>{intent.amountWei} wei · 0x1917 · {intent.expiresAt}</Text>
    {!sendAvailable?<Text accessibilityLiveRegion="polite">{cardFundingPlatformCopy[locale]}</Text>:null}
    {record?<><Text>{record.status==='RETURNED'?copy[4]:copy[6]}</Text>{record.txHash?<Text selectable>{record.txHash}</Text>:null}</>:<>
      {button(copy[1],()=>void choose('ynx-wallet'),!sendAvailable||busy||!valid())}{button(copy[2],()=>void choose('metamask'),!sendAvailable||busy||!valid())}
      {button(copy[3],()=>void send(),!sendAvailable||busy||!wallet||!valid())}
    </>}
    {record?.status==='RETURNED'?button(copy[5],()=>void verify(),busy||!valid()):null}
    {failure?<Text accessibilityRole="alert" accessibilityLiveRegion="polite">{copy[6]}</Text>:null}
  </View>;
}
const styles=StyleSheet.create({panel:{gap:10,padding:12,borderWidth:1,borderColor:'#DFE3EA',borderRadius:10},button:{minHeight:44,padding:12,backgroundColor:'#002FA7',borderRadius:8,justifyContent:'center'},buttonText:{color:'#FFFFFF'},disabled:{opacity:0.45}});
