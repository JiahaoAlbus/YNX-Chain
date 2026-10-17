import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {initWalletLocale,setWalletCopy,WALLET_COPY,WALLET_LOCALES,WALLET_STATIC_COPY,WALLET_STATIC_ATTRIBUTES} from "../src/wallet-locale.mjs";
import {CONTRACT_COPY} from "../src/wallet-locale-contracts.mjs";
const source=readFileSync(new URL("../src/renderer.js",import.meta.url),"utf8");
test("contract labels and explicit no-sign/no-submit runtime boundaries cover every original locale",()=>{
 for(const locale of WALLET_LOCALES)assert.deepEqual(Object.keys(CONTRACT_COPY[locale]),Object.keys(CONTRACT_COPY.en));
 for(const key of ["Read a contract","Reading from YNX Testnet…","Read-only response verified. No transaction was signed or submitted.","Contract address","Current BFT bounded contract runtime","Legacy local pure/view runtime (explicit)","This endpoint is not the expected YNX Testnet. Nothing was signed or submitted."]){
  for(const locale of WALLET_LOCALES){assert.ok(Object.hasOwn(WALLET_COPY[locale],key),`${locale}:${key}`);if(locale!=="en")assert.notEqual(WALLET_COPY[locale][key],key);}
 }
 assert.equal(WALLET_STATIC_COPY["#contract-title"],"Read a contract");
});
test("calldata placeholder and RTL input direction never rewrite submitted bytes",()=>{
 const html=readFileSync(new URL("../src/index.html",import.meta.url),"utf8");
 for(const id of ["contract-address","contract-function"])assert.match(html,new RegExp(`<input id="${id}" dir="ltr"`));
 const attributes=new Map([["placeholder","0x selector and encoded arguments"],["data-original","unchanged"]]);
 const value="0x70a082310000AbExact",input={value,ownerDocument:null,textContent:"",getAttribute:key=>attributes.get(key),setAttribute:(key,next)=>attributes.set(key,next)};
 const document={documentElement:{},querySelector:()=>null,querySelectorAll:selector=>selector==="#contract-function"?[input]:[]};input.ownerDocument=document;
 const locale=initWalletLocale({document});
 assert.equal(WALLET_STATIC_ATTRIBUTES["#contract-function"].placeholder,"0x selector and encoded arguments");
 for(const language of WALLET_LOCALES){locale.select(language);assert.equal(attributes.get("placeholder"),WALLET_COPY[language]["0x selector and encoded arguments"]);assert.equal(input.value,value);assert.equal(attributes.get("data-original"),"unchanged");}
});
test("original mounted contract render changes display language without touching facts or repeating reads",()=>{
 let render,reads=0;const nodes=new Map();
 class Element{constructor(tag="p"){this.tagName=tag;this.ownerDocument=document;this.children=[];this.isConnected=true;this.value="";}
  set textContent(value){this.children=[];this.text=String(value);}get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(""):this.text??"";}
  replaceChildren(...items){for(const child of this.children)child.isConnected=false;this.children=items;this.text="";}append(...items){this.children.push(...items);}addEventListener(){}
 }
 const get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
 const document={documentElement:{},querySelector:get,getElementById:id=>get("#"+id),querySelectorAll:selector=>Object.hasOwn(WALLET_STATIC_COPY,selector)&&(selector.includes("contract")||selector==="#open-contracts")?[get(selector)]:[],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
 const locale=initWalletLocale({document});
 const start=source.indexOf("const contractSheet ="),end=source.indexOf("let paymentDraftRevision",start);
 runInNewContext(source.match(/function copyUI\([^\n]+/)[0]+"\n"+source.slice(start,end),{document,setWalletCopy,window:{ynxWallet:{nativeContract(){reads++;}}},accountState:null,keyState:{revision:1},createNativeContractUI:options=>{render=options.render;return {clear(){},run(){}};}});
 render({busy:true,result:null,error:null});locale.select("zh-Hans");assert.equal(get("#contract-status").textContent,WALLET_COPY["zh-Hans"]["Reading from YNX Testnet…"]);
 const artifact={address:"0xAaExact",name:"SampleEVMWriteCounter",runtimeMode:"pinned-artifact-bounded-evm-subset",sourceHash:"0xSourceExact",deployedBytecodeHash:"0xByteExact",auditHash:"auditExact",lastUpdatedHeight:42};
 const read={artifact,returnValue:"001.2300<script>أصلي",encodedResult:"0x00AbExact",opcodeStepCount:24,asOf:"2026-10-04T00:00:00Z",origin:"https://rpc-testnet.ynxweb4.com",limitations:["Original raw limitation"]};
 render({busy:false,error:null,result:{read,methods:[{signature:"balanceOf(address)",selector:"0x70a08231",inputCount:1}]}});
 const facts=get("#contract-facts").children.filter((_,i)=>i%2).map(node=>node.textContent);
 for(const language of WALLET_LOCALES){locale.select(language);assert.equal(get("#contract-title").textContent,WALLET_COPY[language]["Read a contract"]);assert.equal(get("#contract-status").textContent,WALLET_COPY[language]["Read-only response verified. No transaction was signed or submitted."]);assert.deepEqual(get("#contract-facts").children.filter((_,i)=>i%2).map(node=>node.textContent),facts);assert.ok(get("#contract-facts").children.filter((_,i)=>i%2).every(node=>node.dir==="ltr"));assert.ok(get("#contract-result").textContent.includes(read.returnValue));assert.ok(get("#contract-result").textContent.includes(read.encodedResult));assert.ok(get("#contract-result").textContent.includes(read.limitations[0]));assert.ok(get("#contract-result").children.filter(node=>node.tagName==="bdi").every(node=>node.dir==="ltr"));assert.equal(get("#contract-methods").children[0].textContent,WALLET_COPY[language]["{signature} — encoded arguments required"].replace("{signature}","balanceOf(address)"));}
 render({busy:false,error:null,result:{read:{...read,returnValue:null,opcodeStepCount:null}}});
 for(const language of WALLET_LOCALES){locale.select(language);assert.equal(get("#contract-result").textContent,WALLET_COPY[language]["No known ABI decoder; encoded result: {encoded}\n{limitations}"].replace("{encoded}",read.encodedResult).replace("{limitations}",read.limitations[0]));assert.equal(get("#contract-facts").children.at(-1).textContent,WALLET_COPY[language]["Not applicable"]);}
 const error="The read timed out. You can try again; no transaction was submitted.";
 render({busy:false,result:null,error});for(const language of WALLET_LOCALES){locale.select(language);assert.equal(get("#contract-status").textContent,WALLET_COPY[language][error]);assert.equal(get("#contract-result").textContent,"");assert.equal(get("#contract-result").hidden,true);}
 assert.equal(reads,0);assert.equal(artifact.name,"SampleEVMWriteCounter");assert.equal(get("#contract-function").value,"");
});
