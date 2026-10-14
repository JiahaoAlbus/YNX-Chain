import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createWatchProgress} from './watch-progress.js';
import {videoScope} from './business-scope.js';
const {createVideoAPI}=await import(process.env.YNX_VIDEO_API_SOURCE||new URL('./video-api.js',import.meta.url));

test('Video lost accepted POST PUT DELETE responses never cause a second write or replacement key',async t=>{
  for(const [method,path] of [['POST','/v1/playlists'],['PUT','/v1/channels/owned/subscription'],['DELETE','/v1/privacy/account-data']])await t.test(method,async()=>{
    const writes=[];let keys=0,firstCause;
    const server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);writes.push({method:req.method,body:Buffer.concat(chunks).toString(),key:req.headers['idempotency-key']});if(writes.length===1)req.socket.destroy();else res.end('{}');});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',getAccount:()=> 'owner-a',requestId:()=>`original-video-key-${++keys}`,authorize:async()=>({}),fetch:async(_url,init)=>{let response;try{response=await fetch(`http://127.0.0.1:${server.address().port}/fixture`,init);}catch(error){firstCause??=error;throw error;}return new Response(response.body,{status:response.status,headers:response.headers});}});
      const body='{"original":"wire"}';let error;try{await api(path,{private:true,method,body});}catch(value){error=value;}
      assert.equal(writes.length,1,'service already accepted first write; response loss must not replay it');assert.equal(error?.code,'VIDEO_MUTATION_UNKNOWN');
      assert.equal(error.pending.body,body);assert.equal(error.pending.key,writes[0].key);assert.equal(error.pending.firstCause,error.cause);
      assert.equal(error.cause,firstCause);
      await assert.rejects(api(path,{private:true,method,body:'changed',headers:{'Idempotency-Key':'replacement-original-key'}}),next=>next.code==='VIDEO_MUTATION_UNKNOWN'&&next.pending===error.pending);
      assert.equal(writes.length,1);assert.equal(keys,1);
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
});

test('Video interrupted old account mutation is retained but cannot retry under the new account',async()=>{
  let account='owner-a',calls=0,received;const started=new Promise(resolve=>{received=resolve;});const abort=new AbortController();
  const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',getAccount:()=>account,authorize:async()=>({}),fetch:(_url,init)=>{calls++;if(calls>1)return Promise.resolve(new Response('{}'));received();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}});
  const pending=api('/v1/playlists',{private:true,method:'POST',body:'original',signal:abort.signal});const outcome=pending.catch(error=>error);
  await started;account='owner-b';abort.abort(new Error('Account changed'));const error=await outcome;assert.equal(error.code,'VIDEO_MUTATION_UNKNOWN');assert.equal(error.pending.account,'owner-a');assert.equal(calls,1);
  await api('/v1/playlists',{private:true,method:'POST',body:'new account'});account='owner-a';await assert.rejects(api('/v1/playlists',{private:true,method:'POST',body:'new key'}),next=>next.code==='VIDEO_MUTATION_UNKNOWN');assert.equal(calls,2);
  await api('/v1/videos/other/comments',{private:true,method:'POST',body:'other action'});assert.equal(calls,3);
});

test('Video unknown watch batch pauses both automatic samples and later flushes',async()=>{
  let sends=0,ids=0,now=0;const error=Object.assign(new Error('watch result unconfirmed'),{code:'VIDEO_MUTATION_UNKNOWN'});
  const watch=createWatchProgress({signedIn:()=>true,clock:()=>now,idFactory:()=>`batch-${++ids}`,send:async()=>{sends++;throw error;}});
  watch.sample({position:0,paused:false,seeking:false});now=1000;watch.sample({position:1,paused:false,seeking:false});await assert.rejects(watch.flush(),value=>value===error);
  for(let i=2;i<40;i++){now=i*1000;watch.sample({position:i,paused:false,seeking:false});}
  await new Promise(resolve=>setImmediate(resolve));await assert.rejects(watch.flush(true),value=>value===error);assert.equal(sends,1);assert.equal(ids,2);
});

test('Video read retries remain safe and Creator upload/processing/publish are not Video actions',async()=>{
  let calls=0;const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',fetch:async()=>{if(++calls===1)throw Error('read disconnected');return new Response('[]');}});
  assert.deepEqual(await api('/v1/videos'),[]);assert.equal(calls,2);
  for(const [path,method] of [['/v1/uploads','POST'],['/v1/videos/owned/retry-processing','POST'],['/v1/videos/owned/submit-review','POST'],['/v1/videos/owned/metadata','PATCH']])assert.throws(()=>videoScope(path,method),/not available/);
});

test('Video lost mutation response body retains the first cause and original wire',async()=>{
  const cause=new TypeError('original body connection lost');let calls=0;
  const api=createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',getAccount:()=> 'owner-a',authorize:async()=>({}),fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>{throw cause;}};}});
  await assert.rejects(api('/v1/playlists',{private:true,method:'POST',body:'original'}),error=>error.code==='VIDEO_MUTATION_UNKNOWN'&&error.cause===cause&&error.pending.firstCause===cause&&error.pending.body==='original');
  await assert.rejects(api('/v1/playlists',{private:true,method:'POST',body:'replacement'}),{code:'VIDEO_MUTATION_UNKNOWN'});assert.equal(calls,1);
});
