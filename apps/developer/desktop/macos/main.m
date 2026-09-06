#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <WebKit/WebKit.h>
#import <sys/socket.h>
#import <netinet/in.h>

static NSString *YNXJSON(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static NSString *YNXOrigin(NSInteger port) { return [NSString stringWithFormat:@"http://127.0.0.1:%ld",(long)port]; }
static BOOL YNXTrustedFrame(WKFrameInfo *frame, NSInteger port) {
    WKSecurityOrigin *origin=frame.securityOrigin;
    return port>0 && port<=65535 && frame.mainFrame && [origin.protocol isEqualToString:@"http"] && [origin.host isEqualToString:@"127.0.0.1"] && origin.port==port;
}
static BOOL YNXTrustedMessage(WKScriptMessage *message, WKWebView *webView, NSInteger port) {
    return webView && message.webView==webView && YNXTrustedFrame(message.frameInfo,port);
}
static NSString *YNXOriginBoundScript(NSString *source, NSInteger port) {
    return [NSString stringWithFormat:@"if(location.origin===%@){%@}",YNXJSON(YNXOrigin(port)),source];
}
static void YNXEvaluateTrustedScript(WKWebView *webView, NSInteger port, NSString *source) {
    // A delayed Keychain/command reply cannot expose data after navigation.
    [webView evaluateJavaScript:YNXOriginBoundScript(source,port) completionHandler:nil];
}
typedef NS_ENUM(NSInteger, YNXNavigationDisposition) { YNXNavigationAllow, YNXNavigationCancel, YNXNavigationOpenExternal };
static YNXNavigationDisposition YNXMainNavigation(NSURL *url, NSInteger port, WKNavigationType type) {
    if([url.absoluteString isEqualToString:@"about:blank"])return YNXNavigationAllow;
    if(port>0 && [url.scheme isEqualToString:@"http"] && [url.host isEqualToString:@"127.0.0.1"] && url.port.integerValue==port)return YNXNavigationAllow;
    if(type==WKNavigationTypeLinkActivated && ([@"https" isEqualToString:url.scheme] || [@"http" isEqualToString:url.scheme]))return YNXNavigationOpenExternal;
    return YNXNavigationCancel;
}

static SEL YNXEditSelector(NSString *command) {
    if([command isEqualToString:@"selectAll"])return @selector(selectAll:);
    if([command isEqualToString:@"undo"])return @selector(undo:);
    if([command isEqualToString:@"redo"])return @selector(redo:);
    if([command isEqualToString:@"cut"])return @selector(cut:);
    if([command isEqualToString:@"copy"])return @selector(copy:);
    if([command isEqualToString:@"paste"])return @selector(paste:);
    return NULL;
}
static BOOL YNXShouldForwardNativeEdit(id route, NSError *error, BOOL sameWindow, BOOL sameResponder) {
    return !error && [route isEqual:@"native"] && sameWindow && sameResponder;
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

static NSURL *YNXWorkspaceSnapshotURL(void) {
    NSString *support=NSProcessInfo.processInfo.environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"];
    if(!support.length) support=[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YNXDeveloper"];
    return [NSURL fileURLWithPath:[support stringByAppendingPathComponent:@"workspace-ui/project-v1.json"]];
}
static BOOL YNXWorkspacePath(id value) {
    if(![value isKindOfClass:NSString.class])return NO;
    NSString *path=value;
    if(!path.length || path.length>240 || [path hasPrefix:@"/"] || [path containsString:@".."])return NO;
    NSCharacterSet *invalid=[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./ +@-"] invertedSet];
    if([path rangeOfCharacterFromSet:invalid].location!=NSNotFound)return NO;
    for(NSString *part in [path componentsSeparatedByString:@"/"])if(!part.length || [part isEqualToString:@"."])return NO;
    return YES;
}
static NSDictionary *YNXWorkspaceProject(id value) {
    if(![value isKindOfClass:NSDictionary.class]) return nil;
    NSDictionary *project=value; NSString *identifier=project[@"id"], *name=project[@"name"], *active=project[@"active"];
    if(![identifier isKindOfClass:NSString.class] || !identifier.length || identifier.length>160 || ![name isKindOfClass:NSString.class] || name.length>160 || ![active isKindOfClass:NSString.class]) return nil;
    NSCharacterSet *invalid=[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"] invertedSet];
    if([identifier rangeOfCharacterFromSet:invalid].location!=NSNotFound || ![project[@"files"] isKindOfClass:NSDictionary.class] || [project[@"files"] count]>256 || ![project[@"folders"] isKindOfClass:NSArray.class] || ![project[@"open"] isKindOfClass:NSArray.class] || ![project[@"revision"] isKindOfClass:NSNumber.class] || ![project[@"remoteRevision"] isKindOfClass:NSNumber.class]) return nil;
    NSDictionary *files=project[@"files"];
    for(id path in files)if(!YNXWorkspacePath(path) || ![files[path] isKindOfClass:NSString.class])return nil;
    if(active.length && !files[active])return nil;
    for(id path in project[@"folders"])if(!YNXWorkspacePath(path))return nil;
    for(id path in project[@"open"])if(!YNXWorkspacePath(path) || !files[path])return nil;
    NSData *fileData=[NSJSONSerialization dataWithJSONObject:files options:0 error:nil];
    if(!fileData || fileData.length>2*1024*1024)return nil;
    NSMutableDictionary *snapshot=[NSMutableDictionary dictionary];
    for(NSString *key in @[@"id",@"name",@"files",@"folders",@"open",@"active",@"revision",@"remoteRevision"]) snapshot[key]=project[key];
    NSData *encoded=[NSJSONSerialization dataWithJSONObject:snapshot options:0 error:nil];
    return encoded && encoded.length<=3*1024*1024 ? snapshot : nil;
}
static NSDictionary *YNXReadWorkspaceSnapshot(NSURL *url, NSError **error) {
    NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:url.path error:error];
    if(!attributes) { if((*error).code==NSFileReadNoSuchFileError || (*error).code==NSFileNoSuchFileError) *error=nil; return nil; }
    if(![attributes[NSFileType] isEqual:NSFileTypeRegular] || [attributes[NSFileSize] unsignedLongLongValue]>3*1024*1024) {
        *error=[NSError errorWithDomain:@"YNXWorkspace" code:1 userInfo:@{NSLocalizedDescriptionKey:@"The existing workspace recovery file is invalid; it was preserved."}]; return nil;
    }
    NSData *data=[NSData dataWithContentsOfURL:url options:0 error:error]; if(!data)return nil;
    id envelope=[NSJSONSerialization JSONObjectWithData:data options:0 error:error];
    NSDictionary *project=[envelope isKindOfClass:NSDictionary.class] && [envelope[@"schemaVersion"] isEqual:@1] ? YNXWorkspaceProject(envelope[@"project"]) : nil;
    if(!project && !*error) *error=[NSError errorWithDomain:@"YNXWorkspace" code:2 userInfo:@{NSLocalizedDescriptionKey:@"The existing workspace recovery file is invalid; it was preserved."}];
    return project;
}
static BOOL YNXWriteWorkspaceSnapshot(NSURL *url, id value, NSError **error) {
    NSDictionary *project=YNXWorkspaceProject(value);
    if(!project) { *error=[NSError errorWithDomain:@"YNXWorkspace" code:3 userInfo:@{NSLocalizedDescriptionKey:@"Workspace recovery data exceeded its safe limits."}]; return NO; }
    NSFileManager *fm=NSFileManager.defaultManager; NSURL *directory=url.URLByDeletingLastPathComponent;
    if(![fm createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:error])return NO;
    NSDictionary *attributes=[fm attributesOfItemAtPath:directory.path error:error];
    if(![attributes[NSFileType] isEqual:NSFileTypeDirectory])return NO;
    NSDictionary *existing=[fm attributesOfItemAtPath:url.path error:nil];
    if(existing && ![existing[NSFileType] isEqual:NSFileTypeRegular])return NO;
    NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"schemaVersion":@1,@"project":project} options:0 error:error];
    return data && [data writeToURL:url options:NSDataWritingAtomic error:error] && [fm setAttributes:@{NSFilePosixPermissions:@0600} ofItemAtPath:url.path error:error];
}

typedef NSDictionary *(^YNXSnapshotReader)(NSError **error);
@interface YNXWorkspaceBridge : NSObject <WKScriptMessageHandler>
@property(nonatomic,weak) WKWebView *webView;
@property(nonatomic,weak) NSWindow *window;
@property(nonatomic) NSInteger port;
@property(nonatomic,strong) NSDictionary *initialProject;
@property(nonatomic,strong) NSError *readError;
@property(nonatomic,strong) dispatch_queue_t ioQueue;
@property(nonatomic) BOOL restoring;
@property(nonatomic) BOOL restoreComplete;
- (void)restoreWithCompletion:(void (^)(NSError *))completion;
- (void)restoreUsingReader:(YNXSnapshotReader)reader completion:(void (^)(NSError *))completion;
- (void)saveProject:(id)value completion:(void (^)(NSError *))completion;
@end
@implementation YNXWorkspaceBridge
- (instancetype)init { if((self=[super init])) _ioQueue=dispatch_queue_create("com.ynxweb4.developer.workspace-io",DISPATCH_QUEUE_SERIAL); return self; }
- (void)restoreWithCompletion:(void (^)(NSError *))completion {
    NSURL *url=YNXWorkspaceSnapshotURL();
    [self restoreUsingReader:^NSDictionary *(NSError **error){return YNXReadWorkspaceSnapshot(url,error);} completion:completion];
}
- (void)restoreUsingReader:(YNXSnapshotReader)reader completion:(void (^)(NSError *))completion {
    if(_restoring){completion([NSError errorWithDomain:@"YNXWorkspace" code:6 userInfo:nil]);return;}
    _restoring=YES; _restoreComplete=NO;
    dispatch_async(_ioQueue, ^{
        NSError *error=nil; NSDictionary *project=reader(&error);
        dispatch_async(dispatch_get_main_queue(), ^{
            self.restoring=NO; self.readError=error; self.restoreComplete=error==nil;
            if(!error)self.initialProject=project;
            completion(error);
        });
    });
}
- (void)saveProject:(id)value completion:(void (^)(NSError *))completion {
    // No default/empty project can replace a snapshot that has not been read.
    if(!_restoreComplete || _restoring || _readError){completion(_readError?:[NSError errorWithDomain:@"YNXWorkspace" code:7 userInfo:nil]);return;}
    NSDictionary *project=YNXWorkspaceProject(value);
    if(!project){completion([NSError errorWithDomain:@"YNXWorkspace" code:3 userInfo:nil]);return;}
    NSURL *url=YNXWorkspaceSnapshotURL();
    dispatch_async(_ioQueue, ^{
        NSError *error=nil; BOOL saved=YNXWriteWorkspaceSnapshot(url,project,&error);
        if(!saved && !error)error=[NSError errorWithDomain:@"YNXWorkspace" code:4 userInfo:nil];
        dispatch_async(dispatch_get_main_queue(), ^{if(saved)self.initialProject=project;completion(error);});
    });
}
- (void)reply:(NSString *)job error:(NSError *)error {
    NSDictionary *event=error ? @{@"id":job,@"error":@"Workspace recovery or export could not be saved. Check available disk space and file permissions."} : @{@"id":job};
    YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWorkspaceResult(%@)",YNXJSON(event)]);
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if(!YNXTrustedMessage(message,_webView,_port) || ![message.name isEqualToString:@"workspace"])return;
    NSDictionary *body=[message.body isKindOfClass:NSDictionary.class]?message.body:nil;
    NSString *job=body[@"id"], *action=body[@"action"];
    if(![job isKindOfClass:NSString.class] || job.length>80 || ![action isKindOfClass:NSString.class])return;
    if([action isEqualToString:@"save-project"]) {
        [self saveProject:body[@"project"] completion:^(NSError *error){[self reply:job error:error];}]; return;
    }
    if([action isEqualToString:@"export-project"]) {
        NSString *content=body[@"content"], *filename=body[@"filename"];
        NSData *data=[content isKindOfClass:NSString.class]?[content dataUsingEncoding:NSUTF8StringEncoding]:nil;
        if(!data || data.length>3*1024*1024 || ![filename isKindOfClass:NSString.class] || filename.length>240 || ![filename.lastPathComponent isEqualToString:filename]) { [self reply:job error:[NSError errorWithDomain:@"YNXWorkspace" code:5 userInfo:nil]]; return; }
        NSSavePanel *panel=[NSSavePanel savePanel]; panel.nameFieldStringValue=filename;
        [panel beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){ NSError *error=nil; if(result==NSModalResponseOK)[data writeToURL:panel.URL options:NSDataWritingAtomic error:&error]; [self reply:job error:error]; }];
    }
}
@end

@interface YNXCommandBridge : NSObject <WKScriptMessageHandler>
@property(nonatomic,weak) WKWebView *webView;
@property(nonatomic,strong) NSURL *nodeURL;
@property(nonatomic,strong) NSMutableDictionary<NSString *,NSTask *> *processes;
@property(nonatomic,strong) NSLock *lock;
@property(nonatomic) NSInteger port;
- (instancetype)initWithWebView:(WKWebView *)webView nodeURL:(NSURL *)nodeURL;
@end

@implementation YNXCommandBridge
- (instancetype)initWithWebView:(WKWebView *)webView nodeURL:(NSURL *)nodeURL { if ((self=[super init])) { _webView=webView; _nodeURL=nodeURL; _processes=[NSMutableDictionary dictionary]; _lock=[NSLock new]; } return self; }
- (void)walletStorageReply:(NSString *)job ok:(BOOL)ok value:(id)value error:(NSString *)error {
    NSMutableDictionary *event=[@{ @"id":job, @"ok":@(ok) } mutableCopy]; if(value) event[@"value"]=value; if(error) event[@"error"]=error;
    NSString *json=YNXJSON(event); if(json)YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWalletStorageResult(%@)",json]);
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
    if(!YNXTrustedMessage(message,_webView,_port) || ![@[@"wallet",@"command"] containsObject:message.name])return;
    NSDictionary *body=[message.body isKindOfClass:NSDictionary.class]?message.body:nil;
    NSString *action=[body[@"action"] isKindOfClass:NSString.class]?body[@"action"]:nil, *job=[body[@"id"] isKindOfClass:NSString.class]?body[@"id"]:nil;
    if (!action.length || !job.length || job.length>80) return;
    if ([message.name isEqualToString:@"wallet"]) {
        if([@[@"storage-get",@"storage-set",@"storage-remove"] containsObject:action]) { [self handleWalletStorage:body action:action job:job]; return; }
        if([action isEqualToString:@"wallet-availability"]) { NSDictionary *availability=YNXWalletAvailability(); NSString *event=YNXJSON(@{ @"id":job,@"ok":@YES,@"installed":availability[@"installed"],@"schemeRegistered":availability[@"schemeRegistered"] }); YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWalletAvailabilityResult(%@)",event?:@"{}"]); return; }
        if(![action isEqualToString:@"open-authorization"]) return;
        NSString *value=[body[@"url"] isKindOfClass:NSString.class]?body[@"url"]:nil; NSURLComponents *parts=value.length?[NSURLComponents componentsWithString:value]:nil; NSArray<NSURLQueryItem *> *items=parts.queryItems;
        BOOL reviewedHost=[parts.host isEqualToString:@"authorize"]||[parts.host isEqualToString:@"developer-deploy"];
        NSString *request=items.count==1&&[items.firstObject.name isEqualToString:@"request"]?items.firstObject.value:nil;
        NSRegularExpression *base64url=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{80,8192}$" options:0 error:nil];
        BOOL populatedRequest=request && [base64url firstMatchInString:request options:0 range:NSMakeRange(0,request.length)]!=nil;
        BOOL exact=parts && [parts.scheme isEqualToString:@"ynxwallet"] && reviewedHost && parts.path.length==0 && !parts.fragment.length && populatedRequest;
        NSURL *resolved=exact?[NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:parts.URL]:nil;
        BOOL opened=resolved!=nil && [NSWorkspace.sharedWorkspace openURL:parts.URL]; NSString *event=YNXJSON(@{@"id":job,@"ok":@(opened),@"message":opened?@"YNX Wallet review opened.":@"YNX Wallet is not installed or rejected the exact authorization route."});
        YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWalletOpenResult(%@)",event?:@"{}"]); return;
    }
    if ([action isEqualToString:@"cancel"]) { [_lock lock]; NSTask *task=_processes[job]; [_lock unlock]; [task terminate]; return; }
    NSDictionary *payload=[body[@"payload"] isKindOfClass:NSDictionary.class]?body[@"payload"]:nil;
    if (![action isEqualToString:@"run"] || !payload) return;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{ [self run:job payload:payload]; });
}
- (BOOL)validPath:(NSString *)path { return path.length>0 && path.length<=240 && ![path hasPrefix:@"/"] && [path rangeOfString:@"\\"].location==NSNotFound && ![[path pathComponents] containsObject:@".."];
}
- (void)emit:(NSDictionary *)event { NSString *json=YNXJSON(event); if (!json) return; dispatch_async(dispatch_get_main_queue(), ^{ YNXEvaluateTrustedScript(self.webView,self.port,[NSString stringWithFormat:@"window.__ynxDesktopEvent(%@)",json]); }); }
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

@interface YNXAppDelegate : NSObject <NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate>
@property(nonatomic,strong) NSWindow *window; @property(nonatomic,strong) WKWebView *webView; @property(nonatomic,strong) YNXCommandBridge *bridge; @property(nonatomic,strong) NSTask *server; @property(nonatomic,strong) NSFileHandle *serverLog; @property(nonatomic) NSInteger port;
@property(nonatomic,strong) YNXWorkspaceBridge *workspaceBridge;
@property(nonatomic) BOOL nativeEditPending;
@property(nonatomic) NSUInteger workspaceRestoreAttempt;
@property(nonatomic,strong) NSAlert *workspaceRestoreAlert;
@end

@implementation YNXAppDelegate
- (NSURL *)resources { return NSBundle.mainBundle.resourceURL; }
- (NSURL *)nodeURL { return [[self resources] URLByAppendingPathComponent:@"runtime/node"]; }
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    _port=YNXAvailablePort(); _workspaceBridge=[YNXWorkspaceBridge new]; _workspaceBridge.port=_port;
    [self installMenus]; WKWebViewConfiguration *configuration=[WKWebViewConfiguration new]; WKUserContentController *controller=[WKUserContentController new];
    NSString *script=@"(()=>{const jobs=new Map(),walletJobs=new Map(),storageJobs=new Map();window.__ynxDesktopEvent=e=>{const j=jobs.get(e.id);if(!j)return;if(e.type==='chunk')j.onChunk(e.text);if(e.type==='done'){jobs.delete(e.id);j.resolve({code:e.code});}if(e.type==='error'){jobs.delete(e.id);j.reject(new Error(e.message));}};window.__ynxWalletOpenResult=e=>{const j=walletJobs.get(e.id);if(!j)return;walletJobs.delete(e.id);e.ok?j.resolve():j.reject(new Error(e.message));};window.__ynxWalletStorageResult=e=>{const j=storageJobs.get(e.id);if(!j)return;storageJobs.delete(e.id);e.ok?j.resolve(Object.hasOwn(e,'value')?e.value:null):j.reject(new Error(e.error||'Wallet secure storage failed.'));};const storage=(action,key,value)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();storageJobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action,id,key,...(value===undefined?{}:{value})});});globalThis.ynxDesktop={executeApprovedCommand(payload,options={}){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject,onChunk:options.onChunk||(()=>{})});options.signal?.addEventListener('abort',()=>window.webkit.messageHandlers.command.postMessage({action:'cancel',id}),{once:true});window.webkit.messageHandlers.command.postMessage({action:'run',id,payload});});}};globalThis.ynxDesktopWallet={openAuthorization(url){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();walletJobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action:'open-authorization',id,url});});},protectedStorage:{securityLevel:'os-protected',get:key=>storage('storage-get',key),set:(key,value)=>storage('storage-set',key,value),remove:key=>storage('storage-remove',key)}}})();";
    NSString *availabilityScript=@"(()=>{const jobs=new Map();window.__ynxWalletAvailabilityResult=e=>{const j=jobs.get(e.id);if(!j)return;jobs.delete(e.id);e.ok?j.resolve({walletInstalled:e.installed===true,schemeRegistered:e.schemeRegistered===true}):j.reject(new Error('Wallet availability check failed.'));};globalThis.ynxDesktopWallet.walletAvailability=()=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action:'wallet-availability',id});});})();";
    [controller addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(script,_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [controller addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(availabilityScript,_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    configuration.userContentController=controller; _webView=[[WKWebView alloc]initWithFrame:NSZeroRect configuration:configuration]; _bridge=[[YNXCommandBridge alloc]initWithWebView:_webView nodeURL:self.nodeURL]; _bridge.port=_port; [controller addScriptMessageHandler:_bridge name:@"command"]; [controller addScriptMessageHandler:_bridge name:@"wallet"];
    _window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1440,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO]; _window.title=@"YNX Developer — Testnet Preview (unsigned)"; _window.contentView=_webView; if(![_window setFrameUsingName:@"YNXDeveloperTestnetPreviewMainWindow"])[_window center]; [_window setFrameAutosaveName:@"YNXDeveloperTestnetPreviewMainWindow"]; _window.restorable=YES; [_window makeKeyAndOrderFront:nil];
    _webView.UIDelegate=self; _webView.navigationDelegate=self; _workspaceBridge.webView=_webView; _workspaceBridge.window=_window; [controller addScriptMessageHandler:_workspaceBridge name:@"workspace"];
    [self beginWorkspaceRestore];
}
- (void)beginWorkspaceRestore {
    if(_workspaceBridge.restoring)return;
    NSUInteger attempt=++_workspaceRestoreAttempt;
    [_webView loadHTMLString:@"<meta charset=utf-8><style>body{font:16px -apple-system;padding:48px;color:#111827}h1{color:#002FA7}</style><h1>Opening your saved workspace…</h1><p>If macOS asks for access to your workspace folder, allow access to continue.</p><p>Your saved project is being preserved.</p>" baseURL:nil];
    [_workspaceBridge restoreWithCompletion:^(NSError *error){
        if(attempt!=self.workspaceRestoreAttempt)return;
        if(self.workspaceRestoreAlert){[NSApp endSheet:self.workspaceRestoreAlert.window returnCode:NSModalResponseCancel];self.workspaceRestoreAlert=nil;}
        if(error){[self showWorkspaceRestoreIssue:NO];return;}
        [self finishWorkspaceRestore];
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,10*NSEC_PER_SEC),dispatch_get_main_queue(),^{
        if(attempt==self.workspaceRestoreAttempt && self.workspaceBridge.restoring)[self showWorkspaceRestoreIssue:YES];
    });
}
- (void)showWorkspaceRestoreIssue:(BOOL)pending {
    if(_workspaceRestoreAlert)return;
    NSAlert *alert=[NSAlert new]; _workspaceRestoreAlert=alert;
    alert.messageText=pending?@"Still opening your saved workspace":@"Your saved workspace could not be opened";
    alert.informativeText=pending?@"macOS may be waiting for folder access, or storage may be slow. You can keep waiting or quit. Your saved project has not been replaced.":@"Check access to your workspace folder and try again. Your saved project has not been replaced.";
    [alert addButtonWithTitle:pending?@"Keep Waiting":@"Try Again"]; [alert addButtonWithTitle:@"Quit"];
    [alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){
        if(self.workspaceRestoreAlert==alert)self.workspaceRestoreAlert=nil;
        if(result==NSAlertSecondButtonReturn)[NSApp terminate:nil];
        else if(result==NSAlertFirstButtonReturn && !pending)[self beginWorkspaceRestore];
    }];
}
- (void)finishWorkspaceRestore {
    if(!_workspaceBridge.restoreComplete)return;
    // Only a completed read (including a confirmed absent file) may initialize
    // Workbench. It never mounts and auto-saves a starter while recovery waits.
    NSString *workspaceScript=[NSString stringWithFormat:@"(()=>{if(location.origin!=='http://127.0.0.1:%ld')return;const jobs=new Map();window.__ynxWorkspaceResult=e=>{const job=jobs.get(e.id);if(!job)return;jobs.delete(e.id);e.error?job.reject(new Error(e.error)):job.resolve();};const request=(action,payload)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject});window.webkit.messageHandlers.workspace.postMessage({id,action,...payload});});window.ynxDesktopWorkspace={initialProject:%@,saveProject:project=>request('save-project',{project}),exportProject:(filename,content)=>request('export-project',{filename,content})};})();",(long)_port,YNXJSON(_workspaceBridge.initialProject?:[NSNull null])];
    [_webView.configuration.userContentController addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(workspaceScript,_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    if([self launchServer]) [self loadWhenReady:0]; else [self showFailure:@"The bundled local runtime could not start."];
}
- (BOOL)launchServer {
    if(![NSFileManager.defaultManager isExecutableFileAtPath:self.nodeURL.path]) return NO;
    NSURL *logs=[NSFileManager.defaultManager URLForDirectory:NSLibraryDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil]; logs=[[logs URLByAppendingPathComponent:@"Logs/YNXDeveloper" isDirectory:YES] URLByAppendingPathComponent:@"desktop-server.log"]; [NSFileManager.defaultManager createDirectoryAtURL:logs.URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil]; [@"" writeToURL:logs atomically:YES encoding:NSUTF8StringEncoding error:nil]; _serverLog=[NSFileHandle fileHandleForWritingToURL:logs error:nil];
    _server=[NSTask new]; _server.executableURL=self.nodeURL; _server.arguments=@[[[self resources] URLByAppendingPathComponent:@"server.mjs"].path]; NSMutableDictionary *environment=[NSProcessInfo.processInfo.environment mutableCopy]; environment[@"PORT"]=[NSString stringWithFormat:@"%ld",(long)_port]; _server.environment=environment; _server.standardOutput=_serverLog; _server.standardError=_serverLog; __weak typeof(self) weakSelf=self; _server.terminationHandler=^(NSTask *task){ if(task.terminationStatus!=0) dispatch_async(dispatch_get_main_queue(),^{[weakSelf showFailure:[NSString stringWithFormat:@"Local server exited with code %d. Log: ~/Library/Logs/YNXDeveloper/desktop-server.log",task.terminationStatus]];});}; NSError *error=nil; return [_server launchAndReturnError:&error];
}
- (void)loadWhenReady:(NSInteger)attempt { if(attempt>=60){[self showFailure:@"Local server did not become ready. Log: ~/Library/Logs/YNXDeveloper/desktop-server.log"];return;} NSURL *url=[NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%ld",(long)_port]]; NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:1]; [[[NSURLSession sharedSession]dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){dispatch_async(dispatch_get_main_queue(),^{if([(NSHTTPURLResponse*)response statusCode]==200)[self.webView loadRequest:[NSURLRequest requestWithURL:url]];else dispatch_after(dispatch_time(DISPATCH_TIME_NOW,150*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[self loadWhenReady:attempt+1];});});}]resume]; }
- (void)showFailure:(NSString *)message { NSString *html=[NSString stringWithFormat:@"<meta charset=utf-8><style>body{font:16px -apple-system;padding:48px;color:#111827}h1{color:#002FA7}button{padding:10px}</style><h1>YNX Developer Testnet Preview</h1><p>%@</p><p>No project, Wallet key, or deployment was changed.</p>",message]; [_webView loadHTMLString:html baseURL:nil]; }
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls { for(NSURL *url in urls){NSURLComponents *parts=[NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];NSArray<NSURLQueryItem *> *items=parts.queryItems;BOOL walletAuth=[parts.host isEqualToString:@"wallet-auth"]&&[parts.path isEqualToString:@"/callback"],deployment=[parts.host isEqualToString:@"deployment"]&&[parts.path isEqualToString:@"/callback"];BOOL exact=[parts.scheme isEqualToString:@"ynxdeveloper"]&&(walletAuth||deployment)&&!parts.fragment.length&&items.count==1&&[items.firstObject.name isEqualToString:@"response"]&&items.firstObject.value.length>32;if(!exact)continue;NSString *encoded=YNXJSON(url.absoluteString),*event=deployment?@"ynx-deployment-callback":@"ynx-wallet-callback";YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('%@',{detail:%@}))",event,encoded?:@"null"]);} }
- (void)click:(NSString *)selector { YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"document.querySelector('%@')?.click()",selector]); }
- (NSMenuItem *)editItem:(NSMenu *)menu title:(NSString *)title command:(NSString *)command key:(NSString *)key {
    NSMenuItem *item=[menu addItemWithTitle:title action:@selector(desktopEdit:) keyEquivalent:key];
    item.target=self; item.representedObject=command; return item;
}
- (void)installMenus { NSMenu *main=[NSMenu new]; NSApp.mainMenu=main; NSMenuItem *appItem=[NSMenuItem new];[main addItem:appItem];NSMenu *app=[NSMenu new];appItem.submenu=app;[app addItemWithTitle:@"About YNX Developer Testnet Preview" action:@selector(showAbout:) keyEquivalent:@""];[app addItem:[NSMenuItem separatorItem]];[app addItemWithTitle:@"Check for Updates…" action:@selector(checkUpdates:) keyEquivalent:@""];[app addItem:[NSMenuItem separatorItem]];[app addItemWithTitle:@"Quit YNX Developer" action:@selector(terminate:) keyEquivalent:@"q"]; NSMenuItem *fileItem=[NSMenuItem new];[main addItem:fileItem];NSMenu *file=[[NSMenu alloc]initWithTitle:@"File"];fileItem.submenu=file;[file addItemWithTitle:@"New File…" action:@selector(newProject:) keyEquivalent:@"n"];[file addItemWithTitle:@"Open Project…" action:@selector(openProject:) keyEquivalent:@"o"];[file addItemWithTitle:@"Save" action:@selector(save:) keyEquivalent:@"s"];NSMenuItem *export=[file addItemWithTitle:@"Export Project…" action:@selector(exportProject:) keyEquivalent:@"s"];export.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift; NSMenuItem *editItem=[NSMenuItem new];[main addItem:editItem];NSMenu *edit=[[NSMenu alloc]initWithTitle:@"Edit"];editItem.submenu=edit;[self editItem:edit title:@"Undo" command:@"undo" key:@"z"];NSMenuItem *redo=[self editItem:edit title:@"Redo" command:@"redo" key:@"z"];redo.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift;[edit addItem:[NSMenuItem separatorItem]];[self editItem:edit title:@"Cut" command:@"cut" key:@"x"];[self editItem:edit title:@"Copy" command:@"copy" key:@"c"];[self editItem:edit title:@"Paste" command:@"paste" key:@"v"];[self editItem:edit title:@"Select All" command:@"selectAll" key:@"a"]; NSMenuItem *windowItem=[NSMenuItem new];[main addItem:windowItem];NSMenu *windows=[[NSMenu alloc]initWithTitle:@"Window"];windowItem.submenu=windows;[windows addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];[windows addItemWithTitle:@"Bring All to Front" action:@selector(arrangeInFront:) keyEquivalent:@""]; }
- (void)dispatchWorkbenchCommand:(NSDictionary *)detail { YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('ynx-desktop-command',{detail:%@}))",YNXJSON(detail)]); }
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if(item.action==@selector(desktopEdit:))return !_nativeEditPending && NSApp.keyWindow.firstResponder!=nil;
    if(item.action==@selector(newProject:) || item.action==@selector(openProject:) || item.action==@selector(save:) || item.action==@selector(exportProject:))return _workspaceBridge.restoreComplete;
    return YES;
}
- (void)desktopEdit:(NSMenuItem *)sender {
    NSString *command=sender.representedObject;
    SEL selector=YNXEditSelector(command);
    NSWindow *window=NSApp.keyWindow;
    NSResponder *responder=window.firstResponder;
    if(!selector || !responder || _nativeEditPending)return;
    BOOL webResponder=window==_window && [responder isKindOfClass:NSView.class] && [(NSView *)responder isDescendantOf:_webView];
    if(!webResponder){
        // Native text fields in sheets retain their own responder/undo system.
        [NSApp sendAction:selector to:responder from:sender];
        return;
    }
    NSURL *url=_webView.URL;
    if(![url.scheme isEqualToString:@"http"] || ![url.host isEqualToString:@"127.0.0.1"] || url.port.integerValue!=_port)return;
    _nativeEditPending=YES;
    NSString *origin=[NSString stringWithFormat:@"http://127.0.0.1:%ld",(long)_port];
    [_webView callAsyncJavaScript:@"if(location.origin!==origin || typeof window.__ynxDesktopEdit!=='function')return 'blocked';return window.__ynxDesktopEdit(command);"
        arguments:@{@"command":command,@"origin":origin} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id route, NSError *error){
        self.nativeEditPending=NO;
        // No fallback after a handled, blocked or failed JS command. Never apply
        // an old menu operation to a different window or native responder.
        if(!YNXShouldForwardNativeEdit(route,error,NSApp.keyWindow==window,window.firstResponder==responder))return;
        // Exactly one genuine WebKit action produces Monaco's clipboard event,
        // or edits the ordinary input that the page router confirmed is focused.
        [NSApp sendAction:selector to:responder from:sender];
    }];
}
- (void)newProject:(id)sender { [self dispatchWorkbenchCommand:@{@"command":@"new-file"}]; }
- (void)openProject:(id)sender {
    NSOpenPanel *panel=[NSOpenPanel openPanel]; panel.canChooseFiles=YES; panel.canChooseDirectories=NO; panel.allowsMultipleSelection=NO; panel.allowedFileTypes=@[@"json"];
    [panel beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){
        if(result!=NSModalResponseOK)return;
        NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:panel.URL.path error:nil];
        NSData *data=[attributes[NSFileSize] unsignedLongLongValue]<=2359296 ? [NSData dataWithContentsOfURL:panel.URL] : nil;
        NSString *content=data?[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]:nil;
        if(!content){NSAlert *alert=[NSAlert new];alert.messageText=@"Project import could not be read";alert.informativeText=@"Choose a UTF-8 project JSON file within the 2 MiB workspace limit.";[alert beginSheetModalForWindow:self.window completionHandler:nil];return;}
        [self dispatchWorkbenchCommand:@{@"command":@"import-project",@"filename":panel.URL.lastPathComponent,@"content":content}];
    }];
}
- (void)save:(id)sender { [self dispatchWorkbenchCommand:@{@"command":@"save"}]; }
- (void)exportProject:(id)sender { [self dispatchWorkbenchCommand:@{@"command":@"export-project"}]; }
- (BOOL)trustedFrame:(WKFrameInfo *)frame { return YNXTrustedFrame(frame,_port); }
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    if(view!=_webView){decisionHandler(WKNavigationActionPolicyCancel);return;}
    if(action.targetFrame && !action.targetFrame.mainFrame){decisionHandler(WKNavigationActionPolicyAllow);return;}
    YNXNavigationDisposition disposition=YNXMainNavigation(action.request.URL,_port,action.navigationType);
    decisionHandler(disposition==YNXNavigationAllow?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
    if(disposition==YNXNavigationOpenExternal)[NSWorkspace.sharedWorkspace openURL:action.request.URL];
}
- (void)webView:(WKWebView *)view runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler(nil);return;}
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseFiles=YES;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;
    [panel beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler(result==NSModalResponseOK?panel.URLs:nil);}];
}
- (void)webView:(WKWebView *)view runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler();return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Developer";alert.informativeText=message;[alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler();}];
}
- (void)webView:(WKWebView *)view runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler(NO);return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Developer";alert.informativeText=message;[alert addButtonWithTitle:@"Continue"];[alert addButtonWithTitle:@"Cancel"];
    [alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler(result==NSAlertFirstButtonReturn);}];
}
- (void)webView:(WKWebView *)view runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString *))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler(nil);return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Developer";alert.informativeText=prompt;[alert addButtonWithTitle:@"Create"];[alert addButtonWithTitle:@"Cancel"];
    NSTextField *field=[[NSTextField alloc]initWithFrame:NSMakeRect(0,0,360,24)];field.stringValue=defaultText?:@"";alert.accessoryView=field;
    [alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler(result==NSAlertFirstButtonReturn?field.stringValue:nil);}];
}
- (void)showAbout:(id)sender{NSAlert *a=[NSAlert new];a.messageText=@"YNX Developer Testnet Preview";a.informativeText=@"Unsigned ad-hoc local build for YNX public testnet engineering. It is not a production-signed desktop release.";[a runModal];} - (void)checkUpdates:(id)sender{NSAlert *a=[NSAlert new];a.messageText=@"Updates require signed release metadata";a.informativeText=@"This unsigned Testnet Preview never downloads or installs updates automatically.";[a runModal];}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if(!_webView || !_workspaceBridge || !_workspaceBridge.restoreComplete)return NSTerminateNow;
    // Wait for the real Workbench's current snapshot and native disk ACK. A
    // random-port relaunch must not race the final edited character at quit.
    [_webView callAsyncJavaScript:@"if(location.origin!==origin)throw new Error('Workspace origin changed');if (typeof window.__ynxFlushWorkspace === 'function') await window.__ynxFlushWorkspace();" arguments:@{@"origin":YNXOrigin(_port)} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result, NSError *error){
        if(!error){[sender replyToApplicationShouldTerminate:YES];return;}
        NSAlert *alert=[NSAlert new];alert.messageText=@"Workspace recovery could not be saved";alert.informativeText=@"Keep editing to retry Save, or quit without saving the latest changes.";[alert addButtonWithTitle:@"Keep Editing"];[alert addButtonWithTitle:@"Quit Without Saving"];
        [sender replyToApplicationShouldTerminate:[alert runModal]==NSAlertSecondButtonReturn];
    }];
    return NSTerminateLater;
}
- (void)applicationWillTerminate:(NSNotification *)note{if(_server.running){[_server terminate];[_server waitUntilExit];}[_serverLog closeFile];} - (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender{return YES;} - (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag{if(!flag)[_window makeKeyAndOrderFront:nil];return YES;}
@end

int main(int argc,const char *argv[]){@autoreleasepool{if(argc>=3&&!strcmp(argv[1],"--self-test")){NSURL *resources=[NSURL fileURLWithPath:@(argv[2])];BOOL web=[NSFileManager.defaultManager fileExistsAtPath:[[resources URLByAppendingPathComponent:@"code/apps/developer/frontend/dist/index.html"]path]],gateway=[NSFileManager.defaultManager fileExistsAtPath:[[resources URLByAppendingPathComponent:@"code/apps/developer/services/gateway/src/server.mjs"]path]],node=[NSFileManager.defaultManager isExecutableFileAtPath:[[resources URLByAppendingPathComponent:@"runtime/node"]path]];if(!web||!gateway||!node)return 2;if(!YNXWalletStorageSelfTest())return 4;NSDictionary *availability=YNXWalletAvailability();NSTask *task=[NSTask new];task.executableURL=[resources URLByAppendingPathComponent:@"runtime/node"];task.arguments=@[@"--version"];task.standardOutput=[NSPipe pipe];NSError *error=nil;if(![task launchAndReturnError:&error])return 3;[task waitUntilExit];printf("YNX Developer YNX Code resources, bundled runtime and Keychain session storage OK\n");printf("YNX Wallet scheme state: installed=%s schemeRegistered=%s\n",[availability[@"installed"] boolValue]?"true":"false",[availability[@"schemeRegistered"] boolValue]?"true":"false");return task.terminationStatus;}NSApplication *app=NSApplication.sharedApplication;YNXAppDelegate *delegate=[YNXAppDelegate new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app activateIgnoringOtherApps:YES];[app run];}return 0;}
