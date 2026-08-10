import {
  canonicalJSON, createGatewayChallenge, createProductDeviceIdentity, createProductSessionProof,
  encodeBase64url, encodeProductSessionProofHeader, encodeRequestDeepLink, httpBodyDigest,
  parseCallbackURL, parseCentralWalletSession, requestDigest, signGatewayChallenge, verifyAuthorization,
} from "../vendor/wallet-auth/src/index.js";

const CALLBACK = "https://quant.ynxweb4.com/wallet-auth/callback";
const INSTALL_URL = "https://ynxweb4.com/ecosystem?product=wallet";
const PRODUCT = Object.freeze({version:"1",chainId:"ynx_6423-1",requestingProduct:"quant",productClientId:"ynx-quant-v1",bundleId:"com.ynxweb4.quant",productDeviceAlgorithm:"p256-sha256",callback:CALLBACK,scopes:Object.freeze(["quant:account","quant:mandate:create","quant:mandate:execute","quant:mandate:revoke"])});
const DB_NAME = "ynx-quant-wallet-v1", STORE = "auth";
let current = null;

window.YNXQuantWallet = Object.freeze({requireProof,connect:beginAuthorization});
window.addEventListener("DOMContentLoaded",boot,{once:true});

async function boot(){
  document.querySelector("#connect-wallet")?.addEventListener("click",()=>beginAuthorization().catch(showError));
  document.querySelector("#install-wallet")?.setAttribute("href",INSTALL_URL);
  try{
    if(location.pathname===new URL(CALLBACK).pathname&&new URL(location.href).searchParams.has("response"))await finishAuthorization();
    else await restore();
  }catch(error){await clearSession();showError(error)}
  render();
}
async function beginAuthorization(){
  const savedDevice=await read("device"),device=savedDevice??createProductDeviceIdentity();await write("device",device);
  const issuedAt=new Date(),authorizationRequest=Object.freeze({...PRODUCT,nonce:nonce(),productDeviceKey:device.productDeviceKey,purpose:"Connect YNX Wallet to bounded Quant Testnet research and execution",issuedAt:issuedAt.toISOString(),expiresAt:new Date(issuedAt.getTime()+300_000).toISOString()});
  await write("pendingRequest",authorizationRequest);location.href=encodeRequestDeepLink(authorizationRequest);
}
async function finishAuthorization(){
  const[authorizationRequest,device]=await Promise.all([read("pendingRequest"),read("device")]);
  if(!authorizationRequest||!device)throw new Error("This Wallet callback is not bound to a pending Quant login on this device.");
  const response=parseCallbackURL(location.href,CALLBACK),walletApproval=verifyAuthorization(response,{...authorizationRequest,requestDigest:requestDigest(authorizationRequest),now:new Date()}),now=new Date(),challengeExpiry=new Date(Math.min(now.getTime()+60_000,Date.parse(walletApproval.expiresAt))),challenge=createGatewayChallenge(walletApproval,{challenge:nonce(),expiresAt:challengeExpiry.toISOString()},now),gatewayCompletion=signGatewayChallenge(challenge,device.productDeviceSecret);
  const tenant=localStorage.getItem("ynx.quant.tenant.v1");
  if(!/^[0-9a-f]{64}$/.test(tenant??""))throw new Error("The Quant browser tenant binding is unavailable.");
  const result=await fetch("/api/v1/wallet/sessions/complete",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","X-YNX-Preview-Mode":"local-paper","X-YNX-Tenant-ID":tenant},body:canonicalJSON({authorizationRequest,walletApproval,gatewayCompletion})}),envelope=await result.json().catch(()=>null);
  if(!result.ok||!envelope?.ok||!envelope.result)throw new Error(`Wallet session completion failed closed (${result.status}).`);
  const session=parseCentralWalletSession(envelope.result);
  if(session.productClientId!==PRODUCT.productClientId||session.bundleId!==PRODUCT.bundleId||session.productDeviceKey!==device.productDeviceKey)throw new Error("Wallet returned a session for another product or device.");
  current=Object.freeze({session,device});await Promise.all([write("session",session),remove("pendingRequest")]);history.replaceState({},"","/");
}
async function restore(){
  const[sessionInput,device]=await Promise.all([read("session"),read("device")]);if(!sessionInput||!device)return;
  const session=parseCentralWalletSession(sessionInput);if(session.expiresAt<=new Date().toISOString()||session.productDeviceKey!==device.productDeviceKey){await clearSession();return}current=Object.freeze({session,device});
}
async function requireProof(scope){
  if(!current)await restore();if(!current)throw new Error("Connect YNX Wallet before using bounded Testnet execution. Research and Paper remain available without login.");
  if(!PRODUCT.scopes.includes(scope)||!current.session.scopes.includes(scope))throw new Error("The Wallet session does not grant the required Quant scope.");
  const issuedAt=new Date();if(current.session.expiresAt<=issuedAt.toISOString()){await clearSession();render();throw new Error("The Wallet session expired. Connect again to continue.")}
  const introspectionBody=canonicalJSON({requiredScopes:[scope]}),proof=createProductSessionProof(current.session,{method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest:httpBodyDigest(introspectionBody),nonce:nonce(),issuedAt:issuedAt.toISOString(),expiresAt:new Date(Math.min(issuedAt.getTime()+30_000,Date.parse(current.session.expiresAt))).toISOString()},current.device.productDeviceSecret);
  return encodeProductSessionProofHeader(proof);
}
function render(){
  const status=document.querySelector("#wallet-status"),button=document.querySelector("#connect-wallet");if(status)status.textContent=current?`Connected ${short(current.session.account)}`:"Wallet not connected — Research and Paper are still available";if(button)button.textContent=current?"Reconnect Wallet":"Connect YNX Wallet";const account=document.querySelector("#mandate-account");if(current&&account&&!account.value)account.value=current.session.account;
}
async function clearSession(){current=null;await remove("session")}
function nonce(){return encodeBase64url(crypto.getRandomValues(new Uint8Array(24)))}
function short(account){return`${account.slice(0,10)}…${account.slice(-6)}`}
function showError(error){const status=document.querySelector("#wallet-status");if(status)status.textContent=error instanceof Error?error.message:"Wallet connection failed closed."}
function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function transaction(mode,action){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=action(tx.objectStore(STORE));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
function read(key){return transaction("readonly",store=>store.get(key))}function write(key,value){return transaction("readwrite",store=>store.put(value,key))}function remove(key){return transaction("readwrite",store=>store.delete(key))}
