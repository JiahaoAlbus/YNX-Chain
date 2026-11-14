import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{randomUUID}from'node:crypto';
const {createProjectContractsRPC}=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/project-contracts-rpc.js');
test('closing one contract facade cancels its pending IDs without closing another view or shared fd8',async()=>{
 const pending=new Map(),cancelled=[],rpc={read(id,action,input){assert.equal(action,'contract');return new Promise((resolve,reject)=>pending.set(id,{input,resolve,reject}));},cancel(id){cancelled.push(id);pending.get(id).reject(Object.assign(Error('PUBLIC cancelled'),{code:'IDE_PROJECT_REQUEST_CANCELLED'}));},close(){throw Error('shared connection must stay open');}};
 const a=createProjectContractsRPC(rpc,{crypto:{randomUUID}}),b=createProjectContractsRPC(rpc,{crypto:{randomUUID}});
 const first=a.call('connect'),failed=assert.rejects(first,{code:'IDE_PROJECT_REQUEST_CANCELLED'}),second=b.call('inspect');const [idA,idB]=[...pending.keys()];
 a.close();a.close();await failed;assert.deepEqual(cancelled,[idA]);pending.get(idB).resolve({onlineConfigured:false});assert.equal((await second).onlineConfigured,false);await assert.rejects(a.call('inspect'));b.close();assert.deepEqual(cancelled,[idA]);
});
test('contract facade rejects forged project/account/transport before sharing project service RPC',async()=>{
 let reads=0;const facade=createProjectContractsRPC({read(){reads++;},cancel(){}},{crypto:{randomUUID}});
 for(const [action,body]of [['connect',{projectId:'PUBLIC-forged'}],['query',{referenceId:randomUUID(),refresh:true,account:'PUBLIC-forged'}],['deployment-prepare',{draftId:randomUUID(),relayURL:'wss://PUBLIC.invalid'}]])await assert.rejects(facade.call(action,body),{code:'IDE_CONTRACT_SERVICE_UNAVAILABLE'});
 assert.equal(reads,0);facade.close();
});
