import {
  canonicalJSON,
  createGatewayChallenge,
  createProductDeviceIdentity,
  createProductSessionProof,
  decodeBase64url,
  encodeExchangeOrderActionDeepLink,
  encodeProductSessionProofHeader,
  encodeRequestDeepLink,
  httpBodyDigest,
  parseCallbackURL,
  parseCentralWalletSession,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
  verifyExchangeOrderActionResponse,
} from "../../../packages/wallet-auth/src/index.js";

const PRODUCT=Object.freeze({version:"1",chainId:"ynx_6423-1",requestingProduct:"exchange",productClientId:"ynx-exchange-v1",bundleId:"com.ynxweb4.exchange",productDeviceAlgorithm:"p256-sha256",callback:"https://exchange.ynxweb4.com/wallet-auth/callback",scopes:Object.freeze(["exchange:ai","exchange:deposit","exchange:read","exchange:trade","exchange:withdrawal-review"])});
const ACTION_CALLBACK="https://exchange.ynxweb4.com/wallet-action/callback",INSTALL_URL="https://www.ynxweb4.com/downloads/ynx-wallet-1.0.1-testnet-preview-dc31c9a8-test-signed.apk",DB_NAME="ynx-exchange-wallet-v1",STORE="auth";
const EVM_CHAIN=Object.freeze({chainId:"0x1917",chainName:"YNX Testnet",nativeCurrency:Object.freeze({name:"YNX Testnet",symbol:"YNXT",decimals:18}),rpcUrls:Object.freeze(["https://rpc.ynxweb4.com/"]),blockExplorerUrls:Object.freeze(["https://explorer.ynxweb4.com/"])});
let current=null,lastAction=null,evmAccount=null;

const ready=initialize();
window.YNXExchangeWallet=Object.freeze({ready,connect:beginAuthorization,connected:()=>!!current,session:()=>current?.session??null,requireProof,placeSpotOrder:parameters=>beginTradingAction("exchange.order.place",parameters),cancelSpotOrder:(orderId,idempotencyKey)=>beginTradingAction("exchange.order.cancel",{orderId,idempotencyKey}),transferMargin:parameters=>beginTradingAction("exchange.margin.transfer",parameters),placePerpetualOrder:parameters=>beginTradingAction("exchange.perpetual.order.place",parameters),cancelPerpetualOrder:(orderId,idempotencyKey)=>beginTradingAction("exchange.perpetual.order.cancel",{orderId,idempotencyKey}),consumeActionResult:()=>{const value=lastAction;lastAction=null;return value}});

async function initialize(){
  try{
    const url=new URL(location.href);
    if(url.pathname===new URL(ACTION_CALLBACK).pathname&&url.searchParams.has("response")){lastAction=await finishSpotOrder(url);await restore();history.replaceState({},"","/#market")}
    else if(url.pathname===new URL(PRODUCT.callback).pathname&&url.searchParams.has("response")){await finishAuthorization(url);history.replaceState({},"","/")}
    else await restore();
  }catch(error){await clearSession();show(error)}
  render();
}

async function beginAuthorization(){
  const saved=await read("device"),device=saved??createProductDeviceIdentity();
  await write("device",device);
  const now=new Date(),authorizationRequest=Object.freeze({...PRODUCT,nonce:nonce(),productDeviceKey:device.productDeviceKey,purpose:"Connect this account to YNX Exchange Testnet for owned balances, exact Wallet-reviewed orders, margin and account controls. Exchange never receives recovery material.",issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString()});
  await write("pendingRequest",authorizationRequest);
  location.href=encodeRequestDeepLink(authorizationRequest);
}

async function connectMetaMask(){
  const provider=window.ethereum;if(!provider?.request)throw new Error("MetaMask was not detected. Download YNX Wallet or install MetaMask, then retry.");
  try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:EVM_CHAIN.chainId}]})}catch(error){if(error?.code!==4902)throw error;await provider.request({method:"wallet_addEthereumChain",params:[EVM_CHAIN]});await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:EVM_CHAIN.chainId}]})}
  if(await provider.request({method:"eth_chainId"})!==EVM_CHAIN.chainId)throw new Error("MetaMask did not switch to YNX Testnet (chain 6423).");
  const accounts=await provider.request({method:"eth_requestAccounts"});if(!Array.isArray(accounts)||!/^0x[0-9a-fA-F]{40}$/.test(accounts[0]||""))throw new Error("MetaMask did not return a valid EVM account.");
  evmAccount=accounts[0].toLowerCase();render();
}

async function finishAuthorization(url){
  const[authorizationRequest,device]=await Promise.all([read("pendingRequest"),read("device")]);
  if(!authorizationRequest||!device)throw new Error("This Wallet callback has no matching Exchange request on this device.");
  const now=new Date(),walletApproval=verifyAuthorization(parseCallbackURL(url.toString(),PRODUCT.callback),{...authorizationRequest,requestDigest:requestDigest(authorizationRequest),now}),challenge=createGatewayChallenge(walletApproval,{challenge:nonce(),expiresAt:new Date(Math.min(now.getTime()+60_000,Date.parse(walletApproval.expiresAt))).toISOString()},now),gatewayCompletion=signGatewayChallenge(challenge,device.productDeviceSecret);
  const response=await fetch("/wallet-gateway/v1/wallet/sessions/complete",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},credentials:"omit",body:canonicalJSON({authorizationRequest,walletApproval,gatewayCompletion})}),envelope=await response.json().catch(()=>null);
  if(!response.ok||!envelope?.ok||!envelope.result)throw new Error(envelope?.error?.message||`Wallet session completion failed closed (${response.status}).`);
  const session=parseCentralWalletSession(envelope.result);
  if(session.productClientId!==PRODUCT.productClientId||session.bundleId!==PRODUCT.bundleId||session.callback!==PRODUCT.callback||session.productDeviceKey!==device.productDeviceKey)throw new Error("Wallet returned a session for another product, callback or device.");
  current=Object.freeze({session,device});await Promise.all([write("session",session),remove("pendingRequest")]);
}

async function restore(){
  const[sessionInput,device]=await Promise.all([read("session"),read("device")]);if(!sessionInput||!device)return;
  const session=parseCentralWalletSession(sessionInput);if(session.expiresAt<=new Date().toISOString()||session.productDeviceKey!==device.productDeviceKey){await clearSession();return}current=Object.freeze({session,device});
}

async function requireProof(scope){
  if(!current)await restore();if(!current)throw new Error("Connect YNX Wallet before using this private Exchange action.");
  if(!PRODUCT.scopes.includes(scope)||!current.session.scopes.includes(scope))throw new Error(`Wallet session does not grant ${scope}.`);
  const now=new Date();if(current.session.expiresAt<=now.toISOString()){await clearSession();render();throw new Error("Wallet session expired. Connect again.")}
  const body=canonicalJSON({requiredScopes:[scope]}),proof=createProductSessionProof(current.session,{method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest:httpBodyDigest(body),nonce:nonce(),issuedAt:now.toISOString(),expiresAt:new Date(Math.min(now.getTime()+30_000,Date.parse(current.session.expiresAt))).toISOString()},current.device.productDeviceSecret);
  return encodeProductSessionProofHeader(proof);
}

async function beginTradingAction(action,parameters){
  if(!current)await restore();if(!current)throw new Error("Connect YNX Wallet before reviewing an order.");
  const now=new Date(),request=Object.freeze({version:"1",chainId:"ynx_6423-1",productClientId:PRODUCT.productClientId,bundleId:PRODUCT.bundleId,callback:ACTION_CALLBACK,sessionBinding:current.session.sessionBinding,account:current.session.account,action,parameters:Object.freeze({...parameters}),nonce:nonce(),issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString()});
  await write("pendingAction",request);location.href=encodeExchangeOrderActionDeepLink(request);
}

async function finishSpotOrder(url){
  const request=await read("pendingAction");if(!request)throw new Error("This Wallet callback has no matching reviewed Exchange order on this device.");
  const encoded=url.searchParams.get("response");if(!encoded)throw new Error("Wallet order response is missing.");
  let input;try{input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64url(encoded,"Exchange order response")))}catch{throw new Error("Wallet order response encoding is invalid.")}
  const verified=verifyExchangeOrderActionResponse(input,request,new Date()),proof=await requireProof("exchange:trade"),route=actionRoute(verified),response=await fetch(route.path,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","X-YNX-Product-Session-Proof":proof},body:canonicalJSON({...route.body,walletSignature:verified.walletSignature})}),result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||`Exchange rejected the Wallet-signed order (${response.status}).`);
  await remove("pendingAction");return Object.freeze({kind:verified.action,record:result});
}

function actionRoute(action){const p=action.parameters;switch(action.action){case"exchange.order.place":return{path:"/api/v1/orders",body:p};case"exchange.order.cancel":return{path:`/api/v1/orders/${encodeURIComponent(p.orderId)}/cancel`,body:{idempotencyKey:p.idempotencyKey}};case"exchange.margin.transfer":return{path:"/api/v1/margin/transfer",body:p};case"exchange.perpetual.order.place":return{path:"/api/v1/perpetual/orders",body:p};case"exchange.perpetual.order.cancel":return{path:`/api/v1/perpetual/orders/${encodeURIComponent(p.orderId)}/cancel`,body:{idempotencyKey:p.idempotencyKey}};default:throw new Error("Unsupported Exchange action callback.")}}

function render(){const status=document.querySelector("#wallet-state"),button=document.querySelector("#wallet-request"),metamask=document.querySelector("#metamask-request"),connect=document.querySelector("#connect"),install=document.querySelector(".install-link");if(install)install.href=INSTALL_URL;if(button){button.disabled=false;button.textContent=current?"Reconnect YNX Wallet":"Continue in YNX Wallet";button.onclick=()=>beginAuthorization().catch(show)}if(metamask){metamask.disabled=false;metamask.textContent=evmAccount?`MetaMask ${short(evmAccount)}`:"Connect MetaMask";metamask.onclick=()=>connectMetaMask().catch(show)}if(status)status.textContent=current?`YNX Wallet ${short(current.session.account)} · expires ${new Date(current.session.expiresAt).toLocaleTimeString()}`:evmAccount?`MetaMask ${short(evmAccount)} is connected only for EVM compatibility. Exchange balances and orders still require YNX Wallet.`:"Public market data remains available. Choose YNX Wallet for balances and reviewed actions, or MetaMask for EVM compatibility.";if(connect&&current)connect.textContent=short(current.session.account)}
async function clearSession(){current=null;await remove("session")}
function show(error){const message=error instanceof Error?error.message:"Wallet operation failed closed.";const status=document.querySelector("#wallet-state");if(status)status.textContent=message;window.dispatchEvent(new CustomEvent("ynx-exchange-wallet-error",{detail:message}))}
function short(account){return`${account.slice(0,10)}…${account.slice(-6)}`}
function nonce(){let binary="";for(const byte of crypto.getRandomValues(new Uint8Array(24)))binary+=String.fromCharCode(byte);return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")}
function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function transaction(mode,action){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=action(tx.objectStore(STORE));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
function read(key){return transaction("readonly",store=>store.get(key))}function write(key,value){return transaction("readwrite",store=>store.put(value,key))}function remove(key){return transaction("readwrite",store=>store.delete(key))}
