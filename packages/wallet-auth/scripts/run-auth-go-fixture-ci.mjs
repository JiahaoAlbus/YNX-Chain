// Official CI-only PUBLIC Go fixture. Never a normal Source server, Go module,
// SQL migration, Native build, key operation, or user authorization.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
import {prepareAuthGoFixtureCIData} from './auth-go-fixture-ci.mjs';
import {stageR209CatalogDelta} from '../../../scripts/ci/auth-r209-catalog-supply.mjs';
import {stageR210SourceCompletionDelta} from '../../../scripts/ci/auth-r210-source-completion-supply.mjs';
import {stageR213PublisherCurrentDelta} from '../../../scripts/ci/auth-r213-publisher-current-supply.mjs';
import {stageR214PublisherCaptureDelta} from '../../../scripts/ci/auth-r214-publisher-capture-supply.mjs';
import {stageR215PublisherCatalogDelta} from '../../../scripts/ci/auth-r215-publisher-catalog-supply.mjs';
const pkg=fileURLToPath(new URL('../',import.meta.url)),fixture=path.join(pkg,'test/fixtures/auth-r202-go-source'),evidence=path.join(pkg,'.ci-evidence/auth-r202-go-fixture');
const supplierPin={path:'SUPPLIER_HANDOFF.json',bytes:14261,sha256:'5115dbbe571e31a5e21a7af2868ffe012e26457cbb8a26d52d3bd0ca9856e72f'};
const groups={"A":{"names":["TestOriginalPublisherCatalogActualACLTransactionActivationAndRevoke","TestOriginalPublisherCatalogOriginalACLFailureCannotRevokeOrActivate","TestOriginalPublisherCatalogLateCurrentAndCompletionRefusalRollbackBoth","TestOriginalPublisherCatalogLostCommitReceiptRetainsUnknownNoManualRollback","TestOriginalPublisherCatalogRejectsUnownedTransactionTokenBeforeSQL"],"top":5,"sub":2,"pass":7},"B":{"names":["TestOriginalPublisherCatalogRequiresOwnedParticipantAndOriginalPool","TestOriginalPublisherCatalogRejectsChangedCaptureInsideActualTransaction","TestOriginalPublisherCatalogRegistryResponsePanicRollsBackBoth","TestOriginalPublisherCatalogSameTokenAndCommandCannotDoubleActivate","TestOriginalPublisherCatalogInflightCaptureRefusedBeforeReceiptReadOrStoreWait"],"top":5,"sub":4,"pass":9}};
const groupName=process.env.YNX_R215_CI_GROUP,group=groups[groupName];if(!group)throw Error('AUTH_GO_CI_GROUP_REQUIRED');
const selection='^('+group.names.join('|')+')$';
const fail=code=>{throw Object.assign(Error(code),{code});},hash=raw=>createHash('sha256').update(raw).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,data)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
function relative(p){if(typeof p!=='string'||path.isAbsolute(p)||p.includes('\\')||p.split('/').some(x=>!x||x==='.'||x==='..'))fail('AUTH_GO_CI_PATH');return p;}
function pinned(root,p){const file=path.join(root,relative(p.path)),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size!==p.bytes)fail('AUTH_GO_CI_PIN');const b=fs.readFileSync(file);if(hash(b)!==p.sha256)fail('AUTH_GO_CI_PIN');return b;}
function tree(root){const files=[];function visit(dir){for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p);if(s.isSymbolicLink())fail('AUTH_GO_CI_SYMLINK');if(s.isDirectory())visit(p);else{if(!s.isFile())fail('AUTH_GO_CI_NOT_REGULAR');files.push(path.relative(root,p).split(path.sep).join('/'));if(files.length>32)fail('AUTH_GO_CI_SCOPE');}}}visit(root);return files.sort();}
function checkSupply(){
 const raw=pinned(fixture,supplierPin),h=JSON.parse(raw),pins=JSON.parse(fs.readFileSync(path.join(fixture,'PINS.json'),'utf8'));
 if(h.state!=='FULL_AUTH_SUPPLIER_GO_PUBLIC_CI_SOURCE_CLOSURE_NOT_NORMAL_SERVER'||h.goFiles!==27||h.publicJSON!==2||h.refs.length!==30||JSON.stringify(pins.supplierHandoff)!==JSON.stringify(supplierPin)||pins.PUBLIC!==true||pins.Source13!==false||pins.Root!==false||pins.production!==false)fail('AUTH_GO_CI_SUPPLY');
 const files=h.refs.map(({relative,bytes,sha256})=>({path:relative,bytes,sha256}));if(JSON.stringify(pins.files)!==JSON.stringify(files))fail('AUTH_GO_CI_SUPPLY');
 const actual=tree(fixture),expected=['PINS.json','SUPPLIER_HANDOFF.json',...files.map(x=>'source/'+relative(x.path))].sort();if(JSON.stringify(actual)!==JSON.stringify(expected))fail('AUTH_GO_CI_EXTRA_OR_MISSING');
 for(const p of files)pinned(path.join(fixture,'source'),p);return files;
}
function findGo(){
 for(const part of (process.env.PATH??'').split(path.delimiter)){if(!path.isAbsolute(part))continue;const p=path.join(part,'go');try{fs.accessSync(p,fs.constants.X_OK);}catch{continue;}const real=fs.realpathSync(p),s=fs.lstatSync(real);if(!s.isFile()||s.isSymbolicLink())fail('AUTH_GO_CI_TOOL');return real;}fail('AUTH_GO_CI_TOOL_MISSING');
}
function groupAlive(pid){try{process.kill(-pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function joinGroup(pid){
 if(!groupAlive(pid))return {wasNonempty:false,empty:true};
 const signal=s=>{try{process.kill(-pid,s);}catch(e){if(e.code!=='ESRCH')throw e;}};signal('SIGTERM');for(let i=0;i<25&&groupAlive(pid);i++)await sleep(20);
 if(groupAlive(pid))signal('SIGKILL');for(let i=0;i<100&&groupAlive(pid);i++)await sleep(20);return {wasNonempty:true,empty:!groupAlive(pid)};
}
async function stage(name,tool,argv,cwd,wallMS){
 const out=fs.openSync(path.join(evidence,name+'.stdout'),'wx',0o600),err=fs.openSync(path.join(evidence,name+'.stderr'),'wx',0o600),began=Date.now();let child,timer,killTimer,cause=null,total=0,start,closed,completed=false;
 const abort=code=>{if(!cause)cause=code;if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}killTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}},500);}};
 const onTERM=()=>abort('AUTH_GO_CI_CANCELLED'),onINT=()=>abort('AUTH_GO_CI_CANCELLED');process.once('SIGTERM',onTERM);process.once('SIGINT',onINT);
 try{
  child=spawn(tool,argv,{cwd,env:{...process.env,GOTOOLCHAIN:'local',GOWORK:'off',GO111MODULE:'off'},detached:true,stdio:['ignore','pipe','pipe']});
  closed=new Promise(resolve=>{child.once('error',e=>{cause??=e.code??'AUTH_GO_CI_SPAWN';});child.once('close',(actualExit,signal)=>resolve({actualExit,signal}));});
  let identity=null;try{const raw=fs.readFileSync('/proc/'+child.pid+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);identity={pid:child.pid,processGroup:Number(fields[2]),kernelStartTicks:fields[19]};if(identity.processGroup!==child.pid||!/^\d+$/.test(identity.kernelStartTicks))fail('AUTH_GO_CI_PID_START');}catch(e){abort(e.code??'AUTH_GO_CI_PID_START');}
  start={stage:name,tool,argv,cwd,pid:child.pid??null,identity,at:new Date(began).toISOString(),environment:{GOTOOLCHAIN:'local',GOWORK:'off',GO111MODULE:'off'},wallMS};save(name+'_START.json',start);
  for(const [stream,fd]of [[child.stdout,out],[child.stderr,err]])stream.on('data',b=>{total+=b.length;if(total>10485760){abort('AUTH_GO_CI_LOG_CAP');return;}try{fs.writeSync(fd,b);}catch{abort('AUTH_GO_CI_LOG_WRITE_FAILED');}});
  timer=setTimeout(()=>abort('AUTH_GO_CI_WALL_TIMEOUT'),wallMS);
  const exit=await closed;
  clearTimeout(timer);clearTimeout(killTimer);const joined=child.pid?await joinGroup(child.pid):{wasNonempty:false,empty:false};
  // A Go exit 0 with a remaining descendant is a failure even if cleanup later
  // succeeds. It never becomes a passing result by killing the leftover group.
  if(joined.wasNonempty)cause??='AUTH_GO_CI_OWNED_GROUP_NOT_EMPTY';if(!joined.empty)cause??='AUTH_GO_CI_GROUP_JOIN_FAILED';
  completed=true;const terminal={...start,end:new Date().toISOString(),elapsedMS:Date.now()-began,...exit,firstCause:cause,ownedGroupJoined:joined,success:exit.actualExit===0&&exit.signal===null&&cause===null&&joined.empty};save(name+'_TERMINAL.json',terminal);return terminal;
 }finally{
  if(child?.pid&&!completed){abort('AUTH_GO_CI_STAGE_INTERRUPTED');await closed;await joinGroup(child.pid);}
  clearTimeout(timer);clearTimeout(killTimer);process.removeListener('SIGTERM',onTERM);process.removeListener('SIGINT',onINT);fs.closeSync(out);fs.closeSync(err);
 }
}
async function main(){
 if(process.argv.length!==2||process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Linux'||!/^\d+$/.test(process.env.GITHUB_RUN_ID??'')||!process.env.GITHUB_JOB)fail('AUTH_GO_CI_LINUX_ACTIONS_REQUIRED');
 if((process.env.GOFLAGS??'')!=='')fail('AUTH_GO_CI_UNEXPECTED_GOFLAGS');
 fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.mkdirSync(evidence,{mode:0o700});let firstCause=null,goTest=null,version=null;
 try{
  const files=checkSupply();save('SUPPLIER_VERIFIED.json',{supplierPin,files,PUBLIC:true,Source13:false,Root:false,production:false});
  const go=findGo(),versionTerm=await stage('GO_VERSION',go,['version'],pkg,5000);if(!versionTerm.success)fail(versionTerm.firstCause??'AUTH_GO_CI_TOOL_VERSION_FAILED');version=fs.readFileSync(path.join(evidence,'GO_VERSION.stdout'),'utf8').trim();const arch=process.arch==='x64'?'amd64':process.arch;
  if(version!=='go version go1.25.13 linux/'+arch)fail('AUTH_GO_CI_TOOL_VERSION_MISMATCH');save('GO_TOOL.json',{actualTool:go,version,architecture:process.arch,versionTerminal:versionTerm,PATHSource:'official CI setup-go PATH; no downloaded/replaced tool by this runner'});
  const scratch=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-auth-r202-go-CI-'))),outputRoot=path.join(scratch,'prepared'),prepared=prepareAuthGoFixtureCIData({fixtureRoot:path.join(fixture,'source'),files,nodeExecutable:fs.realpathSync(process.execPath),outputRoot});save('PREPARE_RECEIPT.json',prepared);save('R209_DELTA_RECEIPT.json',stageR209CatalogDelta({preparedRoot:outputRoot}));save('R210_DELTA_RECEIPT.json',stageR210SourceCompletionDelta({preparedRoot:outputRoot}));save('R213_DELTA_RECEIPT.json',stageR213PublisherCurrentDelta({preparedRoot:outputRoot}));save('R214_DELTA_RECEIPT.json',stageR214PublisherCaptureDelta({preparedRoot:outputRoot}));save('R215_DELTA_RECEIPT.json',stageR215PublisherCatalogDelta({preparedRoot:outputRoot}));
  const prefix='internal/developerauthority/',names=files.filter(x=>x.path.startsWith(prefix)&&x.path.endsWith('.go')).map(x=>x.path.slice(prefix.length)).concat(['original_catalog_authority.go','original_catalog_authority_test.go','original_source_post_completion_test.go','original_publisher_current.go','original_publisher_current_test.go','original_publisher_capture_store.go','original_publisher_capture_store_test.go','original_publisher_catalog_transaction.go','original_publisher_transaction_row.go','original_publisher_catalog_transaction_test.go']).sort();if(names.length!==37||names.some(n=>n.includes('/')))fail('AUTH_GO_CI_GO_SCOPE');
  goTest=await stage('GO_TEST',go,['test','-race','-json','-run',selection,'-count=1',...names],path.join(outputRoot,prefix),120000);if(!goTest.success)fail(goTest.firstCause??'AUTH_GO_CI_GO_TEST_FAILED');
  const events=fs.readFileSync(path.join(evidence,'GO_TEST.stdout'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),passes=events.filter(x=>x.Action==='pass'&&typeof x.Test==='string').map(x=>x.Test),top=passes.filter(n=>!n.includes('/'));
  if(events.some(x=>x.Action==='fail'||x.Action==='skip')||new Set(passes).size!==group.pass||passes.length!==group.pass||top.length!==group.top||top.some(n=>!new RegExp(selection).test(n))||events.filter(x=>x.Action==='pass'&&!x.Test).length!==1)fail('AUTH_GO_CI_SELECTED_TEST_COUNT');
  save('SELECTED_TEST_RESULTS.json',{top,group:groupName,topCount:group.top,subtests:group.sub,pass:group.pass,race:true,selectedOnly:selection,actualTool:go,version,priorR202GreenGroupsRerun:false,priorCatalogCasesRerun:false,priorPostWatermarkCasesRerun:false,priorPublisherCurrentCasesRerun:false,priorCaptureCasesRerun:false,migrationApplied:false,originalRawAndUnknownPreserved:true,Source13:false,Root:false});
 }catch(e){firstCause=e.code??e.message??'AUTH_GO_CI_FAILED';}
 save('RESULT.json',{success:firstCause===null,firstCause,version,GoTest:goTest,normalGoServer:false,SQLMigration:false,Source13:false,Root:false,Native:false,production:false,realUserLogin:false,realSessionRecovery:false,realRevocation:false,noAutomaticRetry:true});
 if(firstCause)fail(firstCause);
}
await main();
