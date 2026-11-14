import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,registerHooks} from 'node:module';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {install}=require('../../ynx-workbench/lib/native-file-picker');
const URI=require('../node_modules/@theia/core/lib/common/uri').default;
const {UriAwareCommandHandler}=require('../node_modules/@theia/core/lib/common/uri-command-handler');
function fixture(native=true,WorkspaceRootUriAwareCommandHandler){
 const events=[],unexpectedFileCalls=[],handlers=new Map(),roots=[{resource:new URI('file:///project')}],listeners=new Set();
 const success=uri=>({created:true,uris:[uri],rootUri:'file:///project/'});
 let reply=success('file:///project/new.py'),picker;
 class OpenContribution{registerMenus(){}}
 class WorkspaceContribution{
  registerCommands(registry){
   const handler=this.newWorkspaceRootUriAwareCommandHandler({execute:()=>events.push('browser-new')});
   registry.registerCommand({id:'file.newFile'},handler);
   registry.registerCommand({id:'file.newFolder'},{execute:()=>events.push('browser-folder')});
  }
  newWorkspaceRootUriAwareCommandHandler(handler){
   if(WorkspaceRootUriAwareCommandHandler)return new WorkspaceRootUriAwareCommandHandler(this.workspaceService,this.selectionService,handler);
   return {execute:(uri=roots[0]?.resource)=>handler.execute(uri),isEnabled:()=>roots.length>0,isVisible:()=>true};
  }
  getDefaultFileConfig(){return {fileName:'Untitled',fileExtension:'.txt'};}
  fireCreateNewFile(value){events.push(['created-event',value.parent.toString(),value.uri.toString()]);}
  fireCreateNewFolder(value){events.push(['folder-event',value.parent.toString(),value.uri.toString()]);}
 }
 const target=native?{ynxDesktopFiles:{open:async options=>{events.push(['picker',options]);return picker?await picker():reply;}}}:{};
 install({Contribution:OpenContribution,WorkspaceContribution,URI,UriAwareCommandHandler,open:async(_,uri)=>events.push(['open',uri.toString()]),target,fileStatFromNative:(uri,stat,kind)=>({resource:uri,stat,kind}),commands:{NEW_FILE:{id:'file.newFile'},NEW_FOLDER:{id:'file.newFolder'}},localize:(_,text)=>text});
 const instance=new WorkspaceContribution();
 instance.workspaceService={tryGetRoots:()=>roots,onWorkspaceChanged:callback=>{listeners.add(callback);return {dispose:()=>listeners.delete(callback)};}};
 instance.selectionService={selection:undefined};
 const fileService={async resolve(uri){events.push('directory');return {resource:uri,isDirectory:true};}};
 instance.fileService=new Proxy(fileService,{get(target,name){
  if(Reflect.has(target,name))return Reflect.get(target,name);
  unexpectedFileCalls.push(name);assert.fail('Renderer must not perform a second file operation: '+String(name));
 }});
 instance.messageService={error:text=>events.push(['error',text])};
 instance.registerCommands({registerCommand:(command,handler)=>handlers.set(command.id,handler)});
 const run=async (selected,command)=>{const value=await handlers.get(command).execute(selected);assert.deepEqual(unexpectedFileCalls,[]);return value;};
 return {instance,roots,events,listeners,handlers,success,bridge:target.ynxDesktopFiles,run:(selected)=>run(selected,'file.newFile'),folder:(selected)=>run(selected,'file.newFolder'),resolve(handler){fileService.resolve=handler;},reply(value){reply=value;},picker(value){picker=value;},changed(){for(const callback of listeners)callback();}};
}
test('native Explorer New File reveals and opens a confirmed Python file without a renderer write',async()=>{
 const f=fixture();const uri=await f.run();
 assert.equal(uri.toString(),'file:///project/new.py');
 assert.deepEqual(f.events,['directory',['picker',{kind:'create',name:'Untitled.txt',directoryUri:'file:///project'}],['created-event','file:///project','file:///project/new.py'],['open','file:///project/new.py']]);
 assert.equal(f.listeners.size,0);
});
test('selected Explorer subdirectory starts native creation and opens a confirmed Go file there',async()=>{
 const f=fixture(),selected=new URI('file:///project/src');
 f.reply(f.success('file:///project/src/main.go'));
 await f.run(selected);
 assert.deepEqual(f.events,[
  'directory',['picker',{kind:'create',name:'Untitled.txt',directoryUri:'file:///project/src'}],
  ['created-event','file:///project/src','file:///project/src/main.go'],['open','file:///project/src/main.go']
 ]);
});
test('Explorer New Folder creates in its selected directory and emits the folder selection event, without opening an editor',async()=>{
 for(const parent of ['file:///project','file:///project/src']){
  const f=fixture();f.reply(f.success(parent+'/new%20dir/'));
  const uri=await f.folder(new URI(parent));
  assert.equal(uri.toString(),parent+'/new%20dir');
  assert.deepEqual(f.events,['directory',['picker',{kind:'create-folder',name:'Untitled',directoryUri:parent}],['folder-event',parent,parent+'/new%20dir']]);
 }
});
test('a folder response cannot select a different directory of the same project',async()=>{
 const f=fixture();f.reply(f.success('file:///project/elsewhere/new'));
 await f.folder(new URI('file:///project/src'));
 assert.equal(f.events.at(-1)[0],'error');
 assert.equal(f.events.some(e=>['folder-event','open'].includes(e[0])),false);
});
test('foreign, unresolved, or non-directory Explorer selections never open a picker',async()=>{
 for(const directory of [undefined,{resource:new URI('file:///outside'),isDirectory:true},{resource:new URI('file:///project/src.js'),isDirectory:false}]){
  const f=fixture();f.resolve(async()=>directory);await f.run(new URI('file:///project/src'));
  assert.deepEqual(f.events,[]);assert.equal(f.listeners.size,0);
 }
});
test('browser creation and original command availability are retained',async()=>{
 const f=fixture(false);await f.run();await f.handlers.get('file.newFolder').execute();
 assert.deepEqual(f.events,['browser-new','browser-folder']);
 assert.equal(f.handlers.get('file.newFile').isEnabled(),true);f.roots.length=0;assert.equal(f.handlers.get('file.newFile').isEnabled(),false);
});
test('native cancel performs no filesystem operation and permits a subsequent request',async()=>{
 const f=fixture();f.reply({cancelled:true});
 await f.run();assert.equal(f.events.filter(e=>e[0]==='error').length,0);
 f.reply({cancelled:true});await f.run();assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='picker').length,2);assert.equal(f.listeners.size,0);
});
test('foreign roots, non-file destinations or unconfirmed replies never reveal or open',async()=>{
 const good={created:true,rootUri:'file:///project'};
 for(const reply of [
  {...good,uris:['file:///project-other/new.py']},{...good,uris:['file:///project']},{...good,uris:['https://example.com/new.py']},
  {...good,uris:['file://foreign/project/new.py']},{...good,uris:['file:///project/new.py','file:///project/other.py']},
  {...good,uris:['file:///project/src/../new.py']},{...good,uris:['file:///project/new.py?query']},{...good,uris:['file:///project/new.py#fragment']},
  {...good,uris:[]},{...good,uris:['file:///project/new.py'],rootUri:'file:///different-project'},
  {...good,uris:['file:///project/new.py'],openedInNewWindow:true},{uris:['file:///project/new.py'],rootUri:'file:///project'},
  {created:true,uris:['file:///project/new.py']},null
 ]){
  const f=fixture();f.reply(reply);await f.run();
  assert.equal(f.events.some(e=>Array.isArray(e)&&['created-event','open'].includes(e[0])),false);assert.equal(f.listeners.size,0);
  assert.equal(f.events.includes('browser-new'),false);assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='picker').length,1);
  assert.equal(f.events.at(-1)[0],'error');
 }
});
test('workspace switch during directory lookup opens no picker',async()=>{
 for(const vanished of [false,true]){
  const f=fixture();
  f.resolve(async()=>{
   f.changed();
   if(vanished)throw Error('Old project no longer exists');
   return {resource:new URI('file:///project'),isDirectory:true};
  });
  await f.run();assert.deepEqual(f.events,[]);assert.equal(f.listeners.size,0);
 }
});
test('a project switch and switch back while native create is pending does not activate its confirmed file or folder',async()=>{
 for(const action of ['run','folder']){
  const f=fixture();let release;f.picker(()=>new Promise(resolve=>{release=resolve;}));const pending=f[action]();
  await new Promise(resolve=>setImmediate(resolve));
  const original=f.roots[0];f.roots[0]={resource:new URI('file:///another')};f.changed();f.roots[0]=original;f.changed();
  release(f.success('file:///project/new.py'));await pending;
  assert.equal(f.events.some(e=>Array.isArray(e)&&['created-event','folder-event','open'].includes(e[0])),false);
  assert.equal(f.listeners.size,0);
 }
});
test('native duplicate and permission failures surface once without notification or editor activation and allow retry',async()=>{
 for(const [action,message] of [['run','File already exists'],['folder','Folder already exists'],['run','Permission denied']]){
  const f=fixture();f.picker(async()=>{throw Error(message);});await f[action]();
  assert.deepEqual(f.events.at(-1),['error',message]);
  assert.equal(f.events.some(e=>Array.isArray(e)&&['created-event','folder-event','open'].includes(e[0])),false);
  f.picker(undefined);f.reply(f.success('file:///project/another'));await f[action]();
  assert.equal(f.events.at(-1)[0],action==='run'?'open':'folder-event');
 }
});
test('overlapping file and folder actions share one picker and cancel releases both for retry',async()=>{
 const f=fixture();let release;f.picker(()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.run();await new Promise(resolve=>setImmediate(resolve));await f.folder();await f.run();
 assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='picker').length,1);
 release({cancelled:true});await pending;
 f.picker(undefined);f.reply(f.success('file:///project/another'));await f.folder();
 assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='picker').length,2);
 assert.equal(f.events.at(-1)[0],'folder-event');
});
test('pending error notifications never retain the create operation or block retry',{timeout:1000},async()=>{
 const f=fixture();f.reply(null);f.instance.messageService.error=()=>new Promise(()=>{});await f.run();
 f.reply({cancelled:true});await f.run();assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='picker').length,2);assert.equal(f.listeners.size,0);
});

test('the original Explorer commands use the preferred bridge and the prepared URI, not the display name',async()=>{
 for(const [mode,kind,event] of [['run','create','created-event'],['folder','create-folder','folder-event']]){
  const f=fixture(),parent=new URI('file:///project/src');
  const token='d8ae0488-3d13-421f-bbef-21e49b78c502',chosen='file:///project/src/Chosen'+(mode==='run'?'.go':'');
  const stat={type:mode==='run'?1:2,ctime:1,mtime:1,size:0};
  Object.assign(f.bridge,{
   createProtocol:1,
   open:()=>assert.fail('Must not use legacy open for v1'),
   async prepareCreate(options){f.events.push(['prepare',options]);return {prepared:true,token,ttlMs:15000,uris:[chosen+(mode==='folder'?'/':'')],rootUri:'file:///project/'};},
   async commitCreate(confirmed){assert.equal(confirmed,token);f.events.push(['commit']);return {...f.success(chosen),stat};},
   cancelCreate:()=>assert.fail('Already confirmed commit must not clean up a consumed token'),
  });
  f.instance.fileService={resolve:f.instance.fileService.resolve,async createExplorerResource(uri,{current,commit}){
   f.events.push(['will',uri.toString()]);assert.ok(current());
   const result=await commit(uri);
   assert.deepEqual(result,{resource:uri,stat,kind});
   f.events.push(['did',uri.toString()]);
  }};
  assert.equal((await f[mode](parent)).toString(),chosen);
  assert.deepEqual(f.events,['directory',['prepare',{kind,name:mode==='run'?'Untitled.txt':'Untitled',directoryUri:parent.toString()}],
   ['will',chosen],['commit'],['did',chosen],[event,parent.toString(),chosen],...(mode==='run'?[['open',chosen]]:[])]);
 }
});

test('missing or inaccessible Explorer selections report an error without opening the parent picker',async()=>{
 for(const [action,path,message] of [
  ['run','deleted.py','File not found'],['folder','removed','File not found'],
  ['run','private.py','Permission denied'],['folder','private','Permission denied'],
 ]){
  const f=fixture(),selected=new URI('file:///project/'+path),reads=[];
  f.resolve(async uri=>{
   reads.push(uri.toString());
   if(uri.isEqual(selected))throw Error(message);
   return {resource:uri,isDirectory:true};
  });
  await f[action](selected);
  assert.deepEqual(reads,[selected.toString()]);
  assert.deepEqual(f.events,[['error',message]]);
  assert.equal(f.listeners.size,0);
 }
});

test('a confirmed file selection opens its directory and cancellation performs no creation',async()=>{
 const f=fixture(),file=new URI('file:///project/src/main.go'),dir=file.parent,reads=[];
 f.resolve(async uri=>{
  reads.push(uri.toString());
  return {resource:uri,isFile:uri.isEqual(file),isDirectory:uri.isEqual(dir)};
 });
 f.reply({cancelled:true});
 await f.run(file);
 assert.deepEqual(reads,[file.toString(),dir.toString()]);
 assert.deepEqual(f.events,[['picker',{kind:'create',name:'Untitled.txt',directoryUri:dir.toString()}]]);
 assert.equal(f.listeners.size,0);
});

test('Explorer shortcut, Refresh command and root reopen use the actual navigator model and disk files',async t=>{
 const css=registerHooks({load(url,context,next){
  return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);
 }});
 t.after(()=>css.deregister());
 await import('./python-terminal-test-fixture.mjs');
 window.location={href:'http://127.0.0.1:43119'};
 globalThis.UIEvent=class {};
 const {CommandRegistry}=require('@theia/core/lib/common/command');
 const {FileService}=require('@theia/filesystem/lib/browser/file-service');
 const {DiskFileSystemProvider}=require('@theia/filesystem/lib/node/disk-file-system-provider');
 const {FileNavigatorContribution}=require('@theia/navigator/lib/browser/navigator-contribution');
 const {FileNavigatorCommands}=require('@theia/navigator/lib/browser/file-navigator-commands');
 const {FileNavigatorModel}=require('@theia/navigator/lib/browser/navigator-model');
 const {FileNavigatorTree}=require('@theia/navigator/lib/browser/navigator-tree');
 const {FileNavigatorWidget,FILE_NAVIGATOR_ID}=require('@theia/navigator/lib/browser/navigator-widget');
 const {TreeExpansionServiceImpl}=require('@theia/core/lib/browser/tree/tree-expansion');
 const {WorkspaceRootUriAwareCommandHandler}=require('@theia/workspace/lib/browser/workspace-commands');
 const {WorkspaceService}=require('@theia/workspace/lib/browser/workspace-service');

 const scratch=await mkdtemp(join(process.env.YNX_EXPLORER_TEST_TMP || tmpdir(),'ynx-navigator-reopen-'));
 t.after(()=>rm(scratch,{recursive:true,force:true}));
 const root=new URI(pathToFileURL(scratch).href),src=root.resolve('source files');
 const python=root.resolve('main.py'),go=src.resolve('main.go');
 await mkdir(src.path.toString());
 const files=new FileService(),disk=new DiskFileSystemProvider();
 const provider=files.registerProvider('file',disk);
 t.after(()=>{provider.dispose();disk.dispose();});
 const tree=new FileNavigatorTree();
 tree.fileService=files;
 tree.filter={filter:children=>children};
 tree.messagingService={error:error=>assert.fail(error)};
 const model=new FileNavigatorModel();
 model.tree=tree;
 model.focusService={};
 model.selectionService={selectedNodes:[]};
 model.workspaceService={opened:true,workspace:await files.resolve(root),roots:[await files.resolve(root)]};
 const expansion=new TreeExpansionServiceImpl();
 expansion.tree=tree;
 expansion.init();
 model.expansionService=expansion;
 model.compressionToggle={compress:false};
 t.after(()=>{expansion.dispose();tree.dispose();});

 const navigator=new FileNavigatorContribution({},null,null,model.workspaceService,{});
 const widget=Object.create(FileNavigatorWidget.prototype,{id:{value:FILE_NAVIGATOR_ID},model:{value:model}});
 navigator.widgetManager={getOrCreateWidget:async()=>widget};
 const openings=[];
 navigator.openView=async options=>{openings.push(options);return widget;};
 const commands=new CommandRegistry();
 navigator.registerCommands(commands);
 const bindings=[];
 navigator.registerKeybindings({registerKeybinding:binding=>bindings.push(binding)});
 const binding=bindings.find(item=>item.keybinding==='ctrlcmd+shift+e');
 assert.equal(binding?.command,'fileNavigator:toggle');
 assert.equal(await commands.executeCommand(binding.command),widget);
 assert.deepEqual(openings,[{toggle:true,activate:true}]);

 await model.updateRoot();
 assert.equal((await model.revealFile(src)).expanded,true);
 assert.deepEqual([...model.getNodesByUri(python)],[]);
 assert.deepEqual([...model.getNodesByUri(go)],[]);

 // Simulate a watcher gap with real disk writes and no delivered events.
 const pyText='print("explorer reopen")\n',goText='package main\n';
 await writeFile(python.path.toString(),pyText);
 await writeFile(go.path.toString(),goText);
 await commands.executeCommand(FileNavigatorCommands.REFRESH_NAVIGATOR.id,widget);
 for(const uri of [python,go]){
  const nodes=[...model.getNodesByUri(uri)];
  assert.equal(nodes.length,1);
  assert.equal(nodes[0].uri.toString(),uri.toString());
 }

 model.workspaceService.opened=false;
 await model.updateRoot();
 assert.equal(model.root,undefined);
 assert.deepEqual([...model.getNodesByUri(python),...model.getNodesByUri(go)],[]);
 model.workspaceService.opened=true;
 model.workspaceService.roots=[await files.resolve(root)];
 await model.updateRoot();
 assert.equal((await model.revealFile(src)).expanded,true);
 for (const [uri,content] of [[python,pyText],[go,goText]]) {
  const node=await model.revealFile(uri);
  assert.equal(node.fileStat.isFile,true);
  assert.equal(node.uri.toString(),uri.toString());
  assert.equal(await readFile(node.uri.path.toString(),'utf8'),content);
 }

 const f=fixture(true,WorkspaceRootUriAwareCommandHandler);
 const reopened=new URI('file:///reopened');
 f.roots[0]={resource:reopened};
 f.instance.workspaceService.getWorkspaceRootUri=WorkspaceService.prototype.getWorkspaceRootUri;
 f.reply({cancelled:true});
 await f.run(go);
 assert.deepEqual(f.events,[],'An explicit selection from the closed project must not open a picker in the reopened project');
 f.instance.selectionService.selection=[{uri:src}];
 await f.folder();
 assert.deepEqual(f.events,[],'A leftover global selection must not retarget folder creation to the reopened root');
 f.instance.selectionService.selection=undefined;
 await f.run();
 assert.deepEqual(f.events,['directory',['picker',{kind:'create',name:'Untitled.txt',directoryUri:reopened.toString()}]]);
 f.events.length=0;
 const reopenedSource=reopened.resolve('src');
 f.instance.selectionService.selection=[{uri:reopenedSource}];
 await f.folder();
 assert.deepEqual(f.events,['directory',['picker',{kind:'create-folder',name:'Untitled',directoryUri:reopenedSource.toString()}]]);
});
