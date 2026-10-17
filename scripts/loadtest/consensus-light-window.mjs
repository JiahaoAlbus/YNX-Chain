import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {ownedProcessSet} from './owned-process-set.mjs';
import {validateNativeResourceSample} from './native-resource-sample.mjs';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {createNativeResourceProbe} from './native-resource-probe.mjs';
import {lightCommand} from './consensus-light-plan.mjs';
const {values}=parseArgs({options:{execute:{type:'boolean',default:false},output:{type:'string'},'stopped-window':{type:'string'}}});
const plan=lightCommand(process.cwd(),values['stopped-window']);
if(!values.execute){console.log(JSON.stringify({status:'prepared_only_no_processes_started',plan,caps:{totalMs:45000,cleanupMs:15000,ownedRSSBytes:400*1024*1024},requires:'fresh Root grant and --execute --output NEW_FILE'}));process.exit(0)}
if(process.platform!=='darwin'||!values.output)throw Error('macOS and a new explicit --output required');
const output=path.resolve(values.output);if(fs.existsSync(output))throw Error('receipt path already exists; preserve original');
const exec=promisify(execFile),started=Date.now(),root=process.cwd();
const hostPath=root+'/artifacts/chain-performance-20261017/ynx-consensus-perf-host-pressure';
const hostBinary={path:hostPath,sha256:createHash('sha256').update(fs.readFileSync(hostPath)).digest('hex')};
const probe=createNativeResourceProbe(hostPath);
const goEnvironment=plan.env;
const result={plan,hostBinary,startedAt:new Date().toISOString(),launcher:process.pid,sharedParentExcluded:process.ppid,ownedScope:'launcher plus complete test process group/descendants; native sampler and conservative fork-child reserve',goEnvironment,firstCause:null,peakRSS:0,peakThreads:0,samples:[],probes:probe.records,go:null};
const fail=e=>result.firstCause??=String(e);
let child,done=false,busy=false,monitor;
const kill=()=>{if(child?.pid)try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')fail(e)}};
const deadline=setTimeout(()=>{fail('45s total deadline');kill()},45000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{fail(signal);kill()});
async function sample(initial=false){
 let ids=[process.pid];
 if(child?.pid){const {stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,pgid='],{timeout:1500,killSignal:'SIGKILL',maxBuffer:1024*1024});ids=ownedProcessSet(stdout,process.pid,child.pid)}
 ids=[...new Set(ids)];if(ids.length>16)throw Error('kernel probe watched PID bound');
 const raw=await probe.run(['--full',...ids.map(String)]);const s=JSON.parse(raw.stdout);
 result.lastAttemptedResourceSample=s;
 validateNativeResourceSample(s,process.pid,{expectedPIDs:ids});
 result.peakRSS=Math.max(result.peakRSS,s.rssWithControlReserveBytes);result.peakThreads=Math.max(result.peakThreads,s.threadsWithControlReserve);
 result.samples.push({at:new Date().toISOString(),...s});
 if(s.rssWithControlReserveBytes>400*1024*1024)throw Error('400MiB control/owned RSS cap');
 if(initial){const {stdout}=await exec('/usr/bin/vm_stat',[],{timeout:1500,killSignal:'SIGKILL',maxBuffer:65536});const free=Number(stdout.match(/Pages free:\s+(\d+)/)?.[1])*Number(stdout.match(/page size of (\d+)/)?.[1]);result.vmStat={sampledAt:new Date().toISOString(),raw:stdout,freePageBytes:Number.isFinite(free)?free:null,interpretation:'Diagnostic free pages only, not available bytes; admission uses native memoryPressure dispatch level and actual owned RSS cap'}}
}
try{
 if(plan.mode==='stopped_replay'){
  if(fs.realpathSync(plan.window)!==plan.window||fs.realpathSync(plan.binary)!==plan.binary)throw Error('stopped inputs must not be symlinks');
  const h=createHash('sha256');for await(const chunk of fs.createReadStream(plan.binary))h.update(chunk);if(h.digest('hex')!==plan.binarySHA256)throw Error('retained test binary digest mismatch');
  const receiptPath=path.join(plan.window,'window-receipt.json');if(fs.statSync(receiptPath).size>1024*1024)throw Error('retired receipt size bound');
  const retired=JSON.parse(fs.readFileSync(receiptPath,'utf8'));if(retired.allGroupsGone!==true||retired.firstCause!==null||!Array.isArray(retired.processes)||retired.processes.length>16)throw Error('requires successful fully retired window');
  for(const p of retired.processes){if(!Number.isSafeInteger(p.pid)||p.pid<=1||!p.exited||!p.groupGone)throw Error('invalid retired process identity');for(const id of [p.pid,-p.pid]){try{process.kill(id,0);throw Error('original process identity is live')}catch(e){if(e.code!=='ESRCH')throw e}}}
  for(const name of ['stopped-replay.json','ready-account-readback.json'])if(fs.existsSync(path.join(plan.window,name)))throw Error('preserve existing offline output: '+name);
 }
 await sample(true);
 if(Date.now()-started>=45000||result.firstCause)throw Error(result.firstCause??'preflight deadline');
 const childEnv={...process.env};delete childEnv.YNX_CHAIN_STOPPED_WINDOW;delete childEnv.YNX_CHAIN_PARTIAL_STOPPED_WINDOW;
 child=spawn(plan.command,plan.args,{detached:true,env:{...childEnv,...goEnvironment},stdio:['ignore','pipe','pipe']});
 result.go={pid:child.pid,code:null,signal:null,stdout:'',stderr:'',exited:false};console.log(JSON.stringify({startedAt:result.startedAt,launcher:process.pid,go:child.pid}));
 const capture=key=>d=>{if(Buffer.byteLength(result.go.stdout)+Buffer.byteLength(result.go.stderr)+d.length>1024*1024){fail('1MiB log cap');kill()}else result.go[key]+=d.toString()};child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));
 const closed=new Promise(resolve=>{child.on('error',e=>{fail(e.message)});child.on('close',(code,signal)=>{result.go.code=code;result.go.signal=signal;result.go.exited=true;done=true;resolve()})});
 monitor=setInterval(async()=>{if(busy||done)return;busy=true;try{await sample()}catch(e){if(!done){fail(e.message);kill()}}finally{busy=false}},500);
 await closed;
 if(result.go.code!==0)fail(`go test terminal code=${result.go.code} signal=${result.go.signal}`);
}catch(e){fail(e.message);kill()}finally{
 clearTimeout(deadline);clearInterval(monitor);const stop=Date.now();await probe.stop();
 if(child?.pid){kill();while(Date.now()-stop<15000){try{process.kill(-child.pid,0)}catch(e){if(e.code==='ESRCH'){result.groupGone=true;break}fail(e.message)}await delay(50)}if(!result.groupGone)fail('original process group still present')}
 else result.groupGone=true;
 result.elapsedMs=Date.now()-started;
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({firstCause:result.firstCause,elapsedMs:result.elapsedMs,peakRSS:result.peakRSS,go:result.go,groupGone:result.groupGone},null,2));process.exitCode=result.firstCause?1:0;
}
