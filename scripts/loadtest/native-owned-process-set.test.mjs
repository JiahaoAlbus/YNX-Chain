import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ownedProcessSet,ownedProcessSetFromNative} from './owned-process-set.mjs';

const sample=()=>({schema:2,scope:'native owned process inventory',host:{scanComplete:true,processCount:5},forkProbe:{available:true},memoryPressure:{source:'kern.memorystatus_vm_pressure_level',readable:true,dispatchLevel:1},rssWithControlReserveBytes:10000,threadsWithControlReserve:8,processes:[20,30,40].map(pid=>({pid,readable:true,rssBytes:1000,threads:1})),inventory:{source:'proc_listpids+kernel_identity',complete:true,ownershipComplete:true,launcherPID:20,jobPID:30,vanished:0,unresolved:0,unresolvedRows:[],rows:[{pid:1093,parent:1,group:1093},{pid:20,parent:1093,group:20},{pid:30,parent:20,group:30},{pid:40,parent:30,group:40},{pid:70,parent:1093,group:70}].map(r=>({...r,identitySource:'PROC_PIDTBSDINFO'}))}});

test('actual run02 preflight cannot substitute for post-START owned inventory',()=>{
  const actual=JSON.parse(fs.readFileSync(new URL('./fixtures/native-run02-preflight.json',import.meta.url))).sample;
  assert.equal(actual.memoryPressure.dispatchLevel,1);
  assert.deepEqual(actual.processes.map(p=>p.pid),[32122]);
  assert.equal(actual.host.scanComplete,true);
  assert.throws(()=>ownedProcessSetFromNative(actual,32122,33481),/inventory unavailable/);
});

test('native inventory matches group and recursive PPID ownership without ancestors',()=>{
  const s=sample();assert.deepEqual(ownedProcessSetFromNative(s,20,30),[20,30,40]);
  assert.deepEqual(ownedProcessSetFromNative(s,20,30),ownedProcessSet(s.inventory.rows.map(r=>`${r.pid} ${r.parent} ${r.group}`).join('\n'),20,30));
  s.inventory.rows[3].identitySource='KERN_PROC_PID';assert.deepEqual(ownedProcessSetFromNative(s,20,30),[20,30,40]);
});
test('old aggregates and absent or incomplete identity inventory fail closed',()=>{
  for(const mutate of [s=>{s.schema=1;delete s.inventory},s=>delete s.inventory,s=>s.inventory.complete=false,s=>s.inventory.ownershipComplete=false,s=>{s.inventory.unresolved=1;s.inventory.unresolvedRows=[{pid:71,bsdErrno:1,identityErrno:1}]},s=>s.inventory.vanished=-1,s=>s.host.processCount++,s=>s.inventory.rows.pop()]){const s=sample();mutate(s);assert.throws(()=>ownedProcessSetFromNative(s,20,30));}
});
test('missing roots and missing unreadable or extra owned task rows are fatal',()=>{
  for(const mutate of [s=>{s.inventory.rows=s.inventory.rows.filter(r=>r.pid!==30);s.host.processCount--},s=>{s.inventory.rows=s.inventory.rows.filter(r=>r.pid!==20);s.host.processCount--},s=>s.processes.pop(),s=>s.processes[2]={pid:40,readable:false,errno:3},s=>s.processes.push({pid:70,readable:true,rssBytes:1000,threads:1})]){const s=sample();mutate(s);assert.throws(()=>ownedProcessSetFromNative(s,20,30));}
});
test('host fork pressure and malformed or duplicate identity gates remain fatal',()=>{
  for(const mutate of [s=>s.host.scanComplete=false,s=>s.forkProbe.available=false,s=>s.memoryPressure.dispatchLevel=2,s=>s.inventory.rows[3].parent=-1,s=>{s.inventory.rows.push({...s.inventory.rows[3]});s.host.processCount++},s=>s.inventory.rows[3].identitySource='guessed']){const s=sample();mutate(s);assert.throws(()=>ownedProcessSetFromNative(s,20,30));}
});
