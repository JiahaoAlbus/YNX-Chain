import test from 'node:test';
import assert from 'node:assert/strict';
import {PQ_CONNECTION_METHODS,parsePQConnectionRequest,captureWalletPQConnection,readWalletPQConnection} from '../src/wallet-pq-connection-contract.mjs';
const account='0x'+'ab'.repeat(20),origin='https://ide.example';
const input=()=>({version:1,account,action:{kind:'contract_deploy',fee:'10',payload:{name:'SampleEVMWriteCounter',constructorArgs:['1'],value:'0'},deployment:{source:'contract Public {}',material:{artifactFile:Buffer.from('{}').toString('base64'),buildInfoFile:Buffer.from('{"public":true}').toString('base64')}}}});
const error=e=>typeof e?.data?.code==='string'&&e.data.code.startsWith('PQ_CONNECTION_');
test('closed contract request decodes canonical compiler material DATA without owner/nonce/permission',()=>{
 const parsed=parsePQConnectionRequest(PQ_CONNECTION_METHODS[0],[input()]);
 assert.equal(parsed.account,account);assert.equal(parsed.action.kind,'contract_deploy');assert.deepEqual(parsed.action.deployment.material.artifactFile,Buffer.from('{}'));
 assert.deepEqual(Object.keys(parsed.action).sort(),['deployment','fee','kind','payload']);
 for(const extra of [{approved:true},{nonce:'1'},{chainId:'6423'},{permission:{}}])assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[0],[{...input(),...extra}]),error);
});
test('query and broadcast only accept opaque original operation IDs and explicit read refresh',()=>{
 const query={version:1,account,operationId:'original_1',refresh:false};assert.deepEqual(parsePQConnectionRequest(PQ_CONNECTION_METHODS[2],[query]),query);
 assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[1],[query]),error);
 assert.equal(parsePQConnectionRequest(PQ_CONNECTION_METHODS[2],[{version:1,account,originalRequestKeyHash:'ab'.repeat(32),refresh:false}]).originalRequestKeyHash,'ab'.repeat(32));
 assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[2],[{...query,originalRequestKeyHash:'ab'.repeat(32)}]),error);
 for(const extra of [{hash:'0x'+'ab'.repeat(32)},{retry:true},{refresh:'yes'}])assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[2],[{...query,...extra}]),error);
});
test('unbranded, expired or disconnected connection objects cannot become Main source',()=>{
 assert.throws(()=>readWalletPQConnection({origin,account,approved:true}),error);
 let live=true;const token=captureWalletPQConnection({origin,account,sessionBinding:'original exact namespace',requestKey:'["original-topic",1]',assertCurrent(){if(!live)throw Error('DISCONNECTED')}});
 const data=readWalletPQConnection(token);assert.equal(data.origin,origin);assert.match(data.requestKeyHash,/^[a-f0-9]{64}$/);assert.equal(Object.isFrozen(data),true);assert.equal(Object.hasOwn(token,'account'),false);
 live=false;assert.throws(()=>readWalletPQConnection(token),/DISCONNECTED/);
});
test('getters, proxies, noncanonical base64, non-contract actions and incorrect fees reject before payload access',()=>{
 let hits=0;const value=input();Object.defineProperty(value.action.payload,'secret',{enumerable:true,get(){hits++;throw Error('GETTER')}});
 assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[0],[value]),error);assert.equal(hits,0);
 assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[0],new Proxy([input()],{get(){hits++;throw Error('PROXY')}})),error);assert.equal(hits,0);
 for(const kind of ['stake','transfer','raw_sign']){const x=input();x.action.kind=kind;assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[0],[x]),error)}
 const fee=input();fee.action.fee='2';assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[0],[fee]),error);
 for(const bad of ['e30','e30=\n','e31=','']){const x=input();x.action.deployment.material.artifactFile=bad;assert.throws(()=>parsePQConnectionRequest(PQ_CONNECTION_METHODS[0],[x]),error)}
});
