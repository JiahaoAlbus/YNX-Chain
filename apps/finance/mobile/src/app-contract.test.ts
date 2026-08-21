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

test('Wallet migration preserves Standard Wallet while canonical authorization uses the accepted package root',()=>{
  for(const value of ['connectStandardWallet','StandardWalletConnection','createProductWalletConnection','FinanceSecureDevice','PRIVATE_SERVICE_DEGRADED','WALLET_NOT_FOUND'])assert.ok(wallet.includes(value),value);
  for(const required of ['encodeRequestDeepLink','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY'])assert.ok(wallet.includes(required),required);
  for(const prohibited of ['createGatewayChallenge','sessions/complete','createProductSessionProof','gatewayEndpoint','deviceSecret'])assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.equal(/Linking\.openURL\(\s*['"`]ynxwallet:\/\/authorize/.test(wallet),false,'a naked Wallet authorization route must never be opened');
  for(const prohibited of ['Guaranteed return','APY 8%','USD balance','Visa card','insured deposit'])assert.equal(app.includes(prohibited),false,prohibited);
  assert.ok(app.includes('no fiat value is inferred'));
  assert.ok(i18n.toLowerCase().includes('cannot move assets'));
});

test('native privacy copy does not retain Wallet secrets or authorization artifacts',()=>{
  assert.ok(app.includes('SecureStore holds local settings and the visibly non-live cache only.'));
  assert.equal(app.includes('session, pending Wallet request, device proof'),false);
  assert.ok(app.includes('Wallet recovery material and raw device private keys are never requested or stored.'));
});
