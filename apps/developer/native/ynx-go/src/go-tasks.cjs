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
 async function configure() {
  if(active || configuring)throw Error(t('A Go operation is already running. Cancel it before configuring.'));
  configuring=true; const abort=new AbortController(); configurationAbort=abort;
  const pickerCancellation=new api.CancellationTokenSource(); const stopPicker=()=>pickerCancellation.cancel(); abort.signal.addEventListener('abort',stopPicker,{once:true});
  try {
   const binding=await project();
   const toolchain=await admittedToolchain(environment);await binding.verify();abort.signal.throwIfAborted();
   const chosen=await waitForSignal(()=>api.window.showQuickPick([{label:toolchain.version,description:toolchain.root,toolchain}],{title:t('Choose the installed Go toolchain'),placeHolder:t('Local compilation and running; language service and debugging are separate.')},pickerCancellation.token),abort.signal);
   if(!chosen)return;abort.signal.throwIfAborted();
   await binding.verify();await verifyToolchain(toolchain,environment);
   const editor=api.window.activeTextEditor?.document;
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
   const config={toolchain,target,mode};await binding.verify();abort.signal.throwIfAborted();
   await settings(binding).update('project',config,api.ConfigurationTarget.WorkspaceFolder);await binding.verify();abort.signal.throwIfAborted();
   await cacheDirectories(binding,true);
   await api.window.showInformationMessage(t('Go project configured. Run Go Project builds and runs this package with local dependencies only. Cgo, language services and debugging are not configured by this command.'));
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
  build.group=api.TaskGroup.Build;build.presentationOptions={reveal:api.TaskRevealKind.Always,panel:api.TaskPanelKind.Dedicated,clear:true};
  const run=new api.Task(definition('run'),binding.folder,t('Run Go package'),'YNX Go',new api.ProcessExecution(output,[],{cwd,env}),[]);
  run.presentationOptions={reveal:api.TaskRevealKind.Always,panel:api.TaskPanelKind.Dedicated,clear:true};
  await binding.verify();return {build,run,output,cwd};
 }
 function execute(task,operation) {
  return new Promise((resolve,reject)=>{
   let done=false,execution;const matches=event=>event.execution.task.definition.runId===task.definition.runId && event.execution.task.definition.stage===task.definition.stage;
   const finish=(error,code)=>{if(done)return;done=true;processEnd.dispose();taskEnd.dispose();if(operation.execution===execution)operation.execution=undefined;error?reject(error):resolve(code);};
   const processEnd=api.tasks.onDidEndTaskProcess(event=>{if(matches(event))finish(undefined,event.exitCode);});
   const taskEnd=api.tasks.onDidEndTask(event=>{if(matches(event))finish(undefined,undefined);});
   Promise.resolve().then(()=>api.tasks.executeTask(task)).then(value=>{execution=value;if(done)return;operation.execution=value;if(operation.cancelled)value.terminate();},error=>finish(error));
  });
 }
 async function run() {
  if(active || configuring)throw Error(t('A Go operation is already running. Cancel it before running again.'));
  let binding=await project(),config=readConfiguration(binding);
  if(!config) {config=await configure();if(!config)return;binding=await project();}
  const operation={cancelled:false};active=operation;
  try {
   const prepared=await tasks(binding,config);
   if(operation.cancelled)return {cancelled:true};
   // Saving uses the normal editor API; no task silently ignores unsaved code.
   for(const document of api.workspace.textDocuments) {
    const relative=path.relative(binding.root,document.uri.fsPath||'');
    if(document.uri.scheme==='file' && document.uri.fsPath.endsWith('.go') && relative && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative) && document.isDirty && !await document.save())throw Error(t('Save the Go sources before running.'));
   }
   await binding.verify();if(operation.cancelled)return {cancelled:true};
   const buildExit=await execute(prepared.build,operation);await binding.verify();
   if(operation.cancelled)return {cancelled:true};
   if(buildExit===undefined)return {unknown:true};
   if(buildExit!==0)throw Error(t('Go build failed. Read the task terminal diagnostics, fix the sources or provide local dependencies, and run again.'));
   const stat=await fs.lstat(prepared.output);const header=await fs.open(prepared.output,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);let magic;try{const bytes=Buffer.alloc(4);await header.read(bytes,0,4,0);magic=bytes.toString('hex');}finally{await header.close();}
   if(!stat.isFile() || stat.isSymbolicLink() || !(stat.mode&0o111) || !['cffaedfe','feedfacf','7f454c46'].includes(magic) && !magic.startsWith('4d5a'))throw Error(t('This Go package is a library, not a runnable main package. The build completed; no program was executed.'));
   if(operation.cancelled)return {cancelled:true};
   const exitCode=await execute(prepared.run,operation);await binding.verify();
   return operation.cancelled ? {cancelled:true} : exitCode===undefined ? {unknown:true} : {exitCode};
  } finally {if(active===operation)active=undefined;}
 }
 const lifetime={configure,run,cancel(){if(configurationAbort){configurationAbort.abort();return true;}if(!active)return false;active.cancelled=true;active.execution?.terminate();return true;},dispose(){disposed=true;lifetime.cancel();},status:()=>({running:!!active,configuring})};
 if(api.workspace.onDidChangeWorkspaceFolders)context.subscriptions.push(api.workspace.onDidChangeWorkspaceFolders(()=>lifetime.cancel()));
 context.subscriptions.push(api.tasks.registerTaskProvider('ynx-go',{async provideTasks(){const binding=await project(),config=readConfiguration(binding);if(!config)return [];const prepared=await tasks(binding,config,randomUUID(),false);return [prepared.build];},async resolveTask(){return undefined;}}),lifetime);
 return lifetime;
}
function waitForSignal(start,signal) {
 signal.throwIfAborted();return new Promise((resolve,reject)=>{const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});Promise.resolve().then(()=>{signal.throwIfAborted();return start();}).then(value=>{signal.removeEventListener('abort',stop);signal.aborted?reject(signal.reason):resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});});
}
module.exports={createGoTasks,validTarget};
