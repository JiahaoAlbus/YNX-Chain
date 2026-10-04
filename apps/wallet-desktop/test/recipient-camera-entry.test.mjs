import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createRecipientCameraUI,captureRecipientFrame} from "../src/recipient-camera-ui.mjs";
import {createRecipientCameraPermission} from "../src/recipient-camera-permission.mjs";
import {createRecipientScanUI} from "../src/recipient-scan-ui.mjs";
import {createPaymentRecipientUI} from "../src/payment-recipient-ui.mjs";
import {fileInputDOM} from "./fixture-file-input-dom.mjs";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const account="ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt";
function mounted(decode) {
  const nodes=new Map(),events=[];let stops=0;
  function node(){return {listeners:{},hidden:true,open:true,textContent:"",value:"",addEventListener(type,fn){this.listeners[type]=fn;},focus(){},pause(){},play:async()=>{},videoWidth:21,videoHeight:21,readyState:2};}
  const selectors=["#send-sheet","#recipient-camera-video","#scan-recipient","#recipient-scan-panel","#recipient-qr-file","#start-recipient-camera","#stop-recipient-camera","#recipient-status"];
  for(const selector of selectors)nodes.set(selector,node());
  nodes.set("#recipient-qr-file",fileInputDOM(nodes.get("#recipient-qr-file"),next=>nodes.set("#recipient-qr-file",next)));
  const document={visibilityState:"visible",hasFocus:()=>true,querySelector:selector=>nodes.get(selector),addEventListener(type,fn){events.push([type,fn]);},createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:done=>done({type:"image/png",size:1,arrayBuffer:async()=>new ArrayBuffer(1)})})};
  const keyState={locked:false,authenticating:false,revision:2},accountState={account:"public-original"};
  const consumerContext=()=>({open:nodes.get("#send-sheet").open,account:accountState.account,locked:keyState.locked,keyRevision:keyState.revision});
  const applied=[],parseReads=[];
  const paymentRecipientUI=createPaymentRecipientUI({getContext:consumerContext,parse:async value=>{parseReads.push(value);return {ok:true,value:{ynxAccount:value,chainId:"ynx_6423-1",asset:"YNXT"}};},decode:()=>{throw Error("file path not requested");},apply:value=>applied.push(value),report:()=>{}});
  const source=readFileSync(new URL("../src/renderer.js",import.meta.url),"utf8");
  const actual=source.slice(source.indexOf("const recipientScanContext="),source.indexOf("function invalidatePaymentInput()"));
  const sandbox={document,keyState,accountState,paymentRecipientUI,paymentDraftRevision:3,recipientCameraUI:null,
    copyUI:(node,copy)=>{node.textContent=copy;},captureRecipientFrame,createRecipientScanUI,
    createRecipientCameraUI:options=>createRecipientCameraUI({...options,schedule:()=>0,cancel:()=>{}}),
    navigator:{mediaDevices:{getUserMedia:async constraints=>{events.push(["media",constraints]);return {getTracks:()=>[{stop:()=>{stops++;}}]};}}},
    window:{addEventListener:(type,fn)=>events.push([type,fn]),ynxWallet:{beginRecipientCamera:async()=>({ok:true,value:{id:"public-camera-permit"}}),endRecipientCamera:async id=>events.push(["end",id]),paymentQR:decode}}};
  runInNewContext(actual,sandbox);
  return {nodes,events,applied,parseReads,keyState,accountState,document,get stops(){return stops;}};
}
test("actual mounted camera button runs original input parser only after stopping capture",async()=>{
  const h=mounted(async()=>({ok:true,value:{ynxAccount:account,chainId:"ynx_6423-1",asset:"YNXT",amount:"never copy"}}));
  assert.equal(h.events.filter(e=>e[0]==="media").length,0);
  h.nodes.get("#start-recipient-camera").listeners.click();await tick();await tick();
  assert.equal(h.events.filter(e=>e[0]==="media").length,1);assert.equal(h.events.find(e=>e[0]==="media")[1].audio,false);
  assert.equal(h.stops,1);assert.deepEqual(h.parseReads,[account]);assert.deepEqual(h.applied,[account]);assert.equal(h.nodes.get("#recipient-camera-video").srcObject,null);
});
test("actual mounted blur retires a late frame without filling the old recipient",async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});const h=mounted(()=>pending);
  h.nodes.get("#start-recipient-camera").listeners.click();await tick();h.events.find(e=>e[0]==="blur")[1]();
  resolve({ok:true,value:{ynxAccount:account,chainId:"ynx_6423-1",asset:"YNXT"}});await tick();assert.equal(h.stops,1);assert.deepEqual(h.applied,[]);
});
test("actual mounted image chooser and Stop button release capture without decoding or signing",async()=>{
  const h=mounted(async()=>({ok:false}));h.nodes.get("#start-recipient-camera").listeners.click();await tick();
  h.nodes.get("#recipient-qr-file").listeners.click();await tick();assert.equal(h.stops,1);assert.deepEqual(h.applied,[]);
  h.nodes.get("#stop-recipient-camera").listeners.click();assert.equal(h.nodes.get("#recipient-status").textContent,"Camera stopped.");
});
test("actual Main session callbacks delegate both media request/check to the bound video permit",()=>{
  let request,check;const contents={isDestroyed:()=>false,mainFrame:{url:"file:///owned/index.html"}};
  const gate=createRecipientCameraPermission({getContext:()=>({focused:true,locked:false,account:"original",revision:1}),getContents:()=>contents,expectedURL:contents.mainFrame.url,id:()=>"permit"});
  const source=readFileSync(new URL("../src/main.mjs",import.meta.url),"utf8");
  const actual=source.slice(source.indexOf("window.webContents.session.setPermissionCheckHandler"),source.indexOf('window.on("blur"'));
  runInNewContext(actual,{window:{webContents:{session:{setPermissionCheckHandler:fn=>{check=fn;},setPermissionRequestHandler:fn=>{request=fn;}}}},recipientCameraPermission:gate});
  const details={isMainFrame:true,requestingUrl:contents.mainFrame.url,mediaType:"video",mediaTypes:["video"]};
  assert.equal(check(contents,"media","file://",details),false);gate.begin();assert.equal(check(contents,"media","file://",details),true);
  let allowed;request(contents,"media",value=>{allowed=value;},details);assert.equal(allowed,true);
  request(contents,"media",value=>{allowed=value;},{...details,mediaTypes:["audio"]});assert.equal(allowed,false);
  request(contents,"display-capture",value=>{allowed=value;},details);assert.equal(allowed,false);
});
