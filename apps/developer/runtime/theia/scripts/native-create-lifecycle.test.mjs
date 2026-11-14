import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { existsSync, mkdirSync, openSync, closeSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { bindNativeCreateFileService } = require('../../ynx-workbench/lib/native-create-file-service');
const { explorerCreateTransaction } = require('../../ynx-workbench/lib/explorer-create-transaction');
const hook = registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
await import('./python-terminal-test-fixture.mjs');
window.location={href:'http://127.0.0.1:43119'};
globalThis.UIEvent=class {};
const { FileService }=require('@theia/filesystem/lib/browser/file-service');
const { MainFileSystemEventService }=require('@theia/plugin-ext/lib/main/browser/main-file-system-event-service');
const { ExtHostFileSystemEventService }=require('@theia/plugin-ext/lib/plugin/file-system-event-service-ext-impl');
const { WorkspaceEdit }=require('@theia/plugin-ext/lib/plugin/types-impl');
const URI=require('@theia/core/lib/common/uri').default;
hook.deregister();

const di=require('@theia/core/shared/inversify');
const { LabelProvider }=require('@theia/core/lib/browser/label-provider');
const { FileSystemPreferences }=require('@theia/filesystem/lib/common/filesystem-preferences');
const { ProgressService }=require('@theia/core/lib/common/progress-service');
const { EncodingRegistry }=require('@theia/core/lib/browser/encoding-registry');
const { EncodingService }=require('@theia/core/lib/common/encoding-service');
const { ContributionProvider }=require('@theia/core/lib/common/contribution-provider');
const { FileServiceContribution }=require('@theia/filesystem/lib/browser/file-service');
const { FileSystemWatcherErrorHandler }=require('@theia/filesystem/lib/browser/filesystem-watcher-error-handler');
const { ILogger }=require('@theia/core');
const scratch=process.env.YNX_EXPLORER_TEST_TMP || require('node:os').tmpdir();

const uri=path=>new URI().withScheme('file').withPath(path);
const { FileStat }=require('@theia/filesystem/lib/common/files');

async function fixture(task){
  const root=realpathSync(await mkdtemp(join(scratch,'ynx-explorer-lifecycle-')));
  const events=[], warnings=[];
  const container=new di.Container();
  container.bind(FileService).toSelf().inSingletonScope();
  const rebind=container.rebind.bind(container);
  bindNativeCreateFileService(rebind,FileService,di);
  for(const id of [LabelProvider,EncodingRegistry,EncodingService,FileSystemWatcherErrorHandler])container.bind(id).toConstantValue({});
  container.bind(FileSystemPreferences).toConstantValue({'files.participants.timeout':500});
  container.bind(ProgressService).toConstantValue({withProgress:(_label,_kind,action)=>action()});
  container.bind(ILogger).toConstantValue({warn:error=>warnings.push(error)}).whenTargetNamed('filesystem:FileService');
  container.bind(ContributionProvider).toConstantValue({getContributions:()=>[]}).whenTargetNamed(FileServiceContribution);
  const fileService=container.get(FileService);
  assert.equal(container.get(FileService),fileService);
  const extHost=new ExtHostFileSystemEventService(null,{}, {}, {
    async $tryApplyWorkspaceEdit({edits}){
      assert.equal(edits.length,1);
      assert.equal(edits[0].options?.overwrite,false);
      const target=URI.fromComponents(edits[0].newResource).path.toString();
      assert.equal(target,join(root,'participant-sidecar.txt'));
      await writeFile(target,'extension edit',{flag:'wx'});
      events.push(['workspace-edit',target]);
      return true;
    },
  }, {});
  const main=new MainFileSystemEventService({getProxy:()=>extHost},undefined,fileService,{});
  const subscription=fileService.onDidFailUserOperation(event=>events.push(['failed',event.target.path.toString()]));
  const extension={model:{id:'qa.actual-creation-lifecycle'}};
  const listeners=[];
  const addWill=listener=>listeners.push(extHost.getOnWillCreateFileEvent(extension)(listener));
  const addDid=listener=>listeners.push(extHost.onDidCreateFile(listener));
  try{await task({root,events,warnings,fileService,addWill,addDid});assert.deepEqual(warnings,[]);}
  finally{for(const listener of listeners)listener.dispose();subscription.dispose();main.dispose();await rm(root,{recursive:true,force:true});}
}

function setup(f) {
  let live=true, generation=0, cancel=false, rendererTime=0, nativeTime=0;
  const rootUri=uri(f.root), requests=[];
  const identity=path=>{const s=lstatSync(path);assert.equal(s.isDirectory(),true);assert.equal(realpathSync(path),path);return [s.dev,s.ino];};
  // The wire boundary substitutes only WebKit/Cocoa; actual FileService
  // and extension lifecycle above are retained. The scratch writer is exclusive.
  let lease;
  const dispatch=async request=>{
    requests.push(request);
    if(request.action==='prepare-create'){
      if(cancel)return {cancelled:true};
      assert.ok(['create','create-folder'].includes(request.kind));
      assert.equal(request.name,'default');
      const parent=new URI(request.directoryUri);
      assert.ok(rootUri.isEqualOrParent(parent));
      const directory=parent.path.toString(), folder=request.kind==='create-folder';
      const selected=parent.resolve(folder?'new folder':'new.py');
      const reply={prepared:true,token:randomUUID(),ttlMs:15000,uris:[selected.toString()],rootUri:rootUri.toString()};
      lease={reply, generation, deadline:nativeTime+reply.ttlMs, directory, folder, path:selected.path.toString(),
        parentIdentity:identity(directory), rootIdentity:identity(f.root)};
      return reply;
    }
    assert.deepEqual(Object.keys(request).sort(),['action','token']);
    if(request.action==='cancel-create'){
      if(request.token===lease?.reply.token)lease=undefined;
      return {cancelled:true};
    }
    assert.equal(request.action,'commit-create');
    if(request.token!==lease?.reply.token||nativeTime>=lease.deadline)throw Error('The creation request expired or was already used');
    const row=lease;lease=undefined;
    if(row.generation!==generation || JSON.stringify(identity(row.directory))!==JSON.stringify(row.parentIdentity) ||
        JSON.stringify(identity(f.root))!==JSON.stringify(row.rootIdentity))throw Error('The project or selected folder changed');
    f.events.push(['commit',row.path]);
    let s;
    if(row.folder){mkdirSync(row.path);s=lstatSync(row.path);}
    else{const fd=openSync(row.path,'wx');try{s=fstatSync(fd);}finally{closeSync(fd);}}
    return {created:true,uris:row.reply.uris,rootUri:row.reply.rootUri,stat:{type:row.folder?2:1,mtime:s.mtimeMs,ctime:s.ctimeMs,size:s.size}};
  };
  const bridge=Object.freeze({
    createProtocol:1,
    prepareCreate:options=>dispatch({action:'prepare-create',...options}),
    commitCreate:token=>dispatch({action:'commit-create',token}),
    cancelCreate:token=>dispatch({action:'cancel-create',token}),
  });
  const run=(kind='create',selectedBridge=bridge,directory=f.root)=>explorerCreateTransaction(selectedBridge,f.fileService,
    {kind,name:'default',directoryUri:uri(directory).toString()},{
      current:()=>live,now:()=>rendererTime,
      decode(reply,phase) {
        assert.equal(reply[phase],true);
        assert.equal(reply.rootUri,rootUri.toString());
        assert.equal(reply.uris.length,1);
        const target=new URI(reply.uris[0]);
        assert.ok(rootUri.isEqualOrParent(target));
        assert.ok(!target.isEqual(rootUri));
        return target;
      },
      toFileStat:(uri,stat,kind)=>{
        assert.equal(stat.type,kind==='create'?1:2);
        for(const field of ['mtime','ctime','size'])assert.ok(Number.isFinite(stat[field]));
        return FileStat.fromStat(uri,stat);
      },
    });
  return {bridge,dispatch,run,requests,cancelPanel(){cancel=true;},invalidateRenderer(){live=false;},
    invalidateNative(){generation++;},advanceRenderer(){rendererTime+=15000;},advanceNative(){nativeTime+=15000;}};
}

test('prepared create joins the real FileService lifecycle and commits once after will/waitUntil',async()=>fixture(async f=>{
  const x=setup(f), target=join(f.root,'new.py');
  f.addWill(event=>{assert.equal(event.files[0].fsPath,target);assert.equal(existsSync(target),false);f.events.push(['will',target]);event.waitUntil(Promise.resolve().then(()=>f.events.push(['wait',target])));});
  f.addDid(event=>{assert.equal(event.files[0].fsPath,target);assert.equal(existsSync(target),true);f.events.push(['did',target]);});
  assert.equal((await x.run()).path.toString(),target);
  assert.deepEqual(f.events,[['will',target],['wait',target],['commit',target],['did',target]]);
  assert.deepEqual(x.requests.map(row=>Object.keys(row).sort()),[
    ['action','directoryUri','kind','name'],['action','token']
  ]);
  await assert.rejects(x.bridge.commitCreate(x.requests[1].token),/already used/);
  assert.equal(await readFile(target,'utf8'),'');
}));

test('folder commit uses mkdir once and emits extension did before the renderer returns',async()=>fixture(async f=>{
  const x=setup(f), target=join(f.root,'new folder');
  f.addWill(event=>{assert.equal(event.files[0].fsPath,target);f.events.push(['will',target]);});
  f.addDid(event=>{assert.equal(event.files[0].fsPath,target);f.events.push(['did',target]);});
  await x.run('create-folder');
  assert.deepEqual(f.events,[['will',target],['commit',target],['did',target]]);
  assert.equal((await stat(target)).isDirectory(),true);
}));

test('cancelled panel emits no events and renderer uses the old R22 capability only when new protocol is missing',async()=>fixture(async f=>{
  const x=setup(f);x.cancelPanel();
  assert.equal(await x.run(),undefined);
  assert.deepEqual(x.requests.map(v=>v.action),['prepare-create']);
  assert.deepEqual(f.events,[]);
  let calls=0;
  const old={open:async options=>{calls++;assert.equal(options.kind,'create');const path=join(f.root,'old.py');await writeFile(path,'old bridge',{flag:'wx'});return {created:true,uris:[uri(path).toString()],rootUri:uri(f.root).toString()};}};
  assert.equal((await x.run('create',old)).path.toString(),join(f.root,'old.py'));
  assert.equal(calls,1);assert.deepEqual(f.events,[]);
  await assert.rejects(x.run('create',{...old,createProtocol:1}),/unavailable/);
  assert.equal(calls,1);
}));

test('stale renderer during extension waitUntil does not call commit and cancels exactly that lease',async()=>fixture(async f=>{
  const x=setup(f), path=join(f.root,'new.py');
  f.addWill(event=>event.waitUntil(Promise.resolve().then(x.invalidateRenderer)));
  f.addDid(()=>assert.fail('No did on stale request'));
  await assert.rejects(x.run(),/stale/);
  assert.deepEqual(x.requests.map(v=>v.action),['prepare-create','cancel-create']);
  assert.equal(existsSync(path),false);
  assert.deepEqual(f.events,[['failed',path]]);
}));

test('renderer expiry during waitUntil and independent native expiry both refuse writes and did',async()=>fixture(async f=>{
  const x=setup(f); let nativeOnly=false;
  const path=join(f.root,'new.py');
  f.addWill(event=>event.waitUntil(Promise.resolve().then(()=>nativeOnly?x.advanceNative():x.advanceRenderer())));
  f.addDid(()=>assert.fail('No did on expired request'));
  await assert.rejects(x.run(),/stale/);
  assert.deepEqual(x.requests.map(v=>v.action),['prepare-create','cancel-create']);
  nativeOnly=true;
  await assert.rejects(x.run(),/expired/);
  assert.deepEqual(x.requests.slice(2).map(v=>v.action),['prepare-create','commit-create','cancel-create']);
  assert.equal(existsSync(path),false);
  assert.deepEqual(f.events,[['failed',path],['failed',path]]);
}));

test('native rejects project/parent identity replacement and duplicate writer without claiming did-create',async()=>fixture(async f=>{
  const x=setup(f), path=join(f.root,'new.py');
  let change=()=>x.invalidateNative();
  f.addWill(event=>event.waitUntil(Promise.resolve().then(()=>change())));
  f.addDid(()=>assert.fail('No did on native refusal'));
  await assert.rejects(x.run(),/project or selected folder changed/);
  assert.equal(existsSync(path),false);
  change=()=>writeFile(path,'other writer',{flag:'wx'});
  await assert.rejects(x.run(),{code:'EEXIST'});
  assert.equal(await readFile(path,'utf8'),'other writer');
  assert.deepEqual(f.events,[['failed',path],['commit',path],['failed',path]]);
}));

test('token-only native dispatch rejects injected destination and one-use success survives cancel retry',async()=>fixture(async f=>{
  const x=setup(f), selection={kind:'create',name:'default',directoryUri:uri(f.root).toString()};
  const reply=await x.bridge.prepareCreate(selection);
  await assert.rejects(async()=>x.dispatch({action:'commit-create',token:reply.token,uri:uri(join(f.root,'escape')).toString()}),/Expected values to be strictly deep-equal/);
  assert.equal((await x.bridge.commitCreate(reply.token)).created,true);
  assert.equal((await x.bridge.cancelCreate(reply.token)).cancelled,true);
  await assert.rejects(x.bridge.commitCreate(reply.token),/already used/);
  assert.equal(existsSync(join(f.root,'escape')),false);
}));

test('native lease captured at one real directory refuses a same-path replacement during will',async()=>fixture(async f=>{
  const x=setup(f), folder=join(f.root,'src');
  await mkdir(folder);
  f.addWill(event=>event.waitUntil((async()=>{
    await rename(folder,join(f.root,'moved-src'));
    await mkdir(folder);
  })()));
  f.addDid(()=>assert.fail('No did after inode replacement'));
  await assert.rejects(x.run('create',x.bridge,folder),/project or selected folder changed/);
  assert.equal(existsSync(join(folder,'new.py')),false);
  assert.equal(existsSync(join(f.root,'moved-src','new.py')),false);
}));

test('an untrustworthy reply after exclusive commit is UNKNOWN, preserves disk bytes and never emits did',async()=>fixture(async f=>{
  const x=setup(f), target=join(f.root,'new.py');
  f.addDid(()=>f.events.push(['unexpected did']));
  const unreliable={...x.bridge,async commitCreate(token){
    const reply=await x.bridge.commitCreate(token);
    return {...reply,uris:[uri(join(f.root,'wrong.py')).toString()]};
  }};
  await assert.rejects(x.run('create',unreliable),{code:'YNX_EXPLORER_CREATE_UNKNOWN'});
  assert.deepEqual(f.events,[['commit',target],['failed',target]]);
  assert.equal(await readFile(target,'utf8'),'');
  assert.equal(existsSync(join(f.root,'wrong.py')),false);
}));
