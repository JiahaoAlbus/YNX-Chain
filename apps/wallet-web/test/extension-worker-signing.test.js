import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import {DURABILITY_MODEL} from "../src/extension-durability.js";
import {NATIVE_FEE_MODEL} from "../src/extension-fee-model.js";
import {BROADCAST_JOURNAL_PREFIX} from "../src/extension-broadcast-journal.js";
import {Transaction,verifyMessage,toQuantity} from "ethers";
import {createEncryptedVault,extensionIdentity} from "../src/extension-vault.js";
import {PROVIDER_ACCOUNT_KEY,PROVIDER_PERMISSIONS_KEY,grantPermission} from "../src/extension-provider-permissions.js";
import {EXTENSION_VAULT_KEY} from "../src/extension-vault.js";
import {BRIDGE_VERSION,RUNTIME_REQUEST} from "../src/extension-bridge.js";

// Executes the real worker handlers with simulated browser APIs and RPC only.
const SECRET="1".padStart(64,"0"),PASSWORD="public-fixture-password-only",ACCOUNT=extensionIdentity(SECRET).account,ORIGIN="https://fixture-dapp.example",TO=`0x${"22".repeat(20)}`;
const validReceipt=(hash,amount="2")=>({transactionHash:hash,status:"0x1",blockHash:`0x${"a".repeat(64)}`,blockNumber:"0x2",from:ACCOUNT,to:TO,type:"0x0",contractAddress:null,gasUsed:NATIVE_FEE_MODEL.gas,effectiveGasPrice:NATIVE_FEE_MODEL.gasPrice,ynxFeeWei:NATIVE_FEE_MODEL.feeWei,ynxDurability:{version:DURABILITY_MODEL.version,scope:"local-snapshot",status:"durable",transactionHash:hash,blockNumber:"0x2",blockHash:`0x${"a".repeat(64)}`,checkpointBlockNumber:"0x2",checkpointBlockHash:`0x${"a".repeat(64)}`,snapshotIntegrity:`0x${"b".repeat(64)}`},ynxNativeTransaction:{type:"transfer",amountYNXT:amount,feeYNXT:"1",nonce:"0x2"}});
const vaultPromise=createEncryptedVault({password:PASSWORD,secretHex:SECRET},webcrypto);
const source=await readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"),bindings={};
for(const match of source.matchAll(/^import \{([^}]+)\} from "\.\/([^"]+)";$/gm)){const module=await import(new URL(`../src/${match[2]}`,import.meta.url));for(const name of match[1].split(","))bindings[name]=module[name]}
const executable=source.replace(/^import .*;\n/gm,"");
async function fixture(t,{permitted=true,existingLocal=null,existingSession=null,firefox=false,browserContext="firefox-container-1"}={}){
  const vault=await vaultPromise,account={version:1,source:"ynx-wallet-vault",account:ACCOUNT},localState=existingLocal??{[EXTENSION_VAULT_KEY]:vault,[PROVIDER_ACCOUNT_KEY]:account,[PROVIDER_PERMISSIONS_KEY]:permitted?grantPermission({},ORIGIN,account):{}};
  const state={documentNonce:"a".repeat(64),documentId:firefox?undefined:"FF2F212A00379D284FE8558A23819E2D",probes:0,tabId:1,incognito:false,cookieStoreId:firefox?browserContext:undefined,contextByTab:{},url:`${ORIGIN}/request`,nonce:"0x1",chain:"0x1917",calls:[],signCalls:0,broadcasts:0,unlocks:0,opened:[],closed:[],events:[]};
  const storage=data=>({async get(keys){const list=Array.isArray(keys)?keys:[keys],result=structuredClone(Object.fromEntries(list.filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]])));if(state.afterGet)await state.afterGet(keys);return result},async set(values){Object.assign(data,structuredClone(values));if(state.afterSet)await state.afterSet(values)},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key]}});
  const waiting=[],timers=new Set(),sessionState=existingSession??{};let listener;
  const api={runtime:{id:"fixture",getURL:page=>`${firefox?"moz":"chrome"}-extension://fixture/${page}`,onMessage:{addListener:callback=>{listener=callback}}},storage:{local:storage(localState),session:storage(sessionState)},tabs:{onUpdated:{addListener:fn=>state.tabUpdated=fn},onRemoved:{addListener:fn=>state.tabRemoved=fn},async query(){if(state.beforeTabQuery)await state.beforeTabQuery();return[{id:state.tabId,url:state.url,incognito:state.incognito,cookieStoreId:state.cookieStoreId}]},async get(id){if(id===2&&state.vaultClosed)throw new Error("Vault tab closed");return{id,incognito:state.incognito,cookieStoreId:Object.hasOwn(state.contextByTab,id)?state.contextByTab[id]:state.cookieStoreId,url:id===2?api.runtime.getURL("vault.html?requestId=unused"):state.url}},async sendMessage(id,message,target){if(message.type==="YNX_DAPP_DOCUMENT_PROBE_V1"){state.probes++;if(state.beforeProbe)await state.beforeProbe();if(target?.documentId&&target.documentId!==state.documentId)throw new Error("Document no longer active");if(state.contentProbe){let response;state.contentProbe(message,{id:"fixture"},value=>{response=value});return response}return{version:1,origin:message.origin,challenge:message.challenge,documentNonce:state.documentNonce}}state.events.push(message)}},scripting:{async executeScript(){if(state.beforeInjection)await state.beforeInjection();return state.documentId===undefined?[]:[{frameId:0,documentId:state.documentId}]}},windows:{async create(options){const created={id:state.opened.length+1,...options};state.opened.push(created);waiting.shift()?.(created);return created},async remove(id){state.closed.push(id)}}};
  const actualSign=bindings.signExtensionRequest,actualUnlock=bindings.unlockEncryptedVault,actualDerive=bindings.deriveScopedSensitiveRequestId;
  const fetcher=async(_url,options)=>{const{method,params}=JSON.parse(options.body);state.calls.push({method,params});if(state.beforeRpc)await state.beforeRpc(method);if(state.unavailable===method)throw new Error("RPC fixture unavailable");if(state.rpcErrors?.[method])return{ok:true,redirected:false,url:"https://evm.ynxweb4.com/",json:async()=>({jsonrpc:"2.0",id:6423,error:state.rpcErrors[method]})};let result;
    if(method==="eth_sendRawTransaction"){state.broadcasts++;state.transaction=Transaction.from(params[0]);if(state.broadcastHook)await state.broadcastHook();if(state.transportFailure)throw new Error("ACK lost");if(state.broadcastError)return{ok:state.broadcastHttpSuccess!==false,redirected:false,url:"https://evm.ynxweb4.com/",json:async()=>({jsonrpc:"2.0",id:6423,error:state.broadcastError})};result=state.ackHash??state.transaction.hash}
    else result={eth_chainId:state.chain,ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:state.durabilityModel??DURABILITY_MODEL,eth_getTransactionCount:state.nonce,eth_estimateGas:"0x61a8",eth_gasPrice:NATIVE_FEE_MODEL.gasPrice,eth_getBalance:toQuantity(3n*10n**18n),eth_getTransactionReceipt:state.receipt??null}[method];
    return{ok:true,redirected:false,url:"https://evm.ynxweb4.com/",json:async()=>({jsonrpc:"2.0",id:6423,result})};};
  const context=vm.createContext({...bindings,chrome:api,URL,Date,crypto:webcrypto,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);return timer},clearTimeout:timer=>{clearTimeout(timer);timers.delete(timer)},runExtensionMigration:async()=>({fixture:true}),
    forwardExtensionRpc:(method,params)=>bindings.forwardExtensionRpc(method,params,fetcher),
    deriveScopedSensitiveRequestId:async input=>{const id=await actualDerive(input);if(state.afterHash)await state.afterHash();return id},
    unlockEncryptedVault:async(...args)=>{state.unlocks++;if(state.beforeUnlock)await state.beforeUnlock();return actualUnlock(...args)},
    signExtensionRequest:async args=>{state.signCalls++;const result=await actualSign(args);if(state.afterSign)await state.afterSign();return result},
    broadcastExtensionTransaction:raw=>bindings.broadcastExtensionTransaction(raw,fetcher)
  });vm.runInContext(executable,context);
  t.after(()=>{vm.runInContext('invalidateWaiters("FIXTURE_CLOSED","Fixture closed.")',context);for(const timer of timers)clearTimeout(timer)});
  const send=(message,sender)=>new Promise(resolve=>{const accepted=listener(message,sender,resolve);if(accepted===false)resolve({ok:false,error:{code:"UNHANDLED"}})});
  let count=0,windowCursor=0;
  const request=(method,params,deadlineAt=Date.now()+5000,extra={})=>{const requestId=`ynx-${(++count).toString(16).padStart(8,"0")}-1111-4111-8111-111111111111`,message={type:RUNTIME_REQUEST,version:BRIDGE_VERSION,requestId,origin:ORIGIN,deadlineAt,method,params,documentNonce:state.documentNonce,...extra};const reviewId=actualDerive({browserContext:firefox?state.cookieStoreId:"chromium-default",origin:ORIGIN,requestId:message.requestId});void reviewId.catch(()=>{});return{requestId:message.requestId,reviewId,result:send(message,{...(firefox?{}:{documentId:state.documentId,documentLifecycle:"active"}),tab:{id:state.tabId,url:state.url,incognito:state.incognito,cookieStoreId:state.cookieStoreId},frameId:0,url:state.url})}};
  const page=(page,requestId)=>({id:"fixture",url:api.runtime.getURL(`${page}?requestId=${requestId}`)});
  return{state,localState,sessionState,request,rawSend:send,reviewFrom:(pageId,bodyId)=>send({type:"YNX_PROVIDER_APPROVAL_DECIDE_V1",requestId:bodyId,decision:"approve"},page("approval.html",pageId)),pageRequest:(preference,input,providers)=>{context.ethereum={providers};return context.__YNX_INTERNAL_PAGE_WALLET_REQUEST__(preference,input)},popupRequest:(method,params,preference="ynx")=>send({type:"YNX_WALLET_REQUEST",preference,input:{method,params}},page("popup.html","unused")),nextWindow:()=>windowCursor<state.opened.length?Promise.resolve(state.opened[windowCursor++]):new Promise(resolve=>waiting.push(value=>{windowCursor++;resolve(value)})),
    review:async requestId=>{requestId=await requestId;return send({type:"YNX_SIGNER_GET_V1",requestId},page("signer.html",requestId))},
    decide:async(requestId,decision="approve")=>{requestId=await requestId;return send({type:"YNX_SIGNER_DECIDE_V1",requestId,decision,password:PASSWORD},page("signer.html",requestId))},
    connectDecision:async requestId=>{requestId=await requestId;return send({type:"YNX_PROVIDER_APPROVAL_DECIDE_V1",requestId,decision:"approve"},page("approval.html",requestId))},
    vaultAction:(type,data={})=>send({type,vault,...data},{...page("vault.html","unused"),tab:{id:2}})};
}

test("worker shows the complete public review before unlocking and signs its exact bytes",async t=>{
  const f=await fixture(t),text=`${"x".repeat(1600)}\u202eTAIL`,hex=`0x${Buffer.from(text).toString("hex")}`,request=f.request("personal_sign",[hex,ACCOUNT]);await f.nextWindow();
  const review=await f.review(request.reviewId);assert.equal(review.ok,true);assert.equal(review.request.review.messageHex,hex);assert.match(review.request.summary,/\\u202eTAIL/);assert.equal(f.state.unlocks,0);
  assert.equal((await f.decide(request.reviewId)).ok,true);const result=await request.result;assert.equal(result.ok,true);assert.equal(verifyMessage(Buffer.from(hex.slice(2),"hex"),result.result).toLowerCase(),ACCOUNT);
  assert.equal((await f.decide(request.reviewId)).ok,false);assert.equal(f.state.signCalls,1);
});

test("actual worker rejects another-wallet preference before tab access and never falls back to MetaMask",async t=>{
  const f=await fixture(t);let tabReads=0,ynxCalls=0,metaMaskCalls=0;f.state.beforeTabQuery=()=>{tabReads++};
  for(const preference of["metamask","any","",null])for(const method of["eth_requestAccounts","personal_sign","eth_sendTransaction"]){const result=await f.popupRequest(method,[],preference);assert.equal(result.error.code,"WALLET_PROVIDER_UNSUPPORTED");}
  assert.equal(tabReads,0);assert.equal(f.state.opened.length,0);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  const mm={isMetaMask:true,request:()=>{metaMaskCalls++;return[ACCOUNT]}},ynx={isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"},request:()=>{ynxCalls++;return[ACCOUNT]}};
  assert.throws(()=>f.pageRequest("ynx",{method:"eth_requestAccounts"},[mm]),{code:"WALLET_BACKEND_NOT_FOUND"});
  assert.throws(()=>f.pageRequest("metamask",{method:"eth_requestAccounts"},[mm,ynx]),{code:"WALLET_PROVIDER_UNSUPPORTED"});
  assert.deepEqual(f.pageRequest("ynx",{method:"eth_requestAccounts"},[mm,ynx]),[ACCOUNT]);assert.equal(metaMaskCalls,0);assert.equal(ynxCalls,1);
});

test("document lease starts before migration, replay, account reads and transaction prefill",async t=>{
  for(const stage of["migration","replay","account","prefill"])await t.test(stage,async t=>{
    const f=await fixture(t),navigate=()=>f.state.tabUpdated(1,{status:"loading"});
    if(stage==="replay")f.state.afterSet=async values=>{if(Object.keys(values).includes("ynx.extension.sensitive.replay.v1"))navigate()};
    if(stage==="account")f.state.afterGet=async keys=>{if(Array.isArray(keys)&&keys.includes(PROVIDER_ACCOUNT_KEY))navigate()};
    if(stage==="prefill")f.state.beforeRpc=async method=>{if(method==="eth_getTransactionCount")navigate()};
    const request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);
    if(stage==="migration")navigate();
    assert.equal((await request.result).error.code,"DOCUMENT_CHANGED");assert.equal(f.state.opened.length,0);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  });
});

test("popup requests retain the document epoch across active-tab lookup and injection",async t=>{
  for(const stage of["query","injection"])await t.test(stage,async t=>{
    const f=await fixture(t),navigate=()=>f.state.tabUpdated(1,{status:"loading"});if(stage==="query")f.state.beforeTabQuery=navigate;else f.state.beforeInjection=navigate;
    const result=await f.popupRequest("personal_sign",["0x01",ACCOUNT]);assert.equal(result.error.code,"DOCUMENT_CHANGED");assert.equal(f.state.opened.length,0);assert.equal(f.state.signCalls,0);
  });
});

test("navigation after decrypt or signing cannot release a result or dispatch a transaction",async t=>{
  for(const stage of["decrypt","signed","journal-readback"])await t.test(stage,async t=>{
    const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);await f.nextWindow();
    const navigate=()=>f.state.tabUpdated(1,{status:"loading"});
    if(stage==="decrypt")f.state.beforeUnlock=navigate;
    if(stage==="signed")f.state.afterSign=navigate;
    if(stage==="journal-readback")f.state.afterGet=async keys=>{const key=BROADCAST_JOURNAL_PREFIX+ACCOUNT;if(Array.isArray(keys)&&keys.includes(key)&&f.localState[key]?.status==="broadcasting")navigate()};
    await f.decide(request.reviewId);assert.equal((await request.result).error.code,"DOCUMENT_CHANGED");assert.equal(f.state.broadcasts,0);assert.equal(f.state.signCalls,stage==="decrypt"?0:1);
    if(stage==="journal-readback"){const record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];assert.equal(record.status,"cancelled");assert.ok(record.rawTransaction);}
  });
});

test("navigation after POST keeps its durable journal facts and rejects the old reply",async t=>{
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);await f.nextWindow();
  f.state.broadcastHook=()=>f.state.tabUpdated(1,{status:"loading"});await f.decide(request.reviewId);
  assert.equal((await request.result).error.code,"DOCUMENT_CHANGED");assert.equal(f.state.broadcasts,1);assert.equal(f.state.signCalls,1);
  const record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];assert.equal(record.status,"acknowledged");assert.equal(record.unknownHistory,true);assert.equal(record.rawTransaction,f.state.transaction.serialized);
  const restarted=await fixture(t,{existingLocal:f.localState});assert.equal((await restarted.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]).result).error.code,-32002);assert.equal(restarted.state.signCalls,0);
});

test("new-document requests work while unrelated tab events and popup focus preserve approval",async t=>{
  const f=await fixture(t),old=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();f.state.tabRemoved(1);assert.equal((await old.result).error.code,"DOCUMENT_CHANGED");
  const fresh=f.request("personal_sign",["0x02",ACCOUNT]);await f.nextWindow();f.state.tabUpdated(99,{status:"loading"});f.state.tabRemoved(99);f.state.tabUpdated(1,{status:"complete"});
  await f.decide(fresh.reviewId);assert.equal((await fresh.result).ok,true);assert.equal(f.state.signCalls,1);
});

test("connection navigation cannot persist permission or send account events",async t=>{
  for(const stage of["review","permission-write"])await t.test(stage,async t=>{
    const f=await fixture(t,{permitted:false}),request=f.request("eth_requestAccounts",[]);await f.nextWindow();
    if(stage==="review")f.state.tabUpdated(1,{status:"loading"});
    else f.state.afterSet=async values=>{if(values[PROVIDER_PERMISSIONS_KEY]?.[ORIGIN])f.state.tabUpdated(1,{status:"loading"})};
    await f.connectDecision(request.reviewId);assert.equal((await request.result).error.code,"DOCUMENT_CHANGED");assert.equal(f.localState[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);assert.equal(f.state.events.length,0);
  });
});

test("navigation while revoking retains revocation but sends no event to the new document",async t=>{
  const f=await fixture(t);f.state.afterGet=async key=>{if(key===PROVIDER_PERMISSIONS_KEY)f.state.tabUpdated(1,{status:"loading"})};
  assert.equal((await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result).error.code,"DOCUMENT_CHANGED");
  assert.equal(f.localState[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);assert.equal(f.state.events.length,0);
});

for(const method of["personal_sign","eth_sendTransaction"])test(`DApp document navigation cancels the old ${method} approval`,async t=>{
  for(const navigation of["reload","away-and-back","removed-and-reused"])await t.test(navigation,async t=>{
    const f=await fixture(t),params=method==="personal_sign"?["0x01",ACCOUNT]:[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}],request=f.request(method,params);await f.nextWindow();
    if(navigation==="reload")f.state.tabUpdated(1,{status:"loading"});
    if(navigation==="away-and-back"){f.state.url="https://elsewhere.example";f.state.tabUpdated(1,{url:f.state.url});f.state.url=`${ORIGIN}/request`;f.state.tabUpdated(1,{url:f.state.url});}
    if(navigation==="removed-and-reused")f.state.tabRemoved(1);
    await f.decide(request.reviewId);const result=await request.result;
    assert.equal(result.ok,false,JSON.stringify({navigation,signCalls:f.state.signCalls,broadcasts:f.state.broadcasts}));
    assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  });
});

test("revoke, account replacement and vault removal immediately invalidate pending signatures",async t=>{
  for(const mutation of["revoke","store","remove"]){const f=await fixture(t),request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();
    if(mutation==="revoke")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result;else await f.vaultAction(mutation==="store"?"YNX_VAULT_STORE_V1":"YNX_VAULT_REMOVE_V1");
    assert.equal((await request.result).ok,false);assert.equal((await f.decide(request.reviewId)).ok,false);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  }
});

test("origin changes and expired approval decisions cannot release a signature",async t=>{
  const f=await fixture(t),request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();f.state.url="https://different.example";
  assert.equal((await f.decide(request.reviewId)).error.code,"ORIGIN_CHANGED");assert.equal((await request.result).ok,false);assert.equal(f.state.signCalls,0);
  const expired=await fixture(t),pending=expired.request("personal_sign",["0x01",ACCOUNT],Date.now()+80);await expired.nextWindow();
  const result=await pending.result;assert.equal(result.ok,false);assert.equal((await expired.decide(pending.reviewId)).ok,false);assert.equal(expired.state.signCalls,0);
});

test("revocation during vault decryption prevents the signer from receiving the key",async t=>{
  const f=await fixture(t),request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();
  f.state.beforeUnlock=async()=>{await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result};
  await f.decide(request.reviewId);assert.equal((await request.result).ok,false);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
});

test("transaction RPC prefill precedes review and only the frozen snapshot is broadcast",async t=>{
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n),data:"0x"}]);await f.nextWindow();
  const review=(await f.review(request.reviewId)).request.review;assert.equal(review.nonce,"0x1");assert.equal(review.gasLimit,"0x61a8");assert.equal(review.maximumFee,"1.0");assert.equal(review.data,"0x");assert.equal(f.state.signCalls,0);
  f.state.calls.length=0;await f.decide(request.reviewId);const result=await request.result;assert.equal(result.ok,true);assert.equal(f.state.broadcasts,1);
  assert.equal(f.state.calls.at(-1).method,"eth_sendRawTransaction");assert.equal(f.state.calls.filter(item=>item.method==="eth_getTransactionCount").length,1);assert.ok(f.state.calls.some(item=>item.method==="ynx_getDurabilityModel"));assert.equal(f.state.transaction.nonce,1);assert.equal(f.state.transaction.gasLimit,25000n);assert.equal(f.state.transaction.gasPrice,40000000000000n);assert.equal(f.state.transaction.data,"0x");
});

test("missing fees and revocation during prefill never open an approval; changed nonce never broadcasts",async t=>{
  for(const mutation of["missing-fee","revoke"]){const f=await fixture(t);if(mutation==="missing-fee")f.state.unavailable="eth_gasPrice";else f.state.beforeRpc=async method=>{if(method==="eth_estimateGas")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result};
    const result=await f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n),data:"0x"}]).result;assert.equal(result.ok,false);assert.equal(f.state.opened.length,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  }
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n),data:"0x"}]);await f.nextWindow();f.state.nonce="0x2";await f.decide(request.reviewId);assert.equal((await request.result).error.code,"TRANSACTION_NONCE_CHANGED");assert.equal(f.state.broadcasts,0);
});

test("connection approval cannot restore permission after revoke or tab navigation",async t=>{
  for(const mutation of["revoke","origin"]){const f=await fixture(t,{permitted:false}),request=f.request("eth_requestAccounts",[]);await f.nextWindow();
    if(mutation==="revoke")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result;else f.state.url="https://elsewhere.example";
    assert.equal((await f.connectDecision(request.reviewId)).ok,false);assert.equal((await request.result).ok,false);assert.equal(f.localState[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);
  }
});

test("navigation during permission persistence rolls back the just-granted permission",async t=>{
  const f=await fixture(t,{permitted:false}),request=f.request("eth_requestAccounts",[]);await f.nextWindow();
  f.state.afterSet=async values=>{if(values[PROVIDER_PERMISSIONS_KEY]?.[ORIGIN])f.state.url="https://changed-during-write.example"};
  await f.connectDecision(request.reviewId);assert.equal((await request.result).ok,false);assert.equal(f.localState[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);
});

test("revocation during the final nonce check prevents transaction broadcasting",async t=>{
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n),data:"0x"}]);await f.nextWindow();
  f.state.beforeRpc=async method=>{if(method==="eth_getTransactionCount")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result};
  await f.decide(request.reviewId);assert.equal((await request.result).ok,false);assert.equal(f.state.broadcasts,0);
});


test("real signer, RPC and worker preserve uncertain hash and raw across worker restart without a second review or broadcast",async t=>{
  for(const transportFailure of[false,true]){
    const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n)}]);await f.nextWindow();
    f.state.transportFailure=transportFailure;f.state.broadcastHook=async()=>{const record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];assert.equal(record.rawTransaction,f.state.transaction.serialized);assert.equal(record.status,"broadcasting");f.state.broadcastError={code:-32002,message:"transaction durability needs confirmation",data:{status:"transaction_durability_uncertain",transactionHash:f.state.transaction.hash}}};
    await f.decide(request.reviewId);const result=await request.result;
    assert.equal(result.error.code,-32002);assert.equal(result.error.data.status,"transaction_durability_uncertain");assert.equal(result.error.data.transactionHash,f.state.transaction.hash);assert.equal("rawTransaction" in result.error.data,false);
    const saved=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];assert.equal(saved.rawTransaction,f.state.transaction.serialized);assert.equal(saved.status,"uncertain");
    const restarted=await fixture(t,{existingLocal:f.localState});const retry=await restarted.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n)}]).result;
    assert.equal(retry.error.data.transactionHash,saved.transactionHash);assert.equal(restarted.state.opened.length,0);assert.equal(restarted.state.signCalls,0);assert.equal(restarted.state.broadcasts,0);
    assert.equal((await restarted.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V1")).transaction.blocksNewSend,true);
    restarted.state.receipt=validReceipt(saved.transactionHash);
    const checked=await restarted.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V1");assert.equal(checked.transaction.status,"confirmed");assert.equal(checked.transaction.blocksNewSend,false);assert.equal(restarted.state.broadcasts,0);assert.equal(restarted.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].rawTransaction,saved.rawTransaction);
  }
});

test("concurrent sends and failed recovery storage cannot reach a second signer or any broadcast",async t=>{
  const f=await fixture(t),params=[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}],request=f.request("eth_sendTransaction",params);await f.nextWindow();
  assert.equal((await f.request("eth_sendTransaction",params).result).error.code,"TRANSACTION_IN_PROGRESS");
  f.state.afterSet=async values=>{if(values[BROADCAST_JOURNAL_PREFIX+ACCOUNT])throw new Error("storage failed")};await f.decide(request.reviewId);assert.equal((await request.result).ok,false);assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,0);
});


test("a lost caller response after a successful RPC ACK also cannot trigger a replacement transaction",async t=>{
  const f=await fixture(t),params=[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n)}],request=f.request("eth_sendTransaction",params);await f.nextWindow();await f.decide(request.reviewId);const accepted=await request.result;assert.equal(accepted.ok,true);
  const restarted=await fixture(t,{existingLocal:f.localState});const retry=await restarted.request("eth_sendTransaction",params).result;
  assert.equal(retry.error.data.transactionHash,accepted.result);assert.equal(retry.error.data.status,"transaction_confirmation_pending");assert.equal(restarted.state.signCalls,0);assert.equal(restarted.state.broadcasts,0);
});


test("mismatching ACK hash and post-submit storage failure retain original recovery bytes",async t=>{
  for(const mode of["hash-mismatch","ack-write-failure"]){
    const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);await f.nextWindow();
    if(mode==="hash-mismatch")f.state.ackHash=`0x${"b".repeat(64)}`;else f.state.afterSet=async values=>{if(values[BROADCAST_JOURNAL_PREFIX+ACCOUNT]?.status==="acknowledged")throw new Error("readback uncertain")};
    await f.decide(request.reviewId);const result=await request.result;assert.equal(result.error.code,-32002);assert.equal(result.error.data.transactionHash,f.state.transaction.hash);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].rawTransaction,f.state.transaction.serialized);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"uncertain");
    f.state.receipt={transactionHash:`0x${"c".repeat(64)}`,blockHash:`0x${"a".repeat(64)}`,blockNumber:"0x2",status:"0x1"};
    assert.equal((await f.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V1")).error.code,"DURABILITY_UNCONFIRMED");assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"uncertain");
  }
});

test("revocation while storing signed recovery bytes cancels before broadcast; corrupt records block review",async t=>{
  const f=await fixture(t),params=[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}],request=f.request("eth_sendTransaction",params);await f.nextWindow();
  f.state.afterSet=async values=>{if(values[BROADCAST_JOURNAL_PREFIX+ACCOUNT]?.status==="broadcasting")await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result};
  await f.decide(request.reviewId);assert.equal((await request.result).ok,false);assert.equal(f.state.broadcasts,0);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"cancelled");
  const corrupted=await fixture(t);corrupted.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT]={rawTransaction:"0x01"};
  assert.equal((await corrupted.request("eth_sendTransaction",params).result).error.code,"BROADCAST_RECORD_INVALID");assert.equal(corrupted.state.opened.length,0);assert.equal(corrupted.state.signCalls,0);assert.equal(corrupted.state.broadcasts,0);
});


test("only the first validated definite rejection releases the account; unknown history cannot be cleared by -32003",async t=>{
  const params=[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}];
  const rejected=await fixture(t),request=rejected.request("eth_sendTransaction",params);await rejected.nextWindow();rejected.state.broadcastError={code:-32003,message:"insufficient funds"};await rejected.decide(request.reviewId);
  assert.equal((await request.result).error.code,-32003);assert.equal(rejected.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"rejected");assert.equal(rejected.localState[BROADCAST_JOURNAL_PREFIX+"hash."+rejected.state.transaction.hash].status,"rejected");
  const next=rejected.request("eth_sendTransaction",params);await rejected.nextWindow();await rejected.decide(next.reviewId,"reject");assert.equal((await next.result).error.code,4001);
  const unknown=await fixture(t),pending=unknown.request("eth_sendTransaction",params);await unknown.nextWindow();unknown.state.transportFailure=true;await unknown.decide(pending.reviewId);await pending.result;
  const original=unknown.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];unknown.state.rpcErrors={eth_getTransactionReceipt:{code:-32003,message:"nonce already consumed"}};
  assert.equal((await unknown.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V1")).error.code,-32003);assert.equal(unknown.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].rawTransaction,original.rawTransaction);assert.equal(unknown.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"uncertain");
  assert.equal((await unknown.request("eth_sendTransaction",params).result).error.code,-32002);assert.equal(unknown.state.signCalls,1);assert.equal(unknown.state.broadcasts,1);
  const failedHttp=await fixture(t),httpRequest=failedHttp.request("eth_sendTransaction",params);await failedHttp.nextWindow();failedHttp.state.broadcastHttpSuccess=false;failedHttp.state.broadcastError={code:-32003,message:"gateway rejected"};await failedHttp.decide(httpRequest.reviewId);assert.equal((await httpRequest.result).error.code,-32002);assert.equal(failedHttp.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"uncertain");
});


test("receipt account, type and fixed-fee mismatches never release the original pending transaction",async t=>{
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);await f.nextWindow();f.state.transportFailure=true;await f.decide(request.reviewId);await request.result;
  const hash=f.state.transaction.hash,complete=validReceipt(hash,"1");
  for(const patch of[{from:TO},{to:ACCOUNT},{type:"0x2"},{contractAddress:TO},{gasUsed:"0x0"},{effectiveGasPrice:"0x0"},{ynxFeeWei:"0x0"},...Object.keys(complete).map(key=>({[key]:undefined}))]){
    f.state.receipt={...complete,...patch};const result=await f.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V1");assert.equal(result.ok,false,JSON.stringify(patch));assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"uncertain");
  }
  f.state.receipt=complete;assert.equal((await f.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V1")).transaction.status,"confirmed");assert.equal(f.state.broadcasts,1);
});

const recoveryRequest=(transactionHash,extra={})=>({account:ACCOUNT,transactionHash,requestId:`recovery-${webcrypto.randomUUID()}`,deadlineAt:Date.now()+30000,password:PASSWORD,reviewed:true,...extra});
async function unknownWorker(t){const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n)}]);await f.nextWindow();f.state.transportFailure=true;await f.decide(request.reviewId);await request.result;f.state.transportFailure=false;return f}

test("vault explicit retry unlocks only for authorization and dispatches the original bytes without signing or nonce lookup",async t=>{
  const first=await unknownWorker(t),record=first.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT],f=await fixture(t,{existingLocal:first.localState});
  const before=await f.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V2",{account:ACCOUNT,transactionHash:record.transactionHash});assert.equal(before.transaction.blocksNewSend,true);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  const authorization=recoveryRequest(record.transactionHash),result=await f.vaultAction("YNX_VAULT_TRANSACTION_RETRY_V2",authorization);assert.equal(result.ok,true);assert.equal(result.transaction.status,"acknowledged");assert.equal(result.transaction.blocksNewSend,true);
  assert.equal(f.state.unlocks,1);assert.equal(f.state.signCalls,0);assert.equal(f.state.transaction.serialized,record.rawTransaction);assert.equal(f.state.calls.some(c=>c.method==="eth_getTransactionCount"),false);
  assert.equal((await f.vaultAction("YNX_VAULT_TRANSACTION_RETRY_V2",authorization)).error.code,"REQUEST_REPLAYED");assert.equal(f.state.broadcasts,1);
  f.state.broadcastError={code:-32003,message:"nonce consumed"};assert.equal((await f.vaultAction("YNX_VAULT_TRANSACTION_RETRY_V2",recoveryRequest(record.transactionHash))).error.code,-32002);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].unknownHistory,true);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].rawTransaction,record.rawTransaction);
});
test("vault retry rejects wrong account/hash/password and cancellation during decryption without another POST",async t=>{
  for(const mode of["account","hash","password","cancel","remove","close"]){
    const f=await unknownWorker(t),record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT],request=recoveryRequest(record.transactionHash);
    if(mode==="account")request.account=TO;if(mode==="hash")request.transactionHash=`0x${"f".repeat(64)}`;if(mode==="password")request.password="wrong-fixture-password";
    if(mode==="cancel")f.state.beforeUnlock=async()=>{await f.vaultAction("YNX_VAULT_TRANSACTION_CANCEL_V2",{requestId:request.requestId})};
    if(mode==="remove")f.state.beforeUnlock=async()=>{await f.vaultAction("YNX_VAULT_REMOVE_V1")};
    if(mode==="close")f.state.beforeUnlock=async()=>{f.state.vaultClosed=true};
    const result=await f.vaultAction("YNX_VAULT_TRANSACTION_RETRY_V2",request);assert.equal(result.ok,false,mode);assert.equal(f.state.broadcasts,1,mode);assert.equal(f.state.signCalls,1,mode);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].rawTransaction,record.rawTransaction,mode);
  }
});
test("late retry ACK after cancellation records fact but never replies with fresh authorization",async t=>{
  const f=await unknownWorker(t),record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT],request=recoveryRequest(record.transactionHash);
  f.state.broadcastHook=async()=>{await f.vaultAction("YNX_VAULT_TRANSACTION_CANCEL_V2",{requestId:request.requestId})};
  const result=await f.vaultAction("YNX_VAULT_TRANSACTION_RETRY_V2",request);assert.equal(result.error.code,"RECOVERY_CANCELLED");assert.equal(f.state.broadcasts,2);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"acknowledged");assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].rawTransaction,record.rawTransaction);
  assert.equal((await f.vaultAction("YNX_VAULT_STATUS_V1")).transaction.blocksNewSend,true);
});
test("post-receipt actual chain/model changes and failed status never resolve original intent",async t=>{
  for(const mode of["chain","model","failed-status"]){
    const f=await unknownWorker(t),hash=f.state.transaction.hash;f.state.receipt=validReceipt(hash);
    if(mode==="failed-status")f.state.receipt.status="0x0";
    f.state.beforeRpc=async method=>{if(method==="eth_getTransactionReceipt"){if(mode==="chain")f.state.chain="0x1";if(mode==="model")f.state.durabilityModel={...DURABILITY_MODEL,extra:true}}};
    const result=await f.vaultAction("YNX_VAULT_TRANSACTION_CHECK_V2",{account:ACCOUNT,transactionHash:hash});assert.equal(result.ok,false,mode);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"uncertain");assert.equal(f.state.broadcasts,1);
  }
});
test("actual worker preserves bounded Core durability errors after journaling unknown",async t=>{
  for(const [code,status,proofStatus]of[[-32002,"transaction_durability_uncertain","uncertain"],[-32004,"transaction_durability_unavailable","memory_only"]]){
    const f=await unknownWorker(t),hash=f.state.transaction.hash,ynxDurability={version:DURABILITY_MODEL.version,scope:"local-snapshot",status:proofStatus,transactionHash:hash};
    f.state.broadcastError={code,message:"Core local checkpoint unavailable",data:{status,transactionHash:hash,durabilityVersion:DURABILITY_MODEL.version,ynxDurability,rawTransaction:"never expose"}};
    const result=await f.vaultAction("YNX_VAULT_TRANSACTION_RETRY_V2",recoveryRequest(hash));assert.equal(result.error.code,code);assert.equal(JSON.stringify(result.error.data.ynxDurability),JSON.stringify(ynxDurability));assert.equal(Object.hasOwn(result.error.data,"rawTransaction"),false);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].status,"uncertain");
  }
});

test("same-URL vault reload or tab removal invalidates password work even when pagehide Cancel is lost",async t=>{
 for(const event of["reload","removed"]){const f=await unknownWorker(t),record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];f.state.beforeUnlock=async()=>{if(event==="reload")f.state.tabUpdated(2,{status:"loading"});else f.state.tabRemoved(2)};
  const result=await f.vaultAction("YNX_VAULT_TRANSACTION_RETRY_V2",recoveryRequest(record.transactionHash));assert.equal(result.error.code,"RECOVERY_CANCELLED");assert.equal(f.state.broadcasts,1);assert.equal(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT].rawTransaction,record.rawTransaction);
 }
});

test("missing durability blocks before review or decrypt; loss during approval does not unlock",async t=>{
 const params=[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n)}],missing=await fixture(t);missing.state.durabilityModel={};const result=await missing.request("eth_sendTransaction",params).result;
 assert.equal(result.error.code,"DURABILITY_UNCONFIRMED");assert.equal(missing.state.opened.length,0);assert.equal(missing.state.unlocks,0);assert.equal(missing.state.signCalls,0);assert.equal(missing.state.broadcasts,0);assert.equal(missing.state.calls.some(c=>c.method==="eth_getTransactionCount"),false);
 const changed=await fixture(t),request=changed.request("eth_sendTransaction",params);await changed.nextWindow();changed.state.durabilityModel={};await changed.decide(request.reviewId);assert.equal((await request.result).error.code,"DURABILITY_UNCONFIRMED");assert.equal(changed.state.unlocks,0);assert.equal(changed.state.signCalls,0);assert.equal(changed.state.broadcasts,0);
});

async function connectFirefox(f){const request=f.request("eth_requestAccounts",[]);await f.nextWindow();await f.connectDecision(request.reviewId);assert.equal((await request.result).ok,true)}

test("same-origin Firefox containers and default context require separate connection approval",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false});await connectFirefox(f);
  for(const context of["firefox-container-2","firefox-default"]){f.state.tabId+=2;f.state.cookieStoreId=context;
    assert.deepEqual(Array.from((await f.request("eth_accounts",[]).result).result),[]);assert.equal((await f.request("wallet_getPermissions",[]).result).result.length,0);
    for(const method of["personal_sign","eth_sendTransaction"]){const params=method==="personal_sign"?["0x01",ACCOUNT]:[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}];assert.equal((await f.request(method,params).result).error.code,4100)}
  }
  assert.equal(f.state.opened.length,1);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  await connectFirefox(f);assert.equal((await f.request("wallet_getPermissions",[]).result).result.length,1);
});

test("Firefox container permission persists across worker restart while legacy permission has no inferred container",async t=>{
  const legacy=await fixture(t,{firefox:true});for(const context of["firefox-default","firefox-container-1"]){legacy.state.cookieStoreId=context;assert.deepEqual(Array.from((await legacy.request("eth_accounts",[]).result).result),[])}
  const f=await fixture(t,{firefox:true,permitted:false});await connectFirefox(f);
  const restarted=await fixture(t,{firefox:true,existingLocal:f.localState});assert.deepEqual(Array.from((await restarted.request("eth_accounts",[]).result).result),[ACCOUNT]);
  restarted.state.cookieStoreId="firefox-container-2";assert.deepEqual(Array.from((await restarted.request("eth_accounts",[]).result).result),[]);
  const chromium=await fixture(t);assert.deepEqual(Array.from((await chromium.request("eth_accounts",[]).result).result),[ACCOUNT]);
});

test("revoke from another Firefox container cannot remove permission or cancel an approved-container signer",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false});await connectFirefox(f);f.state.contextByTab[1]="firefox-container-1";
  const request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();f.state.tabId=3;f.state.cookieStoreId="firefox-container-2";
  assert.equal((await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result).ok,true);assert.equal((await f.decide(request.reviewId)).ok,true);assert.equal((await request.result).ok,true);assert.equal(f.state.signCalls,1);
  f.state.tabId=1;f.state.cookieStoreId="firefox-container-1";assert.deepEqual(Array.from((await f.request("eth_accounts",[]).result).result),[ACCOUNT]);
  const pending=f.request("personal_sign",["0x02",ACCOUNT]);await f.nextWindow();f.state.tabId=4;await f.request("wallet_revokePermissions",[{eth_accounts:{}}]).result;assert.equal((await pending.result).error.code,"PERMISSION_REVOKED");assert.equal(f.state.signCalls,1);
});

test("Firefox private or missing browser context rejects requests before account reads, replay, review or RPC",async t=>{
  for(const scenario of["missing","private","private-id","malformed"]){const f=await fixture(t,{firefox:true});let writes=0;f.state.afterSet=()=>writes++;
    if(scenario==="missing")f.state.cookieStoreId=undefined;if(scenario==="private")f.state.incognito=true;if(scenario==="private-id")f.state.cookieStoreId="firefox-private";if(scenario==="malformed")f.state.cookieStoreId=["firefox-container-1"];
    for(const method of["eth_accounts","eth_requestAccounts","eth_getBalance","personal_sign"]){const result=await f.request(method,method==="personal_sign"?["0x01",ACCOUNT]:[]).result;assert.equal(result.ok,false)}
    assert.equal(writes,0);assert.equal(f.state.opened.length,0);assert.equal(f.state.unlocks,0);assert.equal(f.state.calls.length,0);
  }
});

test("DApp payload cannot override Firefox browser-owned context",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false});await connectFirefox(f);f.state.cookieStoreId="firefox-container-2";
  for(const forged of[{browserContext:"firefox-container-1"},{cookieStoreId:"firefox-container-1"}])assert.equal((await f.request("eth_accounts",[],Date.now()+5000,forged).result).error.code,"INVALID_BRIDGE_REQUEST");
  assert.deepEqual(Array.from((await f.request("eth_accounts",[]).result).result),[]);
});

test("popup uses actual Firefox container and signer review discloses the bound context",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false});await connectFirefox(f);assert.deepEqual(Array.from((await f.popupRequest("eth_accounts",[])).result),[ACCOUNT]);
  const request=f.request("personal_sign",["0x01",ACCOUNT]);await f.nextWindow();assert.equal((await f.review(request.reviewId)).request.browserContext,"firefox-container-1");await f.decide(request.reviewId,"reject");assert.equal((await request.result).error.code,4001);
  f.state.cookieStoreId="firefox-container-2";assert.deepEqual(Array.from((await f.popupRequest("eth_accounts",[])).result),[]);
});

test("Firefox context changes during account reads, decrypt or final journal readback cannot release identity or broadcast",async t=>{
  for(const stage of["account-read","decrypt","journal-readback"]){const f=await fixture(t,{firefox:true,permitted:false});await connectFirefox(f);
    const changed=()=>{f.state.cookieStoreId="firefox-container-2"};
    if(stage==="account-read"){f.state.afterGet=async keys=>{if(Array.isArray(keys)&&keys.includes(PROVIDER_PERMISSIONS_KEY))changed()};assert.equal((await f.request("eth_accounts",[]).result).error.code,"BROWSER_CONTEXT_CHANGED");continue}
    const request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);await f.nextWindow();
    if(stage==="decrypt")f.state.beforeUnlock=changed;else f.state.afterGet=async keys=>{const key=BROADCAST_JOURNAL_PREFIX+ACCOUNT;if(Array.isArray(keys)&&keys.includes(key)&&f.localState[key]?.status==="broadcasting")changed()};
    await f.decide(request.reviewId);assert.equal((await request.result).error.code,"BROWSER_CONTEXT_CHANGED");assert.equal(f.state.broadcasts,0);assert.equal(f.state.signCalls,stage==="decrypt"?0:1);
  }
});

test("context change after POST retains original raw and ACK while refusing the stale reply",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false});await connectFirefox(f);const request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);await f.nextWindow();
  f.state.broadcastHook=()=>{f.state.cookieStoreId="firefox-container-2"};await f.decide(request.reviewId);assert.equal((await request.result).error.code,"BROWSER_CONTEXT_CHANGED");
  const record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];assert.equal(f.state.broadcasts,1);assert.equal(record.status,"acknowledged");assert.equal(record.unknownHistory,true);assert.equal(record.rawTransaction,f.state.transaction.serialized);
});

const SHARED_EXTERNAL_ID="ynx-aaaaaaaa-1111-4111-8111-111111111111";
test("chosen external request ID is independent across unapproved contexts and remains once within each",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false}),extra={requestId:SHARED_EXTERNAL_ID};
  const first=f.request("personal_sign",["0x01",ACCOUNT],Date.now()+5000,extra);assert.equal((await first.result).error.code,4100);
  f.state.tabId=3;f.state.cookieStoreId="firefox-container-2";const second=f.request("personal_sign",["0x01",ACCOUNT],Date.now()+5000,extra);assert.equal((await second.result).error.code,4100);assert.notEqual(await first.reviewId,await second.reviewId);
  assert.equal((await f.request("personal_sign",["0x01",ACCOUNT],Date.now()+5000,extra).result).error.code,"REQUEST_REPLAYED");
  const restarted=await fixture(t,{firefox:true,browserContext:"firefox-container-2",existingLocal:f.localState,existingSession:f.sessionState});assert.equal((await restarted.request("personal_sign",["0x01",ACCOUNT],Date.now()+5000,extra).result).error.code,"REQUEST_REPLAYED");
  assert.equal(f.state.opened.length,0);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
});

test("two containers can use the same external ID without colliding pending storage, UI locator or cleanup",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false}),extra={requestId:SHARED_EXTERNAL_ID};f.state.contextByTab[1]="firefox-container-1";
  const first=f.request("eth_requestAccounts",[],Date.now()+5000,extra),firstWindow=await f.nextWindow();f.state.tabId=3;f.state.cookieStoreId="firefox-container-2";f.state.contextByTab[3]="firefox-container-2";
  const second=f.request("eth_requestAccounts",[],Date.now()+5000,extra),secondWindow=await f.nextWindow(),a=await first.reviewId,b=await second.reviewId;
  assert.notEqual(a,b);assert.equal(new URL(firstWindow.url).searchParams.get("requestId"),a);assert.equal(new URL(secondWindow.url).searchParams.get("requestId"),b);
  const key=id=>`ynx.wallet.provider.pending.v1.${id}`;assert.equal(f.sessionState[key(a)].requestId,a);assert.equal(f.sessionState[key(b)].requestId,b);
  assert.equal((await f.reviewFrom(a,b)).error.code,"EXTENSION_CALLER_REJECTED");assert.equal((await f.connectDecision(a)).ok,true);assert.equal((await first.result).ok,true);assert.equal(f.sessionState[key(a)],undefined);assert.equal(f.sessionState[key(b)].requestId,b);
  assert.equal((await f.connectDecision(b)).ok,true);assert.equal((await second.result).ok,true);assert.equal(f.sessionState[key(b)],undefined);assert.equal(f.state.events.length,6);
});

test("document/context cancellation during SHA await cannot consume replay, create a review or sign",async t=>{
  for(const mutation of["document","context"]){const f=await fixture(t,{firefox:true,permitted:false});f.state.afterHash=()=>{if(mutation==="document")f.state.tabUpdated(1,{status:"loading"});else f.state.cookieStoreId="firefox-container-2"};
    const result=await f.request("eth_requestAccounts",[]).result;assert.equal(result.error.code,mutation==="document"?"DOCUMENT_CHANGED":"BROWSER_CONTEXT_CHANGED");assert.equal(Object.keys(f.sessionState).length,0);assert.equal(f.state.opened.length,0);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);
  }
});

test("legacy DApp replay barrier is uniform and cannot admit internal IDs on the external bridge",async t=>{
  const f=await fixture(t,{firefox:true,permitted:false});f.sessionState["ynx.extension.sensitive.replay.v1"]=[{requestId:SHARED_EXTERNAL_ID,deadlineAt:Date.now()+5000}];
  for(const externalId of[SHARED_EXTERNAL_ID,"ynx-bbbbbbbb-1111-4111-8111-111111111111"]){const result=await f.request("eth_requestAccounts",[],Date.now()+5000,{requestId:externalId}).result;assert.equal(result.error.code,"REPLAY_SCOPE_MIGRATION_PENDING")}
  assert.equal((await f.request("eth_requestAccounts",[],Date.now()+5000,{requestId:`ynx-scope-v2-${"1".repeat(64)}`}).result).error.code,"INVALID_BRIDGE_REQUEST");assert.equal(f.state.opened.length,0);assert.equal(f.state.signCalls,0);
});

test("actual content bridge returns the original external ID while worker review and replay use the full internal ID",async t=>{
  const f=await fixture(t),content=await readFile(new URL("../extension/content-script.js",import.meta.url),"utf8");let onPageMessage;const responses=[],timers=new Set(),waiters=[];
  const pageWindow={addEventListener:(event,fn)=>{if(event==="message")onPageMessage=fn},postMessage:(message,target)=>{responses.push({message,target});waiters.shift()?.(message)}};
  pageWindow.top=pageWindow;const context=vm.createContext({window:pageWindow,document:{prerendering:false},crypto:webcrypto,location:{origin:ORIGIN},chrome:{runtime:{id:"fixture",sendMessage:message=>f.rawSend(message,{documentId:f.state.documentId,documentLifecycle:"active",frameId:0,url:f.state.url,tab:{id:1,url:f.state.url,incognito:false}}),onMessage:{addListener:listener=>f.state.contentProbe=listener}}},setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timers.add(id);return id},clearTimeout:id=>{clearTimeout(id);timers.delete(id)},Date,Set});vm.runInContext(content,context);t.after(()=>{for(const id of timers)clearTimeout(id)});
  const input={type:"YNX_PAGE_REQUEST_V1",version:1,requestId:SHARED_EXTERNAL_ID,origin:ORIGIN,method:"personal_sign",params:["0x01",ACCOUNT]},nextReply=()=>new Promise(resolve=>waiters.push(resolve));
  const reply=nextReply();onPageMessage({source:pageWindow,origin:ORIGIN,data:input});const window=await f.nextWindow(),internalId=new URL(window.url).searchParams.get("requestId");assert.match(internalId,/^ynx-scope-v2-[0-9a-f]{64}$/u);assert.notEqual(internalId,SHARED_EXTERNAL_ID);await f.decide(internalId);const signed=await reply;
  assert.equal(signed.requestId,SHARED_EXTERNAL_ID);assert.equal(signed.ok,true);assert.equal(verifyMessage(Buffer.from([1]),signed.result).toLowerCase(),ACCOUNT);assert.equal(responses[0].target,ORIGIN);assert.equal(JSON.stringify(signed).includes(internalId),false);
  const repeated=nextReply();onPageMessage({source:pageWindow,origin:ORIGIN,data:input});const denied=await repeated;assert.equal(denied.requestId,SHARED_EXTERNAL_ID);assert.equal(denied.error.code,"REQUEST_REPLAYED");assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,0);
});

async function attachContentDocument(f,t,{firefox=false,queue=false}={}){
  const events={},packets=[],replies=[],timers=new Set(),documentId=f.state.documentId;let receiver;
  const window={addEventListener:(name,fn)=>events[name]=fn,postMessage:message=>replies.push(message)};window.top=window;
  const sender={id:"fixture",frameId:0,url:f.state.url,tab:{id:f.state.tabId,url:f.state.url,incognito:false,cookieStoreId:f.state.cookieStoreId},...(firefox?{}:{documentId,documentLifecycle:"active"})};
  const context=vm.createContext({window,document:{prerendering:false},location:{origin:ORIGIN},crypto:webcrypto,Date,chrome:{runtime:{id:"fixture",sendMessage:message=>{const result=queue?new Promise(()=>{}):f.rawSend(message,sender);packets.push({message,sender,result});return result},onMessage:{addListener:fn=>{receiver=fn;f.state.contentProbe=fn}}}},setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);return timer},clearTimeout:timer=>{clearTimeout(timer);timers.delete(timer)}});
  vm.runInContext(await readFile(new URL("../extension/content-script.js",import.meta.url),"utf8"),context);t.after(()=>{for(const timer of timers)clearTimeout(timer)});
  return{packets,replies,event:name=>events[name](),request:(method,params,requestId=SHARED_EXTERNAL_ID)=>{events.message({source:window,origin:ORIGIN,data:{type:"YNX_PAGE_REQUEST_V1",version:1,requestId,origin:ORIGIN,method,params}});return packets.at(-1)},receive:(message)=>{let response;receiver(message,{id:"fixture"},value=>{response=value});return response}};
}

test("actual old content requests queued after navigation cannot acquire the new document epoch on Chrome or Firefox 140",async t=>{
  for(const firefox of[false,true])await t.test(firefox?"Firefox without documentId":"Chrome document target",async t=>{
    const f=await fixture(t,{firefox}),old=await attachContentDocument(f,t,{firefox,queue:true}),packet=old.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);old.event("pagehide");f.state.tabUpdated(1,{status:"loading"});f.state.documentId="A72F212A00379D284FE8558A23819E2D";
    const current=await attachContentDocument(f,t,{firefox}),result=await f.rawSend(packet.message,packet.sender);assert.equal(result.error.code,"DOCUMENT_CHANGED");assert.equal(f.state.opened.length,0);assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);assert.equal(Object.keys(f.sessionState).length,0);
    assert.equal((await current.request("eth_chainId",[],"ynx-bbbbbbbb-1111-4111-8111-111111111111").result).result,"0x1917");
  });
});

test("legacy injected bridges and browser-reported inactive documents fail before replay or review",async t=>{
  const f=await fixture(t),base={type:RUNTIME_REQUEST,version:1,requestId:SHARED_EXTERNAL_ID,origin:ORIGIN,deadlineAt:Date.now()+5000,method:"eth_requestAccounts",params:[]},sender={documentId:f.state.documentId,frameId:0,url:f.state.url,tab:{id:1,url:f.state.url,incognito:false}};
  assert.equal((await f.rawSend(base,sender)).error.code,"DOCUMENT_BRIDGE_RELOAD_REQUIRED");
  for(const documentLifecycle of["cached","pending_deletion","prerender"]){const result=await f.rawSend({...base,documentNonce:f.state.documentNonce},{...sender,documentLifecycle});assert.equal(result.error.code,"DOCUMENT_CHANGED")}
  assert.equal(f.state.probes,0);assert.equal(f.state.opened.length,0);assert.equal(Object.keys(f.sessionState).length,0);
});

test("actual worker accepts browser-specific IDs and rejects missing or invented Chrome UUIDs before review",async t=>{
  const f=await fixture(t),base={type:RUNTIME_REQUEST,version:1,requestId:SHARED_EXTERNAL_ID,origin:ORIGIN,deadlineAt:Date.now()+5000,method:"eth_requestAccounts",params:[],documentNonce:f.state.documentNonce},sender={frameId:0,url:f.state.url,tab:{id:1,url:f.state.url,incognito:false}};
  for(const documentId of[undefined,"","0".repeat(32),"11111111-1111-4111-8111-111111111111",f.state.documentId+"0"]){const result=await f.rawSend(base,{...sender,documentId});assert.equal(result.error.code,"DOCUMENT_CHANGED")}
  assert.equal(f.state.probes,0);assert.equal(f.state.opened.length,0);assert.equal(f.state.unlocks,0);
  assert.equal((await f.request("eth_chainId",[]).result).result,"0x1917");
  f.state.documentId=undefined;assert.equal((await f.popupRequest("eth_chainId",[])).error.code,"DOCUMENT_CHANGED");
  const ff=await fixture(t,{firefox:true});
  assert.equal((await ff.request("eth_chainId",[]).result).result,"0x1917");
  const ffSender={frameId:0,url:ff.state.url,tab:{id:1,url:ff.state.url,incognito:false,cookieStoreId:ff.state.cookieStoreId},documentId:"11111111-2222-3333-4444-555555555555"};ff.state.documentId=ffSender.documentId;
  assert.equal((await ff.rawSend({...base,method:"eth_chainId"},ffSender)).result,"0x1917");
  assert.equal((await ff.rawSend(base,{...ffSender,documentId:"FF2F212A00379D284FE8558A23819E2D"})).error.code,"DOCUMENT_CHANGED");
});

test("real content activation changes during review reject before decrypt even without a navigation event",async t=>{
  const f=await fixture(t),content=await attachContentDocument(f,t),packet=content.request("personal_sign",["0x01",ACCOUNT]);const window=await f.nextWindow(),id=new URL(window.url).searchParams.get("requestId");content.event("pagehide");content.event("pageshow");
  assert.equal((await f.decide(id)).error.code,"DOCUMENT_CHANGED");assert.equal((await packet.result).error.code,"DOCUMENT_CHANGED");assert.equal(f.state.unlocks,0);assert.equal(f.state.signCalls,0);assert.equal(content.replies.length,0);
});

test("the final content probe after durable raw readback blocks POST but preserves the signed outbox",async t=>{
  const f=await fixture(t),request=f.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);await f.nextWindow();
  f.state.beforeProbe=()=>{if(f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT]?.status==="broadcasting")f.state.documentNonce="b".repeat(64)};await f.decide(request.reviewId);assert.equal((await request.result).error.code,"DOCUMENT_CHANGED");assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,0);const record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];assert.match(record.rawTransaction,/^0x/);assert.equal(record.status,"cancelled");assert.equal(record.resolution.kind,"cancelled-before-dispatch");assert.equal(record.unknownHistory,false);
});

test("navigation after POST keeps exact raw and ACK while the actual departing content suppresses its old reply",async t=>{
  const f=await fixture(t),content=await attachContentDocument(f,t),packet=content.request("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n)}]);const window=await f.nextWindow(),id=new URL(window.url).searchParams.get("requestId");
  f.state.broadcastHook=()=>{content.event("pagehide");f.state.tabUpdated(1,{status:"loading"})};await f.decide(id);assert.equal((await packet.result).error.code,"DOCUMENT_CHANGED");await new Promise(resolve=>setImmediate(resolve));
  const record=f.localState[BROADCAST_JOURNAL_PREFIX+ACCOUNT];assert.equal(f.state.broadcasts,1);assert.equal(record.status,"acknowledged");assert.equal(record.rawTransaction,f.state.transaction.serialized);assert.equal(content.replies.length,0);
});
