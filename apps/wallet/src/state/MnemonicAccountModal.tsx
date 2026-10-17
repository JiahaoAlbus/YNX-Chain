import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {AppState,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {MnemonicInputController} from "./mnemonicInput";
import {importMobileMnemonic,type MnemonicAccountMaterial} from "../security/mnemonicAccount";

export type MnemonicAccountModalProps={
  visible:boolean; mode:"import"|"backup"; locale?:string;
  /** Existing WalletOperationLifecycle account/generation binding from A. */
  accountBinding:string; operationRevision:number; assertCurrent:()=>void;
  backup?:MnemonicAccountMaterial;
  /** Local protected repository custody only, never signing/session approval. */
  onImport:(material:MnemonicAccountMaterial,assertCurrent:()=>void)=>Promise<void>;
  onConfirmBackup:(material:MnemonicAccountMaterial,assertCurrent:()=>void)=>Promise<void>;
  onClose:()=>void;
};
/** Mount only from the existing Wallet's button-driven setup/recovery flow.
 * A retains App.tsx integration ownership; this component grants no authority. */
export function MnemonicAccountModal(props:MnemonicAccountModalProps){
  const form=useMemo(()=>new MnemonicInputController(),[]);
  const epoch=useRef(0),actionBusy=useRef(false);
  const onCloseRef=useRef(props.onClose);onCloseRef.current=props.onClose;
  const session=useRef<{active:boolean;visible:boolean;mode:string;account:string;revision:number;backup:MnemonicAccountMaterial|undefined;deadline:number}>({active:false,visible:false,mode:props.mode,account:props.accountBinding,revision:props.operationRevision,backup:props.backup,deadline:0});
  const timerRef=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [sessionOpen,setSessionOpen]=useState(false);
  const [,render]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [backupVisible,setBackupVisible]=useState(false),[answers,setAnswers]=useState(["","",""]);
  const zh=props.locale?.startsWith("zh")??false;
  const refresh=()=>render(value=>value+1);
  const clearSession=useCallback(()=>{session.current.active=false;clearTimeout(timerRef.current);timerRef.current=undefined;epoch.current++;actionBusy.current=false;form.clear();setSessionOpen(false);setBackupVisible(false);setAnswers(["","",""]);setError(null);setBusy(false);render(value=>value+1);},[form]);
  const dismiss=useCallback(()=>{if(!session.current.active)return;clearSession();onCloseRef.current();},[clearSession]);
  useEffect(()=>{
    const prior=session.current;
    const opening=props.visible&&!prior.visible;
    const changed=prior.mode!==props.mode||prior.account!==props.accountBinding||prior.revision!==props.operationRevision||prior.backup!==props.backup;
    prior.visible=props.visible;
    if(!props.visible){clearSession();return;}
    if(changed&&prior.active){dismiss();return;}
    if(!opening)return;
    clearSession();
    session.current={active:true,visible:true,mode:props.mode,account:props.accountBinding,revision:props.operationRevision,backup:props.backup,deadline:Date.now()+60000};
    try{props.assertCurrent();if(AppState.currentState!=="active"||props.mode==="backup"&&!props.backup)throw Error("Inactive or missing backup");form.begin(props.mode==="backup"?props.backup!.wordCount:12);setSessionOpen(true);timerRef.current=setTimeout(dismiss,Math.max(0,session.current.deadline-Date.now()));refresh();}catch{dismiss();}
  },[props.visible,props.mode,props.accountBinding,props.operationRevision,props.backup,form,clearSession,dismiss]);
  useEffect(()=>{
    const subscription=AppState.addEventListener("change",state=>{if(state!=="active")dismiss();});
    return()=>{clearTimeout(timerRef.current);subscription.remove();session.current.active=false;epoch.current++;actionBusy.current=false;form.clear();};
  },[form,dismiss]);
  const isOpen=props.visible&&sessionOpen&&session.current.active&&session.current.mode===props.mode&&session.current.account===props.accountBinding&&session.current.revision===props.operationRevision&&session.current.backup===props.backup;
  const view=form.view(),words=props.mode==="backup"?props.backup?.phrase.split(" ")??[]:view.words;
  const positions=words.length?[0,Math.floor(words.length/2),words.length-1]:[];
  const backupReady=words.length>0&&positions.every((index,i)=>answers[i]?.trim()===words[index]);
  const commit=async()=>{
    if(actionBusy.current||!isOpen)return;
    const ticket=epoch.current;
    let check:()=>void=props.assertCurrent;
    try{
      props.assertCurrent();
      if(props.mode==="import"){
        const review=form.review();check=()=>{if(ticket!==epoch.current)throw Error("Closed");review.assertCurrent();props.assertCurrent();};
        actionBusy.current=true;setBusy(true);await props.onImport(review.material,check);
      }else{
        if(!props.backup||!backupReady)return;
        const material=importMobileMnemonic(props.backup.phrase,"",props.assertCurrent);
        if(material.secretHex!==props.backup.secretHex||material.account!==props.backup.account)throw Error("Backup mismatch");
        // A must bind its captured operation. Closing also invalidates form's
        // review even in backup mode; no delayed callback may report success.
        form.setWord(0,material.phrase);const review=form.review();check=()=>{if(ticket!==epoch.current)throw Error("Closed");review.assertCurrent();props.assertCurrent();};
        actionBusy.current=true;setBusy(true);await props.onConfirmBackup(material,check);
      }
      check();dismiss();
    }catch{
      // Do not echo library messages, pasted words or private record contents.
      try{check();setError(zh?"无法确认账户操作。请保留备份并重新检查钱包状态。":"Account operation could not be confirmed. Keep your backup and check Wallet state.");}catch{/* Closed/locked requests stay hidden. */}
    }finally{if(ticket===epoch.current){actionBusy.current=false;setBusy(false);}}
  };
  return <Modal visible={isOpen} transparent animationType="slide" onRequestClose={dismiss}>
    <View style={styles.overlay}><View style={styles.sheet}>
      <Text style={styles.title}>{props.mode==="backup"?(zh?"备份助记词":"Back up recovery phrase"):(zh?"导入助记词":"Import recovery phrase")}</Text>
      <Text>{zh?"仅在此设备填写，不要发给任何人。助记词密码（passphrase）当前不支持；不要将其忽略。":"Enter locally; never share it. Passphrase-protected phrases are not supported; do not omit the passphrase."}</Text>
      {props.mode==="import"?<View style={styles.buttons}>{([12,24] as const).map(count=><Pressable key={count} accessibilityRole="button" accessibilityState={{selected:view.wordCount===count,disabled:busy}} disabled={busy} onPress={()=>{form.select(count);refresh();}} style={styles.button}><Text>{count} {zh?"个词":"words"}</Text></Pressable>)}</View>:null}
      <Pressable accessibilityRole="button" onPress={()=>{if(props.mode==="backup")setBackupVisible(value=>!value);else{form.toggleVisibility();refresh();}}} disabled={busy} style={styles.button}><Text>{(props.mode==="backup"?backupVisible:view.visible)?(zh?"隐藏助记词":"Hide words"):(zh?"显示助记词":"Show words")}</Text></Pressable>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}><View style={styles.grid}>
        {words.map((word,index)=><View key={index} style={styles.cell}><Text>{index+1}.</Text>{props.mode==="backup"?<Text accessibilityLabel={`${index+1}`} style={styles.word}>{backupVisible?word:"••••••"}</Text>:<TextInput accessibilityLabel={`${zh?"助记词":"Recovery word"} ${index+1}`} value={word} secureTextEntry={!view.visible} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none" maxLength={512} editable={!busy} style={styles.input} onChangeText={value=>{try{form.setWord(index,value);setError(null);}catch{setError(zh?"请填写英文单词；整句粘贴必须与所选词数一致，不会截断。":"Use English words. Pasted phrases must match the chosen word count; no truncation.");}refresh();}}/>}</View>)}
      </View>{props.mode==="backup"?positions.map((index,i)=><TextInput key={i} accessibilityLabel={`${zh?"确认第":"Confirm word"} ${index+1}`} placeholder={`${index+1}`} value={answers[i]} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" editable={!busy} style={styles.input} onChangeText={value=>setAnswers(old=>old.map((entry,j)=>j===i?value:entry))}/>):null}</ScrollView>
      {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
      <View style={styles.buttons}><Pressable accessibilityRole="button" style={styles.button} onPress={dismiss}><Text>{zh?"取消":"Cancel"}</Text></Pressable><Pressable accessibilityRole="button" style={styles.button} disabled={busy||(props.mode==="import"?!view.complete:!backupReady)} onPress={()=>void commit()}><Text>{busy?(zh?"处理中…":"Working…"):(props.mode==="import"?(zh?"导入账户":"Import account"):(zh?"已备份并确认":"Confirm backup"))}</Text></Pressable></View>
    </View></View>
  </Modal>;
}
const styles=StyleSheet.create({overlay:{flex:1,justifyContent:"center",padding:16,backgroundColor:"#0008"},sheet:{maxHeight:"90%",padding:20,borderRadius:20,backgroundColor:"#fff"},title:{fontSize:23,fontWeight:"700",marginBottom:12},buttons:{flexDirection:"row",gap:12,marginVertical:10},button:{padding:12,borderRadius:10,borderWidth:1,borderColor:"#163bba"},scroll:{flexGrow:0},grid:{flexDirection:"row",flexWrap:"wrap",gap:8},cell:{width:"47%",padding:8,borderWidth:1,borderColor:"#d9e1f3",borderRadius:10,flexDirection:"row",alignItems:"center",gap:5},word:{flex:1},input:{flex:1,minHeight:42,padding:8,borderWidth:1,borderColor:"#d9e1f3",borderRadius:8},error:{color:"#a11818"}});
