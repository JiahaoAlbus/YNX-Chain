import {useEffect,useMemo,useRef,useState} from "react";
import {ActivityIndicator,Modal,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import {CameraView,useCameraPermissions} from "expo-camera";
import {SafeAreaView} from "react-native-safe-area-context";
import {parseWalletScan,type WalletScanResult} from "./walletScan";
import {isRTL,type WalletLocale} from "../i18n/i18n";
import {scannerCopy,type ScannerCopyKey} from "../i18n/scannerCopy";

export function WalletScanner({locale,accept,close,textScale=1}:{locale:WalletLocale;accept:(result:WalletScanResult)=>void;close:()=>void;textScale?:number}) {
  const s=useMemo(()=>createStyles(Number.isFinite(textScale)&&textScale>0?textScale:1),[textScale]),rtl=isRTL(locale);
  const [permission,requestPermission]=useCameraPermissions(),[error,setError]=useState(false),[mountFailed,setMountFailed]=useState(false);
  const handled=useRef(false),active=useRef(true),permissionBusy=useRef(false);
  const [permissionFailed,setPermissionFailed]=useState(false),[requesting,setRequesting]=useState(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  const c=(key:ScannerCopyKey)=>scannerCopy(locale,key);
  const dismiss=()=>{active.current=false;close()};
  const allowCamera=async()=>{if(!active.current||permissionBusy.current)return;permissionBusy.current=true;setRequesting(true);setPermissionFailed(false);try{await requestPermission()}catch{if(active.current)setPermissionFailed(true)}finally{permissionBusy.current=false;if(active.current)setRequesting(false)}};
  return <Modal visible animationType="slide" onRequestClose={dismiss}><SafeAreaView style={[s.screen,rtl&&s.rtl]}>
    {permission?.granted&&!mountFailed?<CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}} onMountError={()=>{if(active.current)setMountFailed(true)}} onBarcodeScanned={({data})=>{if(!active.current||handled.current)return;handled.current=true;try{const result=parseWalletScan(data);accept(result)}catch{if(active.current)setError(true)}}}/>:null}
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
    {!permission?<ActivityIndicator color="#fff"/>:!permission.granted?<View style={s.card}><Text style={[s.title,rtl&&s.rtlText]}>{c("allowTitle")}</Text><Text style={[s.body,rtl&&s.rtlText]}>{c("reviewOnly")}</Text>{permissionFailed?<Text accessibilityRole="alert" style={[s.body,rtl&&s.rtlText]}>{c("permissionFailure")}</Text>:null}{permission.canAskAgain?<Pressable accessibilityRole="button" style={s.actionButton} disabled={requesting} accessibilityState={{disabled:requesting}} onPress={()=>void allowCamera()}><Text style={[s.action,rtl&&s.rtlText]}>{c("allow")}</Text></Pressable>:<Text style={[s.body,rtl&&s.rtlText]}>{c("denied")}</Text>}</View>:mountFailed?<View style={s.card}><Text style={[s.title,rtl&&s.rtlText]}>{c("unavailable")}</Text><Pressable accessibilityRole="button" style={s.actionButton} onPress={()=>setMountFailed(false)}><Text style={[s.action,rtl&&s.rtlText]}>{c("retry")}</Text></Pressable></View>:null}
    <View style={s.footer}><Text style={[s.title,rtl&&s.rtlText]}>{c("title")}</Text><Text style={[s.body,rtl&&s.rtlText]}>{c("kinds")}</Text>{error?<><Text accessibilityRole="alert" style={[s.body,rtl&&s.rtlText]}>{c("invalid")}</Text><Pressable accessibilityRole="button" style={s.actionButton} onPress={()=>{handled.current=false;setError(false)}}><Text style={[s.action,rtl&&s.rtlText]}>{c("again")}</Text></Pressable></>:null}<Pressable accessibilityRole="button" style={s.actionButton} onPress={dismiss}><Text style={[s.action,rtl&&s.rtlText]}>{c("cancel")}</Text></Pressable></View>
  </ScrollView></SafeAreaView></Modal>;
}
function createStyles(scale:number){return StyleSheet.create({screen:{flex:1,backgroundColor:"#07132c",padding:24},rtl:{direction:"rtl"},rtlText:{writingDirection:"rtl",textAlign:"right"},content:{flexGrow:1,justifyContent:"flex-end",gap:24,paddingVertical:16},card:{gap:18,padding:20,borderRadius:18,backgroundColor:"#07132c"},footer:{padding:20,borderRadius:18,backgroundColor:"rgba(7,19,44,.94)",gap:12},title:{color:"#fff",fontSize:22*scale,fontWeight:"700"},body:{color:"#e3ebff",fontSize:16*scale,lineHeight:24*scale},actionButton:{minHeight:44,minWidth:44,justifyContent:"center"},action:{color:"#98b9ff",fontSize:17*scale,fontWeight:"700",paddingVertical:12}})}
