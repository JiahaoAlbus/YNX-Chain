import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// One owned process group at a time. A failed monitor remains fatal to callers.
export function createNativeResourceProbe(command, { timeoutMs = 1500, maxBytes = 1024 * 1024, persistent = false, maxRequests = 4096 } = {}) {
  if(persistent)return createPersistentNativeResourceProbe(command,{timeoutMs,maxBytes,maxRequests});
  let pending;
  let cancel;
  let stopped = false;
  const records = [];
  function run(args) {
    if (stopped) return Promise.reject(Error('native resource probe stopped'));
    if (pending) return Promise.reject(Error('native resource probe overlap'));
    const started = performance.now();
    const record = { command, args:[...args], launcherPID:process.pid, launcherParentPID:process.ppid, runtime:{platform:process.platform,arch:process.arch,node:process.version}, spawnRequestedAt:new Date().toISOString(), spawnedAt:null, spawnElapsedMs:null, startedAt: new Date().toISOString(), pid: null, status: null, signal: null, error: null, stdout: '', stderr: '', exited: false, groupGone: false };
    records.push(record);
    const operation = new Promise((resolve, reject) => {
      let bytes = 0;
      const output = { stdout: [], stderr: [] };
      const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      record.pid = child.pid ?? null;
      child.once('spawn',()=>{record.spawnedAt=new Date().toISOString();record.spawnElapsedMs=performance.now()-started;});
      const kill = () => {
        if (!child.pid) return;
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') record.error ??= error.message; }
      };
      cancel = () => { record.error ??= 'native resource probe cancelled'; kill(); };
      const timer = setTimeout(() => { record.error ??= 'native resource probe ETIMEDOUT'; kill(); }, timeoutMs);
      const capture = key => data => {
        bytes += data.length;
        if (bytes <= maxBytes) output[key].push(data);
        record[key] += data.subarray(0, Math.max(0, 65536 - Buffer.byteLength(record[key]))).toString('utf8');
        if (bytes > maxBytes) { record.error ??= 'native resource probe output limit'; kill(); }
      };
      child.stdout.on('data', capture('stdout'));
      child.stderr.on('data', capture('stderr'));
      child.on('error', error => { record.error ??= error.message; });
      child.on('close', (status, signal) => {
        clearTimeout(timer);
        record.status = status; record.signal = signal; record.exited = true;
        // Also retire a descendant if the probe parent exited unexpectedly.
        kill();
        if (!child.pid) record.groupGone = true;
        else try { process.kill(-child.pid, 0); }
        catch (error) { record.groupGone = error.code === 'ESRCH'; }
        record.elapsedMs = performance.now() - started;
        if (record.elapsedMs >= timeoutMs) record.error ??= 'native resource probe deadline exceeded';
        if (record.error || status !== 0 || signal || !record.groupGone) {
          reject(Error(`native resource probe failed: ${record.error ?? signal ?? status ?? 'group still present'}`));
        } else resolve({ ...record, stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') });
      });
    });
    pending = operation.finally(() => { pending = undefined; cancel = undefined; });
    return pending;
  }
  return {
    run, records,
    get busy() { return !!pending; },
    async stop() {
      stopped = true;
      cancel?.();
      try { await pending; } catch { /* original failure is retained in records */ }
    },
  };
}

// Explicit transport alternative. Every request still performs a fresh native
// snapshot; no sample, host enumeration or fork outcome is cached or substituted.
function createPersistentNativeResourceProbe(command,{timeoutMs,maxBytes,maxRequests}) {
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>4096)throw Error('invalid persistent native probe bounds');
 const records=[];let child,record,current,closed,resolveClosed,stopped=false,spawned=false,failure,totalBytes=0,buffer='',sequence=0;
 const kill=()=>{if(child?.pid)try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')record.error??=e.message;}};
 function fail(message){
  failure??=Error('native resource probe failed: '+message);if(record)record.error??=message;
  if(current){const request=current;current=undefined;clearTimeout(request.timer);request.entry.error=message;request.reject(failure);}
  kill();
 }
 function writeRequest(){if(current&&spawned)child.stdin.write(current.wire,error=>{if(error)fail(error.message);});}
 function start(){
  const began=performance.now();record={command,args:['--serve'],mode:'persistent',launcherPID:process.pid,launcherParentPID:process.ppid,runtime:{platform:process.platform,arch:process.arch,node:process.version},spawnRequestedAt:new Date().toISOString(),spawnedAt:null,spawnElapsedMs:null,pid:null,status:null,signal:null,error:null,stdout:'',stderr:'',exited:false,groupGone:false,requests:[]};records.push(record);
  closed=new Promise(resolve=>{resolveClosed=resolve;});
  try{child=spawn(command,['--serve'],{detached:true,stdio:['pipe','pipe','pipe']});}
  catch(e){record.exited=true;record.groupGone=true;fail(e.message);resolveClosed();return;}
  record.pid=child.pid??null;
  child.once('spawn',()=>{spawned=true;record.spawnedAt=new Date().toISOString();record.spawnElapsedMs=performance.now()-began;writeRequest();});
  function capture(key,data){
   totalBytes+=data.length;record[key]+=data.subarray(0,Math.max(0,65536-Buffer.byteLength(record[key]))).toString('utf8');
   if(totalBytes>maxBytes){fail('native resource probe output limit');return false;}
   return true;
  }
  child.stderr.on('data',data=>{if(!capture('stderr',data))return;if(current)current.entry.stderr+=data.toString('utf8');});
  child.stdout.on('data',data=>{
   if(!capture('stdout',data))return;
   buffer+=data.toString('utf8');const newline=buffer.indexOf('\n');if(newline<0)return;
   const frame=buffer.slice(0,newline);if(buffer.slice(newline+1).length){fail('duplicate or trailing native response');return;}buffer='';
   let response;try{response=JSON.parse(frame);}catch{fail('invalid native response JSON');return;}
   if(stopped&&!current&&response&&Object.keys(response).join(',')==='stoppedAfter'&&response.stoppedAfter===sequence&&!record.shutdownAcknowledged){record.shutdownAcknowledged=true;return;}
   if(!current){fail('unsolicited native response');return;}
   if(!response||Object.keys(response).sort().join(',')!=='requestId,sample'||response.requestId!==current.entry.requestId||!response.sample||typeof response.sample!=='object'||Array.isArray(response.sample)){fail('native response request identity differs');return;}
   const request=current;current=undefined;clearTimeout(request.timer);request.entry.envelope=frame+'\n';request.entry.elapsedMs=performance.now()-request.began;request.entry.responseAt=new Date().toISOString();
   request.resolve({command,pid:record.pid,requestId:request.entry.requestId,stdout:JSON.stringify(response.sample)+'\n',stderr:request.entry.stderr,requestCompleted:true,processExited:false});
  });
  child.stdin.on('error',e=>fail(e.message));child.once('error',e=>fail(e.message));
  child.once('close',(status,signal)=>{
   record.status=status;record.signal=signal;record.exited=true;record.elapsedMs=performance.now()-began;
   if(!stopped||!record.shutdownAcknowledged||current||status!==0||signal)fail(record.error??('native server exited before clean EOF: '+(signal??status)));
   kill();if(!child.pid)record.groupGone=true;else try{process.kill(-child.pid,0);}catch(e){record.groupGone=e.code==='ESRCH';}
   if(!record.groupGone)fail('native probe original process group remains');
   resolveClosed();
  });
 }
 function run(args){
  if(stopped)return Promise.reject(Error('native resource probe stopped'));
  if(failure)return Promise.reject(failure);
  if(current)return Promise.reject(Error('native resource probe overlap'));
  if(!Array.isArray(args)||args.length<1||args.length>18||args.some(a=>typeof a!=='string'||!(/^(--full|--owned-full|[1-9][0-9]{0,9})$/).test(a))){fail('invalid persistent native argument');return Promise.reject(failure);}
  if(sequence>=maxRequests){fail('native probe request bound');return Promise.reject(failure);}
  return new Promise((resolve,reject)=>{
   const entry={requestId:++sequence,args:[...args],startedAt:new Date().toISOString(),responseAt:null,error:null,stderr:''};
   const began=performance.now();current={entry,began,resolve,reject,wire:[entry.requestId,...args].join(' ')+'\n'};
   current.timer=setTimeout(()=>fail('native resource probe ETIMEDOUT'),timeoutMs);
   if(!child)start();
   record?.requests.push(entry);if(spawned)writeRequest();
  });
 }
 return {run,records,get busy(){return !!current;},async stop(){
  if(!stopped){stopped=true;if(current)fail('native resource probe cancelled');else if(child&&!record.exited)child.stdin.end('STOP '+sequence+'\n');}
  if(closed){const timer=setTimeout(()=>fail('native probe shutdown deadline'),timeoutMs);try{await closed;}finally{clearTimeout(timer);}}
  if(failure)throw failure;
 }};
}
