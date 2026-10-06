import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{EventEmitter}from'node:events';
const require=createRequire(import.meta.url);require('reflect-metadata');
const{TerminalBackendContribution}=require('@theia/terminal/lib/node/terminal-backend-contribution');
const{TerminalProcess}=require('@theia/process/lib/node');
const{installOn}=require('../../ynx-workbench/lib/local-terminal-channel-diagnostics');
test('actual terminal contribution retains route and IO with content-free diagnostics',async()=>{
 class Contribution extends TerminalBackendContribution{};installOn(Contribution.prototype,TerminalProcess);
 const logs=[],routes=new Map(),output=new EventEmitter(),process=Object.create(TerminalProcess.prototype);let received;
 process.createOutputStream=()=>output;Object.defineProperty(process,"onClose",{value:()=>({dispose(){}})});process.write=data=>{received=data;};
 const contribution=new Contribution();contribution.logger={info:text=>logs.push(text)};contribution.processManager={get:()=>process};
 contribution.configure({registerChannelHandler:(path,handler)=>routes.set(path,handler)});
 let input;const sent=[];routes.get('/services/terminals/:id')({id:'17'},{onMessage:fn=>{input=fn;},onClose(){},getWriteBuffer(){return{writeString(value){sent.push(value);return this;},commit(){}};}});
 input(()=>({readString:()=> 'private-command'}));output.emit('data',Buffer.from('private-output\n'));await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(received,'private-command');assert.equal(sent.join(''),'private-output\n');assert.ok(logs.some(text=>text.includes('matches=true')));assert.ok(logs.some(text=>text.includes('phase=input')));assert.ok(logs.some(text=>text.includes('phase=buffer-request')));assert.ok(logs.every(text=>!text.includes('private')));
});
test('unrelated routes keep original handler and channel identity',()=>{
 const handler=()=>{};class Contribution{configure(service){service.registerChannelHandler('/other/:id',handler);}}installOn(Contribution.prototype,TerminalProcess);
 let captured;new Contribution().configure({registerChannelHandler(path,fn){captured=[path,fn];}});assert.deepEqual(captured,['/other/:id',handler]);
});
test('actual contribution leaves absent and non-terminal process routes unchanged',()=>{
 for(const process of [undefined,{}]){
  class Contribution extends TerminalBackendContribution{}installOn(Contribution.prototype,TerminalProcess);
  const logs=[],routes=new Map(),contribution=new Contribution();contribution.logger={info:text=>logs.push(text)};contribution.processManager={get:()=>process};
  contribution.configure({registerChannelHandler:(path,handler)=>routes.set(path,handler)});
  routes.get('/services/terminals/:id')({id:'23'},new Proxy({},{get(){throw Error('unexpected channel use');}}));
  assert.ok(logs.some(text=>text.includes(`present=${!!process} matches=false`)));
 }
});
