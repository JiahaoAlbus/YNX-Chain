import test from 'node:test';
import assert from 'node:assert/strict';
import {createMnemonicUI} from '../src/mnemonic-ui.mjs';
import {mnemonicAccountFromEntropy} from '../src/mnemonic-account.mjs';
import {MNEMONIC_COPY,MNEMONIC_COPY_KEYS} from '../src/wallet-locale-mnemonic.mjs';
const fixture=mnemonicAccountFromEntropy('00'.repeat(16));
function deferred(){let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)}}
function harness(){
 const nodes=new Map(),stages=['create','words','confirmation','reveal'].map(name=>({dataset:{mnemonicStage:name},hidden:false}));
 function node(id){if(!nodes.has(id)){const listeners=new Map();nodes.set(id,{id,value:'',textContent:'',hidden:false,disabled:false,open:false,children:[],dataset:{},addEventListener(name,fn){listeners.set(name,fn)},emit(name){return listeners.get(name)?.({preventDefault(){}})},replaceChildren(...children){this.children=children},showModal(){this.open=true},close(){this.open=false;void this.emit('close')}})}return nodes.get(id)}
 const inputs=[0,1,2].map(i=>node('#mnemonic-answer-'+i));
 const doc={querySelector:node,createElement:()=>({textContent:'',dir:''}),querySelectorAll(selector){if(selector==='[data-mnemonic-stage]')return stages;if(selector==='#mnemonic-confirmation input')return inputs;if(selector.startsWith('#mnemonic-sheet'))return [...nodes.values()];return []}};
 const state={locked:false,revision:1};let account=null,cancelled=0,submitted=[];
 const api={cancelMnemonicAccount(){cancelled++;return Promise.resolve()},prepareMnemonicAccount:async()=>({ok:true,value:{...fixture,id:'public-review',indexes:[0,6,11]}}),commitMnemonicAccount:async input=>(submitted.push(structuredClone(input)),{ok:true,value:{account:fixture.account}}),recoveryPhrase:async()=>({ok:true,value:fixture})};
 const ui=createMnemonicUI({document:doc,api,getState:()=>state,getAccount:()=>account,onAccount(){}});node('#mnemonic-word-count').value='12';
 return {node,ui,api,state,inputs,submitted,setAccount:value=>account=value,cancelled:()=>cancelled};
}
test('normal mounted creation removes displayed words before offline confirmation and submits only answers',async()=>{
 const h=harness();h.ui.openCreate();await h.node('#mnemonic-create').emit('submit');assert.equal(h.node('#mnemonic-words').children.length,12);
 h.node('#mnemonic-next').emit('click');assert.equal(h.node('#mnemonic-words').children.length,0);
 [0,6,11].forEach((index,i)=>h.inputs[i].value=fixture.phrase.split(' ')[index]);await h.node('#mnemonic-confirmation').emit('submit');
 assert.deepEqual(h.submitted,[{id:'public-review',words:[...fixture.phrase.split(' ').filter((_,i)=>[0,6,11].includes(i))]}]);
 assert.equal(h.node('#mnemonic-sheet').open,false);assert.ok(h.inputs.every(input=>input.value===''));
});
test('close and newer account suppress late generated phrases or password-verified reveals',async()=>{
 const h=harness(),pending=deferred();h.api.prepareMnemonicAccount=()=>pending.promise;h.ui.openCreate();const result=h.node('#mnemonic-create').emit('submit');h.ui.invalidate();pending.resolve({ok:true,value:{...fixture,id:'retired',indexes:[0,6,11]}});await result;
 assert.equal(h.node('#mnemonic-words').children.length,0);assert.equal(h.node('#mnemonic-sheet').open,false);
 const reveal=deferred();h.api.recoveryPhrase=()=>reveal.promise;h.ui.openBackup();h.node('#mnemonic-password').value='public synthetic password';const read=h.node('#mnemonic-reveal').emit('submit');assert.equal(h.node('#mnemonic-password').value,'');h.setAccount('other');h.ui.render();reveal.resolve({ok:true,value:fixture});await read;
 assert.equal(h.node('#mnemonic-words').children.length,0);assert.equal(h.node('#mnemonic-sheet').open,false);
});
test('lock erases visible phrase and every locale preserves interpolation placeholders',async()=>{
 const h=harness();h.ui.openBackup();await h.node('#mnemonic-reveal').emit('submit');assert.equal(h.node('#mnemonic-words').children.length,12);h.state.locked=true;h.state.revision++;h.ui.render();assert.equal(h.node('#mnemonic-words').children.length,0);
 assert.equal(Object.keys(MNEMONIC_COPY).length,12);for(const row of Object.values(MNEMONIC_COPY))for(const key of MNEMONIC_COPY_KEYS)assert.deepEqual((row[key].match(/\{\w+\}/g)??[]),(key.match(/\{\w+\}/g)??[]));
});
