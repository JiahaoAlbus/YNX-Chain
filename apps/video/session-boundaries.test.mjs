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
  returns.remember(request,views[0]);assert.equal(returns.consume({state:'wrong'}),'/');
  assert.equal(returns.consume({state:request.state}),'/?lang=zh-CN&mediaView='+views[0]);assert.equal(storage.size,0);
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
