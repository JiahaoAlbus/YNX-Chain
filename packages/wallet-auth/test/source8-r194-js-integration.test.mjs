// Formal successor import/consumer boundaries only. No Root, key, service,
// credential, principal, signature, Native owner or registration is fabricated.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ProductSessionGatewayNodeHost,readOriginalDeveloperHTTPCredential} from '@ynx-chain/wallet-auth/product-session-gateway-node-host';
import {ProductSessionGatewayKernel} from '../src/product-session-gateway.js';
import {ProductSessionGatewayHttpHandler} from '../src/product-session-gateway-http.js';
import {OriginalAuthSourceCurrentV2Kernel} from '../src/original-auth-source-current-v2.js';
import {loadOriginalAuthSourceCurrentService,loadOriginalPublicationApprovalIssuer,handleOriginalDeveloperPrincipalCurrent,handleOriginalPublicationApprovalCurrent} from '../src/original-auth-identity-source-current.js';
import {encodeOriginalDeveloperPrincipalDATA} from '../native/original-developer-principal-data.mjs';
import {originalApprovalStateHeadDATA} from '../native/original-ide-approval-state-head-data.mjs';
import {inspectOriginalIDEApprovalScopeDATA} from '../native/original-ide-publication-approval-contract.mjs';
test('formal Source8 cyclic import closes through the existing Node subpath and original classes',()=>{
 for(const [owner,names]of [[ProductSessionGatewayNodeHost,['authenticateOriginalDeveloperHTTPRequest','currentExistingDeveloperPrincipal']],[ProductSessionGatewayKernel,['authenticateOriginalDeveloperHTTPRequest']],[ProductSessionGatewayHttpHandler,['authenticateOriginalDeveloperHTTPRequest']],[OriginalAuthSourceCurrentV2Kernel,['existingDeveloperPrincipal','publicationApprovalCurrent']]])for(const name of names)assert.equal(typeof owner.prototype[name],'function');
 for(const fn of [encodeOriginalDeveloperPrincipalDATA,originalApprovalStateHeadDATA,inspectOriginalIDEApprovalScopeDATA])assert.equal(typeof fn,'function');
});
test('normal empty release creates neither Source8 nor a publication issuer',async()=>{
 assert.equal(await loadOriginalAuthSourceCurrentService(),null);assert.equal(await loadOriginalPublicationApprovalIssuer(),null);
});
test('current adapters reject structural credentials and unbranded Source before calling user methods',async()=>{
 let calls=0;const source={existingDeveloperPrincipal(){calls++;},publicationApprovalCurrent(){calls++;}};
 await assert.rejects(readOriginalDeveloperHTTPCredential({session:{account:'PUBLIC'}}),{code:'ORIGINAL_HTTP_CREDENTIAL_REQUIRED'});
 await assert.rejects(handleOriginalDeveloperPrincipalCurrent(source,{}),{code:'AUTH_ORIGINAL_PRINCIPAL_SOURCE_REQUIRED'});
 await assert.rejects(handleOriginalPublicationApprovalCurrent(source,'PUBLIC','PUBLIC','PUBLIC'),{code:'AUTH_PUBLICATION_ORIGINAL_ISSUER_REQUIRED'});assert.equal(calls,0);
});
test('actual original Host consumer refuses unsigned request DATA before deriving any Principal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ynx-source8-import-'));try{const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8')),host=new ProductSessionGatewayNodeHost(registry,{statePath:join(dir,'state'),now:()=>new Date(),tokenFactory:()=> 'PUBLIC-token'});const input={requestId:'req_PUBLIC_source8_invalid',method:'POST',path:'/api/developer/projects',body:'{}',proofHeader:'PUBLIC unsigned'};
 await assert.rejects(host.authenticateOriginalDeveloperHTTPRequest(input));await assert.rejects(host.currentExistingDeveloperPrincipal(input));assert.equal(host.snapshot().authority.sessions.length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
