import {useEffect,useRef,useState} from "react";
import {ActivityIndicator,Modal,Pressable,StyleSheet,Text,View} from "react-native";
import {CameraView,useCameraPermissions} from "expo-camera";
import {SafeAreaView} from "react-native-safe-area-context";
import {parseWalletScan,type WalletScanResult} from "./walletScan";
import type {WalletLocale} from "../i18n/i18n";

export function WalletScanner({locale,accept,close}:{locale:WalletLocale;accept:(result:WalletScanResult)=>void;close:()=>void}) {
  const [permission,requestPermission]=useCameraPermissions(),[error,setError]=useState(false),[mountFailed,setMountFailed]=useState(false);
  const handled=useRef(false),active=useRef(true);
  const [permissionFailed,setPermissionFailed]=useState(false),[requesting,setRequesting]=useState(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  const c=(en:string,zh:string)=>locale==="zh-Hans"||locale==="zh-Hant"?zh:en;
  const dismiss=()=>{active.current=false;close()};
  const allowCamera=async()=>{if(requesting)return;setRequesting(true);setPermissionFailed(false);try{await requestPermission()}catch{if(active.current)setPermissionFailed(true)}finally{if(active.current)setRequesting(false)}};
  return <Modal visible animationType="slide" onRequestClose={dismiss}><SafeAreaView style={s.screen}>
    {!permission?<ActivityIndicator color="#fff"/>:!permission.granted?<View style={s.card}><Text style={s.title}>{c("Allow camera to scan","允许使用相机扫一扫")}</Text><Text style={s.body}>{c("Scanning only fills a receiving address or opens an app request for review. It never approves a transfer.","扫描只填写收款信息或打开应用请求供你核对，不会自动转账或批准。")}</Text>{permissionFailed?<Text accessibilityRole="alert" style={s.body}>{c("Camera permission could not be requested. Try again or enter the address manually.","无法请求相机权限，请重试或手动输入地址。")}</Text>:null}{permission.canAskAgain?<Pressable accessibilityRole="button" disabled={requesting} accessibilityState={{disabled:requesting}} onPress={()=>void allowCamera()}><Text style={s.action}>{c("Allow camera","允许相机")}</Text></Pressable>:<Text style={s.body}>{c("Camera permission is denied. You can enable it in system settings or enter the address manually.","相机权限已拒绝，可在系统设置中开启或手动输入地址。")}</Text>}</View>:mountFailed?<View style={s.card}><Text style={s.title}>{c("Camera unavailable","相机暂不可用")}</Text><Pressable accessibilityRole="button" onPress={()=>setMountFailed(false)}><Text style={s.action}>{c("Retry camera","重试相机")}</Text></Pressable></View>:<CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}} onMountError={()=>setMountFailed(true)} onBarcodeScanned={({data})=>{if(!active.current||handled.current)return;handled.current=true;try{const result=parseWalletScan(data);accept(result)}catch{if(active.current)setError(true)}}}/>}
    <View style={s.footer}><Text style={s.title}>{c("Scan QR code","扫一扫")}</Text><Text style={s.body}>{c("YNX Testnet receiving code, Pay invoice or WalletConnect connection code","YNX 测试网收款码、Pay 发票或 WalletConnect 连接码")}</Text>{error?<><Text accessibilityRole="alert" style={s.body}>{c("This code is invalid or belongs to another network. Nothing was approved.","此二维码无效或属于其他网络，未批准任何操作。")}</Text><Pressable accessibilityRole="button" onPress={()=>{handled.current=false;setError(false)}}><Text style={s.action}>{c("Scan again","重新扫描")}</Text></Pressable></>:null}<Pressable accessibilityRole="button" onPress={dismiss}><Text style={s.action}>{c("Cancel scan","取消扫描")}</Text></Pressable></View>
  </SafeAreaView></Modal>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:"#07132c",justifyContent:"center",padding:24},card:{gap:18},footer:{position:"absolute",bottom:48,left:24,right:24,padding:20,borderRadius:18,backgroundColor:"rgba(7,19,44,.94)",gap:12},title:{color:"#fff",fontSize:22,fontWeight:"700"},body:{color:"#e3ebff",fontSize:16,lineHeight:24},action:{color:"#98b9ff",fontSize:17,fontWeight:"700",paddingVertical:12}});
