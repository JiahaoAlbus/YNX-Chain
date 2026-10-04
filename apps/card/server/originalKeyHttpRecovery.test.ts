import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {createCardServer} from './http.ts';
import {unavailableCore,type Principal,type WalletAuthority} from './contracts.ts';
import {CardBusinessClient,CARD_BUSINESS_ORIGIN} from '../src/cardBusinessClient.ts';

test('actual client HTTP recovery preserves original keys and read-only scope through route admission',async()=>{
 const principal:Principal={owner:'0x'+'a'.repeat(40),chainId:'0x1917',expiresAt:'2099-01-01T00:00:00Z',scopes:['account:read','card:application:write','card:controls:write']};
 const scopes:readonly string[][]=[] as string[][];
 // Test-only authority; no signature, public account access or active admission.
 const wallet:WalletAuthority={async authenticate(input){(scopes as string[][]).push([...input.requiredScopes]);return principal},async approve(_p,c){return {approved:true,approvalId:'fixture-only',owner:c.owner,challengeId:c.id,payloadHash:c.payloadHash,expiresAt:'2099-01-01T00:00:00Z'}}};
 const store=new CardStore(':memory:',Buffer.alloc(32,42)),service=new CardService({store,wallet,core:unavailableCore});
 const application=service.createApplication(principal,{nickname:'HTTP recovery',useCase:'Test-only recovery',limitWei:'100',riskAccepted:true,termsVersion:'card-testnet-v1'},'application');
 service.requestApproval(principal,application.id,'approval');const accepted=await service.submitApplication(principal,application.id,{},'submit');assert.ok(accepted.card);
 const cardId=accepted.card.id,source='a'.repeat(40),server=createCardServer({service,wallet,sourceCommit:source,configurationReady:false});
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const methods:string[]=[];
  const client=new CardBusinessClient({expectedSourceCommit:source,identity:()=>({owner:principal.owner,sessionBinding:'fixture',expiresAt:principal.expiresAt}),createIntrospectionProof:async()=>({proofHeader:'fixture_only'}),fetch:async(url,init)=>{assert.ok(String(url).startsWith(CARD_BUSINESS_ORIGIN+'/api/card/v1/'));methods.push(init?.method??'GET');return fetch(base+String(url).slice(CARD_BUSINESS_ORIGIN.length),init)}});
  const digest=createHash('sha256').update('{}').digest('hex');
  const keys=['1','retry.1','request:original','9'.repeat(160)];
  for(const key of keys)service.changeCard(principal,cardId,'freeze',key);
  const before=service.statement(principal,cardId);
  for(const key of keys)assert.deepEqual(await client.operationResult('freeze',cardId,key,digest),{status:'CONFIRMED'});
  assert.deepEqual(await client.operationResult('freeze',cardId,'9:unknown.key',digest),{status:'UNKNOWN'});
  assert.ok(methods.every(method=>method==='GET'));assert.ok(scopes.every(required=>JSON.stringify(required)==='["account:read"]'));
  assert.deepEqual(service.statement(principal,cardId),before);
 }finally{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));store.close()}
});
