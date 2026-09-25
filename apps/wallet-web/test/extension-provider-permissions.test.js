import assert from "node:assert/strict";
import test from "node:test";
import {PROVIDER_ACCOUNT_KEY,PROVIDER_CHAIN_ID,PROVIDER_PERMISSIONS_KEY,canonicalProviderOrigin,createPendingApproval,eip2255Permissions,grantPermission,loadProviderState,parseApprovalDecision,parsePermissionStore,permissionForOrigin,recoverMissingProviderAccount,revokePermission} from "../src/extension-provider-permissions.js";
import {EXTENSION_VAULT_KEY,createEncryptedVault,providerAccountFromVault,unlockEncryptedVault} from "../src/extension-vault.js";

const ACCOUNT={version:1,source:"ynx-wallet-vault",account:"0x1111111111111111111111111111111111111111"},ORIGIN="https://dapp.example",REQUEST=`ynx-scope-v2-${"1".repeat(64)}`;

test("missing provider index recovers from the existing vault and drops old DApp grants",async()=>{
  const vaultKey="ynx.wallet.provider.vault.v1",values={[vaultKey]:{account:ACCOUNT.account},[PROVIDER_PERMISSIONS_KEY]:grantPermission({},ORIGIN,ACCOUNT,1)};
  const storage={get:async()=>({...values}),set:async update=>Object.assign(values,update)};
  const fromVault=value=>{if(!value?.account)throw new Error("invalid vault");return ACCOUNT};
  assert.deepEqual(await recoverMissingProviderAccount(storage,PROVIDER_ACCOUNT_KEY,vaultKey,fromVault),ACCOUNT);
  assert.deepEqual(values[PROVIDER_PERMISSIONS_KEY],{});
  assert.deepEqual(await recoverMissingProviderAccount(storage,PROVIDER_ACCOUNT_KEY,vaultKey,fromVault),ACCOUNT);
  assert.equal(values[PROVIDER_ACCOUNT_KEY].account,ACCOUNT.account);
  values[PROVIDER_ACCOUNT_KEY]={...ACCOUNT,account:"0x2222222222222222222222222222222222222222"};
  await assert.rejects(()=>recoverMissingProviderAccount(storage,PROVIDER_ACCOUNT_KEY,vaultKey,fromVault),error=>error.code==="PROVIDER_ACCOUNT_UNAVAILABLE");
  delete values[vaultKey];
  await assert.rejects(()=>recoverMissingProviderAccount(storage,PROVIDER_ACCOUNT_KEY,vaultKey,fromVault),error=>error.code==="PROVIDER_ACCOUNT_UNAVAILABLE");
});

test("existing encrypted vault survives provider-index recovery and still unlocks",async()=>{
  const vault=await createEncryptedVault({password:"safe-test-password-123",secretHex:"0".repeat(63)+"1"});
  const values={[EXTENSION_VAULT_KEY]:vault,[PROVIDER_PERMISSIONS_KEY]:{}};
  const storage={get:async()=>({...values}),set:async update=>Object.assign(values,update)};
  const recovered=await recoverMissingProviderAccount(storage,PROVIDER_ACCOUNT_KEY,EXTENSION_VAULT_KEY,providerAccountFromVault);
  assert.equal(recovered.account,vault.account);
  assert.deepEqual(values[EXTENSION_VAULT_KEY],vault);
  assert.equal((await unlockEncryptedVault(values[EXTENSION_VAULT_KEY],"safe-test-password-123")).account,recovered.account);
});

test("provider permission is exact-origin, exact-account and persistent until revoke",async()=>{
  const granted=grantPermission(undefined,ORIGIN,ACCOUNT,1000);
  assert.equal(permissionForOrigin(granted,ORIGIN,ACCOUNT)?.chainId,PROVIDER_CHAIN_ID);
  assert.equal(permissionForOrigin(granted,"https://other.example",ACCOUNT),null);
  assert.deepEqual(eip2255Permissions(granted[ORIGIN]),[{parentCapability:"eth_accounts",caveats:[{type:"restrictReturnedAccounts",value:[ACCOUNT.account]}]}]);
  assert.deepEqual(revokePermission(granted,ORIGIN),{});
  const storage={get:async()=>({[PROVIDER_ACCOUNT_KEY]:ACCOUNT,[PROVIDER_PERMISSIONS_KEY]:granted})};
  assert.equal((await loadProviderState(storage,ORIGIN)).permission.account,ACCOUNT.account);
});

test("permission/account tamper and non-http origins fail closed",()=>{
  for(const value of ["https://dapp.example/path","file:///tmp/dapp", "chrome-extension://id"])assert.throws(()=>canonicalProviderOrigin(value),error=>error.code==="INVALID_PROVIDER_ORIGIN");
  assert.throws(()=>parsePermissionStore({[ORIGIN]:{version:1,origin:ORIGIN,account:ACCOUNT.account,chainId:"0x1",grantedAt:1}}),error=>error.code==="PERMISSION_STORE_TAMPERED");
  assert.throws(()=>permissionForOrigin({},ORIGIN,{...ACCOUNT,source:"metamask"}),error=>error.code==="PROVIDER_ACCOUNT_UNAVAILABLE");
});

test("approval decision binds request, origin, tab, account and deadline",()=>{
  const pending=createPendingApproval({requestId:REQUEST,origin:ORIGIN,tabId:7,account:ACCOUNT,deadlineAt:2000},1000);
  assert.deepEqual(parseApprovalDecision({requestId:REQUEST,decision:"approve"},pending,1500),{requestId:REQUEST,approved:true});
  assert.deepEqual(parseApprovalDecision({requestId:REQUEST,decision:"reject"},pending,1500),{requestId:REQUEST,approved:false});
  assert.throws(()=>parseApprovalDecision({requestId:REQUEST,decision:"approve"},pending,2000),error=>error.code==="INVALID_APPROVAL_DECISION");
  assert.throws(()=>createPendingApproval({requestId:REQUEST,origin:"https://evil.example/path",tabId:7,account:ACCOUNT,deadlineAt:2000},1000));
});

test("Firefox context permissions coexist but never inherit unscoped legacy or another context",()=>{
  const legacy=grantPermission({},ORIGIN,ACCOUNT,1),a="firefox-container-1",b="firefox-container-2";
  for(const context of["firefox-default",a,b])assert.equal(permissionForOrigin(legacy,ORIGIN,ACCOUNT,context),null);
  const all=grantPermission(grantPermission(legacy,ORIGIN,ACCOUNT,2,a),ORIGIN,ACCOUNT,3,b);
  assert.equal(permissionForOrigin(all,ORIGIN,ACCOUNT).grantedAt,1);assert.equal(permissionForOrigin(all,ORIGIN,ACCOUNT,a).grantedAt,2);assert.equal(permissionForOrigin(all,ORIGIN,ACCOUNT,b).grantedAt,3);
  const removed=revokePermission(all,ORIGIN,b);assert.equal(permissionForOrigin(removed,ORIGIN,ACCOUNT,b),null);assert.equal(permissionForOrigin(removed,ORIGIN,ACCOUNT,a).grantedAt,2);assert.equal(permissionForOrigin(removed,ORIGIN,ACCOUNT).grantedAt,1);
  const restarted=JSON.parse(JSON.stringify(removed));assert.equal(permissionForOrigin(restarted,ORIGIN,ACCOUNT,a).browserContext,a);
});

test("scoped permission storage rejects key, context and version tampering",()=>{
  const context="firefox-container-1",store=grantPermission({},ORIGIN,ACCOUNT,1,context),key=Object.keys(store)[0];
  for(const item of[{...store[key],browserContext:"firefox-container-2"},{...store[key],browserContext:"firefox-private"},{...store[key],browserContext:[context]},{...store[key],version:1},{...store[key],extra:true}])assert.throws(()=>parsePermissionStore({[key]:item}));
  assert.throws(()=>parsePermissionStore({[ORIGIN]:store[key]}));
});
