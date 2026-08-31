import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {BRIDGE_VERSION,PAGE_REQUEST,REQUEST_METHODS,REQUEST_TIMEOUT_MS,RUNTIME_REQUEST,publicBridgeError,validHttpOrigin,validatePageRequest,validateRuntimeRequest} from "../src/extension-bridge.js";

const REQUEST_ID="ynx-11111111-1111-4111-8111-111111111111";
const valid={type:PAGE_REQUEST,version:BRIDGE_VERSION,requestId:REQUEST_ID,origin:"https://dapp.example",method:"eth_chainId",params:[]};

test("page bridge accepts only exact HTTP(S) origin, request id, method and params",()=>{
  assert.equal(validatePageRequest(valid,"https://dapp.example"),true);
  for(const invalid of [{...valid,origin:"https://evil.example"},{...valid,requestId:"guessable"},{...valid,method:"eth_sign"},{...valid,params:{}},{...valid,extra:true}])assert.equal(validatePageRequest(invalid,"https://dapp.example"),false);
  assert.equal(validHttpOrigin("file:///tmp/dapp.html"),false);assert.equal(REQUEST_TIMEOUT_MS,120000);
});

test("runtime bridge binds the content-script request to the sender origin",()=>{
  const runtime={...valid,type:RUNTIME_REQUEST,deadlineAt:Date.now()+REQUEST_TIMEOUT_MS};
  assert.equal(validateRuntimeRequest(runtime,"https://dapp.example/path"),true);
  assert.equal(validateRuntimeRequest(runtime,"https://evil.example/path"),false);
  assert.equal(validateRuntimeRequest(runtime,"chrome-extension://id/page"),false);
  assert.equal(validateRuntimeRequest({...runtime,deadlineAt:Date.now()-1},"https://dapp.example/path"),false);
});

test("bridge allowlist includes permissions, lifecycle, signing and bounded read RPC but no arbitrary RPC",()=>{
  for(const method of ["eth_chainId","eth_accounts","eth_requestAccounts","wallet_getPermissions","wallet_requestPermissions","wallet_addEthereumChain","wallet_switchEthereumChain","wallet_revokePermissions","personal_sign","eth_signTypedData_v4","eth_sendTransaction","eth_getBalance","eth_call","ynx_disconnect"])assert.equal(REQUEST_METHODS.includes(method),true);
  for(const method of ["eth_sign","debug_traceTransaction","wallet_importRawKey"])assert.equal(REQUEST_METHODS.includes(method),false);
  assert.deepEqual(publicBridgeError({code:4001,message:"User rejected"}),{code:4001,message:"User rejected"});
});

test("content and page scripts enforce source, origin, timeout, duplicate-id and companion exclusion guards",async()=>{
  const[content,page,worker]=await Promise.all([readFile(new URL("../extension/content-script.js",import.meta.url),"utf8"),readFile(new URL("../extension/page-provider.js",import.meta.url),"utf8"),readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8")]);
  assert.match(content,/event\.source!==window\|\|event\.origin!==targetOrigin/);assert.match(content,/pending\.has\(data\.requestId\)/);assert.match(content,/BRIDGE_TIMEOUT/);assert.match(content,/deadlineAt:Date\.now\(\)\+TIMEOUT_MS/);
  assert.match(content,/__YNX_CONTENT_BRIDGE_V1__/);assert.doesNotMatch(content,/web_accessible_resources|runtime\.getURL/);
  assert.match(page,/event\.source!==window\|\|event\.origin!==expectedOrigin/);assert.match(page,/crypto\.randomUUID\(\)/);assert.match(page,/__ynxCompanion:true/);assert.match(page,/__YNX_COMPANION_PROVIDER_V1__/);assert.match(page,/name:"YNX Wallet"/);assert.match(page,/rdns:"com\.ynx\.wallet"/);assert.match(page,/isMetaMask:false/);
  assert.match(page,/eip6963:requestProvider/);assert.match(page,/eip6963:announceProvider/);assert.match(page,/queueMicrotask\(announce\)/);assert.match(page,/const announcement=Object\.freeze/);
  assert.match(worker,/provider\?\.__ynxCompanion!==true/);assert.match(worker,/requestAccountApproval\(tabId,origin,requestId,deadlineAt\)/);assert.match(worker,/PROVIDER_ACCOUNT_UNAVAILABLE/);assert.match(worker,/forwardExtensionRpc\(method,params\)/);
  assert.match(worker,/requireVaultPage\(sender\)/);assert.match(worker,/providerAccountFromVault\(vault\)/);assert.match(worker,/account\.account!==vaultAccount\.account/);assert.match(worker,/\[PROVIDER_PERMISSIONS_KEY\]:\{\}/);
  assert.doesNotMatch(worker,/executeInTab\(tabId,origin,"any",input\)/);assert.doesNotMatch(worker,/requireCanonicalAuthorizationContext/);
});
