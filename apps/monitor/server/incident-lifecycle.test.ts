import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { OpsStore } from './store.js';
import type { Role } from './types.js';

const servers:Server[]=[];
const operatorOrigin='https://monitor.test';
type TestSession={token:string;csrfToken:string};

after(async()=>{
  await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
});

async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'ynx-monitor-incident-'));
  const path=join(dir,'state.json');
  const integrityKey='k'.repeat(32);
  const store=new OpsStore(path,integrityKey);
  await store.load();
  const password='p'.repeat(18);
  const roles:Role[]=['incident_commander','backup_recovery','security_reviewer'];
  const users=roles.map(role=>({username:role,role,passwordHash:hashPassword(password)}));
  const app=await createApp({
    store,
    secret:'s'.repeat(32),
    users,
    allowedOrigins:[operatorOrigin],
    rpcUrl:'http://127.0.0.1:1',
    explorerUrl:'http://127.0.0.1:1',
    indexerUrl:'http://127.0.0.1:1',
    aiUrl:'http://127.0.0.1:1',
  });
  const server=app.listen(0,'127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('test server did not bind');
  return{base:`http://127.0.0.1:${address.port}`,password,path,integrityKey};
}

async function call(base:string,path:string,session?:TestSession,body?:Record<string,unknown>){
  const response=await fetch(base+path,{
    method:body?'POST':'GET',
    headers:{'content-type':'application/json',...(session?{authorization:`Bearer ${session.token}`,origin:operatorOrigin,'x-ynx-csrf-token':session.csrfToken}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  return{status:response.status,body:await response.json() as Record<string,any>};
}

async function login(base:string,username:string,password:string){
  const response=await call(base,'/ops/login',undefined,{username,password});
  assert.equal(response.status,200);
  return response.body as unknown as TestSession;
}

async function transition(base:string,id:string,action:string,session:TestSession,summary:string,evidence:string[]=[]){
  return call(base,`/ops/incidents/${encodeURIComponent(id)}/actions/${action}`,session,{summary,evidence});
}

describe('Monitor incident lifecycle',()=>{
  it('enforces ordered transitions, independent recovery verification, postmortem, and export',async()=>{
    const{base,password}=await fixture();
    const commander=await login(base,'incident_commander',password);
    const recovery=await login(base,'backup_recovery',password);

    const created=await call(base,'/ops/incidents',commander,{
      title:'Validator finality degradation',
      source:'evidence://finality-gap',
      severity:'critical',
      evidence:['evidence://finality-gap'],
    });
    assert.equal(created.status,201);
    const id=created.body.id as string;
    assert.equal(created.body.status,'open');
    assert.equal(created.body.timeline.length,1);

    const skipped=await transition(base,id,'mitigate',commander,'Attempted skip',['evidence://skip']);
    assert.equal(skipped.status,409);
    assert.equal(skipped.body.error,'invalid_incident_transition');
    assert.equal(skipped.body.currentStatus,'open');

    const assigned=await call(base,`/ops/incidents/${id}/assign`,commander,{owner:'oncall-consensus',evidence:['evidence://rotation']});
    assert.equal(assigned.status,200);
    assert.equal(assigned.body.incident.owner,'oncall-consensus');

    assert.equal((await transition(base,id,'acknowledge',commander,'Incident acknowledged',['evidence://ack'])).body.incident.status,'acknowledged');
    const duplicate=await transition(base,id,'acknowledge',commander,'Duplicate retry',['evidence://ack']);
    assert.equal(duplicate.status,200);
    assert.equal(duplicate.body.changed,false);
    assert.equal((await transition(base,id,'investigate',commander,'Investigation started',['evidence://query'])).body.incident.status,'investigating');

    const note=await call(base,`/ops/incidents/${id}/notes`,commander,{summary:'Three validators remain in agreement.',evidence:['evidence://precommit']});
    assert.equal(note.status,200);
    assert.equal(note.body.incident.notes.length,1);

    assert.equal((await transition(base,id,'mitigate',commander,'Traffic isolated',['evidence://route-pause'])).body.incident.status,'mitigated');
    assert.equal((await transition(base,id,'begin_recovery',commander,'Recovery candidate started',['evidence://candidate'])).body.incident.status,'recovery_verifying');

    const commanderVerify=await transition(base,id,'verify_recovery',commander,'Commander cannot self-verify',['evidence://probe']);
    assert.equal(commanderVerify.status,403);
    assert.equal(commanderVerify.body.requiredPermission,'incident:recovery_verify');

    const missingEvidence=await transition(base,id,'verify_recovery',recovery,'Recovery checked');
    assert.equal(missingEvidence.status,400);
    assert.equal(missingEvidence.body.error,'recovery_evidence_required');

    const verified=await transition(base,id,'verify_recovery',recovery,'Fixed-height finality and service checks passed',['evidence://fixed-height','evidence://service-smoke']);
    assert.equal(verified.status,200);
    assert.equal(verified.body.incident.status,'resolved');
    assert.ok(verified.body.incident.recoveryVerifiedAt);

    const recoveryPostmortem=await call(base,`/ops/incidents/${id}/postmortem`,recovery,{
      summary:'Blocked review',rootCause:'N/A',correctiveActions:['N/A'],evidence:['evidence://blocked'],
    });
    assert.equal(recoveryPostmortem.status,403);

    const postmortem=await call(base,`/ops/incidents/${id}/postmortem`,commander,{
      summary:'Finality probe recovered after route isolation.',
      rootCause:'A stale routing dependency delayed one validator peer set.',
      correctiveActions:['Add route freshness alert','Exercise regional failover monthly'],
      evidence:['evidence://postmortem','evidence://corrective-plan'],
    });
    assert.equal(postmortem.status,200);
    assert.equal(postmortem.body.incident.status,'postmortem_complete');
    assert.equal(postmortem.body.incident.postmortem.correctiveActions.length,2);

    const exported=await call(base,`/ops/incidents/${id}/export`,commander);
    assert.equal(exported.status,200);
    assert.equal(exported.body.schemaVersion,'ynx.monitor.incident-export.v1');
    assert.equal(exported.body.incident.id,id);
    assert.equal(exported.body.incident.timeline.at(-1).action,'incident.complete_postmortem');

    const audit=await call(base,'/ops/audit',commander);
    const actions=audit.body.audit.map((item:Record<string,unknown>)=>item.action);
    assert.ok(actions.includes('incident.assign'));
    assert.ok(actions.includes('incident.transition'));
    assert.ok(actions.includes('incident.note'));
    assert.ok(actions.includes('incident.postmortem'));
  });

  it('persists the versioned lifecycle and rejects a postmortem before recovery verification',async()=>{
    const{base,password,path,integrityKey}=await fixture();
    const commander=await login(base,'incident_commander',password);
    const created=await call(base,'/ops/incidents',commander,{title:'Provider outage',source:'evidence://provider',severity:'high',evidence:['evidence://provider']});
    const id=created.body.id as string;

    const early=await call(base,`/ops/incidents/${id}/postmortem`,commander,{
      summary:'Too early',rootCause:'Unknown',correctiveActions:['Wait'],evidence:['evidence://early'],
    });
    assert.equal(early.status,409);
    assert.equal(early.body.currentStatus,'open');

    await transition(base,id,'acknowledge',commander,'Acknowledged',['evidence://ack']);
    const restarted=new OpsStore(path,integrityKey);
    await restarted.load();
    const incident=restarted.exportIncident(id);
    assert.equal(incident?.schemaVersion,1);
    assert.equal(incident?.status,'acknowledged');
    assert.equal(incident?.timeline.at(-1)?.action,'incident.acknowledge');
  });
});
