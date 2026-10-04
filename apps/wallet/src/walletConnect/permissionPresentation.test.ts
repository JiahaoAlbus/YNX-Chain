import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {SUPPORTED_LOCALES} from "../i18n/i18n";
import {CONNECTION_PERMISSION_KEYS,connectionPermissionCopy,walletConnectPermissionLabel} from "./permissionPresentation";
const source=readFileSync(process.env.YNX_CONNECTION_PERMISSION_SOURCE??new URL("./WalletConnectModal.tsx",import.meta.url),"utf8");
const helper=source.slice(source.indexOf("function permissionLabel("),source.indexOf("function message("));
const actual=new Function("walletConnectPermissionLabel",ts.transpileModule(helper+"\nreturn permissionLabel;",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(walletConnectPermissionLabel);
for(const locale of SUPPORTED_LOCALES)test(`actual connection permission projection covers ${locale} without changing wire methods`,()=>{
  for(const key of CONNECTION_PERMISSION_KEYS){const text=connectionPermissionCopy(locale,key);assert.ok(text.length>0);if(locale!=="en")assert.notEqual(text,connectionPermissionCopy("en",key));}
  for(const method of ["eth_accounts","eth_requestAccounts","eth_chainId","personal_sign","eth_signTypedData_v4","eth_sendTransaction","wallet_switchEthereumChain","wallet_addEthereumChain","ynx_requestProductSessionV2","ynx_requestCentralBrowserSignIn"]){
    const direct=actual(method,locale,false),connection=actual(method,locale,true);assert.equal(direct,walletConnectPermissionLabel(method,locale,false));
    if(["personal_sign","eth_signTypedData_v4","eth_sendTransaction","ynx_requestProductSessionV2","ynx_requestCentralBrowserSignIn"].includes(method))assert.equal(connection,connectionPermissionCopy(locale,"eachApproval").replace("{permission}",()=>direct));
    else assert.equal(connection,direct);
    assert.equal(connection.includes("{permission}"),false);
  }
});
test("unrecognized names stay exact diagnostic wire values, never invented friendly capabilities",()=>{
  for(const method of ["unknown_method","constructor","toString","__proto__","ynx_unknown","unknown_SIGN","unknown_sign"]){
    assert.equal(actual(method,"en",false),method);
    assert.ok(actual(method,"ar",true).includes(method));
  }
  assert.equal(actual("unknown_$&_$1","en",true),"unknown_$&_$1");
  assert.ok(actual("ynx_$&_$1","en",true).endsWith("ynx_$&_$1"));
});
test("connection, plain and structured signature notices use selected-locale copy at actual review callsites",()=>{
  for(const key of ["connectionOnly","messageWarning","structuredWarning"])assert.ok(source.includes(`connectionPermissionCopy(locale,"${key}")`));
  assert.ok(source.includes("permissionLabel(method,locale,true)"));
  assert.ok(source.includes("permissionLabel(requestReview.method,locale,false)"));
  assert.ok(source.includes("approveProposal()"));assert.ok(source.includes("decideRequest(true)"));
});
