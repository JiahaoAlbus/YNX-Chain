import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import { assertWalletIPC } from "../src/wallet-ipc-policy.mjs";
const url = "file:///fixture/installed-wallet/index.html";
test('r5 actual Main and preload save-only caller binds original current account and exact local frame',async()=>{
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await readFile(new URL('../src/preload.cjs',import.meta.url),'utf8'),start=main.indexOf('handleWalletIPC("wallet:save-transaction-original"'),end=main.indexOf('handleWalletIPC("wallet:retry-transaction"',start);assert.ok(start>0&&end>start);
 const account='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64),frame={url},contents={mainFrame:frame,isDestroyed:()=>false},event={sender:contents,senderFrame:frame};let live=true,calls=0,handler;const lease={account,assert(){if(!live)throw Error('QA_LOCK')}};
 runInNewContext(main.slice(start,end),{handleWalletIPC:(_channel,fn)=>{handler=(source,h)=>{assertWalletIPC(source,contents,url);return fn(source,h)}},sensitiveIPC:fn=>fn(),keyAccess:{current:()=>lease},walletAuthority:{accountStatus:async()=>({account}),transactionSender:{submissions:{saveOriginal:async(h,a,g)=>{assert.equal(h,hash);assert.equal(a,account);assert.equal(g,lease);g.assert();calls++;return {account,hash,savedLocally:true,submitted:false,confirmed:false}}}}}});
 assert.equal((await handler(event,hash)).submitted,false);assert.equal(calls,1);live=false;await assert.rejects(handler(event,hash));assert.equal(calls,1);assert.throws(()=>handler({...event,senderFrame:{url}},hash));
 const line=preload.split('\n').find(l=>l.includes('saveTransactionOriginal:'));let dispatched;const api=runInNewContext('({'+line+'})',{ipcRenderer:{invoke:(channel,h)=>{dispatched={channel,h}}}});api.saveTransactionOriginal(hash);assert.deepEqual(dispatched,{channel:'wallet:save-transaction-original',h:hash});
});
test("password and approval IPC require the exact live local main frame", () => {
  const frame = { url }, contents = { mainFrame: frame, isDestroyed: () => false }, event = { sender: contents, senderFrame: frame };
  assert.doesNotThrow(() => assertWalletIPC(event, contents, url));
  for (const bad of [{ sender: { ...contents }, senderFrame: frame }, { sender: contents, senderFrame: { url } }, { sender: contents, senderFrame: null }]) assert.throws(() => assertWalletIPC(bad, contents, url), error => error.data.code === "UNTRUSTED_WALLET_FRAME");
  for (const wrongURL of ["https://wallet.example/", `${url}?from=remote`, `${url}#unexpected`, "file:///fixture/another.html"]) { frame.url = wrongURL; assert.throws(() => assertWalletIPC(event, contents, url)); }
  frame.url = url; contents.isDestroyed = () => true; assert.throws(() => assertWalletIPC(event, contents, url));
});
