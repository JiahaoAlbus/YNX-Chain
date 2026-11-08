import {spawn,spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
export class WholeBudget {
 constructor(ms=90000,reserveMs=6000,now=()=>performance.now()){if(!(ms>reserveMs&&reserveMs>=0))throw Error('invalid finite budget');this.now=now;this.start=now();this.deadline=this.start+ms;this.reserveMs=reserveMs;this.limitMs=ms;}
 remaining(){return Math.max(0,Math.floor(this.deadline-this.now()));}
 commandLimit(maxMs){return Math.max(0,Math.min(maxMs,this.remaining()-this.reserveMs));}
}
const tick=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(1,ms)));
function processSnapshot(limitMs){
 if(limitMs<1)return{known:false,error:'whole budget exhausted before process observation',rows:[]};
 const r=spawnSync('/bin/ps',['-axo','pid=,ppid=,pgid=,uid=,lstart='],{encoding:'utf8',env:{...process.env,LC_ALL:'C'},timeout:Math.min(800,limitMs),maxBuffer:8<<20});
 if(r.status!==0||r.error)return{known:false,error:r.error?.message??r.stderr??'ps failed',rows:[]};
 const rows=[];for(const line of r.stdout.split('\n')){if(!line.trim())continue;const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s*$/);if(!m)return{known:false,error:'unparsed ps row',rows:[]};rows.push({pid:+m[1],ppid:+m[2],pgid:+m[3],uid:+m[4],start:m[5]});}return{known:true,rows};
}
export async function runOwnedCommand({exe,args,cwd,env,stdio,budget,maxMs,onStart=()=>{},termGraceMs=600,killGraceMs=600}){
 const limit=budget.commandLimit(maxMs);if(limit<1)return{exe,args,spawned:false,status:null,signal:null,error:{code:'WHOLE_BUDGET_EXHAUSTED'},terminal:true,directReaped:true,groupObservationKnown:true,pid:null,pgid:null,groupRemaining:[],childRemaining:[],cleanupUnknown:false};
 const started=budget.now(),workDeadline=started+limit,child=spawn(exe,args,{cwd,env,stdio,detached:true});
 const pid=child.pid??null,pgid=pid,uid=process.getuid(),tracked=new Map(),observations=[],signals=[];let reaped=false,status=null,signal=null,spawnError=null,timedOut=false,ownershipUnknown=false,firstObservationError=null;
 child.on('error',e=>{spawnError={code:e.code,message:e.message};});
 child.on('close',(code,sig)=>{reaped=true;status=code;signal=sig;});
 onStart({exe,args,pid,pgid,detached:true,limitMs:limit,remainingWholeMs:budget.remaining(),monotonicStartedMs:started});
 const observe=()=>{
  if(!pid)return{known:reaped,group:[],descendants:[],error:spawnError};
  const snap=processSnapshot(budget.remaining());if(!snap.known){ownershipUnknown=true;firstObservationError??=snap.error;return{known:false,group:[],descendants:[],error:snap.error};}
  let group=snap.rows.filter(r=>r.pgid===pgid);if(group.some(r=>r.uid!==uid)){ownershipUnknown=true;firstObservationError??='owned group changed UID';return{known:false,group,descendants:[],error:'owned group changed UID'};}
  const current=new Map(snap.rows.map(r=>[r.pid,r]));
  for(const r of group){const old=tracked.get(r.pid);if(old&&(old.start!==r.start||old.uid!==r.uid)){ownershipUnknown=true;firstObservationError??='observed PID identity changed';return{known:false,group,descendants:[],error:'observed PID identity changed'};}tracked.set(r.pid,r);}
  let more=true;while(more){more=false;for(const r of snap.rows){if(tracked.has(r.pid))continue;const parent=tracked.get(r.ppid),actualParent=current.get(r.ppid);if(parent&&actualParent&&actualParent.start===parent.start&&actualParent.uid===parent.uid){if(r.uid!==uid){ownershipUnknown=true;firstObservationError??='descendant changed UID';return{known:false,group,descendants:[],error:'descendant changed UID'};}tracked.set(r.pid,r);more=true;}}}
  const descendants=[];for(const [id,old]of tracked){const r=current.get(id);if(!r)continue;if(r.start!==old.start||r.uid!==old.uid){ownershipUnknown=true;firstObservationError??='tracked PID identity changed';return{known:false,group,descendants:[],error:'tracked PID identity changed'};}if(r.pgid!==pgid)descendants.push(r);}
  const row={known:true,group,descendants,remainingWholeMs:budget.remaining()};observations.push(row);return row;
 };
 let state=observe();
 while(budget.now()<workDeadline){
  if(reaped&&state.known&&state.group.length===0&&state.descendants.length===0)break;
  await tick(Math.min(40,Math.max(1,workDeadline-budget.now())));state=observe();
 }
 const complete=()=>reaped&&state.known&&state.group.length===0&&state.descendants.length===0;
 function send(sig){
  state=observe();if(!pid||!state.known||ownershipUnknown)return;
  if(state.group.length){try{process.kill(-pgid,sig);signals.push({scope:'owned-group',pgid,signal:sig,sent:true});}catch(e){signals.push({scope:'owned-group',pgid,signal:sig,sent:false,code:e.code});}}
  for(const r of state.descendants){try{process.kill(r.pid,sig);signals.push({scope:'observed-owned-descendant',pid:r.pid,start:r.start,signal:sig,sent:true});}catch(e){signals.push({scope:'observed-owned-descendant',pid:r.pid,signal:sig,sent:false,code:e.code});}}
 }
 async function drain(ms){const end=Math.min(budget.deadline,budget.now()+ms);while(budget.now()<end){state=observe();if(complete())return;await tick(Math.min(35,Math.max(1,end-budget.now())));}state=observe();}
 if(!complete()){
  timedOut=true;send('SIGTERM');await drain(Math.min(termGraceMs,budget.remaining()));
  if(!complete()&&budget.remaining()>0){send('SIGKILL');await drain(Math.min(killGraceMs,budget.remaining()));}
 }
 state=observe();const terminal=complete()&&!ownershipUnknown;
 if(!terminal)child.unref();
 return{exe,args,spawned:pid!==null,pid,pgid,detached:true,limitMs:limit,status,signal,error:spawnError,timedOut,wallMs:budget.now()-started,directReaped:reaped,terminal,cleanupUnknown:!terminal,groupObservationKnown:state.known,groupRemaining:state.group,childRemaining:state.descendants,ownershipUnknown,firstObservationError,processObservationError:state.error??null,signals,observations,remainingWholeMs:budget.remaining()};
}

export function physicalCommandsComplete(results){return results.length>0&&results.every(r=>r.terminal&&r.directReaped&&r.groupObservationKnown&&r.groupRemaining.length===0&&r.childRemaining.length===0&&!r.cleanupUnknown);}
