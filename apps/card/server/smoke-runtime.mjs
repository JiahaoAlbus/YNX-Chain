// Local process smoke test only. No Wallet, remote RPC, signature, or transaction.
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,process.argv[2]??'evidence/business-client-20260912/runtime-01');
mkdirSync(out,{recursive:true,mode:0o700});
const temporary=mkdtempSync(join(tmpdir(),'ynx-card-runtime-smoke-')),key=randomBytes(32);
const source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const sha=value=>createHash('sha256').update(value).digest('hex');
const portProbe=createServer();await new Promise((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(0,'127.0.0.1',resolve)});
const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
const child=spawn(process.execPath,['server/main.ts'],{cwd:root,env:{...process.env,YNX_CARD_SOURCE_COMMIT:source,YNX_CARD_DATA_DIR:temporary,YNX_CARD_STATE_KEY_BASE64:key.toString('base64'),YNX_CARD_AUTH_ADAPTER_MODULE:'',YNX_CARD_CORE_RPC_URL:'',YNX_CARD_TESTNET_FUNDING_ADDRESS:'',YNX_CARD_HOST:'127.0.0.1',YNX_CARD_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',exited=false,exitResult;
const exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{exited=true;exitResult={code,signal};resolve(exitResult)});child.once('error',error=>{exited=true;exitResult={error:error.message};resolve(exitResult)});});
const ready=new Promise((resolve,reject)=>{
  child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.includes('"service":"ynx-card-business-backend"'))resolve();});
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  void exit.then(()=>reject(Error('Card process exited before readiness')));
});
let timer,success=false;
const results={at:new Date().toISOString(),sourceCommit:source,node:process.version,command:'node server/main.ts',localOnly:true,publicDeployed:false,realApproval:false,realFunding:false,responses:[]};
try{
  await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Card readiness timeout')),10000)})]);
  for(const [path,status]of [['/version',200],['/api/card/v1/state',503]]){
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(5000)}),body=await response.text(),data=JSON.parse(body);
    writeFileSync(join(out,path==='/version'?'version.json':'private-state.json'),body);
    results.responses.push({path,status:response.status,bytes:Buffer.byteLength(body),sha256:sha(body),headers:Object.fromEntries(response.headers)});
    if(response.status!==status||data.productionRealPayments!==false)throw Error('Unexpected Card runtime boundary');
    if(path==='/version'&&(data.sourceCommit!==source||data.configurationReady!==false))throw Error('Unbound runtime identity');
    if(path!=='/version'&&data.error?.code!=='PRIVATE_SERVICE_DEGRADED')throw Error('Private route did not fail closed');
  }
  success=true;
}catch(error){results.error=error instanceof Error?error.message:'Runtime smoke failed';}
finally{
  clearTimeout(timer);if(!exited)child.kill('SIGTERM');
  let stopTimer;await Promise.race([exit,new Promise(resolve=>{stopTimer=setTimeout(()=>{if(!exited)child.kill('SIGKILL');resolve();},5000)})]);clearTimeout(stopTimer);
  if(!exited)await exit;
  key.fill(0);rmSync(temporary,{recursive:true,force:true});
  writeFileSync(join(out,'stdout.log'),stdout);writeFileSync(join(out,'stderr.log'),stderr);
  results.passed=success&&exitResult?.code===0;results.processExit=exitResult;
  results.stdoutSha256=sha(stdout);results.stderrSha256=sha(stderr);
  writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));if(!results.passed)process.exitCode=1;
}
