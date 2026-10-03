// Disposable native PostgreSQL QA only: never consume a caller database URL.
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, realpath, lstat, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if(process.argv.length!==4 || process.argv[2]!=='--postgres-bin-dir' || process.getuid?.()===0) throw Error('Explicit native PostgreSQL bin directory and non-root QA user required.');
const bin=await realpath(process.argv[3]), repo=fileURLToPath(new URL('../../../',import.meta.url));
for(const name of ['initdb','pg_ctl','createdb','psql','postgres']) {
  const entry=await lstat(path.join(bin,name));
  if(!entry.isFile() || entry.isSymbolicLink()) throw Error('Native executable must be a regular file: '+name);
}
const root=await realpath(await mkdtemp('/tmp/ynx-quant-postgres-it-'));
const data=path.join(root,'data'), socket=path.join(root,'socket');
await mkdir(socket,{mode:0o700});
const logs=[];
async function run(phase,command,args,env=process.env) {
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',reject);child.on('close',(code,signal)=>resolve({phase,code,signal,stdout,stderr}));
  });
  logs.push(result);return result;
}
function requireSuccess(result) {if(result.code!==0)throw Error(result.phase+' failed (see retained local QA logs).');return result;}
async function port() {
  return new Promise((resolve,reject)=>{
    const server=createServer();server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value));});
  });
}
const receipt={classification:'ISOLATED_NATIVE_POSTGRES_QA_NOT_PUBLIC_ACCEPTANCE',root,testsPassed:false,serverStopped:false,productionDatabaseUsed:false};
let started=false, dataIdentity=null, pidReceipt=null, failure=null;
async function stopOwnedCluster(phase) {
  const current=await lstat(data), pid=await readFile(path.join(data,'postmaster.pid'));
  if(current.isSymbolicLink() || current.dev!==dataIdentity.dev || current.ino!==dataIdentity.ino || !pid.equals(pidReceipt)) throw Error('QA cluster identity changed; refuse unrelated process stop.');
  requireSuccess(await run(phase,path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','-t','20','stop']));
  try {await lstat(path.join(data,'postmaster.pid'));throw Error('QA postmaster PID remains.');} catch(error) {if(error.code!=='ENOENT')throw error;}
  started=false;
}
try {
  receipt.serverVersion=requireSuccess(await run('version',path.join(bin,'postgres'),['--version'])).stdout.trim();
  requireSuccess(await run('initdb',path.join(bin,'initdb'),['-D',data,'--no-locale','--encoding=UTF8','--username=ynx_quant_qa','--auth-local=trust','--auth-host=trust']));
  dataIdentity=await lstat(data);receipt.port=await port();
  // Local empty fixture database only. Trust is deliberately not a production
  // authentication claim; no user data/assets/credentials enter this cluster.
  const startResult=await run('start',path.join(bin,'pg_ctl'),['-D',data,'-w','-t','20','-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${receipt.port} -k ${socket}`,'start']);
  // A timed-out start can still have created our own postmaster. Capture its
  // identity before reporting failure so the finally block can stop it safely.
  try {pidReceipt=await readFile(path.join(data,'postmaster.pid'));started=true;} catch(error) {if(error.code!=='ENOENT')throw error;}
  requireSuccess(startResult);
  if(!started)throw Error('Started QA server has no identity receipt.');
  const connection=['-h','127.0.0.1','-p',String(receipt.port),'-U','ynx_quant_qa'];
  requireSuccess(await run('createdb',path.join(bin,'createdb'),[...connection,'quant_isolated_qa']));
  receipt.databaseIdentity=requireSuccess(await run('identity',path.join(bin,'psql'),[...connection,'-d','quant_isolated_qa','-At','-c',"SELECT current_database(),inet_server_addr(),current_setting('server_version')"])).stdout.trim();
  const required=['TestPostgreSQLStateStoreMultiInstanceCASRestartAndTenantIsolation','TestPostgreSQLTenantServerKeepsRiskStateIsolatedAcrossHTTPUsers','TestPostgreSQLResearchReplayConcurrentInstancesRestartAndTenantIsolation','TestFinanceReadPostgresTenantAndCrossInstanceReplay','TestPostgreSQLPaperKillFencesInFlightMarketAndSurvivesRestart','TestPostgreSQLPaperDailyMarkedLossPersistsLatchAndUTCReset','TestPostgreSQLSchedulesFenceStoppedInflightAndRecoverClaimsAcrossInstances'];
  required.push('TestPostgreSQLReadinessRejectsClosedPoolAndRecoversOnReopen');
  required.push('TestPostgreSQLTenantSchedulerResumesAfterRestartWithoutBrowser');
  const result=requireSuccess(await run('integration','go',['test','-race','./internal/quantlab','-run','^(TestPostgreSQL|TestFinanceReadPostgres)','-count=2','-v','-timeout=90s'],{...process.env,YNX_QUANT_POSTGRES_TEST_URL:`postgres://ynx_quant_qa@127.0.0.1:${receipt.port}/quant_isolated_qa?sslmode=disable`}));
  if(result.stdout.includes('--- SKIP:') || required.some(name=>(result.stdout.match(new RegExp('^--- PASS: '+name+' ','gm'))||[]).length!==2)) throw Error('All required actual PostgreSQL gates must execute twice, not skip.');
  receipt.integrationPasses=required.length*2;
  const sql=async (phase,query)=>requireSuccess(await run(phase,path.join(bin,'psql'),[...connection,'-d','quant_isolated_qa','-v','ON_ERROR_STOP=1','-At','-c',query])).stdout.trim();
  await sql('restart-probe-create',"CREATE TABLE qa_restart_probe (value TEXT NOT NULL); INSERT INTO qa_restart_probe VALUES ('isolated_restart_receipt')");
  await stopOwnedCluster('restart-stop');
  const restartResult=await run('restart-start',path.join(bin,'pg_ctl'),['-D',data,'-w','-t','20','-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${receipt.port} -k ${socket}`,'start']);
  try {pidReceipt=await readFile(path.join(data,'postmaster.pid'));started=true;} catch(error) {if(error.code!=='ENOENT')throw error;}
  requireSuccess(restartResult);
  if(!started)throw Error('Restarted QA server has no identity receipt.');
  if(await sql('restart-probe-read','SELECT value FROM qa_restart_probe')!=='isolated_restart_receipt')throw Error('Database restart lost durable fixture receipt.');
  await sql('restart-probe-drop','DROP TABLE qa_restart_probe');
  receipt.databaseRestartVerified=true;
  const full=requireSuccess(await run('full-regression','go',['test','-race','./internal/quantlab','./internal/readintegration','-count=1','-v','-timeout=90s'],{...process.env,YNX_QUANT_POSTGRES_TEST_URL:`postgres://ynx_quant_qa@127.0.0.1:${receipt.port}/quant_isolated_qa?sslmode=disable`}));
  if(required.some(name=>(full.stdout.match(new RegExp('^--- PASS: '+name+' ','gm'))||[]).length!==1))throw Error('Full regression did not execute every actual database gate.');
  receipt.fullRegressionPassed=true;
  receipt.fullRegressionPasses=(full.stdout.match(/^--- PASS: /gm)||[]).length;
  receipt.remainingRows=requireSuccess(await run('row-receipt',path.join(bin,'psql'),[...connection,'-d','quant_isolated_qa','-At','-c','SELECT (SELECT count(*) FROM ynx_quant_state),(SELECT count(*) FROM ynx_quant_finance_read_nonces)'])).stdout.trim();
  if(receipt.remainingRows!=='0|0') throw Error('Integration left fixture state/nonce rows behind.');
  receipt.testsPassed=true;
} catch(error) {failure=error.message;receipt.failure=error.message;}
finally {
  if(started) {
    try {
      await stopOwnedCluster('stop');
      receipt.serverStopped=true;
    } catch(error) {receipt.stopFailure=error.message;failure??=error.message;}
  }
  // Retain the stopped, empty local cluster and logs, not recursive deletion.
  for(const result of logs) await writeFile(path.join(root,result.phase+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  receipt.logDigests=logs.map(result=>({phase:result.phase,sha256:createHash('sha256').update(JSON.stringify(result,null,2)+'\n').digest('hex')}));
  await writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt));if(failure)process.exitCode=1;
}
