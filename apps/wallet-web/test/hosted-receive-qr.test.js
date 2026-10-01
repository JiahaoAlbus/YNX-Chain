import test from "node:test";
import assert from "node:assert/strict";
import {renderHostedReceiveQR} from "../src/hosted-receive-qr.js";
import {toYNXAddress} from "../src/wallet-address.js";
import {toEVMAddress} from "../src/wallet-address.js";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
const account="0x"+"12".repeat(20);
function container(){return {dataset:{},children:[],replaceChildren(...children){this.children=children;},ownerDocument:{createElement:()=>({setAttribute(){}})}};}
test("receive QR uses the existing native payment URI",async()=>{
  const c=container();let value;await renderHostedReceiveQR(c,account,()=>true,async(_,input)=>{value=input;});assert.equal(value,`ynx:${toYNXAddress(account)}?chainId=ynx_6423-1&asset=YNXT`);assert.equal(c.dataset.state,"ready");assert.equal(c.children.length,1);
});
test("late QR from old account cannot replace selected-account code",async()=>{
  const c=container();let done,current=true;const old=renderHostedReceiveQR(c,account,()=>current,()=>new Promise(r=>done=r));current=false;const next="0x"+"34".repeat(20);await renderHostedReceiveQR(c,next,()=>true,async()=>{});const canvas=c.children[0];done();await old;assert.equal(c.children[0],canvas);assert.equal(c.dataset.state,"ready");
});
test("encoding failure leaves full public address available without false QR success",async()=>{const c=container();await renderHostedReceiveQR(c,account,()=>true,async()=>{throw new Error("encoding");});assert.equal(c.dataset.state,"unavailable");assert.equal(c.children.length,0);});
test("Web receiving URI passes actual Desktop strict native parser; wrong network and bare QR fail",async()=>{
  const source=await readFile(new URL("../../wallet-desktop/src/payment-recipient.mjs",import.meta.url),"utf8");
  // Run the unchanged parser with the same canonical address implementation.
  // QR image decoding and its separate dependencies are outside this input test.
  const context=vm.createContext({evmAddressFromYNX:toEVMAddress,ynxAddressFromEVM:toYNXAddress,getAddress(){throw Error("Unexpected EVM branch");}});
  vm.runInContext(source.replace(/^import .*;\n/gmu,"").replaceAll("export function ","function ")+"\nthis.parse=parsePaymentRecipient;",context);
  const c=container();let value;await renderHostedReceiveQR(c,account,()=>true,async(_,input)=>{value=input;});
  const parsed=context.parse(value,{requireURI:true});assert.equal(parsed.account,account);assert.equal(parsed.chainId,"ynx_6423-1");assert.equal(parsed.asset,"YNXT");
  assert.throws(()=>context.parse(value.replace("ynx_6423-1","ynx_1-1"),{requireURI:true}),{code:"INVALID_PAYMENT_RECIPIENT"});
  assert.throws(()=>context.parse(toYNXAddress(account),{requireURI:true}),{code:"INVALID_PAYMENT_RECIPIENT"});
});
