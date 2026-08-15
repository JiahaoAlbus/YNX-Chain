import {BRIDGE_VERSION,PROVIDER_EVENTS,REQUEST_METHODS,RUNTIME_EVENT,RUNTIME_REQUEST,publicBridgeError,validateRuntimeRequest} from "./extension-bridge.js";
import {YNX_CHAIN_ID,YNX_RPC_URL,verifyExtensionRpc} from "./extension-rpc.js";
import {CORE_WALLET_AUTH_BINDING} from "./core-auth-binding.js";
import {requireCanonicalAuthorizationContext} from "./core-auth-consumer.js";
import {consumeSensitiveRequest,parseSensitiveRequest,validateSensitiveResult} from "./extension-sensitive-policy.js";
import {activeTabInjectionPlans,requireActiveDappTab} from "./active-tab-policy.js";
import {runExtensionMigration} from "./extension-migration.js";

const extensionApi=globalThis.browser||globalThis.chrome,CHAIN_ID=YNX_CHAIN_ID;
const migrationPromise=runExtensionMigration(extensionApi,{alarmsDeclared:false}).then(report=>({ok:true,report}),error=>({ok:false,error}));
async function requireMigrationReady(){const state=await migrationPromise;if(!state.ok)throw Object.assign(new Error("Extension upgrade cleanup is incomplete; wallet access remains disabled."),{code:"MIGRATION_INCOMPLETE",cause:state.error});return state.report}
const YNX_CHAIN=Object.freeze({chainId:CHAIN_ID,chainName:"YNX Testnet",nativeCurrency:Object.freeze({name:"YNX Testnet",symbol:"YNXT",decimals:18}),rpcUrls:Object.freeze([YNX_RPC_URL]),blockExplorerUrls:Object.freeze(["https://explorer.ynxweb4.com"])});

function pageWalletRequest(preference,input){
  const ethereum=globalThis.ethereum;
  const providers=(Array.isArray(ethereum?.providers)?ethereum.providers:ethereum?[ethereum]:[]).filter((provider)=>provider?.__ynxCompanion!==true);
  const isYNX=(provider)=>{const rdns=String(provider?.providerInfo?.rdns||provider?.rdns||"").toLowerCase();return provider?.isYNXWallet===true||provider?.isYnxWallet===true||rdns==="com.ynx.wallet"||rdns.endsWith(".ynxweb4.com")};
  const ynx=providers.find(isYNX),metamask=providers.find((provider)=>provider?.isMetaMask===true&&!isYNX(provider));
  if(input?.method==="ynx_walletDetected")return{ynx:Boolean(ynx),metamask:Boolean(metamask)};
  const provider=preference==="ynx"?ynx:preference==="metamask"?metamask:ynx||metamask||providers[0];
  if(!provider||typeof provider.request!=="function")throw Object.assign(new Error("No real wallet backend is injected into the DApp."),{code:"WALLET_BACKEND_NOT_FOUND"});
  return provider.request(input);
}
globalThis.__YNX_INTERNAL_PAGE_WALLET_REQUEST__=pageWalletRequest;

async function liveChainId(){
  return (await verifyExtensionRpc()).chainId;
}
function exactMutationInput(method,params){
  const expected=method==="wallet_addEthereumChain"?[YNX_CHAIN]:[{chainId:CHAIN_ID}];
  if(JSON.stringify(params)!==JSON.stringify(expected))throw Object.assign(new Error("Rejected non-canonical YNX Testnet chain parameters."),{code:"INVALID_CHAIN_PARAMS"});
}
function requireLiveDeadline(deadlineAt){if(!Number.isSafeInteger(deadlineAt)||Date.now()>=deadlineAt)throw Object.assign(new Error("Wallet bridge request expired before mutation."),{code:"BRIDGE_EXPIRED"})}
async function executeInTab(tabId,origin,preference,input){
  const tab=await extensionApi.tabs.get(tabId);
  if(!Number.isInteger(tab?.id)||new URL(tab.url).origin!==origin)throw Object.assign(new Error("The requesting DApp origin changed."),{code:"ORIGIN_CHANGED"});
  const[execution]=await extensionApi.scripting.executeScript({target:{tabId},world:"MAIN",func:pageWalletRequest,args:[preference,input]});return await execution?.result;
}
async function ensureActiveTabBridge(){
  const[tab]=await extensionApi.tabs.query({active:true,currentWindow:true});
  const context=requireActiveDappTab(tab);
  try{
    for(const plan of activeTabInjectionPlans(context.tabId))await extensionApi.scripting.executeScript(plan);
  }catch(error){throw Object.assign(new Error("The DApp bridge requires a current user-granted activeTab permission."),{code:"ACTIVE_TAB_REQUIRED",cause:error})}
  return context;
}
async function executeActive(preference,input){
  const{tabId,origin}=await ensureActiveTabBridge();
  return executeInTab(tabId,origin,preference,input);
}
async function emitToTab(tabId,origin,event,payload){if(PROVIDER_EVENTS.includes(event))await extensionApi.tabs.sendMessage(tabId,{type:RUNTIME_EVENT,version:BRIDGE_VERSION,origin,event,payload}).catch(()=>{})}
function exactAccounts(value){if(!Array.isArray(value)||value.some((account)=>!/^0x[0-9a-fA-F]{40}$/u.test(account)))throw Object.assign(new Error("Wallet backend returned invalid accounts."),{code:"INVALID_ACCOUNT"});return value.map((account)=>account.toLowerCase())}
async function handleDappRequest(message,sender){
  const senderUrl=sender?.url||sender?.tab?.url;
  if(!Number.isInteger(sender?.tab?.id)||sender?.frameId!==0||!validateRuntimeRequest(message,senderUrl))throw Object.assign(new Error("Rejected invalid DApp bridge request."),{code:"INVALID_BRIDGE_REQUEST"});
  const tabId=sender.tab.id,origin=message.origin,input={method:message.method,params:message.params};
  const sensitive=parseSensitiveRequest(message);
  if(sensitive){await consumeSensitiveRequest(extensionApi.storage?.session,message);requireCanonicalAuthorizationContext(CORE_WALLET_AUTH_BINDING,null)}
  if(message.method==="eth_chainId")return liveChainId();
  if(message.method==="ynx_disconnect"){await emitToTab(tabId,origin,"accountsChanged",[]);await emitToTab(tabId,origin,"disconnect",{code:4900,message:"YNX Wallet companion disconnected."});return null}
  if(message.method==="wallet_addEthereumChain"||message.method==="wallet_switchEthereumChain"){
    exactMutationInput(message.method,message.params);await liveChainId();requireLiveDeadline(message.deadlineAt);
  }
  let result;
  try{result=await executeInTab(tabId,origin,"any",input)}catch(error){if(message.method==="eth_accounts"&&error?.code==="WALLET_BACKEND_NOT_FOUND")return[];throw error}
  if(message.method==="wallet_addEthereumChain")await executeInTab(tabId,origin,"any",{method:"wallet_switchEthereumChain",params:[{chainId:CHAIN_ID}]});
  if(message.method==="wallet_addEthereumChain"||message.method==="wallet_switchEthereumChain"){
    const backendChain=await executeInTab(tabId,origin,"any",{method:"eth_chainId"});
    if(backendChain!==CHAIN_ID)throw Object.assign(new Error("Wallet backend remained on the wrong chain."),{code:"WRONG_NETWORK"});await emitToTab(tabId,origin,"chainChanged",CHAIN_ID);
  }
  if(message.method==="eth_requestAccounts"||message.method==="eth_accounts"){result=exactAccounts(result);if(message.method==="eth_requestAccounts")await emitToTab(tabId,origin,"accountsChanged",result)}
  return sensitive?validateSensitiveResult(message.method,result):result;
}

extensionApi.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="YNX_WALLET_DISCOVER"){requireMigrationReady().then(()=>executeActive("any",{method:"ynx_walletDetected"})).then((result)=>sendResponse(result||{ynx:false,metamask:false})).catch((error)=>sendResponse({ynx:false,metamask:false,error:publicBridgeError(error)}));return true}
  if(message?.type==="YNX_WALLET_REQUEST"){
    if(!REQUEST_METHODS.includes(message.input?.method)){sendResponse({ok:false,error:{code:4200,message:"Unsupported wallet method."}});return false}
    requireMigrationReady().then(()=>executeActive(message.preference,message.input)).then((result)=>sendResponse({ok:true,result})).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
  }
  if(message?.type!==RUNTIME_REQUEST)return false;
  requireMigrationReady().then(()=>handleDappRequest(message,sender)).then((result)=>sendResponse({ok:true,result})).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
});
