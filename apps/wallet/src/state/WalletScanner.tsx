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
  const [routeFailed,setRouteFailed]=useState(false),[cameraRevision,setCameraRevision]=useState(0),[consumed,setConsumed]=useState(false);
  const permissionState=!permission?"pending":permission.granted?"granted":permission.canAskAgain?"askable":"denied";
  const cameraEpoch=useRef(0),permissionSnapshot=useRef(permissionState);
  // Revoke old granted-render callbacks before effects/unmount can run.
  if(permissionSnapshot.current!==permissionState){cameraEpoch.current++;permissionSnapshot.current=permissionState}
  const cameraTicket=cameraEpoch.current;
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  const c=(key:ScannerCopyKey)=>scannerCopy(locale,key);
  const currentCamera=()=>active.current&&cameraEpoch.current===cameraTicket;
  const retireCamera=()=>{cameraEpoch.current++;setCameraRevision(cameraEpoch.current)};
  const dismiss=()=>{if(!active.current)return;active.current=false;retireCamera();close()};
  const allowCamera=async()=>{if(!currentCamera()||permissionBusy.current||permission?.granted||!permission?.canAskAgain)return;permissionBusy.current=true;setRequesting(true);setPermissionFailed(false);try{await requestPermission()}catch{if(currentCamera())setPermissionFailed(true)}finally{permissionBusy.current=false;if(active.current)setRequesting(false)}};
  const cameraLive=Boolean(permission?.granted)&&!mountFailed&&!error&&!routeFailed&&!consumed;
  const cameraMountError=()=>{if(!currentCamera()||!cameraLive)return;retireCamera();setMountFailed(true)};
  const retryCamera=()=>{if(!currentCamera()||!permission?.granted||!mountFailed)return;retireCamera();setMountFailed(false)};
  const scanAgain=()=>{if(!currentCamera()||(!error&&!routeFailed))return;retireCamera();handled.current=false;setConsumed(false);setError(false);setRouteFailed(false)};
  const scanBarcode=(data:string)=>{
    if(!currentCamera()||!cameraLive||handled.current)return;
    handled.current=true;
    let result:WalletScanResult;
    try{result=parseWalletScan(data)}catch{retireCamera();setError(true);return}
    // Stop this camera before handing input to the existing product route.
    // Old native frames/mount errors cannot become input to a retried camera.
    retireCamera();setConsumed(true);
    try{accept(result)}catch{if(active.current)setRouteFailed(true)}
  };
  return <Modal visible animationType="slide" onRequestClose={dismiss}><SafeAreaView style={[s.screen,rtl&&s.rtl]}>
    {cameraLive?<CameraView key={cameraRevision} style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}} onMountError={cameraMountError} onBarcodeScanned={({data})=>scanBarcode(data)}/>:null}
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
    {!permission?<ActivityIndicator color="#fff"/>:!permission.granted?<View style={s.card}><Text style={[s.title,rtl&&s.rtlText]}>{c("allowTitle")}</Text><Text style={[s.body,rtl&&s.rtlText]}>{c("reviewOnly")}</Text>{permissionFailed?<Text accessibilityRole="alert" style={[s.body,rtl&&s.rtlText]}>{c("permissionFailure")}</Text>:null}{permission.canAskAgain?<Pressable accessibilityRole="button" style={s.actionButton} disabled={requesting} accessibilityState={{disabled:requesting}} onPress={()=>void allowCamera()}><Text style={[s.action,rtl&&s.rtlText]}>{c("allow")}</Text></Pressable>:<Text style={[s.body,rtl&&s.rtlText]}>{c("denied")}</Text>}</View>:mountFailed?<View style={s.card}><Text style={[s.title,rtl&&s.rtlText]}>{c("unavailable")}</Text><Pressable accessibilityRole="button" style={s.actionButton} onPress={retryCamera}><Text style={[s.action,rtl&&s.rtlText]}>{c("retry")}</Text></Pressable></View>:null}
    <View style={s.footer}><Text style={[s.title,rtl&&s.rtlText]}>{c("title")}</Text><Text style={[s.body,rtl&&s.rtlText]}>{c("kinds")}</Text>{error||routeFailed?<><Text accessibilityRole="alert" style={[s.body,rtl&&s.rtlText]}>{c(routeFailed?"routeFailure":"invalid")}</Text><Pressable accessibilityRole="button" style={s.actionButton} onPress={scanAgain}><Text style={[s.action,rtl&&s.rtlText]}>{c("again")}</Text></Pressable></>:null}<Pressable accessibilityRole="button" style={s.actionButton} onPress={dismiss}><Text style={[s.action,rtl&&s.rtlText]}>{c("cancel")}</Text></Pressable></View>
  </ScrollView></SafeAreaView></Modal>;
}
function createStyles(scale:number){return StyleSheet.create({screen:{flex:1,backgroundColor:"#07132c",padding:24},rtl:{direction:"rtl"},rtlText:{writingDirection:"rtl",textAlign:"right"},content:{flexGrow:1,justifyContent:"flex-end",gap:24,paddingVertical:16},card:{gap:18,padding:20,borderRadius:18,backgroundColor:"#07132c"},footer:{padding:20,borderRadius:18,backgroundColor:"rgba(7,19,44,.94)",gap:12},title:{color:"#fff",fontSize:22*scale,fontWeight:"700"},body:{color:"#e3ebff",fontSize:16*scale,lineHeight:24*scale},actionButton:{minHeight:44,minWidth:44,justifyContent:"center"},action:{color:"#98b9ff",fontSize:17*scale,fontWeight:"700",paddingVertical:12}})}
