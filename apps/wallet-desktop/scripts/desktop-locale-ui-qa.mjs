import assert from "node:assert/strict";
import {realpathSync} from "node:fs";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WALLET_STATIC_COPY,WALLET_STATIC_ATTRIBUTES,WALLET_COPY} from "../src/wallet-locale.mjs";
// Read-only DOM diagnostic for normal CUA/human settings actions. No input,
// preferences, custody, dialogs, credentials, account or network state changes.
const [port,productDirectory,expectedLocale,expectedSize]=process.argv.slice(2);
const locales=["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"];
if(!/^\d{1,5}$/.test(port??"")||!productDirectory||!locales.includes(expectedLocale)||!["compact","standard","larger"].includes(expectedSize))throw Error("usage: desktop-locale-ui-qa.mjs <CDP port> <exact product directory> <locale> <size>");
const expected=pathToFileURL(path.join(realpathSync(productDirectory),"src/index.html")).href;
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),target=targets.find(item=>item.type==="page"&&item.url===expected);
if(!target)throw Error("Exact isolated Wallet page not found");
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true})});
try{
const state=await new Promise((resolve,reject)=>{
const timer=setTimeout(()=>reject(Error("Locale diagnostic timed out")),10000);
socket.addEventListener("message",event=>{const response=JSON.parse(event.data);if(response.id!==1)return;clearTimeout(timer);if(response.error||response.result?.exceptionDetails)reject(Error("Locale diagnostic failed"));else resolve(response.result.result.value)});
socket.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{returnByValue:true,expression:`(()=>{
const selectors=${JSON.stringify(Object.keys(WALLET_STATIC_COPY))},attributes=${JSON.stringify(WALLET_STATIC_ATTRIBUTES)};
const copySelectorCoverage=selectors.map(selector=>({selector,count:document.querySelectorAll(selector).length}));
const attributeCopy=Object.entries(attributes).flatMap(([selector,labels])=>Array.from(document.querySelectorAll(selector),node=>({selector,attributes:Object.fromEntries(Object.keys(labels).map(attribute=>[attribute,node.getAttribute(attribute)]))})));
const sizeInputs=Array.from(document.querySelectorAll('input[name="wallet-ui-size"]'),node=>({value:node.value,checked:node.checked}));
const dialogs=Array.from(document.querySelectorAll('dialog[open]'),node=>{const bounds=node.getBoundingClientRect();return{id:node.id,text:node.innerText,width:bounds.width,height:bounds.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,insideViewport:bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight}});
const logo=document.querySelector('dialog[open] .dialog-brand img')??document.querySelector('.brand img'),bounds=logo.getBoundingClientRect();
return{url:location.href,locale:document.documentElement.lang,direction:document.documentElement.dir,size:document.documentElement.dataset.walletUiSize,sizeInputs,selectedLanguage:document.querySelector('#wallet-language').value,rootFontSize:getComputedStyle(document.documentElement).fontSize,viewport:{width:innerWidth,height:innerHeight},dialogs,copySelectorCoverage,attributeCopy,logo:{width:bounds.width,height:bounds.height,naturalWidth:logo.naturalWidth,naturalHeight:logo.naturalHeight,fit:getComputedStyle(logo).objectFit},passwordInputLengths:Array.from(document.querySelectorAll('input[type=password]'),node=>node.value.length)};
})()`}}));
});
assert.equal(state.locale,expectedLocale);assert.equal(state.selectedLanguage,expectedLocale);assert.equal(state.direction,expectedLocale==="ar"?"rtl":"ltr");assert.equal(state.size,expectedSize);
assert.deepEqual(state.sizeInputs.filter(input=>input.checked).map(input=>input.value),[expectedSize]);assert.ok(state.passwordInputLengths.every(length=>length===0));
for(const dialog of state.dialogs){assert.ok(dialog.insideViewport,`${dialog.id} outside viewport`);assert.ok(dialog.scrollWidth<=dialog.clientWidth+1,`${dialog.id} horizontal overflow`)}
assert.equal(state.logo.fit,"contain");assert.equal(state.logo.naturalWidth,798);assert.equal(state.logo.naturalHeight,420);
assert.ok(state.logo.width>0&&state.logo.height>0);assert.ok(Math.abs(state.logo.width/state.logo.height-798/420)<0.01);
for(const copy of state.copySelectorCoverage)assert.ok(copy.count>0,`Missing owned copy target: ${copy.selector}`);
for(const copy of state.attributeCopy)for(const [attribute,value]of Object.entries(copy.attributes))assert.equal(value,WALLET_COPY[expectedLocale][WALLET_STATIC_ATTRIBUTES[copy.selector][attribute]],`Untranslated owned attribute: ${copy.selector} ${attribute}`);
console.log(JSON.stringify({...state,gatePassed:true,inputActionsPerformed:false,completeJourneyVerified:false,installedReleaseVerified:false}));
}finally{socket.close()}
