import test from "node:test";
import assert from "node:assert/strict";
import {renderHostedReceiveQR} from "../src/hosted-receive-qr.js";
import {toYNXAddress} from "../src/wallet-address.js";
const account="0x"+"12".repeat(20);
function container(){return {dataset:{},children:[],replaceChildren(...children){this.children=children;},ownerDocument:{createElement:()=>({setAttribute(){}})}};}
test("receive QR encodes exactly the public native address",async()=>{
  const c=container();let value;await renderHostedReceiveQR(c,account,()=>true,async(_,input)=>{value=input;});assert.equal(value,toYNXAddress(account));assert.equal(c.dataset.state,"ready");assert.equal(c.children.length,1);
});
test("late QR from old account cannot replace selected-account code",async()=>{
  const c=container();let done,current=true;const old=renderHostedReceiveQR(c,account,()=>current,()=>new Promise(r=>done=r));current=false;const next="0x"+"34".repeat(20);await renderHostedReceiveQR(c,next,()=>true,async()=>{});const canvas=c.children[0];done();await old;assert.equal(c.children[0],canvas);assert.equal(c.dataset.state,"ready");
});
test("encoding failure leaves full public address available without false QR success",async()=>{const c=container();await renderHostedReceiveQR(c,account,()=>true,async()=>{throw new Error("encoding");});assert.equal(c.dataset.state,"unavailable");assert.equal(c.children.length,0);});
