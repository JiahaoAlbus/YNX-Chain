import {BRIDGE_VERSION,PROVIDER_EVENTS,REQUEST_METHODS,RUNTIME_EVENT,RUNTIME_REQUEST,publicBridgeError,validateRuntimeRequest} from "./extension-bridge.js";
import {READ_ONLY_RPC_METHODS,YNX_CHAIN_ID,broadcastExtensionTransaction,forwardExtensionRpc} from "./extension-rpc.js";
import {consumeSensitiveRequest,parseSensitiveRequest,validateSensitiveResult} from "./extension-sensitive-policy.js";
import {activeTabInjectionPlans,requireActiveDappTab} from "./active-tab-policy.js";
import {runExtensionMigration} from "./extension-migration.js";
import {PROVIDER_ACCOUNT_KEY,PROVIDER_PENDING_PREFIX,PROVIDER_PERMISSIONS_KEY,createPendingApproval,eip2255Permissions,grantPermission,loadProviderState,parseApprovalDecision,parsePermissionStore,parseProviderAccount,revokePermission} from "./extension-provider-permissions.js";
import {EXTENSION_VAULT_KEY,parseEncryptedVault,providerAccountFromVault,unlockEncryptedVault} from "./extension-vault.js";
import {signExtensionRequest} from "./extension-signer.js";

const extensionApi=globalThis.browser||globalThis.chrome,CHAIN_ID=YNX_CHAIN_ID;
const approvalWaiters=new Map();
const signerWaiters=new Map();
const migrationPromise=runExtensionMigration(extensionApi,{alarmsDeclared:false}).then(report=>({ok:true,report}),error=>({ok:false,error}));
async function requireMigrationReady(){const state=await migrationPromise;if(!state.ok)throw Object.assign(new Error("Extension upgrade cleanup is incomplete; wallet access remains disabled."),{code:"MIGRATION_INCOMPLETE",cause:state.error});return state.report}
const YNX_CHAIN=Object.freeze({chainId:CHAIN_ID,chainName:"YNX Testnet",nativeCurrency:Object.freeze({name:"YNX Testnet",symbol:"YNXT",decimals:18}),rpcUrls:Object.freeze(["https://evm.ynxweb4.com"]),blockExplorerUrls:Object.freeze(["https://explorer.ynxweb4.com"])});

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

async function configuredAccount(){const stored=await extensionApi.storage.local.get([PROVIDER_ACCOUNT_KEY,EXTENSION_VAULT_KEY]),account=parseProviderAccount(stored?.[PROVIDER_ACCOUNT_KEY]),vaultAccount=providerAccountFromVault(stored?.[EXTENSION_VAULT_KEY]);if(account.account!==vaultAccount.account)throw Object.assign(new Error("Provider account does not match the encrypted Wallet vault."),{code:"PROVIDER_ACCOUNT_UNAVAILABLE"});return account}
function requireExtensionPage(sender,page){let actual,expected;try{actual=new URL(sender?.url);expected=new URL(extensionApi.runtime.getURL(page))}catch{throw Object.assign(new Error("Extension page identity is invalid."),{code:"EXTENSION_CALLER_REJECTED"})}if(sender?.id!==extensionApi.runtime.id||actual.origin!==expected.origin||actual.pathname!==expected.pathname)throw Object.assign(new Error("Rejected message from outside the expected extension page."),{code:"EXTENSION_CALLER_REJECTED"})}
function requireVaultPage(sender){requireExtensionPage(sender,"vault.html")}
async function vaultStatus(){const stored=await extensionApi.storage.local.get(EXTENSION_VAULT_KEY);if(stored?.[EXTENSION_VAULT_KEY]===undefined)return{configured:false};const vault=parseEncryptedVault(stored[EXTENSION_VAULT_KEY]);return{configured:true,account:vault.account,createdAt:vault.createdAt}}
async function storeVault(vaultValue){const vault=parseEncryptedVault(vaultValue),account=providerAccountFromVault(vault);for(const waiter of approvalWaiters.values())waiter.reject(Object.assign(new Error("Wallet account changed during approval."),{code:"PROVIDER_ACCOUNT_CHANGED"}));approvalWaiters.clear();await extensionApi.storage.local.set({[EXTENSION_VAULT_KEY]:vault,[PROVIDER_ACCOUNT_KEY]:account,[PROVIDER_PERMISSIONS_KEY]:{}});return account}
async function removeVault(){await extensionApi.storage.local.remove([EXTENSION_VAULT_KEY,PROVIDER_ACCOUNT_KEY,PROVIDER_PERMISSIONS_KEY]);return true}
async function approvedState(origin){
  try{return await loadProviderState(extensionApi.storage.local,origin)}catch(error){if(error?.code==="PROVIDER_ACCOUNT_UNAVAILABLE")return null;throw error}
}
async function persistPermission(origin,account){
  const stored=await extensionApi.storage.local.get(PROVIDER_PERMISSIONS_KEY),next=grantPermission(stored?.[PROVIDER_PERMISSIONS_KEY],origin,account);await extensionApi.storage.local.set({[PROVIDER_PERMISSIONS_KEY]:next});return next[origin]
}
async function removePermission(origin){
  const stored=await extensionApi.storage.local.get(PROVIDER_PERMISSIONS_KEY),next=revokePermission(stored?.[PROVIDER_PERMISSIONS_KEY],origin);await extensionApi.storage.local.set({[PROVIDER_PERMISSIONS_KEY]:next});return next
}
function approvalKey(requestId){return `${PROVIDER_PENDING_PREFIX}${requestId}`}
async function cleanupApproval(requestId,windowId){approvalWaiters.delete(requestId);await extensionApi.storage.session.remove(approvalKey(requestId)).catch(()=>{});if(Number.isInteger(windowId))await extensionApi.windows.remove(windowId).catch(()=>{})}
async function requestAccountApproval(tabId,origin,requestId,deadlineAt){
  const existing=await approvedState(origin);if(existing?.permission)return[existing.permission.account];
  const account=await configuredAccount(),pending=createPendingApproval({requestId,origin,tabId,account,deadlineAt});
  await extensionApi.storage.session.set({[approvalKey(requestId)]:pending});
  let windowId=null,timer;
  const decision=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("Wallet connection approval expired."),{code:"APPROVAL_EXPIRED"})),Math.max(1,deadlineAt-Date.now()));approvalWaiters.set(requestId,{resolve,reject,pending,get windowId(){return windowId}})});
  try{const created=await extensionApi.windows.create({url:extensionApi.runtime.getURL(`approval.html?requestId=${encodeURIComponent(requestId)}`),type:"popup",width:420,height:640,focused:true});windowId=created?.id;const approved=await decision;if(!approved)throw Object.assign(new Error("User rejected the wallet connection."),{code:4001});const permission=await persistPermission(origin,account);await emitToTab(tabId,origin,"connect",{chainId:CHAIN_ID});await emitToTab(tabId,origin,"accountsChanged",[permission.account]);await emitToTab(tabId,origin,"chainChanged",CHAIN_ID);return[permission.account]}
  finally{clearTimeout(timer);await cleanupApproval(requestId,windowId)}
}
function signerKey(requestId){return `ynx.wallet.provider.signer.v1.${requestId}`}
function signerSummary(method,params){if(method==="personal_sign")return`Message ${params[0].slice(0,256)}${params[0].length>256?"…":""}`;if(method==="eth_signTypedData_v4"){const value=JSON.parse(params[1]);return JSON.stringify({primaryType:value.primaryType,domain:value.domain,message:value.message}).slice(0,2048)}return JSON.stringify(params[0])}
async function cleanupSigner(requestId,windowId){signerWaiters.delete(requestId);await extensionApi.storage.session.remove(signerKey(requestId)).catch(()=>{});if(Number.isInteger(windowId))await extensionApi.windows.remove(windowId).catch(()=>{})}
async function requestSignerReview(tabId,origin,requestId,deadlineAt,method,params,account){
  const pending=Object.freeze({version:1,requestId,origin,tabId,account,chainId:CHAIN_ID,method,summary:signerSummary(method,params),deadlineAt});await extensionApi.storage.session.set({[signerKey(requestId)]:pending});let windowId=null,timer;
  const decision=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("Wallet signature review expired."),{code:"SIGNER_REVIEW_EXPIRED"})),Math.max(1,deadlineAt-Date.now()));signerWaiters.set(requestId,{resolve,reject,pending,get windowId(){return windowId}})});
  try{const created=await extensionApi.windows.create({url:extensionApi.runtime.getURL(`signer.html?requestId=${encodeURIComponent(requestId)}`),type:"popup",width:440,height:720,focused:true});windowId=created?.id;const result=await decision;if(result.decision!=="approve")throw Object.assign(new Error("User rejected the wallet request."),{code:4001});return result.password}
  finally{clearTimeout(timer);await cleanupSigner(requestId,windowId)}
}
function exactPermissionParams(method,params){
  const request=Array.isArray(params)&&params.length===1?params[0]:null;
  if(!request||typeof request!=="object"||Array.isArray(request)||Object.keys(request).join(",")!=="eth_accounts"||typeof request.eth_accounts!=="object"||request.eth_accounts===null||Array.isArray(request.eth_accounts)||Object.keys(request.eth_accounts).length!==0)throw Object.assign(new Error(`${method} accepts only eth_accounts.`),{code:-32602});
}
async function handleProviderMethod({tabId,origin,requestId,deadlineAt,method,params}){
  if(method==="eth_chainId")return CHAIN_ID;
  if(method==="net_version")return String(Number.parseInt(CHAIN_ID,16));
  if(READ_ONLY_RPC_METHODS.includes(method))return forwardExtensionRpc(method,params);
  if(method==="eth_accounts"){const state=await approvedState(origin);return state?.permission?[state.permission.account]:[]}
  if(method==="eth_requestAccounts")return requestAccountApproval(tabId,origin,requestId,deadlineAt);
  if(method==="wallet_getPermissions"){const state=await approvedState(origin);return eip2255Permissions(state?.permission||null)}
  if(method==="wallet_requestPermissions"){exactPermissionParams(method,params);const accounts=await requestAccountApproval(tabId,origin,requestId,deadlineAt);const state=await approvedState(origin);if(state?.permission?.account!==accounts[0])throw Object.assign(new Error("Wallet permission did not persist."),{code:"PERMISSION_NOT_PERSISTED"});return eip2255Permissions(state.permission)}
  if(method==="wallet_revokePermissions"||method==="ynx_disconnect"){
    if(method==="wallet_revokePermissions")exactPermissionParams(method,params);await removePermission(origin);await emitToTab(tabId,origin,"accountsChanged",[]);await emitToTab(tabId,origin,"disconnect",{code:4900,message:"YNX Wallet disconnected from this site."});return null
  }
  if(method==="wallet_addEthereumChain"||method==="wallet_switchEthereumChain"){
    exactMutationInput(method,params);requireLiveDeadline(deadlineAt);await emitToTab(tabId,origin,"chainChanged",CHAIN_ID);return null
  }
  if(["personal_sign","eth_signTypedData_v4","eth_sendTransaction"].includes(method)){
    const state=await approvedState(origin);if(!state?.permission)throw Object.assign(new Error("This site is not approved for the YNX Wallet account."),{code:4100});
    const sensitive=parseSensitiveRequest({requestId,deadlineAt,method,params});if(sensitive?.expectedAccount!==state.permission.account)throw Object.assign(new Error("Sensitive request account does not match the approved account."),{code:4100});
    const password=await requestSignerReview(tabId,origin,requestId,deadlineAt,method,params,state.permission.account),stored=await extensionApi.storage.local.get(EXTENSION_VAULT_KEY),unlocked=await unlockEncryptedVault(stored?.[EXTENSION_VAULT_KEY],password),result=await signExtensionRequest({secretHex:unlocked.secretHex,expectedAccount:state.permission.account,method,params,rpc:(rpcMethod,rpcParams)=>forwardExtensionRpc(rpcMethod,rpcParams)});
    if(method!=="eth_sendTransaction")return result;const broadcast=await broadcastExtensionTransaction(result.rawTransaction);if(broadcast!==result.transactionHash)throw Object.assign(new Error("Broadcast hash does not match the reviewed signed transaction."),{code:"TRANSACTION_HASH_MISMATCH"});return broadcast;
  }
  throw Object.assign(new Error("Unsupported wallet method."),{code:4200});
}
async function handleDappRequest(message,sender){
  const senderUrl=sender?.url||sender?.tab?.url;
  if(!Number.isInteger(sender?.tab?.id)||sender?.frameId!==0||!validateRuntimeRequest(message,senderUrl))throw Object.assign(new Error("Rejected invalid DApp bridge request."),{code:"INVALID_BRIDGE_REQUEST"});
  const tabId=sender.tab.id,origin=message.origin;
  const sensitive=parseSensitiveRequest(message);
  if(sensitive)await consumeSensitiveRequest(extensionApi.storage?.session,message);
  const result=await handleProviderMethod({tabId,origin,requestId:message.requestId,deadlineAt:message.deadlineAt,method:message.method,params:message.params});
  return sensitive?validateSensitiveResult(message.method,result):result;
}

async function activeProviderRequest(preference,input){
  const context=await ensureActiveTabBridge();
  if(preference==="metamask")return executeInTab(context.tabId,context.origin,"metamask",input);
  const requestId=`ynx-${crypto.randomUUID()}`,deadlineAt=Date.now()+120000,message={requestId,deadlineAt,method:input.method,params:input.params};
  if(parseSensitiveRequest(message))await consumeSensitiveRequest(extensionApi.storage?.session,message);return handleProviderMethod({tabId:context.tabId,origin:context.origin,...message});
}

extensionApi.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="YNX_VAULT_STATUS_V1"||message?.type==="YNX_VAULT_STORE_V1"||message?.type==="YNX_VAULT_REMOVE_V1"){
    Promise.resolve().then(()=>requireVaultPage(sender)).then(async()=>{
      if(message.type==="YNX_VAULT_STATUS_V1")return vaultStatus();
      if(message.type==="YNX_VAULT_STORE_V1")return{account:(await storeVault(message.vault)).account};
      await removeVault();return{removed:true};
    }).then(result=>sendResponse({ok:true,...result})).catch(error=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
  }
  if(message?.type==="YNX_SIGNER_GET_V1"||message?.type==="YNX_SIGNER_DECIDE_V1"){
    Promise.resolve().then(()=>requireExtensionPage(sender,"signer.html")).then(async()=>{const stored=await extensionApi.storage.session.get(signerKey(message.requestId)),pending=stored?.[signerKey(message.requestId)],waiter=signerWaiters.get(message.requestId);if(!pending||pending.deadlineAt<=Date.now()||pending.requestId!==message.requestId)throw Object.assign(new Error("Signer request is unavailable."),{code:"SIGNER_REQUEST_UNAVAILABLE"});if(message.type==="YNX_SIGNER_GET_V1")return{request:pending};if(!waiter)throw Object.assign(new Error("Signer request no longer has an active DApp caller."),{code:"SIGNER_REQUEST_ORPHANED"});if(!["approve","reject"].includes(message.decision)||message.decision==="approve"&&(typeof message.password!=="string"||message.password.length<12||message.password.length>256))throw Object.assign(new Error("Signer decision is invalid."),{code:"INVALID_SIGNER_DECISION"});waiter.resolve({decision:message.decision,password:message.decision==="approve"?message.password:null});return{decided:true}}).then(result=>sendResponse({ok:true,...result})).catch(error=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
  }
  if(message?.type==="YNX_PROVIDER_APPROVAL_GET_V1"){
    Promise.resolve().then(()=>requireExtensionPage(sender,"approval.html")).then(()=>extensionApi.storage.session.get(approvalKey(message.requestId))).then((stored)=>{const request=stored?.[approvalKey(message.requestId)];if(!request||request.deadlineAt<=Date.now())throw Object.assign(new Error("Approval request is unavailable."),{code:"APPROVAL_REQUEST_UNAVAILABLE"});sendResponse({ok:true,request})}).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true
  }
  if(message?.type==="YNX_PROVIDER_APPROVAL_DECIDE_V1"){
    Promise.resolve().then(()=>requireExtensionPage(sender,"approval.html")).then(()=>extensionApi.storage.session.get(approvalKey(message.requestId))).then((stored)=>{const pending=stored?.[approvalKey(message.requestId)],decision=parseApprovalDecision({requestId:message.requestId,decision:message.decision},pending),waiter=approvalWaiters.get(message.requestId);if(!waiter)throw Object.assign(new Error("Approval request no longer has an active DApp caller."),{code:"APPROVAL_REQUEST_ORPHANED"});waiter.resolve(decision.approved);sendResponse({ok:true})}).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true
  }
  if(message?.type==="YNX_WALLET_DISCOVER"){requireMigrationReady().then(()=>executeActive("any",{method:"ynx_walletDetected"})).then((result)=>sendResponse({ynx:true,metamask:Boolean(result?.metamask)})).catch((error)=>sendResponse({ynx:true,metamask:false,error:publicBridgeError(error)}));return true}
  if(message?.type==="YNX_WALLET_REQUEST"){
    if(!REQUEST_METHODS.includes(message.input?.method)){sendResponse({ok:false,error:{code:4200,message:"Unsupported wallet method."}});return false}
    requireMigrationReady().then(()=>activeProviderRequest(message.preference,message.input)).then((result)=>sendResponse({ok:true,result})).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
  }
  if(message?.type!==RUNTIME_REQUEST)return false;
  requireMigrationReady().then(()=>handleDappRequest(message,sender)).then((result)=>sendResponse({ok:true,result})).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
});
