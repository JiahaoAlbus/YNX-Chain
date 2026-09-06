import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import {Transaction,verifyMessage,toQuantity} from "ethers";
import {createEncryptedVault,extensionIdentity} from "../src/extension-vault.js";
import {PROVIDER_ACCOUNT_KEY,PROVIDER_PERMISSIONS_KEY,grantPermission} from "../src/extension-provider-permissions.js";
import {EXTENSION_VAULT_KEY} from "../src/extension-vault.js";
import {BRIDGE_VERSION,RUNTIME_REQUEST} from "../src/extension-bridge.js";

// Executes the real worker handlers with simulated browser APIs and RPC only.
const SECRET="1".padStart(64,"0"),PASSWORD="public-fixture-password-only",ACCOUNT=extensionIdentity(SECRET).account,ORIGIN="https://fixture-dapp.example",TO=`0x${"22".repeat(20)}`;
const vaultPromise=createEncryptedVault({password:PASSWORD,secretHex:SECRET},webcrypto);
const source=await readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"),bindings={};
for(const match of source.matchAll(/^import \{([^}]+)\} from "\.\/([^"]+)";$/gm)){const module=await import(new URL(`../src/${match[2]}`,import.meta.url));for(const name of match[1].split(","))bindings[name]=module[name]}
const executable=source.replace(/^import .*;\n/gm,"");
async function fixture(t,{permitted=true}={}){
  const vault=await vaultPromise,account={version:1,source:"ynx-wallet-vault",account:ACCOUNT},localState={[EXTENSION_VAULT_KEY]:vault,[PROVIDER_ACCOUNT_KEY]:account,[PROVIDER_PERMISSIONS_KEY]:permitted?grantPermission({},ORIGIN,account):{}};
  const state={url:`${ORIGIN}/request`,nonce:"0x1",chain:"0x1917",calls:[],signCalls:0,broadcasts:0,unlocks:0,opened:[],closed:[],events:[]};
  const storage=data=>({async get(keys){const list=Array.isArray(keys)?keys:[keys];return structuredClone(Object.fromEntries(list.filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]])))},async set(values){Object.assign(data,structuredClone(values));if(state.afterSet)await state.afterSet(values)},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key]}});
  const waiting=[],timers=new Set();let listener;
  const api={runtime:{id:"fixture",getURL:page=>`chrome-extension://fixture/${page}`,onMessage:{addListener:callback=>{listener=callback}}},storage:{local:storage(localState),session:storage({})},tabs:{async get(id){return{id,url:state.url}},async sendMessage(_id,message){state.events.push(message)}},windows:{async create(options){const created={id:state.opened.length+1,...options};state.opened.push(created);waiting.shift()?.(created);return created},async remove(id){state.closed.push(id)}}};
  const actualSign=bindings.signExtensionRequest,actualUnlock=bindings.unlockEncryptedVault;
  const context=vm.createContext({...bindings,chrome:api,URL,Date,crypto:webcrypto,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);return timer},clearTimeout:timer=>{clearTimeout(timer);timers.delete(timer)},runExtensionMigration:async()=>({fixture:true}),
    forwardExtensionRpc:async(method,params)=>{state.calls.push({method,params});if(state.beforeRpc)await state.beforeRpc(method);if(state.unavailable===method)throw new Error("RPC fixture unavailable");return{eth_chainId:state.chain,eth_getTransactionCount:state.nonce,eth_estimateGas:"0x61a8",eth_gasPrice:toQuantity(40_000_000_000_000n),eth_getBalance:toQuantity(3n*10n**18n)}[method]},
    unlockEncryptedVault:async(...args)=>{state.unlocks++;if(state.beforeUnlock)await state.beforeUnlock();return actualUnlock(...args)},
    signExtensionRequest:async args=>{state.signCalls++;return actualSign(args)},
    broadcastExtensionTransaction:async raw=>{state.broadcasts++;state.transaction=Transaction.from(raw);return state.transaction.hash}
  });vm.runInContext(executable,context);
  t.after(()=>{vm.runInContext('invalidateWaiters("FIXTURE_CLOSED","Fixture closed.")',context);for(const timer of timers)clearTimeout(timer)});
  const send=(message,sender)=>new Promise(resolve=>{const accepted=listener(message,sender,resolve);if(accepted===false)resolve({ok:false,error:{code:"UNHANDLED"}})});
  let count=0,windowCursor=0;
  const request=(method,params,deadlineAt=Date.now()+5000)=>{const requestId=`ynx-${(++count).toString(16).padStart(8,"0")}-1111-4111-8111-111111111111`,message={type:RUNTIME_REQUEST,version:BRIDGE_VERSION,requestId,origin:ORIGIN,deadlineAt,method,params};return{requestId,result:send(message,{tab:{id:1,url:state.url},frameId:0,url:state.url})}};
  const page=(page,requestId)=>({id:"fixture",url:api.runtime.getURL(`${page}?requestId=${requestId}`)});
  return{state,localState,request,nextWindow:()=>windowCursor<state.opened.length?Promise.resolve(state.opened[windowCursor++]):new Promise(resolve=>waiting.push(value=>{windowCursor++;resolve(value)})),
    review:requestId=>send({type:"YNX_SIGNER_GET_V1",requestId},page("signer.html",requestId)),
    decide:(requestId,decision="approve")=>send({type:"YNX_SIGNER_DECIDE_V1",requestId,decision,password:PASSWORD},page("signer.html",requestId)),
    connectDecision:requestId=>send({type:"YNX_PROVIDER_APPROVAL_DECIDE_V1",requestId,decision:"approve"},page("approval.html",requestId)),
    vaultAction:type=>send({type,vault},page("vault.html","unused"))};
}

test("worker shows the complete public review before unlocking and signs its exact bytes",async t=>{
  const f=await fixture(t),text=`${"x".repeat(1600)}\u202eTAIL`,hex=`0x${Buffer.from(text).toString("hex")}`,request=f.request("personal_sign",[hex,ACCOUNT]);await f.nextWindow();
  const review=await f.review(request.requestId);assert.equal(review.ok,true);assert.equal(review.request.review.messageHex,hex);assert.match(review.request.summary,/\\u202eTAIL/);assert.equal(f.state.unlocks,0);
  assert.equal((await f.decide(request.requestId)).ok,true);const result=await request.result;assert.equal(result.ok,true);assert.equal(verifyMessage(Buffer.from(hex.slice(2),"hex"),result.result).toLowerCase(),ACCOUNT);
  assert.equal((await f.decide(request.requestId)).ok,false);assert.equal(f.state.signCalls,1);
});

test("revoke, account replacement and vault removal immediately invalidate pending signatures",async t=>{
  for(const mutation of["revoke","store","remove"]){const f=await fixture(t),request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();
    if(mutation==="revoke")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result;else await f.vaultAction(mutation==="store"?"YNX_VAULT_STORE_V1":"YNX_VAULT_REMOVE_V1");
    assert.equal((await request.result).ok,false);assert.equal((await f.decide(request.requestId)).ok,false);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  }
});

test("origin changes and expired approval decisions cannot release a signature",async t=>{
  const f=await fixture(t),request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();f.state.url="https://different.example";
  assert.equal((await f.decide(request.requestId)).error.code,"ORIGIN_CHANGED");assert.equal((await request.result).ok,false);assert.equal(f.state.signCalls,0);
  const expired=await fixture(t),pending=expired.request("personal_sign",["0x01",ACCOUNT],Date.now()+80);await expired.nextWindow();
  const result=await pending.result;assert.equal(result.ok,false);assert.equal((await expired.decide(pending.requestId)).ok,false);assert.equal(expired.state.signCalls,0);
});

test("revocation during vault decryption prevents the signer from receiving the key",async t=>{
  const f=await fixture(t),request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();
  f.state.beforeUnlock=async()=>{await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result};
  await f.decide(request.requestId);assert.equal((await request.result).ok,false);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
});

test("transaction RPC prefill precedes review and only the frozen snapshot is broadcast",async t=>{
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:"0x1",data:"0x1234"}]);await f.nextWindow();
  const review=(await f.review(request.requestId)).request.review;assert.equal(review.nonce,"0x1");assert.equal(review.gasLimit,"0x7530");assert.equal(review.maximumFee,"1.2");assert.equal(review.data,"0x1234");assert.equal(f.state.signCalls,0);
  f.state.calls.length=0;await f.decide(request.requestId);const result=await request.result;assert.equal(result.ok,true);assert.equal(f.state.broadcasts,1);
  assert.deepEqual(f.state.calls.map(item=>item.method),["eth_chainId","eth_getTransactionCount"]);assert.equal(f.state.transaction.nonce,1);assert.equal(f.state.transaction.gasLimit,30000n);assert.equal(f.state.transaction.gasPrice,40000000000000n);assert.equal(f.state.transaction.data,"0x1234");
});

test("missing fees and revocation during prefill never open an approval; changed nonce never broadcasts",async t=>{
  for(const mutation of["missing-fee","revoke"]){const f=await fixture(t);if(mutation==="missing-fee")f.state.unavailable="eth_gasPrice";else f.state.beforeRpc=async method=>{if(method==="eth_estimateGas")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result};
    const result=await f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:"0x1",data:"0x"}]).result;assert.equal(result.ok,false);assert.equal(f.state.opened.length,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  }
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:"0x1",data:"0x"}]);await f.nextWindow();f.state.nonce="0x2";await f.decide(request.requestId);assert.equal((await request.result).error.code,"TRANSACTION_NONCE_CHANGED");assert.equal(f.state.broadcasts,0);
});

test("connection approval cannot restore permission after revoke or tab navigation",async t=>{
  for(const mutation of["revoke","origin"]){const f=await fixture(t,{permitted:false}),request=f.request("eth_requestAccounts",[]);await f.nextWindow();
    if(mutation==="revoke")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result;else f.state.url="https://elsewhere.example";
    assert.equal((await f.connectDecision(request.requestId)).ok,false);assert.equal((await request.result).ok,false);assert.equal(f.localState[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);
  }
});

test("navigation during permission persistence rolls back the just-granted permission",async t=>{
  const f=await fixture(t,{permitted:false}),request=f.request("eth_requestAccounts",[]);await f.nextWindow();
  f.state.afterSet=async values=>{if(values[PROVIDER_PERMISSIONS_KEY]?.[ORIGIN])f.state.url="https://changed-during-write.example"};
  await f.connectDecision(request.requestId);assert.equal((await request.result).ok,false);assert.equal(f.localState[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);
});

test("revocation during the final nonce check prevents transaction broadcasting",async t=>{
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:"0x1",data:"0x"}]);await f.nextWindow();
  f.state.beforeRpc=async method=>{if(method==="eth_getTransactionCount")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result};
  await f.decide(request.requestId);assert.equal((await request.result).ok,false);assert.equal(f.state.broadcasts,0);
});
