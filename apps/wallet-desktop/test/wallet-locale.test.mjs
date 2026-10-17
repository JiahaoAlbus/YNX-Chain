import assert from "node:assert/strict";
import test from "node:test";
import {createMultichainUI} from "../src/multichain-ui.mjs";
import {WALLET_LOCALES,WALLET_COPY,WALLET_LOCALE_KEY,WALLET_STATIC_COPY,WALLET_STATIC_ATTRIBUTES,parseWalletLocale,systemWalletLocale,initWalletLocale,renderWalletCopy,setWalletCopy} from "../src/wallet-locale.mjs";
const mounted=storage=>{
  const select={value:"",addEventListener(type,fn){this.change=fn}},status={textContent:""},node={textContent:"",getAttribute:()=>"Review your transfer"};
  const document={documentElement:{},querySelector:selector=>selector==="#wallet-language"?select:status,querySelectorAll:()=>[node]};
  const controller=initWalletLocale({document,getStorage:()=>storage,systemLanguages:["en"]});return{controller,document,node,status,select};
};
test("all twelve desktop locale catalogs cover navigation, account, receiving, QR, review, recovery and settings",()=>{
  assert.equal(WALLET_LOCALES.length,12);
  for(const locale of WALLET_LOCALES){assert.deepEqual(Object.keys(WALLET_COPY[locale]),Object.keys(WALLET_COPY.en));for(const value of Object.values(WALLET_COPY[locale]))assert.ok(value);for(const key of ["Overview","Create secure Testnet account","Receive YNXT","Scan a QR code","Review your transfer","Restore an existing account","Language and appearance"])assert.ok(WALLET_COPY[locale][key])}
});
test("locale schema rejects widening and detects twelve system languages without custody reads",()=>{
  for(const raw of [null,"",'{}','{"version":2,"locale":"ar"}','{"version":1,"locale":"xx"}','{"version":1,"locale":"ar","account":"x"}'])assert.equal(parseWalletLocale(raw),"en");
  for(const locale of WALLET_LOCALES)assert.equal(parseWalletLocale(JSON.stringify({version:1,locale})),locale);
  assert.equal(systemWalletLocale(["zh-TW"]),"zh-Hant");assert.equal(systemWalletLocale(["zh-CN"]),"zh-Hans");assert.equal(systemWalletLocale(["xx","ar-EG"]),"ar");assert.equal(systemWalletLocale([null]),"en");
});
test("normal settings persist only a display key and mirror RTL without changing raw values",()=>{
  const data=new Map([["custody","unchanged"]]),storage={getItem:key=>data.get(key),setItem(key,value){assert.equal(key,WALLET_LOCALE_KEY);data.set(key,value)}};
  const ui=mounted(storage);ui.select.value="ar";ui.select.change();assert.equal(ui.document.documentElement.dir,"rtl");assert.equal(ui.document.documentElement.lang,"ar");assert.equal(ui.node.textContent,WALLET_COPY.ar["Review your transfer"]);assert.equal(mounted(storage).controller.locale(),"ar");assert.equal(data.get("custody"),"unchanged");
  ui.node.textContent="ynx1-original-address · user supplied <script>";ui.controller.select("zh-Hans");assert.equal(ui.node.textContent,"ynx1-original-address · user supplied <script>");assert.equal(ui.document.documentElement.dir,"ltr");
});
test("unavailable or lost storage readback changes this window only and does not claim saved",()=>{
  for(const storage of [null,{getItem(){throw Error("blocked")},setItem(){throw Error("blocked")}},{getItem:()=>null,setItem(){}}]){const ui=mounted(storage);assert.equal(ui.controller.select("ar"),false);assert.equal(ui.status.textContent,WALLET_COPY.ar["Language changed for this window. It could not be saved on this device."]);assert.equal(ui.controller.locale(),"ar")}
});
test("enrolled selectors span real product entries and never include raw account or signed review containers",()=>{
  for(const selector of ["#open-receive","#open-send","#prepare-transfer","#confirm-transfer","#recover-wallet","#recovery-title","#unlock-wallet"])assert.ok(WALLET_STATIC_COPY[selector]);
  for(const selector of ["#receive-address","#transfer-transaction","#provider-detail","#auth-purpose","#auth-account","#transfer-amount"])assert.equal(WALLET_STATIC_COPY[selector],undefined);
});
test("every translated template preserves exactly the English parameter names",()=>{
  const names=value=>[...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match=>match[1]).sort();
  for(const locale of WALLET_LOCALES)for(const [key,value]of Object.entries(WALLET_COPY[locale]))assert.deepEqual(names(value),names(key),`${locale}: ${key}`);
});
test("explicit QR accessibility copy changes only its owned label, never canvas pixels, values or wire attributes",()=>{
  const attrs=new Map([["aria-label","QR code for your selected YNX Testnet receiving address"],["data-hash","original-hash"]]);
  const canvas={textContent:"unmodified canvas fallback",width:256,height:256,value:"original-value",getAttribute:key=>attrs.get(key),setAttribute:(key,value)=>attrs.set(key,value)};
  const document={documentElement:{},querySelector:()=>null,querySelectorAll:selector=>selector==="#receive-qr"?[canvas]:[]};
  const ui=initWalletLocale({document});ui.select("ar");assert.equal(attrs.get("aria-label"),WALLET_COPY.ar["QR code for your selected YNX Testnet receiving address"]);assert.equal(canvas.textContent,"unmodified canvas fallback");assert.equal(canvas.width,256);assert.equal(canvas.height,256);assert.equal(canvas.value,"original-value");assert.equal(attrs.get("data-hash"),"original-hash");
  assert.equal(ui.setAttributeCopy(canvas,"data-hash","Receive YNXT"),false);
  attrs.set("aria-label","new raw owner label");ui.select("zh-Hans");assert.equal(attrs.get("aria-label"),"new raw owner label");assert.deepEqual(Object.keys(WALLET_STATIC_ATTRIBUTES),["#receive-qr","#import-value","#transfer-to","#contract-function"]);
});
test("dynamic parameters use isolated text, retain exact bytes and survive locale changes without business callbacks",()=>{
  class Element {
    constructor(doc,tag="p"){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.isConnected=true}
    set textContent(value){this.children=[];this.text=String(value)}
    get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(""):this.text??""}
    replaceChildren(...children){this.text="";this.children=children}
  }
  const doc={documentElement:{},querySelector:()=>null,querySelectorAll:()=>[],createElement(tag){return new Element(doc,tag)},createTextNode(text){return{textContent:text}}};
  const ui=initWalletLocale({document:doc}),node=new Element(doc),hash="0xAbC123<script>أصلي";
  const values={hash};setWalletCopy(node,"Submitted: {hash}. Network confirmation is pending.",values);values.hash="mutated";
  for(const locale of WALLET_LOCALES){ui.select(locale);const isolated=node.children.find(child=>child.tagName==="bdi");assert.equal(isolated.textContent,hash);assert.equal(isolated.dir,"ltr");assert.equal(node.textContent,WALLET_COPY[locale]["Submitted: {hash}. Network confirmation is pending."].replace("{hash}",hash))}
  node.textContent="new raw server error";ui.select("en");assert.equal(node.textContent,"new raw server error");
  renderWalletCopy(node,"{name}: {amount}",{name:"اسم <img>",amount:"001.2300"});assert.equal(node.children[1].dir,"auto");assert.equal(node.children[3].dir,"ltr");assert.equal(node.textContent,"اسم <img>: 001.2300");
  const option=new Element(doc,"option");renderWalletCopy(option,"Account {account}",{account:hash});assert.equal(option.textContent,`Account ${hash}`);assert.equal(option.children.length,0);
  const recoveryNode=new Element(doc),recoveryKey="{amount} YNXT to {to} · {hash}",original={amount:"001.2300",to:"ynx1ExactCaseأصلي",hash};
  setWalletCopy(recoveryNode,recoveryKey,original);
  for(const locale of WALLET_LOCALES){ui.select(locale);const isolated=recoveryNode.children.filter(child=>child.tagName==="bdi");assert.deepEqual(isolated.map(child=>child.textContent),[original.amount,original.to,original.hash]);assert.ok(isolated.every(child=>child.dir==="ltr"));assert.equal(recoveryNode.textContent,WALLET_COPY[locale][recoveryKey].replace("{amount}",original.amount).replace("{to}",original.to).replace("{hash}",original.hash))}
});
test("unknown transaction recovery is explicit in every locale and never relaxes receipt or exact-retry guards",()=>{
  for(const locale of WALLET_LOCALES)for(const key of ["Retry identical signed transaction","Check receipt","The node saved this transaction, but it has not been mined. This account remains blocked from creating a new transfer.","A complete durable mined receipt is still unavailable. This account remains blocked from creating a new transfer.","The transaction outcome could not be checked. Keep its hash and try checking again.","This older journal has no original signed bytes. Check the saved hash; do not recreate the transaction.","The local transaction journal is unavailable. New transfers remain blocked."]){assert.ok(WALLET_COPY[locale][key]);if(locale!=="en")assert.notEqual(WALLET_COPY[locale][key],key)}
});
test("critical recovery and local-finality disclaimers are enrolled explicitly in all twelve locales",()=>{
  const selectors=["#transaction-resolution > h2","#transaction-resolution > p:first-of-type","#transaction-history > p.muted"];
  for(const selector of selectors){const key=WALLET_STATIC_COPY[selector];assert.ok(key,selector);for(const locale of WALLET_LOCALES){assert.ok(WALLET_COPY[locale][key]);if(locale!=="en")assert.notEqual(WALLET_COPY[locale][key],key)}}
  assert.match(WALLET_STATIC_COPY[selectors[1]],/missing receipt does not mean it was never submitted/);
  assert.match(WALLET_STATIC_COPY[selectors[2]],/not consensus finality/);
});

// Display-only real UI/locale composition. DOM and IPC reads are PUBLIC
// stand-ins; no service/adapter, keys, crypto, network or native window.
const r14Refresh={en:"Refresh","zh-Hans":"刷新","zh-Hant":"重新整理",ja:"更新",ko:"새로고침",es:"Actualizar",fr:"Actualiser",de:"Aktualisieren",pt:"Atualizar",ru:"Обновить",ar:"تحديث",id:"Segarkan"};
function r14Display(){
  const nodes={},calls=[],context={account:"0x"+"ab".repeat(20),revision:1,locked:false};
  const document={documentElement:{},querySelector:selector=>nodes[selector.slice(1)]??null,querySelectorAll:()=>[],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:String(text),children:[]})};
  class Element{
    constructor(tag="div"){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.listeners={};this.attributes={};this.value="";this.open=false;this.isConnected=true;this.disabled=false;this.text=""}
    get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(""):this.text}
    set textContent(value){this.children=[];this.text=String(value)}
    append(...children){this.children.push(...children)}
    replaceChildren(...children){this.children=children;this.text=""}
    setAttribute(key,value){this.attributes[key]=String(value);if(key==="id")nodes[value]=this}
    getAttribute(key){return this.attributes[key]??null}
    addEventListener(name,callback){(this.listeners[name]??=[]).push(callback)}
    async emit(name){for(const callback of this.listeners[name]??[])await callback({preventDefault(){}})}
    showModal(){this.open=true}
    close(){this.open=false;void this.emit("close")}
    reportValidity(){return true}
    reset(){}
  }
  for(const id of ["wallet-language","wallet-language-status","open-multichain","multichain-sheet","multichain-content","multichain-review","multichain-review-facts","multichain-review-status","multichain-confirm","multichain-cancel","multichain-close"])nodes[id]=new Element();
  const displayStorage=new Map(),storage={getItem:key=>displayStorage.get(key)??null,setItem(key,value){assert.equal(key,WALLET_LOCALE_KEY);displayStorage.set(key,value)}};
  const locale=initWalletLocale({document,getStorage:()=>storage,systemLanguages:["zh-CN"]});
  const frame=Object.freeze({account:context.account,revision:1,networks:Object.freeze([]),selected:null});
  const api={multichainSnapshot:async()=>{calls.push("snapshot");return {ok:true,value:frame}},multichainBalances:()=>{throw Error("Unexpected balances")},multichainHistory:()=>{throw Error("Unexpected history")},multichainPrepare:()=>{throw Error("Unexpected prepare")},multichainSend:()=>{throw Error("Unexpected send")},multichainCancel:()=>{throw Error("Unexpected cancel")}};
  const ui=createMultichainUI({document,api,getContext:()=>context});
  const all=()=>{const result=[];function visit(node){result.push(node);for(const child of node.children??[])visit(child)}visit(nodes["multichain-content"]);return result};
  const refresh=nodes["multichain-content"].children.find(node=>node.tagName==="BUTTON");
  return {ui,locale,nodes,document,context,frame,calls,refresh,all,displayStorage,async open(){await nodes["open-multichain"].emit("click");await new Promise(resolve=>setImmediate(resolve))}};
}
test("R14 PUBLIC Refresh is enrolled with exact display copy in twelve locales",()=>{
  assert.deepEqual(Object.keys(r14Refresh),WALLET_LOCALES);
  for(const locale of WALLET_LOCALES){assert.equal(WALLET_COPY[locale].Refresh,r14Refresh[locale]);assert.equal(WALLET_COPY[locale].Refresh.match(/\{\w+\}/g),null)}
});
test("R14 PUBLIC actual multichain Refresh switches locale without changing raw values or business calls",async()=>{
  const f=r14Display();try{
    await f.open();assert.equal(f.refresh.textContent,"刷新");assert.equal(f.calls.length,1);
    const recipient=f.all().filter(node=>node.tagName==="INPUT").at(-2),amount=f.all().filter(node=>node.tagName==="INPUT").at(-1);
    recipient.value="PUBLIC_To <b>אבג";amount.value="001.2300";
    for(const locale of WALLET_LOCALES){
      f.locale.select(locale);assert.equal(f.refresh.textContent,r14Refresh[locale]);assert.equal(f.context.account,f.frame.account);assert.equal(f.nodes["multichain-receive-address"].value,f.frame.account);assert.equal(recipient.value,"PUBLIC_To <b>אבג");assert.equal(amount.value,"001.2300");assert.equal(f.calls.length,1);
    }
    assert.equal(f.document.documentElement.lang,"id");assert.equal(f.displayStorage.size,1);
    await f.refresh.emit("click");assert.deepEqual(f.calls,["snapshot","snapshot"]);assert.equal(f.refresh.textContent,r14Refresh.id);
  }finally{f.ui.dispose()}
});
