import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {initWalletLocale,setWalletCopy,WALLET_LOCALES,WALLET_COPY} from "../src/wallet-locale.mjs";
const {createTransactionHistoryUI}=await import(process.env.YNX_HISTORY_UI_SOURCE??new URL("../src/transaction-history-ui.mjs",import.meta.url).href);
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
function harness(page=null){
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
  let renderer,requests=0,historyUI;
  const context={document,setWalletCopy,activeAccount:page?"0x"+"1".repeat(40):"account",nativeAccountLabel:value=>value,window:{ynxWallet:{transactionHistory(){requests++;return Promise.resolve({ok:true,value:page})}}},createTransactionHistoryUI:config=>{renderer=config.render;historyUI=page?createTransactionHistoryUI(config):{};return historyUI}};
  const start=source.indexOf("const transactionHistoryUI = createTransactionHistoryUI("),end=source.indexOf('document.querySelector("#refresh-transaction-history").addEventListener',start);
  assert.ok(start>=0&&end>start);runInNewContext(source.match(/function copyUI\([^\n]+/)[0]+"\n"+source.slice(start,end),context);
  return{render:renderer,locale,get:document.querySelector,requests:()=>requests,refresh:()=>historyUI.refresh()};
}
test("mounted saved history localizes titles and labels without rereading or rewriting transaction facts",()=>{
  const h=harness(),record={amount:"001.2300",to:"ynx1ExactCase",hash:"0xAbCd",actualFee:"0.0000100",blockNumber:"00042",successful:true};
  h.render({records:[record],error:null,busy:false,loaded:true,nextCursor:null});
  const row=h.get("#transaction-history-list").children[0],title=row.children[0],facts=row.children[1];
  for(const locale of WALLET_LOCALES){h.locale.select(locale);assert.equal(title.textContent,WALLET_COPY[locale]["{amount} YNXT · Mined locally"].replace("{amount}",record.amount));assert.equal(facts.children[0].textContent,WALLET_COPY[locale].Recipient);assert.deepEqual(facts.children.filter((_,i)=>i%2).map(node=>node.textContent),[record.to,record.hash,`${record.actualFee} YNXT`,record.blockNumber]);assert.ok(facts.children.filter((_,i)=>i%2).every(node=>node.dir==="ltr"))}
  assert.equal(h.requests(),0);assert.equal(record.amount,"001.2300");assert.equal(record.hash,"0xAbCd");
});

test("actual validated public history feeds the original mounted renderer in every locale",async()=>{
  const record={account:"0x"+"1".repeat(40),to:"0x"+"4".repeat(40),hash:"0x"+"2".repeat(64),amount:"2.0",actualFee:"1.0",blockNumber:"0x2",origin:"https://rpc-testnet.ynxweb4.com",successful:true,confirmed:true,confirmationScope:"local-snapshot",consensusFinality:false};
  const h=harness({records:[record],nextCursor:null});await h.refresh();const row=h.get("#transaction-history-list").children[0],facts=row.children[1];
  for(const locale of WALLET_LOCALES){h.locale.select(locale);assert.equal(row.children[0].textContent,WALLET_COPY[locale]["{amount} YNXT · Mined locally"].replace("{amount}",record.amount));assert.deepEqual(facts.children.filter((_,i)=>i%2).map(node=>node.textContent),[record.to,record.hash,"1.0 YNXT","0x2"])}
  assert.equal(h.requests(),1);assert.equal(h.get("#transaction-history-status").textContent,"");
});
test("missing original result flag cannot be rendered as a failed transfer by the actual history composition",async()=>{
  const h=harness({records:[{account:"0x"+"1".repeat(40),hash:"0x"+"2".repeat(64),confirmed:true,confirmationScope:"local-snapshot",consensusFinality:false}],nextCursor:null});await h.refresh();
  assert.equal(h.get("#transaction-history-list").children.length,0);for(const locale of WALLET_LOCALES){h.locale.select(locale);assert.equal(h.get("#transaction-history-status").textContent,WALLET_COPY[locale]["Saved transaction history could not be verified. Original records remain on this device."])}
});
test("mounted history state translates owned failures but preserves unrecognized raw errors",()=>{
  const h=harness(),key="Saved transaction history could not be verified. Original records remain on this device.";
  h.locale.select("ar");h.render({records:[],error:key,busy:false,loaded:false,nextCursor:null});assert.equal(h.get("#transaction-history-status").textContent,WALLET_COPY.ar[key]);
  h.render({records:[],error:"raw server detail <script>",busy:false,loaded:false,nextCursor:null});h.locale.select("zh-Hans");assert.equal(h.get("#transaction-history-status").textContent,"raw server detail <script>");assert.equal(h.requests(),0);
});
