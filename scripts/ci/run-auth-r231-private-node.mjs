// New R231 namespace; lifecycle inherited from Git f6cf3dda7c original bootstrap.
// CI-only bootstrap. The original helper retains its strict process.execPath
// selection by running the fixture runner under the same verified private Node.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {preparePrivateCINode,cleanupPrivateCINode} from './auth-r227-private-node.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
if(process.argv.length!==2||process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Linux')throw Error('AUTH_PRIVATE_BOOTSTRAP_CI_ONLY');
const evidence=path.join(root,'.ci-evidence/auth-r231-private-node');
fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.mkdirSync(evidence,{mode:0o700});
const save=(n,o)=>fs.writeFileSync(path.join(evidence,n),JSON.stringify(o,null,2)+'\n',{flag:'wx',mode:0o600});
const alive=pid=>{try{process.kill(-pid,0);return true}catch(e){if(e.code==='ESRCH')return false;throw e}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let receipt,terminal,cleanup,firstCause=null,pid,closed,timer,killTimer,aborted=false;
function cancel(){aborted=true;if(!pid)return;try{process.kill(-pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}killTimer??=setTimeout(()=>{try{process.kill(-pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}},1500)}
process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
try{
  receipt=preparePrivateCINode();save('PRIVATE_NODE_READY.json',receipt);
  if(!receipt.ready||receipt.sha256!=='bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12'||receipt.source.sha256!==receipt.sha256||receipt.source.bytes!==receipt.bytes)throw Error('AUTH_PRIVATE_COPY_NOT_READY');
  const started=new Date().toISOString(),tool=receipt.path,argv=[path.join(root,'scripts/ci/run-auth-r231-runtime.mjs')];
  const out=fs.openSync(path.join(evidence,'RUNNER.stdout'),'wx',0o600),err=fs.openSync(path.join(evidence,'RUNNER.stderr'),'wx',0o600);
  try{
    const child=spawn(tool,argv,{cwd:root,env:{...process.env},detached:true,stdio:['ignore',out,err]});pid=child.pid;
    closed=new Promise(resolve=>{child.once('error',e=>{firstCause??=e.code??'AUTH_PRIVATE_SPAWN'});child.once('close',(exit,signal)=>resolve({exit,signal}))});
    let identity;try{const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8'),f=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);identity={pid,processGroup:Number(f[2]),kernelStartTicks:f[19]};if(identity.processGroup!==pid||!/^\d+$/.test(identity.kernelStartTicks))throw Error('AUTH_PRIVATE_PID_START')}catch(e){firstCause??=e.code??e.message;cancel()}
    save('RUNNER_START.json',{started,tool,argv,identity:identity??null,wallMS:180000});
    timer=setTimeout(cancel,180000);const result=await closed;clearTimeout(timer);clearTimeout(killTimer);
    if(alive(pid)){firstCause??='AUTH_PRIVATE_GROUP_REMAINED';cancel();for(let n=0;n<100&&alive(pid);n++)await sleep(20)}
    terminal={...result,started,end:new Date().toISOString(),pid,ownedGroupEmpty:!alive(pid),aborted};save('RUNNER_TERMINAL.json',terminal);
    if(result.exit!==0||result.signal||aborted||!terminal.ownedGroupEmpty)firstCause??='AUTH_PRIVATE_RUNNER_FAILED';
  }finally{fs.closeSync(out);fs.closeSync(err)}
}catch(e){receipt??=e?.partial;firstCause??=e.code??e.message??'AUTH_PRIVATE_FAILED'}
finally{
  clearTimeout(timer);clearTimeout(killTimer);process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);
  const goEvidence=path.join(root,'.ci-evidence/auth-r231-runner');
  // A started Go process needs its original terminal with its own detached
  // group joined; a missing record is UNKNOWN and cannot authorize deletion.
  let goQuiescent=fs.existsSync(path.join(goEvidence,'RESULT.json'));
  // A missing final runner record cannot prove the interval before START was
  // published was quiescent; retain the owned copy on that UNKNOWN boundary.
  // Each detached stage owns a distinct group. Missing terminal is UNKNOWN,
  // missing original Go terminal never permits cleanup.
  for(const name of ['GO_VERSION','GO_TEST']){
    if(fs.existsSync(path.join(goEvidence,name+'_START.json'))){try{if(JSON.parse(fs.readFileSync(path.join(goEvidence,name+'_TERMINAL.json'),'utf8')).ownedGroupJoined.empty!==true)goQuiescent=false}catch{goQuiescent=false}}
  }
  if(receipt&&(!pid||terminal?.ownedGroupEmpty)&&goQuiescent){try{cleanup=cleanupPrivateCINode(receipt);save('PRIVATE_NODE_CLEANUP.json',cleanup)}catch(e){firstCause??=e.code??e.message;save('CLEANUP_PRESERVED.json',{cause:e.code??e.message,unknownPreserved:true})}}
  else if(receipt){firstCause??='AUTH_PRIVATE_INFLIGHT_UNKNOWN';save('CLEANUP_PRESERVED.json',{unknownPreserved:true,goQuiescent,runnerTerminalPresent:!!terminal})}
  save('RESULT.json',{success:firstCause===null,firstCause,terminal:terminal??null,cleanup:cleanup??null,productionVerifierChanged:false,officialNodeChmod:false,SourceMounted:false,Root:false,realUserFlow:false,noAutomaticRetry:true});
}
if(firstCause)throw Error(firstCause);
