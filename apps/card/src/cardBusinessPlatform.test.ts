import test from 'node:test';
import assert from 'node:assert/strict';
import {CardBusinessClient} from './cardBusinessClient';

const source='a'.repeat(40),owner='0x'+'1'.repeat(40);
const identity=()=>({owner,sessionBinding:'synthetic-session-binding',expiresAt:new Date(Date.now()+60000).toISOString()});
function response(){return new Response(JSON.stringify({schemaVersion:1,sourceCommit:source,sessionOwner:owner,environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false,data:{environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false,asset:'YNXT_TESTNET',applications:[],cards:[],intents:[]}}),{headers:{'Content-Type':'application/json'}})}
for(const platform of [undefined,'web','ios','android'] as const)test(`business transport uses explicit ${platform??'default web'} selection without inventing Origin`,async()=>{
  let calls=0;
  const client=new CardBusinessClient({expectedSourceCommit:source,platform,identity,createIntrospectionProof:async()=>({proofHeader:'public_fixture'}),
    fetch:async function(this:unknown,_url,input){calls++;assert.notEqual(this,client);const headers=new Headers(input?.headers);
      assert.equal(headers.get('X-YNX-Card-Platform'),platform??'web');assert.equal(headers.get('Origin'),null);assert.equal(headers.get('X-Forwarded-Origin'),null);return response();}});
  await client.state();assert.equal(calls,1);
});
test('unknown platform fails before any proof or network request',()=>{
  assert.throws(()=>new CardBusinessClient({expectedSourceCommit:source,platform:'attacker' as any,identity,createIntrospectionProof:async()=>{throw Error('must not sign')}}),{code:'INVALID_CARD_PLATFORM'});
});
