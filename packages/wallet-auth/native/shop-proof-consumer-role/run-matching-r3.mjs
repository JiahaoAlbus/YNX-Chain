// New consumer scope only. Root must release the actual local heavy slot first.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {WholeBudget,runOwnedCommand,physicalCommandsComplete} from './owned-command-r3.mjs';
const whole=new WholeBudget(90000,6000);
const root=import.meta.dirname,pkg=root+'/source/productreadsource',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const linked=process.env.LINK_SHOP_PROOF_MATCHING_LINK_ROOT,go=process.env.LINK_SHOP_PROOF_MATCHING_GO,evidence=process.env.LINK_SHOP_PROOF_MATCHING_EVIDENCE,cache=process.env.GOCACHE,socketParent=process.env.LINK_SHOP_PROOF_MATCHING_SOCKET_PARENT;
for(const p of [linked,go,evidence,cache,socketParent])if(!p||!path.isAbsolute(p)||path.normalize(p)!==p||fs.realpathSync(p)!==p)throw Error('explicit canonical roots/tools required');
const out=fs.mkdtempSync(evidence+'/matching-');fs.mkdirSync(out+'/tmp',{mode:0o700});
let mod=fs.readFileSync(pkg+'/go.mod','utf8').replace(/^replace github.com\/JiahaoAlbus\/YNX-Chain => .*$/m,'replace github.com/JiahaoAlbus/YNX-Chain => '+JSON.stringify(linked));
fs.writeFileSync(out+'/matching.mod',mod,{flag:'wx'});fs.copyFileSync(pkg+'/go.sum',out+'/matching.sum');
function pin(p){const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:sha(b)}}
function walk(p){let files=[];for(const n of fs.readdirSync(p).sort()){const q=p+'/'+n,s=fs.lstatSync(q);if(s.isDirectory())files.push(...walk(q));else if(s.isFile()&&/\.(go|c|h|cpp|hpp|mod|sum)$/.test(n))files.push(pin(q))}return files}
const capture=()=>[...walk(root+'/source'),...walk(linked+'/internal/securelink'),pin(linked+'/go.mod'),pin(linked+'/go.sum'),pin(root+'/run-matching-r3.mjs'),pin(root+'/owned-command-r3.mjs'),pin(out+'/matching.mod'),pin(out+'/matching.sum')];
const before=capture();fs.writeFileSync(out+'/SOURCE-BEFORE.json',JSON.stringify(before,null,2));
const baseEnv={...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',GOWORK:'off',GOMAXPROCS:'2',GOMEMLIMIT:'1536MiB',CGO_ENABLED:'1',GOTMPDIR:out+'/tmp',TMPDIR:out+'/tmp'};fs.writeFileSync(out+'/ENVIRONMENT.json',JSON.stringify(Object.fromEntries(Object.entries(baseEnv).filter(([k])=>['GOTOOLCHAIN','GOPROXY','GOSUMDB','GOWORK','GOMAXPROCS','GOMEMLIMIT','CGO_ENABLED','GOCACHE','GOMODCACHE','GOTMPDIR','TMPDIR','CC','CXX','CGO_CFLAGS','CGO_CPPFLAGS','CGO_CXXFLAGS','CGO_LDFLAGS','SDKROOT','MACOSX_DEPLOYMENT_TARGET'].includes(k))),null,2),{flag:'wx'});let commands=[],socketRoot=null;
async function command(name,exe,args,env,maxMs){
 const o=fs.openSync(out+'/'+name+'.stdout','wx'),e=fs.openSync(out+'/'+name+'.stderr','wx');let actual;
 try{actual=await runOwnedCommand({exe,args,cwd:pkg,env,stdio:['ignore',o,e],budget:whole,maxMs,onStart:record=>fs.writeFileSync(out+'/'+name+'.START.json',JSON.stringify(record,null,2),{flag:'wx'})});}finally{fs.closeSync(o);fs.closeSync(e);}
 const c={name,...actual,stdout:pin(out+'/'+name+'.stdout'),stderr:pin(out+'/'+name+'.stderr'),stdoutStabilized:actual.terminal};commands.push(c);fs.writeFileSync(out+'/COMMANDS.json',JSON.stringify(commands,null,2));return c;
}
let passed=false;try{
 const args=['test','-mod=readonly','-modfile='+out+'/matching.mod','-race','-p','1','-tags=shop_proof_interop_public','-c','-o',out+'/consumer.test','.'];
 const built=await command('typecheck-and-build-new-test',go,args,baseEnv,90000);if(built.status!==0||!built.terminal)throw Error('real full package Go/Cgo build failed');
 socketRoot=fs.mkdtempSync(path.join(socketParent,'shop-proof-public-'));fs.chmodSync(socketRoot,0o700);
 const ran=await command('only-new-consumer',out+'/consumer.test',['-test.run','^TestShopProofConsumerMatching$','-test.v','-test.timeout=45s'],{...baseEnv,TMPDIR:socketRoot},45000);
 const stdout=fs.readFileSync(out+'/only-new-consumer.stdout','utf8');const top=(stdout.match(/^--- PASS: TestShopProofConsumerMatching /gm)||[]).length,subs=(stdout.match(/^\s+--- PASS: TestShopProofConsumerMatching\//gm)||[]).length;
 passed=ran.status===0&&ran.terminal&&top===1&&subs===7&&!/--- (FAIL|SKIP):/.test(stdout);if(!passed)throw Error('new scope did not pass exactly one top/seven subcases');
}catch(error){fs.writeFileSync(out+'/FIRST-ERROR.txt',error.stack+'\n',{flag:'wx'});}finally{
 const after=capture();fs.writeFileSync(out+'/SOURCE-AFTER.json',JSON.stringify(after,null,2));const exact=JSON.stringify(before)===JSON.stringify(after);
 const physicalKnown=physicalCommandsComplete(commands);
 if(socketRoot&&physicalKnown)fs.rmSync(socketRoot,{recursive:true});
 const actualWholeElapsedMs=whole.now()-whole.start;
 const result={passed:passed&&exact&&physicalKnown&&actualWholeElapsedMs<=90000,commands,wholeBudgetMs:90000,actualWholeElapsedMs,wholeBudgetExceeded:actualWholeElapsedMs>90000,remainingWholeMs:whole.remaining(),cleanupUnknown:!physicalKnown,sourceBeforeAfterExact:exact,sourceInputs:before.length,RootAdmission:false,SourceAdmission:false,actualMainProducer:false,normalCgoPositive:false,onlyNewSelector:'^TestShopProofConsumerMatching$',expectedTop:1,expectedSubcases:7,ownedSocketRoot:socketRoot,ownSocketRootRemoved:!socketRoot||!fs.existsSync(socketRoot),ownedSocketRootRetainedForUnknown:!!socketRoot&&fs.existsSync(socketRoot)&&!physicalKnown};fs.writeFileSync(out+'/RESULT.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({out,...result}));if(!result.passed)process.exitCode=1;
}
