// Native disposable QA only. Never accept a caller database URL or production credentials.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,realpath,lstat,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if(process.argv.length!==4||process.argv[2]!=='--postgres-bin-dir'||process.getuid?.()===0)throw Error('Explicit native PostgreSQL directory and non-root QA user required');
const bin=await realpath(process.argv[3]),repo=fileURLToPath(new URL('../../../',import.meta.url));
for(const name of ['initdb','pg_ctl','createdb','psql','postgres']){const s=await lstat(path.join(bin,name));if(!s.isFile()||s.isSymbolicLink())throw Error('Executable must be a regular file: '+name)}
const root=await realpath(await mkdtemp('/tmp/ynx-exchange-postgres-it-')),data=path.join(root,'data'),socket=path.join(root,'socket');
await mkdir(socket,{mode:0o700});
const logs=[],receipt={classification:'ISOLATED_EXCHANGE_POSTGRES_QA_NOT_PUBLIC_ACCEPTANCE',root,productionDatabaseUsed:false,testsPassed:false,serverStopped:false};
let started=false,dataIdentity,pidReceipt,failure;
async function run(phase,command,args,env=process.env){
  const result=await new Promise((resolve,reject)=>{const c=spawn(command,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',v=>stdout+=v);c.stderr.on('data',v=>stderr+=v);c.on('error',reject);c.on('close',(code,signal)=>resolve({phase,code,signal,stdout,stderr}))});logs.push(result);return result;
}
function ok(r){if(r.code!==0)throw Error(r.phase+' failed; see retained QA logs');return r}
async function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p))})})}
async function captureStart(){try{pidReceipt=await readFile(path.join(data,'postmaster.pid'));started=true}catch(e){if(e.code!=='ENOENT')throw e}}
async function stop(phase){const now=await lstat(data),pid=await readFile(path.join(data,'postmaster.pid'));if(now.isSymbolicLink()||now.dev!==dataIdentity.dev||now.ino!==dataIdentity.ino||!pid.equals(pidReceipt))throw Error('QA cluster identity changed; refuse stop');ok(await run(phase,path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','-t','20','stop']));try{await lstat(path.join(data,'postmaster.pid'));throw Error('QA PID remains')}catch(e){if(e.code!=='ENOENT')throw e}started=false}
try{
  receipt.serverVersion=ok(await run('version',path.join(bin,'postgres'),['--version'])).stdout.trim();
  ok(await run('initdb',path.join(bin,'initdb'),['-D',data,'--no-locale','--encoding=UTF8','--username=ynx_exchange_qa','--auth-local=trust','--auth-host=trust']));
  dataIdentity=await lstat(data);receipt.port=await freePort();
  const startArgs=['-D',data,'-w','-t','20','-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${receipt.port} -k ${socket}`,'start'];
  const first=await run('start',path.join(bin,'pg_ctl'),startArgs);await captureStart();ok(first);if(!started)throw Error('QA start lacks identity receipt');
  const connection=['-h','127.0.0.1','-p',String(receipt.port),'-U','ynx_exchange_qa'];
  // Each case receives a fresh database. The legacy bootstrap intentionally
  // leaves sequence=8 and cannot share the revision=1 CAS fixture namespace.
  const cases=[['TestPostgreSQLStateStoreMultiInstanceCASAndRestartRecovery','YNX_EXCHANGE_POSTGRES_TEST_URL','integrity'],['TestFinanceReadPostgresCrossInstanceNonceAndPersistedAccount','YNX_EXCHANGE_POSTGRES_TEST_URL','integrity'],['TestPostgresStateRepositoryBootstrapAndCAS','YNX_EXCHANGE_TEST_DATABASE_URL','integrity'],['TestPostgreSQLStateStoreMultiInstanceCASAndRestartRecovery','YNX_EXCHANGE_POSTGRES_TEST_URL','revision']];
  for(const layout of ['integrity','revision'])cases.push(['TestPostgreSQLOwnedSupportTwoHTTPInstancesIsolationAndRestart','YNX_EXCHANGE_POSTGRES_TEST_URL',layout]);
  receipt.executed=[];
  for(let round=0;round<2;round++)for(let i=0;i<cases.length;i++){
    const [name,key,layout]=cases[i],database=`exchange_case_${round}_${i}`,phase=`case-${round}-${i}`;
    ok(await run(phase+'-create',path.join(bin,'createdb'),[...connection,database]));
    // Controlled legacy-layout fixture, not a proposed production migration.
    if(layout==='revision')ok(await run(phase+'-layout',path.join(bin,'psql'),[...connection,'-d',database,'-v','ON_ERROR_STOP=1','-c',"CREATE TABLE ynx_exchange_state (id text PRIMARY KEY, revision bigint NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)"]));
    const env={...process.env};delete env.YNX_EXCHANGE_POSTGRES_TEST_URL;delete env.YNX_EXCHANGE_TEST_DATABASE_URL;
    env[key]=`postgres://ynx_exchange_qa@127.0.0.1:${receipt.port}/${database}?sslmode=disable`;
    const result=ok(await run(phase,'go',['test','-race','./internal/exchangeproduct','-run',`^${name}$`,'-count=1','-v','-timeout=90s'],env));
    if(result.stdout.includes('--- SKIP:')||(result.stdout.match(new RegExp('^--- PASS: '+name+' ','gm'))||[]).length!==1)throw Error('Required real PostgreSQL case skipped or missing');
    receipt.executed.push({name,round,database,layout});
  }
  const database='exchange_restart_probe';ok(await run('probe-create-db',path.join(bin,'createdb'),[...connection,database]));
  const sql=async(phase,query)=>ok(await run(phase,path.join(bin,'psql'),[...connection,'-d',database,'-v','ON_ERROR_STOP=1','-At','-c',query])).stdout.trim();
  await sql('probe-write',"CREATE TABLE qa_restart_probe(value text NOT NULL); INSERT INTO qa_restart_probe VALUES ('exchange_durable_receipt')");
  await stop('restart-stop');const restarted=await run('restart-start',path.join(bin,'pg_ctl'),startArgs);await captureStart();ok(restarted);
  if(!started||await sql('probe-read','SELECT value FROM qa_restart_probe')!=='exchange_durable_receipt')throw Error('Database restart lost receipt');
  receipt.databaseRestartVerified=true;receipt.testsPassed=true;
}catch(e){failure=e.message;receipt.failure=e.message}
finally{
  if(started)try{await stop('stop');receipt.serverStopped=true}catch(e){failure??=e.message;receipt.stopFailure=e.message}
  // Preserve stopped, isolated cluster and logs. Do not recursively delete.
  for(const r of logs)await writeFile(path.join(root,r.phase+'.json'),JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600});
  receipt.logDigests=logs.map(r=>({phase:r.phase,sha256:createHash('sha256').update(JSON.stringify(r,null,2)+'\n').digest('hex')}));
  await writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt));if(failure)process.exitCode=1;
}
