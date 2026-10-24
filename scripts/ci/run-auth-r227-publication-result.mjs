// R227 PUBLIC CI runner. Process lifecycle is inherited from Git f6cf3dda7c
// original runner; only exact supplier closure/selection and two N1 routes differ.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
import {stageR227PublicationResultSupply} from './auth-r227-publication-result-supply.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),pkg=path.join(root,'packages/wallet-auth'),evidence=path.join(root,'.ci-evidence/auth-r227-runner');
const names=['TestR227ResultDataIsOriginalBytesAndMemberDecodedOnce','TestR227LegacyProofAndMismatchedResultNeverBecomePublication','TestR227NormalCatalogPassesOriginalMemberNotBase64Text','TestR227ActualN1VectorSurvivesGoTransport','TestR217PublicationNormalCallerDoesNotReplayOneHTTPRequest','TestR221PublicationCallerStillChecksPublisherAfterIndependentApprovals'];
const selection='^('+names.join('|')+')$';
const fail=c=>{throw Object.assign(Error(c),{code:c})},hash=b=>createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,data)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
function findGo(){
 for(const part of (process.env.PATH??'').split(path.delimiter)){if(!path.isAbsolute(part))continue;const p=path.join(part,'go');try{fs.accessSync(p,fs.constants.X_OK);}catch{continue;}const real=fs.realpathSync(p),s=fs.lstatSync(real);if(!s.isFile()||s.isSymbolicLink())fail('AUTH_GO_CI_TOOL');return real;}fail('AUTH_GO_CI_TOOL_MISSING');
}
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
  if(input!==undefined){child.stdin.on('error',e=>{if(e.code!=='EPIPE')abort(e.code??'R227_STDIN');});child.stdin.end(input);}
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

async function main(){
 if(process.argv.length!==2||process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Linux'||!/^\d+$/.test(process.env.GITHUB_RUN_ID??'')||!process.env.GITHUB_JOB)fail('R227_LINUX_ACTIONS_REQUIRED');
 if((process.env.GOFLAGS??'')!=='')fail('R227_UNEXPECTED_GOFLAGS');
 fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.mkdirSync(evidence,{mode:0o700});let firstCause=null;
 try{
  const scratch=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-auth-r227-go-CI-'))),outputRoot=path.join(scratch,'prepared');
  const prepared=stageR227PublicationResultSupply({outputRoot,nodeExecutable:fs.realpathSync(process.execPath)});save('PREPARE_RECEIPT.json',prepared);
  const go=findGo(),version=await stage('GO_VERSION',go,['version'],pkg,5000);if(!version.success)fail(version.firstCause??'R227_GO_VERSION');const arch=process.arch==='x64'?'amd64':process.arch;
  if(fs.readFileSync(path.join(evidence,'GO_VERSION.stdout'),'utf8').trim()!=='go version go1.25.13 linux/'+arch)fail('R227_GO_VERSION');
  const basenames=prepared.files.map(p=>path.basename(p.path)).sort();if(basenames.length!==50)fail('R227_GO_SCOPE');
  const goTest=await stage('GO_TEST',go,['test','-race','-json','-run',selection,'-count=1',...basenames],path.join(outputRoot,'internal/developerauthority'),120000,{environment:{...process.env,GOTOOLCHAIN:'local',GOWORK:'off',GO111MODULE:'off',YNX_R227_PUBLIC_VECTOR:prepared.publicVector}});
  if(!goTest.success)fail(goTest.firstCause??'R227_GO_TEST');
  const events=fs.readFileSync(path.join(evidence,'GO_TEST.stdout'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),passes=events.filter(x=>x.Action==='pass'&&typeof x.Test==='string').map(x=>x.Test);
  if(events.some(x=>x.Action==='fail'||x.Action==='skip')||passes.length!==6||new Set(passes).size!==6||passes.some(n=>!names.includes(n))||events.filter(x=>x.Action==='pass'&&!x.Test).length!==1)fail('R227_GO_SELECTION');
  save('SELECTED_TEST_RESULTS.json',{names:passes,pass:6,race:true,oldGoGreensRerun:false,SDK35DecoderRerun:false,oldFullPinned28_63FailureResolved:false});
  const v=JSON.parse(fs.readFileSync(prepared.publicVector,'utf8')),canonical=o=>JSON.stringify(Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]]))),base={operation:'ide-artifact-signed-manifest-data/v1',expectedPublicOriginal:v.publisher};
  const argv=['--permission','--allow-fs-read='+pkg,path.join(pkg,'native/original-auth-identity-source-verifier.mjs')];
  const old=await stage('OLD_DOUBLE_ENCODING',process.execPath,argv,pkg,30000,{environment:{},input:canonical({...base,signatureOriginal:Buffer.from(v.member).toString('base64url')}),expectedExit:1});
  if(!old.success||fs.readFileSync(path.join(evidence,'OLD_DOUBLE_ENCODING.stdout')).length!==0)fail(old.firstCause??'R227_OLD_DOUBLE_ENCODING_NOT_REJECTED');
  const fixed=await stage('DECODED_MEMBER_N1',process.execPath,argv,pkg,30000,{environment:{},input:canonical({...base,signatureOriginal:v.member})});
  if(!fixed.success)fail(fixed.firstCause??'R227_N1_REJECTED');const data=JSON.parse(fs.readFileSync(path.join(evidence,'DECODED_MEMBER_N1.stdout'),'utf8'));
  if(data.signatureVerified!==true||data.authorized!==false)fail('R227_N1_DATA_FLAGS');
  save('ACTUAL_N1_RESULTS.json',{oldDoubleEncodingExit:old.actualExit,correctDecodedMemberExit:fixed.actualExit,signatureVerified:data.signatureVerified,authorized:false,PUBLICFrozenVector:true,newKeysGenerated:false,narrowSDKRootPermission:true});
 }catch(e){firstCause=e.code??e.message??'R227_CI_FAILED';}
 save('RESULT.json',{success:firstCause===null,firstCause,noAutomaticRetry:true,oldFullPinned28_63FailureResolved:false,normalGoServer:false,SQLMigration:false,Source13:false,Root:false,Native:false,production:false,realUserLogin:false});if(firstCause)fail(firstCause);
}
await main();
