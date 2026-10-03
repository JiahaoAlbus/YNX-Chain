import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {initWalletLocale,setWalletCopy,WALLET_LOCALES,WALLET_COPY} from "../src/wallet-locale.mjs";
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
function harness(){
  class Element {
    constructor(tag="p"){this.tagName=tag;this.ownerDocument=document;this.children=[];this.isConnected=true}
    set textContent(value){this.children=[];this.text=String(value)}
    get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(""):this.text??""}
    replaceChildren(...children){for(const child of this.children)child.isConnected=false;this.children=children;this.text=""}
    append(...children){this.children.push(...children)}
  }
  const nodes=new Map(),document={documentElement:{},querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector)},querySelectorAll:()=>[],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
  // No settings elements in this isolated mounted render harness.
  const select=document.querySelector;document.querySelector=()=>null;const locale=initWalletLocale({document});document.querySelector=select;
  let renderer,requests=0;
  const context={document,setWalletCopy,activeAccount:"account",nativeAccountLabel:value=>value,window:{ynxWallet:{transactionHistory(){requests++}}},createTransactionHistoryUI:config=>{renderer=config.render;return{}}};
  const start=source.indexOf("const transactionHistoryUI = createTransactionHistoryUI("),end=source.indexOf('document.querySelector("#refresh-transaction-history").addEventListener',start);
  assert.ok(start>=0&&end>start);runInNewContext(source.match(/function copyUI\([^\n]+/)[0]+"\n"+source.slice(start,end),context);
  return{render:renderer,locale,get:document.querySelector,requests:()=>requests};
}
test("mounted saved history localizes titles and labels without rereading or rewriting transaction facts",()=>{
  const h=harness(),record={amount:"001.2300",to:"ynx1ExactCase",hash:"0xAbCd",actualFee:"0.0000100",blockNumber:"00042",successful:true};
  h.render({records:[record],error:null,busy:false,loaded:true,nextCursor:null});
  const row=h.get("#transaction-history-list").children[0],title=row.children[0],facts=row.children[1];
  for(const locale of WALLET_LOCALES){h.locale.select(locale);assert.equal(title.textContent,WALLET_COPY[locale]["{amount} YNXT · Mined locally"].replace("{amount}",record.amount));assert.equal(facts.children[0].textContent,WALLET_COPY[locale].Recipient);assert.deepEqual(facts.children.filter((_,i)=>i%2).map(node=>node.textContent),[record.to,record.hash,`${record.actualFee} YNXT`,record.blockNumber]);assert.ok(facts.children.filter((_,i)=>i%2).every(node=>node.dir==="ltr"))}
  assert.equal(h.requests(),0);assert.equal(record.amount,"001.2300");assert.equal(record.hash,"0xAbCd");
});
test("mounted history state translates owned failures but preserves unrecognized raw errors",()=>{
  const h=harness(),key="Saved transaction history could not be verified. Original records remain on this device.";
  h.locale.select("ar");h.render({records:[],error:key,busy:false,loaded:false,nextCursor:null});assert.equal(h.get("#transaction-history-status").textContent,WALLET_COPY.ar[key]);
  h.render({records:[],error:"raw server detail <script>",busy:false,loaded:false,nextCursor:null});h.locale.select("zh-Hans");assert.equal(h.get("#transaction-history-status").textContent,"raw server detail <script>");assert.equal(h.requests(),0);
});
