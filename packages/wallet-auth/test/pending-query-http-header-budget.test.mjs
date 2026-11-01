import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import net from 'node:net';import {createServer} from 'node:http';import {execFileSync} from 'node:child_process';
import {withOriginalPendingQueryHTTPHeaderBudget} from '../src/original-pending-query-http-header-budget-private.js';
const pkg=path.resolve(import.meta.dirname,'..'),red=process.env.ORIGINAL_HEADER_BASELINE==='1',base='ad9d7c5a8b5e876a0b5d59ea478f0befc3cd4b2f';
const managementProof='x-ynx-product-session-proof-v4',managementRoutes=['/v4/product-sessions/active','/v4/product-sessions/recover','/v4/product-sessions/revoke','/v4/product-session-challenges/cancel'];
const proof='x-ynx-product-pair-original-query-proof-v1',query='/v4/product-pairs/original-query';
function callAt(s,start){let n=0,q=null,escape=false;for(let i=start;i<s.length;i++){const c=s[i];if(q){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===q)q=null;continue;}if(c==='"'||c==="'"||c==='`'){q=c;continue;}if(c==='(')n++;else if(c===')'&&--n===0)return s.slice(start,i+1);}throw Error('UNBALANCED_PRODUCTION_CALL');}
async function fixture(kind){const rel=kind==='host'?'src/product-session-gateway-node-host.js':'scripts/ynx-wallet-gatewayd.mjs',s=red?execFileSync('git',['-C',process.env.ORIGINAL_HEADER_GIT_REPO,'show',base+':packages/wallet-auth/'+rel],{encoding:'utf8'}):fs.readFileSync(path.join(pkg,rel),'utf8');const marker=kind==='host'?'const server=createServer(':':createServer(';assert.equal(s.split(marker).length,2,'unique actual production constructor');const expression=callAt(s,s.indexOf('createServer(',s.indexOf(marker))),state={admissions:0,effects:0,raw:0},dispatch=(_req,res)=>{state.effects++;res.writeHead(204);res.end();},enter=()=>{state.admissions++;return {ok:true,release(){}};};const context=vm.createContext({createServer,withOriginalPendingQueryHTTPHeaderBudget:red?vm.runInNewContext(execFileSync('git',['-C',process.env.ORIGINAL_HEADER_GIT_REPO,'show',base+':packages/wallet-auth/src/original-pending-query-http-header-budget-private.js'],{encoding:'utf8'}).replace('export function ','function ')+';withOriginalPendingQueryHTTPHeaderBudget',{Buffer,Reflect,TypeError}):withOriginalPendingQueryHTTPHeaderBudget,GatewayAdmissionController:{prototype:{enter}},admission:{enter},forwardedClient:()=>null,canonicalJSON:JSON.stringify,dispatch,gatewayHandler:dispatch,emitEvent(){},Promise,Date,Error});
 if(kind==='host'){const start=s.indexOf('const listener=')+'const listener='.length,end=s.indexOf('\n    const server=',start);assert.ok(start>14&&end>start);context.listener=vm.runInContext('('+s.slice(start,end).trim().replace(/;$/,'')+')',context);}
 const server=vm.runInContext(expression,context);context.server=server;if(!red){const property=s.match(/server\.maxHeadersCount=65536;[^\n]*/g);assert.equal(property?.length,1);vm.runInContext(property[0],context);assert.equal(server.maxHeadersCount,65536);assert.equal(server.maxHeaderSize,262144);}else assert.equal(server.maxHeaderSize,147456);
 server.prependListener('request',req=>{state.raw=req.rawHeaders.length/2;});await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});return {server,state};}
async function wire(server,{method='POST',url=query,headers=[]}){return new Promise((yes,no)=>{const socket=net.createConnection({host:'127.0.0.1',port:server.address().port});let raw='';const timer=setTimeout(()=>{socket.destroy();no(Error('PUBLIC_LOOPBACK_TIMEOUT'));},5000);socket.once('connect',()=>socket.write(method+' '+url+' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n'+headers.map(([k,v])=>k+': '+v+'\r\n').join('')+'\r\n'));socket.on('data',b=>raw+=b);socket.on('error',e=>{if(!raw){clearTimeout(timer);no(e);}});socket.on('close',()=>{clearTimeout(timer);const m=/^HTTP\/1\.1 ([0-9]{3})/.exec(raw);if(!m)no(Error('NO_HTTP_STATUS '+raw.slice(0,100)));else yes(Number(m[1]));});});}
for(const kind of ['host','fallback'])test('actual '+kind+' constructor '+(red?'old large-proof failure':'finite parser and pre-admission route budgets'),async()=>{const {server,state}=await fixture(kind);try{
 const cases=red?[{name:'old constructor management proof reaches handler',url:managementRoutes[0],headers:[[managementProof,'P'.repeat(180000)]],status:204}]:[
 {name:'small ordinary route retained',url:'/health',method:'GET',headers:[],status:204},
 {name:'large fixed-route proof passes',headers:[[proof,'P'.repeat(20000)]],status:204},
 {name:'proof exact 131072 passes',headers:[[proof,'P'.repeat(131072)]],status:204},
 {name:'proof over cap refuses',headers:[[proof,'P'.repeat(131073)]],status:431},
 {name:'other headers over 16384 refuse',headers:[[proof,'P'.repeat(20000)],['x-other','X'.repeat(16384)]],status:431},
 {name:'mixed-case duplicate refuses',headers:[[proof,'P'],[proof.toUpperCase(),'Q']],status:431},
 {name:'tail duplicate beyond default 2000 refuses',headers:[[proof,'P'.repeat(20000)],...Array.from({length:2100},()=>['a','']),[proof.toUpperCase(),'Q']],status:431,tail:true},
 {name:'foreign route keeps 16KiB',url:'/health',headers:[[proof,'P'.repeat(20000)]],status:431},
 {name:'long foreign request-target retains parser budget',url:'/'+ 'a'.repeat(17000),method:'GET',headers:[],status:431},
 {name:'GET query gets no exception',method:'GET',headers:[[proof,'P'.repeat(20000)]],status:431},
 {name:'query string not exact route',url:query+'?a=1',headers:[[proof,'P'.repeat(20000)]],status:431},
 {name:'pending retains 147456 in route guard under larger parser',headers:[[proof,'P'.repeat(131072)],['x-other','X'.repeat(20000)]],status:431,guard:true},
 {name:'global parser 262144 cap',url:managementRoutes[0],headers:[[managementProof,'P'.repeat(196608)],['x-other','X'.repeat(70000)]],status:431,parser:true},
 ...managementRoutes.flatMap(url=>[
 {name:url+' large proof',url,headers:[[managementProof,'P'.repeat(180000)]],status:204},
 {name:url+' exact 196608',url,headers:[[managementProof,'P'.repeat(196608)]],status:204},
 {name:url+' over proof cap',url,headers:[[managementProof,'P'.repeat(196609)]],status:431},
 {name:url+' other headers cap',url,headers:[[managementProof,'P'.repeat(180000)],['x-other','X'.repeat(16384)]],status:431},
 {name:url+' wrong proof family',url,headers:[[proof,'P'.repeat(20000)]],status:431},
 {name:url+' both proof families',url,headers:[[managementProof,'P'],[proof,'P']],status:431},
 {name:url+' duplicate',url,headers:[[managementProof,'P'],[managementProof.toUpperCase(),'Q']],status:431},
 {name:url+' tail duplicate',url,headers:[[managementProof,'P'.repeat(180000)],...Array.from({length:2100},()=>['a','']),[managementProof.toUpperCase(),'Q']],status:431,tail:true},
 {name:url+' wrong method',method:'GET',url,headers:[[managementProof,'P'.repeat(180000)]],status:431},
 {name:url+' approximate path',url:url+'/',headers:[[managementProof,'P'.repeat(180000)]],status:431}
 ]),
 {name:'pending cannot borrow management proof',headers:[[managementProof,'P'.repeat(180000)]],status:431},
 {name:'pending proof never expands to management cap',headers:[[proof,'P'.repeat(180000)]],status:431},
 {name:'foreign route cannot borrow management cap',url:'/foreign',headers:[[managementProof,'P'.repeat(180000)]],status:431}];
 for(const c of cases){state.admissions=0;state.effects=0;state.raw=0;const status=await wire(server,c);assert.equal(status,c.status,c.name);assert.equal(state.effects,c.status===204?1:0,c.name+' effects');assert.equal(state.admissions,c.status===204?1:0,c.name+' admission');if(c.tail)assert.ok(state.raw>2000,'must observe original tail duplicate');if(c.parser)assert.equal(state.raw,0);if(c.guard)assert.ok(state.raw>0,'pending own cap must refuse in JS guard, not enlarged parser');console.log(JSON.stringify({constructor:kind,case:c.name,status,admissions:state.admissions,handlerEffects:state.effects,rawHeaders:state.raw,RootAdmission:false,proofAuthenticated:false}));}
 }finally{await new Promise((yes,no)=>server.close(e=>e?no(e):yes()));}});
