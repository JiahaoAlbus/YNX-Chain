// Isolated Chromium software devices, not Wallet boot or physical camera QA.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
import {runInNewContext} from "node:vm";
import {createRecipientCameraPermission} from "../src/recipient-camera-permission.mjs";
import {assertWalletIPC} from "../src/wallet-ipc-policy.mjs";
const require=createRequire(import.meta.url),{app,BrowserWindow,ipcMain}=require("electron");
const profile=process.argv[2];
if(!profile?.startsWith("/tmp/ynx-wallet-camera-permission-20261004-")||path.resolve(profile)!==profile||profile.includes(".."))throw Error("Fresh isolated profile required");
app.enableSandbox();app.setPath("userData",profile);app.setPath("sessionData",profile);app.disableHardwareAcceleration();
// No fake-ui switch: original permission check/request callbacks must execute.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
if(process.platform==="darwin")app.setActivationPolicy("prohibited");
const page=fileURLToPath(new URL("camera-permission-check.html",import.meta.url)),url=pathToFileURL(page).href;
const context={focused:true,locked:false,authenticating:false,changing:false,account:"public-QA-context",revision:1};
let window,gate,clock=0,serial=0,networkRequests=0,done=false;
const callbacks=[],rows=[];
function finish(error){if(done)return;done=true;
 const graph=Object.keys(require.cache).filter(name=>name.includes("/node_modules/")).map(name=>{
  try{return {path:name,sha256:createHash("sha256").update(readFileSync(name)).digest("hex")};}
  catch{return {path:name,status:"UNREADABLE_TOOL_INPUT"};}
 });
 if(graph.some(row=>!row.sha256||row.path.includes("/wallet-auth/")))error??=Error("Unexpected or unreadable tool graph");
 console.log(JSON.stringify({electron:process.versions.electron,profile,mode:"CHROMIUM_SOFTWARE_DEVICE_ACTUAL_PERMISSION_CALLBACKS_CONTROLLED_CONTEXT",
  visible:window?.isVisible()??false,networkRequests,callbacks,rows,graph,error:error?.message??null,
  inputs:["../src/main.mjs","../src/recipient-camera-permission.mjs","../src/wallet-ipc-policy.mjs"].map(relative=>({relative,sha256:createHash("sha256").update(readFileSync(new URL(relative,import.meta.url))).digest("hex")})),
  notRun:["Wallet Main or SDK boot","Actual key/focus lifecycle","OS permission dialog","Physical camera/microphone","Private signing","Installed release"]},null,2));
 window?.destroy();app.exit(error?1:0);
}
setTimeout(()=>finish(Error("Permission QA timeout")),30000);
process.on("uncaughtException",finish);process.on("unhandledRejection",finish);
ipcMain.handle("permission-qa:prepare",(event,mode)=>{
 assertWalletIPC(event,window.webContents,url);gate.invalidate();clock=0;
 Object.assign(context,{focused:true,locked:false,authenticating:false,changing:false,account:"public-QA-context",revision:1});
 if(mode!=="no-permit")gate.begin();
 if(mode==="expired")clock=60000;
 if(mode==="account")context.account="changed-public-QA-context";
 if(mode==="revision")context.revision++;
 if(mode==="locked")context.locked=true;
 if(mode==="unfocused")context.focused=false;
 if(mode==="authenticating")context.authenticating=true;
 if(mode==="changing")context.changing=true;
 if(mode==="end"){const latest=gate.begin();gate.end(latest.id);}
 if(mode==="invalidate")gate.invalidate();
 if(mode==="retired-end"){const old=gate.begin();gate.begin();gate.end(old.id);}
 return {callbackOffset:callbacks.length};
});
ipcMain.on("permission-qa:row",(event,row)=>{assertWalletIPC(event,window.webContents,url);rows.push(row);});
ipcMain.on("permission-qa:done",(event,result)=>{assertWalletIPC(event,window.webContents,url);
 try{assert.equal(result.ok,true,result.error);assert.equal(rows.length,14);assert.ok(rows.every(row=>row.pass));assert.equal(networkRequests,0);assert.equal(window.isVisible(),false);
  for(let i=0;i<rows.length;i++){
   const row=rows[i],end=rows[i+1]?.callbackOffset??callbacks.length;
   const requests=callbacks.slice(row.callbackOffset,end).filter(item=>item.phase==="request"&&item.permission==="media");
   assert.equal(requests.length,1);assert.equal(requests[0].allowed,row.expected);
   assert.equal(requests[0].isMainFrame,true);assert.equal(requests[0].requestingUrl,url);
   assert.deepEqual(requests[0].mediaTypes,[...(row.audio?["audio"]:[]),...(row.video?["video"]:[])]);
  }
  assert.ok(callbacks.some(row=>row.phase==="request"&&row.allowed===true));assert.ok(callbacks.some(row=>row.phase==="request"&&row.allowed===false));finish();}catch(error){finish(error);}
});
app.whenReady().then(async()=>{
 window=new BrowserWindow({show:false,webPreferences:{preload:fileURLToPath(new URL("camera-permission-preload.cjs",import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true,backgroundThrottling:false}});
 gate=createRecipientCameraPermission({getContext:()=>context,getContents:()=>window.webContents,expectedURL:url,id:()=>`public-QA-${++serial}`,now:()=>clock});
 const source=readFileSync(new URL("../src/main.mjs",import.meta.url),"utf8");
 const actual=source.slice(source.indexOf("window.webContents.session.setPermissionCheckHandler"),source.indexOf('window.on("blur"'));
 let check,request;
 runInNewContext(actual,{window:{webContents:{session:{setPermissionCheckHandler:fn=>check=fn,setPermissionRequestHandler:fn=>request=fn}}},recipientCameraPermission:gate});
 const record=(phase,permission,details,allowed)=>callbacks.push({phase,permission,allowed,isMainFrame:details?.isMainFrame,requestingUrl:details?.requestingUrl,mediaType:details?.mediaType,mediaTypes:details?.mediaTypes});
 window.webContents.session.setPermissionCheckHandler((contents,permission,origin,details)=>{const allowed=check(contents,permission,origin,details);record("check",permission,details,allowed);return allowed;});
 window.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>request(contents,permission,allowed=>{record("request",permission,details,allowed);callback(allowed);},details));
 window.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*","ws://*/*","wss://*/*"]},(_details,callback)=>{networkRequests++;callback({cancel:true});});
 window.webContents.setWindowOpenHandler(()=>({action:"deny"}));window.webContents.on("will-navigate",(event,target)=>{if(target!==url)event.preventDefault();});
 await window.loadFile(page);
}).catch(finish);
