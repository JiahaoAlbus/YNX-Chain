import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { OpsStore } from './store.js';

const servers:Server[]=[];
const origin='https://monitor.test';
const password='automation-test-password';
type Session={token:string;csrfToken:string};

after(async()=>{
  await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
});

async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'ynx-monitor-automation-'));
  const store=new OpsStore(join(dir,'state.json'));
  await store.load();
  const app=await createApp({
    store,
    secret:'s'.repeat(32),
    users:[
      {username:'recovery',role:'backup_recovery',passwordHash:hashPassword(password)},
      {username:'reviewer',role:'security_reviewer',passwordHash:hashPassword(password)},
    ],
    allowedOrigins:[origin],
    automationTargets:['indexer:ingestion'],
  });
  const server=app.listen(0,'127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('test server did not bind');
  return{base:`http://127.0.0.1:${address.port}`,store};
}

async function call(base:string,path:string,session?:Session,body?:Record<string,unknown>){
  const response=await fetch(base+path,{
    method:body?'POST':'GET',
    headers:{'content-type':'application/json',...(session?{authorization:`Bearer ${session.token}`,origin,'x-ynx-csrf-token':session.csrfToken}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  return{status:response.status,body:await response.json() as Record<string,any>};
}

async function login(base:string,username:string){
  const response=await call(base,'/ops/login',undefined,{username,password});
  assert.equal(response.status,200);
  return response.body as Session;
}

describe('bounded automation proposal lifecycle',()=>{
  it('allows only an expiring, pre-approved, duration-bounded pause with independent review',async()=>{
    const{base,store}=await fixture();
    const recovery=await login(base,'recovery');
    const reviewer=await login(base,'reviewer');
    const common={action:'pause',reason:'contain ingestion lag',evidence:['evidence://incident-42'],maxPauseSeconds:300};

    assert.equal((await call(base,'/ops/automation-proposals',recovery,{...common,target:'wallet:transfers',approvalPhrase:'PROPOSE PAUSE wallet:transfers'})).status,403);
    assert.equal((await call(base,'/ops/automation-proposals',recovery,{...common,target:'indexer:ingestion',maxPauseSeconds:901,approvalPhrase:'PROPOSE PAUSE indexer:ingestion'})).status,400);
    assert.equal((await call(base,'/ops/automation-proposals',reviewer,{...common,target:'indexer:ingestion',approvalPhrase:'PROPOSE PAUSE indexer:ingestion'})).status,403);

    const created=await call(base,'/ops/automation-proposals',recovery,{...common,target:'indexer:ingestion',approvalPhrase:'PROPOSE PAUSE indexer:ingestion'});
    assert.equal(created.status,201);
    assert.equal(created.body.status,'pending_review');
    assert.equal(created.body.executionBoundary,'central infrastructure owner');
    assert.match(created.body.authorityBoundary,/no asset movement or authority expansion/);
    assert.ok(Date.parse(created.body.expiresAt)-Date.parse(created.body.requestedAt)<=300_000);

    assert.equal((await call(base,`/ops/automation-proposals/${created.body.id}/review`,recovery,{decision:'approved',evidence:['evidence://review'],approvalPhrase:'REVIEW AUTOMATION APPROVED'})).status,403);
    const reviewed=await call(base,`/ops/automation-proposals/${created.body.id}/review`,reviewer,{decision:'approved',evidence:['evidence://review'],notes:'bounded target confirmed',approvalPhrase:'REVIEW AUTOMATION APPROVED'});
    assert.equal(reviewed.status,200);
    assert.equal(reviewed.body.proposal.status,'approved-not-executed');
    assert.equal(store.snapshot().audits.some(item=>item.action==='automation.review'),true);
  });

  it('requires a new proposal and fresh independent review before resume',async()=>{
    const{base}=await fixture();
    const recovery=await login(base,'recovery');
    const reviewer=await login(base,'reviewer');
    const pause=await call(base,'/ops/automation-proposals',recovery,{action:'pause',target:'indexer:ingestion',reason:'contain incident',evidence:['evidence://pause'],maxPauseSeconds:120,approvalPhrase:'PROPOSE PAUSE indexer:ingestion'});
    await call(base,`/ops/automation-proposals/${pause.body.id}/review`,reviewer,{decision:'approved',evidence:['evidence://pause-review'],approvalPhrase:'REVIEW AUTOMATION APPROVED'});

    assert.equal((await call(base,'/ops/automation-proposals',recovery,{action:'resume',target:'indexer:ingestion',reason:'service recovered',evidence:['evidence://recovery'],pauseProposalId:'unknown',approvalPhrase:'PROPOSE RESUME indexer:ingestion'})).status,409);
    const resume=await call(base,'/ops/automation-proposals',recovery,{action:'resume',target:'indexer:ingestion',reason:'service recovered',evidence:['evidence://recovery'],pauseProposalId:pause.body.id,approvalPhrase:'PROPOSE RESUME indexer:ingestion'});
    assert.equal(resume.status,201);
    assert.equal(resume.body.status,'pending_review');
    assert.equal(resume.body.action,'resume');
    assert.equal(resume.body.review,undefined);

    const reviewed=await call(base,`/ops/automation-proposals/${resume.body.id}/review`,reviewer,{decision:'approved',evidence:['evidence://fresh-review'],approvalPhrase:'REVIEW AUTOMATION APPROVED'});
    assert.equal(reviewed.status,200);
    assert.equal(reviewed.body.proposal.status,'approved-not-executed');
    assert.notEqual(reviewed.body.proposal.id,pause.body.id);
  });
});
