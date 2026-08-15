// @vitest-environment node
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { filePublicStatusSource, signPublicStatusSource } from './public-status.js';
import { OpsStore } from './store.js';

const servers:Server[]=[];
const publicStatusIntegrityKey='p'.repeat(32);
const users=[{username:'viewer',role:'viewer' as const,passwordHash:hashPassword('viewer-pass')}];
after(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));});

function publicService(id:string,name:string,status:string,asOf:string,extra:Record<string,unknown>={}){
	return {id,name,status,asOf,checkedAt:asOf,sourceCommit:'a'.repeat(40),release:'testnet-release',startedAt:new Date(Date.parse(asOf)-60_000).toISOString(),dependencies:[],...extra};
}

function publicPayload(overrides:Record<string,unknown>={}){
  const asOf=new Date(Date.now()-1_000).toISOString();
  return {
	  schemaVersion:'ynx.monitor.public-status-source.v2',
    source:'ynx.status.publisher',
    version:'status-2026-07-28.1',
    asOf,
    status:'degraded',
    message:'Some public services are degraded.',
    services:[
	  publicService('rpc','YNX RPC','degraded',asOf,{message:'Elevated request latency.'}),
	  publicService('explorer','YNX Explorer','operational',asOf,{dependencies:[{id:'rpc',status:'degraded'}]}),
    ],
    incidents:[
      {id:'public-incident-1',title:'RPC latency',severity:'minor',status:'monitoring',message:'Mitigation is active and latency is improving.',startedAt:new Date(Date.now()-60_000).toISOString(),updatedAt:asOf,affectedServices:['rpc']},
    ],
    approval:{status:'approved',approvalId:'approval-1',approvedAt:new Date().toISOString(),approvedByRole:'incident_commander'},
    ...overrides,
  };
}

function publicSource(overrides:Record<string,unknown>={}){
  return signPublicStatusSource(publicPayload(overrides),publicStatusIntegrityKey);
}

async function fixture(extra:Parameters<typeof createApp>[0]={}){
  const dir=await mkdtemp(join(tmpdir(),'ynx-monitor-public-status-'));
  const store=new OpsStore(join(dir,'state.json'));
  await store.load();
  await store.createIncident(
    {username:'PRIVATE_OPERATOR_USERNAME',role:'incident_commander'},
    {title:'PRIVATE_INCIDENT_TITLE',source:'/srv/private/topology.json',severity:'critical',evidence:['PRIVATE_STACK_TRACE','PRIVATE_EVIDENCE_REFERENCE']},
  );
  await store.audit(
    {username:'PRIVATE_SECURITY_REVIEWER',role:'security_reviewer'},
    'PRIVATE_AUDIT_ACTION',
    'PRIVATE_TOPOLOGY_TARGET',
    'recorded',
    {path:'/etc/ynx/private.conf',stack:'PRIVATE_INTERNAL_STACK'},
  );
  await store.addBackupRecord(
    {username:'PRIVATE_RECOVERY_OPERATOR',role:'backup_recovery'},
    'PRIVATE_BACKUP_REFERENCE',
  );
  const app=await createApp({
    store,
    secret:'s'.repeat(32),
    users,
    allowedOrigins:['https://monitor.test'],
    rpcUrl:'http://127.0.0.1:1',
    explorerUrl:'http://127.0.0.1:1',
    indexerUrl:'http://127.0.0.1:1',
    aiUrl:'http://127.0.0.1:1',
    publicStatusSource:null,
    publicStatusMaxAgeSeconds:300,
    publicStatusIntegrityKey,
    publicStatusExpectedSource:'ynx.status.publisher',
    ...extra,
  });
  const server=app.listen(0,'127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function status(base:string){
  const response=await fetch(`${base}/status`);
  return {status:response.status,headers:response.headers,body:await response.json() as Record<string,unknown>};
}

function assertNoPrivateLeak(body:unknown){
  const text=JSON.stringify(body);
  for(const sentinel of [
    'PRIVATE_OPERATOR_USERNAME',
    'PRIVATE_INCIDENT_TITLE',
    '/srv/private/topology.json',
    'PRIVATE_STACK_TRACE',
    'PRIVATE_EVIDENCE_REFERENCE',
    'PRIVATE_SECURITY_REVIEWER',
    'PRIVATE_AUDIT_ACTION',
    'PRIVATE_TOPOLOGY_TARGET',
    '/etc/ynx/private.conf',
    'PRIVATE_INTERNAL_STACK',
    'PRIVATE_RECOVERY_OPERATOR',
    'PRIVATE_BACKUP_REFERENCE',
  ]) assert.equal(text.includes(sentinel),false,`public response leaked ${sentinel}`);
}

describe('YNX Monitor public status projection',()=>{
  it('fails closed when no approved public source is configured',async()=>{
    const response=await status(await fixture());
    assert.equal(response.status,503);
    assert.equal(response.body.error,'public_status_unavailable');
    assertNoPrivateLeak(response.body);
  });

  it('refuses startup when a public source lacks an independent integrity key',async()=>{
    await assert.rejects(
      ()=>fixture({publicStatusSource:async()=>publicSource(),publicStatusIntegrityKey:''}),
      /YNX_MONITOR_PUBLIC_STATUS_INTEGRITY_KEY/,
    );
  });

  it('refuses startup when the approved public publisher is not pinned',async()=>{
    await assert.rejects(
      ()=>fixture({publicStatusSource:async()=>publicSource(),publicStatusExpectedSource:''}),
      /YNX_MONITOR_PUBLIC_STATUS_EXPECTED_SOURCE/,
    );
  });

  it('serves only the signed, approved public projection without private OpsStore data',async()=>{
    const response=await status(await fixture({publicStatusSource:async()=>publicSource()}));
    assert.equal(response.status,200);
	assert.equal(response.body.schemaVersion,'ynx.monitor.public-status.v2');
    assert.equal(response.body.availability,'available');
    assert.equal(response.body.status,'degraded');
    assert.equal(Array.isArray(response.body.services),true);
    assert.equal(Array.isArray(response.body.incidents),true);
    const text=JSON.stringify(response.body);
    assert.equal(text.includes('approval-1'),false);
    assert.equal(text.includes('incident_commander'),false);
    assert.equal(text.includes('integrity'),false);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assertNoPrivateLeak(response.body);
  });

  it('rejects a signed snapshot from the wrong publisher',async()=>{
    const source=publicSource({source:'ynx.untrusted.publisher'});
    const response=await status(await fixture({publicStatusSource:async()=>source}));
    assert.equal(response.status,503);
    assert.equal(response.body.error,'public_status_source_mismatch');
    assertNoPrivateLeak(response.body);
  });

  it('rejects a valid snapshot modified after signing',async()=>{
    const tampered=publicSource() as Record<string,unknown>;
    tampered.message='Tampered public message.';
    const response=await status(await fixture({publicStatusSource:async()=>tampered}));
    assert.equal(response.status,503);
    assert.equal(response.body.error,'public_status_integrity_invalid');
    assert.equal(JSON.stringify(response.body).includes('Tampered public message.'),false);
    assertNoPrivateLeak(response.body);
  });

  it('rejects an unsigned source as an integrity failure',async()=>{
    const response=await status(await fixture({publicStatusSource:async()=>publicPayload()}));
    assert.equal(response.status,503);
    assert.equal(response.body.error,'public_status_integrity_invalid');
    assertNoPrivateLeak(response.body);
  });

  it('rejects an older signed snapshot after a newer snapshot was accepted',async()=>{
    const now=Date.now();
    const signedAt=(offset:number)=>new Date(now+offset).toISOString();
    const makeSnapshot=(asOfOffset:number,approvedOffset:number,version:string)=>publicSource({
      version,
      asOf:signedAt(asOfOffset),
	  services:[publicService('rpc','YNX RPC','degraded',signedAt(asOfOffset))],
      incidents:[],
      approval:{status:'approved',approvalId:`approval-${version}`,approvedAt:signedAt(approvedOffset),approvedByRole:'incident_commander'},
    });
    const older=makeSnapshot(-4_000,-3_000,'status-older');
    const newer=makeSnapshot(-2_000,-1_000,'status-newer');
    const sequence=[older,newer,older];
    const base=await fixture({publicStatusSource:async()=>sequence.shift()!});
    assert.equal((await status(base)).status,200);
    assert.equal((await status(base)).status,200);
    const replayed=await status(base);
    assert.equal(replayed.status,503);
    assert.equal(replayed.body.error,'public_status_replayed');
    assertNoPrivateLeak(replayed.body);
  });

	it('records bounded process-scoped failure and recovery trends from accepted signed snapshots',async()=>{
	  const now=Date.now(),at=(offset:number)=>new Date(now+offset).toISOString();
	  const degradedAt=at(-4_000),recoveredAt=at(-2_000);
	  const degraded=publicSource({version:'status-degraded',asOf:degradedAt,status:'degraded',services:[publicService('rpc','YNX RPC','degraded',degradedAt)],incidents:[],approval:{status:'approved',approvalId:'trend-degraded',approvedAt:at(-3_000),approvedByRole:'incident_commander'}});
	  const recovered=publicSource({version:'status-recovered',asOf:recoveredAt,status:'operational',services:[publicService('rpc','YNX RPC','operational',recoveredAt)],incidents:[],approval:{status:'approved',approvalId:'trend-recovered',approvedAt:at(-1_000),approvedByRole:'incident_commander'}});
	  const sequence=[degraded,recovered];
	  const base=await fixture({publicStatusSource:async()=>sequence.shift()!});
	  const first=await status(base),second=await status(base);
	  assert.equal(first.body.historyPersistence,'process-scoped');
	  assert.equal((first.body.history as Array<Record<string,unknown>>).length,1);
	  const history=second.body.history as Array<Record<string,unknown>>;
	  assert.equal(history.length,2);
	  assert.equal(history[0].transition,'initial');
	  assert.equal(history[1].transition,'recovery');
	});

  it('rejects unknown private fields instead of projecting or echoing them',async()=>{
    const payload=publicPayload();
    const incident={...(payload.incidents as Array<Record<string,unknown>>)[0],owner:'PRIVATE_PUBLIC_OWNER_LEAK'};
    const source=signPublicStatusSource({...payload,incidents:[incident]},publicStatusIntegrityKey);
    const response=await status(await fixture({publicStatusSource:async()=>source}));
    assert.equal(response.status,503);
    assert.equal(response.body.error,'public_status_invalid');
    assert.equal(JSON.stringify(response.body).includes('PRIVATE_PUBLIC_OWNER_LEAK'),false);
    assertNoPrivateLeak(response.body);
  });

  it('rejects fake healthy summaries and private content inside otherwise allowed fields',async()=>{
    const fakeHealthyResponse=await status(await fixture({publicStatusSource:async()=>publicSource({status:'operational'})}));
    assert.equal(fakeHealthyResponse.status,503);
    assert.equal(fakeHealthyResponse.body.error,'public_status_invalid');
    assertNoPrivateLeak(fakeHealthyResponse.body);

    const payload=publicPayload();
    const service={...(payload.services as Array<Record<string,unknown>>)[0],message:'Investigating /etc/ynx/private.conf after a PRIVATE_STACK_TRACE.'};
    const source=signPublicStatusSource({...payload,services:[service,(payload.services as Array<Record<string,unknown>>)[1]]},publicStatusIntegrityKey);
    const privateTextResponse=await status(await fixture({publicStatusSource:async()=>source}));
    assert.equal(privateTextResponse.status,503);
    assert.equal(privateTextResponse.body.error,'public_status_invalid');
    const body=JSON.stringify(privateTextResponse.body);
    assert.equal(body.includes('/etc/ynx/private.conf'),false);
    assert.equal(body.includes('PRIVATE_STACK_TRACE'),false);
    assertNoPrivateLeak(privateTextResponse.body);
  });

  it('rejects stale, unapproved, and wrong-role snapshots without exposing source content',async()=>{
    const staleAt=new Date(Date.now()-600_000).toISOString();
	const stale=publicSource({asOf:staleAt,services:[publicService('rpc','YNX RPC','unknown',staleAt)],incidents:[]});
    const staleResponse=await status(await fixture({publicStatusSource:async()=>stale,publicStatusMaxAgeSeconds:60}));
    assert.equal(staleResponse.status,503);
    assert.equal(staleResponse.body.error,'public_status_stale');
    assertNoPrivateLeak(staleResponse.body);

    const unapproved=publicSource({approval:{status:'pending',approvalId:'approval-pending',approvedAt:new Date().toISOString(),approvedByRole:'incident_commander'}});
    const unapprovedResponse=await status(await fixture({publicStatusSource:async()=>unapproved}));
    assert.equal(unapprovedResponse.status,503);
    assert.equal(unapprovedResponse.body.error,'public_status_not_approved');
    assert.equal(JSON.stringify(unapprovedResponse.body).includes('approval-pending'),false);
    assertNoPrivateLeak(unapprovedResponse.body);

    const wrongRole=publicSource({approval:{status:'approved',approvalId:'approval-wrong-role',approvedAt:new Date().toISOString(),approvedByRole:'viewer'}});
    const wrongRoleResponse=await status(await fixture({publicStatusSource:async()=>wrongRole}));
    assert.equal(wrongRoleResponse.status,503);
    assert.equal(wrongRoleResponse.body.error,'public_status_not_approved');
    assert.equal(JSON.stringify(wrongRoleResponse.body).includes('approval-wrong-role'),false);
    assertNoPrivateLeak(wrongRoleResponse.body);
  });

  it('does not expose provider errors, paths, or stack details',async()=>{
    const response=await status(await fixture({publicStatusSource:async()=>{throw new Error('PRIVATE_PROVIDER_ERROR /private/provider/path PRIVATE_PROVIDER_STACK');}}));
    assert.equal(response.status,503);
    assert.equal(response.body.error,'public_status_unavailable');
    const text=JSON.stringify(response.body);
    assert.equal(text.includes('PRIVATE_PROVIDER_ERROR'),false);
    assert.equal(text.includes('/private/provider/path'),false);
    assert.equal(text.includes('PRIVATE_PROVIDER_STACK'),false);
    assertNoPrivateLeak(response.body);
  });

  it('reads only bounded regular JSON files for the public source',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'ynx-monitor-public-file-'));
    const validPath=join(dir,'status.json');
    await writeFile(validPath,JSON.stringify(publicSource()));
    const validResponse=await status(await fixture({publicStatusSource:filePublicStatusSource(validPath)}));
    assert.equal(validResponse.status,200);

    const invalidPath=join(dir,'invalid.json');
    await writeFile(invalidPath,'{not-json');
    const invalidResponse=await status(await fixture({publicStatusSource:filePublicStatusSource(invalidPath)}));
    assert.equal(invalidResponse.status,503);
    assert.equal(invalidResponse.body.error,'public_status_invalid');

    const oversizedPath=join(dir,'oversized.json');
    await writeFile(oversizedPath,Buffer.alloc(262_145,0x20));
    const oversizedResponse=await status(await fixture({publicStatusSource:filePublicStatusSource(oversizedPath)}));
    assert.equal(oversizedResponse.status,503);
    assert.equal(oversizedResponse.body.error,'public_status_invalid');

    const symlinkPath=join(dir,'status-link.json');
    await symlink(validPath,symlinkPath);
    const symlinkResponse=await status(await fixture({publicStatusSource:filePublicStatusSource(symlinkPath)}));
    assert.equal(symlinkResponse.status,503);
    assert.equal(symlinkResponse.body.error,'public_status_unavailable');

    const directoryResponse=await status(await fixture({publicStatusSource:filePublicStatusSource(dir)}));
    assert.equal(directoryResponse.status,503);
    assert.equal(directoryResponse.body.error,'public_status_invalid');
    assertNoPrivateLeak(directoryResponse.body);
  });
});
