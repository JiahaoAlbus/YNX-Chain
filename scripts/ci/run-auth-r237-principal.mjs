// New9 physical loopback HTTP tests only; no old green or production activation.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
import {prepareR237PrincipalCI} from './auth-r237-principal-supply.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),evidence=path.join(root,'.ci-evidence/auth-r237-principal');
const fail=c=>{throw Object.assign(Error(c),{code:c})},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,data)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
function groupAlive(pid){try{process.kill(-pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function joinGroup(pid){
 if(!groupAlive(pid))return {wasNonempty:false,empty:true};
 const signal=s=>{try{process.kill(-pid,s);}catch(e){if(e.code!=='ESRCH')throw e;}};signal('SIGTERM');for(let i=0;i<25&&groupAlive(pid);i++)await sleep(20);
 if(groupAlive(pid))signal('SIGKILL');for(let i=0;i<100&&groupAlive(pid);i++)await sleep(20);return {wasNonempty:true,empty:!groupAlive(pid)};
}
async function stage(name,tool,argv,cwd,wallMS,{input,environment,expectedExit=0}={}){
 const out=fs.openSync(path.join(evidence,name+'.stdout'),'wx',0o600),err=fs.openSync(path.join(evidence,name+'.stderr'),'wx',0o600),began=Date.now();let child,timer,killTimer,cause=null,total=0,start,closed,completed=false;
 const abort=code=>{if(!cause)cause=code;if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}killTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}},500);}};
 const onTERM=()=>abort('AUTH_GO_CI_CANCELLED'),onINT=()=>abort('AUTH_GO_CI_CANCELLED');process.once('SIGTERM',onTERM);process.once('SIGINT',onINT);
 try{
  child=spawn(tool,argv,{cwd,env:environment??{...process.env,GOTOOLCHAIN:'local',GOWORK:'off',GO111MODULE:'off'},detached:true,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']});
  closed=new Promise(resolve=>{child.once('error',e=>{cause??=e.code??'AUTH_GO_CI_SPAWN';});child.once('close',(actualExit,signal)=>resolve({actualExit,signal}));});
  if(input!==undefined){child.stdin.on('error',e=>{if(e.code!=='EPIPE')abort(e.code??'R237_STDIN');});child.stdin.end(input);}
  let identity=null;try{const raw=fs.readFileSync('/proc/'+child.pid+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);identity={pid:child.pid,processGroup:Number(fields[2]),kernelStartTicks:fields[19]};if(identity.processGroup!==child.pid||!/^\d+$/.test(identity.kernelStartTicks))fail('AUTH_GO_CI_PID_START');}catch(e){abort(e.code??'AUTH_GO_CI_PID_START');}
  start={stage:name,tool,argv,cwd,pid:child.pid??null,identity,at:new Date(began).toISOString(),environment:environment===undefined?{GOTOOLCHAIN:'local',GOWORK:'off',GO111MODULE:'off'}:{keys:Object.keys(environment).sort()},wallMS,expectedExit,inputBytes:input===undefined?0:Buffer.byteLength(input)};save(name+'_START.json',start);
  for(const [stream,fd]of [[child.stdout,out],[child.stderr,err]])stream.on('data',b=>{total+=b.length;if(total>10485760){abort('AUTH_GO_CI_LOG_CAP');return;}try{fs.writeSync(fd,b);}catch{abort('AUTH_GO_CI_LOG_WRITE_FAILED');}});
  timer=setTimeout(()=>abort('AUTH_GO_CI_WALL_TIMEOUT'),wallMS);
  const exit=await closed;
  clearTimeout(timer);clearTimeout(killTimer);const joined=child.pid?await joinGroup(child.pid):{wasNonempty:false,empty:false};
  // A Go exit 0 with a remaining descendant is a failure even if cleanup later
  // succeeds. It never becomes a passing result by killing the leftover group.
  if(joined.wasNonempty)cause??='AUTH_GO_CI_OWNED_GROUP_NOT_EMPTY';if(!joined.empty)cause??='AUTH_GO_CI_GROUP_JOIN_FAILED';
  completed=true;const terminal={...start,end:new Date().toISOString(),elapsedMS:Date.now()-began,...exit,firstCause:cause,ownedGroupJoined:joined,success:exit.actualExit===expectedExit&&exit.signal===null&&cause===null&&joined.empty};save(name+'_TERMINAL.json',terminal);return terminal;
 }finally{
  if(child?.pid&&!completed){abort('AUTH_GO_CI_STAGE_INTERRUPTED');await closed;await joinGroup(child.pid);}
  clearTimeout(timer);clearTimeout(killTimer);process.removeListener('SIGTERM',onTERM);process.removeListener('SIGINT',onINT);fs.closeSync(out);fs.closeSync(err);
 }
}

export async function runR237PrincipalCI(){
 if(process.argv.length!==2||process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Linux'||!/^\d+$/.test(process.env.GITHUB_RUN_ID??'')||!process.env.GITHUB_JOB)fail('R237_LINUX_ACTIONS_REQUIRED');
 if(process.version!=='v24.19.0'||(process.env.NODE_OPTIONS??'')!==''||(process.env.NODE_PATH??'')!=='')fail('R237_NODE_SELECTION');
 fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.mkdirSync(evidence,{mode:0o700});let firstCause=null;
 try{
  const scratch=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-r237-principal-CI-'))),prepared=prepareR237PrincipalCI({outputRoot:path.join(scratch,'closed-sdk')});save('PREPARE_RECEIPT.json',prepared);
  save('NODE_TOOL.json',{tool:fs.realpathSync(process.execPath),version:process.version,argv:['--test','--test-reporter=tap',prepared.test],original30sBudget:true});
  const result=await stage('NODE_NEW9',process.execPath,['--test','--test-reporter=tap',prepared.test],prepared.outputRoot,30000,{environment:{...process.env,TMPDIR:scratch}});
  if(!result.success)fail(result.firstCause??'R237_NEW9_FAILED');
  const text=fs.readFileSync(path.join(evidence,'NODE_NEW9.stdout'),'utf8'),passes=[...text.matchAll(/^ok \d+ - (.+)$/gm)].map(x=>x[1]);
  if(passes.length!==9||new Set(passes).size!==9||passes.some(x=>!prepared.testNames.includes(x))||/^not ok/m.test(text)||/# SKIP|# TODO/.test(text)||!/^# tests 9$/m.test(text)||!/^# pass 9$/m.test(text)||!/^# fail 0$/m.test(text)||!/^# skipped 0$/m.test(text)||!/^# cancelled 0$/m.test(text))fail('R237_EXACT_NINE_REQUIRED');
  save('SELECTED_TEST_RESULTS.json',{names:passes,pass:9,fail:0,skip:0,actualLoopbackHTTP:true,temporaryPUBLICBrandOnly:true,originalProductionThreeUnmodified:true,oldGreensRerun:false,Root:false,SourceAdmitted:false,serviceMounted:false});
 }catch(e){firstCause=e.code??e.message??'R237_CI_FAILED';}
 save('RESULT.json',{success:firstCause===null,firstCause,noAutomaticRetry:true,Root:false,SourceAdmitted:false,serviceMounted:false,production:false,Native:false,Go:false,installed:false,realUserLogin:false});if(firstCause)fail(firstCause);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runR237PrincipalCI();
