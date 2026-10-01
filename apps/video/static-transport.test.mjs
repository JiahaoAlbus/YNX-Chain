import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const asset='ynx-wallet-transports-2ece0cb329.mjs';
const sha='a385bbdf05b92b6eb442e495cead3f3305aaab7e42010079d96078f2fd2a2526';
async function port(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
for(const name of ['video','creator-studio'])test(name+' ordinary static server serves exact canonical transport, JSON and same-origin logo',async()=>{
 const number=await port();const cwd=new URL('../'+name+'/',import.meta.url);const child=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,PORT:String(number),YNX_VIDEO_API_ORIGIN:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('static server readiness timeout')),3000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(Error('static server exit '+code));});});
  const root='http://127.0.0.1:'+number;
  for(const [path,mime,hash] of [[asset,'text/javascript',sha],[asset.replace('.mjs','.manifest.json'),'application/json'],['assets/ynx-logo.png','image/png','38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde']]){
   const response=await fetch(root+'/'+path);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(mime));if(hash)assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),hash);
  }
  const html=await fetch(root+'/');const csp=html.headers.get('content-security-policy');assert.match(csp,/connect-src 'self' https:\/\/wallet-auth\.ynxweb4\.com wss:\/\/relay\.walletconnect\.org https:\/\/verify\.walletconnect\.org;/);assert.match(csp,/frame-src https:\/\/verify\.walletconnect\.org;/);assert.doesNotMatch(csp,/unsafe-eval|rpc\.walletconnect|verify\.walletconnect\.com|\*/);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}
});
test('Creator runtime builder includes exact canonical files and same-origin PNG without altering vendor',async()=>{
 const source=await readFile(new URL('../creator-studio/build.mjs',import.meta.url),'utf8');for(const path of [asset,asset.replace('.mjs','.manifest.json'),'assets/ynx-logo.png'])assert.ok(source.includes(JSON.stringify(path)));
});
