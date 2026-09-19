// Scheduler-safe one-shot job. Does not install/activate a scheduler or send notifications.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {ROUTES,parseArgs,runCommand} from "./testnet-transport-monitor.mjs";
import {readRegular,writeBundle,sha256} from "./testnet-transport-bundle.mjs";

export const LIMITS={minimumGapMs:60000,staleMs:20*60000,maxStorageBytes:128*1024*1024,reserveBytes:20*1024*1024,maxFiles:2048};
const policySHA256=sha256(fs.readFileSync(fileURLToPath(import.meta.url)));
const identity=b=>b.vantage+"/"+b.pathMode;

export function evaluate(bundle, previous=null, nowMs=Date.now()) {
  assert(bundle.schema==="ynx-transport-shareable-bundle/v1", "INVALID_BUNDLE");
  const started=Date.parse(bundle.startedAt),ended=Date.parse(bundle.finishedAt);
  assert(Number.isFinite(started)&&Number.isFinite(ended)&&ended>=started&&ended<=nowMs+60000&&nowMs-ended<=LIMITS.staleMs,"STALE_OR_FUTURE_EVIDENCE");
  if(previous){
    assert(previous.schema==="ynx-transport-alert-state/v1"&&previous.identity===identity(bundle),"STATE_IDENTITY_MISMATCH");
    assert(previous.lastRunId!==bundle.runId&&started>Date.parse(previous.lastStartedAt),"DUPLICATE_OR_OLDER_RUN");
    assert(started-Date.parse(previous.checkedAt)>=LIMITS.minimumGapMs,"COOLDOWN_OR_CLOCK_REGRESSION");
    for(const route of ROUTES){const row=previous.endpoints?.[route.url];assert(row&&Number.isInteger(row.failedBatches)&&row.failedBatches>=0&&row.failedBatches<=2&&Number.isInteger(row.healthyBatches)&&row.healthyBatches>=0&&row.healthyBatches<=3,"INVALID_PRIOR_STATE");}
  }
  const sourceKey=sha256(JSON.stringify(bundle.sourceSHA256));
  const continuity=previous && previous.sourceKey===sourceKey && previous.policySHA256===policySHA256 && started-Date.parse(previous.checkedAt)<=LIMITS.staleMs;
  const endpoints={};
  for(const route of ROUTES){
    const rows=bundle.probes.filter(p=>p.url===route.url);
    const old=previous?.endpoints?.[route.url];
    const bad=rows.filter(p=>!p.ready);
    const healthy=bundle.complete && rows.length>0 && bad.length===0;
    let failures=continuity ? old?.failedBatches??0 : 0;
    let healthyBatches=continuity ? old?.healthyBatches??0 : 0;
    let open=old?.incidentOpen===true, level=old?.level==="critical"?"critical":"warning",phase=old?.phase??null;
    if(!bundle.complete){failures=0;healthyBatches=0;}
    else if(bad.length){
      failures=Math.min(2,failures+1);healthyBatches=0;open=true;
      phase=[...new Set(bad.map(p=>p.classification))].sort().join(",");
      level=old?.level==="critical"||failures>=2||bad.some(p=>["service-identity-or-readiness-failed","tls-verification-failed"].includes(p.classification))?"critical":"warning";
    }else if(healthy){
      failures=0;healthyBatches++;
      // The first healthy batch never clears a previously open incident.
      if(open&&healthyBatches>=3){open=false;phase=null;}
    }
    endpoints[route.url]={incidentOpen:open,level:open?level:"ok",phase,failedBatches:failures,healthyBatches:Math.min(healthyBatches,3),sampleHealthy:healthy};
  }
  const active=Object.entries(endpoints).filter(([,x])=>x.incidentOpen);
  const hostGap=(bundle.hostObservationExpected&&bundle.hosts.length!==bundle.expectedRounds)||bundle.hosts.some(w=>!w.available||w.coverage.some(c=>!c.clientWindowCovered));
  const stateLevel=!bundle.complete||hostGap?"diagnostic-gap":active.some(([,x])=>x.level==="critical")?"critical":active.length?"warning":"ok";
  const signature=JSON.stringify({level:stateLevel,hostGap,active:active.map(([url,x])=>[url,x.level,x.phase])});
  const changed=signature!==previous?.signature;
  const notify=changed && (previous!==null||stateLevel!=="ok"||hostGap);
  return {schema:"ynx-transport-alert-state/v1",identity:identity(bundle),sourceKey,policySHA256,lastRunId:bundle.runId,lastStartedAt:bundle.startedAt,
    checkedAt:bundle.finishedAt,level:stateLevel,hostGap,endpoints,signature,
    alert:{notify,transition:!changed?"unchanged":stateLevel==="ok"&&previous&&previous.level!=="ok"?"recovered-samples":stateLevel==="ok"?"sampled-healthy":stateLevel,
      activeIncidents:active.length,healthyBatchesRequiredForRecovery:3,notificationDeliveryConfigured:false},
    globalRegionalVerified:false,continuousAvailabilityVerified:false,rootCauseConfirmed:false};
}

export function parseJobArgs(argv){
  let directory=null,status=false,live=false;const monitorArgs=[];
  const values=new Set(["--vantage","--host","--identity","--known-hosts"]);
  const flags=new Set(["--direct","--pin-origin"]);
  const seen=new Set();
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];assert(!seen.has(arg),"DUPLICATE_OPTION");seen.add(arg);
    if(arg==="--live"){live=true;continue;}
    if(arg==="--status"){status=true;continue;}
    if(arg==="--state-dir"){directory=argv[++i];continue;}
    if(flags.has(arg)){monitorArgs.push(arg);continue;}
    assert(values.has(arg)&&argv[i+1]&&!argv[i+1].startsWith("--"),"UNSUPPORTED_OPTION");monitorArgs.push(arg,argv[++i]);
  }
  assert(!status||!live,"STATUS_IS_READ_ONLY");
  if(directory!==null)assert(path.isAbsolute(directory)&&!/[\r\n\0]/.test(directory)&&![path.parse(directory).root,os.homedir(),process.cwd()].includes(path.resolve(directory)),"DEDICATED_ABSOLUTE_STATE_DIRECTORY_REQUIRED");
  assert(!(live||status)||directory,"STATE_DIRECTORY_REQUIRED");
  const monitorOptions=parseArgs(["--rounds","2","--interval-seconds","30",...monitorArgs]);
  return {directory,status,live,monitorArgs,monitorOptions};
}

function privateDirectory(directory){
  if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});
  const s=fs.lstatSync(directory);
  assert(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&(!process.getuid||s.uid===process.getuid()),"UNSAFE_STATE_DIRECTORY");
}

export function storageUsage(directory){
  let files=0,bytes=0;const pending=[[directory,0]];
  while(pending.length){
    const [folder,depth]=pending.pop();assert(depth<=4,"STORAGE_DEPTH_LIMIT");
    for(const name of fs.readdirSync(folder)){
      const file=path.join(folder,name),s=fs.lstatSync(file);
      assert(!s.isSymbolicLink(),"STORAGE_SYMLINK_FORBIDDEN");
      if(s.isDirectory())pending.push([file,depth+1]);
      else {assert(s.isFile()&&s.nlink===1,"STORAGE_NONREGULAR_FILE");files++;bytes+=s.size;}
      assert(files<=LIMITS.maxFiles&&bytes<=LIMITS.maxStorageBytes,"STORAGE_LIMIT");
    }
  }
  return {files,bytes};
}

function previousState(directory){
  const file=path.join(directory,"state.json");
  try{return JSON.parse(readRegular(file,262144));}catch(e){if(e.code==="ENOENT")return null;throw e;}
}

export function status(directory,nowMs=Date.now()){
  const prior=previousState(directory),age=prior?nowMs-Date.parse(prior.checkedAt):null;
  const valid=prior?.schema==="ynx-transport-alert-state/v1"&&["ok","warning","critical","diagnostic-gap"].includes(prior.level);
  const stale=!valid||age===null||!Number.isFinite(age)||age<0||age>LIMITS.staleMs;
  return {schema:"ynx-transport-job-status/v1",stale,ageMs:age,level:stale?"monitor-stale":prior.level,
    notificationDeliveryConfigured:false,globalRegionalVerified:false};
}

export async function runJob(options,{exec=runCommand,now=Date.now}={}){
  if(options.status)return status(options.directory,now());
  if(!options.live)return {dryRun:true,networkRequests:0,filesWritten:0,requestsPerRun:8,automaticScheduleEnabled:false};
  privateDirectory(options.directory);
  const lock=path.join(options.directory,".run.lock");
  try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==="EEXIST")throw new Error("MONITOR_LOCKED");throw e;}
  const lockOwner=path.join(lock,"owner.json");
  fs.writeFileSync(lockOwner,JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()}),{flag:"wx",mode:0o600});
  try{
    const usage=storageUsage(options.directory);
    assert(usage.bytes+LIMITS.reserveBytes<=LIMITS.maxStorageBytes&&usage.files+8<=LIMITS.maxFiles,"STORAGE_LIMIT");
    const previous=previousState(options.directory);
    if(previous)assert(now()-Date.parse(previous.checkedAt)>=LIMITS.minimumGapMs,"COOLDOWN_OR_CLOCK_REGRESSION");
    const expectedMode=options.monitorOptions.pinOrigin?"pinned-public-origin":options.monitorOptions.direct?"direct-dns":"environment-dns";
    if(previous)assert(previous.identity===options.monitorOptions.vantage+"/"+expectedMode,"STATE_IDENTITY_MISMATCH");
    const runDirectory=path.join(options.directory,"run-"+new Date(now()).toISOString().replace(/[:.]/g,"-")+"-"+randomUUID());
    const script=fileURLToPath(new URL("./testnet-transport-monitor.mjs",import.meta.url));
    const raw=await exec(process.execPath,[script,"--live","--rounds","2","--interval-seconds","30",...options.monitorArgs,"--output-dir",runDirectory],{timeout:240000,maxBuffer:1048576});
    assert([0,2].includes(raw.exitCode),"COLLECTOR_FAILED");
    const bundle=writeBundle(runDirectory,path.join(runDirectory,"diagnostic-bundle.json"));
    const next=evaluate(bundle,previous,now());
    fs.writeFileSync(path.join(runDirectory,"alert.json"),JSON.stringify(next,null,2)+"\n",{flag:"wx",mode:0o600});
    fs.writeFileSync(path.join(runDirectory,"previous-state.json"),JSON.stringify(previous,null,2)+"\n",{flag:"wx",mode:0o600});
    storageUsage(options.directory);
    const temporary=path.join(options.directory,".state-"+randomUUID()+".json");
    const fd=fs.openSync(temporary,"wx",0o600);
    try{fs.writeSync(fd,JSON.stringify(next,null,2)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temporary,path.join(options.directory,"state.json"));
    return {schema:"ynx-transport-job-result/v1",runId:bundle.runId,level:next.level,alert:next.alert,
      healthy:bundle.healthySamples,total:bundle.observedSamples,complete:bundle.complete,bundleName:path.basename(runDirectory)+"/diagnostic-bundle.json",
      automaticScheduleEnabled:false,globalRegionalVerified:false};
  }finally{
    // Remove only this invocation's known lock file and now-empty directory.
    fs.unlinkSync(lockOwner);fs.rmdirSync(lock);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await runJob(parseJobArgs(process.argv.slice(2)));console.log(JSON.stringify(result));
    if(result.stale||result.level&&result.level!=="ok")process.exitCode=2;
  }catch{
    console.error(JSON.stringify({schema:"ynx-transport-job-error/v1",level:"monitor-error",operatorActionRequired:true,
      diagnostic:"Check lock owner, cooldown, storage capacity/permissions, state identity, collector artifacts and hashes. No auto-cleanup or service change was attempted.",notificationDeliveryConfigured:false}));process.exitCode=3;
  }
}
