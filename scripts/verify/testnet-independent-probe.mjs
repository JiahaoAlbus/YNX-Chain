// Manual GitHub-hosted one-shot entrypoint. No user endpoints, secrets or SSH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseJobArgs,runJob} from './testnet-transport-job.mjs';
import {writeBundle,readRegular,sha256} from './testnet-transport-bundle.mjs';

export function context(env) {
  assert(env.GITHUB_ACTIONS==='true' && env.GITHUB_EVENT_NAME==='workflow_dispatch', 'MANUAL_ACTIONS_ONLY');
  assert(env.GITHUB_REPOSITORY==='JiahaoAlbus/YNX-Chain', 'WRONG_REPOSITORY');
  assert(env.RUNNER_ENVIRONMENT==='github-hosted' && env.RUNNER_OS==='Linux', 'HOSTED_LINUX_ONLY');
  for(const key of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT']) assert(/^[1-9][0-9]{0,19}$/.test(env[key]??''),'INVALID_RUN_ID');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''),'INVALID_SOURCE_SHA');
  assert(path.isAbsolute(env.RUNNER_TEMP??'') && path.resolve(env.RUNNER_TEMP)!=='/', 'INVALID_TEMP');
  assert(!/[\r\n\0]/.test(env.RUNNER_TEMP),'INVALID_TEMP');
  const stat=fs.lstatSync(env.RUNNER_TEMP);
  assert(stat.isDirectory()&&!stat.isSymbolicLink(),'INVALID_TEMP');
  return {runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,sourceCommit:env.GITHUB_SHA,
    runURL:`https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    runnerClass:'github-hosted-linux',runnerRegion:null};
}

// Platform runtime tokens/proxy values are not inherited by the probe subprocess.
export const probeEnvironment = env => ({PATH:env.PATH??'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
export function isolatedCommand(command,args,{timeout,maxBuffer}) {
  return new Promise(resolve=>{
    const child=execFile(command,args,{timeout,maxBuffer,encoding:'utf8',env:probeEnvironment(process.env)},(error,stdout,stderr)=>resolve({
      exitCode:error?(Number.isInteger(error.code)?error.code:1):0,killed:!!error?.killed,stdout,stderr}));
    child.stdin?.on('error',()=>{});child.stdin?.end();
  });
}

export function sourceHashes() {
  return Object.fromEntries(['testnet-independent-probe.mjs','testnet-transport-job.mjs','testnet-transport-bundle.mjs',
    'testnet-transport-monitor.mjs','testnet-alias-preflight.mjs','testnet-transport-client-path.mjs',
    'testnet-transport-host-snapshot.py','../../.github/workflows/testnet-independent-probe.yml']
    .map(name=>[path.basename(name),sha256(fs.readFileSync(new URL(name,import.meta.url)))]));
}

export async function runIndependent(argv,env=process.env,deps={}) {
  assert(argv.length===0||(argv.length===1&&argv[0]==='--live'),'NO_CUSTOM_INPUTS');
  if(!argv.length)return {exitCode:0,receipt:{dryRun:true,networkRequests:0,filesWritten:0}};
  const metadata=context(env);
  // Exclusive fresh paths: never upload old data or merge another run's state.
  const output=path.join(env.RUNNER_TEMP,'ynx-independent-shareable');
  fs.mkdirSync(output,{mode:0o700});
  let receipt={schema:'ynx-independent-probe-receipt/v1',...metadata,sourceSHA256:sourceHashes(),
    expectedSamples:8,complete:false,healthySamples:null,observedSamples:null,level:'monitor-error',
    bundleSHA256:null,freshStatePerRun:true,crossRunRecoveryEvaluated:false,
    noClaimsOrTransactions:true,globalRegionalVerified:false,continuousAvailabilityVerified:false,
    independentNetworkPathProven:false,rootCauseConfirmed:false,notificationDelivered:false};
  let exitCode=3;
  try {
    const state=fs.mkdtempSync(path.join(env.RUNNER_TEMP,'ynx-independent-private-'));
    const options=parseJobArgs(['--live','--state-dir',state,'--vantage','github-hosted-linux','--direct']);
    const result=await runJob(options,{exec:deps.exec??isolatedCommand,...(deps.now?{now:deps.now}:{})});
    assert(/^run-[A-Za-z0-9-]+\/diagnostic-bundle\.json$/.test(result.bundleName),'INVALID_BUNDLE_LOCATION');
    // Rebuild from hash-bound raw events through the existing allowlist sanitizer.
    const bundleFile=path.join(output,'diagnostic-bundle.json');
    const bundle=writeBundle(path.join(state,path.dirname(result.bundleName)),bundleFile);
    assert(bundle.vantage==='github-hosted-linux'&&bundle.pathMode==='direct-dns'&&!bundle.hostObservationExpected&&bundle.hosts.length===0,'UNEXPECTED_PROBE_MODE');
    receipt={...receipt,complete:bundle.complete,healthySamples:bundle.healthySamples,observedSamples:bundle.observedSamples,
      level:result.level,bundleSHA256:sha256(readRegular(bundleFile,1048576))};
    exitCode=bundle.complete&&result.level==='ok'?0:2;
  }catch{
    // Deliberately omit exceptions, bodies, headers, child logs, paths and env.
    receipt.diagnostic='COLLECTION_OR_EXPORT_FAILED';
  }
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  return {exitCode,receipt};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const {exitCode,receipt}=await runIndependent(process.argv.slice(2));
    console.log(JSON.stringify(receipt));process.exitCode=exitCode;
  }catch{
    console.error(JSON.stringify({schema:'ynx-independent-probe-error/v1',diagnostic:'INVALID_CONTEXT_OR_OUTPUT',complete:false}));
    process.exitCode=3;
  }
}
