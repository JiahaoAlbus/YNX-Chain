import test from 'node:test';
import assert from 'node:assert/strict';
import {createMnemonicUI,createMnemonicImportUI} from '../src/mnemonic-ui.mjs';
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

function importHarness(){
 const nodes=new Map();let account=null,overlay=false;
 function element(id=''){const listeners=new Map(),attributes=new Map();return {id,value:'',type:'',hidden:false,disabled:false,open:false,children:[],dataset:{},textContent:'',
  addEventListener(name,fn){const list=listeners.get(name)??[];list.push(fn);listeners.set(name,list)},emit(name){for(const fn of listeners.get(name)??[])fn({target:this,preventDefault(){}})},setAttribute(key,value){attributes.set(key,value)},getAttribute(key){return attributes.get(key)},append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children},focus(){},showModal(){this.open=true},close(){this.open=false;this.emit('close')}};}
 const node=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id)},fields=()=>node('#import-word-grid').children.map(label=>label.children[1]);
 const page=element(),window=element();const doc={defaultView:window,visibilityState:'visible',addEventListener:(...args)=>page.addEventListener(...args),querySelector:id=>id==='dialog[open]'?(overlay||node('#import-sheet').open?node('#import-sheet'):null):node(id),createElement:()=>element(),querySelectorAll:()=>[node('#import-kind'),node('#import-word-count'),node('#import-show-words'),node('#import-submit'),node('#import-value'),node('#import-file'),node('#import-password'),...fields()]};
 const state={locked:false,authenticating:false,revision:1};const ui=createMnemonicImportUI({document:doc,getState:()=>state,getAccount:()=>account});
 return {ui,node,fields,state,open(){node('#open-import').emit('click')},blur:()=>window.emit('blur'),hide(){doc.visibilityState='hidden';page.emit('visibilitychange')},setAccount:value=>account=value,setOverlay:value=>overlay=value};
}
test('import button opens a numbered 12/24 grid, conceals by default and clears on count/format change',()=>{
 const h=importHarness();h.open();assert.equal(h.node('#import-sheet').open,true);assert.equal(h.fields().length,12);assert.equal(h.node('#import-kind').value,'recovery-phrase');
 assert.deepEqual(h.fields().map(input=>input.id),Array.from({length:12},(_,i)=>'import-word-'+(i+1)));assert.ok(h.fields().every(input=>input.type==='password'));
 h.fields()[0].value='abandon';h.node('#import-show-words').emit('click');assert.equal(h.node('#import-show-words').getAttribute('aria-pressed'),'true');assert.ok(h.fields().every(input=>input.type==='text'));
 const old=h.fields();h.node('#import-word-count').value='24';h.node('#import-word-count').emit('change');assert.equal(h.fields().length,24);assert.ok(old.every(input=>input.value===''));assert.ok(h.fields().every(input=>input.value===''&&input.type==='password'));
 h.fields()[0].value='abandon';h.node('#import-kind').value='private-key';h.node('#import-kind').emit('change');assert.equal(h.node('#import-word-group').hidden,true);assert.equal(h.node('#import-value').hidden,false);assert.ok(h.fields().every(input=>input.value===''&&!input.required));
 h.node('#import-value').value='public-not-a-key';h.node('#import-kind').value='encrypted-json';h.node('#import-kind').emit('change');assert.equal(h.node('#import-value').value,'');assert.equal(h.node('#import-file-group').hidden,false);
});
for(const reason of ['cancel','escape','close','lock','revision','account'])test(`import ${reason} clears shown words and reopen starts concealed`,()=>{
 const h=importHarness();h.open();const old=h.fields();old[0].value='abandon';h.node('#import-show-words').emit('click');h.node('#import-password').value='public fixture';
 if(reason==='cancel')h.node('#import-close').emit('click');else if(reason==='escape')h.node('#import-sheet').emit('cancel');else if(reason==='close')h.node('#import-sheet').close();else {if(reason==='lock')h.state.locked=true;if(reason==='revision')h.state.revision++;if(reason==='account')h.setAccount('public-other-account');h.ui.render()}
 assert.equal(h.node('#import-sheet').open,false);assert.ok(old.every(input=>input.value===''&&input.type==='password'));assert.equal(h.node('#import-password').value,'');assert.equal(h.node('#import-show-words').getAttribute('aria-pressed'),'false');
 h.state.locked=false;h.open();assert.equal(h.fields().length,12);assert.ok(h.fields().every(input=>input.type==='password'&&input.value===''));
});
test('import preserves standard 15/18/21 lengths, ordered public-vector payload and single pending request',()=>{
 const h=importHarness();h.open();for(const count of [15,18,21,24,12]){h.node('#import-word-count').value=String(count);h.node('#import-word-count').emit('change');assert.equal(h.fields().length,count)}
 fixture.phrase.split(' ').forEach((word,i)=>h.fields()[i].value=word.toUpperCase());const token=h.ui.beginSubmission();assert.ok(token);assert.equal(h.ui.value(),fixture.phrase);assert.equal(h.ui.beginSubmission(),null);assert.ok(h.fields().every(input=>input.disabled));
 h.ui.clearSecrets();assert.ok(h.fields().every(input=>input.value===''));h.node('#import-close').emit('click');assert.equal(h.ui.accepts(token),false);h.open();assert.equal(h.node('#import-sheet').open,false,'unknown pending import is not replayed or replaced');h.ui.finish(token);h.open();assert.equal(h.node('#import-sheet').open,true);
});
test('own commit invalidation clears input but permits exact renderer acknowledgement; cancel retires it',()=>{
 const h=importHarness();h.open();const token=h.ui.beginSubmission();h.state.locked=true;h.state.revision++;h.ui.render();assert.equal(h.node('#import-sheet').open,false);assert.equal(h.ui.accepts(token),true);h.ui.finish(token);
 h.state.locked=false;h.open();const next=h.ui.beginSubmission();h.node('#import-sheet').emit('cancel');assert.equal(h.ui.accepts(next),false);h.ui.finish(next);assert.equal(h.ui.accepts(token),false);
});
test('locked, authenticating or overlapping dialogs cannot open the secret editor',()=>{
 const h=importHarness();h.state.locked=true;h.open();assert.equal(h.node('#import-sheet').open,false);h.state.locked=false;h.state.authenticating=true;h.open();assert.equal(h.node('#import-sheet').open,false);h.state.authenticating=false;h.setOverlay(true);h.open();assert.equal(h.node('#import-sheet').open,false);
});
for(const event of ['blur','hide'])test(`page ${event} immediately erases displayed words and dismisses a pending result before IPC lock arrives`,()=>{
 const h=importHarness();h.open();h.fields()[0].value='abandon';h.node('#import-show-words').emit('click');const inputs=h.fields(),token=h.ui.beginSubmission();h[event]();assert.equal(h.node('#import-sheet').open,false);assert.ok(inputs.every(input=>input.value===''&&input.type==='password'));assert.equal(h.ui.accepts(token),false);h.ui.finish(token);
});
