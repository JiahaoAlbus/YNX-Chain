import assert from 'node:assert/strict';
import {createSocialAudienceHTTPClient} from '../web/matrix/audience-client.mjs';
const account='ynx1'+'a'.repeat(38),scopes=['social.contacts','social.feed','social.messaging','social.profile'];
const results=[];
const fixture=({connected=true,response={indexes:[]},late=false}={})=>{
  let generation=1,requests=0,observed=null;
  const session={current:{status:connected?'connected':'approval-required',session:{account,scopes}},restore:async()=>({status:'connected',session:{account,scopes}}),proof:async requested=>{assert.deepEqual(requested,scopes);return {proofHeader:'synthetic-original-introspection'}}};
  const client=createSocialAudienceHTTPClient({session,capture:()=>({account,generation}),guard:view=>assert.equal(view.generation,generation,'old captured view must not return indexes'),csrfToken:async()=>{throw new Error('read must not require action csrf')},fetcher:async(url,options)=>{++requests;observed={url,options};if(late)++generation;return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}})}});
  return {client,get requests(){return requests},get observed(){return observed}};
};
let test=fixture();assert.deepEqual(await test.client.indexes(),{indexes:[],after:undefined});assert.equal(test.requests,1);
assert.equal(test.observed.url,'/social/v3/matrix/audience/indexes');assert.equal(test.observed.options.credentials,'same-origin');assert.equal(test.observed.options.redirect,'error');assert.equal(test.observed.options.cache,'no-store');assert.equal(test.observed.options.headers['X-YNX-Product-Session-Proof-V2'],'synthetic-original-introspection');
results.push({name:'actual HTTP consumer empty metadata index',status:'PASS'});
test=fixture({connected:false});await assert.rejects(()=>test.client.indexes());assert.equal(test.requests,0);results.push({name:'no silent approval or scope upgrade',status:'PASS'});
test=fixture({late:true});await assert.rejects(()=>test.client.indexes());assert.equal(test.requests,1);results.push({name:'late response rejects changed captured generation',status:'PASS'});
test=fixture({response:{indexes:[],text:'must not be returned'}});await assert.rejects(()=>test.client.indexes());results.push({name:'unexpected plaintext metadata rejected',status:'PASS'});
test=fixture();await assert.rejects(()=>test.client.indexes('untrusted-cursor'));assert.equal(test.requests,0);results.push({name:'invalid cursor rejected before request',status:'PASS'});
console.log(JSON.stringify({qualification:'actual Social HTTP consumer with controlled fetch/session, not production authority',pass:results.length,fail:0,skip:0,results},null,2));
