export const PROVIDER_ACCOUNT_KEY="ynx.wallet.provider.account.v1";
export const PROVIDER_PERMISSIONS_KEY="ynx.wallet.provider.permissions.v1";
export const PROVIDER_PENDING_PREFIX="ynx.wallet.provider.pending.v1.";
export const PROVIDER_PERMISSION_VERSION=1;
export const PROVIDER_CHAIN_ID="0x1917";

const ADDRESS=/^0x[0-9a-fA-F]{40}$/u;
const REQUEST_ID=/^ynx-scope-v2-[0-9a-f]{64}$/u;
function fail(code,message){throw Object.assign(new Error(message),{code})}
function record(value){return typeof value==="object"&&value!==null&&!Array.isArray(value)}
export function isProviderInternalRequestId(value){return typeof value==="string"&&REQUEST_ID.test(value)}

export function canonicalProviderContext(value="chromium-default"){
  if(typeof value!=="string"||value!=="chromium-default"&&value!=="firefox-default"&&!/^firefox-container-[1-9][0-9]{0,15}$/u.test(value))fail("BROWSER_CONTEXT_UNAVAILABLE","The browser context cannot be verified.");
  return value;
}
// This input comes only from browser-owned sender.tab / tabs.get, never the DApp.
export function providerContextForTab(tab,{firefox=false}={}){
  if(tab?.incognito===true||tab?.cookieStoreId==="firefox-private")fail("PRIVATE_BROWSING_UNAVAILABLE","YNX Wallet is unavailable in private browsing.");
  if(tab?.incognito!==false)fail("BROWSER_CONTEXT_UNAVAILABLE","The browser privacy context cannot be verified.");
  if(firefox){const context=canonicalProviderContext(tab.cookieStoreId??null);if(!context.startsWith("firefox-"))fail("BROWSER_CONTEXT_UNAVAILABLE","The Firefox container cannot be verified.");return context}
  if(tab.cookieStoreId!==undefined)fail("BROWSER_CONTEXT_UNAVAILABLE","Unexpected browser container identity.");
  return "chromium-default";
}
export function providerPermissionKey(origin,context="chromium-default"){
  const exact=canonicalProviderOrigin(origin),scope=canonicalProviderContext(context);
  return scope==="chromium-default"?exact:JSON.stringify([scope,exact]);
}
export function providerContextLabel(context){
  const scope=canonicalProviderContext(context);return scope==="chromium-default"?"Normal browser context":scope==="firefox-default"?"Firefox default context":`Firefox container · ${scope}`;
}

export function canonicalProviderOrigin(value){
  let url;try{url=new URL(value)}catch{fail("INVALID_PROVIDER_ORIGIN","Wallet permission origin is invalid.")}
  if(!["http:","https:"].includes(url.protocol)||url.origin!==value)fail("INVALID_PROVIDER_ORIGIN","Wallet permission requires an exact HTTP(S) origin.");
  return url.origin;
}

export function parseProviderAccount(value){
  if(!record(value)||Object.keys(value).sort().join(",")!=="account,source,version"||value.version!==1||value.source!=="ynx-wallet-vault"||!ADDRESS.test(value.account||""))fail("PROVIDER_ACCOUNT_UNAVAILABLE","A real YNX Wallet account is not available in this extension.");
  return Object.freeze({version:1,source:"ynx-wallet-vault",account:value.account.toLowerCase()});
}

// The encrypted vault is the account authority. Older installs may have a vault
// but no separate provider index; recover that index without reusing site grants.
export async function recoverMissingProviderAccount(storage,vaultAccountKey,vaultKey,accountFromVault,{readOnly=false}={}){
  const unavailable=(status,message)=>{throw Object.assign(new Error(message),{code:"PROVIDER_ACCOUNT_UNAVAILABLE",data:{status}})};
  let values;
  try{values=await storage.get([vaultAccountKey,vaultKey,PROVIDER_PERMISSIONS_KEY])}
  catch{unavailable("account_storage_unavailable","Wallet storage could not be read. Retry in the existing browser profile; do not clear or replace Wallet data.")}
  if(!record(values))unavailable("account_storage_unavailable","Wallet storage could not be verified. Retry without clearing Wallet data.");
  const indexed=values?.[vaultAccountKey];
  if(values?.[vaultKey]===undefined)unavailable("account_vault_missing","This extension profile has no encrypted Wallet vault. Open your existing Wallet; do not overwrite an account in another profile.");
  let vaultAccount;
  try{vaultAccount=parseProviderAccount(accountFromVault(values[vaultKey]))}
  catch{unavailable("account_vault_invalid","The existing encrypted Wallet vault could not be verified. Preserve the profile and use the Wallet recovery controls.")}
  if(indexed!==undefined){
    let account;
    try{account=parseProviderAccount(indexed)}catch{unavailable("account_index_invalid","The provider account index is invalid. Preserve Wallet data and open the existing account manager.")}
    if(account.account!==vaultAccount.account)unavailable("account_index_mismatch","The provider account index does not match the encrypted Wallet vault. Preserve both records and open the existing account manager.");
    return account;
  }
  if(readOnly)return null;
  try{await storage.set({[vaultAccountKey]:vaultAccount,[PROVIDER_PERMISSIONS_KEY]:{}})}
  catch{unavailable("account_recovery_write_failed","The recovered account index could not be saved. Retry without clearing or replacing the encrypted vault.")}
  let confirmed;
  try{confirmed=await storage.get([vaultAccountKey,vaultKey,PROVIDER_PERMISSIONS_KEY])}
  catch{unavailable("account_recovery_write_failed","The recovered account index could not be confirmed. Retry without clearing Wallet data.")}
  try{
    if(parseProviderAccount(confirmed?.[vaultAccountKey]).account!==vaultAccount.account||parseProviderAccount(accountFromVault(confirmed?.[vaultKey])).account!==vaultAccount.account||Object.keys(parsePermissionStore(confirmed?.[PROVIDER_PERMISSIONS_KEY])).length!==0)throw new Error("Recovery readback mismatch");
  }catch{unavailable("account_recovery_write_failed","The recovered account index could not be confirmed. Keep the existing vault and retry.")}
  return vaultAccount;
}

export function parsePermissionStore(value){
  if(value===undefined)return Object.freeze({});
  if(!record(value))fail("PERMISSION_STORE_TAMPERED","Wallet permission storage is invalid.");
  const output={};
  for(const [key,item] of Object.entries(value)){
    if(!record(item))fail("PERMISSION_STORE_TAMPERED","Wallet permission storage is invalid.");
    const scoped=item.version===2,context=scoped?canonicalProviderContext(item.browserContext):"chromium-default",exact=canonicalProviderOrigin(item.origin);
    if(Object.keys(item).sort().join(",")!==(scoped?"account,browserContext,chainId,grantedAt,origin,version":"account,chainId,grantedAt,origin,version")||!scoped&&item.version!==PROVIDER_PERMISSION_VERSION||scoped&&context==="chromium-default"||key!==providerPermissionKey(exact,context)||item.chainId!==PROVIDER_CHAIN_ID||!ADDRESS.test(item.account||"")||!Number.isSafeInteger(item.grantedAt)||item.grantedAt<0)fail("PERMISSION_STORE_TAMPERED","Wallet permission storage is invalid.");
    output[key]=Object.freeze({...item,account:item.account.toLowerCase()});
  }
  return Object.freeze(output);
}

export function permissionForOrigin(storeValue,origin,accountValue,context="chromium-default"){
  // V1 has no container provenance. Only Chromium may reuse its old permission.
  const key=providerPermissionKey(origin,context),account=parseProviderAccount(accountValue),permission=parsePermissionStore(storeValue)[key];
  return permission?.account===account.account?permission:null;
}

export function grantPermission(storeValue,origin,accountValue,now=Date.now(),context="chromium-default"){
  if(!Number.isSafeInteger(now)||now<0)fail("INVALID_PERMISSION_TIME","Wallet permission time is invalid.");
  const exact=canonicalProviderOrigin(origin),scope=canonicalProviderContext(context),key=providerPermissionKey(exact,scope),account=parseProviderAccount(accountValue),current=parsePermissionStore(storeValue);
  return Object.freeze({...current,[key]:Object.freeze({version:scope==="chromium-default"?1:2,...(scope==="chromium-default"?{}:{browserContext:scope}),origin:exact,account:account.account,chainId:PROVIDER_CHAIN_ID,grantedAt:now})});
}

export function revokePermission(storeValue,origin,context="chromium-default"){
  const key=providerPermissionKey(origin,context),current=parsePermissionStore(storeValue),next={...current};delete next[key];return Object.freeze(next);
}

export function createPendingApproval(input,now=Date.now()){
  if(!record(input)||!isProviderInternalRequestId(input.requestId)||!Number.isInteger(input.tabId)||input.tabId<0||!Number.isSafeInteger(input.deadlineAt)||input.deadlineAt<=now||input.deadlineAt>now+120000)fail("INVALID_APPROVAL_REQUEST","Wallet approval request is invalid.");
  const account=parseProviderAccount(input.account),origin=canonicalProviderOrigin(input.origin);
  return Object.freeze({version:1,requestId:input.requestId,origin,tabId:input.tabId,browserContext:canonicalProviderContext(input.browserContext),account:account.account,chainId:PROVIDER_CHAIN_ID,createdAt:now,deadlineAt:input.deadlineAt});
}

export function parseApprovalDecision(input,pending,now=Date.now()){
  if(!record(input)||!record(pending)||input.requestId!==pending.requestId||!isProviderInternalRequestId(input.requestId)||!Number.isSafeInteger(pending.deadlineAt)||pending.deadlineAt<=now||!["approve","reject"].includes(input.decision)||Object.keys(input).sort().join(",")!=="decision,requestId")fail("INVALID_APPROVAL_DECISION","Wallet approval decision is invalid or expired.");
  return Object.freeze({requestId:input.requestId,approved:input.decision==="approve"});
}

export async function loadProviderState(storage,origin,context="chromium-default"){
  if(!storage||typeof storage.get!=="function")fail("PROVIDER_STORAGE_UNAVAILABLE","Wallet provider storage is unavailable.");
  const values=await storage.get([PROVIDER_ACCOUNT_KEY,PROVIDER_PERMISSIONS_KEY]),account=parseProviderAccount(values?.[PROVIDER_ACCOUNT_KEY]),permissions=parsePermissionStore(values?.[PROVIDER_PERMISSIONS_KEY]);
  return Object.freeze({account,permissions,permission:permissionForOrigin(permissions,canonicalProviderOrigin(origin),account,context)});
}

export function eip2255Permissions(permission){
  if(!permission)return Object.freeze([]);
  return Object.freeze([Object.freeze({parentCapability:"eth_accounts",caveats:Object.freeze([Object.freeze({type:"restrictReturnedAccounts",value:Object.freeze([permission.account])})])})]);
}
