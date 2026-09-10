import React,{useEffect,useRef,useState}from"react";
import{Platform,Pressable,StyleSheet,Switch,Text,TextInput,View}from"react-native";
import type{Eip1193WalletSession}from"./wallet";
import{isRTL,type Locale}from"./i18n";
import{loadCardRegistration,saveCardRegistration}from"./secureState";
import{cancel,createDraft,degrade,requestApproval,restoreForWallet,submitForBackend,updateDraft,type CardRegistration}from"./registration";
import{registrationErrorKey,registrationStatus,registrationTemplate,registrationText,type RegistrationCopyKey}from"./registrationCopy";
const BLUE="#002FA7",INK="#171A22",LINE="#DFE3EA",MUTED="#5B6270";
type Form=Pick<CardRegistration,"nickname"|"useCase"|"spendingLimitYnxt"|"riskAccepted">;
const emptyForm:Form={nickname:"",useCase:"",spendingLimitYnxt:"10",riskAccepted:false};
const formOf=(record:CardRegistration):Form=>({nickname:record.nickname,useCase:record.useCase,spendingLimitYnxt:record.spendingLimitYnxt,riskAccepted:record.riskAccepted});
type RegistrationProps={walletSession:Eip1193WalletSession|null;locale:Locale};
export function RegistrationExperience(props:RegistrationProps){
  const owner=props.walletSession?.address.trim().toLowerCase()??"disconnected";
  return <RegistrationState key={owner} {...props}/>;
}
function RegistrationState({walletSession,locale}:RegistrationProps){
  const native=Platform.OS!=="web",rtl=isRTL(locale),copy=(key:RegistrationCopyKey)=>registrationText(locale,key);
  const[record,setRecord]=useState<CardRegistration|null>(null),[form,setForm]=useState<Form>(emptyForm),[notice,setNotice]=useState<RegistrationCopyKey|null>(null),[busy,setBusy]=useState(false),[loadFailed,setLoadFailed]=useState(false),[loadedOwner,setLoadedOwner]=useState<string|null>(null);
  const generation=useRef(0),running=useRef(false);
  useEffect(()=>{
    const current=++generation.current;let mounted=true;setRecord(null);setForm(emptyForm);setNotice(null);setLoadFailed(false);setLoadedOwner(null);setBusy(false);running.current=false;
    if(!native&&walletSession){
      setBusy(true);
      void loadCardRegistration().then(value=>{if(mounted&&current===generation.current){const restored=restoreForWallet(value,walletSession.address);setRecord(restored);setForm(restored?formOf(restored):emptyForm);setLoadedOwner(walletSession.address)}}).catch(()=>{if(mounted&&current===generation.current){setNotice("storageLoadFailure");setLoadFailed(true)}}).finally(()=>{if(mounted&&current===generation.current)setBusy(false)});
    }
    return()=>{mounted=false;generation.current++};
  },[native,walletSession?.address]);
  const persist=async(next:CardRegistration,success?:RegistrationCopyKey)=>{
    const current=generation.current;
    try{
      await saveCardRegistration(next);
      if(current!==generation.current)return;
      const readback=await loadCardRegistration();
      if(JSON.stringify(readback)!==JSON.stringify(next))throw Error("Registration persistence readback mismatch");
      if(current!==generation.current)return;
      setRecord(next);setForm(formOf(next));setNotice(success??null);
    }catch{if(current===generation.current)setNotice("storageSaveFailure")}
  };
  const run=async(action:()=>Promise<void>,fallback:RegistrationCopyKey)=>{
    if(native||running.current||busy||loadFailed)return;
    const current=generation.current;running.current=true;setBusy(true);setNotice(null);
    try{await action()}catch(error){if(current===generation.current)setNotice(registrationErrorKey(error,fallback))}
    finally{if(current===generation.current){running.current=false;setBusy(false)}}
  };
  const draft=()=>run(async()=>{if(!walletSession){setNotice("connectRequired");return}if(loadedOwner!==walletSession.address)return;await persist(createDraft(walletSession.address),"draftCreated")},"invalidApplication");
  const approve=()=>run(async()=>{if(!record||record.owner!==walletSession?.address.toLowerCase())return;const edited=updateDraft(record,{...form,controls:record.controls});await persist(requestApproval(edited,`approval-${record.id}`),"approvalPrepared")},"cannotApprove");
  const submit=()=>run(async()=>{if(!record||record.owner!==walletSession?.address.toLowerCase())return;const submitted=submitForBackend(record,`submit-${record.id}`);await persist(degrade(submitted,"No accepted Card registration backend receipt is available. No signature, account, ACTIVE card, balance, or top-up intent was created.",`degraded-${record.id}`),"backendDegraded")},"cannotSubmit");
  const cancelApplication=()=>run(async()=>{if(record&&record.owner===walletSession?.address.toLowerCase())await persist(cancel(record,`cancel-${record.id}`))},"cannotCancel");
  const textStyle=rtl?s.rtlText:undefined;
  if(native)return <View style={s.panel}><Text style={[s.title,textStyle]}>{copy("title")}</Text><Text style={[s.body,textStyle]}>{copy("disclaimer")}</Text><Text style={[s.status,textStyle]}>{copy("nativeUnavailable")}</Text><Text style={[s.body,textStyle]}>{copy("nativeDetails")}</Text><Text style={[s.body,textStyle]}>{copy("nativeAuthority")}</Text></View>;
  const disabled=busy||loadFailed||(walletSession!==null&&loadedOwner!==walletSession.address);
  return <View style={s.panel}>
    <Text style={[s.title,textStyle]}>{copy("title")}</Text><Text style={[s.body,textStyle]}>{copy("disclaimer")}</Text>
    {!record?<Pressable accessibilityRole="button" disabled={disabled} onPress={()=>void draft()} style={s.primary}><Text style={[s.primaryText,textStyle]}>{copy("start")}</Text></Pressable>:<>
      <Text style={[s.status,textStyle]}>{registrationTemplate(locale,"status",{status:registrationStatus(locale,record.status)})}</Text>
      {record.status==="DRAFT"?<>
        <TextInput accessibilityLabel={copy("nickname")} editable={!disabled} value={form.nickname} onChangeText={nickname=>setForm(previous=>({...previous,nickname}))} placeholder={copy("nickname")} style={[s.input,textStyle]}/>
        <TextInput accessibilityLabel={copy("useCase")} editable={!disabled} value={form.useCase} onChangeText={useCase=>setForm(previous=>({...previous,useCase}))} placeholder={copy("useCasePlaceholder")} style={[s.input,textStyle]}/>
        <TextInput accessibilityLabel={copy("limit")} editable={!disabled} value={form.spendingLimitYnxt} onChangeText={spendingLimitYnxt=>setForm(previous=>({...previous,spendingLimitYnxt}))} placeholder={copy("limitPlaceholder")} keyboardType="decimal-pad" style={[s.input,textStyle]}/>
        <View style={[s.control,rtl&&s.rowRTL]}><Text style={[s.controlBody,textStyle]}>{copy("risk")}</Text><Switch accessibilityLabel={copy("acceptTerms")} disabled={disabled} value={form.riskAccepted} onValueChange={riskAccepted=>setForm(previous=>({...previous,riskAccepted}))} trackColor={{true:BLUE}}/></View>
        <Pressable accessibilityRole="button" disabled={disabled} onPress={()=>void approve()} style={s.primary}><Text style={[s.primaryText,textStyle]}>{copy("prepareApproval")}</Text></Pressable>
      </>:null}
      {record.status==="APPROVAL_REQUIRED"?<Pressable accessibilityRole="button" disabled={disabled} onPress={()=>void submit()} style={s.primary}><Text style={[s.primaryText,textStyle]}>{copy("submit")}</Text></Pressable>:null}
      {record.status!=="ACTIVE"&&record.status!=="CANCELLED"?<Pressable accessibilityRole="button" disabled={disabled} onPress={()=>void cancelApplication()} style={s.secondary}><Text style={[s.secondaryText,textStyle]}>{copy("cancel")}</Text></Pressable>:null}
      <Text style={[s.audit,textStyle]}>{registrationTemplate(locale,"audit",{count:String(record.audit.length)})}</Text>
    </>}
    {notice?<Text accessibilityRole="alert" style={[s.notice,textStyle]}>{copy(notice)}</Text>:null}
  </View>;
}
const s=StyleSheet.create({panel:{padding:20,borderWidth:1,borderColor:LINE,borderRadius:14,gap:12,backgroundColor:"#FBFCFE"},title:{fontSize:20,fontWeight:"800",color:INK},body:{fontSize:13,lineHeight:19,color:MUTED},controlBody:{fontSize:13,lineHeight:19,color:MUTED,flex:1,minWidth:0},status:{fontWeight:"800",color:BLUE},input:{minHeight:46,borderWidth:1,borderColor:LINE,borderRadius:9,paddingHorizontal:12,backgroundColor:"#FFFFFF",color:INK},control:{minHeight:58,flexDirection:"row",gap:10,alignItems:"center"},rowRTL:{flexDirection:"row-reverse"},rtlText:{textAlign:"right",writingDirection:"rtl"},primary:{minHeight:46,justifyContent:"center",alignItems:"center",backgroundColor:BLUE,borderRadius:9,paddingHorizontal:16,paddingVertical:12},primaryText:{color:"#FFFFFF",fontWeight:"800",textAlign:"center"},secondary:{minHeight:44,justifyContent:"center",alignItems:"center",borderColor:BLUE,borderWidth:1,borderRadius:9,paddingHorizontal:16,paddingVertical:12},secondaryText:{color:BLUE,fontWeight:"800",textAlign:"center"},audit:{fontSize:12,lineHeight:18,color:MUTED},notice:{fontSize:13,lineHeight:19,color:INK,backgroundColor:"#F4F7FF",padding:12,borderRadius:9}});
