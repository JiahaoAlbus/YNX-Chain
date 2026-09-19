import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateBrokerWireFixtures} from './weekly-v3/broker-wire-fixtures.mjs';
import {startGatewayFixture} from './weekly-v3/gateway-sse-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const providerFixtureFile=path.join(root,'scripts/verify/weekly-v3/broker-wire-fixtures.json');
const providerFixtureProvenance=validateBrokerWireFixtures(JSON.parse(fs.readFileSync(providerFixtureFile,'utf8')));
const options={};
for(let i=2;i<process.argv.length;i+=2){if(!['--finance-worktree','--finance-commit','--wallet-worktree','--wallet-commit','--diagnostic-date-adapter','--output'].includes(process.argv[i])||!process.argv[i+1]||options[process.argv[i]])throw new Error('Exact Finance/Wallet worktrees and full commits required');options[process.argv[i]]=process.argv[i+1]}
if(options['--diagnostic-date-adapter']&&!['true','false'].includes(options['--diagnostic-date-adapter']))throw new Error('Diagnostic adapter must be explicitly true or false');
if(options['--output']&&fs.existsSync(path.resolve(options['--output'])))throw new Error('Evidence output already exists; no owner tests were started');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const roots={},sourcePaths={};
const publishedCheckpoints={};
for(const owner of ['finance','wallet']){
 const dir=roots[owner]=fs.realpathSync(options[`--${owner}-worktree`]);const sha=options[`--${owner}-commit`];
 if(!/^[a-f0-9]{40}$/.test(sha)||git(dir,'rev-parse','HEAD')!==sha)throw new Error(`${owner} checkpoint mismatch`);
 const paths=sourcePaths[owner]=owner==='finance'?['.']:['packages/wallet-auth','apps/wallet'];
 git(dir,'diff','--quiet',sha,'--',...paths);
 if(git(dir,'ls-files','--others','--exclude-standard',...paths))throw new Error(`${owner} untracked product source`);
 const branch=git(dir,'symbolic-ref','--short','HEAD');
 const remote=git(dir,'config',`branch.${branch}.remote`);
 const ref=git(dir,'config',`branch.${branch}.merge`);
 if(!remote||remote==='.'||!ref.startsWith('refs/heads/'))throw new Error(`${owner} requires a published owner branch`);
 const rows=git(dir,'ls-remote','--exit-code',remote,ref).split('\n');
 if(!rows.includes(`${sha}\t${ref}`))throw new Error(`${owner} checkpoint is not the exact published branch head`);
 publishedCheckpoints[owner]={remote,ref,commit:sha};
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-weekly-v3-integration-'));
const source=path.join(root,'scripts/verify/weekly-v3/finance_wallet_integration_test.go');
const gatewaySource=path.join(root,'scripts/verify/weekly-v3/finance_gateway_integration_test.go');
const assetFiles=[source,gatewaySource,providerFixtureFile,path.join(root,'scripts/verify/weekly-v3/broker-wire-fixtures.mjs'),path.join(root,'scripts/verify/weekly-v3/gateway-sse-fixture.mjs'),path.join(root,'scripts/verify/weekly-v3/finance-wallet-bridge.mjs'),fileURLToPath(import.meta.url)];
const hashAssets=()=>Object.fromEntries(assetFiles.map(file=>[path.relative(root,file),createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const sourceSha256=hashAssets();
const overlay=path.join(temp,'overlay.json');
fs.writeFileSync(overlay,JSON.stringify({Replace:{[path.join(roots.finance,'internal/finance/weekly_v3_integration_test.go')]:source,[path.join(roots.finance,'internal/finance/weekly_v3_gateway_integration_test.go')]:gatewaySource}}),{flag:'wx'});
const gateways={};
let result;
try{
 for(const scenario of ['valid','invalid-schema','unstructured','malformed-sse','truncated','unauthorized','rate-limited'])gateways[scenario]=await startGatewayFixture({scenario,maxRequests:64});
 const gatewayEnv=Object.fromEntries(Object.entries(gateways).map(([scenario,fixture])=>[`WEEKLY_GATEWAY_${scenario.toUpperCase().replaceAll('-','_')}`,fixture.url]));
 // Async child execution keeps this process's ephemeral HTTP fixtures alive.
 result=await new Promise(resolve=>execFile('go',['test','-race','-count=1','-tags=weekly_v3_integration','-overlay',overlay,'-v','./internal/finance','-run','TestWeeklyV3'],{cwd:roots.finance,encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024,env:{...process.env,...gatewayEnv,WEEKLY_DATE_ADAPTER:options['--diagnostic-date-adapter']??'false',WEEKLY_FINANCE_ROOT:roots.finance,WEEKLY_WALLET_ROOT:roots.wallet,WEEKLY_PROVIDER_FIXTURES:providerFixtureFile,WEEKLY_BRIDGE:path.join(root,'scripts/verify/weekly-v3/finance-wallet-bridge.mjs')}},(error,stdout,stderr)=>resolve({status:error?(typeof error.code==='number'?error.code:null):0,error,stdout,stderr})));
}finally{await Promise.all(Object.values(gateways).map(fixture=>fixture.close()));}
const output=(result.stdout??'')+(result.stderr??'');process.stdout.write(output);
let unchanged=false;
try{unchanged=Object.entries(roots).every(([owner,dir])=>{git(dir,'diff','--quiet',options[`--${owner}-commit`],'--',...sourcePaths[owner]);return git(dir,'rev-parse','HEAD')===options[`--${owner}-commit`]&&!git(dir,'ls-files','--others','--exclude-standard',...sourcePaths[owner])})}catch{}
const integrationAssetsUnchanged=JSON.stringify(sourceSha256)===JSON.stringify(hashAssets());
unchanged=unchanged&&integrationAssetsUnchanged;
const report={schema:'ynx-weekly-v3-finance-wallet-integration/v1',generatedAt:new Date().toISOString(),financeCommit:options['--finance-commit'],walletCommit:options['--wallet-commit'],networkCommit:git(root,'rev-parse','HEAD'),sourceSha256,productCheckpointsUnchanged:unchanged,diagnosticDateAdapter:options['--diagnostic-date-adapter']==='true',scope:'local browser VM + actual Wallet controller + Finance HTTP/store; authority and loopback TLS provider fixtures; not installed GUI or official Sandbox',exitCode:result.status,error:result.error?.message??null,outputSha256:createHash('sha256').update(output).digest('hex'),output,localFixtureEndToEndVerified:result.status===0&&unchanged&&options['--diagnostic-date-adapter']!=='true',crossProductE2EVerified:false,officialSandboxVerified:false,publicDeployed:false,publicVerified:false,productionApproved:false};
report.providerFixtureProvenance=providerFixtureProvenance;
report.publishedCheckpoints=publishedCheckpoints;
report.integrationAssetsUnchanged=integrationAssetsUnchanged;
report.gatewayFixtureRequests=Object.fromEntries(Object.entries(gateways).map(([scenario,fixture])=>[scenario,fixture.requests.map(({method,path,authenticated})=>({method,path,authenticated}))]));
report.realModelGenerationVerified=false;
report.stageAComplete=false;
report.providerWireScope='Pinned complete public TradeAccount and TradeUpdateEventV2New JSON; synthetic identity/lifecycle derivatives; SSE framing is fixture-only, not authenticated transport';
if(options['--output'])fs.writeFileSync(path.resolve(options['--output']),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.exitCode=result.status===0&&unchanged?0:1;
