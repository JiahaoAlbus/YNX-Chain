import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),developer=dirname(dirname(fileURLToPath(import.meta.url)));
const source=await readFile(join(developer,'desktop/macos/main.m'),'utf8'),root=await mkdtemp('/private/tmp/ynx-native-readiness-');
function method(name){const start=source.indexOf('- ('+name);assert.ok(start>=0);const end=source.indexOf('\n- (',start+1);return source.slice(start,end);}
const paths=source.slice(source.indexOf('static NSString *YNXCanonicalLocalDirectory'),source.indexOf('static NSString *YNXRecentLocalWorkspace'));
const decisions=source.slice(source.indexOf('static BOOL YNXLocalEditorDocumentURL'),source.indexOf('static NSSet<NSString *> *YNXLocalWorkbenchCommands'));
const origin=source.match(/^static NSString \*YNXOrigin\(.*$/m)[0];
const port=source.slice(source.indexOf('static NSInteger YNXAvailablePort'),source.indexOf('static NSURL *YNXWorkspaceSnapshotURL'));
const logOpen=source.match(/^        int fd=open\(_serverLogURL\.fileSystemRepresentation,.*$/m)[0].trim().replace('_serverLogURL','d.serverLogURL');
const native=join(root,'readiness.m'),binary=join(root,'readiness');
const properties=`@property(nonatomic) NSInteger port;@property(nonatomic) BOOL localWorkbenchMode,localStartupFailed,localReadyComplete,localEditorDocumentLoaded;
@property(nonatomic) NSUInteger localReadyGeneration;@property(nonatomic) NSTimeInterval localReadyStarted;
@property(nonatomic,strong) NSTask *server;@property(nonatomic,strong) NSFileHandle *serverLog;@property(nonatomic,strong) NSURL *serverLogURL;
@property(nonatomic,copy) NSString *localSupportRoot,*localWorkspace,*localReadyDiagnostic;
@property(nonatomic,strong) NSURLSessionDataTask *localReadyTask;@property(nonatomic,strong) Recorder *webView;`;
await writeFile(native,`#import <Foundation/Foundation.h>
#import <sys/socket.h>
#import <netinet/in.h>
#import <fcntl.h>
#import <unistd.h>
#import <sys/stat.h>
#import <stdlib.h>
${paths}\n${decisions}\n${origin}\n${port}
@interface Recorder:NSObject
@property(nonatomic) BOOL loaded;
- (void)loadRequest:(NSURLRequest *)request;
@end
@implementation Recorder
- (void)loadRequest:(NSURLRequest *)request{self.loaded=YES;}
@end
@interface Readiness:NSObject
${properties}
- (void)showFailure:(NSString *)message;
- (void)loadWhenReady:(NSInteger)attempt;
- (void)cancelLocalReadiness;
- (void)pollLocalReadiness:(NSUInteger)generation attempt:(NSInteger)attempt;
- (void)stopUnopenedLocalServer;
@end
@implementation Readiness
${method('void)cancelLocalReadiness')}\n${method('void)stopUnopenedLocalServer')}\n${method('BOOL)localReadinessReceiptMatched')}\n${method('void)pollLocalReadiness:')}\n${method('void)loadWhenReady:')}
- (void)showFailure:(NSString *)message{[self cancelLocalReadiness];self.localStartupFailed=YES;[self stopUnopenedLocalServer];}
@end
int main(int argc,char **argv){@autoreleasepool{
 if(argc!=2)return 64;
 NSDictionary *config=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[1])] options:0 error:nil];
 Readiness *d=[Readiness new];d.localWorkbenchMode=YES;d.localSupportRoot=config[@"support"];d.localWorkspace=config[@"workspace"];d.port=YNXAvailablePort();d.webView=[Recorder new];
 d.serverLogURL=[NSURL fileURLWithPath:config[@"log"]];${logOpen}if(fd<0||!(fcntl(fd,F_GETFL)&O_APPEND))return 66;d.serverLog=[[NSFileHandle alloc]initWithFileDescriptor:fd closeOnDealloc:YES];
 d.server=[NSTask new];d.server.executableURL=[NSURL fileURLWithPath:config[@"node"]];d.server.arguments=@[config[@"child"],@(argv[1]),[NSString stringWithFormat:@"%ld",(long)d.port]];d.server.standardOutput=d.serverLog;d.server.standardError=d.serverLog;
 NSError *failure=nil;if(![d.server launchAndReturnError:&failure])return 65;
 [d loadWhenReady:0];NSUInteger generation=d.localReadyGeneration;
 NSString *mode=config[@"mode"];
 if([mode isEqual:@"cancel"])dispatch_after(dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[d cancelLocalReadiness];});
 if([mode isEqual:@"deadline"]){d.localReadyStarted=NSProcessInfo.processInfo.systemUptime-181;}
 if([mode isEqual:@"loaded-protection"]){d.localEditorDocumentLoaded=YES;[d stopUnopenedLocalServer];}
 NSDate *until=[NSDate dateWithTimeIntervalSinceNow:[config[@"wait"] doubleValue]];
 while(until.timeIntervalSinceNow>0&&!d.webView.loaded&&!d.localStartupFailed)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
 BOOL loaded=d.webView.loaded,failed=d.localStartupFailed;NSTimeInterval elapsed=NSProcessInfo.processInfo.systemUptime-d.localReadyStarted;
 if(failed){NSDate *grace=[NSDate dateWithTimeIntervalSinceNow:2];while(d.server.running&&grace.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];}
 BOOL childStillRunning=d.server.running;
 [d cancelLocalReadiness];if(d.server.running){[d.server terminate];[d.server waitUntilExit];}[d.serverLog closeFile];
 NSDictionary *result=@{@"loaded":@(loaded),@"failed":@(failed),@"elapsed":@(elapsed),@"generationInvalidated":@((BOOL)(d.localReadyGeneration>generation)),@"childRunningBeforeHarnessCleanup":@(childStillRunning)};
 NSData *json=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];puts([[NSString alloc]initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
 return 0;
}}`);
await exec('/usr/bin/clang',['-fobjc-arc','-mmacosx-version-min=13.5',native,'-framework','Foundation','-o',binary]);
const child=join(root,'child.mjs');
await writeFile(child,`import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';const config=JSON.parse(await readFile(process.argv[2])),port=Number(process.argv[3]);if(config.mode==='exit'){setTimeout(()=>process.exit(0),200);}else setTimeout(()=>{const server=createServer((request,response)=>{response.writeHead(200);response.end('actual native readiness fixture');});server.listen(port,'127.0.0.1',()=>console.log('YNX_LOCAL_WORKBENCH '+JSON.stringify({url:'http://127.0.0.1:'+port,workspace:config.mode==='mismatch'?config.workspace+'-wrong':config.workspace,profile:config.profile,projectId:config.projectId})));},config.delay);`);
async function run(mode,delay,wait){
 const fixture=await mkdtemp(join(root,mode+'-')),support=join(fixture,'support'),workspace=join(fixture,'project'),profile=join(support,'local-projects/hash/profile');
 await mkdir(profile,{recursive:true,mode:0o700});await mkdir(workspace,{mode:0o700});await chmod(support,0o700);
 const projectId=randomUUID();await writeFile(join(profile,'ynx-local-project.json'),JSON.stringify({schemaVersion:1,workspace,profile,projectId}),{mode:0o600});
 const log=join(fixture,'server.log');
 const config=join(fixture,'config.json');await writeFile(config,JSON.stringify({support,workspace,profile,projectId,log,node:process.execPath,child,mode,delay,wait}),{mode:0o600});
 const {stdout}=await exec(binary,[config],{timeout:(wait+5)*1000});const result=JSON.parse(stdout.trim());return {result,log};
}
test('real source-extracted NSURLSession survives cold startup beyond the previous nine-second limit',async()=>{
 const {result,log}=await run('cold',11000,17);assert.equal(result.loaded,true);assert.equal(result.failed,false);assert.ok(result.elapsed>=11);
 const diagnostics=await readFile(log,'utf8');assert.match(diagnostics,/"status":200/);assert.match(diagnostics,/"receiptMatched":true/);assert.match(diagnostics,/"errorDomain":"NSURLErrorDomain"/);
 for(const line of diagnostics.trim().split('\n')){assert.ok(line.startsWith('YNX_NATIVE_READINESS ')||line.startsWith('YNX_LOCAL_WORKBENCH '));JSON.parse(line.slice(line.indexOf(' ')+1));}
 console.log('Retained cold-start log:',log);
});
test('actual cancellation invalidates pending callbacks without loading the later ready child',async()=>{
 const {result}=await run('cancel',600,1.3);assert.equal(result.loaded,false);assert.equal(result.failed,false);assert.equal(result.generationInvalidated,true);
});
test('actual child exit and bounded monotonic deadline stop readiness',async()=>{
 const exited=await run('exit',0,2);assert.equal(exited.result.failed,true);assert.equal(exited.result.loaded,false);
 assert.equal(exited.result.childRunningBeforeHarnessCleanup,false);
 const timed=await run('deadline',11000,2);assert.equal(timed.result.failed,true);assert.equal(timed.result.loaded,false);
 assert.equal(timed.result.childRunningBeforeHarnessCleanup,false);
});
test('HTTP 200 from the right port without the admitted project receipt cannot load',async()=>{
 const {result}=await run('mismatch',100,1.3);assert.equal(result.loaded,false);assert.equal(result.failed,false);
});
test('startup cleanup never terminates an already admitted editor child',async()=>{
 const {result}=await run('loaded-protection',11000,0.3);assert.equal(result.childRunningBeforeHarnessCleanup,true);assert.equal(result.loaded,false);assert.equal(result.failed,false);
});
test('no global ATS permission or proxy change introduced',async()=>{
 const info=await readFile(join(developer,'desktop/macos/Info.plist'),'utf8');assert.doesNotMatch(info,/NSAllowsArbitraryLoads|NSAppTransportSecurity/);
 assert.match(source,/generation!=self\.localReadyGeneration\|\|child!=self\.server/);
 assert.match(source,/applicationWillTerminate:.*cancelLocalReadiness/);
 assert.match(source,/open\(_serverLogURL.fileSystemRepresentation,O_WRONLY\|O_CREAT\|O_EXCL\|O_NOFOLLOW\|O_CLOEXEC\|O_APPEND,0600\)/);
 assert.doesNotMatch(source,/openat\(directory,pending.fileSystemRepresentation,[^;]*O_APPEND/);
 console.log('Retained native readiness fixture:',root);
});
