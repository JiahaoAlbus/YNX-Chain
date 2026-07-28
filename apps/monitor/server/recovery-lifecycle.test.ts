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
  const dir=await mkdtemp(join(tmpdir(),'ynx-monitor-recovery-'));
  const store=new OpsStore(join(dir,'state.json'));
  await store.load();
  const password='p'.repeat(16);
  const roles:Role[]=['backup_recovery','security_reviewer','operator'];
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
  return{base:`http://127.0.0.1:${address.port}`,password,store};
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

const backupInput={
  kind:'database',
  service:'ynx-monitor',
  artifactRef:'artifact://monitor/state-2026-07-27',
  digest:'a'.repeat(64),
  sizeBytes:4096,
  createdAt:'2026-07-27T12:00:00.000Z',
  retentionClass:'testnet-30d',
  retentionUntil:'2026-08-26T12:00:00.000Z',
  storageLocation:'vault://monitor/testnet/state-2026-07-27',
  encryption:'encrypted',
  rpoTargetSeconds:300,
  rtoTargetSeconds:900,
  evidence:['evidence://artifact-manifest','evidence://storage-inventory'],
};

const restoreInput=(backupId:string)=>({
  backupId,
  environment:'isolated-testnet-restore',
  startedAt:'2026-07-27T13:00:00.000Z',
  completedAt:'2026-07-27T13:08:00.000Z',
  reportedResult:'passed',
  rpoObservedSeconds:240,
  rtoObservedSeconds:480,
  integrityVerified:true,
  applicationVerified:true,
  evidence:['evidence://restore-log','evidence://integrity-check'],
});

describe('Monitor backup, restore, and rollback evidence lifecycle',()=>{
  it('requires independent verification and preserves typed evidence',async()=>{
    const{base,password,store}=await fixture();
    const recovery=await login(base,'backup_recovery',password);
    const security=await login(base,'security_reviewer',password);

    const created=await call(base,'/ops/backups',recovery,backupInput);
    assert.equal(created.status,201);
    assert.equal(created.body.status,'pending_verification');
    const backupId=created.body.id as string;

    const missingEvidence=await call(base,`/ops/backups/${backupId}/verify`,security,{
      result:'verified',digestMatch:true,accessible:true,notes:'No evidence supplied',evidence:[],
    });
    assert.equal(missingEvidence.status,400);
    assert.equal(missingEvidence.body.error,'backup_verification_evidence_required');

    const rejectedWithoutEvidence=await call(base,`/ops/backups/${backupId}/verify`,security,{
      result:'rejected',digestMatch:false,accessible:false,notes:'Rejection still requires evidence.',evidence:[],
    });
    assert.equal(rejectedWithoutEvidence.status,400);
    assert.equal(rejectedWithoutEvidence.body.error,'backup_verification_evidence_required');

    const verified=await call(base,`/ops/backups/${backupId}/verify`,security,{
      result:'verified',digestMatch:true,accessible:true,notes:'Digest and storage access independently confirmed.',evidence:['evidence://independent-backup-check'],
    });
    assert.equal(verified.status,200);
    assert.equal((verified.body.backup as Record<string,unknown>).status,'verified');
    assert.equal((verified.body.backup as Record<string,unknown>).registeredBy,'backup_recovery');
    assert.equal(((verified.body.backup as Record<string,unknown>).verification as Record<string,unknown>).verifiedBy,'security_reviewer');

    const retry=await call(base,`/ops/backups/${backupId}/verify`,security,{
      result:'verified',digestMatch:true,accessible:true,notes:'Idempotent retry',evidence:['evidence://independent-backup-check'],
    });
    assert.equal(retry.status,200);
    assert.equal(retry.body.changed,false);

    const reported=await call(base,'/ops/restore-drills',recovery,restoreInput(backupId));
    assert.equal(reported.status,201);
    assert.equal(reported.body.status,'pending_verification');
    const drillId=reported.body.id as string;

    const accepted=await call(base,`/ops/restore-drills/${drillId}/verify`,security,{
      result:'accepted',notes:'Restore integrity and application checks reproduced.',evidence:['evidence://restore-review'],
    });
    assert.equal(accepted.status,200);
    assert.equal((accepted.body.drill as Record<string,unknown>).status,'verified_passed');
    assert.equal(((accepted.body.drill as Record<string,unknown>).verification as Record<string,unknown>).verifiedBy,'security_reviewer');

    const state=store.snapshot();
    assert.equal(state.backupRecords.length,1);
    assert.equal(state.restoreDrills.length,1);
    assert.deepEqual(state.audits.slice(0,4).map(item=>item.action),['restore.verify','restore.report','backup.verify','backup.register']);
  });

  it('fails closed on malformed, unverified, self-verified, and incomplete evidence',async()=>{
    const{base,password}=await fixture();
    const recovery=await login(base,'backup_recovery',password);
    const security=await login(base,'security_reviewer',password);
    const operator=await login(base,'operator',password);

    const malformed=await call(base,'/ops/backups',recovery,{...backupInput,digest:'not-a-sha256'});
    assert.equal(malformed.status,400);
    assert.equal(malformed.body.error,'invalid_backup_record');

    const created=await call(base,'/ops/backups',recovery,backupInput);
    const backupId=created.body.id as string;
    const reported=await call(base,'/ops/restore-drills',recovery,restoreInput(backupId));
    const drillId=reported.body.id as string;

    const premature=await call(base,`/ops/restore-drills/${drillId}/verify`,security,{
      result:'accepted',notes:'Must not pass before backup verification.',evidence:['evidence://premature-review'],
    });
    assert.equal(premature.status,409);
    assert.equal(premature.body.error,'backup_not_verified');

    const rejectedRestoreWithoutEvidence=await call(base,`/ops/restore-drills/${drillId}/verify`,security,{
      result:'rejected',notes:'Rejection still requires evidence.',evidence:[],
    });
    assert.equal(rejectedRestoreWithoutEvidence.status,400);
    assert.equal(rejectedRestoreWithoutEvidence.body.error,'restore_verification_evidence_required');

    const forbidden=await call(base,`/ops/backups/${backupId}/verify`,recovery,{
      result:'verified',digestMatch:true,accessible:true,notes:'Role is not allowed to self-certify.',evidence:['evidence://self'],
    });
    assert.equal(forbidden.status,403);

    const selfCreated=await call(base,'/ops/backups',operator,{...backupInput,artifactRef:'artifact://monitor/operator-self-check'});
    const selfVerify=await call(base,`/ops/backups/${selfCreated.body.id as string}/verify`,operator,{
      result:'verified',digestMatch:true,accessible:true,notes:'Same actor',evidence:['evidence://same-actor'],
    });
    assert.equal(selfVerify.status,409);
    assert.equal(selfVerify.body.error,'independent_backup_verifier_required');

    const rollback=await call(base,'/ops/rollback-proposals',recovery,{
      candidateRelease:'monitor-candidate-2',
      previousRelease:'monitor-candidate-1',
      reason:'Rollback drill after failed candidate health gate.',
      dryRunEvidence:['evidence://rollback-dry-run'],
      approvalPhrase:'APPROVE ROLLBACK PROPOSAL',
    });
    assert.equal(rollback.status,201);
    assert.equal(rollback.body.status,'approved-not-executed');

    const incompleteReview=await call(base,`/ops/rollback-proposals/${rollback.body.id as string}/verify`,security,{
      result:'verified',notes:'Missing independent evidence',evidence:[],
    });
    assert.equal(incompleteReview.status,400);
    assert.equal(incompleteReview.body.error,'rollback_verification_evidence_required');

    const rejectedRollbackWithoutEvidence=await call(base,`/ops/rollback-proposals/${rollback.body.id as string}/verify`,security,{
      result:'rejected',notes:'Rejection still requires evidence.',evidence:[],
    });
    assert.equal(rejectedRollbackWithoutEvidence.status,400);
    assert.equal(rejectedRollbackWithoutEvidence.body.error,'rollback_verification_evidence_required');

    const rollbackReview=await call(base,`/ops/rollback-proposals/${rollback.body.id as string}/verify`,security,{
      result:'verified',notes:'Candidate and previous release identities match dry-run evidence.',evidence:['evidence://rollback-review'],
    });
    assert.equal(rollbackReview.status,200);
    assert.equal((rollbackReview.body.proposal as Record<string,unknown>).status,'verified-not-executed');
    assert.equal((rollbackReview.body.proposal as Record<string,unknown>).executionBoundary,'central infrastructure owner');

    const unknownBackup=await call(base,'/ops/restore-drills',recovery,restoreInput('backup_missing'));
    assert.equal(unknownBackup.status,404);
    assert.equal(unknownBackup.body.error,'backup_not_found');
  });
});
