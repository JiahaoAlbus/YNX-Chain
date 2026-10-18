import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {ownedBirthInventory,verifyExitedDuringSample} from './owned-process-race.mjs';
import {validateNativeResourceSample} from './native-resource-sample.mjs';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {createNativeResourceProbe} from './native-resource-probe.mjs';
import {lightCommand,lightScratchBytes,requireClientRegressionPasses,remainingPhaseBudget,clientRegressionArgs,clientOwnedRSSCap,lightProbeInput} from './consensus-light-plan.mjs';
const {values}=parseArgs({options:{execute:{type:'boolean',default:false},output:{type:'string'},'stopped-window':{type:'string'},'native-compile':{type:'boolean',default:false},'client-regression':{type:'boolean',default:false},'client13-normal-02':{type:'boolean',default:false},'client13-normal-03':{type:'boolean',default:false},'client13-normal-04':{type:'boolean',default:false},'client13-normal-05':{type:'boolean',default:false},'client13-normal-06':{type:'boolean',default:false},'client13-normal-07':{type:'boolean',default:false},'client13-normal-08':{type:'boolean',default:false}}});
const plan=lightCommand(process.cwd(),values['stopped-window'],values['native-compile'],values['client-regression']);
const explicitCases=['client13-normal-02','client13-normal-03','client13-normal-04','client13-normal-05','client13-normal-06','client13-normal-07','client13-normal-08'].filter(k=>values[k]);
if(explicitCases.length>1)throw Error('only one explicit resource case');
const admissionCase=explicitCases[0];
const caseSuffix=admissionCase?.slice(-2);
const ownedRSSCapBytes=clientOwnedRSSCap(plan,admissionCase);
if(admissionCase&&(plan.mode!=='client_regression'||!values.output||path.resolve(values.output)!==path.join(process.cwd(),`artifacts/chain-performance-20261017/client13-normal-20261018-${caseSuffix}.json`)))throw Error('explicit case is only the fixed client13 case and original new receipt path');
if(!values.execute){console.log(JSON.stringify({status:'prepared_only_no_processes_started',plan,admissionCase,ownedRSSCapBytes,caps:plan.caps??{totalMs:45000,cleanupMs:15000,ownedRSSBytes:400*1024*1024},requires:'fresh Root grant and --execute --output NEW_FILE'}));process.exit(0)}
if(process.platform!=='darwin'||!values.output)throw Error('macOS and a new explicit --output required');
const output=path.resolve(values.output);if(fs.existsSync(output))throw Error('receipt path already exists; preserve original');
const exec=promisify(execFile),started=Date.now(),root=process.cwd();
const expectedProbe=lightProbeInput(root,admissionCase);
const hostPath=expectedProbe.path;
if(fs.realpathSync(hostPath)!==hostPath)throw Error('native probe symlink refused');
const hostBinary={path:hostPath,sha256:createHash('sha256').update(fs.readFileSync(hostPath)).digest('hex')};
if(hostBinary.sha256!==expectedProbe.sha256)throw Error('actual native probe binary digest differs from the fixed case');
const probe=createNativeResourceProbe(hostPath);
const goEnvironment=plan.env;
const result={plan,hostBinary,startedAt:new Date().toISOString(),launcher:process.pid,sharedParentExcluded:process.ppid,ownedScope:'launcher plus complete test process group/descendants; native sampler and conservative fork-child reserve',goEnvironment,admissionCase,ownedRSSCapBytes,priorRSSLimitEvidence:['client13-normal-05','client13-normal-06','client13-normal-07','client13-normal-08'].includes(admissionCase)?{case:'client13-normal-04',limitBytes:419430400,actualPeakBytes:432111616,rawSHA256:'cdcd85e86a8ce5c89fd1c675334403c58a9d09b61226ce1106aae26b53f98791'}:undefined,allowedNativePressureLevels:admissionCase?[1,2]:[1],firstCause:null,peakRSS:0,peakThreads:0,samples:[],probes:probe.records,go:null};
const regression=plan.mode==='client_regression';
let scratchRoot;
result.scratchSamples=[];result.peakScratchBytes=0;
if(regression)result.driverPins=Object.fromEntries(['consensus-light-window.mjs','consensus-light-plan.mjs','native-resource-sample.mjs','owned-process-race.mjs','native-resource-probe.mjs'].map(name=>[name,createHash('sha256').update(fs.readFileSync(new URL(name,import.meta.url))).digest('hex')]));
const fail=e=>result.firstCause??=String(e);
let child,done=false,busy=false,monitor;
const kill=()=>{if(child?.pid)try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')fail(e)}};
const activeMs=regression?plan.caps.activeMs:45000;
const deadline=setTimeout(()=>{fail(regression?'30s client active deadline':'45s total deadline');kill()},activeMs);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{fail(signal);kill()});
async function cacheOccupancy(){
 const paths=result.cachePaths;
 const timeoutMs=remainingPhaseBudget(started,activeMs,Date.now(),['client13-normal-03','client13-normal-04','client13-normal-05','client13-normal-06','client13-normal-07','client13-normal-08'].includes(admissionCase)?12000:5000);
 const phase={startedAt:new Date().toISOString(),timeoutMs,remainingActiveMs:remainingPhaseBudget(started,activeMs,Date.now())};
 (result.cachePhases??=[]).push(phase);
 let stdout;
 try{({stdout}=await exec('/usr/bin/du',['-sk',...paths],{timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:65536}));}
 catch(e){result.cacheOccupancyError={command:'/usr/bin/du',args:['-sk',...paths],timeoutMs,code:e.code??null,signal:e.signal??null,killed:e.killed??null,stdout:e.stdout??'',stderr:e.stderr??'',message:e.message};phase.failed=true;phase.endedAt=new Date().toISOString();throw e;}
 phase.endedAt=new Date().toISOString();
 const rows=stdout.trim().split('\n');
 if(rows.length!==paths.length)throw Error('original Go cache occupancy unavailable');
 const bytes=rows.map(line=>Number(line.match(/^(\d+)\s/)?.[1])*1024);
 if(bytes.some(v=>!Number.isSafeInteger(v)||v<0))throw Error('actual original Go cache byte counts unavailable');
 return {paths,bytes,totalBytes:bytes.reduce((a,b)=>a+b,0),method:'du -sk actual original cache occupancy; paths from read-only go env after normal admission; no cache copied/deleted/redirected'};
}
async function verifyGoSource(){
 const options={cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},timeout:1500,killSignal:'SIGKILL',maxBuffer:1024*1024};
 const keys=Object.keys(plan.sourcePins);
 const {stdout}=await exec('/usr/bin/git',['rev-parse','HEAD',...keys.map(p=>'HEAD:'+p)],options);
 const [head,...pins]=stdout.trim().split('\n');
 if(!/^[0-9a-f]{40}$/.test(head)||pins.length!==keys.length||pins.some((v,i)=>v!==plan.sourcePins[keys[i]]))throw Error('fixed Go tree/module pins differ');
 await exec('/usr/bin/git',['merge-base','--is-ancestor',plan.sourceCommit,head],options);
 await exec('/usr/bin/git',['diff','--quiet',plan.sourceCommit,'--',...keys],options);
 const untracked=await exec('/usr/bin/git',['ls-files','--others','--exclude-standard','--',...keys],options);
 if(untracked.stdout.trim()!=='')throw Error('untracked frozen Go source exists');
 result.sourceChecks??=[];result.sourceChecks.push({head,sourceCommit:plan.sourceCommit,pins:plan.sourcePins});
}
function scratchAndDisk(initial=false){
 const bytes=scratchRoot?lightScratchBytes(scratchRoot):0;
 const space=fs.statfsSync(root),freeDiskBytes=Number(space.bavail)*Number(space.bsize);
 const floor=plan.caps.diskFloorBytes+plan.caps.rootReserveBytes+(initial?plan.caps.scratchBytes:0);
 result.peakScratchBytes=Math.max(result.peakScratchBytes,bytes);
 result.scratchSamples.push({at:new Date().toISOString(),bytes,freeDiskBytes});
 if(bytes>plan.caps.scratchBytes)throw Error('512MiB private scratch cap');
 if(!Number.isSafeInteger(freeDiskBytes)||freeDiskBytes<floor)throw Error('actual free disk below client floor/reserve');
}
function retainNativeAttempt(s){
 result.lastAttemptedResourceSample=s;
 if(Number.isSafeInteger(s.rssWithControlReserveBytes)&&s.rssWithControlReserveBytes>=0){
  result.peakReadableRSSLowerBoundBytes=Math.max(result.peakReadableRSSLowerBoundBytes??0,s.rssWithControlReserveBytes);
  if(s.rssWithControlReserveBytes>ownedRSSCapBytes)throw Error(`${ownedRSSCapBytes/1024**2}MiB control/owned RSS cap (native readable lower bound)`);
 }
}
async function birthInventory(){
 const {stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart='],{env:{...process.env,LC_ALL:'C'},timeout:1500,killSignal:'SIGKILL',maxBuffer:1024*1024});
 return ownedBirthInventory(stdout,process.pid,child.pid);
}
async function sample(initial=false){
 let ids=[process.pid],before;
 if(child?.pid){before=await birthInventory();ids=before.ids;}
 ids=[...new Set(ids)];if(ids.length>16)throw Error('kernel probe watched PID bound');
 let raw=await probe.run(['--full',...ids.map(String)]),s=JSON.parse(raw.stdout);
 retainNativeAttempt(s);
 if(before&&s.processes?.some(p=>p.readable!==true)){
  const after=await birthInventory();
  const observation={at:new Date().toISOString(),rejectedSample:s,before:before.ids.map(pid=>before.identities.get(pid)),after:after.ids.map(pid=>after.identities.get(pid)),kernelAbsenceQueries:[],replacementPIDs:after.ids};
  (result.raceObservations??=[]).push(observation);
  let exited;
  try{exited=verifyExitedDuringSample(s,before,after,process.pid,child.pid,pid=>{try{process.kill(pid,0);observation.kernelAbsenceQueries.push({pid,absent:false});return false;}catch(e){observation.kernelAbsenceQueries.push({pid,absent:e.code==='ESRCH',code:e.code});if(e.code==='ESRCH')return true;throw e;}});}
  catch(e){observation.failure=e.message;throw e;}
  observation.exited=exited;
  (result.exitedDuringSample??=[]).push({at:new Date().toISOString(),exited,rejectedSample:s,replacementPIDs:after.ids,birthPrecision:'ps lstart seconds; excluded PID must also be wholly absent from fresh global inventory and kernel kill(0) ESRCH'});
  ids=after.ids;raw=await probe.run(['--full',...ids.map(String)]);s=JSON.parse(raw.stdout);
  retainNativeAttempt(s);
 }
 validateNativeResourceSample(s,process.pid,{expectedPIDs:ids,rootCase:admissionCase});
 result.peakRSS=Math.max(result.peakRSS,s.rssWithControlReserveBytes);result.peakThreads=Math.max(result.peakThreads,s.threadsWithControlReserve);
 result.samples.push({at:new Date().toISOString(),...s});
 if(s.rssWithControlReserveBytes>ownedRSSCapBytes)throw Error(`${ownedRSSCapBytes/1024**2}MiB control/owned RSS cap`);
 if(regression){if(s.threadsWithControlReserve>plan.caps.threads)throw Error('320 client thread cap');scratchAndDisk(initial)}
 if(initial){const {stdout}=await exec('/usr/bin/vm_stat',[],{timeout:1500,killSignal:'SIGKILL',maxBuffer:65536});const free=Number(stdout.match(/Pages free:\s+(\d+)/)?.[1])*Number(stdout.match(/page size of (\d+)/)?.[1]);result.vmStat={sampledAt:new Date().toISOString(),raw:stdout,freePageBytes:Number.isFinite(free)?free:null,interpretation:'Diagnostic free pages only, not available bytes; admission uses native memoryPressure dispatch level and actual owned RSS cap'}}
}
try{
 if(plan.mode==='native_compile'&&fs.existsSync(plan.args.at(-1)))throw Error('preserve existing native candidate binary');
 if(plan.mode==='stopped_replay'){
  if(fs.realpathSync(plan.window)!==plan.window||fs.realpathSync(plan.binary)!==plan.binary)throw Error('stopped inputs must not be symlinks');
  const h=createHash('sha256');for await(const chunk of fs.createReadStream(plan.binary))h.update(chunk);if(h.digest('hex')!==plan.binarySHA256)throw Error('retained test binary digest mismatch');
  const receiptPath=path.join(plan.window,'window-receipt.json');if(fs.statSync(receiptPath).size>1024*1024)throw Error('retired receipt size bound');
  const retired=JSON.parse(fs.readFileSync(receiptPath,'utf8'));if(retired.allGroupsGone!==true||retired.firstCause!==null||!Array.isArray(retired.processes)||retired.processes.length>16)throw Error('requires successful fully retired window');
  for(const p of retired.processes){if(!Number.isSafeInteger(p.pid)||p.pid<=1||!p.exited||!p.groupGone)throw Error('invalid retired process identity');for(const id of [p.pid,-p.pid]){try{process.kill(id,0);throw Error('original process identity is live')}catch(e){if(e.code!=='ESRCH')throw e}}}
  for(const name of ['stopped-replay.json','ready-account-readback.json'])if(fs.existsSync(path.join(plan.window,name)))throw Error('preserve existing offline output: '+name);
 }
 await sample(true);
 if(regression){
  await verifyGoSource();
  const query=exec('/opt/homebrew/bin/go',['env','GOCACHE','GOMODCACHE'],{cwd:root,env:{...process.env,...goEnvironment},timeout:3000,killSignal:'SIGKILL',maxBuffer:65536});
  result.goEnvironmentRead={pid:query.child?.pid,kind:'read-only go env after normal admission',code:null};
  const answer=await query;result.goEnvironmentRead.code=0;
  const paths=answer.stdout.trim().split('\n');
  if(paths.length!==2||paths.some(p=>!path.isAbsolute(p)))throw Error('actual Go cache paths unavailable');
  result.cachePaths=paths.map(p=>fs.realpathSync(p));result.cacheBefore=await cacheOccupancy();
 }
 if(Date.now()-started>=activeMs||result.firstCause)throw Error(result.firstCause??'preflight deadline');
 const childEnv={...process.env};delete childEnv.YNX_CHAIN_STOPPED_WINDOW;delete childEnv.YNX_CHAIN_PARTIAL_STOPPED_WINDOW;
 if(regression){
  scratchRoot=fs.mkdtempSync(path.join(root,'artifacts/chain-performance-20261017/light-client13-'));
  fs.mkdirSync(path.join(scratchRoot,'compiler'));fs.mkdirSync(path.join(scratchRoot,'tests'));
  childEnv.GOTMPDIR=path.join(scratchRoot,'compiler');childEnv.TMPDIR=path.join(scratchRoot,'tests');
  result.scratchRoot=scratchRoot;result.goEnvironment={...goEnvironment,GOTMPDIR:childEnv.GOTMPDIR,TMPDIR:childEnv.TMPDIR};
  scratchAndDisk(true);
 }

 const actualArgs=regression?clientRegressionArgs(plan,remainingPhaseBudget(started,activeMs,Date.now())):plan.args;
 if(regression)result.actualGoArgs=actualArgs;
 child=spawn(plan.command,actualArgs,{detached:true,env:{...childEnv,...goEnvironment},stdio:['ignore','pipe','pipe']});
 result.go={pid:child.pid,code:null,signal:null,stdout:'',stderr:'',exited:false};console.log(JSON.stringify({startedAt:result.startedAt,launcher:process.pid,go:child.pid}));
 const capture=key=>d=>{if(Buffer.byteLength(result.go.stdout)+Buffer.byteLength(result.go.stderr)+d.length>1024*1024){fail('1MiB log cap');kill()}else result.go[key]+=d.toString()};child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));
 const closed=new Promise(resolve=>{child.on('error',e=>{fail(e.message)});child.on('close',(code,signal)=>{result.go.code=code;result.go.signal=signal;result.go.exited=true;done=true;resolve()})});
 monitor=setInterval(async()=>{if(busy||done)return;busy=true;try{await sample()}catch(e){if(!done){fail(e.message);kill()}}finally{busy=false}},500);
 await closed;
 if(result.go.code!==0)fail(`go test terminal code=${result.go.code} signal=${result.go.signal}`);
 if(regression){scratchAndDisk();result.cacheAfter=await cacheOccupancy();result.cacheNetGrowthBytes=result.cacheAfter.totalBytes-result.cacheBefore.totalBytes;if(result.cacheNetGrowthBytes<0)throw Error('shared cache decreased; new cache attribution unknown');if(result.peakScratchBytes+result.cacheNetGrowthBytes>plan.caps.scratchBytes)throw Error('512MiB scratch plus attributable cache growth cap');await verifyGoSource();if(result.go.code===0)result.actualPassedFunctions=requireClientRegressionPasses(plan,result.go.stdout);}
}catch(e){fail(e.message);kill()}finally{
 clearTimeout(deadline);clearInterval(monitor);const stop=Date.now();await probe.stop();
 const cleanupMs=regression?Math.max(0,Math.min(plan.caps.cleanupMs,plan.caps.totalMs-(stop-started))):15000;
 if(child?.pid){kill();while(Date.now()-stop<cleanupMs){try{process.kill(-child.pid,0)}catch(e){if(e.code==='ESRCH'){result.groupGone=true;break}fail(e.message)}await delay(50)}if(!result.groupGone)fail('original process group still present')}
 else result.groupGone=true;
 result.elapsedMs=Date.now()-started;
 if(regression&&result.elapsedMs>plan.caps.totalMs)fail('45s client total deadline');
 if(regression)result.measurementLimits='Sampled native RSS/scratch, not hard OS enforcement; short peaks may occur between samples. Private scratch includes compiler/tests; original shared Go cache occupancy is separately read before/after and positive net growth is conservatively combined with peak scratch; no hard cache peak enforcement, actual free disk is separately checked.';
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({firstCause:result.firstCause,elapsedMs:result.elapsedMs,peakRSS:result.peakRSS,go:result.go,groupGone:result.groupGone},null,2));process.exitCode=result.firstCause?1:0;
}
