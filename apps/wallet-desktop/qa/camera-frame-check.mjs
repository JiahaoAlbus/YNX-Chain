// SDK-free QA only: no Wallet main, real camera, account, RPC or authority.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import QRCode from "qrcode";
import {decodeLocalQRText} from "../src/walletconnect-qr-decoder.mjs";
import {assertWalletIPC} from "../src/wallet-ipc-policy.mjs";
const require=createRequire(import.meta.url);
const {app,BrowserWindow,ipcMain,nativeImage}=require("electron");
const profile=process.argv[2];
if (!profile?.startsWith("/tmp/ynx-wallet-camera-frame-20261004-") || path.resolve(profile)!==profile || profile.includes("..")) throw Error("Fresh isolated QA profile required");
app.enableSandbox();app.setPath("userData",profile);app.setPath("sessionData",profile);app.disableHardwareAcceleration();
if (process.platform==="darwin") app.setActivationPolicy("prohibited");
const account="ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt",uri=`ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
const qr=QRCode.create(uri,{errorCorrectionLevel:"M"});
const page=fileURLToPath(new URL("camera-frame-check.html",import.meta.url)),url=pathToFileURL(page).href;
let window,mediaRequests=0,networkRequests=0,done=false;
const rows=[];
ipcMain.on("frame-qa:stage",(event,stage)=>{assertWalletIPC(event,window.webContents,url);console.log("FRAME_QA_STAGE",stage);});
function finish(error) {
  if(done)return;done=true;
  const graph=Object.keys(require.cache).filter(name=>name.includes("/node_modules/")).map(name=>{
    try{return {path:name,sha256:createHash("sha256").update(readFileSync(name)).digest("hex")};}
    catch{return {path:name,status:"UNREADABLE_TOOL_INPUT"};}
  });
  if(graph.some(row=>!row.sha256))error??=Error("Tool graph could not be hashed completely");
  if(graph.some(row=>row.path.includes("/wallet-auth/")))error??=Error("Unexpected Wallet SDK imported");
  const result={electronVersion:process.versions.electron,platform:process.platform,profile:app.getPath("userData"),
    mode:"SYNTHETIC_CANVAS_MEDIASTREAM_NOT_PHYSICAL_CAMERA",windowCreated:Boolean(window),visibleWindow:window?.isVisible()??false,mediaRequests,networkRequests,networkDenied:true,
    originalCaptureModule:true,originalLocalQRDecoder:true,nativeImage:true,checksumProducer:"NOT_RUN",walletMainOrSDK:"NOT_RUN",graph,rows,error:error?.message??null};
  console.log(JSON.stringify(result,null,2));
  window?.destroy();app.exit(error?1:0);
}
setTimeout(()=>finish(Error("Hidden frame QA timed out")),30000);
process.on("uncaughtException",finish);process.on("unhandledRejection",finish);
ipcMain.handle("frame-qa:fixture",event=>{assertWalletIPC(event,window.webContents,url);return {uri,size:qr.modules.size,modules:Array.from(qr.modules.data)};});
ipcMain.handle("frame-qa:decode",(event,input)=>{
  assertWalletIPC(event,window.webContents,url);
  const bytes=Buffer.from(input.bytes),image=nativeImage.createFromBuffer(bytes);
  let text;
  try {text=decodeLocalQRText({bytes,mimeType:input.mimeType,createImage:buffer=>nativeImage.createFromBuffer(buffer)});}
  catch(error) {
    if(input.expectedReject!==true||error.code!=="QR_DECODE_FAILED")throw error;
    rows.push({expectedNoQR:true,observedCode:error.code,encodedBytes:bytes.length,nativeDimensions:image.getSize(),pass:true});
    return {rejected:true,code:error.code};
  }
  assert.notEqual(input.expectedReject,true,"Blank frame unexpectedly decoded");
  assert.equal(text,uri);const size=image.getSize();assert.ok(size.width<=720&&size.height<=720);
  rows.push({decodedExactURI:true,mimeType:input.mimeType,encodedBytes:bytes.length,nativeDimensions:size,pass:true});
  return {text,...size};
});
ipcMain.on("frame-qa:done",(event,result)=>{
  assertWalletIPC(event,window.webContents,url);
  try {assert.equal(result.ok,true,result.error);assert.equal(rows.length,3);assert.equal(mediaRequests,0);assert.equal(networkRequests,0);assert.equal(window.isVisible(),false);assert.equal(app.getPath("userData"),profile);finish();}catch(error){finish(error);}
});
// Do not top-level-await readiness: Electron waits for main ESM evaluation
// before announcing ready. Schedule the hidden window after module evaluation.
app.whenReady().then(async()=>{
window=new BrowserWindow({show:false,width:800,height:800,webPreferences:{preload:fileURLToPath(new URL("camera-frame-preload.cjs",import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}});
window.webContents.on("console-message",(_event,details)=>console.log("FRAME_QA_CONSOLE",details?.message));
window.webContents.on("did-fail-load",(_event,code,description)=>console.log("FRAME_QA_LOAD_FAILURE",code,description));
window.webContents.session.setPermissionCheckHandler(()=>false);
window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>{mediaRequests++;callback(false);});
window.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*","ws://*/*","wss://*/*"]},(_details,callback)=>{networkRequests++;callback({cancel:true});});
window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
window.webContents.on("will-navigate",(event,target)=>{if(target!==url)event.preventDefault();});
await window.loadFile(page);
}).catch(finish);
