import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { NativeInitialFile }=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/native-file-picker');
const main=readFileSync(new URL('./macos/main.m',import.meta.url),'utf8');
const frame=readFileSync(new URL('../runtime/ynx-workbench/lib/native-startup-frame.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
function fixture(warm=false){
 const restored=deferred(),initial=deferred(),messages=[],events=[];
 const target={crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:m=>messages.push(m)}}},setTimeout,clearTimeout,requestAnimationFrame:fn=>{queueMicrotask(fn);return 1},cancelAnimationFrame(){},getComputedStyle:()=>({transitionDuration:'0s'})};
 const mod={exports:{}};
 vm.runInNewContext(frame,{module:mod,exports:mod.exports,Promise,require:name=>name==='@theia/core/lib/common'?{MeasurementContext:class{armAllSettled(){}}}:{parseCssTime:()=>0}});
 const startup={classList:{add:()=>events.push('hidden')},parentElement:{removeChild:()=>events.push('removed')}};
 const app={backendStopwatch:{start:()=>Promise.resolve(1),stop(){}},stopwatch:{},measure:(_,fn)=>fn(),stateService:{set state(v){events.push(v)}},async startContributions(){},async getHost(){return{}},attachShell(){},attachTooltip(){},initializeLayout:()=>restored.promise,fireOnDidInitializeLayout:()=>initial.promise,getStartupIndicator:()=>warm?undefined:startup,registerEventListeners:()=>events.push('listeners')};
 return{messages,events,restored,initial,run:()=>mod.exports.startNative.call(app,target)};
}
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
for(const warm of [false,true])test(`${warm?'warm':'cold'} startup emits ready only after restored files and real shell reveal`,async()=>{
 const f=fixture(warm),pending=f.run();await flush();assert.equal(f.messages.length,0);
 f.restored.resolve();await flush();assert.equal(f.messages.length,0);
 f.initial.resolve();await pending;assert.equal(f.messages.length,1);assert.equal(f.messages[0].action,'workbench-ready');
 assert.equal(f.events.at(-1),'ready');if(!warm)assert.ok(f.events.indexOf('removed')<f.events.indexOf('ready'));
});
test('failed layout restoration never emits a successful presentation message',async()=>{
 const f=fixture(),pending=f.run();f.restored.reject(Error('RESTORE_FAILED'));await assert.rejects(pending,/RESTORE_FAILED/);assert.equal(f.messages.length,0);
});
test('normal startup has no visible placeholder; failure and bounded deadline stay wired',()=>{
 const begin=main.slice(main.indexOf('- (void)beginLocalWorkbench'),main.indexOf('- (void)presentLocalWindow'));
 assert.doesNotMatch(begin,/makeKeyAndOrderFront|Opening YNX Developer|loadHTMLString/);
 assert.match(begin,/scheduledTimerWithTimeInterval:YNXLocalReadinessBudget/);
 assert.match(begin,/\[owner showFailure:/);
 const failure=main.slice(main.indexOf('- (void)showFailure:'),main.indexOf('- (void)application:(NSApplication *)application openURLs:'));
 assert.match(failure,/\[self presentLocalWindow\]/);assert.match(failure,/if\(_localWorkbenchMode&&_localEditorDocumentLoaded\).*NSAlert/s);
 assert.match(main,/if\(!flag&&\(!_localWorkbenchMode\|\|_localWindowPresented\)\)/);
});
function method(name,next){const start=main.indexOf(name);assert.notEqual(start,-1);return main.slice(start,main.indexOf(next,start));}
test('actual Cocoa presentation methods reject stale/failed readiness and reveal once',t=>{
 if(process.platform!=='darwin')return t.skip('Cocoa method controls run on macOS');
 const present=method('- (void)presentLocalWindow {','- (void)acceptLocalWorkbenchPresentation:');
 const accept=method('- (void)acceptLocalWorkbenchPresentation:','- (void)applicationDidBecomeActive:');
 const dir=mkdtempSync(join(tmpdir(),'ynx-ready-window-'));
 try {
 writeFileSync(join(dir,'test.m'),`#import <Foundation/Foundation.h>
@interface FakeApp:NSObject
- (void)activateIgnoringOtherApps:(BOOL)value;
@end
@implementation FakeApp
- (void)activateIgnoringOtherApps:(BOOL)value{}
@end
static FakeApp *NSApp;
@interface FakeWindow:NSObject
@property NSUInteger shows;
- (void)makeKeyAndOrderFront:(id)sender;
- (void)makeFirstResponder:(id)sender;
- (void)displayIfNeeded;
@end
@implementation FakeWindow
- (void)makeKeyAndOrderFront:(id)sender{self.shows++;}
- (void)makeFirstResponder:(id)sender{}
- (void)displayIfNeeded{}
@end
@interface FakeView:NSObject
@property(strong) NSURL *URL;
@property(copy) void (^pending)(id,NSError*);
- (void)layoutSubtreeIfNeeded;
- (void)callAsyncJavaScript:(id)s arguments:(id)a inFrame:(id)f inContentWorld:(id)w completionHandler:(void(^)(id,NSError*))h;
@end
@implementation FakeView
- (void)layoutSubtreeIfNeeded{}
- (void)callAsyncJavaScript:(id)s arguments:(id)a inFrame:(id)f inContentWorld:(id)w completionHandler:(void(^)(id,NSError*))h{self.pending=h;}
@end
@interface WKContentWorld:NSObject
+ (id)pageWorld;
@end
@implementation WKContentWorld
+ (id)pageWorld{return nil;}
@end
@interface YNXWalletAdmissionBackendTask:NSObject
@property BOOL running;
@end
@implementation YNXWalletAdmissionBackendTask
@end
static BOOL YNXLocalEditorDocumentURL(NSURL *url,NSInteger port){return [url.host isEqual:@"127.0.0.1"]&&url.port.integerValue==port;}
@interface Owner:NSObject
@property BOOL localWindowPresented,localStartupFailed,localReadyComplete,localCloseRequest,localCommandDocumentReady;
@property NSUInteger localPresentationGeneration;
@property NSUInteger focusInstalls;
@property NSInteger port;
@property(strong) NSTimer *localPresentationDeadline;
@property(strong) FakeWindow *window;
@property(strong) FakeView *webView;
@property(strong) YNXWalletAdmissionBackendTask *server;
- (void)synchronizeLocalWindowVisibility;
- (void)recordLocalPresentation:(NSString *)phase;
- (void)installLocalProjectFocus;
@end
@implementation Owner
- (void)synchronizeLocalWindowVisibility{}
- (void)recordLocalPresentation:(NSString *)phase{}
- (void)installLocalProjectFocus{self.focusInstalls++;}
${present}
${accept}
@end
int main(){@autoreleasepool{
NSApp=[FakeApp new];Owner *o=[Owner new];o.window=[FakeWindow new];o.webView=[FakeView new];o.server=[YNXWalletAdmissionBackendTask new];o.server.running=YES;o.port=1234;o.webView.URL=[NSURL URLWithString:@"http://127.0.0.1:1234/"];
NSDictionary *body=@{@"action":@"workbench-ready",@"documentId":NSUUID.UUID.UUIDString};
[o acceptLocalWorkbenchPresentation:body];if(o.webView.pending||o.window.shows||o.focusInstalls)return 1;
o.localReadyComplete=YES;[o acceptLocalWorkbenchPresentation:body];if(!o.webView.pending||o.window.shows)return 2;
o.localPresentationGeneration++;o.webView.pending(@YES,nil);if(o.window.shows)return 3;
[o acceptLocalWorkbenchPresentation:body];o.webView.pending(@NO,nil);if(o.window.shows)return 4;
[o acceptLocalWorkbenchPresentation:body];o.localStartupFailed=YES;o.webView.pending(@YES,nil);if(o.window.shows||o.focusInstalls)return 5;
o.localStartupFailed=NO;[o acceptLocalWorkbenchPresentation:body];o.webView.pending(@YES,nil);if(o.window.shows!=1||!o.localCommandDocumentReady||o.focusInstalls!=1)return 6;
o.localCommandDocumentReady=NO;[o acceptLocalWorkbenchPresentation:body];o.webView.pending(@YES,nil);if(o.window.shows!=1||!o.localCommandDocumentReady)return 7;
return 0;}}
`);
 const c=spawnSync('/Library/Developer/CommandLineTools/usr/bin/clang',['-fobjc-arc','-fblocks','-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',join(dir,'test.m'),'-framework','Foundation','-o',join(dir,'test')],{encoding:'utf8',timeout:10000});assert.equal(c.status,0,c.stderr);
 const r=spawnSync(join(dir,'test'),[],{encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('failed initial file posts its real notification without waiting for hidden dismissal',async()=>{
 const dismissal=deferred();let notifications=0,settled=false;
 const initial=new NativeInitialFile({open:async()=>{throw Error('FILE_MISSING')}},{ready:Promise.resolve()},{error:()=>{notifications++;return dismissal.promise;}},{ynxDesktopFiles:{takeInitialFile:()=> 'file:///qa/missing.txt'}},class URI{});
 const pending=initial.onDidInitializeLayout().then(()=>{settled=true});await flush();
 assert.equal(notifications,1);assert.equal(settled,true);await pending;dismissal.resolve();
});
