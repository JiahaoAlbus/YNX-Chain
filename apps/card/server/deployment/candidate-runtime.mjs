import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Isolated candidate verification. No service/alias changes and no Wallet action.
// Argument source must be the commit from which the enclosing archive was made.
const [sourceCommit,output]=process.argv.slice(2);
if(!/^[a-f0-9]{40}$/.test(sourceCommit??'')||!output)throw Error('Exact source and output directory required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=resolve(output);mkdirSync(evidence,{recursive:true,mode:0o700});
const state=mkdtempSync(join(tmpdir(),'ynx-card-candidate-state-'));
const allocator=createServer();await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));
const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
const key=randomBytes(32);
const child=spawn(process.execPath,['server/main.ts'],{cwd:root,env:{...process.env,
  YNX_CARD_SOURCE_COMMIT:sourceCommit,YNX_CARD_DATA_DIR:state,YNX_CARD_STATE_KEY_BASE64:key.toString('base64'),
  YNX_CARD_AUTH_ADAPTER_MODULE:resolve(root,'server/sharedWalletAuth.ts'),YNX_CARD_CORE_RPC_URL:'',YNX_CARD_TESTNET_FUNDING_ADDRESS:'',
  YNX_CARD_HOST:'127.0.0.1',YNX_CARD_PORT:String(port),YNX_CARD_ALLOWED_ORIGIN:'https://card.ynxweb4.com'},stdio:['ignore','pipe','pipe']});key.fill(0);
let stdout='',stderr='',exit;
const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{exit={code,signal};resolve(exit)}));
child.stderr.on('data',chunk=>stderr+=chunk);
const ready=new Promise((resolve,reject)=>{
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('ynx-card-business-backend'))resolve()});
  child.once('error',reject);child.once('exit',()=>reject(Error('Candidate exited before readiness')));
});
let passed=false,failure=null;const resources=[];
try{
  let timeout;try{await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Candidate readiness timeout')),10000)})])}finally{clearTimeout(timeout)}
  for(const path of ['/api/card/v1/version','/api/card/v1/state']){
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:{'X-YNX-Card-Platform':'android'},redirect:'error',signal:AbortSignal.timeout(5000)});
    const bytes=Buffer.from(await response.arrayBuffer()),body=JSON.parse(bytes);
    resources.push({path,status:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),headers:Object.fromEntries(response.headers)});
    writeFileSync(join(evidence,path.endsWith('/version')?'version.json':'unauthenticated-state.json'),bytes,{mode:0o600});
    if(path.endsWith('/version')){
      if(response.status!==200||body.sourceCommit!==sourceCommit||body.configurationReady!==false||body.productionRealPayments!==false)throw Error('Candidate source/configuration mismatch');
    }else if(response.status<400||body.data!==undefined||body.productionRealPayments!==false)throw Error('Unauthenticated candidate exposed business data');
  }
  passed=true;
}catch(error){failure=error.message}
finally{
  if(!exit)child.kill('SIGTERM');let timeout;
  try{await Promise.race([exited,new Promise(resolve=>{timeout=setTimeout(()=>{child.kill('SIGKILL');resolve()},5000)})])}finally{clearTimeout(timeout)}
  if(!exit)await exited;
  writeFileSync(join(evidence,'stdout.log'),stdout,{mode:0o600});writeFileSync(join(evidence,'stderr.log'),stderr,{mode:0o600});
  const receipt={sourceCommit,node:process.version,platform:process.platform,architecture:process.arch,
    at:new Date().toISOString(),localLoopbackOnly:true,productionServiceInstalled:false,publicDeployed:false,
    realSession:false,realApproval:false,realFunding:false,productionRealPayments:false,
    passed:passed&&exit?.code===0,exit,failure,resources};
  writeFileSync(join(evidence,'results.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
  if(!receipt.passed)process.exitCode=1;
}
