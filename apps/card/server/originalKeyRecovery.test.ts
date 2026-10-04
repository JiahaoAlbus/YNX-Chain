import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {unavailableCore,type Principal,type WalletAuthority} from './contracts.ts';

// Synthetic authority exercises storage/recovery only, never public admission.
const principal:Principal={owner:'0x'+'a'.repeat(40),chainId:'0x1917',expiresAt:'2026-10-05T00:00:00Z',scopes:['account:read','card:application:write','card:controls:write']};
const wallet:WalletAuthority={async authenticate(){return principal},async approve(_p,expected){return {approved:true,approvalId:'fixture-only',owner:expected.owner,challengeId:expected.id,payloadHash:expected.payloadHash,expiresAt:'2026-10-04T12:04:00Z'}}};
const digest=createHash('sha256').update('{}').digest('hex');
test('every accepted original key recovers without another mutation after encrypted store restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'card-original-key-')),path=join(dir,'state.sqlite');
 let store=new CardStore(path,Buffer.alloc(32,41));
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
 const service=()=>new CardService({store,wallet,core:unavailableCore,clock:()=>new Date('2026-10-04T12:00:00Z')});
 let card=service();
 const application=card.createApplication(principal,{nickname:'Testnet fixture',useCase:'Recovery test only',limitWei:'100',riskAccepted:true,termsVersion:'card-testnet-v1'},'application');
 card.requestApproval(principal,application.id,'approval');
 const accepted=await card.submitApplication(principal,application.id,{},'submit');
 assert.ok(accepted.card);const cardId=accepted.card.id;
 const keys=['1','retry.1','request:original','A_b-c:9.0','9'.repeat(160)];
 const responses=keys.map(key=>card.changeCard(principal,cardId,'freeze',key));
 const before=card.statement(principal,cardId);
 store.close();store=new CardStore(path,Buffer.alloc(32,41));card=service();
 for(const [index,key] of keys.entries()){
  const read=card.operationResult(principal,'freeze',cardId,key,digest);
  assert.equal(read.status,'CONFIRMED');assert.deepEqual(read.result,responses[index]);
  assert.throws(()=>card.operationResult(principal,'freeze',cardId,key,'b'.repeat(64)),/IDEMPOTENCY_CONFLICT/);
 }
 assert.equal(card.operationResult(principal,'freeze',cardId,'1:missing.key',digest).status,'UNKNOWN');
 for(const key of ['',':prefix',' space','a'.repeat(161),'line\nkey'])assert.throws(()=>card.operationResult(principal,'freeze',cardId,key,digest),/INVALID_OPERATION_READBACK/);
 assert.throws(()=>card.operationResult({...principal,owner:'0x'+'b'.repeat(40)},'freeze',cardId,keys[0]!,digest),/CARD_RESOURCE_NOT_FOUND/);
 assert.deepEqual(card.statement(principal,cardId),before);
});
