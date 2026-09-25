import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withCardApplicationVerifier} from './walletApproval.ts';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {unavailableCore,type Principal,type WalletAuthority} from './contracts.ts';
import * as shared from './vendor/wallet-card-ff5b7d49/card-application-verifier.mjs';

// Wallet Owner's publicly signed synthetic fixture. It contains no private key.
const vector=JSON.parse(readFileSync(join(__dirname,'test-fixtures/card-approval-public-fixture.json'),'utf8'));
const at=()=>new Date(vector.clock);
const principal=():Principal=>({owner:vector.authenticatedAccount,chainId:'ynx_6423-1',expiresAt:'2026-09-13T00:00:00.000Z',scopes:['account:read','card:application:write','card:topup:write']});
const verifier=()=>withCardApplicationVerifier({authenticate:async()=>principal()},at);

test('Card consumes the exact verification-only artifact and public signed fixture',()=>{
  for(const [path,bytes,sha]of [
    ['./vendor/wallet-card-ff5b7d49/card-application-verifier.mjs',91073,'c07e6b1f0beab127187e60a9b7178c03850ac19eb45a2c068746c7be92ac7232'],
    ['./test-fixtures/card-approval-public-fixture.json',2330,'8db36d9e90bf2b48c66880295ba99e3a74f9afa645df7d7c5428878f3b5183c7'],
  ]as const){const input=readFileSync(join(__dirname,path));assert.equal(input.length,bytes);assert.equal(createHash('sha256').update(input).digest('hex'),sha);}
  assert.equal('createSignedCardApplicationApproval' in shared,false);
  assert.equal(shared.CARD_APPLICATION_APPROVAL_DOMAIN,'YNX_CARD_APPLICATION_APPROVAL_V1');
});

test('the accepted signed fixture maps to an approval and public-key-bound sender',async()=>{
  const result=await verifier().approve(principal(),vector.challenge,vector.proof,vector.details);
  assert.deepEqual(result,{approved:true,approvalId:vector.expected.approvalId,challengeId:vector.challenge.id,owner:vector.challenge.owner,payloadHash:vector.challenge.payloadHash,expiresAt:vector.proof.expiresAt,evmAddress:vector.expected.evmAddress});
  assert.equal(shared.cardApplicationDetailsHash(vector.details),vector.challenge.payloadHash);
});

test('changed signature, unsigned sender, high-S signature and unsigned rejection grant no approval',async()=>{
  const order=BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
  const highS=vector.proof.signature.slice(0,64)+(order-BigInt('0x'+vector.proof.signature.slice(64))).toString(16).padStart(64,'0');
  for(const proof of [
    {...vector.proof,signature:'0'.repeat(128)},
    {...vector.proof,sender:'0x'+'b'.repeat(40)},
    {...vector.proof,signature:highS},
    {approved:false},
    {...vector.proof,productId:'different-product'},
  ])await assert.rejects(verifier().approve(principal(),vector.challenge,proof,vector.details),/INVALID_CARD_APPROVAL/);
});

test('current challenge, complete persisted details and live authenticated owner must match',async()=>{
  const wallet=verifier();
  await assert.rejects(wallet.approve(principal(),{...vector.challenge,nonce:'44444444-4444-4444-8444-444444444444'},vector.proof,vector.details),/INVALID_CARD_APPROVAL/);
  await assert.rejects(wallet.approve(principal(),vector.challenge,vector.proof,{...vector.details,limitWei:'1'}),/INVALID_CARD_APPROVAL/);
  await assert.rejects(wallet.approve({...principal(),owner:'0x'+'b'.repeat(40)},vector.challenge,vector.proof,vector.details),/INVALID_CARD_APPROVAL/);
  await assert.rejects(wallet.approve({...principal(),scopes:['account:read']},vector.challenge,vector.proof,vector.details),/PERMISSION_DENIED/);
  await assert.rejects(wallet.approve({...principal(),expiresAt:'2026-09-12T00:00:00.000Z'},vector.challenge,vector.proof,vector.details),/AUTH_EXPIRED/);
});

test('historical signature parsing cannot bypass current proof expiry',async()=>{
  assert.equal(shared.parseSignedCardApplicationApproval(vector.proof).account,vector.authenticatedAccount);
  const expired=withCardApplicationVerifier({authenticate:async()=>principal()},()=>new Date('2026-09-12T00:06:00.000Z'));
  await assert.rejects(expired.approve(principal(),vector.challenge,vector.proof,vector.details),/INVALID_CARD_APPROVAL/);
});

test('a configured authentication adapter cannot override Card business approval',async()=>{
  let called=false;
  const adapter={authenticate:async()=>principal(),approve:async()=>{called=true;return {approved:true}}};
  const wallet=withCardApplicationVerifier(adapter,at);
  await assert.rejects(wallet.approve(principal(),vector.challenge,{},vector.details),/INVALID_CARD_APPROVAL/);
  assert.equal(called,false);
});

test('verified fixture activates once, persists sender binding and does not credit any funding',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'ynx-card-signed-fixture-')),path=join(dir,'state.sqlite'),key=randomBytes(32),p=principal();
  let store=new CardStore(path,key),calls=0;
  t.after(()=>{store.close();key.fill(0);rmSync(dir,{recursive:true,force:true})});
  const accepted=verifier(),wallet:WalletAuthority={authenticate:accepted.authenticate,approve:async(...args)=>{calls++;return accepted.approve(...args)}};
  // Seed a pending snapshot with the fixed public fixture IDs. No HTTP state override exists.
  store.transaction(p.owner,()=>({owner:p.owner,applications:{[vector.challenge.applicationId]:{id:vector.challenge.applicationId,owner:p.owner,status:'APPROVAL_REQUIRED',details:vector.details,challenge:vector.challenge,createdAt:vector.challenge.issuedAt,updatedAt:vector.challenge.issuedAt}},cards:{},intents:{},authorizations:{},captures:{},ledger:[],events:[],idempotency:{}}),()=>null);
  const create=()=>new CardService({store,wallet,core:unavailableCore,fundingAddress:'0x'+'c'.repeat(40),clock:at});
  const service=create(),result=await service.submitApplication(p,vector.challenge.applicationId,vector.proof,'signed-fixture');
  assert.ok(result.card);assert.equal(result.application.status,'ACTIVE');
  assert.equal(result.card.fundingSender,vector.expected.evmAddress);assert.equal(result.card.balance.availableWei,'0');
  store.close();store=new CardStore(path,key);const recovered=create();
  assert.equal((await recovered.submitApplication(p,vector.challenge.applicationId,vector.proof,'signed-fixture')).card?.id,result.card.id);
  assert.equal(calls,1);
  const spoofedPrincipal={...p,evmAddress:'0x'+'b'.repeat(40)};
  const intent=recovered.createTopupIntent(spoofedPrincipal,result.card.id,{amountWei:'100',sender:'0x'+'b'.repeat(40)} as never,'intent');
  assert.equal(intent.sender,vector.expected.evmAddress);
  await assert.rejects(recovered.confirmTopup(p,intent.id,'0x'+'1'.repeat(64),'topup'),/CORE_UNAVAILABLE/);
  assert.equal(recovered.getState(p).cards[0]?.balance.fundedWei,'0');
});
