import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';
import {createMediaSessionEvents,createMediaReturnLocation} from './session-events.js';
import {createMediaReturnLocation as creatorReturn} from '../creator-studio/session-events.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('account changes during proof generation prevent a private mutation from reaching the service',async()=>{
 const proof=deferred();let current=true,calls=0,unauthorized=0;
 const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:()=>proof.promise,fetch:async()=>{calls++;},onUnauthorized:()=>unauthorized++});
 const pending=api('/v1/playlists',{private:true,method:'POST',assertCurrent:()=>{if(!current)throw Error('account changed');}});
 current=false;proof.resolve({'X-YNX-Product-Session-Proof-V2':'fixture'});
 await assert.rejects(pending,/account changed/);assert.equal(calls,0);assert.equal(unauthorized,0);
});

test('an old 401 arriving after a new account cannot invalidate the new account',async()=>{
 const response=deferred();let current=true,unauthorized=0;
 const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:async()=>({}),fetch:()=>response.promise,onUnauthorized:()=>unauthorized++});
 const pending=api('/v1/history',{private:true,assertCurrent:()=>{if(!current)throw Error('account changed');}});
 await new Promise(r=>setImmediate(r));current=false;response.resolve({ok:false,status:401,json:async()=>({error:'expired'})});
 await assert.rejects(pending,/account changed/);assert.equal(unauthorized,0);
});

for(const [product,origin,views,factory] of [['video','https://video.ynxweb4.com',['history'],createMediaReturnLocation],['creator-studio','https://creator.ynxweb4.com',['upload'],creatorReturn]]){
 test(product+' callback resumes the original view only for the matching verified session',()=>{
  const storage=new Map();const environment={location:{origin,href:origin+'/?lang=zh-CN'},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)}};
  const returns=factory(product,views,environment),request={state:'request-one',expiresAt:new Date(Date.now()+60000).toISOString()};
  returns.remember(request,views[0],product==='video'?{video:'owned_video',mediaChannel:'owned_channel',mediaPlaylist:'owned_list'}:{});assert.equal(returns.consume({state:'wrong'}),'/');
  assert.equal(returns.consume({state:request.state}),'/?lang=zh-CN&mediaView='+views[0]+(product==='video'?'&video=owned_video&mediaChannel=owned_channel&mediaPlaylist=owned_list':''));assert.equal(storage.size,0);
  for(const path of ['https://evil.example/?mediaView='+views[0],'//evil.example/?mediaView='+views[0],'/wallet-auth/callback?mediaView='+views[0],'/?result=signed&mediaView='+views[0]]){
   storage.set('ynx.'+product+'.return-location',JSON.stringify({...request,path}));assert.equal(returns.consume({state:request.state}),'/');
  }
 });
}

test('cross-tab hints deduplicate the two browser transports and contain no account or proof',()=>{
 const messages=[],storage=[],handlers=new Map();let channel;
 class Channel{constructor(){channel=this;}postMessage(message){messages.push(message);}close(){}}
 const environment={window:{BroadcastChannel:Channel,addEventListener:(e,fn)=>handlers.set(e,fn)},crypto:{randomUUID},localStorage:{setItem:(key,value)=>storage.push({key,value})}};
 const events=createMediaSessionEvents('video',environment);let restores=0;events.subscribe(()=>restores++);events.announce();
 assert.deepEqual(Object.keys(messages[0]).sort(),['event','id']);
 channel.onmessage({data:messages[0]});assert.equal(restores,0);
 const changed={event:'changed',id:randomUUID()};channel.onmessage({data:changed});handlers.get('storage')({key:storage[0].key,newValue:JSON.stringify(changed)});assert.equal(restores,1);
 channel.onmessage({data:{event:'changed',id:'forged',account:'owner'}});assert.equal(restores,1);events.close();
});

test('cancellation settles an uncooperative private authorization without emitting a request',async()=>{
 const controller=new AbortController();let calls=0;
 const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:()=>new Promise(()=>{}),fetch:async()=>{calls++}});
 const pending=api('/v1/history',{private:true,signal:controller.signal});controller.abort();
 const result=await Promise.race([pending.then(()=> 'accepted',e=>e.name),new Promise(r=>setTimeout(()=>r('hung'),80))]);
 assert.equal(result,'AbortError');assert.equal(calls,0);
});

for(const stage of ['network','body'])test('cancellation settles an uncooperative '+stage+' without invalidating another account',async()=>{
 const controller=new AbortController();let unauthorized=0,started;const ready=new Promise(r=>started=r);
 const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:async()=>({}),onUnauthorized:()=>unauthorized++,fetch:()=>{if(stage==='network'){started();return new Promise(()=>{})}return {ok:true,status:200,json:()=>{started();return new Promise(()=>{})}}}});
 const pending=api('/v1/history',{private:true,signal:controller.signal});await ready;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(unauthorized,0);
});
test('the complete Video request has the real 15 second authority deadline',async()=>{
 let calls=0;const start=Date.now();const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:()=>new Promise(()=>{}),fetch:async()=>{calls++}});
 await assert.rejects(api('/v1/history',{private:true}),{name:'TimeoutError'});assert.ok(Date.now()-start>=14900);assert.equal(calls,0);
});
test('unbounded responses and foreign response locations are rejected before use',async()=>{
 for(const response of [new Response('{}',{headers:{'Content-Length':String(16*1024*1024+1)}}),{ok:true,status:200,redirected:true,json:async()=>({private:'foreign'})}]){
 const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:async()=>({}),fetch:async()=>response});await assert.rejects(api('/v1/history',{private:true}),/supported limit|Unexpected/);
 }
 for(const route of ['/v1/%2e%2e/history','/v1/history#other','/v1/history\\other','/v1//history']){let calls=0;const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',fetch:()=>{calls++}});await assert.rejects(api(route),/Invalid/);assert.equal(calls,0)}
});

test('only original private Video requests carry same-origin cookies alongside fresh SDK proof',async()=>{
 const calls=[];let signed=0;
 const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:async()=>({'X-YNX-Product-Session-Action-Proof-V2':'original-'+ ++signed}),fetch:async(url,options)=>{calls.push(options);return new Response('{}')}});
 await api('/v1/videos',{credentials:'include'});
 await api('/v1/history',{private:true,credentials:'omit'});
 assert.equal(calls[0].credentials,'omit');assert.equal(calls[0].headers['X-YNX-Product-Session-Action-Proof-V2'],undefined);
 assert.equal(calls[1].credentials,'same-origin');assert.equal(calls[1].headers['X-YNX-Product-Session-Action-Proof-V2'],'original-1');assert.equal(calls[1].redirect,'error');
 let fetched=false;
 const denied=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:async()=>{throw Error('original SDK unavailable')},fetch:async()=>{fetched=true}});
 await assert.rejects(denied('/v1/history',{private:true}),/SDK unavailable/);assert.equal(fetched,false);
});
