import assert from 'node:assert/strict';
import {encryptAttachment} from 'matrix-encrypt-attachment';
import {getHttpUriForMxc} from 'matrix-js-sdk/lib/content-repo.js';
import {MatrixSocialTransport} from '../web/matrix/transport.mjs';
import {RestrictedMoments} from '../web/matrix/restricted-moments.mjs';

const results=[];
const source=new TextEncoder().encode('Original isolated encrypted attachment');
const encrypted=await encryptAttachment(source.buffer);
const content={msgtype:'m.file',body:'original.txt',file:{...encrypted.info,url:'mxc://media.fixture.invalid/original'}};
const audience={protocol:'ynx-social-matrix-moment/v1',kind:'private',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner:'@original:fixture.invalid',members:['@original:fixture.invalid']};
const index={audience,eventId:'$original',sender:audience.owner,transactionId:'original_transaction_123'};
const record={id:index.eventId,sender:index.sender,encrypted:true,verification:{shieldColour:0},content:{...content,'com.ynx.social.moment':{protocol:audience.protocol,kind:'moment',audience:audience.kind,revision:audience.revision,owner:audience.owner,author:index.sender,text:'Original caption'}}};
function fixture({response,url,onFetch,revalidate}={}){
  const requests=[];
  const transport=new MatrixSocialTransport({fetcher:async(uri,options)=>{requests.push({uri,options});onFetch?.(transport);return response?response():new Response(encrypted.data)}});
  transport.binding={homeserver:'https://hs.fixture.invalid/',accessToken:'isolated-software-qa-not-a-real-token',userId:audience.owner,deviceId:'original-device',account:'ynx1'+'a'.repeat(38)};
  transport.client={mxcUrlToHttp:(mxc,...args)=>url??getHttpUriForMxc(transport.binding.homeserver,mxc,...args),getRoom:()=>({getMembers:()=>[{userId:audience.owner,membership:'join'}]}),stopClient(){}};
  transport.messages=async()=>[structuredClone(record)];
  let allowed=true;
  const consumer=new RestrictedMoments({transport,authorize:async()=>{if(!allowed)throw new Error('audience revoked');return structuredClone(audience)}});
  return {transport,consumer,requests,revoke:()=>{allowed=false},download:()=>transport.downloadAttachment(content,{revalidate:async()=>revalidate?.(transport)})};
}
async function test(name,run){try{await run();results.push({name,status:'PASS'})}catch(error){results.push({name,status:'FAIL',error:error.message})}}
await test('real SDK roundtrip without optional info',async()=>{const f=fixture();assert.deepEqual(new Uint8Array(await f.download()),source);assert.equal(f.requests.length,1);const request=f.requests[0];assert.equal(new URL(request.uri).origin,'https://hs.fixture.invalid');assert.equal(new URL(request.uri).searchParams.get('allow_redirect'),'false');assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');assert.equal(request.options.referrerPolicy,'no-referrer');assert.equal(request.options.headers.Authorization,'Bearer isolated-software-qa-not-a-real-token');assert.equal(f.transport.downloads.size,0)});
await test('real SDK roundtrip with descriptor size',async()=>{const f=fixture();assert.deepEqual(new Uint8Array(await f.transport.downloadAttachment({...content,info:{size:source.byteLength,mimetype:'text/plain'}})),source)});
await test('actual indexed consumer downloads original encrypted event',async()=>{const f=fixture();const decoded=await f.consumer.read(index);assert.deepEqual(new Uint8Array(await f.consumer.downloadAttachment(index,decoded.attachment)),source)});
await test('mature SDK rejects ciphertext hash corruption',async()=>{const bytes=new Uint8Array(encrypted.data.slice(0));bytes[0]^=1;const f=fixture({response:()=>new Response(bytes)});await assert.rejects(f.download());assert.equal(f.transport.downloads.size,0)});
for(const [name,url] of [
  ['foreign origin','https://foreign.fixture.invalid/_matrix/client/v1/media/download/media.fixture.invalid/original'],
  ['same origin wrong media','https://hs.fixture.invalid/_matrix/client/v1/media/download/media.fixture.invalid/replaced'],
  ['same origin arbitrary route','https://hs.fixture.invalid/sso/account'],
  ['unauthenticated media route','https://hs.fixture.invalid/_matrix/media/v3/download/media.fixture.invalid/original'],
  ['credentialed URL','https://user:password@hs.fixture.invalid/_matrix/client/v1/media/download/media.fixture.invalid/original'],
  ['URL token query','https://hs.fixture.invalid/_matrix/client/v1/media/download/media.fixture.invalid/original?access_token=bad'],
])await test(name+' blocked before credentialed fetch',async()=>{const f=fixture({url});await assert.rejects(f.download());assert.equal(f.requests.length,0)});
await test('redirect response cannot produce plaintext',async()=>{const f=fixture({response:()=>{const response=new Response(encrypted.data);Object.defineProperty(response,'redirected',{value:true});return response}});await assert.rejects(f.download())});
await test('oversized declared length rejected before stream read',async()=>{let reads=0;const f=fixture({response:()=>({ok:true,headers:new Headers({'content-length':String(25*1024*1024+1)}),body:{getReader(){reads++;throw Error('must not read')}}})});await assert.rejects(f.download());assert.equal(reads,0)});
await test('bounded stream rejects overflow and cancels',async()=>{let reads=0,cancelled=false;const f=fixture({response:()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(++reads===1?25*1024*1024:1)}),cancel:async()=>{cancelled=true},releaseLock(){}})}})});await assert.rejects(f.download());assert.equal(reads,2);assert.equal(cancelled,true)});
await test('declared body length mismatch rejected',async()=>{const f=fixture({response:()=>new Response(encrypted.data,{headers:{'content-length':String(source.byteLength+1)}})});await assert.rejects(f.download())});
await test('descriptor body length mismatch rejected',async()=>{const f=fixture();await assert.rejects(f.transport.downloadAttachment({...content,info:{size:source.byteLength+1}}))});
await test('account generation changed during fetch drops result',async()=>{const f=fixture({onFetch:transport=>{transport.generation++}});await assert.rejects(f.download());assert.equal(f.transport.downloads.size,0)});
await test('permission revocation after stream await drops result',async()=>{let allowed=true,cancelled=false;const f=fixture({response:()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:async()=>{allowed=false;return {done:false,value:new Uint8Array(encrypted.data)}},cancel:async()=>{cancelled=true},releaseLock(){}})}}),revalidate:()=>{if(!allowed)throw Error('revoked')}});await assert.rejects(f.download());assert.equal(cancelled,true)});
await test('stop aborts live fetch signal and discards original result',async()=>{let f;f=fixture({onFetch:transport=>transport.stop()});await assert.rejects(f.download());assert.equal(f.requests[0].options.signal.aborted,true)});
await test('indexed attachment substitution rejected before download',async()=>{const f=fixture();await assert.rejects(f.consumer.downloadAttachment(index,{...record.content,body:'replacement.txt'}));assert.equal(f.requests.length,0)});
await test('indexed audience revoke during media fetch blocks plaintext',async()=>{let f;f=fixture({onFetch:()=>f.revoke()});await assert.rejects(f.consumer.downloadAttachment(index,record.content));assert.equal(f.requests.length,1)});
await test('view epoch changes after read await blocks media dispatch',async()=>{const f=fixture();let epoch=1;f.transport.messages=async()=>{epoch++;return [structuredClone(record)]};await assert.rejects(f.consumer.downloadAttachment(index,record.content,{assertCurrent:()=>{if(epoch!==1)throw Error('stale view')}}));assert.equal(f.requests.length,0)});
console.log(JSON.stringify({qualification:'isolated real locked SDK/WebCrypto/Response stream and actual owned transport/indexed consumer; controlled Matrix SDK session/authority, not live HS or installed acceptance',results},null,2));
if(results.some(result=>result.status!=='PASS'))process.exitCode=1;
