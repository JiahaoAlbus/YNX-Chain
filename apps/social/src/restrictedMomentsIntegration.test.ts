import test from 'node:test';
import assert from 'node:assert/strict';
import {decryptAttachment} from 'matrix-encrypt-attachment';
// @ts-ignore actual browser UI
import {createRestrictedMomentsUI} from '../web/matrix/restricted-moments-ui.mjs';
// @ts-ignore actual HTTP adapter
import {createSocialAudienceHTTPClient} from '../web/matrix/audience-client.mjs';

// Minimal DOM driver, not installed/browser acceptance. The actual UI handlers,
// policy consumer and HTTP adapter are used without replacing their methods.
function fixture({drafts=null}:{drafts?:any}={}){
  const nodes:any[]=[];const document:any={createElement:(tag:string)=>{
    const listeners:any={};const node:any={tag,ownerDocument:document,children:[],value:tag==='select'?'contacts':'',disabled:false,textContent:'',attributes:{},append(...children:any[]){this.children.push(...children)},replaceChildren(...children:any[]){this.children=children},setAttribute(key:string,value:string){this.attributes[key]=value},addEventListener(event:string,callback:any){listeners[event]=callback},dispatch(event:string){listeners[event]?.()},get selectedOptions(){return this.children.filter((option:any)=>option.selected)}};nodes.push(node);return node;
  }};
  const container=document.createElement('div'),userId='@original:fixture.invalid';let content:any,last:Promise<any>=Promise.resolve(),uploaded:Uint8Array|undefined,uploads=0,tamper=false;
  const metadata={kind:'contacts',members:[userId],owner:userId,protocol:'ynx-social-matrix-moment/v1',revision:'a'.repeat(64),roomId:'!original:fixture.invalid'};
  const requests:any[]=[];const binding={account:'synthetic-account',userId,deviceId:'original-device'};
  const client={getRoom:()=>({getMembers:()=>[{userId,membership:'join'}]}),uploadContent:async(data:Uint8Array)=>{uploads++;uploaded=data;return {content_uri:'mxc://fixture.invalid/original-ciphertext'}},sendMessage:async(_room:string,input:any,transaction:string)=>{content=input;assert.equal(transaction,requests[1].transactionId);return {event_id:'$original'}}};
  const operation={binding,client,generation:1},view={account:binding.account,operation};
  const transport={capture:()=>operation,guard:()=>{},assertTrusted:async()=>{},messages:async()=>{const readback=structuredClone(content);if(tamper&&readback.file)readback.file.hashes.sha256='substituted ciphertext hash';return [{id:'$original',sender:userId,encrypted:true,verification:{shieldColour:0},content:readback}]}};
  const session={current:{status:'connected',session:{account:binding.account,scopes:['social.contacts','social.feed','social.messaging','social.profile']}},restore:async()=>session.current,createSocialAudienceProof:async(input:any)=>({body:input.body,proofHeader:'synthetic-action',introspection:{proofHeader:'synthetic-introspection'}})};
  const http=createSocialAudienceHTTPClient({session,capture:()=>view,guard:()=>{},csrfToken:async()=> 'synthetic-csrf',fetcher:async(url:RequestInfo|URL,options?:RequestInit)=>{
    const body=JSON.parse(String(options?.body));requests.push(body);
    if(String(url).endsWith('/resolve')){
      assert.equal('account' in body,false);assert.ok(['kind','groupId','selected'].every(key=>Object.keys(body).includes(key)||key!=='kind'));
      assert.ok(Object.keys(body).every(key=>['kind','groupId','selected'].includes(key)));metadata.kind=body.kind;
    }else{
      assert.ok(['read','media-prepare','publish','index'].includes(body.action));assert.match(body.transactionId,/^[A-Za-z0-9_-]{16,128}$/);
      assert.ok(Object.keys(body).every(key=>['action','transactionId','expected','eventId','parentEventId'].includes(key)));
      if(body.action==='index')assert.equal(body.eventId,'$original');
    }
    return new Response(JSON.stringify(metadata),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  createRestrictedMomentsUI({container,transport,capture:()=>view,guard:()=>{},identity:async()=>{},work:(action:any)=>{last=Promise.resolve().then(()=>action());return last},resolveAudience:http.resolve,authorize:http.authorize,
    drafts,loadSelections:async()=>({groups:[{id:'group_'+'a'.repeat(24),title:'Original group'}],contacts:[{id:'sp_'+'a'.repeat(32),title:'Accepted friend'}]})});
  const label=(name:string)=>nodes.find(node=>node.attributes['aria-label']===name);
  return {requests,metadata,client,input:label('Restricted Moment draft'),file:label('Restricted Moment attachment'),choice:label('Restricted Moment audience'),group:label('Existing group'),people:label('Accepted friends'),review:nodes.find(node=>node.textContent==='Review audience'),saveDraft:nodes.find(node=>node.textContent==='Save protected draft'),restoreDraft:nodes.find(node=>node.textContent==='Restore protected draft'),form:nodes.find(node=>node.tag==='form'),settle:()=>last,content:()=>content,uploaded:()=>uploaded!,uploads:()=>uploads,tamper:(value:boolean)=>{tamper=value}};
}
test('actual UI to consumer to strict HTTP preserves one intent through review, send and index',async()=>{
  const f=fixture();f.input.value='Original reviewed draft';f.review.onclick();await f.settle();
  assert.deepEqual(f.requests[0],{kind:'contacts'});assert.equal(f.requests[1].action,'read');
  const transaction=f.requests[1].transactionId;
  f.form.onsubmit({preventDefault(){}});await f.settle();
  assert.deepEqual(f.requests.slice(1).map(request=>request.action),['read','publish','publish','index']);
  assert.ok(f.requests.slice(1).every(request=>request.transactionId===transaction));assert.equal(f.input.value,'');
});
test('group and selected review use actual original records, never caller account or manual MXID',async()=>{
  for(const kind of ['group','selected']){
    const f=fixture();f.choice.value=kind;f.choice.dispatch('change');await f.settle();
    if(kind==='group')f.group.value=f.group.children[0].value;else f.people.children[0].selected=true;
    f.input.value='Original draft';f.review.onclick();await f.settle();
    assert.deepEqual(f.requests[0],kind==='group'?{kind,groupId:'group_'+'a'.repeat(24)}:{kind,selected:['sp_'+'a'.repeat(32)]});
    assert.equal(f.requests[1].action,'read');
  }
});
test('actual attachment UI uploads ciphertext and publishes one authenticated standard encrypted file with caption',async()=>{
  const f=fixture(),bytes=new TextEncoder().encode('private original attachment').buffer;
  f.input.value='Original private caption';f.file.files=[{name:'private.txt',type:'text/plain',arrayBuffer:async()=>bytes}];f.file.dispatch('change');
  f.review.onclick();await f.settle();f.form.onsubmit({preventDefault(){}});await f.settle();
  assert.deepEqual(f.requests.slice(1).map(request=>request.action),['read','media-prepare','media-prepare','media-prepare','publish','publish','index']);
  assert.ok(f.requests.slice(1).every(request=>request.transactionId===f.requests[1].transactionId));
  const content=f.content();assert.equal(content.msgtype,'m.file');assert.equal(content.body,'private.txt');assert.equal(content['com.ynx.social.moment'].text,'Original private caption');assert.equal('url' in content,false);
  assert.equal(f.uploads(),1);assert.notDeepEqual(f.uploaded(),new Uint8Array(bytes));
  assert.deepEqual(new Uint8Array(await decryptAttachment(f.uploaded().slice().buffer as ArrayBuffer,content.file)),new Uint8Array(bytes));assert.equal(f.input.value,'');
});
test('attachment readback substitution preserves draft and original transaction; explicit retry reuses upload',async()=>{
  const f=fixture(),bytes=new TextEncoder().encode('original file').buffer;
  f.input.value='Keep original caption';f.file.files=[{name:'original.txt',type:'text/plain',arrayBuffer:async()=>bytes}];f.file.dispatch('change');
  f.review.onclick();await f.settle();const transaction=f.requests[1].transactionId;f.tamper(true);
  f.form.onsubmit({preventDefault(){}});await assert.rejects(f.settle(),/ownership is not confirmed/);
  assert.equal(f.input.value,'Keep original caption');assert.equal(f.requests.some(request=>request.action==='index'),false);assert.equal(f.uploads(),1);
  f.tamper(false);f.form.onsubmit({preventDefault(){}});await f.settle();
  assert.equal(f.uploads(),1);assert.ok(f.requests.slice(1).every(request=>request.transactionId===transaction));assert.equal(f.input.value,'');
});
test('actual UI explicitly saves and restores draft without sending or approving a wallet',async()=>{
  let record:any=null;const drafts={save:async(_view:any,value:any)=>{record=structuredClone(value)},load:async()=>structuredClone(record),clearConfirmed:async()=>{record=null}};
  const first=fixture({drafts});first.input.value='Protected original text';first.saveDraft.onclick();await first.settle();assert.equal(record.status,'draft');assert.equal(first.requests.length,0);
  const second=fixture({drafts});second.restoreDraft.onclick();await second.settle();assert.equal(second.input.value,'Protected original text');assert.equal(second.requests.length,0);
});
test('UI persists unknown before send and a fresh composer restores only original text transaction',async()=>{
  let record:any=null;const drafts={save:async(_view:any,value:any)=>{record=structuredClone(value)},load:async()=>structuredClone(record),clearConfirmed:async(_view:any,transaction:string)=>{assert.equal(transaction,record.transactionId);record=null}};
  const first=fixture({drafts});first.input.value='Original uncertain caption';first.review.onclick();await first.settle();
  first.client.sendMessage=async()=>{assert.equal(record.status,'delivery-unknown');throw Error('original send response lost')};
  first.form.onsubmit({preventDefault(){}});await assert.rejects(first.settle(),/response lost/);const transaction=record.transactionId;
  const second=fixture({drafts});second.restoreDraft.onclick();await second.settle();assert.equal(second.requests[0].action,'read');assert.equal(second.requests[0].transactionId,transaction);assert.equal(second.input.value,'Original uncertain caption');
  second.form.onsubmit({preventDefault(){}});await second.settle();assert.ok(second.requests.every(request=>request.transactionId===transaction));assert.equal(record,null);assert.equal(second.input.value,'');
});
