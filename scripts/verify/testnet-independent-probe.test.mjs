import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {context,probeEnvironment,runIndependent,sourceHashes} from './testnet-independent-probe.mjs';
import {ROUTES,curlArgs} from './testnet-transport-monitor.mjs';
import {sha256} from './testnet-transport-bundle.mjs';

function envFor(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-independent-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return {GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'JiahaoAlbus/YNX-Chain',
    RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',
    GITHUB_SHA:'a'.repeat(40),RUNNER_TEMP:dir,ARBITRARY_SECRET:'DO_NOT_EXPORT'};
}
function fixtureExec(bad=false,incomplete=false){
  return async(command,args,limits)=>{
    assert.equal(command,process.execPath);assert.equal(limits.timeout,240000);assert.equal(limits.maxBuffer,1048576);
    assert(args.includes('--direct'));assert(!args.includes('--host'));assert(!args.includes('--pin-origin'));
    assert.equal(args[args.indexOf('--rounds')+1],'2');assert.equal(args[args.indexOf('--interval-seconds')+1],'30');
    const dir=args[args.indexOf('--output-dir')+1];fs.mkdirSync(dir,{mode:0o700});
    const at=Date.now()-40000,runId='ynx-probe-00000000-0000-4000-8000-000000000001';
    const start={type:'start',runId,at:new Date(at).toISOString(),rounds:2,vantage:'github-hosted-linux',pathMode:'direct-dns',sourceSHA256:sourceHashes()};
    const probes=[1,2].flatMap(round=>ROUTES.map((r,i)=>({type:'probe',round,url:r.url,
      startedAt:new Date(at+round*1000).toISOString(),finishedAt:new Date(at+round*1000+100).toISOString(),ready:!(bad&&i===0),
      identity:{chainId:6423,nativeSymbol:'YNXT',height:100,build:{commit:'c'.repeat(40)}},
      clientError:'DO_NOT_EXPORT',headers:{authorization:'DO_NOT_EXPORT'},arbitrary:'DO_NOT_EXPORT',
      client:{time_namelookup:.01,time_connect:.02,time_appconnect:bad&&i===0?0:.03,time_starttransfer:.04,time_total:.05,
        http_code:bad&&i===0?0:200,exitcode:bad&&i===0?28:0,ssl_verify_result:0,proxy_used:0,local_ip:'DO_NOT_EXPORT'}})));
    if(incomplete)probes.pop();
    const summary={runId,finishedAt:new Date(at+32000).toISOString(),interrupted:false};
    const raw=[start,...probes,{type:'summary',...summary}].map(JSON.stringify).join('\n')+'\n';
    fs.writeFileSync(path.join(dir,'observations.jsonl'),raw);
    fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({...summary,observationsSHA256:sha256(raw)}));
    return {exitCode:bad?2:0,stdout:'DO_NOT_EXPORT',stderr:'DO_NOT_EXPORT'};
  };
}

test('dry default requires no CI context, writes nothing and performs no network',async()=>{
  assert.deepEqual(await runIndependent([],{}),{exitCode:0,receipt:{dryRun:true,networkRequests:0,filesWritten:0}});
});
test('CLI rejects arbitrary URLs, additional flags and repeated live',async()=>{
  for(const argv of [['--url','https://evil.invalid'],['--live','--host','x'],['--live','--live'],['--pin-origin'],['--live','--rounds','90']])await assert.rejects(runIndependent(argv,{}),/NO_CUSTOM_INPUTS/);
});
test('only manual expected-repo hosted Linux context is accepted',t=>{
  const env=envFor(t);assert.equal(context(env).runnerRegion,null);
  for(const [key,value] of Object.entries({GITHUB_ACTIONS:'false',GITHUB_EVENT_NAME:'push',GITHUB_REPOSITORY:'evil/repo',RUNNER_ENVIRONMENT:'self-hosted',RUNNER_OS:'Windows',GITHUB_RUN_ID:'1\nsecret',GITHUB_RUN_ATTEMPT:'0',GITHUB_SHA:'bad',RUNNER_TEMP:'/'}))assert.throws(()=>context({...env,[key]:value}));
  const link=path.join(env.RUNNER_TEMP,'link');fs.symlinkSync(env.RUNNER_TEMP,link);assert.throws(()=>context({...env,RUNNER_TEMP:link}));
});
test('probe children inherit no runtime tokens, proxy values or secret env',()=>{
  assert.deepEqual(probeEnvironment({PATH:'/usr/bin:/bin',GITHUB_TOKEN:'secret',ACTIONS_RUNTIME_TOKEN:'secret',HTTPS_PROXY:'secret',HOME:'/private/secret'}),{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
});
test('healthy fixture exports only two redacted files with hash and no global acceptance',async t=>{
  const env=envFor(t),result=await runIndependent(['--live'],env,{exec:fixtureExec()});assert.equal(result.exitCode,0);
  const dir=path.join(env.RUNNER_TEMP,'ynx-independent-shareable');assert.deepEqual(fs.readdirSync(dir).sort(),['diagnostic-bundle.json','receipt.json']);
  const raw=fs.readFileSync(path.join(dir,'diagnostic-bundle.json'),'utf8');assert.equal(result.receipt.bundleSHA256,sha256(raw));
  assert.equal(result.receipt.healthySamples,8);assert.equal(result.receipt.independentNetworkPathProven,false);assert.equal(result.receipt.continuousAvailabilityVerified,false);
  assert.equal(result.receipt.crossRunRecoveryEvaluated,false);assert.equal(result.receipt.notificationDelivered,false);
  for(const name of fs.readdirSync(dir)){const text=fs.readFileSync(path.join(dir,name),'utf8');assert(!text.includes('DO_NOT_EXPORT'));assert(!text.includes(env.RUNNER_TEMP));assert.equal(fs.statSync(path.join(dir,name)).mode&0o777,0o600);}
});
test('failed live-equivalent sample remains failed and preserves bundle',async t=>{
  const env=envFor(t),r=await runIndependent(['--live'],env,{exec:fixtureExec(true)});assert.equal(r.exitCode,2);assert.equal(r.receipt.level,'warning');assert.equal(r.receipt.healthySamples,6);assert(r.receipt.bundleSHA256);
});
test('incomplete evidence cannot produce a green check',async t=>{
  const r=await runIndependent(['--live'],envFor(t),{exec:fixtureExec(false,true)});assert.equal(r.exitCode,2);assert.equal(r.receipt.complete,false);assert.equal(r.receipt.level,'diagnostic-gap');
});
test('collector failures produce generic error receipt, not child logs or healthy evidence',async t=>{
  const env=envFor(t),r=await runIndependent(['--live'],env,{exec:async()=>{throw Error('DO_NOT_EXPORT');}});assert.equal(r.exitCode,3);assert.equal(r.receipt.bundleSHA256,null);assert(!JSON.stringify(r).includes('DO_NOT_EXPORT'));
  assert.deepEqual(fs.readdirSync(path.join(env.RUNNER_TEMP,'ynx-independent-shareable')),['receipt.json']);
});
test('existing output cannot be overwritten or silently uploaded as new evidence',async t=>{
  const env=envFor(t);await runIndependent(['--live'],env,{exec:fixtureExec()});let calls=0;
  await assert.rejects(runIndependent(['--live'],env,{exec:async()=>{calls++;}}));assert.equal(calls,0);
});
test('transport is exactly four HTTPS health routes, GET only with TLS and bounded size/time',()=>{
  assert.equal(ROUTES.length,4);assert.deepEqual(ROUTES.map(r=>r.url),['https://rpc.ynxweb4.com/status','https://rpc-testnet.ynxweb4.com/status','https://faucet.ynxweb4.com/health','https://faucet-testnet.ynxweb4.com/health']);
  for(const route of ROUTES){const args=curlArgs(route,'ynx-probe-test',null,{direct:true});
    for(const [key,value] of [['--request','GET'],['--proto','=https'],['--connect-timeout','5'],['--max-time','8'],['--max-filesize','1048576'],['--noproxy','*']])assert.equal(args[args.indexOf(key)+1],value);
    for(const flag of ['--insecure','--location','--retry','--data','--config'])assert(!args.includes(flag));assert.equal(args[0],'--disable');
  }
  assert.throws(()=>curlArgs({url:'https://evil.invalid'},'ynx-probe-test'));
});
test('workflow is manual-only, SHA-pinned, bounded, read-only and exact-file-upload',()=>{
  const y=fs.readFileSync(new URL('../../.github/workflows/testnet-independent-probe.yml',import.meta.url),'utf8');
  assert.match(y,/\non:\n  workflow_dispatch:\n\npermissions:/);assert.match(y,/permissions:\n  contents: read\n/);
  assert.match(y,/persist-credentials: false/);assert.match(y,/timeout-minutes: 10/);assert.match(y,/timeout-minutes: 5/);assert.match(y,/cancel-in-progress: false/);
  assert.equal([...y.matchAll(/uses: ([^\n]+)/g)].length,3);for(const m of y.matchAll(/uses: ([^\n]+)/g))assert.match(m[1],/^actions\/[a-z-]+@[a-f0-9]{40}(?: |$)/);
  for(const forbidden of ['schedule:','push:','pull_request:','workflow_call:','inputs:','secrets.','secrets:','environment:','continue-on-error:','sudo ','npm install','curl '])assert(!y.includes(forbidden));
  const upload=y.split('          path: |\n')[1].split('          if-no-files-found:')[0].trim().split('\n').map(x=>x.trim());
  assert.deepEqual(upload,['${{ runner.temp }}/ynx-independent-shareable/receipt.json','${{ runner.temp }}/ynx-independent-shareable/diagnostic-bundle.json']);
  assert.match(y,/retention-days: 7/);assert.match(y,/if: always\(\)/);assert.match(y,/include-hidden-files: false/);
  assert.equal(Object.keys(sourceHashes()).length,8);
});
test('CLI errors never echo rejected input and dry CLI is portable',()=>{
  const script=fileURLToPath(new URL('./testnet-independent-probe.mjs',import.meta.url));
  const bad=spawnSync(process.execPath,[script,'--url','DO_NOT_EXPORT'],{encoding:'utf8'});assert.equal(bad.status,3);assert(!bad.stderr.includes('DO_NOT_EXPORT'));assert.equal(bad.stdout,'');
  const dry=spawnSync(process.execPath,[script],{encoding:'utf8',cwd:os.tmpdir()});assert.equal(dry.status,0);assert.equal(JSON.parse(dry.stdout).networkRequests,0);
});
