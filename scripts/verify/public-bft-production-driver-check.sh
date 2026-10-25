#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

[[ "$#" == 0 || ( "$#" == 1 && "$1" == --snapshot-only ) ]] || { echo 'usage: public-bft-production-driver-check.sh [--snapshot-only]' >&2; exit 1; }
# Real helper/caller controls with isolated public files and an offline tool
# double. These exercise orchestration, not a claim of real ledger validity.
# The normal Go exporter has its own persisted-checkpoint regression suite.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),repo=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-readonly-export-'));
const helper=process.env.PUBLIC_BFT_SNAPSHOT_HELPER || path.join(repo,'scripts/ops/remote/public-bft-final-snapshot.sh');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const write=(p,x,mode=0o600)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof x==='string'?x:JSON.stringify(x)+'\n',{flag:'wx',mode});};
const full='abcdef012345'+'a'.repeat(28),commit=full.slice(0,12),release='ynx-bft-gateway-'+commit;
const blockHash='a'.repeat(64),stateHash='b'.repeat(64),q=x=>"'"+x.replaceAll("'","'\\''")+"'";
let nativeStatus=null;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({height:100,latestBlockHash:blockHash,...(nativeStatus?{build:nativeStatus}:{})}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
function fixture(name){
  const root=path.join(tmp,name),tx='snapshot-control-'+name,tools=path.join(root,'tools'),evidence=path.join(root,'evidence');
  fs.mkdirSync(evidence,{recursive:true});
  const state=path.join(root,'original/devnet-state.json'),integrity=path.join(root,'original/devnet-state.integrity-version');
  const pause=path.join(root,'pause.json'),freeze=path.join(root,'freeze.json');
  write(state,'original synthetic checkpoint bytes\n');write(integrity,'2\n');
  const marker={transactionId:tx,commit,bftRelease:release};write(pause,marker);write(freeze,marker);
  write(path.join(evidence,'primary-pause-authoritative.json'),{...marker,productionStateVerified:true});
  // This old environment is deliberately executable. The fixed caller must
  // never source it, even if an exporter later fails.
  write(path.join(root,'etc/ynx/ynx-chaind.env'),'printf drift > '+q(path.join(root,'env-was-sourced'))+'\n');
  const snapshot=JSON.stringify({version:2,height:100,lastBlockHash:blockHash,stateHash})+'\n';
  write(path.join(tools,'ynx-chaind'),`#!/bin/bash
set -euo pipefail
[[ "$#" == 4 && "$1" == --data-dir && "$2" == ${q(path.dirname(state))} && "$3" == --export-consensus-state ]]
[[ -z "\${YNX_DATA_DIR:-}" && -z "\${YNX_LOCAL_VALIDATOR:-}" ]]
set -C
printf '%s' ${q(snapshot)} > "$4"
if [[ -f ${q(path.join(root,'export-fail'))} ]]; then echo 'fixture first cause 73' >&2; exit 73; fi
if [[ -f ${q(path.join(root,'mutate-after'))} ]]; then printf changed >> ${q(state)}; fi
printf 'fixture exporter completed\n'
`,0o700);
  write(path.join(tools,'ynx-consensus-package'),`#!/bin/bash
set -euo pipefail
[[ "$#" == 2 && "$1" == -verify-migration-state && -s "$2" ]]
printf 'consensus migration state passed: height=100 lastBlockHash=${blockHash} stateHash=${stateHash} accounts=1 validators=4\n'
`,0o700);
  const binaries={};for(const n of ['ynx-chaind','ynx-consensus-package']){const b=fs.readFileSync(path.join(tools,n));binaries[n]={bytes:b.length,sha256:hash(b)};}
  write(path.join(tools,'SOURCE.json'),{binaries,commit:full,platform:'linux/amd64',purpose:'offline copied-state validation; not installed or activated',runId:'123',version:'YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1'});
  const source={version:'YNX-PUBLIC-BFT-SNAPSHOT-SOURCE/v1',transactionId:tx,commit,authoritativeRelease:'ynx-chain-'+commit,bftRelease:release,
    statePath:state,stateBytes:String(fs.statSync(state).size),stateSHA256:hash(fs.readFileSync(state)),
    integrityMarkerPath:integrity,integrityMarkerBytes:'2',integrityMarkerSHA256:hash(fs.readFileSync(integrity)),
    pauseMarkerPath:pause,pauseMarkerSHA256:hash(fs.readFileSync(pause)),mutationMarkerPath:freeze,mutationMarkerSHA256:hash(fs.readFileSync(freeze)),height:'100',blockHash};
  const input=path.join(root,'source.json');write(input,source);
  const args=[tx,commit,'ynx-chain-'+commit,release,pause,freeze,evidence,url,root,tools,'1',input,hash(fs.readFileSync(input)),hash(fs.readFileSync(path.join(tools,'SOURCE.json'))),full];
  return {root,tx,tools,evidence,state,integrity,pause,freeze,input,source,args};
}
async function invoke(f){
  try{return {...await execute('bash',[helper,...f.args],{env:{...process.env,YNX_DATA_DIR:'/unapproved/old/env',YNX_LOCAL_VALIDATOR:'unapproved-override'},maxBuffer:1<<20,timeout:15000}),code:0};}
  catch(e){return {code:e.code,stdout:e.stdout||'',stderr:e.stderr||''};}
}
const unchanged=(files,before)=>files.forEach((p,i)=>assert.deepEqual(fs.readFileSync(p),before[i],`original changed: ${p}`));
function independent(f){
  const authoritativeCommit='65efa82e06158f9616172144c3c9efdd8088f227',authoritativeRelease='ynx-network-surgical-'+authoritativeCommit.slice(0,12),authoritativeBinarySha256='e'.repeat(64);
  const marker={transactionId:f.tx,commit,bftRelease:release,authoritativeCommit,authoritativeRelease};
  fs.writeFileSync(f.pause,JSON.stringify(marker)+'\n');fs.writeFileSync(f.freeze,JSON.stringify(marker)+'\n');
  fs.writeFileSync(path.join(f.evidence,'primary-pause-authoritative.json'),JSON.stringify({...marker,productionStateVerified:true})+'\n');
  const source={...f.source,authoritativeRelease,authoritativeCommit,authoritativeBinarySha256,pauseMarkerSHA256:hash(fs.readFileSync(f.pause)),mutationMarkerSHA256:hash(fs.readFileSync(f.freeze))};
  fs.writeFileSync(f.input,JSON.stringify(source)+'\n');f.args[2]=authoritativeRelease;f.args[12]=hash(fs.readFileSync(f.input));
  const paths={statePath:f.state,integrityMarkerPath:f.integrity,pauseMarkerPath:f.pause,mutationMarkerPath:f.freeze};
  f.args.push(authoritativeCommit,authoritativeBinarySha256,JSON.stringify(paths));
  return {authoritativeCommit,authoritativeRelease,authoritativeBinarySha256,authoritativeSource:paths};
}
try{
  // With the old real helper this exact retained partial is removed by its
  // EXIT trap (and its old service environment is sourced). Keep this first:
  // CI can run this selector against the fixed old source and require RED.
  const partial=fixture('retained-partial'),p=path.join(partial.evidence,'final-migration-state.json.partial-'+partial.tx);
  write(p,'UNKNOWN previous exporter output\n');const saved=fs.readFileSync(p);
  const refused=await invoke(partial);assert.notEqual(refused.code,0,'existing partial unexpectedly accepted');
  assert.ok(fs.existsSync(p),'PUBLIC_BFT_FINAL_SNAPSHOT_PARTIAL_ERASED');
  assert.deepEqual(fs.readFileSync(p),saved,'PUBLIC_BFT_FINAL_SNAPSHOT_PARTIAL_ERASED');
  assert.equal(fs.existsSync(path.join(partial.root,'env-was-sourced')),false,'PUBLIC_BFT_FINAL_SNAPSHOT_SERVICE_ENV_EXECUTED');
  const good=fixture('positive'),files=[good.state,good.integrity,good.pause,good.freeze,good.input],before=files.map(p=>fs.readFileSync(p));
  const prepared=path.join(good.root,'prepared');
  await execute('bash',[helper,'--prepare',good.input,good.tools,full,good.args[12],good.args[13],good.tx,commit,'ynx-chain-'+commit,release,prepared]);
  for(const name of ['SOURCE.json','ynx-chaind','ynx-consensus-package'])assert.deepEqual(fs.readFileSync(path.join(prepared,'tools',name)),fs.readFileSync(path.join(good.tools,name)));
  await assert.rejects(execute('bash',[helper,'--prepare',good.input,good.tools,full,good.args[12],good.args[13],good.tx,commit,'ynx-chain-'+commit,release,prepared]));
  good.args[9]=path.join(prepared,'tools');good.args[11]=path.join(prepared,'snapshot-source.json');
  const passed=await invoke(good);assert.equal(passed.code,0,passed.stderr);assert.match(passed.stdout,/validated=true/);assert.match(passed.stdout,/sourceUnchanged=true/);
  unchanged(files,before);assert.equal(fs.existsSync(path.join(good.root,'env-was-sourced')),false);
  const output=path.join(good.evidence,'final-migration-state.json'),meta=path.join(good.evidence,'final-migration-state.evidence.json');
  const outputs=[output,meta],outputBytes=outputs.map(p=>fs.readFileSync(p));
  assert.notEqual((await invoke(good)).code,0,'completed export must not redispatch');unchanged(outputs,outputBytes);
  fs.appendFileSync(output,'tampered prior output');const tampered=fs.readFileSync(output);
  assert.notEqual((await invoke(good)).code,0,'checksum-mismatched prior export accepted');assert.deepEqual(fs.readFileSync(output),tampered,'tampered UNKNOWN was overwritten');
  for(const kind of ['snapshotSourcePin','exporterPin','toolHash','sourceHash','missingState','missingIntegrity','wrongIntegrity','missingPause','wrongFreeze','wrongMarkerPath','oldInstalledBinary','unexpectedTools','sourceSymlink','sourceUnknownField','sourceDuplicateField','checkpointDrift']){
    const f=fixture(kind);
    if(kind==='snapshotSourcePin')f.args[12]='c'.repeat(64);
    if(kind==='exporterPin')f.args[13]='c'.repeat(64);
    if(kind==='toolHash')fs.appendFileSync(path.join(f.tools,'ynx-chaind'),'# changed\n');
    if(kind==='sourceHash')fs.appendFileSync(f.state,'changed');
    if(kind==='missingState')fs.renameSync(f.state,f.state+'.preserved');
    if(kind==='missingIntegrity')fs.renameSync(f.integrity,f.integrity+'.preserved');
    if(kind==='wrongIntegrity')fs.writeFileSync(f.integrity,'3\n');
    if(kind==='missingPause')fs.renameSync(f.pause,f.pause+'.preserved');
    if(kind==='wrongFreeze')fs.writeFileSync(f.freeze,'{}\n');
    if(kind==='wrongMarkerPath')f.args[4]=f.freeze;
    if(kind==='oldInstalledBinary')f.args[9]=path.join(f.tools,'ynx-chaind');
    if(kind==='unexpectedTools')write(path.join(f.tools,'old.env'),'must be preserved');
    if(kind==='sourceSymlink'){fs.renameSync(f.state,f.state+'.preserved');fs.symlinkSync(f.state+'.preserved',f.state);}
    if(kind==='sourceUnknownField'||kind==='checkpointDrift'){
      const s={...f.source};if(kind==='sourceUnknownField')s.validatorOverride='fake';else s.height='101';
      fs.writeFileSync(f.input,JSON.stringify(s)+'\n');f.args[12]=hash(fs.readFileSync(f.input));
    }
    if(kind==='sourceDuplicateField'){fs.writeFileSync(f.input,JSON.stringify(f.source).slice(0,-1)+',"height":"100"}\n');f.args[12]=hash(fs.readFileSync(f.input));}
    const result=await invoke(f);assert.notEqual(result.code,0,`accepted ${kind}`);
    assert.equal(fs.existsSync(path.join(f.evidence,'snapshot-attempt')),false,`invalid ${kind} reached exporter`);
    assert.equal(fs.existsSync(path.join(f.root,'env-was-sourced')),false);
    assert.equal(fs.existsSync(path.join(f.evidence,'final-migration-state.json')),false);
  }
  for(const name of ['final-migration-state.json','final-migration-state.evidence.json','snapshot-attempt','final-migration-state.json.tmp','final-migration-state.json.UNKNOWN','final-migration-state.evidence.json.partial']){
    const f=fixture('exists-'+name.replaceAll('.','-')),file=path.join(f.evidence,name);write(file,'ORIGINAL UNKNOWN\n');
    assert.notEqual((await invoke(f)).code,0,`accepted old ${name}`);assert.equal(fs.readFileSync(file,'utf8'),'ORIGINAL UNKNOWN\n');
  }
  const failed=fixture('export-failure');write(path.join(failed.root,'export-fail'),'yes');
  const error=await invoke(failed);assert.notEqual(error.code,0);assert.match(error.stderr,/73/);
  assert.ok(fs.existsSync(path.join(failed.evidence,'final-migration-state.json')),'uncertain exporter output erased');
  assert.match(fs.readFileSync(path.join(failed.evidence,'snapshot-attempt/export.stderr'),'utf8'),/fixture first cause 73/);
  assert.equal(fs.existsSync(path.join(failed.evidence,'final-migration-state.evidence.json')),false);
  assert.notEqual((await invoke(failed)).code,0,'UNKNOWN must not redispatch');
  const mutated=fixture('source-changed-during-export');write(path.join(mutated.root,'mutate-after'),'yes');
  assert.notEqual((await invoke(mutated)).code,0);assert.ok(fs.existsSync(path.join(mutated.evidence,'final-migration-state.json')));
  assert.equal(fs.existsSync(path.join(mutated.evidence,'final-migration-state.evidence.json')),false);
  const native=fixture('independent-native'),identity=independent(native);
  nativeStatus={commit:identity.authoritativeCommit.slice(0,12),release:identity.authoritativeRelease};
  const nativeFiles=[native.state,native.integrity,native.pause,native.freeze,native.input],nativeBytes=nativeFiles.map(p=>fs.readFileSync(p));
  const nativePrepared=path.join(native.root,'prepared');
  await execute('bash',[helper,'--prepare',native.input,native.tools,full,native.args[12],native.args[13],native.tx,commit,identity.authoritativeRelease,release,nativePrepared,...native.args.slice(15)]);
  const nativeResult=await invoke(native);assert.equal(nativeResult.code,0,nativeResult.stderr);unchanged(nativeFiles,nativeBytes);
  const nativeEvidence=JSON.parse(fs.readFileSync(path.join(native.evidence,'final-migration-state.evidence.json')));
  for(const key of Object.keys(identity))assert.deepEqual(nativeEvidence[key],identity[key]);assert.equal(nativeEvidence.commit,commit);assert.equal(nativeEvidence.exporterCommit,full);
  for(const name of ['missing-pin','wrong-full','wrong-path','wrong-status']){
    const f=fixture('independent-'+name),n=independent(f);nativeStatus={commit:n.authoritativeCommit.slice(0,12),release:n.authoritativeRelease};
    if(name==='missing-pin')f.args.pop();
    if(name==='wrong-full')f.args[15]='f'.repeat(40);
    if(name==='wrong-path')f.args[17]=JSON.stringify({...n.authoritativeSource,statePath:path.join(f.root,'different/devnet-state.json')});
    if(name==='wrong-status')nativeStatus={commit,release:'ynx-chain-'+commit};
    const originals=[f.state,f.integrity,f.pause,f.freeze,f.input],saved=originals.map(p=>fs.readFileSync(p));
    assert.notEqual((await invoke(f)).code,0,`independent native accepted ${name}`);unchanged(originals,saved);
    assert.equal(fs.existsSync(path.join(f.evidence,'snapshot-attempt')),false,'wrong original native reached exporter');
  }
  nativeStatus=null;
  // Exercise the actual production phase with only its external SSH transport
  // stubbed. The normal approval reader and offline preparation remain real.
  const body=fs.readFileSync(path.join(repo,'scripts/ops/public-bft-production-driver.sh'),'utf8').match(/^final_snapshot_phase\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(body,'normal final snapshot caller missing');
  async function caller(name,change){
    const f=fixture('caller-'+name),dir=path.join(f.root,f.tx),log=path.join(f.root,'transport.log');
    const approval={schemaVersion:1,action:'ynx-public-bft-cutover',approved:true,approvalId:'fixture-approval',approver:'approver',custodyReviewer:'custodian',custodyEvidence:'sha256:'+'1'.repeat(64),owner:'source owner',ownerHandoverReviewer:'handover reviewer',ownerHandoverInventoryDigest:'sha256:'+'2'.repeat(64),ownerHandoverInventoryEvidence:'sha256:'+'3'.repeat(64),ownerHandoverReceiptEvidence:'sha256:'+'4'.repeat(64),commit,release,publicCutoverAuthorized:true,automaticRollbackRequired:true,validatorKeyRecoveryVerified:true,serviceSignerRecoveryVerified:true,ownerHandoverVerified:true,rotationProcedureVerified:true,serviceSignerManifestSha256:'5'.repeat(64),validatorManifestSha256:'6'.repeat(64),operatorPlanSha256:'7'.repeat(64),runtimeManifestSha256:'8'.repeat(64),snapshotSourceSha256:f.args[12],exporterManifestSha256:f.args[13],candidateGenesisTime:'2026-10-18T00:00:00Z',expiresAt:'2026-10-19T00:00:00Z'};
    if(change)change(approval);
    write(path.join(dir,'approval.json'),approval);
    write(path.join(dir,'roles/primary-pause-authoritative.txt'),`transactionId=${f.tx}\ncommit=${commit}\nbftRelease=${release}\nproductionStateVerified=true\n`);
    const script=path.join(f.root,'caller.sh');
    write(script,`#!/bin/bash\nset -Eeuo pipefail\ncd ${q(repo)}\ngit(){ printf '%s\\n' ${q(full)}; }\nynx_ops_ssh(){ printf '%s\\n' "$*" >> ${q(log)}; printf 'DRY RUN %s\\n' "$*"; }\ncommit=${q(commit)}\nrelease=${q('ynx-chain-'+commit)}\n${body}\nfinal_snapshot_phase\n`,0o700);
    const env={...process.env,DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_SNAPSHOT_APPROVED:'yes',PUBLIC_BFT_CUTOVER_COMMIT:commit,PUBLIC_BFT_CUTOVER_RELEASE:release,PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:dir,PUBLIC_BFT_PRODUCTION_SNAPSHOT_SOURCE:f.input,PUBLIC_BFT_PRODUCTION_EXPORTER_BUNDLE:f.tools,PUBLIC_BFT_PRODUCTION_SNAPSHOT_OBSERVATION_SECONDS:'1',PRIMARY_NODE_USER:'test',PRIMARY_NODE_HOST:'not-a-real-host',PRIMARY_NODE_SSH_KEY:'/unused/test-key'};
    return {f,dir,log,script,env};
  }
  const c=await caller('approved');await execute('bash',[c.script],{env:c.env});
  const transport=fs.readFileSync(c.log,'utf8');
  assert.ok(fs.existsSync(path.join(c.dir,'final-snapshot/dry-run.txt')));
  assert.match(transport,/snapshot-source\.json/);assert.match(transport,/tools\/ynx-chaind/);
  assert.equal(transport.includes('/usr/local/bin/ynx-chaind'),false,'installed exporter drift');
  assert.equal(transport.includes('rm -f'),false,'remote cleanup would erase UNKNOWN');
  assert.equal(transport.includes('source '),false,'service env must not be loaded');
  await assert.rejects(execute('bash',[c.script],{env:c.env}));assert.equal(fs.readFileSync(c.log,'utf8'),transport,'existing attempt redispatched transport');
  const noGrant=await caller('missing-explicit-approval');
  await assert.rejects(execute('bash',[noGrant.script],{env:{...noGrant.env,PUBLIC_BFT_PRODUCTION_SNAPSHOT_APPROVED:'no'}}));
  assert.equal(fs.existsSync(noGrant.log),false,'missing explicit approval reached transport');
  for(const field of ['snapshotSourceSha256','exporterManifestSha256']){
    for(const missing of [true,false]){
      const c=await caller(field+(missing?'missing':'wrong'),a=>{if(missing)delete a[field];else a[field]='9'.repeat(64);});
      await assert.rejects(execute('bash',[c.script],{env:c.env}));assert.equal(fs.existsSync(c.log),false,'approval mismatch reached transport');
    }
  }
  console.log('PUBLIC_BFT_FINAL_SNAPSHOT_READONLY_PASS: independent inputs, original bytes, no service env, exclusive output and UNKNOWN preserved');
  // New asset preparation remains an explicit normal caller. These controls
  // stub only transport; no real host, Python helper or production state runs.
  const driverSource=fs.readFileSync(path.join(repo,'scripts/ops/public-bft-production-driver.sh'),'utf8');
  const assetsBody=driverSource.match(/^prepare_testnet_assets_phase\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(assetsBody,'normal testnet asset caller missing');
  assert.match(driverSource,/if \[\[ "\$action" == prepare_testnet_assets \]\]; then/);
  assert.match(driverSource,/if \[\[ "\$testnet_assets_action" == true \]\]; then\n  prepare_testnet_assets_phase\n  exit 0/);
  const automatic=fs.readFileSync(path.join(repo,'scripts/ops/public-bft-cutover-transaction.sh'),'utf8').match(/^forward_phases=\(\n([\s\S]*?)^\)/m)?.[1];
  assert.ok(automatic,'normal cutover sequence missing');
  assert.equal(automatic.includes('prepare_testnet_assets'),false,'asset reset was added to automatic cutover');
  async function assetsCaller(name,phase='extract-public-identity'){
    const root=path.join(tmp,'asset-caller-'+name),tx='asset-control-'+name,dir=path.join(root,tx),log=path.join(root,'transport.log'),script=path.join(root,'caller.sh');
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    write(script,`#!/bin/bash\nset -Eeuo pipefail\ncd ${q(repo)}\nynx_ops_ssh(){ printf 'ATTEMPTS=%s SSH %s\\n' "$YNX_DEPLOY_CONNECTION_ATTEMPTS" "$*" >> ${q(log)}; [[ "\${ASSET_CONTROL_FAIL_TRANSPORT:-}" != ssh ]] || return 255; printf 'transport-stub-data-only\\n'; }\nynx_ops_copy(){ printf 'ATTEMPTS=%s COPY %s\\n' "$YNX_DEPLOY_CONNECTION_ATTEMPTS" "$*" >> ${q(log)}; [[ "\${ASSET_CONTROL_FAIL_TRANSPORT:-}" != copy ]] || return 255; }\ncommit=${q(commit)}\n${assetsBody}\nprepare_testnet_assets_phase\n`,0o700);
    const remote='/var/backups/ynx-chain/public-bft-cutover/'+tx;
    const env={...process.env,YNX_DEPLOY_CONNECTION_ATTEMPTS:'5',PRIMARY_NODE_HOST:'43.153.202.237',PRIMARY_NODE_USER:'ubuntu',PRIMARY_NODE_SSH_KEY:'/unused/test-only-key',PUBLIC_BFT_TESTNET_ASSET_PREPARATION_APPROVED:'yes',PUBLIC_BFT_TESTNET_ASSET_PHASE:phase,PUBLIC_BFT_CUTOVER_COMMIT:commit,PUBLIC_BFT_CUTOVER_RELEASE:release,PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:dir,BACKUP_STORAGE_PATH:'/var/backups/ynx-chain',PUBLIC_BFT_TESTNET_ASSET_SNAPSHOT_SOURCE:remote+'/capture/snapshot-source.json',PUBLIC_BFT_TESTNET_ASSET_SNAPSHOT_SOURCE_SHA256:'1'.repeat(64),PUBLIC_BFT_TESTNET_ASSET_PRIMARY_FREEZE_SHA256:'2'.repeat(64),PUBLIC_BFT_TESTNET_ASSET_PRIMARY_PAUSE_SHA256:'3'.repeat(64)};
    delete env.PUBLIC_BFT_TESTNET_ASSET_PUBLIC_IDENTITY_SHA256;delete env.PUBLIC_BFT_TESTNET_ASSET_ORIGINAL_PID;delete env.ASSET_CONTROL_FAIL_TRANSPORT;
    if(phase==='archive-original-assets'){env.PUBLIC_BFT_TESTNET_ASSET_PUBLIC_IDENTITY_SHA256='4'.repeat(64);env.PUBLIC_BFT_TESTNET_ASSET_ORIGINAL_PID='123456789';}
    return {dir,log,script,env,remote,phase};
  }
  for(const phase of ['extract-public-identity','archive-original-assets']){
    const a=await assetsCaller('allowed-'+phase,phase);await execute('bash',[a.script],{env:a.env});
    const transport=fs.readFileSync(a.log,'utf8'),lines=transport.trimEnd().split('\n');
    assert.equal(lines.length,4,'caller ran an extra phase or repeated transport');
    assert.ok(lines.every(line=>line.startsWith('ATTEMPTS=1 ')),'inherited transport retries were not disabled');
    assert.match(transport,new RegExp('--phase '+phase));assert.ok(transport.includes('--snapshot-source '+a.remote+'/capture/snapshot-source.json'));
    assert.ok(transport.includes('--primary-freeze '+a.remote+'/primary-freeze.json'));
    assert.ok(transport.includes('--primary-pause '+a.remote+'/primary-pause-authoritative.json'));
    assert.ok(transport.includes('--output-dir '+a.remote+'/testnet-assets-'+phase));
    assert.equal(transport.includes('rm -'),false,'caller would erase partial/UNKNOWN');
    assert.equal(transport.includes('systemctl '),false,'caller performed implicit service stop/start');
    if(phase==='archive-original-assets'){
      assert.ok(transport.includes('--public-identity '+a.remote+'/testnet-assets-extract-public-identity/public-identity.json'));
      assert.ok(transport.includes('--original-pid 123456789'));
    }else{assert.equal(transport.includes('--public-identity '),false);assert.equal(transport.includes('--original-pid '),false);}
    await assert.rejects(execute('bash',[a.script],{env:a.env}));
    assert.equal(fs.readFileSync(a.log,'utf8'),transport,'existing phase intent redispatched an UNKNOWN');
  }
  for(const [field,bad] of [['PUBLIC_BFT_TESTNET_ASSET_PREPARATION_APPROVED','no'],['PUBLIC_BFT_TESTNET_ASSET_PHASE',''],['PUBLIC_BFT_TESTNET_ASSET_PHASE','extract-public-identity,archive-original-assets'],['PRIMARY_NODE_HOST','not-a-real-host'],['PRIMARY_NODE_USER','root'],['PUBLIC_BFT_CUTOVER_COMMIT','0'.repeat(12)],['PUBLIC_BFT_CUTOVER_RELEASE','ynx-bft-gateway-'+'0'.repeat(12)],['PUBLIC_BFT_TESTNET_ASSET_SNAPSHOT_SOURCE','/outside/snapshot-source.json'],['PUBLIC_BFT_TESTNET_ASSET_PUBLIC_IDENTITY_SHA256','4'.repeat(64)]]){
    const a=await assetsCaller('refuse-'+field+'-'+hash(bad).slice(0,6));
    await assert.rejects(execute('bash',[a.script],{env:{...a.env,[field]:bad}}));
    assert.equal(fs.existsSync(a.log),false,'invalid asset caller input reached transport: '+field);
  }
  for(const field of ['PUBLIC_BFT_TESTNET_ASSET_SNAPSHOT_SOURCE_SHA256','PUBLIC_BFT_TESTNET_ASSET_PRIMARY_FREEZE_SHA256','PUBLIC_BFT_TESTNET_ASSET_PRIMARY_PAUSE_SHA256']){
    for(const bad of ['', '0'.repeat(64),'A'.repeat(64)]){
      const a=await assetsCaller('refuse-pin-'+field+'-'+hash(bad).slice(0,6));
      await assert.rejects(execute('bash',[a.script],{env:{...a.env,[field]:bad}}));
      assert.equal(fs.existsSync(a.log),false,'missing/noncanonical pin reached transport');
    }
  }
  for(const field of ['PUBLIC_BFT_TESTNET_ASSET_PUBLIC_IDENTITY_SHA256','PUBLIC_BFT_TESTNET_ASSET_ORIGINAL_PID']){
    const a=await assetsCaller('refuse-archive-'+field,'archive-original-assets');
    await assert.rejects(execute('bash',[a.script],{env:{...a.env,[field]:''}}));
    assert.equal(fs.existsSync(a.log),false,'archive without original identity/stop PID reached transport');
  }
  for(const fail of ['ssh','copy']){
    const a=await assetsCaller('unknown-'+fail);
    await assert.rejects(execute('bash',[a.script],{env:{...a.env,ASSET_CONTROL_FAIL_TRANSPORT:fail}}));
    const original=fs.readFileSync(a.log,'utf8');
    assert.equal(original.trimEnd().split('\n').length,fail==='ssh'?1:2,'transport255 was automatically retried');
    assert.ok(fs.existsSync(path.join(a.dir,'testnet-assets-'+a.phase,'intent.txt')),'UNKNOWN intent was removed');
    await assert.rejects(execute('bash',[a.script],{env:a.env}));
    assert.equal(fs.readFileSync(a.log,'utf8'),original,'UNKNOWN was restarted after observation');
  }
  console.log('PUBLIC_BFT_TESTNET_ASSET_CALLER_PASS: explicit phase, independent inputs, one transport attempt, no implicit service action and UNKNOWN preserved');
  // The original capture producer has independent Python controls. Here only
  // its real normal caller is exercised with explicit PUBLIC transport data;
  // no process/state observation or protected authority is simulated as real.
  const captureBody=driverSource.match(/^capture_snapshot_source_phase\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(captureBody,'normal snapshot-source capture caller missing');
  const rootCapture=captureBody.match(/<<'CAPTURE_ROOT'\n([\s\S]*?)\nCAPTURE_ROOT/)?.[1];
  assert.ok(rootCapture,'bounded original root staging body missing');
  assert.ok(rootCapture.indexOf('chown root:root -- "$stage"')<rootCapture.indexOf('cp -P -- "$stage/$name" "$verified/$name"'),'transport namespace must be locked before independent root copies');
  assert.ok(rootCapture.indexOf('cp -P -- "$stage/$name" "$verified/$name"')<rootCapture.indexOf('sha256sum "$verified/public-bft-capture-snapshot-source.py"'),'root-owned copies must be pinned after copy');
  assert.match(rootCapture,/mkdir -m 0700 -- "\$verified"/);assert.match(rootCapture,/chmod 0600 -- "\$verified\/\$name"/);
  assert.ok(rootCapture.includes('exec /usr/bin/python3 -B "$verified/public-bft-capture-snapshot-source.py"'));
  assert.equal(captureBody.includes('/usr/bin/python3 -B "$remote_stage/public-bft-capture-snapshot-source.py"'),false,'mutable transport source must never execute as root');
  assert.match(driverSource,/case "\$action" in preflight\|backup\|freeze_mutations\|pause_authoritative\|capture_snapshot_source\|prepare_testnet_assets/);
  assert.match(driverSource,/if \[\[ "\$action" == capture_snapshot_source \]\]; then\n  capture_snapshot_source_phase\n  exit 0/);
  assert.equal(automatic.includes('capture_snapshot_source'),false,'capture was inserted into automatic cutover');
  async function captureCaller(name){
    const root=path.join(tmp,'capture-caller-'+name),tx='capture-control-'+name,dir=path.join(root,tx),log=path.join(root,'transport.log'),script=path.join(root,'caller.sh');
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const preparation=path.join(dir,'preparation-approval.json');write(preparation,{purpose:'PUBLIC CALLER CONTROL DATA; NOT AUTHORITY'});
    const remote='/var/backups/ynx-chain/public-bft-cutover/'+tx,source={version:'YNX-PUBLIC-BFT-SNAPSHOT-SOURCE/v1',transactionId:tx,commit,bftRelease:release,purpose:'SYNTHETIC PUBLIC FINGERPRINT ONLY'};
    const raw=JSON.stringify(source)+'\n',sourceFile=path.join(root,'source.json'),receiptFile=path.join(root,'receipt.json');write(sourceFile,raw);
    write(receiptFile,{version:'YNX-PUBLIC-BFT-SNAPSHOT-SOURCE-CAPTURE/v1',transactionId:tx,commit,snapshotSourcePath:remote+'/snapshot-source-capture/snapshot-source.json',snapshotSourceSHA256:hash(raw),snapshotSourceBytes:Buffer.byteLength(raw),preparationApprovalSHA256:hash(fs.readFileSync(preparation)),primaryFreezeEvidenceSHA256:'2'.repeat(64),primaryPauseEvidenceSHA256:'3'.repeat(64),nativeIdentityToolSHA256:hash(fs.readFileSync(path.join(repo,'scripts/ops/remote/public-bft-native-identity.py'))),readOnly:true,exported:false,finalApproval:false,nativeRootAuthorized:false});
    write(script,`#!/bin/bash\nset -Eeuo pipefail\ncd ${q(repo)}\nynx_ops_ssh(){ printf 'ATTEMPTS=%s SSH %s\\n' "$YNX_DEPLOY_CONNECTION_ATTEMPTS" "$*" >> ${q(log)}; [[ "\${CAPTURE_CONTROL_FAIL:-}" != ssh ]] || return 255; case "$*" in *'head -c 16385'*) cat ${q(sourceFile)}; [[ "\${CAPTURE_CONTROL_FAIL:-}" != readback ]] || return 255 ;; *'--preparation-approval-sha256'*) cat ${q(receiptFile)}; [[ "\${CAPTURE_CONTROL_FAIL:-}" != callee ]] || return 255 ;; *) printf 'reserve-public-data-only\\n' ;; esac; }\nynx_ops_copy(){ printf 'ATTEMPTS=%s COPY %s\\n' "$YNX_DEPLOY_CONNECTION_ATTEMPTS" "$*" >> ${q(log)}; [[ "\${CAPTURE_CONTROL_FAIL:-}" != copy ]] || return 255; }\ncommit=${q(commit)}\nnative_approval_path="\${CAPTURE_CONTROL_PREPARATION_PATH:-${preparation}}"\nnative_full_commit=${q(full)}\n${captureBody}\ncapture_snapshot_source_phase\n`,0o700);
    const env={...process.env,DEPLOY_DRY_RUN:'0',YNX_DEPLOY_CONNECTION_ATTEMPTS:'5',PRIMARY_NODE_HOST:'43.153.202.237',PRIMARY_NODE_USER:'ubuntu',PRIMARY_NODE_SSH_KEY:'/unused/control-only-key',PUBLIC_BFT_PRODUCTION_SOURCE_CAPTURE_APPROVED:'yes',PUBLIC_BFT_CUTOVER_COMMIT:commit,PUBLIC_BFT_CUTOVER_RELEASE:release,PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:dir,BACKUP_STORAGE_PATH:'/var/backups/ynx-chain',PUBLIC_BFT_PRODUCTION_PRIMARY_FREEZE_SHA256:'2'.repeat(64),PUBLIC_BFT_PRODUCTION_PRIMARY_PAUSE_SHA256:'3'.repeat(64),PUBLIC_BFT_PRODUCTION_SOURCE_CAPTURE_OBSERVATION_SECONDS:'4'};
    delete env.CAPTURE_CONTROL_FAIL;delete env.CAPTURE_CONTROL_PREPARATION_PATH;
    return {dir,log,script,env,remote,root,sourceFile,receiptFile};
  }
  const captured=await captureCaller('allowed');await execute('bash',[captured.script],{env:captured.env});
  const captureLog=fs.readFileSync(captured.log,'utf8'),captureLines=captureLog.trimEnd().split('\n');
  assert.equal(captureLines.length,6);assert.ok(captureLines.every(row=>row.startsWith('ATTEMPTS=1 ')));
  for(const text of ['public-bft-capture-snapshot-source.py','public-bft-native-identity.py','--preparation-approval-sha256 ','--primary-evidence-dir '+captured.remote,'--primary-freeze-sha256 '+'2'.repeat(64),'--primary-pause-sha256 '+'3'.repeat(64),'--output-dir '+captured.remote+'/snapshot-source-capture','timeout --signal=TERM --kill-after=1 25','head -c 16385 --'])assert.ok(captureLog.includes(text),'normal capture argv missing '+text);
  for(const text of ['rm -','systemctl ','export-consensus-state','initialize-application','priv_validator_key','priv_validator_state'])assert.equal(captureLog.includes(text),false,'capture expanded to '+text);
  assert.deepEqual(fs.readFileSync(path.join(captured.dir,'snapshot-source-capture/snapshot-source.json')),fs.readFileSync(captured.sourceFile));
  assert.equal(JSON.parse(fs.readFileSync(path.join(captured.dir,'snapshot-source-capture/receipt.json'))).finalApproval,false);
  for(const name of fs.readdirSync(path.join(captured.dir,'snapshot-source-capture')))assert.equal(/UNKNOWN|\.partial|\.tmp(?:$|[-.])/.test(name),false,'completed capture would block original continue-native scan');
  await assert.rejects(execute('bash',[captured.script],{env:captured.env}));assert.equal(fs.readFileSync(captured.log,'utf8'),captureLog,'capture replayed original attempt');
  for(const [field,bad]of [['PUBLIC_BFT_PRODUCTION_SOURCE_CAPTURE_APPROVED','no'],['PRIMARY_NODE_HOST','other-host'],['PRIMARY_NODE_USER','root'],['PUBLIC_BFT_CUTOVER_COMMIT','0'.repeat(12)],['PUBLIC_BFT_CUTOVER_RELEASE','other-release'],['CAPTURE_CONTROL_PREPARATION_PATH','/outside/preparation-approval.json'],['PUBLIC_BFT_PRODUCTION_SOURCE_CAPTURE_OBSERVATION_SECONDS','0'],['PUBLIC_BFT_PRODUCTION_SOURCE_CAPTURE_OBSERVATION_SECONDS','16']]){
    const c=await captureCaller('refuse-'+field+'-'+hash(bad).slice(0,6));await assert.rejects(execute('bash',[c.script],{env:{...c.env,[field]:bad}}));assert.equal(fs.existsSync(c.log),false,'invalid capture input reached transport: '+field);
  }
  for(const field of ['PUBLIC_BFT_PRODUCTION_PRIMARY_FREEZE_SHA256','PUBLIC_BFT_PRODUCTION_PRIMARY_PAUSE_SHA256'])for(const bad of ['', '0'.repeat(64),'A'.repeat(64)]){
    const c=await captureCaller('refuse-'+field+'-'+hash(bad).slice(0,6));await assert.rejects(execute('bash',[c.script],{env:{...c.env,[field]:bad}}));assert.equal(fs.existsSync(c.log),false,'capture accepted missing/noncanonical evidence pin');
  }
  for(const failure of ['ssh','copy','callee','readback']){
    const c=await captureCaller('unknown-'+failure);await assert.rejects(execute('bash',[c.script],{env:{...c.env,CAPTURE_CONTROL_FAIL:failure}}));
    const original=fs.readFileSync(c.log,'utf8');assert.equal(original.trimEnd().split('\n').length,{ssh:1,copy:2,callee:5,readback:6}[failure],'capture retried uncertain transport');
    const attempt=path.join(c.dir,'snapshot-source-capture');assert.ok(fs.existsSync(path.join(attempt,'intent.txt')));assert.equal(fs.existsSync(path.join(attempt,'receipt.json')),false);assert.equal(fs.existsSync(path.join(attempt,'snapshot-source.json')),false);
    if(failure==='callee'||failure==='readback')assert.ok(fs.statSync(path.join(attempt,'receipt.json.partial')).size>0,'lost-ACK public partial removed');
    await assert.rejects(execute('bash',[c.script],{env:c.env}));assert.equal(fs.readFileSync(c.log,'utf8'),original,'capture UNKNOWN was redispatched');
  }
  const mismatch=await captureCaller('readback-drift');fs.appendFileSync(mismatch.sourceFile,' ');
  await assert.rejects(execute('bash',[mismatch.script],{env:mismatch.env}));assert.equal(fs.existsSync(path.join(mismatch.dir,'snapshot-source-capture/receipt.json')),false,'mismatched public fingerprint was published');
  console.log('PUBLIC_BFT_SOURCE_CAPTURE_CALLER_PASS: original producer/sibling and protected evidence pins; portable operator, bounded public readback, explicit phase and UNKNOWN retained');
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(tmp,{recursive:true,force:true});}
NODE
[[ "${1:-}" != --snapshot-only ]] || exit 0

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
mkdir -p "$repo/scripts/ops/remote" "$repo/scripts/deploy" "$repo/scripts/verify"
cp scripts/ops/public-bft-production-driver.sh scripts/ops/lib.sh "$repo/scripts/ops/"
cp scripts/ops/remote/public-bft-scoped-backup.sh "$repo/scripts/ops/remote/"
cp scripts/ops/remote/public-bft-mutation-freeze.sh "$repo/scripts/ops/remote/"
cp scripts/ops/remote/public-bft-authoritative-pause.sh "$repo/scripts/ops/remote/"
cp scripts/ops/remote/public-bft-final-snapshot.sh "$repo/scripts/ops/remote/"
cp scripts/deploy/lib.sh scripts/deploy/deploy-consensus-candidate.sh "$repo/scripts/deploy/"
git -C "$repo" init -q -b main
git -C "$repo" add scripts
git -C "$repo" -c user.name='YNX self test' -c user.email='self-test@localhost' commit -q -m 'production driver fixture'
commit="$(git -C "$repo" rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
transaction="$tmp/cutover-${commit}-fixture"
mkdir -p "$transaction"

cat >"$tmp/deploy.env" <<EOF
PRIMARY_NODE_HOST=primary.test
PRIMARY_NODE_USER=ubuntu
PRIMARY_NODE_SSH_KEY=$tmp/primary.pem
SG_NODE_HOST=singapore.test
SG_NODE_USER=root
SG_NODE_SSH_KEY=$tmp/singapore.pem
SILICON_VALLEY_NODE_HOST=silicon-valley.test
SILICON_VALLEY_NODE_USER=ubuntu
SILICON_VALLEY_NODE_SSH_KEY=$tmp/silicon-valley.pem
SEOUL_NODE_HOST=seoul.test
SEOUL_NODE_USER=root
SEOUL_NODE_SSH_KEY=$tmp/seoul.pem
BACKUP_STORAGE_PATH=/var/backups/ynx-chain
EOF

run_backup() {
  (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
    PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes \
    PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
    PUBLIC_BFT_CUTOVER_RELEASE="$release" \
    PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
    bash scripts/ops/public-bft-production-driver.sh backup)
}

run_backup >/dev/null
for role in primary singapore silicon-valley seoul; do
  evidence="$transaction/roles/${role}-backup.txt"
  test -s "$evidence"
  grep -Fq "DRY RUN [$role]" "$evidence"
  grep -Fq "/public-bft-cutover/$(basename "$transaction")" "$evidence"
  grep -Fq "$role" "$evidence"
done
grep -Fq true "$transaction/roles/primary-backup.txt"
grep -Fq false "$transaction/roles/singapore-backup.txt"
grep -Fq '.tar.gz.partial' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
grep -Fq 'tar -tzf' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
grep -Fq 'sha256sum' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
grep -Fq '"validated":true' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
if grep -Eq '/(home/ubuntu|root)/\.ynx-v2|ynx-ops-observer|ynx-v2-' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"; then
  echo "scoped backup helper includes unrelated legacy state" >&2
  exit 1
fi

source_root="$tmp/source-root"
backup_root="$tmp/remote-backup/$(basename "$transaction")"
mkdir -p "$source_root/etc/ynx" "$source_root/etc/systemd/system" \
  "$source_root/etc/caddy" "$source_root/var/lib/ynx-chain/testnet" \
  "$source_root/var/lib/ynx-chain/indexer"
printf 'fixture=true\n' >"$source_root/etc/ynx/ynx-chaind.env"
printf '[Unit]\nDescription=fixture\n' >"$source_root/etc/systemd/system/ynx-chaind.service"
printf 'chain-state\n' >"$source_root/var/lib/ynx-chain/testnet/state.json"
printf 'index-state\n' >"$source_root/var/lib/ynx-chain/indexer/index.json"
printf 'fixture ingress\n' >"$source_root/etc/caddy/ynx-chain.caddy"

helper="$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
first="$($helper "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$backup_root" true "$source_root")"
grep -Fq 'validated=true' <<<"$first"
grep -Fq 'reused=false' <<<"$first"
test -s "$backup_root/primary.tar.gz"
test -s "$backup_root/primary.json"
grep -Fq '"validated":true' "$backup_root/primary.json"
tar -tzf "$backup_root/primary.tar.gz" | grep -Fxq 'var/lib/ynx-chain/indexer/index.json'
if tar -tzf "$backup_root/primary.tar.gz" | grep -Eq '(^|/)\.ynx-v2(/|$)|ynx-ops-observer'; then
  echo "functional scoped archive contains unrelated legacy state" >&2
  exit 1
fi
second="$($helper "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$backup_root" true "$source_root")"
grep -Fq 'reused=true' <<<"$second"
cp "$backup_root/primary.json" "$backup_root/primary.json.valid"
printf '{"transactionId":"wrong"}\n' >"$backup_root/primary.json"
if "$helper" "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$backup_root" true "$source_root" >/dev/null 2>&1; then
  echo "tampered backup evidence unexpectedly passed" >&2
  exit 1
fi
mv "$backup_root/primary.json.valid" "$backup_root/primary.json"

for role in primary singapore silicon-valley seoul; do
  cat >"$transaction/roles/${role}-backup.txt" <<EOF
transactionId=$(basename "$transaction")
role=$role
commit=$commit
bftRelease=$release
validated=true
EOF
done

run_freeze_dry_run() {
  local phase="$1" approval="${2:-yes}"
  (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
    PUBLIC_BFT_PRODUCTION_FREEZE_APPROVED="$approval" \
    PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
    PUBLIC_BFT_CUTOVER_RELEASE="$release" \
    PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
    bash scripts/ops/public-bft-production-driver.sh "$phase")
}

run_freeze_dry_run freeze_mutations >/dev/null
run_freeze_dry_run unfreeze_mutations >/dev/null
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$transaction/roles/${role}-freeze.txt"
  grep -Fq mutation-freeze.json "$transaction/roles/${role}-freeze.txt"
  grep -Fq freeze "$transaction/roles/${role}-freeze.txt"
  grep -Fq unfreeze "$transaction/roles/${role}-unfreeze.txt"
done
grep -Fq '127.0.0.1:6432' "$transaction/roles/primary-freeze.txt"
if grep -Fq '127.0.0.1:6432' "$transaction/roles/singapore-freeze.txt"; then
  echo "validator-only freeze probe unexpectedly includes primary services" >&2
  exit 1
fi
if run_freeze_dry_run freeze_mutations no >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly passed without explicit approval" >&2
  exit 1
fi
rm "$transaction/roles/seoul-backup.txt"
if run_freeze_dry_run freeze_mutations yes >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly passed without four-role backup evidence" >&2
  exit 1
fi
run_freeze_dry_run verify_recovery >/dev/null
test -s "$transaction/recovery/dry-run.txt"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$transaction/recovery/roles/${role}-before-status.json"
done

run_authoritative_dry_run() {
  local phase="$1" approval="${2:-yes}"
  (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
    PUBLIC_BFT_PRODUCTION_PAUSE_APPROVED="$approval" \
    PUBLIC_BFT_PRODUCTION_PAUSE_OBSERVATION_SECONDS=1 \
    PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
    PUBLIC_BFT_CUTOVER_RELEASE="$release" \
    PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
    bash scripts/ops/public-bft-production-driver.sh "$phase")
}

for role in primary singapore silicon-valley seoul; do
  cat >"$transaction/roles/${role}-freeze.txt" <<EOF
transactionId=$(basename "$transaction")
role=$role
commit=$commit
bftRelease=$release
mutationStateVerified=true
EOF
done
run_authoritative_dry_run pause_authoritative >/dev/null
run_authoritative_dry_run resume_authoritative >/dev/null
grep -Fq 'block-production-pause.json' "$transaction/roles/primary-pause-authoritative.txt"
grep -Fq "$commit" "$transaction/roles/primary-pause-authoritative.txt"
grep -Fq "pause" "$transaction/roles/primary-pause-authoritative.txt"
grep -Fq "resume" "$transaction/roles/primary-resume-authoritative.txt"
if run_authoritative_dry_run pause_authoritative no >/dev/null 2>&1; then
  echo "authoritative production pause unexpectedly passed without explicit approval" >&2
  exit 1
fi
rm "$transaction/roles/seoul-freeze.txt"
if run_authoritative_dry_run pause_authoritative yes >/dev/null 2>&1; then
  echo "authoritative production pause unexpectedly passed without four-role freeze evidence" >&2
  exit 1
fi
cat >"$transaction/roles/primary-pause-authoritative.txt" <<EOF
transactionId=$(basename "$transaction")
commit=$commit
bftRelease=$release
productionStateVerified=true
EOF
# Snapshot approval, exact caller argv and exclusion/replay controls execute
# above through the real final_snapshot_phase, without the old installed tool.

marker="$tmp/mutation-freeze.json"
block_pause_marker="$tmp/block-production-pause.json"
freeze_evidence="$tmp/freeze-evidence"
freeze_config="$tmp/freeze-config"
port_file="$tmp/probe-port"
mkdir -p "$freeze_evidence" "$freeze_config/etc/ynx" "$freeze_config/etc/systemd/system" "$tmp/freeze-archive/etc/ynx"
printf 'YNX_MUTATION_FREEZE_FILE=%s\n' "$marker" >"$freeze_config/etc/ynx/ynx-chaind.env"
for service_name in ynx-chaind ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
  printf '[Service]\nEnvironmentFile=/etc/ynx/ynx-chaind.env\n' >"$freeze_config/etc/systemd/system/${service_name}.service"
done
printf 'fixture\n' >"$tmp/freeze-archive/etc/ynx/config"
tar -C "$tmp/freeze-archive" -czf "$freeze_evidence/primary.tar.gz" etc/ynx
freeze_backup_sha="$(sha256sum "$freeze_evidence/primary.tar.gz" | awk '{print $1}')"
printf '{"transactionId":"%s","role":"primary","commit":"%s","bftRelease":"%s","sha256":"%s","validated":true}\n' \
  "$(basename "$transaction")" "$commit" "$release" "$freeze_backup_sha" >"$freeze_evidence/primary.json"
cat >"$tmp/probe-server.mjs" <<'EOF'
import fs from "node:fs";
import http from "node:http";
const [marker, pauseMarker, portFile] = process.argv.slice(2);
let height = 100;
const latestBlockHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
setInterval(() => {
  if (!fs.existsSync(pauseMarker)) height += 1;
}, 100).unref();
const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/status") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ status: "ok", height, latestBlockHash }));
  }
  if (request.method === "POST" && request.url === "/evm") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end('{"jsonrpc":"2.0","id":1,"result":"0x1917"}');
  }
  if (request.method === "POST" && fs.existsSync(marker)) {
    response.writeHead(503, { "content-type": "application/json" });
    return response.end('{"status":"mutation_frozen"}');
  }
  response.writeHead(404);
  response.end();
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
EOF
node "$tmp/probe-server.mjs" "$marker" "$block_pause_marker" "$port_file" &
probe_pid=$!
trap 'kill "${probe_pid:-}" 2>/dev/null || true; rm -rf "$tmp"' EXIT
for _ in {1..50}; do
  [[ -s "$port_file" ]] && break
  sleep 0.05
done
test -s "$port_file"
probe_url="http://127.0.0.1:$(cat "$port_file")"
freeze_helper="$repo/scripts/ops/remote/public-bft-mutation-freeze.sh"
cp "$freeze_evidence/primary.tar.gz" "$freeze_evidence/primary.tar.gz.valid"
printf 'tamper' >>"$freeze_evidence/primary.tar.gz"
if "$freeze_helper" freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config" >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly accepted a checksum-mismatched backup" >&2
  exit 1
fi
mv "$freeze_evidence/primary.tar.gz.valid" "$freeze_evidence/primary.tar.gz"
printf 'YNX_MUTATION_FREEZE_FILE=/wrong/marker\n' >"$freeze_config/etc/ynx/ynx-chaind.env"
if "$freeze_helper" freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config" >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly accepted a service with the wrong marker path" >&2
  exit 1
fi
printf 'YNX_MUTATION_FREEZE_FILE=%s\n' "$marker" >"$freeze_config/etc/ynx/ynx-chaind.env"
freeze_first="$($freeze_helper freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'mutationStateVerified=true' <<<"$freeze_first"
grep -Fq 'reused=false' <<<"$freeze_first"
test -s "$marker"
test -s "$freeze_evidence/primary-freeze.json"
freeze_second="$($freeze_helper freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'reused=true' <<<"$freeze_second"
printf 'YNX_BLOCK_PRODUCTION_PAUSE_FILE=%s\n' "$block_pause_marker" >>"$freeze_config/etc/ynx/ynx-chaind.env"
pause_helper="$repo/scripts/ops/remote/public-bft-authoritative-pause.sh"
pause_first="$($pause_helper pause "$(basename "$transaction")" "$commit" "ynx-chain-${commit}" "$release" "$block_pause_marker" "$marker" "$freeze_evidence" "$probe_url" "$freeze_config" 1)"
grep -Fq 'productionStateVerified=true' <<<"$pause_first"
grep -Fq 'reused=false' <<<"$pause_first"
test -s "$block_pause_marker"
test -s "$freeze_evidence/primary-pause-authoritative.json"
pause_second="$($pause_helper pause "$(basename "$transaction")" "$commit" "ynx-chain-${commit}" "$release" "$block_pause_marker" "$marker" "$freeze_evidence" "$probe_url" "$freeze_config" 1)"
grep -Fq 'reused=true' <<<"$pause_second"
# Final snapshot no longer reuses or overwrites a prior output. The controls at
# the top retain the original checksum/approval assertions and additionally
# preserve all files after a rejected duplicate or a failed exporter.
cp "$block_pause_marker" "$block_pause_marker.valid"
printf '{"transactionId":"another-transaction","commit":"%s","bftRelease":"%s"}\n' "$commit" "$release" >"$block_pause_marker"
if "$pause_helper" resume "$(basename "$transaction")" "$commit" "ynx-chain-${commit}" "$release" "$block_pause_marker" "$marker" "$freeze_evidence" "$probe_url" "$freeze_config" 1 >/dev/null 2>&1; then
  echo "authoritative resume unexpectedly removed another transaction's marker" >&2
  exit 1
fi
mv "$block_pause_marker.valid" "$block_pause_marker"
resume_first="$($pause_helper resume "$(basename "$transaction")" "$commit" "ynx-chain-${commit}" "$release" "$block_pause_marker" "$marker" "$freeze_evidence" "$probe_url" "$freeze_config" 1)"
grep -Fq 'productionStateVerified=true' <<<"$resume_first"
test ! -e "$block_pause_marker"
resume_second="$($pause_helper resume "$(basename "$transaction")" "$commit" "ynx-chain-${commit}" "$release" "$block_pause_marker" "$marker" "$freeze_evidence" "$probe_url" "$freeze_config" 1)"
grep -Fq 'reused=true' <<<"$resume_second"
cp "$marker" "$marker.valid"
printf '{"transactionId":"another-transaction","commit":"%s","bftRelease":"%s"}\n' "$commit" "$release" >"$marker"
if "$freeze_helper" unfreeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config" >/dev/null 2>&1; then
  echo "unfreeze unexpectedly removed another transaction's marker" >&2
  exit 1
fi
mv "$marker.valid" "$marker"
unfreeze_first="$($freeze_helper unfreeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'mutationStateVerified=true' <<<"$unfreeze_first"
test ! -e "$marker"
unfreeze_second="$($freeze_helper unfreeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'reused=true' <<<"$unfreeze_second"
kill "$probe_pid"
wait "$probe_pid" 2>/dev/null || true
probe_pid=""

if (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
  PUBLIC_BFT_CUTOVER_COMMIT="$commit" PUBLIC_BFT_CUTOVER_RELEASE="$release" \
  PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
  bash scripts/ops/public-bft-production-driver.sh backup) >/dev/null 2>&1; then
  echo "backup unexpectedly passed without explicit approval" >&2
  exit 1
fi
if (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
  PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes PUBLIC_BFT_CUTOVER_COMMIT=000000000000 \
  PUBLIC_BFT_CUTOVER_RELEASE="$release" PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
  bash scripts/ops/public-bft-production-driver.sh backup) >/dev/null 2>&1; then
  echo "backup unexpectedly passed with a mismatched commit" >&2
  exit 1
fi
if (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
  PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
  PUBLIC_BFT_CUTOVER_RELEASE=ynx-bft-gateway-000000000000 PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
  bash scripts/ops/public-bft-production-driver.sh backup) >/dev/null 2>&1; then
  echo "backup unexpectedly passed with a mismatched BFT release" >&2
  exit 1
fi

echo "public-bft-production-driver-check passed: original backup/freeze/pause controls retained; final snapshot uses approved readonly tools, rejects replay and preserves partial/UNKNOWN"
