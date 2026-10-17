import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {createNativeResourceProbe} from './native-resource-probe.mjs';
import {validateNativeResourceSample} from './native-resource-sample.mjs';
import {ownedProcessSet,ownedProcessSetFromNative} from './owned-process-set.mjs';

// One private stable process family; no Go, ports, application state or UI.
if(process.argv[2]==='--worker'){
  if(!process.send)throw Error('private worker requires parent IPC');
  const children=[];
  let closing=false;
  const stop=async()=>{
    if(closing)return;closing=true;
    for(const c of children)try{process.kill(c.group ? -c.pid : c.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')process.exitCode=1}
    await Promise.all(children.map(c=>c.closed));if(process.connected)process.disconnect();
  };
  process.on('SIGTERM',stop);process.on('disconnect',stop);
  try{
    for(const detached of [false,true]){
      const child=spawn('/bin/sleep',['20'],{detached,stdio:'ignore'});
      const row={pid:child.pid,group:detached};children.push(row);
      row.closed=new Promise(resolve=>child.once('close',resolve));
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
      process.send({type:'child',pid:child.pid,group:detached});
    }
    process.send({type:'ready'});
  }catch(e){process.send({type:'error',message:e.message});await stop()}
}else{
  const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1]};
  const binary=path.resolve(value('--binary')??'artifacts/chain-performance-20261017/ynx-consensus-perf-host-owned-v2');
  const caps={activeMs:45000,cleanupMs:15000,ownedRSSBytes:400*1024*1024,threadsWithControlReserve:320,probeMs:1500,probeBytes:1024*1024};
  if(!args.includes('--execute')){
    console.log(JSON.stringify({status:'prepared_only_no_processes_started',binary,caps,requires:'fresh Root tiny-native grant; new binary SHA via --sha256; exclusive --output; native pressure1; stable owned family/ps differential and cleanup'}));
  }else{
    const output=value('--output'),expected=value('--sha256');
    if(process.platform!=='darwin'||!output||fs.existsSync(output)||!/^[0-9a-f]{64}$/.test(expected??''))throw Error('new output and exact candidate SHA required on macOS');
    const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if(hash(binary)!==expected)throw Error('candidate binary pin mismatch');
    const old='artifacts/chain-performance-20261017/ynx-consensus-perf-host-pressure';
    if(hash(old)!=='3025b7f5bac1220e18cac1e9e14051553d918348df07873f392f33c700ba3cc6')throw Error('old frozen binary changed');
    const started=Date.now(),probe=createNativeResourceProbe(binary),exec=promisify(execFile);
    const result={startedAt:new Date().toISOString(),launcher:process.pid,binary,sha256:expected,caps,firstCause:null,probes:probe.records,children:[],checks:[],peakRSS:0,peakThreads:0};
    let job,jobClosed,deadline;
    const fail=e=>result.firstCause??=String(e);
    const signal=(id,sig)=>{try{process.kill(id,sig)}catch(e){if(e.code!=='ESRCH')fail(e.message)}};
    const gone=id=>{try{process.kill(id,0);return false}catch(e){if(e.code!=='ESRCH')fail(e.message);return e.code==='ESRCH'}};
    const charge=s=>{
      result.peakRSS=Math.max(result.peakRSS,s.rssWithControlReserveBytes);
      result.peakThreads=Math.max(result.peakThreads,s.threadsWithControlReserve);
      if(result.peakRSS>caps.ownedRSSBytes||result.peakThreads>caps.threadsWithControlReserve)throw Error('original owned resource cap exceeded');
    };
    try{
      deadline=setTimeout(()=>{fail('45s active deadline');if(job?.pid)signal(-job.pid,'SIGTERM')},caps.activeMs);
      const first=await probe.run(['--full',String(process.pid)]);
      result.preflight=JSON.parse(first.stdout);
      charge(result.preflight);
      validateNativeResourceSample(result.preflight,process.pid,{expectedPIDs:[process.pid]});
      job=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker'],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
      result.job={pid:job.pid??null,exited:false};
      jobClosed=new Promise(resolve=>job.once('close',(code,signal)=>{Object.assign(result.job,{exited:true,code,signal});resolve()}));
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('private family readiness deadline')),3000);
        const finish=fn=>v=>{clearTimeout(timeout);fn(v)};
        job.once('error',finish(reject));job.once('close',()=>finish(reject)(Error('private family exited before readiness')));
        job.on('message',m=>{
          if(m.type==='child'&&Number.isSafeInteger(m.pid)&&m.pid>1)result.children.push({pid:m.pid,group:m.group===true});
          if(m.type==='error')finish(reject)(Error(m.message));
          if(m.type==='ready')finish(resolve)();
        });
      });
      const raw=await probe.run(['--owned-full',String(process.pid),String(job.pid)]);
      result.nativeRaw=raw.stdout;result.native=JSON.parse(raw.stdout);charge(result.native);
      const nativeOwned=ownedProcessSetFromNative(result.native,process.pid,job.pid);
      const ps=await exec('/bin/ps',['-axo','pid=,ppid=,pgid='],{timeout:1500,maxBuffer:1024*1024,killSignal:'SIGKILL'});
      result.psRaw=ps.stdout;
      const psOwned=ownedProcessSet(ps.stdout,process.pid,job.pid);
      if(JSON.stringify(nativeOwned)!==JSON.stringify(psOwned))throw Error('real native/ps owned-set mismatch');
      const psRows=new Map(ps.stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)).map(([pid,parent,group])=>[pid,{parent,group}]));
      for(const row of result.native.inventory.rows.filter(r=>nativeOwned.includes(r.pid))){const other=psRows.get(row.pid);if(!other||other.parent!==row.parent||other.group!==row.group)throw Error('real native/ps owned identity mismatch')}
      result.checks.push({kind:'real_stable_family_native_ps_identity_equivalence',nativeOwned,psOwned,passed:true});
      const psIDs=new Set(psRows.keys()),nativeIDs=new Set(result.native.inventory.rows.map(r=>r.pid));
      result.hostDifference={onlyNative:[...nativeIDs].filter(p=>!psIDs.has(p)),onlyPs:[...psIDs].filter(p=>!nativeIDs.has(p)),interpretation:'Sequential host observations; differences outside the controlled family are retained, not declared atomic equality.'};
      for(const mutate of [s=>delete s.inventory,s=>s.inventory.complete=false,s=>{s.inventory.rows=s.inventory.rows.filter(r=>r.pid!==job.pid);s.host.processCount--},s=>s.processes.pop(),s=>s.processes.find(p=>p.pid===job.pid).readable=false,s=>s.forkProbe.available=false,s=>s.memoryPressure.dispatchLevel=2]){
        const s=structuredClone(result.native);mutate(s);let refused=false;try{ownedProcessSetFromNative(s,process.pid,job.pid)}catch{refused=true}if(!refused)throw Error('mutated native fault was admitted');
      }
      result.checks.push({kind:'seven_fault_mutations_of_actual_native_sample',passed:true});
    }catch(e){fail(e.message)}finally{
      clearTimeout(deadline);await probe.stop();
      if(job?.pid)signal(-job.pid,'SIGTERM');
      const cleanup=Date.now();
      while(Date.now()-cleanup<caps.cleanupMs){
        if(job?.pid&&!gone(-job.pid)&&Date.now()-cleanup>2000)signal(-job.pid,'SIGKILL');
        for(const c of result.children)if(!gone(c.pid))signal(c.group?-c.pid:c.pid,'SIGTERM');
        if((!job?.pid||gone(-job.pid))&&result.children.every(c=>gone(c.pid)&&(!c.group||gone(-c.pid))))break;
        await delay(50);
      }
      result.groupGone=!job?.pid||gone(-job.pid);
      result.childrenGone=result.children.every(c=>gone(c.pid)&&(!c.group||gone(-c.pid)));
      if(!result.groupGone||!result.childrenGone)fail('owned cleanup incomplete');
      if(jobClosed&&result.groupGone)await Promise.race([jobClosed,delay(500)]);
      result.elapsedMs=Date.now()-started;
      fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
      console.log(JSON.stringify({firstCause:result.firstCause,launcher:result.launcher,job:result.job,children:result.children,peakRSS:result.peakRSS,peakThreads:result.peakThreads,groupGone:result.groupGone,childrenGone:result.childrenGone,elapsedMs:result.elapsedMs}));
      process.exitCode=result.firstCause?1:0;
    }
  }
}
