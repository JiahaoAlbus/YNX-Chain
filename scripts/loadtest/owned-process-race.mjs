import {ownedProcessSet} from './owned-process-set.mjs';

export function ownedBirthInventory(raw,launcherPID,jobPID){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>1024*1024)throw Error('birth inventory unavailable');
 const identities=new Map();
 for(const line of raw.split('\n')){
  if(!line.trim())continue;
  const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})(?:\s+(.+))?$/);
  if(!m)throw Error('birth inventory row unavailable');
  const [pid,parent,group]=m.slice(1,4).map(Number);
  if(identities.has(pid))throw Error('duplicate birth identity');
  identities.set(pid,{pid,parent,group,birth:m[4].replace(/\s+/g,' '),...(m[5]?{comm:m[5]}:{})});
 }
 const ids=ownedProcessSet([...identities.values()].map(r=>`${r.pid} ${r.parent} ${r.group}`).join('\n'),launcherPID,jobPID);
 return {ids,identities};
}

// A single fresh sample is permitted only after independently proving each
// ESRCH child disappeared. The rejected raw sample never becomes valid RSS.
export function verifyExitedDuringSample(sample,before,after,launcherPID,jobPID,isAbsent){
 const failed=sample.processes?.filter(p=>p.readable!==true);
 if(!failed?.length)throw Error('no exited sample to reconcile');
 const exited=[];
 for(const row of failed){
  const identity=before.identities.get(row.pid);
  if(row.errno!==3||row.pid===launcherPID||row.pid===jobPID||!before.ids.includes(row.pid)||!identity||after.identities.has(row.pid)||isAbsent(row.pid)!==true)throw Error('unproven exited child or reused identity');
  exited.push({...identity,errno:3,exitedDuringSample:true});
 }
 for(const pid of before.ids){
  const a=before.identities.get(pid),b=after.identities.get(pid);
  if(b&&(a.birth!==b.birth||a.group!==b.group))throw Error('owned PID birth/group changed during sample');
  if(!b&&!exited.some(r=>r.pid===pid)){
   const row=sample.processes.find(r=>r.pid===pid);
   if(pid===launcherPID||pid===jobPID||!row||row.readable!==true||!Number.isSafeInteger(row.rssBytes)||row.rssBytes<0||!Number.isSafeInteger(row.threads)||row.threads<1||isAbsent(pid)!==true)throw Error('unaccounted missing owned identity');
   exited.push({...a,exitedDuringSample:true,readableAtKernelQuery:true,kernelAbsenceVerified:true});
  }
 }
 return exited;
}

// One kernel replacement has already occurred. A final identity inventory can
// prove only exited children; it cannot excuse any unmeasured current process.
// Keep the native RSS/thread aggregate unchanged, including any now-exited
// readable rows. Never invent zero RSS for an unreadable live identity.
export function closeReplacementExitRace(sample,before,after,launcherPID,jobPID,isAbsent){
 const pids=sample.processes?.map(p=>p.pid);
 if(!pids||pids.length!==before.ids.length||new Set(pids).size!==pids.length||pids.some(pid=>!before.ids.includes(pid)))throw Error('replacement native identities differ from requested set');
 const exited=verifyExitedDuringSample(sample,before,after,launcherPID,jobPID,isAbsent);
 for(const pid of after.ids){
  const row=sample.processes.find(p=>p.pid===pid);
  if(!row||row.readable!==true)throw Error('current owned process remains unmeasured');
 }
 const retained=sample.processes.filter(p=>after.ids.includes(p.pid));
 return {sample:{...sample,processes:retained,captureDisposition:'post-read proven child exits; original RSS/thread aggregate unchanged'},exited};
}
