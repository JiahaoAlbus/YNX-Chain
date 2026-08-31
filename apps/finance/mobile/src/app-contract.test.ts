import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('./api.ts',import.meta.url),'utf8');
const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
const i18n=readFileSync(new URL('./i18n.ts',import.meta.url),'utf8');

test('native client exposes the complete read-only Finance workflow',()=>{
  for(const path of ['/api/overview','/api/sources','/api/activity/','/api/monthly-review','/api/export?format=','/api/privacy','/api/audit','/api/account','/api/ai/jobs'])assert.ok(api.includes(path),path);
  assert.ok(app.includes("'/api/notes'"),'/api/notes');
  for(const token of ['t.crossProductEvidence','t.ownerContractsPending','t.ownerActionNotConfigured','t.readOnlyOwnerApproval'])assert.ok(app.includes(token),token);
  for(const copy of ['Pay receipts','Open dispute evidence','Security signals','Copy CSV activity','Support & audit','Recovery: retry live sources','Delete private Finance data'])assert.ok(app.includes(copy),copy);
});

test('AI drafts require selected owned evidence, consent, and apply or reject',()=>{
  assert.ok(app.includes("contextClasses:['owned_activity']"));
  assert.ok(app.includes('consent:true'));
  assert.ok(app.includes("decideAI('apply')"));
  assert.ok(app.includes("decideAI('reject')"));
  assert.equal(app.includes("decision(aiJob.id,'approved')"),false);
});

test('Wallet migration keeps standard connection and never creates a local Product Session',()=>{
  for(const value of ['connectStandardWallet','StandardWalletConnection','PRODUCT_SESSION_UNAVAILABLE','WALLET_NOT_FOUND'])assert.ok(wallet.includes(value),value);
  for(const prohibited of ['p256','createGatewayChallenge','sessions/complete','createProductSessionProof','encodeRequestDeepLink'])assert.equal(wallet.includes(prohibited),false,prohibited);
  for(const prohibited of ['Guaranteed return','APY 8%','USD balance','Visa card','insured deposit'])assert.equal(app.includes(prohibited),false,prohibited);
  assert.ok(app.includes('no fiat value is inferred'));
  assert.ok(i18n.toLowerCase().includes('cannot move assets'));
});

test('a connected wallet remains visible without invoking a pending Finance API',()=>{
  for(const marker of ["financeEndpointManifest.endpointStates.products.finance.status==='PENDING'",'const connectedPending=','Wallet confirmed. Finance data is pending.','No portfolio, activity, Pay, planning, report, AI, or Product Session request was sent.','connection&&!productApiPending?new FinanceAPI(connection):null'])assert.ok(app.includes(marker),marker);
  assert.match(app,/if\(productApiPending\)return connectedPending/);
  assert.match(app,/connection&&!productApiPending\?<View style=\{\[st\.nav/);
});
