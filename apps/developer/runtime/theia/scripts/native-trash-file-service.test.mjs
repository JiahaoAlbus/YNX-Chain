import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, lstat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require=createRequire(import.meta.url),exec=promisify(execFile);
// Only DOM and desktop transport are adapted. Real Theia DI/provider/service,
// Navigator delete handler, participants/events, native filesystem and watcher.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.events = {}; this._text = ''; this._value = ''; this.classList = { add() {}, remove() {}, contains: () => false, toggle() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  set value(value) { this._value = value; }
  get value() { return this._value; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; if (this.tagName === 'SELECT' && this.children.length === 1) this.value = node.value; } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(key, callback) { (this.events[key] ||= []).push(callback); }
  removeEventListener(key, callback) { this.events[key] = (this.events[key] || []).filter(x => x !== callback); }
  fire(key, event = {}) { for (const callback of this.events[key] || []) callback(event); }
  matches(selector) { if (selector === 'option[value=Workspace]') return this.tagName === 'OPTION' && this.value === 'Workspace'; if (selector === '[role="alert"]') return this.attrs.role === 'alert'; return this.tagName.toLowerCase() === selector; }
  querySelector(selector) { return this.children.find(child => child.matches(selector)) || this.children.map(child => child.querySelector(selector)).find(Boolean); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  getContext() { return {createLinearGradient:()=>({addColorStop(){}}), fillRect(){}, measureText:t=>({width:String(t).length*8}),getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])})}; }
  focus() {} select() {} showModal() { this.open = true; } close() { this.open = false; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
}
const document = { queryCommandSupported:()=>false, createElement: tag => { const node = new Element(tag); node.ownerDocument = document; return node; }, addEventListener() {}, removeEventListener() {} };
document.body = document.createElement('body'); document.documentElement = document.createElement('html');
globalThis.Element = Element; globalThis.HTMLElement = Element; globalThis.document = document;
globalThis.DragEvent = class {};
globalThis.window = { document, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}) };
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'retained-node-test' }, configurable: true });
window.navigator = globalThis.navigator; globalThis.self=window;
require('reflect-metadata');
process.env.NODE_PATH = fileURLToPath(new URL('../node_modules', import.meta.url)); Module._initPaths();
Module._extensions['.css'] = module => {module.exports={};};
require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({applicationName:'YNX Test'});

const { NativeTrashContext, NativeTrashRemoteFileSystemProvider, NativeTrashWorkspaceDeleteHandler, bindNativeTrash }=require('../../ynx-workbench/lib/native-trash-file-service');
const { RemoteFileSystemProvider, RemoteFileSystemServer, FileSystemProviderServer }=require('@theia/filesystem/lib/common/remote-file-system-provider');
const { RemoteFileServiceContribution }=require('@theia/filesystem/lib/browser/remote-file-service-contribution');
const { FileService }=require('@theia/filesystem/lib/browser/file-service');
const { WorkspaceDeleteHandler }=require('@theia/workspace/lib/browser/workspace-delete-handler');
const { DiskFileSystemProvider }=require('@theia/filesystem/lib/node/disk-file-system-provider');
const { ParcelFileSystemWatcherService }=require('@theia/filesystem/lib/node/parcel-watcher/parcel-filesystem-service');
const { FileSystemWatcherServerClient }=require('@theia/filesystem/lib/node/filesystem-watcher-client');
const { FileSystemWatcherServiceDispatcher }=require('@theia/filesystem/lib/node/filesystem-watcher-dispatcher');
const { Container }=require('@theia/core/shared/inversify');
const { BaseWidget, ConfirmDialog }=require('@theia/core/lib/browser');
const { Emitter }=require('@theia/core/lib/common/event');
const URI=require('@theia/core/lib/common/uri').default;
const logger={warn(){},debug(){},info(){},error(){}};
const scratch=await mkdtemp('/private/tmp/ynx-trash-file-service-');console.log('Retained real FileService QA:',scratch);
const header=fileURLToPath(new URL('../../../desktop/macos/ynx-native-trash-broker.h',import.meta.url));
const native=join(scratch,'trash.m'),binary=join(scratch,'trash');
await writeFile(native,`#import "${header}"
int main(int argc,char **argv){@autoreleasepool{if(argc!=4||!YNXTrashPayload(@{@"action":@"trash",@"requestId":@"12345678-1234-1234-1234-123456789abc",@"relativePath":@(argv[2])}))return 64;NSError *error=nil;YNXNativeTrashRequest *request=[YNXNativeTrashRequest prepareRoot:@(argv[1]) relative:@(argv[2]) excluded:@[@"/dev"] error:&error];BOOL ok=request?[request commitApproved:!strcmp(argv[3],"yes") error:&error]:NO;NSDictionary *value=@{@"ok":@(ok),@"cancelled":@(error.code==5),@"error":error.localizedDescription?:@"",@"recoveryPath":request.recoveryPath?:@"",@"trash":request.trashedURL.path?:@""};NSData *bytes=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];fwrite(bytes.bytes,1,bytes.length,stdout);return 0;}}`);
await exec('/usr/bin/clang',['-fobjc-arc','-fblocks','-Wall','-Wextra','-Werror','-mmacosx-version-min=13.5',native,'-framework','Foundation','-o',binary]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture() {
 const home=join(scratch,randomUUID()),root=join(home,'project');await mkdir(root,{recursive:true,mode:0o700});
 const events=[],messages=[],closed=[],trash=[],nativeCalls=[];
 const api={getContext:async()=>({mode:'local',workspace:root})};
 const target={location:{protocol:'http:',hostname:'127.0.0.1',port:'43210',pathname:'/',origin:'http://127.0.0.1:43210'},webkit:{messageHandlers:{ynxLocalWorkbench:{}}}};
 let approve=true,beforeNative;
 target.ynxDesktopTrash={async trash(relative){nativeCalls.push(relative);if(beforeNative)await beforeNative(relative);const result=JSON.parse((await exec(binary,[root,relative,approve?'yes':'no'])).stdout);if(!result.ok)throw Object.assign(new Error(result.error),{cancelled:result.cancelled,recoveryPath:result.recoveryPath||undefined});trash.push(result.trash);}};
 const watcherService=new ParcelFileSystemWatcherService({verbose:false}),dispatcher=new FileSystemWatcherServiceDispatcher();dispatcher.logger=logger;watcherService.setClient(dispatcher);
 const watcher=new FileSystemWatcherServerClient();watcher.watcherService=watcherService;watcher.watcherDispatcher=dispatcher;
 const disk=new DiskFileSystemProvider();disk.watcher=watcher;disk.logger=logger;disk.init();
 const server=new FileSystemProviderServer();server.provider=disk;server.init();server.onDidOpenConnection=new Emitter().event;
 const container=new Container(),token=Symbol('actual context RPC');container.bind(token).toConstantValue(api);container.bind(RemoteFileSystemServer).toConstantValue(server);container.bind(RemoteFileSystemProvider).toSelf().inSingletonScope();container.bind(WorkspaceDeleteHandler).toSelf();bindNativeTrash(container.bind.bind(container),container.rebind.bind(container),token,target);
 const provider=container.get(RemoteFileSystemProvider);assert.ok(provider instanceof NativeTrashRemoteFileSystemProvider);await provider.ready;
 const fileService=new FileService();fileService.preferences={'files.participants.timeout':1000,get:(key,fallback)=>fallback};fileService.logger=logger;fileService.progressService={withProgress:async(label,place,work)=>work()};
 const contribution=new RemoteFileServiceContribution();contribution.provider=provider;contribution.registerFileSystemProviders(fileService);await fileService.activateProvider('file');
 fileService.onWillRunUserOperation(()=>events.push('will'));fileService.onDidRunUserOperation(()=>events.push('did-user'));fileService.onDidFailUserOperation(()=>events.push('fail-user'));fileService.onDidRunOperation(()=>events.push('did-file'));fileService.onDidFilesChange(event=>events.push(...event.changes.map(change=>'watch:'+change.resource.path.base+':'+change.type)));
 fileService.addFileOperationParticipant({async participate(){events.push('participant');}});
 const handler=new NativeTrashWorkspaceDeleteHandler();handler.nativeTrashContext=container.get(NativeTrashContext);handler.nativeTrashMessages={warn:async(text)=>messages.push(text),error:async(text)=>messages.push(text)};handler.fileService=fileService;handler.logger=logger;handler.fsPreferences={'files.enableTrash':true};handler.shell={widgets:[],async closeMany(widgets){closed.push(...widgets);events.push('close');}};handler.workspaceUtils={containsRootDirectory:uris=>uris.some(uri=>uri.path.toString()===root)};
 const watch=fileService.watch(URI.fromComponents({scheme:'file',path:root}),{recursive:true,excludes:[]});await sleep(250);
 return {root,home,events,messages,closed,trash,nativeCalls,api,target,provider,fileService,handler,disk,async dispose(){watch.dispose();provider.dispose();server.dispose();watcherService.dispose();},setApprove(value){approve=value;},setBeforeNative(callback){beforeNative=callback;},async add(name='ynx-trash-qa-'+randomUUID()){const path=join(root,name);await writeFile(path,'original');return URI.fromComponents({scheme:'file',path});}};
}
async function use(fn){const f=await fixture();try{await fn(f);}finally{await f.dispose();}}
function editor(f,uri,dirty=false){const widget=new BaseWidget(),content=new Emitter(),changed=new Emitter();widget.getResourceUri=()=>uri;widget.createMoveToUri=()=>undefined;widget.closeWithoutSaving=()=>{};widget.saveable={dirty,onContentChanged:content.event,onDirtyChanged:changed.event};f.handler.shell.widgets.push(widget);return {widget,edit(){widget.saveable.dirty=true;content.fire();},setDirty(value){widget.saveable.dirty=value;changed.fire();}};}
let dialogCount=0,dialogAccept=true,dialogDuring;
// Actual retained ConfirmDialog.open only the headless modal presentation is
// adapted; WorkspaceDeleteHandler confirm/getDirty/message generation is real.
const originalOpen=ConfirmDialog.prototype.open;
ConfirmDialog.prototype.open=async function(){dialogCount++;if(dialogDuring)dialogDuring();return dialogAccept;};
test.after(()=>{ConfirmDialog.prototype.open=originalOpen;});
test('real DI inherited remote init and FileService participants/events; system Trash and actual watcher refresh',()=>use(async f=>{
 const uri=await f.add();f.events.length=0;await f.fileService.delete(uri,{recursive:true,useTrash:true});assert.deepEqual(f.events.filter(event=>!event.startsWith('watch:')),['participant','will','did-file','did-user']);await assert.rejects(access(uri.path.toString()));assert.equal(await readFile(f.trash[0],'utf8'),'original');
 for(let i=0;i<30&&!f.events.some(e=>e==='watch:'+uri.path.base+':2');i++)await sleep(100);assert.ok(f.events.includes('watch:'+uri.path.base+':2'));assert.equal(f.provider.capabilities,f.disk.capabilities);console.log('Retained FileService system Trash:',f.trash[0]);
}));
test('readonly, nonexistent and nonrecursive validation reject before native operation',()=>use(async f=>{
 const uri=await f.add();f.provider.setCapabilities(f.disk.capabilities|2048);await assert.rejects(f.fileService.delete(uri,{useTrash:true}));f.provider.setCapabilities(f.disk.capabilities);await assert.rejects(f.fileService.delete(URI.fromComponents({scheme:'file',path:join(f.root,'missing')}),{useTrash:true}));const dir=join(f.root,'folder');await mkdir(dir);await writeFile(join(dir,'child'),'keep');await assert.rejects(f.fileService.delete(URI.fromComponents({scheme:'file',path:dir}),{useTrash:true,recursive:false}));assert.equal(f.nativeCalls.length,0);assert.equal(await readFile(uri.path.toString(),'utf8'),'original');assert.equal(f.events.filter(e=>e==='did-file').length,0);
}));
test('strict URI root, outside, authority/query/fragment reject and never dispatch Intel/permanent',()=>use(async f=>{
 const existing=await f.add();for(const uri of [URI.fromComponents({scheme:'file',path:f.root}),URI.fromComponents({scheme:'file',path:f.root+'-other/file'}),existing.withAuthority('localhost'),existing.withQuery('x'),existing.withFragment('x'),URI.fromComponents({scheme:'file',path:f.root+'/a/../file'})])await assert.rejects(f.provider.delete(uri,{useTrash:true}));assert.equal(f.nativeCalls.length,0);assert.equal(await readFile(existing.path.toString(),'utf8'),'original');
}));
test('native cancel/failure emits failure only and never discards editor or asks permanent-delete fallback',()=>use(async f=>{
 const uri=await f.add(),e=editor(f,uri,true);f.setApprove(false);dialogCount=0;dialogAccept=true;await f.handler.execute([uri]);assert.equal(dialogCount,1);assert.deepEqual(f.closed,[]);assert.equal(e.widget.saveable.dirty,true);assert.equal(await readFile(uri.path.toString(),'utf8'),'original');assert.ok(f.events.includes('fail-user'));assert.ok(!f.events.includes('did-file'));assert.ok(!f.events.includes('did-user'));assert.deepEqual(f.messages,[]);
 f.setBeforeNative(()=>{throw Object.assign(new Error('Native Trash failed'),{recoveryPath:'/private/tmp/owned-qa-recovery'});});dialogCount=0;await f.handler.execute([uri]);assert.equal(dialogCount,1);assert.deepEqual(f.closed,[]);assert.ok(f.messages.some(message=>message.includes('/private/tmp/owned-qa-recovery')));assert.equal(await readFile(uri.path.toString(),'utf8'),'original');
}));
test('clean Explorer delete has only native confirmation; approved unchanged dirty has actual dirty warning',()=>use(async f=>{
 const clean=await f.add(),a=editor(f,clean);dialogCount=0;await f.handler.execute([clean]);assert.equal(dialogCount,0);assert.deepEqual(f.closed,[a.widget]);
 const dirty=await f.add(),b=editor(f,dirty,true);dialogCount=0;await f.handler.execute([dirty]);assert.equal(dialogCount,1);assert.ok(f.closed.includes(b.widget));assert.ok(f.events.indexOf('did-file')<f.events.indexOf('close'));
}));
test('new edits between web/native confirmation preserve real Saveable dirty editor',()=>use(async f=>{
 const uri=await f.add(),e=editor(f,uri,true);dialogCount=0;f.setBeforeNative(()=>e.edit());await f.handler.execute([uri]);assert.equal(dialogCount,1);assert.equal(e.widget.saveable.dirty,true);assert.deepEqual(f.closed,[]);assert.ok(f.messages.some(m=>m.includes('remains open')));await assert.rejects(access(uri.path.toString()));
}));
test('multiselect is sequential and reports partial success; failed item editor remains',()=>use(async f=>{
 const a=await f.add(),b=await f.add(),c=await f.add(),ea=editor(f,a),eb=editor(f,b),ec=editor(f,c);let calls=0;f.setBeforeNative(()=>{if(++calls===2)throw Object.assign(new Error('Cancelled'),{cancelled:true});});dialogCount=0;await f.handler.execute([a,b,c]);assert.equal(dialogCount,0);assert.deepEqual(f.nativeCalls,[a.path.base,b.path.base]);assert.deepEqual(f.closed,[ea.widget]);assert.ok(!f.closed.includes(eb.widget)&&!f.closed.includes(ec.widget));assert.ok(f.messages.some(m=>m.includes('1 of 3')));assert.equal(await readFile(b.path.toString(),'utf8'),'original');assert.equal(await readFile(c.path.toString(),'utf8'),'original');
}));
test('current backend binding/origin/bridge failure rejects stale operations without permanent fallback',()=>use(async f=>{
 const uri=await f.add();await f.handler.nativeTrashContext.local();f.api.getContext=async()=>({mode:'local',workspace:f.root+'-other'});await assert.rejects(f.fileService.delete(uri,{useTrash:true}));assert.equal(f.nativeCalls.length,0);f.api.getContext=async()=>({mode:'local',workspace:f.root});delete f.target.ynxDesktopTrash;await assert.rejects(f.fileService.delete(uri,{useTrash:true}));f.target.location.origin='http://127.0.0.1:43211';await assert.rejects(f.fileService.delete(uri,{useTrash:true}));assert.equal(await readFile(uri.path.toString(),'utf8'),'original');
}));
test('explicit permanent and ordinary web provider preserve actual upstream file deletion semantics',()=>use(async f=>{
 const permanent=await f.add();await f.fileService.delete(permanent,{recursive:true,useTrash:false});await assert.rejects(access(permanent.path.toString()));assert.equal(f.nativeCalls.length,0);
 // Ordinary path delegates unchanged; do not call real upstream Intel Trash.
 const webContext=new NativeTrashContext({getContext:async()=>({mode:'local',workspace:f.root})},{location:{protocol:'http:',hostname:'127.0.0.1',port:'43210',pathname:'/',origin:'http://127.0.0.1:43210'}});assert.equal(await webContext.local(),false);
}));

test('native provider lost Trash capability never converts Explorer request to permanent deletion',()=>use(async f=>{
 const uri=await f.add(),e=editor(f,uri);f.provider.setCapabilities(f.disk.capabilities&~4096);dialogCount=0;await f.handler.execute([uri]);assert.equal(dialogCount,0);assert.equal(f.nativeCalls.length,0);assert.deepEqual(f.closed,[]);assert.ok(f.messages.some(m=>m.includes('does not support Trash')));assert.equal(await readFile(uri.path.toString(),'utf8'),'original');
}));
test('clean editor newly dirtied during native wait remains open after successful Trash',()=>use(async f=>{
 const uri=await f.add(),e=editor(f,uri);f.setBeforeNative(()=>e.edit());dialogCount=0;await f.handler.execute([uri]);assert.equal(dialogCount,0);assert.deepEqual(f.closed,[]);assert.equal(e.widget.saveable.dirty,true);assert.ok(f.messages.some(m=>m.includes('remains open')));await assert.rejects(access(uri.path.toString()));
}));
test('actual dirty warning cancellation and binding change across warning retain editor/file',()=>use(async f=>{
 const uri=await f.add(),e=editor(f,uri,true);dialogCount=0;dialogAccept=false;await f.handler.execute([uri]);assert.equal(dialogCount,1);assert.equal(f.nativeCalls.length,0);assert.deepEqual(f.closed,[]);dialogAccept=true;
 dialogDuring=()=>{f.api.getContext=async()=>({mode:'local',workspace:f.root+'-stale'});};try{await f.handler.execute([uri]);}finally{dialogDuring=undefined;}assert.equal(f.nativeCalls.length,0);assert.deepEqual(f.closed,[]);assert.equal(e.widget.saveable.dirty,true);assert.equal(await readFile(uri.path.toString(),'utf8'),'original');assert.ok(f.messages.some(m=>m.includes('binding changed')));
}));
test('partial native recovery path is visible message text, never a fake action button',()=>use(async f=>{
 const a=await f.add(),b=await f.add();let calls=0;f.setBeforeNative(()=>{if(++calls===2)throw Object.assign(new Error('Recovery retained'),{recoveryPath:'/private/tmp/owned-qa-recovery'});});const args=[];f.handler.nativeTrashMessages.warn=async(...values)=>{args.push(values);};await f.handler.execute([a,b]);assert.equal(args.length,1);assert.equal(args[0].length,1);assert.match(args[0][0],/1 of 2/);assert.match(args[0][0],/Recovery location: \/private\/tmp\/owned-qa-recovery/);assert.equal(await readFile(b.path.toString(),'utf8'),'original');
}));
