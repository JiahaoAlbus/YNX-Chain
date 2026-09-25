import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {createCardServer} from './http.ts';
import {CardError,unavailableCore,unavailableWallet} from './contracts.ts';

async function harness(t:any){
  let authenticationCalls=0;
  const store=new CardStore(':memory:',Buffer.alloc(32,7));
  const wallet={...unavailableWallet,async authenticate(){authenticationCalls++;throw new CardError('PRIVATE_SERVICE_DEGRADED',503)}};
  const service=new CardService({store,wallet,core:unavailableCore});
  const server=createCardServer({service,wallet,sourceCommit:'a'.repeat(40),allowedOrigin:'https://card.ynxweb4.com',configurationReady:false});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close()});
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing local test port');
  return {port:address.port,calls:()=>authenticationCalls};
}
function get(port:number,path:string,headers:string[]=[]):Promise<{status:number;body:any}>{
  return new Promise((resolve,reject)=>{
    const request=httpRequest({host:'127.0.0.1',port,path,method:'GET',headers:['Host',`127.0.0.1:${port}`,...headers]},response=>{
      let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode!,body:JSON.parse(text)}));
    });request.on('error',reject);request.end();
  });
}
test('public prefixed version binds source without leaking private state or invoking Wallet',async t=>{
  const f=await harness(t),response=await get(f.port,'/api/card/v1/version');
  assert.equal(response.status,200);assert.equal(response.body.sourceCommit,'a'.repeat(40));
  assert.equal(response.body.configurationReady,false);assert.equal(response.body.runtimeFundingVerified,false);
  assert.equal(response.body.productionRealPayments,false);assert.equal(response.body.data,undefined);assert.equal(f.calls(),0);
});
for(const header of ['Origin','X-YNX-Product-Session-Proof-V2','X-YNX-Card-Platform','Idempotency-Key'])test(`duplicate ${header} is rejected before shared authentication`,async t=>{
  const f=await harness(t),response=await get(f.port,'/api/card/v1/state',[header,'same',header,'same']);
  assert.equal(response.status,400);assert.equal(response.body.error.code,'DUPLICATE_CARD_SECURITY_HEADER');assert.equal(f.calls(),0);
});
test('unknown platform cannot select an authorizer',async t=>{
  const f=await harness(t),response=await get(f.port,'/api/card/v1/state',['X-YNX-Card-Platform','evil']);
  assert.equal(response.status,400);assert.equal(response.body.error.code,'INVALID_CARD_PLATFORM');assert.equal(f.calls(),0);
});
