// Isolated actual launcher code, real owned NSTask/Wait and optional original
// helper/kernel IPC. No NSApplication, WebKit process, panel or funds created.
#define main QAActualLauncherMain
#import "launcher.m"
#undef main
static NSUInteger checks=0;
static NSMutableArray<NSTask*> *ownedTasks;
static NSTask *ownedHelper;
static void cleanupOwned(void){for(NSTask *task in [ownedTasks arrayByAddingObjectsFromArray:ownedHelper?@[ownedHelper]:@[]]){if(task.running){[task terminate];double until=QANativeClock()+2;while(task.running&&QANativeClock()<until)[NSThread sleepForTimeInterval:0.01];if(task.running)kill(task.processIdentifier,SIGKILL);[task waitUntilExit];}}}
static void check(BOOL ok,NSString *name){checks++;if(!ok){fprintf(stderr,"FAIL %s\n",name.UTF8String);exit(1);}printf("PASS %s\n",name.UTF8String);}
static NSDictionary *request(NSString *identifier,NSString *operation){NSMutableDictionary *r=[@{@"version":QANativeIPCVersion,@"id":identifier,@"operation":operation}mutableCopy];if(![operation isEqual:@"status"])r[@"payload"]=@{};return r;}
static NSDictionary *response(NSString *identifier,NSString *operation){return @{@"version":QANativeIPCVersion,@"id":identifier,@"code":@"OK",@"peer":@{@"uid":@(geteuid()),@"gid":@(getegid()),@"credentialSource":@"PUBLIC_CONTROLLED_FIXTURE",@"nativeIPCVerified":@YES,@"browserIdentityVerified":@NO},@"result":[operation isEqual:@"status"]?@{@"status":@{@"service":@"YNX Network",@"nodeControl":@"unavailable",@"resourceContribution":@"disabled"}}:@{@"payload":@{@"code":@"NOT_SUPPLIED",@"authority":@NO,@"productionEnabled":@NO}}};}
static NSDictionary *body(NSString *operation,NSDictionary *payload){return @{@"version":QANativeVersion,@"type":@"request",@"id":@"n_controlled",@"session":@"controlled-session",@"helperGeneration":@"7",@"documentGeneration":@"3",@"operation":operation,@"payload":payload};}
static NSDictionary *invoke(NSString *helper,NSString *data,NSDictionary *build,NSDictionary *r,BOOL cancel){
  QANativeInvocation *call=[QANativeInvocation new];__block NSDictionary *value=nil;__block BOOL done=NO,onMain=NO;
  [call startHelper:helper data:data build:build request:r completion:^(NSDictionary *reply,NSString *code,NSString *outcome){onMain=NSThread.isMainThread;value=@{@"response":reply?:@{},@"code":code?:@"",@"outcome":outcome?:@""};done=YES;}];
  if(cancel)dispatch_after(dispatch_time(DISPATCH_TIME_NOW,150*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[call cancel];});
  NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:20];while(!done&&deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  if(call.task)[ownedTasks addObject:call.task];
  check(done&&onMain,[@"one original task completed via Wait on main callback: "stringByAppendingString:r[@"id"]]);
  check(!call.task.running,[@"exact owned child no longer running: "stringByAppendingString:r[@"id"]]);return value;
}
@interface NativeTestTask:NSObject
@property(getter=isRunning) BOOL running;
@end
@implementation NativeTestTask
@end
@interface NativeTestWeb:NSObject
@property NSURL *URL;@property NSMutableArray *calls;
@end
@implementation NativeTestWeb
-(instancetype)init{if((self=[super init]))_calls=[NSMutableArray array];return self;}
-(void)callAsyncJavaScript:(NSString*)function arguments:(NSDictionary*)arguments inFrame:(id)frame inContentWorld:(id)world completionHandler:(id)handler{[self.calls addObject:@{@"function":function,@"arguments":arguments}];}
@end
@interface NativeTestOrigin:NSObject
@property NSString *protocol;@property NSString *host;@property NSInteger port;
@end
@implementation NativeTestOrigin
@end
@interface NativeTestFrame:NSObject
@property BOOL isMainFrame;@property NativeTestOrigin *securityOrigin;
@end
@implementation NativeTestFrame
@end
@interface NativeTestMessage:NSObject
@property NSString *name;@property NativeTestWeb *webView;@property NativeTestFrame *frameInfo;@property id body;
@end
@implementation NativeTestMessage
@end
@interface NativeDeferredTest:QAApp
@property NSUInteger finishes;
@end
@implementation NativeDeferredTest
-(NSApplicationTerminateReply)finishTermination{self.finishes++;return NSTerminateLater;}
@end
static int booleanDelta(void){
 NativeTestTask *task=[NativeTestTask new];task.running=YES;NativeTestWeb *web=[NativeTestWeb new];web.URL=[NSURL URLWithString:@"http://127.0.0.1:15432/#node"];QAApp *app=[QAApp new];app.task=(NSTask*)task;app.web=(WKWebView*)web;app.origin=@"http://127.0.0.1:15432";app.generation=7;app.documentGeneration=3;app.documentReady=YES;app.nativeSession=@"controlled-session";
 [app nativeResult:response(@"n_controlled",@"node_status") code:nil outcome:nil identifier:@"n_controlled" session:@"controlled-session" helper:7 document:3 origin:app.origin];
 NSDictionary *value=web.calls.lastObject[@"arguments"][@"value"];
 check(CFGetTypeID((__bridge CFTypeRef)value[@"ok"])==CFBooleanGetTypeID()&&[value[@"ok"]isEqual:@YES],@"actual success native-result ok is CFBoolean before WebKit arguments");
 NSString *json=[[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil]encoding:NSUTF8StringEncoding];check([json containsString:@"\"ok\":true"]&&! [json containsString:@"\"ok\":1"],@"success wire value remains JSON true not number1");
 [app nativeResult:nil code:@"NATIVE_BUSY" outcome:@"NOT_SENT" identifier:@"n_controlled" session:@"controlled-session" helper:7 document:3 origin:app.origin];value=web.calls.lastObject[@"arguments"][@"value"];
 check(CFGetTypeID((__bridge CFTypeRef)value[@"ok"])==CFBooleanGetTypeID()&&[value[@"ok"]isEqual:@NO],@"actual failed native-result ok is CFBoolean");
 json=[[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil]encoding:NSUTF8StringEncoding];check([json containsString:@"\"ok\":false"]&&[value[@"code"]isEqual:@"NATIVE_BUSY"]&&[value[@"outcome"]isEqual:@"NOT_SENT"],@"failure wire false preserves original outcome without approval");
 NSUInteger before=web.calls.count;app.documentGeneration++;
 [app nativeResult:response(@"n_controlled",@"node_status") code:nil outcome:nil identifier:@"n_controlled" session:@"controlled-session" helper:7 document:3 origin:app.origin];check(web.calls.count==before,@"actual stale document result still suppressed");
 printf("SUMMARY BOOLEAN %lu passed; actual original host nativeResult boundary; no GUI or task\n",(unsigned long)checks);return 0;
}
static int resolveDelta(void){
  check(QANativeOperations().count==22&&[QANativeOperations()containsObject:@"participation_resolve"],@"resolve is exact22nd original operation");
  NSString *alias=[@"p09.alias:"stringByPaddingToLength:128 withString:@"A" startingAtIndex:0];
  NSDictionary *r=QANativeRequest(body(@"participation_resolve",@{@"requestId":alias}),@"controlled-session",7,3);
  check(r&&[r[@"operation"]isEqual:@"participation_resolve"]&&[r[@"payload"]count]==1&&[r[@"payload"][@"requestId"]isEqual:alias],@"resolve exact128B dotted colon alias preserved as payload not packet ID");
  for(id invalid in @[@{},@{@"id":@"entry"},@{@"requestId":@""},@{@"requestId":@"foreign/path"},@{@"requestId":@"空"},@{@"requestId":@1},@{@"requestId":@"actual",@"path":@"/journal"},@{@"requestId":@"actual",@"allow":@"true"},@{@"requestId":@"actual",@"operationId":@"Main-UUID"}])check(!QANativePayload(@"participation_resolve",invalid),@"resolve rejects wrong field type identity authority or path");
  check(!QANativePayload(@"participation_resolve",@{@"requestId":[alias stringByAppendingString:@"A"]})&&!QANativePayload(@"participation_resolve_extra",@{@"requestId":@"real"}),@"resolve reference128 cap and exact operation only");
  check(QANativePayload(@"participation_prepare",@{@"requestId":alias,@"owner":@"fixture",@"action":@"withdraw",@"feeCapYnxt":@"1",@"expiresAt":@"fixture"}),@"prepare and resolve reuse same original Service.reference grammar");
  check(!QANativeRequest(body(@"participation_resolve",@{@"requestId":alias}),@"old-session",7,3)&&!QANativeRequest(body(@"participation_resolve",@{@"requestId":alias}),@"controlled-session",7,4),@"resolve retains original session and document generation fence");
  NSMutableDictionary *reply=[response(@"n_controlled",@"participation_resolve")mutableCopy];reply[@"result"]=@{@"payload":@{@"code":@"OK",@"resolvedRequestId":alias,@"entry":@{@"id":@"original-entry",@"intent":@{@"request":@{@"requestId":@"first-original"}}},@"authority":@NO,@"walletApproval":@NO}};
  NSData *raw=[NSJSONSerialization dataWithJSONObject:reply options:0 error:nil];NSDictionary *observed=QANativeResponse(raw,@"n_controlled",@"participation_resolve");
  check([observed[@"result"][@"payload"][@"resolvedRequestId"]isEqual:alias]&&[observed[@"result"][@"payload"][@"entry"][@"intent"][@"request"][@"requestId"]isEqual:@"first-original"],@"resolve preserves queried alias plus immutable first intent without approval");
  check(!QANativeResponse(raw,@"different-packet-id",@"participation_resolve"),@"resolve mismatched packet result rejected");
  reply[@"result"]=@{@"payload":@{@"code":@"NOT_FOUND",@"resolvedRequestId":alias,@"authority":@NO,@"walletApproval":@NO}};observed=QANativeResponse([NSJSONSerialization dataWithJSONObject:reply options:0 error:nil],@"n_controlled",@"participation_resolve");check([observed[@"result"][@"payload"][@"code"]isEqual:@"NOT_FOUND"],@"resolve absence remains original NOT_FOUND DATA no replacement");
  NativeTestTask *task=[NativeTestTask new];task.running=YES;NativeTestWeb *web=[NativeTestWeb new];web.URL=[NSURL URLWithString:@"http://127.0.0.1:15432/index.html"];QAApp *app=[QAApp new];app.task=(NSTask*)task;app.web=(WKWebView*)web;app.origin=@"http://127.0.0.1:15432";app.generation=7;app.documentGeneration=3;app.documentReady=YES;app.nativeSession=@"controlled-session";
  NativeTestOrigin *origin=[NativeTestOrigin new];origin.protocol=@"http";origin.host=@"127.0.0.1";origin.port=15432;NativeTestFrame *frame=[NativeTestFrame new];frame.securityOrigin=origin;frame.isMainFrame=NO;NativeTestMessage *message=[NativeTestMessage new];message.name=@"networkNative";message.webView=web;message.frameInfo=frame;message.body=body(@"participation_resolve",@{@"requestId":alias});
  [app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check(!web.calls.count&&!app.nativeCall,@"resolve iframe rejected before original operation or task");frame.isMainFrame=YES;origin.port=15433;[app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check(!web.calls.count&&!app.nativeCall,@"resolve wrong helper origin rejected before task");origin.port=15432;app.nativeCall=[QANativeInvocation new];[app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check([web.calls.lastObject[@"arguments"][@"value"][@"code"]isEqual:@"NATIVE_BUSY"]&&[web.calls.lastObject[@"arguments"][@"value"][@"outcome"]isEqual:@"NOT_SENT"],@"resolve shares original one-inflight gate no second task");
  printf("SUMMARY RESOLVE %lu passed; PUBLIC_CONTROLLED protocol only; zero task launch reader Wallet prepare sign submit or GUI\n",(unsigned long)checks);return 0;
}
int main(int argc,const char **argv){@autoreleasepool{
  if(argc==3&&strcmp(argv[2],"--boolean-delta")==0)return booleanDelta();
  if(argc==3&&strcmp(argv[2],"--resolve-delta")==0)return resolveDelta();
  if(argc==4&&strcmp(argv[1],"--native-call")==0){
    if(strcmp(argv[2],"--data-dir")||getenv("HOME")||getenv("PATH")||strcmp(getenv("LANG")?:"","C"))return 3;
    NSData *raw=[NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];if(raw.length>16384)return 4;
    NSDictionary *r=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];NSString *identifier=r[@"id"];
    if([identifier isEqual:@"timeout"]||[identifier isEqual:@"cancel"]){signal(SIGTERM,SIG_IGN);sleep(30);return 5;}
    if([identifier isEqual:@"huge"]){char buf[4096];memset(buf,'x',sizeof(buf));for(int i=0;i<40;i++)write(STDOUT_FILENO,buf,sizeof(buf));return 0;}
    if([identifier isEqual:@"stderr"])write(STDERR_FILENO,"controlled failure",18);
    if([identifier isEqual:@"exit"])return 9;
    NSData *out=[NSJSONSerialization dataWithJSONObject:response([identifier isEqual:@"mismatch"]?@"different-id":identifier,r[@"operation"]) options:0 error:nil];write(STDOUT_FILENO,out.bytes,out.length);return 0;
  }
  if(argc<2||argc>3)return 2;ownedTasks=[NSMutableArray array];atexit(cleanupOwned);NSString *dir=@(argv[1]);check(privateDirectory(dir),@"isolated private data directory");NSString *helper=@(argv[0]);NSDictionary *build=@{@"helperSHA256":digest(helper)};
  check(QANativeOperations().count==22&&[QANativeOperations()containsObject:@"node_restart"]&&[QANativeOperations()containsObject:@"participation_list"]&&[QANativeOperations()containsObject:@"participation_resolve"],@"exact22 enumerated original operations including restart list and resolve");
  check(QANativeBudget(@"node_restart")==140&&QANativeBudget(@"node_start")==70&&QANativeBudget(@"status")==12,@"original Native decision budgets are fixed");
  NSDictionary *r=QANativeRequest(body(@"status",@{}),@"controlled-session",7,3);check(r&&r[@"payload"]==nil,@"status omits payload for actual original protocol");
  check(QANativeRequest(body(@"participation_review",@{@"id":@"original-id"}),@"controlled-session",7,3)!=nil,@"exact original correlation ID accepted");
  check(!QANativeRequest(body(@"status",@{}),@"old-session",7,3)&&!QANativeRequest(body(@"status",@{}),@"controlled-session",8,3)&&!QANativeRequest(body(@"status",@{}),@"controlled-session",7,4),@"stale session helper and document generations denied");
  for(NSString *key in @[@"path",@"uid",@"binary",@"argv",@"allow",@"RawE5"])check(!QANativePayload(@"resource_status",@{key:@"caller-selected"}),[@"caller control denied: "stringByAppendingString:key]);
  check(!QANativePayload(@"resource_execute",@{})&&!QANativePayload(@"node_shell",@{})&&!QANativePayload(@"participation_sign",@{})&&!QANativePayload(@"request_permission",@{}),@"prefix and permission escalation operations denied");
  check(!QANativePayload(@"participation_review",@{@"id":@"../other"})&&!QANativePayload(@"resource_review",@{@"approved":@YES}),@"business identifier and approval injection denied");
  check(QANativePayload(@"participation_list",@{})&&QANativePayload(@"participation_list",@{@"cursor":@"opaque-original",@"limit":@50}),@"original list empty and bounded cursor limit accepted");
  for(id limit in @[NSNull.null,@YES,@0,@51,@1.5,@"20"])check(!QANativePayload(@"participation_list",@{@"limit":limit}),@"noninteger or out-of-range list limit denied");
  check(!QANativePayload(@"participation_list",@{@"cursor":[@"x"stringByPaddingToLength:513 withString:@"x" startingAtIndex:0]}),@"opaque cursor bounded512 bytes");
  NSString *large=[@"x"stringByPaddingToLength:QANativePayloadLimit withString:@"x" startingAtIndex:0];check(!QANativePayload(@"participation_prepare",@{@"requestId":@"bounded",@"owner":@"fixture",@"action":@"withdraw",@"feeCapYnxt":@"1",@"expiresAt":large}),@"typed payload total bounded12KiB");
  check(QANativeExecutable(helper,dir,build),@"actual fixed executable SHA current owner permissions validated");check(!QANativeExecutable(helper,dir,@{@"helperSHA256":[@"0"stringByPaddingToLength:64 withString:@"0" startingAtIndex:0]}),@"changed executable pin denied");
  NSMutableDictionary *bad=[response(@"expected",@"resource_status")mutableCopy];NSMutableDictionary *peer=[bad[@"peer"]mutableCopy];bad[@"peer"]=peer;peer[@"uid"]=@((double)geteuid()+0.5);check(!QANativeResponse([NSJSONSerialization dataWithJSONObject:bad options:0 error:nil],@"expected",@"resource_status"),@"fractional caller identity cannot coerce original kernel UID");peer[@"uid"]=@(geteuid());peer[@"nativeIPCVerified"]=@1;check(!QANativeResponse([NSJSONSerialization dataWithJSONObject:bad options:0 error:nil],@"expected",@"resource_status"),@"numeric one cannot coerce original verified boolean");
  QAApp *unbound=[QAApp new];[unbound invalidateNativeBridge];check(!unbound.nativeSession&&!unbound.nativeCall,@"startup without bound origin invalidates safely without WebKit or process");
  NSString *link=[dir stringByAppendingPathComponent:@"helper-link"];symlink(helper.fileSystemRepresentation,link.fileSystemRepresentation);check(!QANativeExecutable(link,dir,build),@"helper symlink denied");unlink(link.fileSystemRepresentation);
  NativeTestTask *task=[NativeTestTask new];task.running=YES;NativeTestWeb *web=[NativeTestWeb new];web.URL=[NSURL URLWithString:@"http://127.0.0.1:15432/index.html"];QAApp *app=[QAApp new];app.web=(WKWebView*)web;app.task=(NSTask*)task;app.origin=@"http://127.0.0.1:15432";app.generation=7;app.documentGeneration=3;app.documentReady=YES;app.nativeSession=@"controlled-session";
  NativeTestOrigin *origin=[NativeTestOrigin new];origin.protocol=@"http";origin.host=@"127.0.0.1";origin.port=15432;NativeTestFrame *frame=[NativeTestFrame new];frame.securityOrigin=origin;frame.isMainFrame=NO;NativeTestMessage *message=[NativeTestMessage new];message.name=@"networkNative";message.webView=web;message.frameInfo=frame;message.body=@{@"version":QANativeVersion,@"type":@"hello"};
  [app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check(!web.calls.count&&!app.nativeCall,@"iframe cannot reach Native bridge");frame.isMainFrame=YES;origin.port=15433;[app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check(!web.calls.count&&!app.nativeCall,@"wrong helper port cannot reach bridge");origin.port=15432;
  message.webView=[NativeTestWeb new];[app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check(!web.calls.count&&!app.nativeCall,@"different WebKit surface denied");message.webView=web;
  [app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check(web.calls.count==1&&[web.calls.lastObject[@"arguments"][@"value"][@"session"]isEqual:@"controlled-session"],@"exact main frame receives only current session metadata");
  app.nativeCall=[QANativeInvocation new];message.body=body(@"resource_status",@{});[app userContentController:(WKUserContentController*)message didReceiveScriptMessage:(WKScriptMessage*)message];check([web.calls.lastObject[@"arguments"][@"value"][@"code"]isEqual:@"NATIVE_BUSY"]&&[web.calls.lastObject[@"arguments"][@"value"][@"outcome"]isEqual:@"NOT_SENT"],@"second inflight rejected before another task");
  NSUInteger calls=web.calls.count;[app nativeResult:response(@"n_controlled",@"resource_status") code:nil outcome:@"UNKNOWN" identifier:@"n_controlled" session:@"controlled-session" helper:6 document:3 origin:app.origin];check(web.calls.count==calls,@"late previous helper result discarded");
  [app webView:(WKWebView*)web didStartProvisionalNavigation:nil];check(!app.documentReady&&!app.nativeSession&&app.nativeCall.cancelled&&app.documentGeneration==4,@"navigation retires session and cancels only original held task");
  __block BOOL stopped=NO;[app stopOwnedThen:^{stopped=YES;}];check(!stopped&&app.nativeDrainCompletion!=nil,@"helper replacement waits for original native-call before successor endpoint exists");task.running=NO;app.nativeCall=nil;[app finishNativeDrain];check(stopped&&app.nativeDrainCompletion==nil,@"actual native-call completion releases one helper replacement barrier");
  NativeDeferredTest *closing=[NativeDeferredTest new];closing.terminationPending=YES;closing.nativeCall=[QANativeInvocation new];[closing finishDeferredTerminationIfNeeded];check(!closing.finishes,@"termination waits while original task handle is held");closing.nativeCall=nil;[closing finishDeferredTerminationIfNeeded];check(closing.finishes==1&&!closing.terminationPending,@"one Wait completion permits one deferred termination");
  NSDictionary *good=invoke(helper,dir,build,request(@"good",@"resource_status"),NO);check([good[@"code"]isEqual:@""]&&[good[@"response"][@"result"][@"payload"][@"code"]isEqual:@"NOT_SUPPLIED"],@"bounded actual subprocess result preserves unsupported DATA");
  NSDictionary *goodStatus=invoke(helper,dir,build,request(@"good-status",@"status"),NO);check(goodStatus[@"response"][@"result"][@"status"]!=nil,@"actual subprocess status uses original no-payload protocol");
  for(NSString *identifier in @[@"huge",@"stderr",@"exit",@"mismatch"]){NSDictionary *value=invoke(helper,dir,build,request(identifier,@"resource_status"),NO);check([value[@"code"]hasPrefix:@"NATIVE_"]&&[value[@"outcome"]isEqual:@"UNKNOWN"],[@"malformed lost or oversized result remains UNKNOWN: "stringByAppendingString:identifier]);}
  NSDictionary *cancelled=invoke(helper,dir,build,request(@"cancel",@"resource_status"),YES);check([cancelled[@"code"]isEqual:@"NATIVE_DOCUMENT_CHANGED"]&&[cancelled[@"outcome"]isEqual:@"UNKNOWN"],@"cancelled owned client has one Wait and no replay");
  double start=QANativeClock();NSDictionary *timeout=invoke(helper,dir,build,request(@"timeout",@"resource_status"),NO);check([timeout[@"code"]isEqual:@"NATIVE_TIMEOUT"]&&[timeout[@"outcome"]isEqual:@"UNKNOWN"]&&QANativeClock()-start<18,@"real12s deadline terminates exact task and Wait without replay");
  NSDictionary *changed=invoke(helper,dir,@{@"helperSHA256":@"bad"},request(@"no-launch",@"resource_status"),NO);check([changed[@"code"]isEqual:@"NATIVE_HELPER_CHANGED"]&&[changed[@"outcome"]isEqual:@"NOT_SENT"],@"unmatched bundle helper never launched");
  if(argc==3){
    NSString *actual=@(argv[2]),*data=[dir stringByAppendingPathComponent:@"real"];check(privateDirectory(data),@"actual original helper private directory");NSTask *owned=[NSTask new];ownedHelper=owned;owned.executableURL=[NSURL fileURLWithPath:actual];owned.arguments=@[@"--listen",@"127.0.0.1:0",@"--data-dir",data];NSPipe *startup=[NSPipe pipe];owned.standardOutput=startup;owned.standardError=startup;NSError *error=nil;check([owned launchAndReturnError:&error],@"actual original helper launched through normal CLI");
    NSString *socket=[data stringByAppendingPathComponent:@"ipc/network-helper.sock"];struct stat st;NSDate *ready=[NSDate dateWithTimeIntervalSinceNow:10];while(owned.running&&lstat(socket.fileSystemRepresentation,&st)&&ready.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    check(owned.running&&!lstat(socket.fileSystemRepresentation,&st)&&S_ISSOCK(st.st_mode),@"original helper real IPC endpoint ready");
    NSDictionary *real=invoke(actual,data,@{@"helperSHA256":digest(actual)},request(@"actual-status",@"status"),NO);check([real[@"code"]isEqual:@""]&&[real[@"response"][@"peer"][@"nativeIPCVerified"]isEqual:@YES]&&[real[@"response"][@"peer"][@"browserIdentityVerified"]isEqual:@NO]&&[real[@"response"][@"result"][@"status"][@"service"]isEqual:@"YNX Network"],@"actual fixed helper native-call and real kernel peer status returned unchanged");
    [owned terminate];NSDate *end=[NSDate dateWithTimeIntervalSinceNow:8];while(owned.running&&end.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];check(!owned.running,@"actual original helper normal shutdown completed");[owned waitUntilExit];check(owned.terminationStatus==0,@"actual original helper normal Wait exit0");[startup.fileHandleForReading closeFile];
  }
  printf("SUMMARY %lu passed; no GUI, no WebKit process, no real funds; controlled subprocess fixtures separate from optional actual original helper/kernel IPC\n",(unsigned long)checks);return 0;
}}
