import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, readdir, symlink, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),developer=dirname(dirname(fileURLToPath(import.meta.url)));
const scratch=await mkdtemp('/private/tmp/ynx-native-trash-qa-');
console.log('Retained native Trash QA:',scratch);
const mainSource=await readFile(join(developer,'desktop/macos/main.m'),'utf8');
const bindingCode=mainSource.slice(mainSource.indexOf('static NSString *YNXTrashExpectedProfile'),mainSource.indexOf('static NSString *YNXCanonicalLocalDirectory'));
const header=join(developer,'desktop/macos/ynx-native-trash-broker.h');
const harness=join(scratch,'probe.m'),binary=join(scratch,'probe');
await writeFile(harness,`#define YNX_NATIVE_TRASH_TESTING 1
#import "${header}"
#import <CommonCrypto/CommonDigest.h>
${bindingCode}
int main(int argc,char **argv){@autoreleasepool{
 if(argc!=2)return 64;NSDictionary *c=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[1])] options:0 error:nil];NSString *root=c[@"root"],*relative=c[@"relative"],*mode=c[@"mode"];NSError *error=nil;
 NSMutableArray *excluded=[@[@"/dev",[NSString stringWithFormat:@"/private/tmp/yi-%u",getuid()]]mutableCopy];if(c[@"excluded"]) [excluded addObject:c[@"excluded"]];
 struct stat selectedRoot;BOOL selectedRootKnown=!lstat(root.fileSystemRepresentation,&selectedRoot);
 NSData *selectedIdentity=selectedRootKnown?[NSData dataWithBytes:&selectedRoot length:sizeof(selectedRoot)]:nil;
 YNXNativeTrashRequest *boundary=[YNXNativeTrashRequest bindRoot:root excluded:excluded error:&error];
 if([mode isEqual:@"root-replaced"]){rename(root.fileSystemRepresentation,[root stringByAppendingString:@"-old"].fileSystemRepresentation);mkdir(root.fileSystemRepresentation,0700);}
 YNXNativeTrashRequest *request=boundary?[YNXNativeTrashRequest prepareBoundary:boundary relative:relative error:&error]:nil;
 NSString *file=[root stringByAppendingPathComponent:relative];
 if(request&&[mode isEqual:@"target-replaced"]){rename(file.fileSystemRepresentation,[file stringByAppendingString:@"-old"].fileSystemRepresentation);[@"new" writeToFile:file atomically:NO encoding:NSUTF8StringEncoding error:nil];}
 if(request&&[mode isEqual:@"ancestor-replaced"]){NSString *parent=file.stringByDeletingLastPathComponent;rename(parent.fileSystemRepresentation,[parent stringByAppendingString:@"-old"].fileSystemRepresentation);mkdir(parent.fileSystemRepresentation,0700);}
 if(request&&[mode isEqual:@"capture-replaced"])request.beforeCapture=^{rename(file.fileSystemRepresentation,[file stringByAppendingString:@"-old"].fileSystemRepresentation);[@"new" writeToFile:file atomically:NO encoding:NSUTF8StringEncoding error:nil];};
 __weak YNXNativeTrashRequest *weakRequest=request;
 if(request&&[mode isEqual:@"stage-missing"])request.afterCapture=^{rename(weakRequest.recoveryPath.fileSystemRepresentation,[file stringByAppendingString:@"-captured"].fileSystemRepresentation);};
 if(request&&[mode isEqual:@"stage-replaced"])request.afterCapture=^{NSString *stage=weakRequest.recoveryPath;rename(stage.fileSystemRepresentation,[stage stringByAppendingString:@"-old"].fileSystemRepresentation);[@"new" writeToFile:stage atomically:NO encoding:NSUTF8StringEncoding error:nil];};
 if(request&&([mode isEqual:@"restore"]||[mode isEqual:@"conflict"])){request.forceFailure=YES;if([mode isEqual:@"conflict"])request.afterCapture=^{[@"new" writeToFile:file atomically:NO encoding:NSUTF8StringEncoding error:nil];};}
 BOOL result=request?[request commitApproved:!([mode isEqual:@"cancel"]||[mode isEqual:@"search-only-parent"]) error:&error]:NO;NSError *again=nil;BOOL replay=request?[request commitApproved:YES error:&again]:NO;
 BOOL listingDenied=NO;if([mode isEqual:@"search-only-parent"]){int listing=open(root.stringByDeletingLastPathComponent.fileSystemRepresentation,O_RDONLY|O_DIRECTORY);listingDenied=listing<0;if(listing>=0)close(listing);}
 BOOL schema=YNXTrashPayload(@{@"action":@"trash",@"requestId":@"12345678-1234-1234-1234-123456789abc",@"relativePath":@"x"})&&!YNXTrashPayload(@{@"action":@"trash",@"requestId":@"bad",@"relativePath":@"x"})&&!YNXTrashPayload(@{@"action":@"trash",@"requestId":@"12345678-1234-1234-1234-123456789abc",@"relativePath":@"x",@"root":root});
 NSString *support=@"/private/tmp/owned-support",*uuid=@"12345678-1234-1234-1234-123456789abc";NSMutableDictionary *receipt=[@{@"workspace":root,@"profile":YNXTrashExpectedProfile(support,root),@"projectId":uuid,@"url":@"http://127.0.0.1:12345"} mutableCopy];BOOL binding=YNXTrashBoundReceipt(receipt,support,root,uuid);receipt[@"workspace"]=@"/Users/foreign";binding=binding&&!YNXTrashBoundReceipt(receipt,support,root,uuid);receipt[@"workspace"]=root;receipt[@"profile"]=@"/private/tmp/owned-support/local-projects/forged/profile";binding=binding&&!YNXTrashBoundReceipt(receipt,support,root,uuid);receipt[@"profile"]=YNXTrashExpectedProfile(support,root);receipt[@"projectId"]=@"87654321-1234-1234-1234-123456789abc";binding=binding&&!YNXTrashBoundReceipt(receipt,support,root,uuid);
 NSDictionary *answer=@{@"rootIdentityMatches":@([boundary matchesRootIdentity:selectedIdentity]),@"binding":@(binding),@"prepared":request?@YES:@NO,@"parentListingDenied":@(listingDenied),@"ok":@(result),@"code":@(error.code),@"replay":@(replay),@"replayCode":@(again.code),@"schema":@(schema),@"recovery":request.recoveryPath?:@"",@"trash":request.trashedURL.path?:@""};NSData *json=[NSJSONSerialization dataWithJSONObject:answer options:0 error:nil];fwrite(json.bytes,1,json.length,stdout);return 0;
}}
`);
await exec('/usr/bin/clang',['-fobjc-arc','-fblocks','-Wall','-Wextra','-Werror','-mmacosx-version-min=13.5',harness,'-framework','Foundation','-o',binary]);
async function fixture(mode,{relative,excluded,link,parentLink,rootOverride}={}){
 const home=join(scratch,randomUUID());await mkdir(home,{mode:0o700});const root=join(home,'project');await mkdir(root,{mode:0o700});
 const name='ynx-trash-qa-'+randomUUID(),path=join(root,name);await writeFile(path,'original');
 let selected=relative??name;
 if(link){await symlink(path,join(root,'linked'));selected='linked';}
 if(parentLink){await mkdir(join(root,'dir'),{mode:0o700});await writeFile(join(root,'dir',name),'original');await symlink(join(root,'dir'),join(root,'alias'));selected='alias/'+name;}
 if(mode==='ancestor-replaced'){await mkdir(join(root,'dir'),{mode:0o700});await writeFile(join(root,'dir',name),'original');selected='dir/'+name;}
 const config=join(home,'config.json');await writeFile(config,JSON.stringify({root:rootOverride??root,relative:selected,mode,...excluded?{excluded:excluded==='parent'?home:excluded}:{}}),{mode:0o600});
 const targetBefore=await lstat(join(root,name));const policy=mode==='restricted'?`(version 1)(allow default)(deny file-write* (subpath "${process.env.HOME}/.Trash"))`:mode==='search-only-parent'?`(version 1)(allow default)(deny file-read-data (literal "${home}"))`:undefined;
 const invocation=policy?await exec('/usr/bin/sandbox-exec',['-p',policy,binary,config]):await exec(binary,[config]);const result=JSON.parse(invocation.stdout);return {home,root,name,targetBefore,path:selected===name?path:join(root,selected),result};
}
const stages=async home=>(await readdir(home)).filter(x=>x.startsWith('.ynx-native-trash-'));
test('native schema, real system Trash and single-use approval; only owned QA item remains recoverable',async()=>{
 const f=await fixture('real');assert.equal(f.result.schema,true);assert.equal(f.result.binding,true);assert.equal(f.result.ok,true);assert.equal(f.result.replay,false);assert.equal(f.result.replayCode,6);await assert.rejects(access(f.path));assert.ok(f.result.trash);assert.equal(await readFile(f.result.trash,'utf8'),'original');assert.deepEqual(await stages(f.home),[]);console.log('Retained own system Trash item:',f.result.trash);
});
test('cancel preserves source and creates no stage',async()=>{const f=await fixture('cancel');assert.equal(f.result.rootIdentityMatches,true);assert.equal(f.result.code,5);assert.equal(await readFile(f.path,'utf8'),'original');assert.deepEqual(await stages(f.home),[]);});
test('project boundary needs traversal only while parent directory listing stays denied',async()=>{const f=await fixture('search-only-parent');assert.equal(f.result.parentListingDenied,true);assert.equal(f.result.prepared,true);assert.equal(f.result.code,5);assert.equal(await readFile(f.path,'utf8'),'original');assert.deepEqual(await stages(f.home),[]);});
test('whole root, traversal, cross-project and ancestor symlinks are rejected unchanged',async()=>{
 for(const options of [{relative:'.'},{relative:'../other'},{relative:'/etc/passwd'},{parentLink:true}]){const f=await fixture('reject',options);assert.equal(f.result.prepared,false);assert.equal(await readFile(join(f.root,f.name),'utf8'),'original');assert.deepEqual(await stages(f.home),[]);}
});
test('sandbox-writable stage parent is refused and source preserved',async()=>{const f=await fixture('reject',{excluded:'parent'});assert.equal(f.result.code,3);assert.equal(f.result.prepared,false);assert.equal(await readFile(f.path,'utf8'),'original');});
test('admitted root and approved ancestor replacement fail closed',async()=>{
 const root=await fixture('root-replaced');assert.equal(root.result.rootIdentityMatches,false);assert.equal(root.result.prepared,false);assert.equal(await readFile(join(root.root+'-old',root.name),'utf8'),'original');
 const f=await fixture('ancestor-replaced');assert.equal(f.result.ok,false);assert.equal(f.result.code,6);assert.equal(await readFile(join(f.root,'dir-old',f.name),'utf8'),'original');assert.deepEqual(await stages(f.home),[]);
});
test('target replacement before capture and in rename race never trashes replacement',async()=>{
 for(const mode of ['target-replaced','capture-replaced']){const f=await fixture(mode);assert.equal(f.result.ok,false);assert.equal(await readFile(f.path,'utf8'),'new');assert.equal(await readFile(f.path+'-old','utf8'),'original');assert.deepEqual(await stages(f.home),[]);}
});
test('final staged-vnode revalidation catches postcapture replacement and preserves both entries',async()=>{
 const f=await fixture('stage-replaced');assert.equal(f.result.ok,false);assert.equal(await readFile(f.path,'utf8'),'new');assert.ok(f.result.recovery);assert.equal(await readFile(join(f.result.recovery,f.name+'-old'),'utf8'),'original');
});
test('failed system action restores exact source; conflict preserves recoverable staging without overwrite',async()=>{
 const a=await fixture('restore');assert.equal(a.result.ok,false);assert.equal(await readFile(a.path,'utf8'),'original');assert.deepEqual(await stages(a.home),[]);
 const b=await fixture('conflict');assert.equal(b.result.code,8);assert.equal(await readFile(b.path,'utf8'),'new');assert.equal(await readFile(b.result.recovery,'utf8'),'original');assert.equal((await lstat(dirname(b.result.recovery))).mode&0o777,0o700);console.log('Retained conflict recovery:',b.result.recovery);
});
test('final symlink itself is trashed by Foundation while its owned target vnode and bytes are unchanged',async()=>{
 const f=await fixture('real',{link:true});assert.equal(f.result.ok,true);assert.ok((await lstat(f.result.trash)).isSymbolicLink());const target=join(f.root,f.name);assert.equal(await readFile(target,'utf8'),'original');const after=await lstat(target);assert.equal(after.ino,f.targetBefore.ino);assert.equal(after.dev,f.targetBefore.dev);assert.deepEqual(await stages(f.home),[]);console.log('Retained own system Trash symlink:',f.result.trash);
});
test('real restricted Foundation failure restores source and leaves no empty stage',async()=>{const f=await fixture('restricted');assert.equal(f.result.ok,false);assert.equal(await readFile(f.path,'utf8'),'original');assert.deepEqual(await stages(f.home),[]);});
test('missing staged entry is explicit unknown, never falsely reported restored',async()=>{const f=await fixture('stage-missing');assert.equal(f.result.code,9);assert.equal(f.result.ok,false);assert.equal(f.result.recovery,'');await assert.rejects(access(f.path));assert.equal(await readFile(f.path+'-captured','utf8'),'original');});
test('real mount boundary with different parent device fails closed without touching volume contents',async()=>{const child=await lstat('/Volumes/Data'),parent=await lstat('/Volumes');assert.notEqual(child.dev,parent.dev);const f=await fixture('reject',{rootOverride:'/Volumes/Data'});assert.equal(f.result.prepared,false);assert.equal(f.result.code,3);assert.equal(await readFile(join(f.root,f.name),'utf8'),'original');});
test('actual injected JS contract bounds requests, native cancellation, reply replay and pagehide cleanup',async()=>{
 const match=mainSource.match(/NSString \*trashScript=@"((?:[^"\\]|\\.)*)";/);assert.ok(match);const script=JSON.parse('"'+match[1]+'"');const sent=[],events={},window={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>sent.push(value)}}}};vm.runInNewContext(script,{window,location:{pathname:'/'},crypto:{randomUUID},Map,Promise,Error,Object,addEventListener:(name,fn)=>events[name]=fn});
 const pending=Array.from({length:32},()=>window.ynxDesktopTrash.trash('item').then(()=>null,error=>error));await assert.rejects(window.ynxDesktopTrash.trash('overflow'),/excessive/);assert.equal(sent.length,32);window.__ynxNativeTrashReply({requestId:sent[0].requestId,ok:false,cancelled:true,error:'Cancelled'});window.__ynxNativeTrashReply({requestId:sent[0].requestId,ok:true});events.pagehide();const values=await Promise.all(pending);assert.equal(values[0].cancelled,true);assert.ok(values.slice(1).every(error=>/closed/.test(error.message)));const next=window.ynxDesktopTrash.trash('again');window.__ynxNativeTrashReply({requestId:sent.at(-1).requestId,ok:true});await next;
});
test('actual native compile and bridge source contract retain exact origin/mainframe/binding and lifecycle cancellation',async()=>{
 await exec('/usr/bin/clang',['-fsyntax-only','-fobjc-arc','-fblocks','-mmacosx-version-min=13.5',join(developer,'desktop/macos/main.m')]);
 const source=await readFile(join(developer,'desktop/macos/main.m'),'utf8');assert.match(source,/YNXTrustedMessage\(message,_webView,_port\)/);assert.match(source,/YNXLocalEditorDocumentURL\(message.frameInfo.request.URL,_port\).*handleLocalTrashMessage/);assert.match(source,/YNXMatchingLocalReadyReceipt\(receipt,_localSupportRoot,workspace,YNXOrigin\(_port\)\)/);assert.match(source,/self.server==child&&child.running&&generation==self.localReadyGeneration/);assert.match(source,/\[self cancelLocalTrashConsent\];_localCommandDocumentReady=NO/);assert.match(source,/- \(NSApplicationTerminateReply\)applicationShouldTerminate:[\s\S]*?if\(_localWorkbenchMode\)\{\[self cancelLocalFileSelection:YES\];\[self cancelLocalGoSelection\];\[self cancelLocalTrashConsent\];\}/);assert.ok(source.includes('_localWorkspace?:[_localSupportRoot stringByAppendingPathComponent:@"local-projects/default/workspace"]'));assert.match(source,/YNXTrashBoundReceipt\(receipt,_localSupportRoot,workspace,_localTrashBindingID\)/);assert.match(source,/Object.defineProperty\(window,'ynxDesktopTrash'/);
});
