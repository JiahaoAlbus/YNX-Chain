import assert from "node:assert/strict";
import test from "node:test";
import {PROVIDER_ACCOUNT_KEY,PROVIDER_CHAIN_ID,PROVIDER_PERMISSIONS_KEY,canonicalProviderOrigin,createPendingApproval,eip2255Permissions,grantPermission,loadProviderState,parseApprovalDecision,parsePermissionStore,permissionForOrigin,revokePermission} from "../src/extension-provider-permissions.js";

const ACCOUNT={version:1,source:"ynx-wallet-vault",account:"0x1111111111111111111111111111111111111111"},ORIGIN="https://dapp.example",REQUEST="ynx-11111111-1111-4111-8111-111111111111";

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
