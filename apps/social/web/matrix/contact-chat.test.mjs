import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedContactProfiles,checkedContactBinding,createContactChat} from './contact-chat.mjs';

const id='sp_'+'p'.repeat(32),other='sp_'+'q'.repeat(32);
const account='ynx1'+'b'.repeat(38);
const person={id,handle:'original-name',displayName:'Original contact'};
const binding={protocol:'ynx-social-matrix-peer/v1',person:id,account,userId:'@original:remote.test',serverName:'remote.test',homeserver:'https://client.remote.test/'};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function harness(){
 const state={current:true,contacts:[person],opened:[],requests:[],identities:0};
 const view={account:'ynx1'+'a'.repeat(38)},guard=()=>{if(!state.current)throw Object.assign(Error('Stale'),{code:'UI_STALE_VIEW'})};
 const controller=createContactChat({guard,identity:async()=>{state.identities++;guard();return {account:view.account,csrfToken:'software-only-csrf'}},proof:async scopes=>{state.scopes??=[];state.scopes.push(scopes);return {proofHeader:'software-only-proof'}},
  fetcher:async(path,options)=>{state.requests.push({path,options});if(state.fetcher)return state.fetcher(path,options);return {ok:true,json:async()=>path.includes('/matrix/peer')?binding:{contacts:state.contacts}}},
  open:async(value,options)=>{options.assertCurrent();state.opened.push(value);return '!actual-sdk-result:remote.test'}
 });
 return {state,view,controller};
}
test('normal selected accepted Social identity reaches the historical remote MXID without handle or address lookup',async()=>{
 const {state,view,controller}=harness();const result=await controller.start(id,view);
 assert.equal(result.binding.userId,binding.userId);assert.equal(result.person.id,id);assert.equal(state.opened.length,1);
 assert.deepEqual(state.requests.map(value=>value.path),['/social/v1/contacts','/social/v3/matrix/peer?person='+id,'/social/v1/contacts']);
 assert.ok(state.requests.every(({options})=>options.credentials==='same-origin'&&options.redirect==='error'&&options.cache==='no-store'&&options.headers['X-YNX-SSO-CSRF']==='software-only-csrf'));
 assert.equal(state.identities,6);assert.ok(!state.requests.some(({path})=>path.includes(account)||path.includes(person.handle)));
});
test('handles can change without retargeting the selected stable identity',async()=>{
 const {state,view,controller}=harness();state.contacts=[{...person,handle:'renamed'}];const result=await controller.start(id,view);assert.equal(result.person.handle,'renamed');assert.equal(state.opened[0].userId,binding.userId);
});
test('new or pending request is not an accepted contact',async()=>{
 const {state,view,controller}=harness();state.contacts=[];await assert.rejects(controller.start(id,view),{code:'MATRIX_CONTACT_NO_LONGER_ACCEPTED'});assert.equal(state.opened.length,0);assert.equal(state.requests.length,1);
});
test('contact removal or blocking after peer read prevents any room request',async()=>{
 const {state,view,controller}=harness();state.fetcher=async path=>({ok:true,json:async()=>{if(path.includes('/matrix/peer')){state.contacts=[];return binding}return {contacts:state.contacts}}});
 await assert.rejects(controller.start(id,view),{code:'MATRIX_CONTACT_NO_LONGER_ACCEPTED'});assert.equal(state.opened.length,0);
});
for(const value of [account,'@original:remote.test','original-name',other+'?account='+account])test('normal contact entry refuses manually supplied identity '+value.slice(0,16),async()=>{
 const {state,view,controller}=harness();await assert.rejects(controller.start(value,view),{code:'MATRIX_CONTACT_SELECTION_REQUIRED'});assert.equal(state.requests.length,0);assert.equal(state.opened.length,0);
});
test('mixed, duplicate or wallet-based profile response fails atomically',()=>{
 for(const contacts of [[person,person],[person,{...person,id:account}],[person,{...person,id:other,handle:null}]])assert.throws(()=>acceptedContactProfiles({contacts}),{code:'MATRIX_CONTACTS_INVALID'});
 assert.equal(Object.isFrozen(acceptedContactProfiles({contacts:[person]})),true);
});
test('binding must echo the exact selected person and preserve a valid secure existing Matrix route',()=>{
 for(const value of [{...binding,person:other},{...binding,userId:'@new:wrong.test'},{...binding,account:id},{...binding,homeserver:'http://remote.test/'},{...binding,homeserver:'https://remote.test/?token=secret'},{...binding,homeserver:'https://user:secret@remote.test/'}])assert.throws(()=>checkedContactBinding(value,id),{code:'MATRIX_PEER_BINDING_REQUIRED'});
 assert.equal(checkedContactBinding(binding,id).homeserver,'https://client.remote.test/');
});
for(const phase of ['response','json'])test('lock/account change while waiting for '+phase+' prevents room creation',async()=>{
 const {state,view,controller}=harness(),pending=deferred();state.fetcher=async path=>path.includes('/matrix/peer')?(phase==='response'?pending.promise:{ok:true,json:()=>pending.promise}):{ok:true,json:async()=>({contacts:[person]})};
 const work=controller.start(id,view);for(let n=0;n<30;n++)await Promise.resolve();state.current=false;pending.resolve(phase==='response'?{ok:true,json:async()=>binding}:binding);await assert.rejects(work,{code:'UI_STALE_VIEW'});assert.equal(state.opened.length,0);
});
test('parent cancellation actively releases a fetch that ignores AbortSignal; late data never starts a room',async()=>{
 const {state,view,controller}=harness(),pending=deferred(),cancel=new AbortController();state.fetcher=()=>pending.promise;
 const work=controller.start(id,view,{signal:cancel.signal});for(let n=0;n<10;n++)await Promise.resolve();cancel.abort();await assert.rejects(work);pending.resolve({ok:true,json:async()=>({contacts:[person]})});for(let n=0;n<10;n++)await Promise.resolve();assert.equal(state.opened.length,0);
});
test('a newer contact operation supersedes a late old contact list',async()=>{
 const {state,view,controller}=harness(),pending=deferred();let first=true;state.fetcher=async()=>first?(first=false,pending.promise):{ok:true,json:async()=>({contacts:[]})};
 const old=controller.load(view);for(let n=0;n<10;n++)await Promise.resolve();assert.equal((await controller.load(view)).length,0);pending.resolve({ok:true,json:async()=>({contacts:[person]})});await assert.rejects(old,{code:'UI_STALE_VIEW'});
});
test('missing original mapping reports a setup gap without provisioning or opening a room',async()=>{
 const {state,view,controller}=harness();state.fetcher=async path=>path.includes('/matrix/peer')?{ok:false,status:409}:{ok:true,json:async()=>({contacts:[person]})};await assert.rejects(controller.start(id,view),/existing Matrix identity mapping/);assert.equal(state.opened.length,0);
});
test('a reopened original room revalidates the mapped MXID and current accepted Social identity',async()=>{
 const {state,view,controller}=harness();const result=await controller.verifyPeer(binding.userId,view);assert.equal(result.person,id);assert.equal(state.opened.length,0);assert.equal(state.requests[0].path,'/social/v3/matrix/peer?userId='+encodeURIComponent(binding.userId));
});
test('reopened room cannot bypass a removed contact through an old Matrix binding',async()=>{
 const {state,view,controller}=harness();state.contacts=[];await assert.rejects(controller.verifyPeer(binding.userId,view),{code:'MATRIX_CONTACT_NO_LONGER_ACCEPTED'});assert.equal(state.opened.length,0);
});

test('JSON arrays cannot masquerade as public IDs, accounts or chat routing fields',()=>{
 assert.throws(()=>acceptedContactProfiles({contacts:[{...person,id:[id]}]}),{code:'MATRIX_CONTACTS_INVALID'});
 for(const key of ['person','account','userId','serverName','homeserver']){
  assert.throws(()=>checkedContactBinding({...binding,[key]:[binding[key]]},id),{code:'MATRIX_PEER_BINDING_REQUIRED'});
 }
 assert.throws(()=>checkedContactBinding(binding,[id]),{code:'MATRIX_PEER_BINDING_REQUIRED'});
});

test('contact response snapshots each producer field once without freezing producer objects',()=>{
 let reads=0;
 const original={get id(){reads++;return reads===1?id:other},handle:'original-name',displayName:'Original contact'};
 const [captured]=acceptedContactProfiles({contacts:[original]});
 assert.equal(reads,1);assert.equal(captured.id,id);assert.equal(Object.isFrozen(original),false);
 let accountReads=0;
 const route={...binding,get account(){accountReads++;return accountReads===1?account:'ynx1'+'c'.repeat(38)}};
 const capturedRoute=checkedContactBinding(route,id);
 assert.equal(accountReads,1);assert.equal(capturedRoute.account,account);assert.equal(Object.isFrozen(route),false);
});

test('non-string selection never requests authority, fetch or room creation',async()=>{
 const {state,view,controller}=harness();
 for(const value of [[id],{toString:()=>id}])await assert.rejects(controller.start(value,view),{code:'MATRIX_CONTACT_SELECTION_REQUIRED'});
 assert.equal(state.identities,0);assert.equal(state.requests.length,0);assert.equal(state.opened.length,0);
});
