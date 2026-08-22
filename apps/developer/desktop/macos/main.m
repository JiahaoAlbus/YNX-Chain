#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <WebKit/WebKit.h>
#import <sys/socket.h>
#import <netinet/in.h>

static NSString *YNXJSON(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static NSString *const YNXWalletStorageService = @"com.ynxweb4.developer.product-session-v2";
static BOOL YNXWalletStorageKey(NSString *key) {
    return key.length > 24 && key.length <= 256 && [key hasPrefix:@"ynx.product-session.v2:developer:macos:com.ynxweb4.developer.testnetpreview"];
}
static NSDictionary *YNXWalletAvailability(void) {
    // Native availability cannot safely probe a bare or synthetic authorization
    // route. The exact populated URI is resolved immediately before opening.
    return @{ @"installed":@NO, @"schemeRegistered":@NO };
}
static BOOL YNXWalletStorageSelfTest(void) {
    NSString *account=[NSString stringWithFormat:@"ynx.product-session.v2:developer:macos:com.ynxweb4.developer.testnetpreview:self-test:%@",NSUUID.UUID.UUIDString];
    NSData *expected=[@"ynx-wallet-storage-self-test" dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *query=@{ (__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService:YNXWalletStorageService, (__bridge id)kSecAttrAccount:account };
    SecItemDelete((__bridge CFDictionaryRef)query);
    NSMutableDictionary *insert=[query mutableCopy]; insert[(__bridge id)kSecValueData]=expected; insert[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    OSStatus status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL); if(status!=errSecSuccess)return NO;
    NSMutableDictionary *read=[query mutableCopy]; read[(__bridge id)kSecReturnData]=@YES; read[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne; CFTypeRef result=nil;
    status=SecItemCopyMatching((__bridge CFDictionaryRef)read,&result); NSData *actual=CFBridgingRelease(result); BOOL matches=status==errSecSuccess&&[actual isEqualToData:expected];
    OSStatus removed=SecItemDelete((__bridge CFDictionaryRef)query); return matches&&(removed==errSecSuccess||removed==errSecItemNotFound);
}

static NSInteger YNXAvailablePort(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0); if (fd < 0) return 4177;
    struct sockaddr_in address = {0}; address.sin_len = sizeof(address); address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); address.sin_port = 0;
    if (bind(fd, (struct sockaddr *)&address, sizeof(address)) != 0) { close(fd); return 4177; }
    socklen_t length = sizeof(address); getsockname(fd, (struct sockaddr *)&address, &length); close(fd); return ntohs(address.sin_port);
}

@interface YNXCommandBridge : NSObject <WKScriptMessageHandler>
@property(nonatomic,weak) WKWebView *webView;
@property(nonatomic,strong) NSURL *nodeURL;
@property(nonatomic,strong) NSMutableDictionary<NSString *,NSTask *> *processes;
@property(nonatomic,strong) NSLock *lock;
- (instancetype)initWithWebView:(WKWebView *)webView nodeURL:(NSURL *)nodeURL;
@end

@implementation YNXCommandBridge
- (instancetype)initWithWebView:(WKWebView *)webView nodeURL:(NSURL *)nodeURL { if ((self=[super init])) { _webView=webView; _nodeURL=nodeURL; _processes=[NSMutableDictionary dictionary]; _lock=[NSLock new]; } return self; }
- (void)walletStorageReply:(NSString *)job ok:(BOOL)ok value:(id)value error:(NSString *)error {
    NSMutableDictionary *event=[@{ @"id":job, @"ok":@(ok) } mutableCopy]; if(value) event[@"value"]=value; if(error) event[@"error"]=error;
    NSString *json=YNXJSON(event); if(json)[_webView evaluateJavaScript:[NSString stringWithFormat:@"window.__ynxWalletStorageResult(%@)",json] completionHandler:nil];
}
- (void)handleWalletStorage:(NSDictionary *)body action:(NSString *)action job:(NSString *)job {
    NSString *key=[body[@"key"] isKindOfClass:NSString.class]?body[@"key"]:nil, *value=[body[@"value"] isKindOfClass:NSString.class]?body[@"value"]:nil;
    if(!YNXWalletStorageKey(key) || ([action isEqualToString:@"storage-set"] && (!value || value.length > 32768))) { [self walletStorageReply:job ok:NO value:nil error:@"Wallet secure-storage request is invalid."]; return; }
    NSDictionary *query=@{ (__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService:YNXWalletStorageService, (__bridge id)kSecAttrAccount:key };
    if([action isEqualToString:@"storage-get"]) {
        NSMutableDictionary *read=[query mutableCopy]; read[(__bridge id)kSecReturnData]=@YES; read[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne; CFTypeRef result=nil; OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)read,&result);
        if(status==errSecItemNotFound){ [self walletStorageReply:job ok:YES value:[NSNull null] error:nil]; return; }
        NSData *data=CFBridgingRelease(result); NSString *stored=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]; if(status!=errSecSuccess || !stored){ [self walletStorageReply:job ok:NO value:nil error:@"Wallet secure storage is unavailable."]; return; }
        [self walletStorageReply:job ok:YES value:stored error:nil]; return;
    }
    if([action isEqualToString:@"storage-remove"]) { OSStatus status=SecItemDelete((__bridge CFDictionaryRef)query); [self walletStorageReply:job ok:(status==errSecSuccess||status==errSecItemNotFound) value:nil error:status==errSecSuccess||status==errSecItemNotFound?nil:@"Wallet secure storage could not remove the session."]; return; }
    NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding]; OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)@{ (__bridge id)kSecValueData:data });
    if(status==errSecItemNotFound){ NSMutableDictionary *insert=[query mutableCopy]; insert[(__bridge id)kSecValueData]=data; insert[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL); }
    [self walletStorageReply:job ok:status==errSecSuccess value:nil error:status==errSecSuccess?nil:@"Wallet secure storage could not protect the session."];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    NSDictionary *body=[message.body isKindOfClass:NSDictionary.class]?message.body:nil; NSString *action=body[@"action"], *job=body[@"id"];
    if (!action.length || !job.length) return;
    if ([message.name isEqualToString:@"wallet"]) {
        if([@[@"storage-get",@"storage-set",@"storage-remove"] containsObject:action]) { [self handleWalletStorage:body action:action job:job]; return; }
        if([action isEqualToString:@"wallet-availability"]) { NSDictionary *availability=YNXWalletAvailability(); NSString *event=YNXJSON(@{ @"id":job,@"ok":@YES,@"installed":availability[@"installed"],@"schemeRegistered":availability[@"schemeRegistered"] }); [_webView evaluateJavaScript:[NSString stringWithFormat:@"window.__ynxWalletAvailabilityResult(%@)",event?:@"{}"] completionHandler:nil]; return; }
        if(![action isEqualToString:@"open-authorization"]) return;
        NSString *value=[body[@"url"] isKindOfClass:NSString.class]?body[@"url"]:nil; NSURLComponents *parts=value.length?[NSURLComponents componentsWithString:value]:nil; NSArray<NSURLQueryItem *> *items=parts.queryItems;
        BOOL reviewedHost=[parts.host isEqualToString:@"authorize"]||[parts.host isEqualToString:@"developer-deploy"];
        NSString *request=items.count==1&&[items.firstObject.name isEqualToString:@"request"]?items.firstObject.value:nil;
        NSRegularExpression *base64url=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{80,8192}$" options:0 error:nil];
        BOOL populatedRequest=request && [base64url firstMatchInString:request options:0 range:NSMakeRange(0,request.length)]!=nil;
        BOOL exact=parts && [parts.scheme isEqualToString:@"ynxwallet"] && reviewedHost && parts.path.length==0 && !parts.fragment.length && populatedRequest;
        NSURL *resolved=exact?[NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:parts.URL]:nil;
        BOOL opened=resolved!=nil && [NSWorkspace.sharedWorkspace openURL:parts.URL]; NSString *event=YNXJSON(@{@"id":job,@"ok":@(opened),@"message":opened?@"YNX Wallet review opened.":@"YNX Wallet is not installed or rejected the exact authorization route."});
        [_webView evaluateJavaScript:[NSString stringWithFormat:@"window.__ynxWalletOpenResult(%@)",event?:@"{}"] completionHandler:nil]; return;
    }
    if ([action isEqualToString:@"cancel"]) { [_lock lock]; NSTask *task=_processes[job]; [_lock unlock]; [task terminate]; return; }
    NSDictionary *payload=[body[@"payload"] isKindOfClass:NSDictionary.class]?body[@"payload"]:nil;
    if (![action isEqualToString:@"run"] || !payload) return;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{ [self run:job payload:payload]; });
}
- (BOOL)validPath:(NSString *)path { return path.length>0 && path.length<=240 && ![path hasPrefix:@"/"] && [path rangeOfString:@"\\"].location==NSNotFound && ![[path pathComponents] containsObject:@".."];
}
- (void)emit:(NSDictionary *)event { NSString *json=YNXJSON(event); if (!json) return; dispatch_async(dispatch_get_main_queue(), ^{ [self.webView evaluateJavaScript:[NSString stringWithFormat:@"window.__ynxDesktopEvent(%@)",json] completionHandler:nil]; }); }
- (void)run:(NSString *)job payload:(NSDictionary *)payload {
    @try {
        NSString *task=payload[@"task"], *projectID=payload[@"projectId"]; NSDictionary *files=[payload[@"files"] isKindOfClass:NSDictionary.class]?payload[@"files"]:nil;
        NSCharacterSet *unsafe=[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"] invertedSet];
        if (![@[@"test",@"check"] containsObject:task] || !projectID.length || [projectID rangeOfCharacterFromSet:unsafe].location!=NSNotFound || files.count<1 || files.count>500) @throw [NSException exceptionWithName:@"InvalidRequest" reason:@"Invalid bounded command request" userInfo:nil];
        NSFileManager *fm=NSFileManager.defaultManager; NSURL *support=[fm URLForDirectory:NSApplicationSupportDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil]; NSURL *project=[[support URLByAppendingPathComponent:@"YNXDeveloper/Workspaces" isDirectory:YES] URLByAppendingPathComponent:projectID isDirectory:YES];
        [fm removeItemAtURL:project error:nil]; [fm createDirectoryAtURL:project withIntermediateDirectories:YES attributes:nil error:nil];
        __block NSUInteger total=0; NSMutableArray<NSString *> *targets=[NSMutableArray array];
        [files enumerateKeysAndObjectsUsingBlock:^(NSString *path, NSString *content, BOOL *stop) {
            NSData *data=[content isKindOfClass:NSString.class]?[content dataUsingEncoding:NSUTF8StringEncoding]:nil; if (![self validPath:path] || !data || data.length>524288) @throw [NSException exceptionWithName:@"InvalidProject" reason:@"Invalid project file" userInfo:nil]; total+=data.length; if(total>5242880) @throw [NSException exceptionWithName:@"InvalidProject" reason:@"Project exceeds five MiB" userInfo:nil];
            NSURL *target=[project URLByAppendingPathComponent:path]; [fm createDirectoryAtURL:target.URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil]; [data writeToURL:target options:NSDataWritingAtomic error:nil];
            BOOL selected=[task isEqualToString:@"test"]?([path hasPrefix:@"test/"]&&[path hasSuffix:@".test.js"]):[path hasSuffix:@".js"]; if(selected)[targets addObject:target.path];
        }];
        if(!targets.count) @throw [NSException exceptionWithName:@"NoTargets" reason:@"No allowlisted task targets" userInfo:nil];
        NSString *escaped=[project.path stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"]; escaped=[escaped stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""];
        NSString *profile=[NSString stringWithFormat:@"(version 1)\n(allow default)\n(deny network*)\n(deny file-write* (require-not (subpath \"%@\")) (require-not (subpath \"/private/tmp\")) (require-not (subpath \"/dev\")))",escaped];
        NSTask *process=[NSTask new]; process.executableURL=[NSURL fileURLWithPath:@"/usr/bin/sandbox-exec"]; NSMutableArray *arguments=[NSMutableArray arrayWithObjects:@"-p",profile,self.nodeURL.path,nil]; if([task isEqualToString:@"test"])[arguments addObject:@"--test"]; else [arguments addObject:@"--check"]; [arguments addObjectsFromArray:targets]; process.arguments=arguments; process.currentDirectoryURL=project;
        NSPipe *pipe=[NSPipe pipe]; process.standardOutput=pipe; process.standardError=pipe; pipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *handle){ NSData *data=handle.availableData; if(data.length){NSString *text=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]; if(text)[self emit:@{@"id":job,@"type":@"chunk",@"text":text}];}};
        process.terminationHandler=^(NSTask *finished){ pipe.fileHandleForReading.readabilityHandler=nil; [self.lock lock]; [self.processes removeObjectForKey:job]; [self.lock unlock]; [self emit:@{@"id":job,@"type":@"done",@"code":@(finished.terminationStatus)}]; };
        [_lock lock]; _processes[job]=process; [_lock unlock]; NSError *error=nil; if(![process launchAndReturnError:&error]) @throw [NSException exceptionWithName:@"LaunchFailed" reason:error.localizedDescription userInfo:nil];
    } @catch(NSException *exception) { [self emit:@{@"id":job,@"type":@"error",@"message":exception.reason?:@"Desktop command failed"}]; }
}
@end

@interface YNXAppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic,strong) NSWindow *window; @property(nonatomic,strong) WKWebView *webView; @property(nonatomic,strong) YNXCommandBridge *bridge; @property(nonatomic,strong) NSTask *server; @property(nonatomic,strong) NSFileHandle *serverLog; @property(nonatomic) NSInteger port;
@end

@implementation YNXAppDelegate
- (NSURL *)resources { return NSBundle.mainBundle.resourceURL; }
- (NSURL *)nodeURL { return [[self resources] URLByAppendingPathComponent:@"runtime/node"]; }
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    [self installMenus]; WKWebViewConfiguration *configuration=[WKWebViewConfiguration new]; WKUserContentController *controller=[WKUserContentController new];
    NSString *script=@"(()=>{const jobs=new Map(),walletJobs=new Map(),storageJobs=new Map();window.__ynxDesktopEvent=e=>{const j=jobs.get(e.id);if(!j)return;if(e.type==='chunk')j.onChunk(e.text);if(e.type==='done'){jobs.delete(e.id);j.resolve({code:e.code});}if(e.type==='error'){jobs.delete(e.id);j.reject(new Error(e.message));}};window.__ynxWalletOpenResult=e=>{const j=walletJobs.get(e.id);if(!j)return;walletJobs.delete(e.id);e.ok?j.resolve():j.reject(new Error(e.message));};window.__ynxWalletStorageResult=e=>{const j=storageJobs.get(e.id);if(!j)return;storageJobs.delete(e.id);e.ok?j.resolve(Object.hasOwn(e,'value')?e.value:null):j.reject(new Error(e.error||'Wallet secure storage failed.'));};const storage=(action,key,value)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();storageJobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action,id,key,...(value===undefined?{}:{value})});});globalThis.ynxDesktop={executeApprovedCommand(payload,options={}){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject,onChunk:options.onChunk||(()=>{})});options.signal?.addEventListener('abort',()=>window.webkit.messageHandlers.command.postMessage({action:'cancel',id}),{once:true});window.webkit.messageHandlers.command.postMessage({action:'run',id,payload});});}};globalThis.ynxDesktopWallet={openAuthorization(url){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();walletJobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action:'open-authorization',id,url});});},protectedStorage:{securityLevel:'os-protected',get:key=>storage('storage-get',key),set:(key,value)=>storage('storage-set',key,value),remove:key=>storage('storage-remove',key)}}})();";
    NSString *availabilityScript=@"(()=>{const jobs=new Map();window.__ynxWalletAvailabilityResult=e=>{const j=jobs.get(e.id);if(!j)return;jobs.delete(e.id);e.ok?j.resolve({walletInstalled:e.installed===true,schemeRegistered:e.schemeRegistered===true}):j.reject(new Error('Wallet availability check failed.'));};globalThis.ynxDesktopWallet.walletAvailability=()=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action:'wallet-availability',id});});})();";
    [controller addUserScript:[[WKUserScript alloc]initWithSource:script injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [controller addUserScript:[[WKUserScript alloc]initWithSource:availabilityScript injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    configuration.userContentController=controller; _webView=[[WKWebView alloc]initWithFrame:NSZeroRect configuration:configuration]; _bridge=[[YNXCommandBridge alloc]initWithWebView:_webView nodeURL:self.nodeURL]; [controller addScriptMessageHandler:_bridge name:@"command"]; [controller addScriptMessageHandler:_bridge name:@"wallet"];
    _window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1440,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO]; _window.title=@"YNX Developer — Testnet Preview (unsigned)"; _window.contentView=_webView; if(![_window setFrameUsingName:@"YNXDeveloperTestnetPreviewMainWindow"])[_window center]; [_window setFrameAutosaveName:@"YNXDeveloperTestnetPreviewMainWindow"]; _window.restorable=YES; [_window makeKeyAndOrderFront:nil];
    if([self launchServer]) [self loadWhenReady:0]; else [self showFailure:@"The bundled local runtime could not start."];
}
- (BOOL)launchServer {
    if(![NSFileManager.defaultManager isExecutableFileAtPath:self.nodeURL.path]) return NO; _port=YNXAvailablePort();
    NSURL *logs=[NSFileManager.defaultManager URLForDirectory:NSLibraryDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil]; logs=[[logs URLByAppendingPathComponent:@"Logs/YNXDeveloper" isDirectory:YES] URLByAppendingPathComponent:@"desktop-server.log"]; [NSFileManager.defaultManager createDirectoryAtURL:logs.URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil]; [@"" writeToURL:logs atomically:YES encoding:NSUTF8StringEncoding error:nil]; _serverLog=[NSFileHandle fileHandleForWritingToURL:logs error:nil];
    _server=[NSTask new]; _server.executableURL=self.nodeURL; _server.arguments=@[[[self resources] URLByAppendingPathComponent:@"server.mjs"].path]; NSMutableDictionary *environment=[NSProcessInfo.processInfo.environment mutableCopy]; environment[@"PORT"]=[NSString stringWithFormat:@"%ld",(long)_port]; _server.environment=environment; _server.standardOutput=_serverLog; _server.standardError=_serverLog; __weak typeof(self) weakSelf=self; _server.terminationHandler=^(NSTask *task){ if(task.terminationStatus!=0) dispatch_async(dispatch_get_main_queue(),^{[weakSelf showFailure:[NSString stringWithFormat:@"Local server exited with code %d. Log: ~/Library/Logs/YNXDeveloper/desktop-server.log",task.terminationStatus]];});}; NSError *error=nil; return [_server launchAndReturnError:&error];
}
- (void)loadWhenReady:(NSInteger)attempt { if(attempt>=60){[self showFailure:@"Local server did not become ready. Log: ~/Library/Logs/YNXDeveloper/desktop-server.log"];return;} NSURL *url=[NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%ld",(long)_port]]; NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:1]; [[[NSURLSession sharedSession]dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){dispatch_async(dispatch_get_main_queue(),^{if([(NSHTTPURLResponse*)response statusCode]==200)[self.webView loadRequest:[NSURLRequest requestWithURL:url]];else dispatch_after(dispatch_time(DISPATCH_TIME_NOW,150*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[self loadWhenReady:attempt+1];});});}]resume]; }
- (void)showFailure:(NSString *)message { NSString *html=[NSString stringWithFormat:@"<meta charset=utf-8><style>body{font:16px -apple-system;padding:48px;color:#111827}h1{color:#002FA7}button{padding:10px}</style><h1>YNX Developer Testnet Preview</h1><p>%@</p><p>No project, Wallet key, or deployment was changed.</p>",message]; [_webView loadHTMLString:html baseURL:nil]; }
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls { for(NSURL *url in urls){NSURLComponents *parts=[NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];NSArray<NSURLQueryItem *> *items=parts.queryItems;BOOL walletAuth=[parts.host isEqualToString:@"wallet-auth"]&&[parts.path isEqualToString:@"/callback"],deployment=[parts.host isEqualToString:@"deployment"]&&[parts.path isEqualToString:@"/callback"];BOOL exact=[parts.scheme isEqualToString:@"ynxdeveloper"]&&(walletAuth||deployment)&&!parts.fragment.length&&items.count==1&&[items.firstObject.name isEqualToString:@"response"]&&items.firstObject.value.length>32;if(!exact)continue;NSString *encoded=YNXJSON(url.absoluteString),*event=deployment?@"ynx-deployment-callback":@"ynx-wallet-callback";[_webView evaluateJavaScript:[NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('%@',{detail:%@}))",event,encoded?:@"null"] completionHandler:nil];} }
- (void)click:(NSString *)selector { [_webView evaluateJavaScript:[NSString stringWithFormat:@"document.querySelector('%@')?.click()",selector] completionHandler:nil]; }
- (void)installMenus { NSMenu *main=[NSMenu new]; NSApp.mainMenu=main; NSMenuItem *appItem=[NSMenuItem new];[main addItem:appItem];NSMenu *app=[NSMenu new];appItem.submenu=app;[app addItemWithTitle:@"About YNX Developer Testnet Preview" action:@selector(showAbout:) keyEquivalent:@""];[app addItem:[NSMenuItem separatorItem]];[app addItemWithTitle:@"Check for Updates…" action:@selector(checkUpdates:) keyEquivalent:@""];[app addItem:[NSMenuItem separatorItem]];[app addItemWithTitle:@"Quit YNX Developer" action:@selector(terminate:) keyEquivalent:@"q"]; NSMenuItem *fileItem=[NSMenuItem new];[main addItem:fileItem];NSMenu *file=[[NSMenu alloc]initWithTitle:@"File"];fileItem.submenu=file;[file addItemWithTitle:@"New Project…" action:@selector(newProject:) keyEquivalent:@"n"];[file addItemWithTitle:@"Open Project…" action:@selector(openProject:) keyEquivalent:@"o"];[file addItemWithTitle:@"Save" action:@selector(save:) keyEquivalent:@"s"];NSMenuItem *export=[file addItemWithTitle:@"Export Project…" action:@selector(exportProject:) keyEquivalent:@"s"];export.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift; NSMenuItem *windowItem=[NSMenuItem new];[main addItem:windowItem];NSMenu *windows=[[NSMenu alloc]initWithTitle:@"Window"];windowItem.submenu=windows;[windows addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];[windows addItemWithTitle:@"Bring All to Front" action:@selector(arrangeInFront:) keyEquivalent:@""]; }
- (void)newProject:(id)sender{[self click:@"#create-project"];} - (void)openProject:(id)sender{[self click:@"#import-project"];} - (void)save:(id)sender{[_webView evaluateJavaScript:@"document.querySelector('#editor')?.dispatchEvent(new Event('input',{bubbles:true}))" completionHandler:nil];} - (void)exportProject:(id)sender{[self click:@"#export-project"];}
- (void)showAbout:(id)sender{NSAlert *a=[NSAlert new];a.messageText=@"YNX Developer Testnet Preview";a.informativeText=@"Unsigned ad-hoc local build for YNX public testnet engineering. It is not a production-signed desktop release.";[a runModal];} - (void)checkUpdates:(id)sender{NSAlert *a=[NSAlert new];a.messageText=@"Updates require signed release metadata";a.informativeText=@"This unsigned Testnet Preview never downloads or installs updates automatically.";[a runModal];}
- (void)applicationWillTerminate:(NSNotification *)note{if(_server.running){[_server terminate];[_server waitUntilExit];}[_serverLog closeFile];} - (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender{return YES;} - (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag{if(!flag)[_window makeKeyAndOrderFront:nil];return YES;}
@end

int main(int argc,const char *argv[]){@autoreleasepool{if(argc>=3&&!strcmp(argv[1],"--self-test")){NSURL *resources=[NSURL fileURLWithPath:@(argv[2])];BOOL web=[NSFileManager.defaultManager fileExistsAtPath:[[resources URLByAppendingPathComponent:@"code/apps/developer/frontend/dist/index.html"]path]],gateway=[NSFileManager.defaultManager fileExistsAtPath:[[resources URLByAppendingPathComponent:@"code/apps/developer/services/gateway/src/server.mjs"]path]],node=[NSFileManager.defaultManager isExecutableFileAtPath:[[resources URLByAppendingPathComponent:@"runtime/node"]path]];if(!web||!gateway||!node)return 2;if(!YNXWalletStorageSelfTest())return 4;NSDictionary *availability=YNXWalletAvailability();NSTask *task=[NSTask new];task.executableURL=[resources URLByAppendingPathComponent:@"runtime/node"];task.arguments=@[@"--version"];task.standardOutput=[NSPipe pipe];NSError *error=nil;if(![task launchAndReturnError:&error])return 3;[task waitUntilExit];printf("YNX Developer YNX Code resources, bundled runtime and Keychain session storage OK\n");printf("YNX Wallet scheme state: installed=%s schemeRegistered=%s\n",[availability[@"installed"] boolValue]?"true":"false",[availability[@"schemeRegistered"] boolValue]?"true":"false");return task.terminationStatus;}NSApplication *app=NSApplication.sharedApplication;YNXAppDelegate *delegate=[YNXAppDelegate new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app activateIgnoringOtherApps:YES];[app run];}return 0;}
