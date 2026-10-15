import test from 'node:test';import assert from 'node:assert/strict';import {createRequire,registerHooks} from 'node:module';import {spawn} from 'node:child_process';import {once} from 'node:events';
await import('./python-terminal-test-fixture.mjs');window.location={href:'http://127.0.0.1:43119'};globalThis.UIEvent=class{};
const hook=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const r=createRequire(import.meta.url),{DebugSession}=r('@theia/debug/lib/browser/debug-session'),{DebugSessionManager}=r('@theia/debug/lib/browser/debug-session-manager');hook.deregister();
const {LocalJsDebugTerminalContribution}=r('../../ynx-workbench/lib/local-js-debug-terminal');
const config=()=>({type:'pwa-node',request:'launch',console:'integratedTerminal',runtimeExecutable:'/trusted/runtime/local-js-debug-launcher.sh',__ynxJsLaunch:'6b059717-80f9-4d94-83e7-af6cd017a063',env:{YNX_JS_DEBUG_LAUNCH:'6b059717-80f9-4d94-83e7-af6cd017a063',YNX_WORKSPACE_MODE:'local',YNX_LOCAL_PROJECT_ID:'f5bb5263-d725-4cc9-9813-1e6a52dc93f0',YNX_JS_DEBUG_CREDENTIAL:'f'.repeat(64)}});
function session(configuration=config(),folder='file:///project'){const value=new DebugSession();value.data={id:'session',options:{configuration,workspaceFolderUri:folder}};return value;}
function fixture(mode='local'){const manager=new DebugSessionManager(),contribution=new LocalJsDebugTerminalContribution({getContext:async()=>({mode,workspace:'/project'})},manager);contribution.initialize();return{manager,contribution};}
test('real manager creation adapts only current local Node session, native runInTerminal retains execution and live shell PID',async()=>{
 const {manager,contribution}=fixture(),value=session(),shell=spawn('/bin/bash',['--noprofile','--norc'],{stdio:['pipe','pipe','pipe']});let executed;
 try{const terminal={start:async()=>{},title:{label:'Native test'},processId:Promise.resolve(shell.pid),hasChildProcesses:async()=>false,executeCommand:async options=>{executed=options;shell.stdin.write('printf ORIGINAL_EXECUTED\\n\n');}};value.terminalServer={all:[terminal],newTerminal:async options=>{assert.deepEqual(options.env,{X:'preserved'});return terminal;},open:()=>{}};
 const original=value.runInTerminal;manager.onDidCreateDebugSessionEmitter.fire(value);assert.notEqual(value.runInTerminal,original);
 const args={kind:'integrated',title:'Native test',cwd:'/project',args:['node','main.js'],env:{X:'preserved'}};const result=await value.runInTerminal({arguments:args});assert.deepEqual(result,{shellProcessId:shell.pid});assert.equal(executed.args,args.args);assert.equal(executed.env,undefined);process.kill(shell.pid,0);
 manager.onDidDestroyDebugSessionEmitter.fire(value);assert.equal(value.runInTerminal,original);assert.equal(contribution.records.size,0);
 }finally{contribution.onStop();shell.stdin.end();await once(shell,'close');}
});
test('hosted or another workspace keeps native PID response; ordinary and nonmarked terminals remain untouched',async()=>{
 for(const [mode,folder] of [['hosted','file:///project'],['local','file:///another']]){const {manager,contribution}=fixture(mode),value=session(config(),folder);value.terminalServer={all:[{title:{label:'x'},processId:Promise.resolve(123),hasChildProcesses:async()=>false,executeCommand:async()=>{}}],open(){}};manager.onDidCreateDebugSessionEmitter.fire(value);assert.deepEqual(await value.runInTerminal({arguments:{kind:'integrated',title:'x',args:[]}}),{processId:123});contribution.onStop();}
 for(const changed of [{__ynxJsLaunch:undefined},{type:'debugpy'},{request:'attach'},{console:'externalTerminal'},{env:{}}]){const {manager,contribution}=fixture(),value=session({...config(),...changed}),original=value.runInTerminal;manager.onDidCreateDebugSessionEmitter.fire(value);assert.equal(value.runInTerminal,original);contribution.onStop();}
});
test('shutdown restores exact own descriptor and never overwrites another contribution',()=>{const {manager,contribution}=fixture(),value=session();const own=value.runInTerminal.bind(value);Object.defineProperty(value,'runInTerminal',{configurable:true,writable:true,value:own});manager.onDidCreateDebugSessionEmitter.fire(value);contribution.onStop();assert.equal(value.runInTerminal,own);contribution.onStop();const next=fixture(),other=session();next.manager.onDidCreateDebugSessionEmitter.fire(other);const replacement=()=>{};other.runInTerminal=replacement;next.contribution.onStop();assert.equal(other.runInTerminal,replacement);});
test('supervised noDebug terminal never supplies a shell PID for adapter liveness or termination',async()=>{
 const {manager,contribution}=fixture(),value=session({...config(),noDebug:true});
 let executed=false;value.terminalServer={newTerminal:async()=>({start:async()=>{},processId:Promise.resolve(321),executeCommand:async()=>{executed=true;}}),open(){}};
 manager.onDidCreateDebugSessionEmitter.fire(value);
 assert.deepEqual(await value.runInTerminal({arguments:{kind:'integrated',title:'run',args:[]}}),{});assert.equal(executed,true);contribution.onStop();
});

test('real PTY receives launch env without shell command, output or history exposure; stdin and owned close remain usable',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const pty=r('node-pty'),{ShellCommandBuilder}=r('@theia/process/lib/common/shell-command-builder'),builder=new ShellCommandBuilder();
 const root=mkdtempSync(join(tmpdir(),'ynx-js-private-terminal-')),history=join(root,'history'),target=join(root,'target.cjs');
 const secret='f'.repeat(64);writeFileSync(target,`if(process.env.YNX_JS_DEBUG_CREDENTIAL!==${JSON.stringify(secret)}||process.env.NODE_OPTIONS!=='--no-warnings'||process.env.USER_CHOICE!=='kept')process.exit(19);console.log('ENV_OK');require('readline').createInterface({input:process.stdin}).once('line',line=>{console.log('INPUT_'+line);process.exit(0)});`);
 const {manager,contribution}=fixture();const value=session();let processTerminal,output='',command,created=0,closed,backendClosed=0;
 const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(ok=>setTimeout(ok,10))}throw Error('PTY wait timed out')};
 try{
 value.terminalServer={newTerminal:async options=>{created++;processTerminal=pty.spawn('/bin/bash',['--noprofile','--norc','-i'],{cwd:root,env:{...process.env,...options.env,PS1:'QA> ',HISTFILE:history,HISTCONTROL:'',HISTSIZE:'100'},cols:120,rows:30});processTerminal.onData(data=>output+=data);closed=new Promise(ok=>processTerminal.onExit(ok));return{terminalId:1234,processId:Promise.resolve(processTerminal.pid),start:async()=>until(()=>output.includes('QA> ')),shellTerminalServer:{close:async id=>{assert.equal(id,1234);backendClosed++;processTerminal.kill('SIGHUP');}},executeCommand:async options=>{command=builder.buildCommand({executable:'/bin/bash'},options);processTerminal.write(command+'\n');}}},open(){},all:[{title:{label:'same'},hasChildProcesses:async()=>false}]};
 manager.onDidCreateDebugSessionEmitter.fire(value);
 const result=await value.runInTerminal({arguments:{kind:'integrated',title:'same',cwd:root,args:[process.execPath,target],env:{YNX_JS_DEBUG_CREDENTIAL:secret,NODE_OPTIONS:'--no-warnings',USER_CHOICE:'kept'}}});
 assert.deepEqual(result,{shellProcessId:processTerminal.pid});assert.equal(created,1);await until(()=>output.includes('ENV_OK'));processTerminal.write('works\n');await until(()=>output.includes('INPUT_works'));processTerminal.write('history -w\n');await until(()=>output.includes('QA> ',output.indexOf('INPUT_works')));await new Promise(ok=>setTimeout(ok,50));
 const stored=readFileSync(history,'utf8');for(const text of [command,output,stored]){assert.equal(text.includes(secret),false);assert.equal(text.includes('YNX_JS_DEBUG_CREDENTIAL'),false);assert.equal(text.includes('NODE_OPTIONS'),false)}
 manager.onDidDestroyDebugSessionEmitter.fire(value);await closed;assert.equal(backendClosed,1);assert.ok(output.includes('INPUT_works'));
 }finally{contribution.onStop();if(processTerminal){try{processTerminal.kill('SIGKILL')}catch{}await closed}rmSync(root,{recursive:true,force:true})}
});
test('destroy during terminal creation prevents start; destroy during start closes only owned shell without command',async()=>{
 for(const phase of ['create','start']){
 const {manager,contribution}=fixture(),value=session();let release,started=0,executed=0,disposed=0,closes=0;
 const gate=new Promise(ok=>release=ok);const terminal={terminalId:456,processId:Promise.resolve(123),dispose(){disposed++},start:async()=>{started++;if(phase==='start')await gate},executeCommand:async()=>{executed++},shellTerminalServer:{close:async id=>{assert.equal(id,456);closes++}}};
 value.terminalServer={newTerminal:async()=>{if(phase==='create')await gate;return terminal},open(){}};manager.onDidCreateDebugSessionEmitter.fire(value);
 const pending=value.runInTerminal({arguments:{kind:'integrated',args:[],env:{}}});await new Promise(ok=>setTimeout(ok,0));manager.onDidDestroyDebugSessionEmitter.fire(value);release();await assert.rejects(pending,/has ended/);assert.equal(executed,0);
 if(phase==='create'){assert.equal(started,0);assert.equal(disposed,1)}else assert.ok(closes>=1);contribution.onStop();
 }
});

test('actual Theia deferred process/channel exit drains output and retains owned widget until explicit close',()=>{
 const {TerminalWidgetImpl}=r('@theia/terminal/lib/browser/terminal-widget-impl');
 const {retainTerminalOutput}=r('../../ynx-workbench/lib/local-js-debug-terminal');
 function widget(){const value=Object.create(TerminalWidgetImpl.prototype);let disposed=0,finished=0,closeKey;const writes=[];Object.defineProperty(value,'isDisposed',{get:()=>disposed>0});value.term={textarea:{},write:(text,callback)=>writes.push(callback)};value.dispose=()=>disposed++;value.finishCurrentCommand=()=>finished++;value._commandHistoryState={currentCommand:'launcher target.js'};value.addKeyListener=(_element,_key,callback)=>closeKey=callback;return{value,writes,get disposed(){return disposed},get finished(){return finished},pressClose:()=>closeKey()}}
 // Negative control is the framework implementation that caused the native loss.
 const baseline=widget();baseline.value.connectionClosed=true;baseline.value.deferredFinalizeCommandHistory();baseline.writes.shift()();assert.equal(baseline.disposed,1);
 for(const alreadyClosed of [true,false]){const owned=widget();retainTerminalOutput(owned.value);owned.value.connectionClosed=alreadyClosed;owned.value.deferredFinalizeCommandHistory();if(!alreadyClosed){assert.equal(owned.value.waitingForConnectionCloseToDispose,true);owned.value.connectionClosed=true;owned.value.finalizeAndDispose()}
 assert.equal(owned.disposed,0);assert.equal(owned.finished,0);owned.writes.shift()();assert.equal(owned.finished,1);assert.equal(owned.disposed,0);assert.equal(owned.value.isAttachedCloseListener,true);owned.value.finalizeAndDispose();assert.equal(owned.writes.length,0);owned.pressClose();assert.equal(owned.disposed,1);
 }
});

const pendingDebug = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function selectedDebugTerminal(id) {
 const calls={start:0,execute:[],close:[],options:[]};
 const terminal={terminalId:id,isDisposed:false,processId:Promise.resolve(10000+id),start:async()=>{calls.start++;},executeCommand:async options=>{calls.execute.push(options);},dispose(){terminal.isDisposed=true;},shellTerminalServer:{close:async value=>{calls.close.push(value);}}};
 return {terminal,calls};
}
function selectedDebugSession(id,owned,open) {
 const configuration={...config(),name:'TEST_ONLY_selected_launch_'+id,program:'/project/'+id+'.js',cwd:'/project'};
 const value=session(configuration);value.data.id=id;
 value.terminalServer={newTerminal:async options=>{owned.calls.options.push(options);return owned.terminal;},open:open||(async()=>{})};
 return {value,configuration,request:{arguments:{kind:'integrated',title:configuration.name,cwd:configuration.cwd,args:['node',configuration.program],env:{TEST_ONLY:'preserved'}}}};
}
test('R37 destroyed session awaiting terminal open cannot execute after replacement starts',async()=>{
 const {manager,contribution}=fixture(),old=selectedDebugTerminal(701),fresh=selectedDebugTerminal(702),opening=pendingDebug(),entered=pendingDebug();
 const a=selectedDebugSession('old',old,()=>{entered.resolve();return opening.promise;}),b=selectedDebugSession('new',fresh);
 try {
  manager.onDidCreateDebugSessionEmitter.fire(a.value);const pending=a.value.runInTerminal(a.request);await entered.promise;
  manager.onDidDestroyDebugSessionEmitter.fire(a.value);manager.onDidCreateDebugSessionEmitter.fire(b.value);
  assert.deepEqual(await b.value.runInTerminal(b.request),{shellProcessId:10702});opening.resolve();await assert.rejects(pending,/has ended/);
  assert.equal(old.calls.execute.length,0);assert.deepEqual(old.calls.close,[701]);assert.equal(fresh.calls.execute.length,1);assert.deepEqual(fresh.calls.close,[]);
  assert.equal(contribution.records.has(a.value),false);assert.equal(contribution.records.has(b.value),true);assert.equal(b.value.configuration,b.configuration);
 }finally{contribution.onStop();}
});
test('R37 owner shutdown during selected launch open cannot dispatch a late command',async()=>{
 const {manager,contribution}=fixture(),owned=selectedDebugTerminal(703),opening=pendingDebug(),entered=pendingDebug();
 const current=selectedDebugSession('closing',owned,()=>{entered.resolve();return opening.promise;});
 manager.onDidCreateDebugSessionEmitter.fire(current.value);const pending=current.value.runInTerminal(current.request);await entered.promise;
 contribution.onStop();opening.resolve();await assert.rejects(pending,/has ended/);assert.equal(owned.calls.execute.length,0);assert.deepEqual(owned.calls.close,[703]);
});
test('R37 selected terminal disposed during open cannot execute or return a live PID',async()=>{
 const {manager,contribution}=fixture(),owned=selectedDebugTerminal(704),opening=pendingDebug(),entered=pendingDebug();
 const current=selectedDebugSession('disposed',owned,()=>{entered.resolve();return opening.promise;});
 try {manager.onDidCreateDebugSessionEmitter.fire(current.value);const pending=current.value.runInTerminal(current.request);await entered.promise;
  owned.terminal.dispose();opening.resolve();await assert.rejects(pending,/has ended/);assert.equal(owned.calls.execute.length,0);assert.deepEqual(owned.calls.close,[704]);
 }finally{contribution.onStop();}
});
test('R37 current selected launch preserves configuration cwd, original terminal execution and exact cleanup',async()=>{
 const {manager,contribution}=fixture(),owned=selectedDebugTerminal(705),current=selectedDebugSession('selected',owned);
 try {manager.onDidCreateDebugSessionEmitter.fire(current.value);assert.deepEqual(await current.value.runInTerminal(current.request),{shellProcessId:10705});
  assert.equal(current.value.configuration,current.configuration);assert.equal(current.configuration.cwd,'/project');assert.equal(owned.calls.options[0].cwd,'/project');assert.deepEqual(owned.calls.options[0].env,current.request.arguments.env);
  assert.equal(owned.calls.start,1);assert.equal(owned.calls.execute.length,1);assert.equal(owned.calls.execute[0].args,current.request.arguments.args);assert.equal(owned.calls.execute[0].cwd,'/project');assert.equal(owned.calls.execute[0].env,undefined);
  manager.onDidDestroyDebugSessionEmitter.fire(current.value);await Promise.resolve();await Promise.resolve();assert.deepEqual(owned.calls.close,[705]);assert.equal(contribution.records.size,0);
 }finally{contribution.onStop();}
});
test('R37 late context admission remains retired without creating terminal or replacing current session',async()=>{
 const {manager,contribution}=fixture(),context=pendingDebug(),entered=pendingDebug(),old=selectedDebugTerminal(706),fresh=selectedDebugTerminal(707);
 let queries=0;contribution.context.getContext=()=>++queries===1?(entered.resolve(),context.promise):Promise.resolve({mode:'local',workspace:'/project'});
 const a=selectedDebugSession('admission-old',old),b=selectedDebugSession('admission-new',fresh);
 try {manager.onDidCreateDebugSessionEmitter.fire(a.value);const pending=a.value.runInTerminal(a.request);await entered.promise;
  manager.onDidDestroyDebugSessionEmitter.fire(a.value);manager.onDidCreateDebugSessionEmitter.fire(b.value);assert.deepEqual(await b.value.runInTerminal(b.request),{shellProcessId:10707});
  context.resolve({mode:'local',workspace:'/project'});await assert.rejects(pending,/has ended/);assert.equal(old.calls.options.length,0);assert.equal(fresh.calls.execute.length,1);assert.equal(contribution.records.has(b.value),true);
 }finally{contribution.onStop();}
});

test('R37 newly disposed terminal returned from creation cannot start',async()=>{
 const {manager,contribution}=fixture(),owned=selectedDebugTerminal(708),current=selectedDebugSession('create-closed',owned);
 owned.terminal.dispose();
 try {manager.onDidCreateDebugSessionEmitter.fire(current.value);await assert.rejects(current.value.runInTerminal(current.request),/has ended/);assert.equal(owned.calls.start,0);assert.equal(owned.calls.execute.length,0);
 }finally{contribution.onStop();}
});
test('R37 terminal closes during start cannot enter later open or execute',async()=>{
 const {manager,contribution}=fixture(),owned=selectedDebugTerminal(709),starting=pendingDebug(),entered=pendingDebug();let opens=0;
 owned.terminal.start=async()=>{owned.calls.start++;entered.resolve();await starting.promise;};
 const current=selectedDebugSession('start-closed',owned,async()=>{opens++;});
 try {manager.onDidCreateDebugSessionEmitter.fire(current.value);const pending=current.value.runInTerminal(current.request);await entered.promise;owned.terminal.dispose();starting.resolve();await assert.rejects(pending,/has ended/);assert.equal(opens,0);assert.equal(owned.calls.execute.length,0);assert.deepEqual(owned.calls.close,[709]);
 }finally{contribution.onStop();}
});
test('R37 closed terminal waiting for PID cannot report a successful live shell',async()=>{
 const {manager,contribution}=fixture(),owned=selectedDebugTerminal(710),pid=pendingDebug(),entered=pendingDebug();
 Object.defineProperty(owned.terminal,'processId',{get(){entered.resolve();return pid.promise;}});
 const current=selectedDebugSession('pid-closed',owned);
 try {manager.onDidCreateDebugSessionEmitter.fire(current.value);const pending=current.value.runInTerminal(current.request);await entered.promise;owned.terminal.dispose();pid.resolve(10710);await assert.rejects(pending,/has ended/);assert.equal(owned.calls.execute.length,1);assert.deepEqual(owned.calls.close,[710]);
 }finally{contribution.onStop();}
});
