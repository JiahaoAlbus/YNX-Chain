import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import vm from "node:vm";
import {DURABILITY_MODEL} from "../src/extension-durability.js";
import {NATIVE_FEE_MODEL,readFeeModel,readNativeBalance} from "../src/extension-fee-model.js";
import {forwardExtensionRpc,broadcastExtensionTransaction} from "../src/extension-rpc.js";
import {publicBridgeError,validateRuntimeRequest} from "../src/extension-bridge.js";
import {createExtensionProvider} from "../src/provider.js";

const ACCOUNT=`0x${"1".repeat(40)}`,HASH=`0x${"a".repeat(64)}`;

test("chain and exact fee-model fields are mandatory and changing balance units fail closed",async()=>{
  for(const patch of[{enabled:undefined},{chainId:"0x1"},{gas:"0x5208"},{gasPrice:"0x1"},{version:"unknown"},{feeWei:"0x1"},{scope:"full EVM"},{eip1559:true}])await assert.rejects(readFeeModel(async method=>method==="eth_chainId"?"0x1917":{...NATIVE_FEE_MODEL,enabled:true,...patch}),{code:"RPC_CAPABILITY_UNAVAILABLE"});
  await assert.rejects(readFeeModel(async()=>"0x1"),{code:"WRONG_NETWORK"});
  let calls=0;await assert.rejects(readNativeBalance(async method=>({eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:++calls<4},eth_getBalance:"0x64"})[method],[ACCOUNT,"latest"]),{code:"RPC_CAPABILITY_CHANGED"});
});

test("actual page/content/runtime/RPC bridge accepts fee discovery and retains Core uncertainty data",async()=>{
  const listeners=new Map(),origin="https://fixture.example",data={status:"transaction_durability_uncertain",transactionHash:HASH,durabilityVersion:DURABILITY_MODEL.version,ynxDurability:{version:DURABILITY_MODEL.version,scope:"local-snapshot",status:"uncertain",transactionHash:HASH}};
  const memory={...data,status:"transaction_durability_unavailable",ynxDurability:{...data.ynxDurability,status:"memory_only"}};
  const projection={status:"native_block_projection_unsupported",blockNumber:"0x2",blockHash:HASH,feeEquivalentGas:"0x1c9c381",projectionGasLimit:"0x1c9c380",gasSemantics:"native fixed-fee accounting; no EVM block gas scheduling",nativeBlockPath:"/blocks/2"};
  const fetcher=async(_url,options)=>{const{method}=JSON.parse(options.body);return{ok:true,redirected:false,url:"https://evm.ynxweb4.com/",json:async()=>({jsonrpc:"2.0",id:6423,...(method==="eth_sendRawTransaction"?{error:{code:-32002,message:"transaction durability needs confirmation",data}}:method==="eth_getBlockByNumber"?{error:{code:-32004,message:"native projection unavailable",data:projection}}:method==="eth_getTransactionReceipt"?{error:{code:-32004,message:"durability unavailable",data:memory}}:{result:method==="eth_chainId"?"0x1917":method==="ynx_getDurabilityModel"?DURABILITY_MODEL:method==="ynx_getTransactionDurability"?data.ynxDurability:{...NATIVE_FEE_MODEL,enabled:true}})})}};
  const runtime={onMessage:{addListener(){}},async sendMessage(message){assert.equal(validateRuntimeRequest(message,origin+"/"),true);try{return{ok:true,result:message.method==="eth_sendTransaction"?await broadcastExtensionTransaction("0x01",fetcher):await forwardExtensionRpc(message.method,message.params,fetcher)}}catch(error){return{ok:false,error:publicBridgeError(error)}}}};
  const window={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)},postMessage(data){queueMicrotask(()=>window.dispatchEvent({type:"message",data,source:window,origin}))}};
  window.top=window;const context=vm.createContext({window,document:{prerendering:false},location:{origin,protocol:"https:"},crypto:webcrypto,chrome:{runtime},setTimeout,clearTimeout,queueMicrotask,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}});
  for(const file of["content-script.js","page-provider.js"])vm.runInContext(await readFile(new URL(`../extension/${file}`,import.meta.url),"utf8"),context);
  const provider=context.__YNX_COMPANION_PROVIDER_V1__;
  assert.equal((await provider.request({method:"ynx_getFeeModel",params:[]})).scope,NATIVE_FEE_MODEL.scope);
  assert.equal(JSON.stringify(await provider.request({method:"ynx_getDurabilityModel",params:[]})),JSON.stringify(DURABILITY_MODEL));
  assert.equal(JSON.stringify(await provider.request({method:"ynx_getTransactionDurability",params:[HASH]})),JSON.stringify(data.ynxDurability));
  await assert.rejects(provider.request({method:"eth_getTransactionReceipt",params:[HASH]}),error=>error.code===-32004&&JSON.stringify(error.data)===JSON.stringify(memory));
  await assert.rejects(provider.request({method:"eth_sendTransaction",params:[{from:ACCOUNT}]}),error=>error.code===-32002&&error.data.transactionHash===HASH&&error.data.status===data.status&&JSON.stringify(error.data.ynxDurability)===JSON.stringify(data.ynxDurability));
  await assert.rejects(provider.request({method:"eth_getBlockByNumber",params:["0x2",false]}),error=>error.code===-32004&&JSON.stringify(error.data)===JSON.stringify(publicBridgeError({code:-32004,data:projection}).data));
  assert.deepEqual(publicBridgeError({code:-32004,data:projection}).data,projection);
  const extensionProvider=createExtensionProvider("ynx",{sendMessage:async()=>({ok:false,error:publicBridgeError({code:-32002,message:"uncertain",data:{...data,rawTransaction:"never expose"}})})});
  await assert.rejects(extensionProvider.request({method:"eth_sendTransaction"}),error=>error.code===-32002&&error.data.transactionHash===HASH&&!Object.hasOwn(error.data,"rawTransaction"));
});
