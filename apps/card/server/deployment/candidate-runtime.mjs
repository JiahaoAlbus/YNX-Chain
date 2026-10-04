import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Isolated contracts only. No genuine private authority, public cutover or Wallet action.
const [sourceCommit,output]=process.argv.slice(2);
if(!/^[a-f0-9]{40}$/.test(sourceCommit??'')||!output)throw Error('Exact source and output directory required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=resolve(output);mkdirSync(evidence,{mode:0o700});
async function scenario(privateConfigured){
  const label=privateConfigured?'protected-missing-authority':'public-unconfigured';
  const directory=join(evidence,label);mkdirSync(directory,{mode:0o700});
  const state=mkdtempSync(join(tmpdir(),'ynx-card-candidate-state-'));
  const allocator=createServer();await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));
  const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
  const key=randomBytes(32);
  // Do not inherit auth credentials, processor settings or operational environment.
  const env={PATH:process.env.PATH,YNX_CARD_SOURCE_COMMIT:sourceCommit,YNX_CARD_DATA_DIR:state,
    YNX_CARD_STATE_KEY_BASE64:key.toString('base64'),YNX_CARD_CORE_RPC_URL:'',YNX_CARD_TESTNET_FUNDING_ADDRESS:'',
    YNX_CARD_HOST:'127.0.0.1',YNX_CARD_PORT:String(port),YNX_CARD_ALLOWED_ORIGIN:'https://card.ynxweb4.com'};
  if(privateConfigured)env.YNX_CARD_AUTH_ADAPTER_MODULE=resolve(root,'server/sharedWalletAuth.ts');
  const child=spawn(process.execPath,['--import','tsx','server/main.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});key.fill(0);
  let stdout='',stderr='',exit,launchError;const resources=[];
  const exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{exit={code,signal};resolve()});child.once('error',error=>{launchError=error.message;resolve()})});
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  let failure=null,passed=false;
  const waitFor=async(predicate,milliseconds)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>=milliseconds)throw Error('Candidate observation timeout');await new Promise(resolve=>setTimeout(resolve,25))}};
  try{
    if(privateConfigured){
      await waitFor(()=>Boolean(exit||launchError),10000);
      if(launchError||exit?.code!==1||stderr.trim()!=='CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE'||stdout.includes('ynx-card-business-backend'))throw Error('Protected startup did not refuse missing authority');
      if(readdirSync(state).length!==0)throw Error('Protected refusal opened state');
    }else{
      await waitFor(()=>Boolean(exit||launchError)||stdout.includes('ynx-card-business-backend'),10000);
      if(exit||launchError)throw Error('Public candidate exited before readiness');
      for(const path of ['/api/card/v1/version','/api/card/v1/state']){
        const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:{'X-YNX-Card-Platform':'android'},redirect:'error',signal:AbortSignal.timeout(5000)});
        const bytes=Buffer.from(await response.arrayBuffer()),body=JSON.parse(bytes);
        resources.push({path,status:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),headers:Object.fromEntries(response.headers)});
        writeFileSync(join(directory,path.endsWith('/version')?'version.json':'unauthenticated-state.json'),bytes,{mode:0o600});
        if(path.endsWith('/version')){
          if(response.status!==200||body.sourceCommit!==sourceCommit||body.configurationReady!==false||body.productionRealPayments!==false)throw Error('Candidate source/configuration mismatch');
        }else if(response.status<400||body.data!==undefined||body.productionRealPayments!==false)throw Error('Unauthenticated candidate exposed business data');
      }
    }
    passed=true;
  }catch(error){failure=error.message}
  finally{
    if(!exit&&!launchError)child.kill('SIGTERM');
    try{await waitFor(()=>Boolean(exit||launchError),5000)}catch{child.kill('SIGKILL');await exited}
    if(!privateConfigured&&exit?.code!==0){passed=false;failure??='Public candidate did not stop cleanly'}
    writeFileSync(join(directory,'stdout.log'),stdout,{mode:0o600});writeFileSync(join(directory,'stderr.log'),stderr,{mode:0o600});
  }
  return {label,passed,exit,launchError:launchError??null,failure,resources,stateDirectory:state,stateFiles:readdirSync(state)};
}
const scenarios=[await scenario(false),await scenario(true)];
const receipt={sourceCommit,node:process.version,platform:process.platform,architecture:process.arch,at:new Date().toISOString(),
  scope:'ISOLATED_PUBLIC_STARTUP_AND_PROTECTED_REFUSAL',localLoopbackOnly:true,productionServiceInstalled:false,publicDeployed:false,
  realSession:false,realApproval:false,realFunding:false,protectedRuntimeReady:false,productionRealPayments:false,
  passed:scenarios.every(result=>result.passed),scenarios};
writeFileSync(join(evidence,'results.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
if(!receipt.passed)process.exitCode=1;
