import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {initWalletLocale,setWalletCopy,WALLET_LOCALES,WALLET_COPY} from "../src/wallet-locale.mjs";
import {projectPendingTransactions,projectTransactionResolution} from "../src/transaction-resolution-display.mjs";
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8"),html=await readFile(new URL("../src/index.html",import.meta.url),"utf8");
const account="0x"+"1".repeat(40),hash="0x"+"2".repeat(64),to="0x"+"3".repeat(40);
const record={hash,account,to,amount:"25.0",status:"uncertain",canRetryExact:true};
function harness(){
  let reads=0,actions=0,fail=false;const nodes=new Map(),ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  class Element{
    constructor(tag="p"){this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.isConnected=true;this.disabled=false;this.hidden=false;}
    set textContent(value){for(const child of this.children)child.isConnected=false;this.children=[];this.text=String(value)}
    get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(""):this.text??""}
    append(...children){this.children.push(...children)}
    replaceChildren(...children){for(const child of this.children)child.isConnected=false;this.children=children;this.text="";}
    addEventListener(type,fn){this[type]=fn}
  }
  const get=selector=>{assert.ok(ids.has(selector.slice(1)));if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector)};
  const document={documentElement:{},querySelector:selector=>["#wallet-language","#wallet-language-status"].includes(selector)?null:get(selector),querySelectorAll:selector=>selector==="#refresh-pending-transactions"?[get(selector)]:[],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text,isConnected:true})};
  const locale=initWalletLocale({document}),context={document,setWalletCopy,projectPendingTransactions,projectTransactionResolution,activeAccount:account,keyState:{locked:true,revision:1},transactionRevision:0,transactionActionRevision:0,errorText:r=>r.error.message,refreshAssets(){throw Error("Unexpected asset refresh")},transactionHistoryUI:{refresh(){}},window:{ynxWallet:{pendingTransactions:async()=>{reads++;if(fail)throw Error("Temporary journal read failure");return{ok:true,value:[record]}},transactionStatus:async()=>{actions++;return{ok:true,value:{hash,account,status:"uncertain",durabilityStatus:"not_found",confirmed:false,consensusFinality:false,canRetryExact:true}}},retryTransaction(){actions++;throw Error("Unexpected retry")}}}};
  const start=source.indexOf("function clearTransactionResolution()"),end=source.indexOf("function clearAssetBalance()",start);assert.ok(start>=0&&end>start);
  runInNewContext(source.match(/function copyUI\([^\n]+/)[0]+"\n"+source.slice(start,end),context);
  return{context,locale,get,reads:()=>reads,actions:()=>actions,fail(value){fail=value}};
}
test("actual mounted recovery controls localize all twelve languages without another read or rewriting raw transaction facts",async()=>{
  const h=harness();await h.context.refreshTransactions();const row=h.get("#pending-transactions").children[0],description=row.children[0],check=row.children[1],retry=row.children[2],refresh=h.get("#refresh-pending-transactions");
  for(const language of WALLET_LOCALES){h.locale.select(language);assert.equal(refresh.textContent,WALLET_COPY[language]["Refresh pending transactions"]);assert.equal(check.textContent,WALLET_COPY[language]["Check receipt"]);assert.equal(retry.textContent,WALLET_COPY[language]["Retry identical signed transaction"]);assert.equal(description.textContent,WALLET_COPY[language]["{amount} YNXT to {to} · {hash}"].replace("{amount}",record.amount).replace("{to}",to).replace("{hash}",hash));assert.equal(h.reads(),1);assert.equal(h.actions(),0);assert.equal(retry.disabled,true);}
  assert.equal(record.hash,hash);assert.equal(record.account,account);assert.equal(record.amount,"25.0");
});
test("localized original startup failure recovers through public refresh while keys remain locked",async()=>{
  const h=harness();h.fail(true);await h.context.refreshTransactions();assert.equal(h.get("#refresh-pending-transactions").disabled,false);
  const key="The local transaction journal is unavailable. New transfers remain blocked.";
  for(const language of WALLET_LOCALES){h.locale.select(language);assert.equal(h.get("#transaction-resolution-result").textContent,WALLET_COPY[language][key]);assert.equal(h.reads(),1);}
  h.fail(false);await h.get("#refresh-pending-transactions").click();assert.equal(h.reads(),2);assert.equal(h.actions(),0);assert.equal(h.context.keyState.locked,true);assert.equal(h.get("#transaction-resolution-result").textContent,"");assert.equal(h.get("#pending-transactions").children.length,1);assert.equal(h.get("#refresh-pending-transactions").disabled,false);
});
