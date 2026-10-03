import{createServer}from'node:http';import{spawn}from'node:child_process';import{readFileSync}from'node:fs';import{join}from'node:path';import assert from'node:assert/strict';

// JVM sender and store use the actual original SDK proof and original Go HTTP
// server. Fixed isolated loopback adapters only; no installed Android claim.
export async function checkOriginalJavaUpload({classes,backend,session,context,getConsumer,restore}){
 const receipt=JSON.parse(readFileSync(classes+'.json'));assert.equal(getConsumer().current.businessVerified,true);let uploadReplies=0,proofs=0,proxyCalls=0,driver;
 const server=createServer(async(req,res)=>{try{
  const parts=[];let length=0;for await(const part of req){length+=part.length;if(length>64*1024*1024)throw Error('Bounded original QA body required');parts.push(part)}const body=Buffer.concat(parts);
  if(req.url==='/qa/proof'){assert.equal(req.method,'POST');proofs++;const result=await getConsumer().prepareRequest(JSON.parse(body));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return}
  if(req.url==='/qa/restore'){assert.equal(req.method,'POST');const result=await restore();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return}
  assert(req.url.startsWith('/api/'));proxyCalls++;const headers={...req.headers};for(const key of ['host','connection','content-length'])delete headers[key];
  const response=await fetch(backend+req.url,{method:req.method,headers,body:req.method==='GET'?undefined:body,redirect:'error'}),bytes=Buffer.from(await response.arrayBuffer());
  if(req.method==='POST'&&req.url==='/api/creator/tracks'&&response.status===201&&uploadReplies++===0){res.destroy();return}
  const returned={...Object.fromEntries(response.headers)};for(const key of ['connection','transfer-encoding','content-length'])delete returned[key];res.writeHead(response.status,returned);res.end(bytes);
 }catch{if(!res.destroyed){res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"Original isolated SDK/business adapter failed"}')}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  driver=spawn(join(receipt.javaHome,'bin/java'),['-Dsun.net.http.retryPost=false','-Dynx.music.ownedFixtureOrigin='+origin,'-classpath',classes+':'+receipt.jsonDependency.path,'com.ynxweb4.music.OriginalUploadCheck',JSON.stringify({session,context})],{stdio:['ignore','pipe','pipe']});let output='',diagnostic='';driver.stdout.on('data',b=>output+=b);driver.stderr.on('data',b=>diagnostic=(diagnostic+b).slice(-3000));
  const status=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{driver.kill();reject(Error('Original Java upload timeout'))},40000);driver.on('error',reject);driver.on('close',code=>{clearTimeout(timeout);resolve(code)})});assert.equal(status,0,diagnostic);const result=JSON.parse(output);assert.equal(result.actualOriginalSDKProof,true);assert.equal(result.actualOrderedOriginalSnapshots,true);assert.equal(result.actualBusinessServerReadback,true);assert.equal(result.oneOriginalTrackAfterLostReplyColdRetry,true);assert.equal(result.sameAccountSignedAudioCache,true);assert.equal(uploadReplies,2);assert(proofs>=8&&proxyCalls>=8);return {...result,proofs,proxyCalls};
 }finally{driver?.kill();await new Promise(resolve=>server.close(resolve))}
}
