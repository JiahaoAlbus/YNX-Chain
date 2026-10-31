// Explicit isolated integration fixture: real compiled helper + actual PWA
// controller/HTTP/native service + fake RPC. Never a public finality claim.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,chmod,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runClientSmoke} from './client-smoke.mjs';
const helper=process.argv[2];if(!helper)throw Error('usage: node client-fixture-qa.mjs <compiled-helper> [evidence.json]');
const TX='0x5469bfc2a41b76150b765122e4dc5e02c3bbe66886c24f46efe0dfd60edea5ac';
const raw=' { "hash":"'+TX+'", "amount":9007199254740993, "nonce":18446744073709551615 }\n';
const paths=[];const rpc=createServer((req,res)=>{
 paths.push(req.url);res.setHeader('Content-Type','application/json');
 if(req.url==='/status')return res.end('{"height":12}');
 if(req.url==='/blocks/12')return res.end('{"height":12,"source":"isolated-fake-rpc"}');
 if(req.url==='/validators')return res.end('{"validators":[]}');
 if(req.url==='/txs/'+TX)return res.end(raw);
 if(req.url==='/txs/'+TX+'/pq-finality-proof')return res.end(JSON.stringify({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'isolated-fake-rpc',status:'collected',nativeTransactionHash:TX,executionHeight:'12',independentFinality:true,proofVerification:'forged-peer-verified'}));
 res.statusCode=404;res.end('{"error":"not supplied by isolated fixture"}');
});
await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
const dataDir=await mkdtemp(join(process.platform==='darwin'?'/private/tmp':tmpdir(),'ynx-client-qa-'));await chmod(dataDir,0o700);
let child;
async function launch(){
 const processHandle=spawn(helper,['--listen','127.0.0.1:0','--rpc','http://127.0.0.1:'+rpc.address().port,'--data-dir',dataDir],{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:dataDir,LANG:'C'}});child=processHandle;
 let output='',error='';processHandle.stdout.on('data',part=>{output+=part.toString();});processHandle.stderr.on('data',part=>{error+=part.toString();});
 const started=Date.now();while(Date.now()-started<10000){if(processHandle.exitCode!==null)throw Error('isolated helper exited before readiness');const origin=output.match(/Open: (http:\/\/[^\s]+)/)?.[1],code=output.match(/One-use pairing code: ([a-f0-9]+)/)?.[1];if(origin&&code)return {origin,code};await new Promise(resolve=>setTimeout(resolve,20));}
 throw Error('isolated helper readiness timeout');
}
async function stop(){if(!child||child.exitCode!==null)return;const current=child;const exited=once(current,'exit');current.kill('SIGTERM');await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('isolated helper close timeout')),5000).unref())]);child=undefined;}
try{
 const first=await launch(),one=await runClientSmoke({...first,txId:TX});if(one.liveLevel!=='RPC_ONLY')throw Error('fake collector obtained independent verified level');
 const expectedRaw=createHash('sha256').update(raw).digest('hex');if(one.rawReportSHA256!==expectedRaw||one.historicalRawReportSHA256!==expectedRaw)throw Error('exact huge-numeric raw report changed');
 await stop();const second=await launch(),two=await runClientSmoke({...second,txId:TX,priorReceiptId:one.receiptId});if(two.historicalRawReportSHA256!==expectedRaw)throw Error('original snapshot changed after real helper restart');await stop();
 const source=await readFile(new URL('./app.js',import.meta.url));const sha=createHash('sha256').update(source).digest('hex');if(one.sourceSHA256!==sha||two.sourceSHA256!==sha)throw Error('compiled helper embedded a different client');
 const evidence={classification:'isolated-real-helper-controller-http-native',publicNetwork:false,browserOrGUI:false,dataDir,appSHA256:sha,rawReportSHA256:expectedRaw,first:one,restarted:two,observedFixedRPCPaths:[...new Set(paths)],normalServiceRestart:true,authorityClaim:false};
 if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(evidence,null,2)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
}finally{if(child&&child.exitCode===null){child.kill('SIGKILL');await once(child,'exit');}await new Promise(resolve=>rpc.close(resolve));}
