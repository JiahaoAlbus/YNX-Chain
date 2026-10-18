'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {admittedToolchain,verifyToolchain,privateDirectory}=require('./go-toolchain.cjs');
const validTarget=value=>typeof value==='string' && value.length<=240 && !/[\\:\u0000-\u001f\u007f]/.test(value) && (value==='.' || !value.split('/').some(part=>!part || part==='.' || part==='..') && !value.startsWith('/'));
function createGoTasks(api,context,environment,t=text=>text) {
 let active,disposed=false,configuring=false,configurationAbort;
 async function project() {
  const root=environment.YNX_LOCAL_WORKSPACE,id=environment.YNX_LOCAL_PROJECT_ID,folder=api.workspace.workspaceFolders?.[0];
  if(disposed || environment.YNX_WORKSPACE_MODE!=='local' || !root || !/^[a-f0-9-]{36}$/.test(id||'') || environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE || !api.workspace.isTrusted || api.workspace.workspaceFolders?.length!==1 || folder?.uri.scheme!=='file' || await fs.realpath(root)!==root || await fs.realpath(folder.uri.fsPath)!==root)throw Error(t('Open one trusted local Go project.'));
  const stat=await fs.lstat(root),binding={root,id,folder,dev:stat.dev,ino:stat.ino};
  binding.verify=async()=>{
   const current=await fs.lstat(root);
   if(disposed || environment.YNX_LOCAL_WORKSPACE!==root || environment.YNX_LOCAL_PROJECT_ID!==id || environment.YNX_WORKSPACE_MODE!=='local' || environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE || !api.workspace.isTrusted || api.workspace.workspaceFolders?.length!==1 || api.workspace.workspaceFolders[0]!==folder || await fs.realpath(root)!==root || current.dev!==stat.dev || current.ino!==stat.ino)throw Error(t('The Go project changed. Configure or run it again.'));
  };
  return binding;
 }
 const settings=binding=>api.workspace.getConfiguration('ynx.go',binding.folder.uri);
 function readConfiguration(binding) {
  const value=settings(binding).inspect('project')?.workspaceFolderValue;
  if(value===undefined)return;
  if(!value || Object.keys(value).sort().join()!=='mode,target,toolchain' || !validTarget(value.target) || !['module','package'].includes(value.mode))throw Error(t('The Go project configuration is invalid. Configure Go for this project again.'));
  return value;
 }
 async function configure(request,binding) {
  if(active && active!==request || configuring)throw Error(t('A Go operation is already running. Cancel it before configuring.'));
  configuring=true; const abort=new AbortController(); configurationAbort=abort;
  const pickerCancellation=new api.CancellationTokenSource(); const stopPicker=()=>pickerCancellation.cancel(); abort.signal.addEventListener('abort',stopPicker,{once:true});
  try {
   binding=binding||await project();
   const verify=async()=>{await binding.verify();abort.signal.throwIfAborted();if(request)await request.verify();};
   await verify();
   let toolchain;
   try {toolchain=await admittedToolchain(environment);}
   catch(error) {
    if(error.code!=='YNX_GO_SELECTION_REQUIRED')throw error;
    // Use the existing native picker and parent admission channel. A selected
    // path cannot expand this running sandbox; the host explains normal reopen.
    await verify();
    await waitForSignal(()=>api.commands.executeCommand('ynx.workbench.selectGoToolchain'),abort.signal);
    await verify();return;
   }
   await verify();
   const chosen=await waitForSignal(()=>api.window.showQuickPick([{label:toolchain.version,description:toolchain.root,toolchain}],{title:t('Choose the installed Go toolchain'),placeHolder:t('Local compilation and running; language service and debugging are separate.')},pickerCancellation.token),abort.signal);
   if(!chosen)return;abort.signal.throwIfAborted();
   await verify();await verifyToolchain(toolchain,environment);await verify();
   const editor=request?.document||api.window.activeTextEditor?.document;
   if(!editor || editor.uri.scheme!=='file' || !editor.uri.fsPath.endsWith('.go'))throw Error(t('Open a Go source file inside this project to choose its package.'));
   const directory=path.dirname(editor.uri.fsPath),target=path.relative(binding.root,directory).split(path.sep).join('/')||'.';
   if(!validTarget(target) || await fs.realpath(editor.uri.fsPath)!==editor.uri.fsPath)throw Error(t('Select a regular Go file inside this project.'));
   // Every ancestor must be a real project directory. A folder setting does
   // not authorize following a link to another repository or toolchain.
   await targetDirectory(binding,target);
   let mode='package';
   for(let item=directory;;item=path.dirname(item)) {
    try {const stat=await fs.lstat(path.join(item,'go.mod'));if(!stat.isFile() || stat.isSymbolicLink())throw Error(t('go.mod must be a regular project file.'));mode='module';break;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(item===binding.root)break;
   }
   const config={toolchain,target,mode};await verify();
   await settings(binding).update('project',config,api.ConfigurationTarget.WorkspaceFolder);await verify();
   await cacheDirectories(binding,true);
   await verify();
   // A notification without actions may remain unresolved until dismissed.
   // It must not hold configuration ownership or delay the first Run.
   void Promise.resolve(api.window.showInformationMessage(t('Go project configured. Run Go Project builds and runs this package with local dependencies only. Cgo, language services and debugging are not configured by this command.'))).catch(()=>undefined);
   return config;
  } catch(error) {if(!abort.signal.aborted)throw error;}
  finally {abort.signal.removeEventListener('abort',stopPicker);pickerCancellation.dispose();if(configurationAbort===abort)configurationAbort=undefined;configuring=false;}
 }
 async function targetDirectory(binding,target) {
  if(!validTarget(target))throw Error(t('The Go package path is invalid.'));
  let current=binding.root;
  for(const part of target==='.'?[]:target.split('/')) {
   current=path.join(current,part);const stat=await fs.lstat(current);
   if(!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current)!==current)throw Error(t('The Go package path changed or uses a symbolic link.'));
  }
  await binding.verify();return current;
 }
 async function cacheDirectories(binding,create) {
  const base=path.join(binding.root,'.ynx-go'),dirs={};
  for(const [name,item] of [['base',base],...['build','cache','modules','gopath','tmp'].map(name=>[name,path.join(base,name)])]) {
   if(create)await privateDirectory(item,binding.root);
   else {const stat=await fs.lstat(item);if(!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || (stat.mode&0o777)!==0o700 || await fs.realpath(item)!==item)throw Error(t('Configure Go before enumerating its tasks. Existing cache paths were preserved.'));}
   dirs[name]=item;
  }
  await binding.verify();return dirs;
 }
 async function tasks(binding,config,runId=randomUUID(),prepare=true) {
  const toolchain=await verifyToolchain(config.toolchain,environment),cwd=await targetDirectory(binding,config.target);
  const dirs=await cacheDirectories(binding,prepare);
  const output=path.join(dirs.build,'program-'+runId);
  try {const stat=await fs.lstat(output);if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid())throw Error(t('The Go output path is not a regular project file. Existing content was preserved.'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const env={GOROOT:toolchain.root,GOPROXY:'off',GOSUMDB:'off',GOTOOLCHAIN:'local',GOENV:'off',GOWORK:'off',GOFLAGS:'',GOPATH:dirs.gopath,GOMODCACHE:dirs.modules,GOCACHE:dirs.cache,TMPDIR:dirs.tmp,CGO_ENABLED:'0',GO111MODULE:config.mode==='module'?'on':'off'};
  const definition=stage=>({type:'ynx-go',stage,runId,target:config.target});
  const build=new api.Task(definition('build'),binding.folder,t('Build Go package'),'YNX Go',new api.ProcessExecution(toolchain.executable,['build',...(config.mode==='module'?['-mod=readonly']:[]),'-o',output,'.'],{cwd,env}),['$ynx-go-compile']);
  // runId must stay unique for cancellation/event ownership. Dedicated panels
  // compare that ID and therefore allocate a new terminal on every retry.
  // Shared task panels reuse only idle task terminals, never a running task.
  build.group=api.TaskGroup.Build;build.presentationOptions={reveal:api.TaskRevealKind.Always,panel:api.TaskPanelKind.Shared,clear:true};
  const run=new api.Task(definition('run'),binding.folder,t('Run Go package'),'YNX Go',new api.ProcessExecution(output,[],{cwd,env}),[]);
  run.presentationOptions={reveal:api.TaskRevealKind.Always,panel:api.TaskPanelKind.Shared,clear:false};
  const testTask=new api.Task(definition('test'),binding.folder,t('Test Go package'),'YNX Go',new api.ProcessExecution(toolchain.executable,['test',...(config.mode==='module'?['-mod=readonly']:[]),'-count=1','-v','.'],{cwd,env}),['$ynx-go-compile']);
  testTask.group=api.TaskGroup.Test;testTask.presentationOptions={reveal:api.TaskRevealKind.Always,panel:api.TaskPanelKind.Shared,clear:true};
  await binding.verify();return {build,run,test:testTask,output,cwd};
 }

 async function execute(kind) {
  if(active || configuring)throw Error(t('A Go operation is already running. Cancel it before running again.'));
  // Claim the original request before the first asynchronous read. Configuration
  // and execution share this owner; callbacks cannot create a second Run.
  const operation={cancelled:false,preparing:true,document:api.window?.activeTextEditor?.document,cancelController:new AbortController(),savedSources:[]};
  operation.onCleanup=()=>{if(active===operation)active=undefined;};active=operation;
  try {
   const binding=await project();
   operation.verify=async()=>{
    await binding.verify();
    if(active!==operation || operation.cancelled || api.window?.activeTextEditor?.document!==operation.document)throw Error(t('The Go project changed. Configure or run it again.'));
    for(const saved of operation.savedSources)if(saved.document.isClosed || saved.document.isDirty || saved.document.version!==saved.version || saved.document.uri.scheme!=='file' || saved.document.uri.fsPath!==saved.path)throw Error(t('Save the Go sources before running.'));
   };
   if(operation.cancelled)return {cancelled:true};await operation.verify();
   let config=readConfiguration(binding);
   if(config) {
    try {await verifyToolchain(config.toolchain,environment);}
    catch(error) {
     // Persisted choices are not runtime admission. Recover only a typed stale
     // choice through the normal picker, retaining the original request owner.
     // Runtime metadata, permissions and unsafe binary failures remain errors.
     if(error.code!=='YNX_GO_CONFIGURATION_STALE')throw error;
     await operation.verify();config=undefined;
    }
   }
   if(!config){config=await configure(operation,binding);if(!config)return;}
   if(operation.cancelled)return {cancelled:true};await operation.verify();
   const prepared=await tasks(binding,config);
   if(operation.cancelled)return {cancelled:true};
   // The dirty flag is an asynchronous mirror. Cross the editor's normal save
   // RPC even when it still appears clean; no compiler may read an old disk copy.
   const documents=new Set([...(api.workspace.textDocuments||[]),operation.document]);
   for(const document of documents) {
    if(document?.uri?.scheme!=='file' || !document.uri.fsPath.endsWith('.go'))continue;
    const relative=path.relative(binding.root,document.uri.fsPath);
    if(!relative || relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative))continue;
    if(operation.cancelled)return {cancelled:true};await operation.verify();
    if(document.isClosed)throw Error(t('Save the Go sources before running.'));
    let saved;
    try {saved=await waitForSignal(()=>document.save(),operation.cancelController.signal);}
    catch(error){if(operation.cancelled)return {cancelled:true};throw error;}
    if(operation.cancelled)return {cancelled:true};await operation.verify();
    if(!saved || document.isClosed || document.isDirty)throw Error(t('Save the Go sources before running.'));
    operation.savedSources.push({document,path:document.uri.fsPath,version:document.version});
   }
   if(operation.cancelled)return {cancelled:true};await operation.verify();operation.preparing=false;
   // Tests compile their own test binary, including library packages. Reuse
   // the original operation owner and task lifecycle; never launch a main
   // program or bypass the first-use save/configuration checks to test.
   if(kind==='test') {
    const exitCode=await executeGoTask(api,prepared.test,operation);await binding.verify();
    return operation.cancelled ? {cancelled:true} : exitCode===undefined ? {unknown:true} : {exitCode};
   }
   const buildExit=await executeGoTask(api,prepared.build,operation);await binding.verify();
   if(operation.cancelled)return {cancelled:true};
   await operation.verify();
   if(buildExit===undefined)return {unknown:true};
   if(buildExit!==0)throw Error(t('Go build failed. Read the task terminal diagnostics, fix the sources or provide local dependencies, and run again.'));
   const stat=await fs.lstat(prepared.output);const header=await fs.open(prepared.output,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);let magic;try{const bytes=Buffer.alloc(4);await header.read(bytes,0,4,0);magic=bytes.toString('hex');}finally{await header.close();}
   if(!stat.isFile() || stat.isSymbolicLink() || !(stat.mode&0o111) || !['cffaedfe','feedfacf','7f454c46'].includes(magic) && !magic.startsWith('4d5a'))throw Error(t('This Go package is a library, not a runnable main package. The build completed; no program was executed.'));
   if(operation.cancelled)return {cancelled:true};
   // Executable inspection crosses asynchronous filesystem reads. Recheck the
   // original source/editor/project owner before admitting its program task.
   await operation.verify();
   const exitCode=await executeGoTask(api,prepared.run,operation);await binding.verify();
   return operation.cancelled ? {cancelled:true} : exitCode===undefined ? {unknown:true} : {exitCode};
  } finally {if(active===operation && !operation.cleanupPending)active=undefined;}
 }
 const lifetime={configure,run:()=>execute('run'),test:()=>execute('test'),cancel(){if(active){active.cancelled=true;active.cancelController.abort();}if(configurationAbort){configurationAbort.abort();return true;}if(!active)return false;active.execution?.terminate();return true;},dispose(){disposed=true;lifetime.cancel();},status:()=>({running:!!active,configuring})};
 if(api.workspace.onDidChangeWorkspaceFolders)context.subscriptions.push(api.workspace.onDidChangeWorkspaceFolders(()=>lifetime.cancel()));
 if(api.window?.onDidChangeActiveTextEditor)context.subscriptions.push(api.window.onDidChangeActiveTextEditor(editor=>{
  if(active?.preparing && editor?.document!==active.document){active.cancelled=true;active.cancelController.abort();configurationAbort?.abort();}
 }));
 context.subscriptions.push(api.tasks.registerTaskProvider('ynx-go',{async provideTasks(){const binding=await project(),config=readConfiguration(binding);if(!config)return [];const prepared=await tasks(binding,config,randomUUID(),false);return [prepared.build];},async resolveTask(){return undefined;}}),lifetime);
 return lifetime;
}
function waitForSignal(start,signal) {
 signal.throwIfAborted();return new Promise((resolve,reject)=>{const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});Promise.resolve().then(()=>{signal.throwIfAborted();return start();}).then(value=>{signal.removeEventListener('abort',stop);signal.aborted?reject(signal.reason):resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});});
}
function executeGoTask(api,task,operation) {
  return new Promise((resolve,reject)=>{
   let done=false,execution,terminationRequested=false,startListener;
   const matches=event=>event?.execution?.task?.definition?.runId===task.definition.runId && event.execution.task.definition.stage===task.definition.stage;
   const ownedExecution={task,terminate:()=>terminateOwned()};
   const cleanup=()=>{processEnd.dispose();taskEnd.dispose();startListener?.dispose();if(operation.execution===ownedExecution)operation.execution=undefined;};
   const finish=(error,code)=>{
    if(error && !operation.failure)operation.failure=error;
    if(done){
     if(error){operation.cleanupFailure ||= error;return;}
     if(operation.cleanupPending){operation.cleanupPending=false;cleanup();operation.onCleanup?.();}
     return;
    }
    done=true;
    if(error && execution){operation.cleanupPending=true;reject(error);terminateOwned();return;}
    cleanup();error?reject(error):resolve(code);
   };
   function terminateOwned(){
    if(!execution || terminationRequested)return;
    terminationRequested=true;
    try {Promise.resolve(execution.terminate()).catch(error=>finish(error));}
    catch(error){finish(error);}
   }
   const processEnd=api.tasks.onDidEndTaskProcess(event=>{if(matches(event))finish(undefined,event.exitCode);});
   const taskEnd=api.tasks.onDidEndTask(event=>{if(matches(event))finish(undefined,undefined);});
   // The framework start event can precede the executeTask RPC reply. Retain
   // this exact handle even if that reply fails; it is not proof of no process.
   startListener=api.tasks.onDidStartTask?.(event=>{
    if(done || !matches(event) || typeof event.execution.terminate!=='function')return;
    execution ||= event.execution;operation.execution=ownedExecution;
    if(operation.cancelled)terminateOwned();
   });
   Promise.resolve().then(()=>{if(operation.cancelled){finish(undefined,undefined);return;}return api.tasks.executeTask(task);}).then(value=>{
    if(done)return;
    if(!value || typeof value.terminate!=='function'){finish(Error('Go task did not return a live execution. Check its task terminal before retrying.'));return;}
    execution ||= value;operation.execution=ownedExecution;if(operation.cancelled)terminateOwned();
   }).catch(error=>finish(error));
  });
 }

module.exports={createGoTasks,validTarget,executeGoTask};
