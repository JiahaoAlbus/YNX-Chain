import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {initWalletAppearance,parseWalletAppearance,WALLET_APPEARANCE_KEY,WALLET_UI_SIZES} from "../src/wallet-appearance.mjs";

function mounted(storage){
  const element=()=>({listeners:{},addEventListener(name,fn){this.listeners[name]=fn}});
  const inputs=WALLET_UI_SIZES.map(value=>({...element(),value,checked:false}));
  const sheet={...element(),open:false,showModal(){this.open=true},close(){this.open=false}},open=element(),close=element(),status={textContent:""};
  const document={documentElement:{dataset:{}},querySelector:selector=>({"#appearance-sheet":sheet,"#open-appearance":open,"#close-appearance":close,"#appearance-status":status})[selector],querySelectorAll:()=>inputs};
  const control=initWalletAppearance({document,getStorage:()=>storage});
  return {control,inputs,sheet,open,close,status};
}
test("appearance schema defaults safely and accepts exactly three choices",()=>{
  for(const raw of [null,"",'null','[]','{"version":2,"size":"larger"}','{"version":1,"size":"tiny"}','{"version":1,"size":"larger","account":"x"}'])assert.equal(parseWalletAppearance(raw),"standard");
  for(const size of WALLET_UI_SIZES)assert.equal(parseWalletAppearance(JSON.stringify({version:1,size})),size);
});
test("mounted settings open, switch and persist without custody calls",()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem(key,value){assert.equal(key,WALLET_APPEARANCE_KEY);data.set(key,value)}};
  const ui=mounted(storage);ui.open.listeners.click();assert.equal(ui.sheet.open,true);
  ui.inputs[2].checked=true;ui.inputs[2].listeners.change();assert.equal(ui.control.size(),"larger");assert.deepEqual(ui.inputs.map(input=>input.checked),[false,false,true]);assert.match(ui.status.textContent,/saved/);
  ui.close.listeners.click();assert.equal(ui.sheet.open,false);assert.equal(mounted(storage).control.size(),"larger");
});
test("failed storage remains usable and never claims persistence",()=>{
  const ui=mounted({getItem(){throw Error("blocked")},setItem(){throw Error("blocked")}});assert.equal(ui.control.size(),"standard");ui.inputs[0].checked=true;ui.inputs[0].listeners.change();assert.equal(ui.control.size(),"compact");assert.match(ui.status.textContent,/could not be saved/);
});
test("a silently dropped size preference never claims saved",()=>{
  const ui=mounted({getItem:()=>null,setItem(){}});ui.inputs[2].checked=true;ui.inputs[2].listeners.change();assert.equal(ui.control.size(),"larger");assert.match(ui.status.textContent,/could not be saved/);
});
test("source preserves relative text, original wide mark, and 44px interaction targets",async()=>{
  const css=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(css,/font-size:calc\(100% \* var\(--wallet-ui-scale\)\)/);assert.match(css,/\.brand img,\.dialog-brand img\{width:41\.8px;height:auto;aspect-ratio:798\/420;object-fit:contain/);
  assert.match(css,/\.text-button\{min-height:44px\}/);
  const html=await readFile(new URL("../src/index.html",import.meta.url),"utf8");assert.match(html,/src="wallet-appearance\.mjs"/);assert.equal((html.match(/name="wallet-ui-size"/g)??[]).length,3);
});
