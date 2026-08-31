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
  const dir=await mkdtemp(join(tmpdir(),'ynx-monitor-rbac-'));
  const store=new OpsStore(join(dir,'state.json'));
  await store.load();
  await store.observeFailure('node','connection refused','http://127.0.0.1:1/status');
  const password='p'.repeat(16);
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
  return{base:`http://127.0.0.1:${address.port}`,password};
}

async function call(base:string,path:string,session?:TestSession,body?:Record<string,unknown>){
  const response=await fetch(base+path,{
    method:body?'POST':'GET',
    headers:{'content-type':'application/json',...(session?{authorization:`Bearer ${session.token}`,origin:operatorOrigin,'x-ynx-csrf-token':session.csrfToken}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  return{status:response.status,body:await response.json() as Record<string,unknown>};
}

async function login(base:string,username:string,password:string){
  const response=await call(base,'/ops/login',undefined,{username,password});
  assert.equal(response.status,200);
  return response.body as unknown as TestSession;
}

describe('Monitor scoped RBAC',()=>{
  it('separates incident, recovery, and security authority',async()=>{
    const{base,password}=await fixture();
    const incident=await login(base,'incident_commander',password);
    const recovery=await login(base,'backup_recovery',password);
    const security=await login(base,'security_reviewer',password);

    assert.equal((await call(base,'/ops/incidents',incident,{title:'Scoped incident',source:'evidence://incident',severity:'high',evidence:['evidence://incident']})).status,201);
    assert.equal((await call(base,'/ops/backup-records',incident,{evidence:'sha256:blocked'})).status,403);

    assert.equal((await call(base,'/ops/backup-records',recovery,{evidence:'sha256:verified-backup'})).status,201);
    assert.equal((await call(base,'/ops/incidents',recovery,{title:'Blocked',source:'evidence://blocked',severity:'low'})).status,403);

    assert.equal((await call(base,'/ops/alerts/upstream%3Anode/acknowledge',security,{approvalPhrase:'ACKNOWLEDGE'})).status,200);
    assert.equal((await call(base,'/ops/rollback-proposals',security,{release:'release-a',reason:'blocked',approvalPhrase:'APPROVE ROLLBACK PROPOSAL'})).status,403);
  });

  it('returns explicit capabilities to clients',async()=>{
    const{base,password}=await fixture();
    const token=await login(base,'backup_recovery',password);
    const me=await call(base,'/ops/me',token);
    assert.equal(me.status,200);
    assert.deepEqual(me.body.permissions,['incident:recovery_verify','backup:record','rollback:propose','automation:propose']);
  });
});
