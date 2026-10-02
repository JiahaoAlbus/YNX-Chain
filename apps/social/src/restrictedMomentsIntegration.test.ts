import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore actual browser UI
import {createRestrictedMomentsUI} from '../web/matrix/restricted-moments-ui.mjs';
// @ts-ignore actual HTTP adapter
import {createSocialAudienceHTTPClient} from '../web/matrix/audience-client.mjs';

// Minimal DOM driver, not installed/browser acceptance. The actual UI handlers,
// policy consumer and HTTP adapter are used without replacing their methods.
function fixture(){
  const nodes:any[]=[];const document:any={createElement:(tag:string)=>{
    const listeners:any={};const node:any={tag,ownerDocument:document,children:[],value:tag==='select'?'contacts':'',disabled:false,textContent:'',attributes:{},append(...children:any[]){this.children.push(...children)},replaceChildren(...children:any[]){this.children=children},setAttribute(key:string,value:string){this.attributes[key]=value},addEventListener(event:string,callback:any){listeners[event]=callback},dispatch(event:string){listeners[event]?.()},get selectedOptions(){return this.children.filter((option:any)=>option.selected)}};nodes.push(node);return node;
  }};
  const container=document.createElement('div'),userId='@original:fixture.invalid';let content:any,last:Promise<any>=Promise.resolve();
  const metadata={kind:'contacts',members:[userId],owner:userId,protocol:'ynx-social-matrix-moment/v1',revision:'a'.repeat(64),roomId:'!original:fixture.invalid'};
  const requests:any[]=[];const binding={account:'synthetic-account',userId,deviceId:'original-device'};
  const client={getRoom:()=>({getMembers:()=>[{userId,membership:'join'}]}),sendMessage:async(_room:string,input:any,transaction:string)=>{content=input;assert.equal(transaction,requests[1].transactionId);return {event_id:'$original'}}};
  const operation={binding,client,generation:1},view={account:binding.account,operation};
  const transport={capture:()=>operation,guard:()=>{},assertTrusted:async()=>{},messages:async()=>[{id:'$original',sender:userId,encrypted:true,verification:{shieldColour:0},content}]};
  const session={current:{status:'connected',session:{account:binding.account,scopes:['social.contacts','social.feed','social.messaging','social.profile']}},restore:async()=>session.current,createSocialAudienceProof:async(input:any)=>({body:input.body,proofHeader:'synthetic-action',introspection:{proofHeader:'synthetic-introspection'}})};
  const http=createSocialAudienceHTTPClient({session,capture:()=>view,guard:()=>{},csrfToken:async()=> 'synthetic-csrf',fetcher:async(url:RequestInfo|URL,options?:RequestInit)=>{
    const body=JSON.parse(String(options?.body));requests.push(body);
    if(String(url).endsWith('/resolve')){
      assert.equal('account' in body,false);assert.ok(['kind','groupId','selected'].every(key=>Object.keys(body).includes(key)||key!=='kind'));
      assert.ok(Object.keys(body).every(key=>['kind','groupId','selected'].includes(key)));metadata.kind=body.kind;
    }else{
      assert.ok(['read','publish','index'].includes(body.action));assert.match(body.transactionId,/^[A-Za-z0-9_-]{16,128}$/);
      assert.ok(Object.keys(body).every(key=>['action','transactionId','expected','eventId','parentEventId'].includes(key)));
      if(body.action==='index')assert.equal(body.eventId,'$original');
    }
    return new Response(JSON.stringify(metadata),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  createRestrictedMomentsUI({container,transport,capture:()=>view,guard:()=>{},identity:async()=>{},work:(action:any)=>{last=Promise.resolve().then(()=>action());return last},resolveAudience:http.resolve,authorize:http.authorize,
    loadSelections:async()=>({groups:[{id:'group_'+'a'.repeat(24),title:'Original group'}],contacts:[{id:'sp_'+'a'.repeat(32),title:'Accepted friend'}]})});
  const label=(name:string)=>nodes.find(node=>node.attributes['aria-label']===name);
  return {requests,metadata,input:label('Restricted Moment draft'),choice:label('Restricted Moment audience'),group:label('Existing group'),people:label('Accepted friends'),review:nodes.find(node=>node.textContent==='Review audience'),form:nodes.find(node=>node.tag==='form'),settle:()=>last};
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
