#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <sys/stdio.h>
#import <unistd.h>
#import "proof_profile.h"

static const NSUInteger QAExportLimit=4<<20;
static BOOL QAExportHash(id value,BOOL prefix) {
  if(![value isKindOfClass:NSString.class])return NO;NSString *text=value;
  if(prefix&&[text hasPrefix:@"0x"])text=[text substringFromIndex:2];
  return text.length==64&&[text rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"]invertedSet]].location==NSNotFound;
}
static NSString *QAExportTx(NSString *value){NSString *hash=[value hasPrefix:@"0x"]?[value substringFromIndex:2]:value;return hash.lowercaseString;}
static BOOL QAExportKeys(NSDictionary *value,NSArray *allowed,NSArray *required) {
  if(![value isKindOfClass:NSDictionary.class])return NO;NSSet *keys=[NSSet setWithArray:value.allKeys];
  return [keys isSubsetOfSet:[NSSet setWithArray:allowed]]&&[[NSSet setWithArray:required]isSubsetOfSet:keys];
}
static NSArray *QAPreferenceLocales(void){return @[@"en",@"zh-Hans",@"zh-Hant",@"ja",@"ko",@"es",@"fr",@"de",@"pt",@"ru",@"ar",@"id"];}
static BOOL QAPreferenceLocale(id value){return [value isKindOfClass:NSString.class]&&[QAPreferenceLocales()containsObject:value];}
static BOOL QAPreferenceTheme(id value){return [value isKindOfClass:NSString.class]&&[@[@"light",@"dark",@"system"]containsObject:value];}
static NSDictionary *QAPreferenceValues(id body) {
  if(!QAExportKeys(body,@[@"version",@"locale",@"theme"],@[@"version",@"locale",@"theme"])||![body[@"version"]isEqual:@"YNX-NETWORK-UI-PREFERENCES/v1"]||!QAPreferenceLocale(body[@"locale"])||!QAPreferenceTheme(body[@"theme"]))return nil;
  return @{@"locale":body[@"locale"],@"theme":body[@"theme"]};
}
static BOOL QAPreferenceDomain(NSString *domain){return [domain isKindOfClass:NSString.class]&&[domain hasPrefix:@"dev.ynx.network.qa."]&&domain.length<160;}
static NSDictionary *QAPreferenceRead(NSUserDefaults *defaults,NSString *domain) {
  NSDictionary *stored=defaults&&QAPreferenceDomain(domain)?[defaults persistentDomainForName:domain]:nil;
  id locale=stored[@"ynxNetworkLocale"],theme=stored[@"ynxNetworkTheme"];
  return @{@"locale":QAPreferenceLocale(locale)?locale:@"zh-Hans",@"theme":QAPreferenceTheme(theme)?theme:@"light"};
}
static BOOL QAPreferenceStore(NSUserDefaults *defaults,NSString *domain,id body) {
  NSDictionary *values=QAPreferenceValues(body);if(!defaults||!QAPreferenceDomain(domain)||!values)return NO;
  // standardUserDefaults writes only the current App's domain. Never select a
  // suite/domain from JavaScript, replace a domain, synchronize, or store tickets.
  [defaults setObject:values[@"locale"] forKey:@"ynxNetworkLocale"];
  [defaults setObject:values[@"theme"] forKey:@"ynxNetworkTheme"];return YES;
}
static NSString *QAPreferenceBootstrap(NSDictionary *values,NSString *origin) {
  NSURL *local=[origin isKindOfClass:NSString.class]?[NSURL URLWithString:origin]:nil;BOOL loopback=[local.scheme isEqual:@"http"]&&[local.host isEqual:@"127.0.0.1"]&&local.port.integerValue>0&&local.port.integerValue<65536&&!local.user&&!local.password;
  NSDictionary *safe=@{@"locale":QAPreferenceLocale(values[@"locale"])?values[@"locale"]:@"zh-Hans",@"theme":QAPreferenceTheme(values[@"theme"])?values[@"theme"]:@"light",@"origin":loopback?origin:@""};
  NSData *json=[NSJSONSerialization dataWithJSONObject:safe options:NSJSONWritingSortedKeys error:nil];NSString *literal=[[NSString alloc]initWithData:json encoding:NSUTF8StringEncoding];
  return [NSString stringWithFormat:@"(function(){const p=%@;if(window.location.origin!==p.origin)return;try{localStorage.setItem('ynxNetworkLocale',p.locale);localStorage.setItem('ynxNetworkTheme',p.theme);}catch(_){}}());",literal];
}
static BOOL QAExportTree(id value,NSUInteger depth,NSUInteger *nodes,NSUInteger *bytes) {
  if(depth>48||++*nodes>100000||*bytes>QAExportLimit)return NO;
  if([value isKindOfClass:NSString.class]){*bytes+=[value lengthOfBytesUsingEncoding:NSUTF8StringEncoding]+2;return *bytes<=QAExportLimit;}
  if(value==NSNull.null||[value isKindOfClass:NSNumber.class]){*bytes+=32;return *bytes<=QAExportLimit;}
  if([value isKindOfClass:NSArray.class]){for(id item in value)if(!QAExportTree(item,depth+1,nodes,bytes))return NO;return YES;}
  if([value isKindOfClass:NSDictionary.class]){for(id key in value){if(![key isKindOfClass:NSString.class]||!QAExportTree(key,depth+1,nodes,bytes)||!QAExportTree(value[key],depth+1,nodes,bytes))return NO;}return YES;}
  return NO;
}
// Only public receipt JSON supplied by the current helper page is serialized.
// No path, command, executable, trust material, account or key is read from it.
static NSData *QAExportData(id body) {
  @try {
    if(!QAExportKeys(body,@[@"version",@"record"],@[@"version",@"record"])||![body[@"version"]isEqual:@"YNX-NETWORK-RECEIPT-EXPORT/v1"])return nil;
    NSDictionary *record=body[@"record"];
    if(!QAExportKeys(record,@[@"receiptId",@"txId",@"observedAt",@"contextPin",@"view",@"report",@"reportText",@"reportCollection",@"reportedBy",@"proofCollection"],@[@"receiptId",@"txId",@"observedAt",@"contextPin",@"view"])||!QAExportHash(record[@"receiptId"],NO)||!QAExportHash(record[@"txId"],YES)||!QAExportHash(record[@"contextPin"],NO))return nil;
    for(NSString *key in @[@"observedAt",@"reportedBy",@"reportText"]){id value=record[key];if(value&&(![value isKindOfClass:NSString.class]||[value lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>QAExportLimit))return nil;}
    if(![record[@"observedAt"]length]||[record[@"observedAt"]length]>64)return nil;
    NSDictionary *view=record[@"view"];
    NSArray *flags=@[@"memberVerified",@"executionVerified",@"abciResultVerified",@"selectedMemberResultVerified",@"fundsVerified",@"nativeGrant"];
    NSArray *strings=@[@"level",@"txId",@"height",@"source",@"reason",@"detail",@"requestedMember",@"requestedEvent",@"executionOutcome",@"abciExecutionCode",@"selectedMemberOutcome",@"stateScope"];
    if(!QAExportKeys(view,[strings arrayByAddingObjectsFromArray:flags],@[@"level",@"txId"])||!QAExportHash(view[@"txId"],YES)||![QAExportTx(view[@"txId"])isEqual:QAExportTx(record[@"txId"]) ]||![@[@"RPC_ONLY",@"HEADER_VERIFIED",@"INCLUSION_VERIFIED",@"STATE_VERIFIED"]containsObject:view[@"level"]])return nil;
    for(NSString *key in strings)if(view[key]&&![view[key]isKindOfClass:NSString.class])return nil;
    for(NSString *key in flags)if(view[key]&&(![view[key]isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)view[key])!=CFBooleanGetTypeID()))return nil;
    for(NSString *key in @[@"reportCollection",@"proofCollection"]){NSDictionary *metadata=record[key];if(!metadata)continue;if(!QAExportKeys(metadata,@[@"status",@"code",@"source"],@[@"status",@"source"]))return nil;for(id value in metadata.allValues)if(![value isKindOfClass:NSString.class])return nil;if(![@[@"reported",@"unavailable"]containsObject:metadata[@"status"]])return nil;}
    NSUInteger nodes=0,bytes=0;if(!QAExportTree(body,0,&nodes,&bytes)||![NSJSONSerialization isValidJSONObject:body])return nil;
    NSData *envelope=[NSJSONSerialization dataWithJSONObject:body options:0 error:nil];if(!envelope.length||envelope.length>QAExportLimit)return nil;
    NSDictionary *file=@{@"version":@"YNX-NETWORK-LOCAL-RECEIPT-EXPORT/v1",@"historical":@YES,@"authority":@NO,@"receipt":record};
    NSData *data=[NSJSONSerialization dataWithJSONObject:file options:NSJSONWritingSortedKeys error:nil];return data.length&&data.length<=QAExportLimit?data:nil;
  }@catch(NSException *exception){return nil;}
}
static BOOL QAExportOrigin(NSString *expected,NSString *protocol,NSString *host,NSInteger port,NSURL *current) {
  NSURL *local=[NSURL URLWithString:expected];return local&&[local.scheme isEqual:@"http"]&&[local.host isEqual:@"127.0.0.1"]&&local.port.integerValue>0&&local.port.integerValue<65536&&!local.user&&!local.password&&[protocol isEqual:@"http"]&&[host isEqual:@"127.0.0.1"]&&port==local.port.integerValue&&[current.scheme isEqual:local.scheme]&&[current.host isEqual:local.host]&&[current.port isEqual:local.port]&&!current.user&&!current.password;
}
// Publish a fully-written new file atomically. Existing files (including
// symlinks, trust contexts and user data) are never replaced, even in a race.
static NSString *QAExportWrite(NSData *data,NSURL *url) {
  if(!data.length||data.length>QAExportLimit||!url.isFileURL||![url.pathExtension.lowercaseString isEqual:@"json"])return @"EXPORT_DESTINATION_INVALID";
  NSString *name=url.lastPathComponent;if(!name.length||[name isEqual:@"."]||[name isEqual:@".."])return @"EXPORT_DESTINATION_INVALID";
  char *physical=realpath(url.URLByDeletingLastPathComponent.path.fileSystemRepresentation,NULL);if(!physical)return @"EXPORT_DESTINATION_UNAVAILABLE";
  int directory=open(physical,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);free(physical);if(directory<0)return @"EXPORT_DESTINATION_UNAVAILABLE";
  NSString *temporary=[@".ynx-public-receipt-"stringByAppendingString:NSUUID.UUID.UUIDString];int fd=openat(directory,temporary.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
  if(fd<0){close(directory);return @"EXPORT_WRITE_FAILED";}
  NSUInteger written=0;BOOL ok=YES;while(written<data.length){ssize_t n=write(fd,(const char*)data.bytes+written,data.length-written);if(n<0&&errno==EINTR)continue;if(n<=0){ok=NO;break;}written+=(NSUInteger)n;}
  if(ok)ok=fsync(fd)==0;close(fd);NSString *code=@"EXPORT_WRITE_FAILED";
  if(ok){if(renameatx_np(directory,temporary.fileSystemRepresentation,directory,name.fileSystemRepresentation,RENAME_EXCL)==0)code=fsync(directory)==0?@"EXPORT_SAVED":@"EXPORT_DURABILITY_UNKNOWN";else if(errno==EEXIST)code=@"EXPORT_DESTINATION_EXISTS";}
  unlinkat(directory,temporary.fileSystemRepresentation,0);close(directory);return code;
}
static NSString *QAExportFinish(NSModalResponse response,NSData *data,NSURL *url) {
  if(response==NSModalResponseCancel)return @"EXPORT_CANCELLED";
  if(response!=NSModalResponseOK)return @"EXPORT_PANEL_FAILED";
  BOOL scoped=[url startAccessingSecurityScopedResource];NSString *code=QAExportWrite(data,url);if(scoped)[url stopAccessingSecurityScopedResource];return code;
}

// Filesystem providers and access arbitration may block even after panel approval.
// Keep that work off AppKit's main thread; completion always returns to it.
static void QAExportAsync(NSModalResponse response,NSData *data,NSURL *url,void (^completion)(NSString*)) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{
    NSString *code=QAExportFinish(response,data,url);
    dispatch_async(dispatch_get_main_queue(),^{completion(code);});
  });
}

static NSString *digest(NSString *file) {
  NSFileHandle *handle=[NSFileHandle fileHandleForReadingAtPath:file];if(!handle)return nil;
  CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);for(;;){NSData *part=[handle readDataOfLength:65536];if(!part.length)break;CC_SHA256_Update(&ctx,part.bytes,(CC_LONG)part.length);}[handle closeFile];unsigned char result[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(result,&ctx);NSMutableString *text=[NSMutableString string];for(unsigned i=0;i<sizeof(result);i++)[text appendFormat:@"%02x",result[i]];return text;
}
static BOOL privateDirectory(NSString *dir) {
  struct stat st;if(lstat(dir.fileSystemRepresentation,&st)==0)return S_ISDIR(st.st_mode)&&!S_ISLNK(st.st_mode)&&st.st_uid==geteuid()&&(st.st_mode&077)==0;
  return mkdir(dir.fileSystemRepresentation,0700)==0;
}
static int qaFailure(NSString *message,BOOL cli){fprintf(stderr,"%s\n",message.UTF8String);if(!cli){[NSApplication sharedApplication];NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Network QA could not start";alert.informativeText=message;[alert runModal];}return 2;}
static BOOL packagedFiles(NSString *helper,NSString *proof,NSDictionary *build){return [[digest(helper)description]isEqual:build[@"helperSHA256"]]&&[[digest(proof)description]isEqual:build[@"proofSHA256"]];}
static void installApplicationMenu(NSApplication *app) {
  NSMenu *bar=[NSMenu new];
  NSMenuItem *applicationItem=[[NSMenuItem alloc]initWithTitle:@"YNX Network QA" action:nil keyEquivalent:@""];
  NSMenu *application=[[NSMenu alloc]initWithTitle:@"YNX Network QA"];
  NSMenuItem *quit=[[NSMenuItem alloc]initWithTitle:@"Quit YNX Network QA" action:@selector(terminate:) keyEquivalent:@"q"];
  quit.target=app;[application addItem:quit];applicationItem.submenu=application;[bar addItem:applicationItem];
  NSMenuItem *fileItem=[[NSMenuItem alloc]initWithTitle:@"File" action:nil keyEquivalent:@""];
  NSMenu *file=[[NSMenu alloc]initWithTitle:@"File"];
  [file addItem:[[NSMenuItem alloc]initWithTitle:@"Close Window" action:@selector(performClose:) keyEquivalent:@"w"]];
  fileItem.submenu=file;[bar addItem:fileItem];app.mainMenu=bar;
}
static NSArray<NSString*> *helperArguments(NSString *data,NSString *rpc,NSString *proof,NSDictionary *build,NSDictionary *profile) {
  NSMutableArray *args=[NSMutableArray arrayWithArray:@[@"--data-dir",data,@"--rpc",rpc]];
  if(profile)[args addObjectsFromArray:@[@"--pq-verifier",proof,@"--pq-verifier-sha256",build[@"proofSHA256"],@"--pq-context",profile[@"contextPath"],@"--pq-context-sha256",profile[@"contextSHA256"]]];
  return args;
}
@interface QAApp:NSObject<NSApplicationDelegate,WKNavigationDelegate,WKScriptMessageHandler,NSOpenSavePanelDelegate>
@property NSTask *task;@property NSWindow *window;@property WKWebView *web;@property NSTextField *label;@property NSTextField *proofLabel;@property NSButton *configureButton;@property NSString *origin;@property NSString *code;@property NSMutableString *pending;
@property NSString *helper;@property NSString *proof;@property NSString *data;@property NSString *rpc;@property NSDictionary *build;@property QAProofProfile *profiles;@property NSUInteger generation;@property BOOL changing;@property BOOL quitting;
@property BOOL terminationPending;@property BOOL exportWriting;@property NSSavePanel *exportPanel;@property NSString *exportToken;@property NSUInteger documentGeneration;@property BOOL documentReady;
-(NSApplicationTerminateReply)finishTermination;
-(void)completeExport:(NSString*)code token:(NSString*)token helper:(NSUInteger)helper document:(NSUInteger)document origin:(NSString*)origin;
-(void)finishDeferredTerminationIfNeeded;
@property NSUserDefaults *preferences;@property NSString *preferenceDomain;@property WKUserScript *preferenceScript;
@end
@implementation QAApp
-(BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)app{return YES;}
-(void)copyCode:(id)sender{if(self.code.length){[[NSPasteboard generalPasteboard]clearContents];[[NSPasteboard generalPasteboard]setString:self.code forType:NSPasteboardTypeString];}}
-(void)showError:(NSString*)message{NSAlert *a=[NSAlert new];a.messageText=@"Independent proof materials";a.informativeText=message;[a runModal];}
-(void)refreshPreferenceScript {
  if(!self.web)return;WKUserContentController *controller=self.web.configuration.userContentController;NSArray *existing=controller.userScripts;[controller removeAllUserScripts];
  for(WKUserScript *script in existing)if(script!=self.preferenceScript)[controller addUserScript:script];
  NSString *source=QAPreferenceBootstrap(QAPreferenceRead(self.preferences,self.preferenceDomain),self.origin);
  self.preferenceScript=[[WKUserScript alloc]initWithSource:source injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES];[controller addUserScript:self.preferenceScript];
}
-(void)applyPreferenceAppearance:(NSString*)theme {
  if(!self.window)return;self.window.appearance=[theme isEqual:@"dark"]?[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]:[theme isEqual:@"light"]?[NSAppearance appearanceNamed:NSAppearanceNameAqua]:nil;
}
-(BOOL)exportCurrent:(NSString*)token helper:(NSUInteger)helper document:(NSUInteger)document origin:(NSString*)origin {
  NSURL *current=self.web.URL,*local=[NSURL URLWithString:origin];return token&&[self.exportToken isEqual:token]&&self.generation==helper&&self.documentGeneration==document&&self.documentReady&&!self.changing&&!self.quitting&&self.task.running&&[self.origin isEqual:origin]&&QAExportOrigin(origin,local.scheme,local.host,local.port.integerValue,current);
}
-(void)exportResult:(NSString*)status code:(NSString*)code helper:(NSUInteger)helper document:(NSUInteger)document origin:(NSString*)origin {
  if(self.generation!=helper||self.documentGeneration!=document||!self.documentReady||self.changing||self.quitting||!self.task.running||![self.origin isEqual:origin])return;
  NSURL *local=[NSURL URLWithString:origin];if(!QAExportOrigin(origin,local.scheme,local.host,local.port.integerValue,self.web.URL))return;
  // Static function body and structured arguments only: receipt strings,
  // source text and error messages are never interpolated into JavaScript.
  [self.web callAsyncJavaScript:@"if (window.location.origin === expectedOrigin) window.dispatchEvent(new CustomEvent('network:export-result', {detail: result}));" arguments:@{@"expectedOrigin":origin,@"result":@{@"status":status,@"code":code}} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:nil];
}
-(void)completeExport:(NSString*)code token:(NSString*)token helper:(NSUInteger)helper document:(NSUInteger)document origin:(NSString*)origin {
  self.exportWriting=NO;BOOL current=[self exportCurrent:token helper:helper document:document origin:origin];
  if([self.exportToken isEqual:token])self.exportToken=nil;
  if(current){
    NSString *status=[code isEqual:@"EXPORT_CANCELLED"]?@"cancelled":[code isEqual:@"EXPORT_SAVED"]?@"saved":[code isEqual:@"EXPORT_DURABILITY_UNKNOWN"]?@"unknown":@"failed";
    [self exportResult:status code:code helper:helper document:document origin:origin];
  }else{
    // A new document may have encountered the old write's busy guard. Clear
    // only activity; never attach the old receipt's outcome to its new view.
    [self exportResult:@"idle" code:@"EXPORT_PRIOR_FINISHED" helper:self.generation document:self.documentGeneration origin:self.origin];
  }
  [self finishDeferredTerminationIfNeeded];
}
-(void)invalidateExport {
  self.exportToken=nil;NSSavePanel *panel=self.exportPanel;if(panel)[panel cancel:nil];
}
-(BOOL)panel:(id)sender validateURL:(NSURL*)url error:(NSError**)error {
  if(sender!=self.exportPanel)return YES;struct stat st;
  BOOL allowed=url.isFileURL&&[url.pathExtension.lowercaseString isEqual:@"json"]&&lstat(url.path.fileSystemRepresentation,&st)!=0&&errno==ENOENT;
  if(!allowed&&error)*error=[NSError errorWithDomain:@"YNXNetworkPublicExport" code:2 userInfo:@{NSLocalizedDescriptionKey:@"Choose a new .json file. Existing files, trust material and user data are never replaced."}];return allowed;
}
-(void)userContentController:(WKUserContentController*)controller didReceiveScriptMessage:(WKScriptMessage*)message {
  WKSecurityOrigin *sender=message.frameInfo.securityOrigin;
  if(![@[@"networkExport",@"networkPreferences"]containsObject:message.name]||message.webView!=self.web||!message.frameInfo.isMainFrame||!self.documentReady||self.changing||self.quitting||!self.task.running||!QAExportOrigin(self.origin,sender.protocol,sender.host,sender.port,self.web.URL))return;
  if([message.name isEqual:@"networkPreferences"]){if(QAPreferenceStore(self.preferences,self.preferenceDomain,message.body)){[self refreshPreferenceScript];[self applyPreferenceAppearance:message.body[@"theme"]];}return;}
  NSUInteger helper=self.generation,document=self.documentGeneration;NSString *origin=self.origin;
  if(self.exportPanel||self.exportWriting){[self exportResult:@"failed" code:@"EXPORT_BUSY" helper:helper document:document origin:origin];return;}
  NSData *data=QAExportData(message.body);if(!data){[self exportResult:@"failed" code:@"EXPORT_INVALID_RECEIPT" helper:helper document:document origin:origin];return;}
  NSSavePanel *panel=[NSSavePanel savePanel];panel.title=@"Export public receipt JSON";panel.message=@"Choose a new .json file. Export preserves a local historical record; it does not verify proof, grant Wallet approval or establish funds. Existing files are never replaced.";panel.allowedFileTypes=@[@"json"];panel.allowsOtherFileTypes=NO;panel.canSelectHiddenExtension=NO;panel.extensionHidden=NO;panel.nameFieldStringValue=[NSString stringWithFormat:@"ynx-receipt-%@.json",message.body[@"record"][@"receiptId"]];panel.delegate=self;
  self.exportPanel=panel;NSString *token=NSUUID.UUID.UUIDString;self.exportToken=token;__weak QAApp *weak=self;
  [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){
    QAApp *app=weak;if(!app)return;BOOL current=[app exportCurrent:token helper:helper document:document origin:origin];if(app.exportPanel==panel)app.exportPanel=nil;
    if(!current)return;
    // One explicit panel approval starts one write, never an automatic retry.
    app.exportWriting=YES;
    if(response==NSModalResponseOK)[app exportResult:@"writing" code:@"EXPORT_WRITING" helper:helper document:document origin:origin];
    QAExportAsync(response,data,panel.URL,^(NSString *code){
      QAApp *owner=weak;if(owner)[owner completeExport:code token:token helper:helper document:document origin:origin];
    });
  }];
}
-(void)applicationDidFinishLaunching:(NSNotification*)notification{
  NSString *identifier=NSBundle.mainBundle.bundleIdentifier;if(QAPreferenceDomain(identifier)){self.preferenceDomain=identifier;self.preferences=NSUserDefaults.standardUserDefaults;}
  self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1440,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"YNX Network QA · Local candidate";self.window.minSize=NSMakeSize(840,620);[self.window center];
  NSView *content=self.window.contentView;self.label=[NSTextField labelWithString:@"Starting the local QA helper…"];self.label.frame=NSMakeRect(12,864,1260,24);self.label.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;[content addSubview:self.label];NSButton *copy=[NSButton buttonWithTitle:@"Copy pairing code" target:self action:@selector(copyCode:)];copy.frame=NSMakeRect(1286,860,142,30);copy.autoresizingMask=NSViewMinXMargin|NSViewMinYMargin;[content addSubview:copy];
  self.proofLabel=[NSTextField labelWithString:@"No independent proof context configured · RPC_ONLY"];self.proofLabel.frame=NSMakeRect(12,828,1148,26);self.proofLabel.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;self.proofLabel.lineBreakMode=NSLineBreakByTruncatingMiddle;[content addSubview:self.proofLabel];self.configureButton=[NSButton buttonWithTitle:@"Configure independent proof materials…" target:self action:@selector(configureProof:)];self.configureButton.frame=NSMakeRect(1160,824,268,32);self.configureButton.autoresizingMask=NSViewMinXMargin|NSViewMinYMargin;[content addSubview:self.configureButton];
  WKWebViewConfiguration *config=[WKWebViewConfiguration new];config.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];config.preferences.javaScriptCanOpenWindowsAutomatically=NO;[config.userContentController addScriptMessageHandler:self name:@"networkExport"];[config.userContentController addScriptMessageHandler:self name:@"networkPreferences"];
  self.web=[[WKWebView alloc]initWithFrame:NSMakeRect(0,0,1440,818) configuration:config];[self refreshPreferenceScript];[self applyPreferenceAppearance:QAPreferenceRead(self.preferences,self.preferenceDomain)[@"theme"]];self.web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;self.web.navigationDelegate=self;[content addSubview:self.web];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];[self startHelper];
}
-(void)startHelper{
  [self invalidateExport];self.documentReady=NO;
  NSError *error=nil;NSDictionary *profile=[self.profiles load:&error];if(error){self.label.stringValue=@"Proof profile failed closed; no helper started.";[self showError:error.localizedDescription];return;}
  if(!packagedFiles(self.helper,self.proof,self.build)){self.label.stringValue=@"Packaged executable changed; no helper started.";return;}
  self.proofLabel.stringValue=profile?[NSString stringWithFormat:@"Context configured · CORE must verify each proof · %@",profile[@"contextPath"]]:@"No independent proof context configured · RPC_ONLY";self.proofLabel.toolTip=profile?@"Configuration is an input only. It grants no verified state, Wallet approval, funds or node management authority.":@"No independent source is inferred from RPC.";
  self.origin=nil;self.code=nil;self.pending=[NSMutableString string];self.generation++;NSUInteger generation=self.generation;
  NSTask *task=[NSTask new];task.executableURL=[NSURL fileURLWithPath:self.helper];task.arguments=helperArguments(self.data,self.rpc,self.proof,self.build,profile);NSPipe *pipe=[NSPipe pipe];task.standardOutput=pipe;task.standardError=[NSFileHandle fileHandleWithStandardError];self.task=task;__weak QAApp *weak=self;
  pipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *file){NSData *data=file.availableData;if(!data.length){file.readabilityHandler=nil;return;}NSString *text=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding];dispatch_async(dispatch_get_main_queue(),^{if(weak.generation==generation)[weak consume:text?:@""];});};
  task.terminationHandler=^(NSTask *ended){dispatch_async(dispatch_get_main_queue(),^{if(weak.generation==generation&&!weak.changing&&!weak.quitting){[weak invalidateExport];weak.documentReady=NO;weak.label.stringValue=[NSString stringWithFormat:@"Local helper stopped (%d). Configuration grants no verification.",ended.terminationStatus];}});};
  if(![task launchAndReturnError:&error])self.label.stringValue=error.localizedDescription;
}
-(void)stopOwnedThen:(void(^)(void))completion{
  NSTask *owned=self.task;if(!owned.running){completion();return;}
  // Never discover, signal or replace a process by a saved PID or service name.
  owned.terminationHandler=^(NSTask *ended){dispatch_async(dispatch_get_main_queue(),completion);};[owned terminate];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,8*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(owned.running)kill(owned.processIdentifier,SIGKILL);});
}
-(void)configureProof:(id)sender{
  if(self.changing)return;
  NSOpenPanel *panel=[NSOpenPanel openPanel];panel.title=@"Choose the original CORE public trust context";panel.message=@"Choose public material only. Do not select a key, account, credential or executable.";panel.canChooseDirectories=NO;panel.allowsMultipleSelection=NO;
  if([panel runModal]!=NSModalResponseOK)return;NSString *path=panel.URL.path;
  NSAlert *alert=[NSAlert new];alert.messageText=@"Enter the independent SHA256";alert.informativeText=@"Obtain the exact 64-hex digest through an independent trusted channel. The App does not calculate or fill this input. Configuration is not proof verification or Wallet approval. Apply stops this App’s helper, preserves historical receipts and starts a new one-use pairing session.";[alert addButtonWithTitle:@"Apply and restart owned helper"];[alert addButtonWithTitle:@"Cancel"];
  NSTextField *field=[[NSTextField alloc]initWithFrame:NSMakeRect(0,0,520,26)];field.placeholderString=@"64 hexadecimal characters from an independent channel";alert.accessoryView=field;
  if([alert runModal]!=NSAlertFirstButtonReturn)return;
  NSError *error=nil;NSDictionary *candidate=[self.profiles candidateForPath:path independentSHA256:field.stringValue error:&error];if(!candidate){[self showError:error.localizedDescription];return;}
  // Detect damaged/replaced prior configuration before interrupting the session.
  if(![self.profiles checkStoredRecord:&error]){[self showError:error.localizedDescription];return;}
  self.changing=YES;[self invalidateExport];self.documentReady=NO;self.configureButton.enabled=NO;self.label.stringValue=@"Stopping this App’s helper before changing proof inputs…";self.generation++;self.code=nil;self.origin=nil;[self.web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"about:blank"]]];
  __weak QAApp *weak=self;[self stopOwnedThen:^{NSError *saveError=nil;BOOL saved=[weak.profiles save:candidate error:&saveError];weak.changing=NO;weak.configureButton.enabled=YES;if(!saved){weak.label.stringValue=@"Configuration save failed closed. Helper remains stopped.";[weak showError:saveError.localizedDescription];return;}if(!weak.quitting)[weak startHelper];}];
}
-(void)consume:(NSString*)text{
  [self.pending appendString:text];if(self.pending.length>8192){self.label.stringValue=@"Unexpected helper startup output";[self.task terminate];return;}NSRange newline;while((newline=[self.pending rangeOfString:@"\n"]).location!=NSNotFound){NSString *line=[self.pending substringToIndex:newline.location];[self.pending deleteCharactersInRange:NSMakeRange(0,newline.location+1)];if([line hasPrefix:@"Open: "]){NSString *origin=[line substringFromIndex:6];NSURL *url=[NSURL URLWithString:origin];if([url.scheme isEqual:@"http"]&&[url.host isEqual:@"127.0.0.1"]&&url.port.integerValue>0&&url.port.integerValue<65536&&!url.user&&!url.password){self.origin=origin;[self refreshPreferenceScript];[self.web loadRequest:[NSURLRequest requestWithURL:url]];}}if([line hasPrefix:@"One-use pairing code: "]){self.code=[line substringFromIndex:22];self.label.stringValue=[NSString stringWithFormat:@"Local QA · Pairing code: %@",self.code];}}
}
-(void)webView:(WKWebView*)web decidePolicyForNavigationAction:(WKNavigationAction*)action decisionHandler:(void(^)(WKNavigationActionPolicy))decision{
  NSURL *url=action.request.URL,*local=[NSURL URLWithString:self.origin];BOOL allow=[url.absoluteString isEqual:@"about:blank"]||(local&&[url.scheme isEqual:local.scheme]&&[url.host isEqual:local.host]&&[url.port isEqual:local.port]&&!url.user&&!url.password);decision(allow?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
-(void)webView:(WKWebView*)web didStartProvisionalNavigation:(WKNavigation*)navigation {
  if(web==self.web){self.documentReady=NO;self.documentGeneration++;[self invalidateExport];}
}
-(void)webView:(WKWebView*)web didFinishNavigation:(WKNavigation*)navigation {
  NSURL *local=[NSURL URLWithString:self.origin];if(web==self.web)self.documentReady=!self.changing&&!self.quitting&&self.task.running&&QAExportOrigin(self.origin,local.scheme,local.host,local.port.integerValue,web.URL);
}
-(void)webViewWebContentProcessDidTerminate:(WKWebView*)web {
  if(web==self.web){self.documentReady=NO;self.documentGeneration++;[self invalidateExport];}
}
-(void)finishDeferredTerminationIfNeeded {
  if(!self.terminationPending||self.exportWriting)return;self.terminationPending=NO;
  if([self finishTermination]==NSTerminateNow)[NSApp replyToApplicationShouldTerminate:YES];
}
-(NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)app{
  if(self.exportWriting){self.terminationPending=YES;return NSTerminateLater;}
  return [self finishTermination];
}
-(NSApplicationTerminateReply)finishTermination{
  self.quitting=YES;[self invalidateExport];[self.web.configuration.userContentController removeScriptMessageHandlerForName:@"networkExport"];[self.web.configuration.userContentController removeScriptMessageHandlerForName:@"networkPreferences"];if(!self.task.running)return NSTerminateNow;[self stopOwnedThen:^{[NSApp replyToApplicationShouldTerminate:YES];}];return NSTerminateLater;
}
@end

int main(int argc,const char **argv){@autoreleasepool{
  NSString *executable=[[NSString stringWithUTF8String:argv[0]]stringByStandardizingPath];if(!executable.isAbsolutePath)executable=[[[NSFileManager defaultManager]currentDirectoryPath]stringByAppendingPathComponent:executable];NSString *contents=[[executable stringByDeletingLastPathComponent]stringByDeletingLastPathComponent];NSString *resources=[contents stringByAppendingPathComponent:@"Resources"];NSData *raw=[NSData dataWithContentsOfFile:[resources stringByAppendingPathComponent:@"qa-build.json"]];NSDictionary *build=raw?[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil]:nil;if(![build[@"version"]isEqual:@"YNX-NETWORK-LOCAL-QA/v1"]){fprintf(stderr,"QA build identity missing\n");return 2;}
  NSString *helper=[contents stringByAppendingPathComponent:@"Helpers/ynx-network-helper"],*proof=[contents stringByAppendingPathComponent:@"Helpers/ynx-consensus-proof-verify"];if(!packagedFiles(helper,proof,build)){fprintf(stderr,"Packaged executable digest mismatch\n");return 2;}
  BOOL headless=NO,native=NO,version=NO,showProfile=NO;NSString *rpc=build[@"defaultRPC"],*context=nil,*pin=nil;
  NSMutableSet *seen=[NSMutableSet set];for(int i=1;i<argc;i++){NSString *arg=[NSString stringWithUTF8String:argv[i]];if([seen containsObject:arg])return qaFailure(@"Duplicate QA option",YES);[seen addObject:arg];if([arg isEqual:@"--headless"])headless=YES;else if([arg isEqual:@"--native-status"])native=YES;else if([arg isEqual:@"--version"])version=YES;else if([arg isEqual:@"--proof-profile"])showProfile=YES;else if([arg isEqual:@"--rpc"]&&i+1<argc)rpc=[NSString stringWithUTF8String:argv[++i]];else if([arg isEqual:@"--configure-proof-context"]&&i+1<argc)context=[NSString stringWithUTF8String:argv[++i]];else if([arg isEqual:@"--context-sha256"]&&i+1<argc)pin=[NSString stringWithUTF8String:argv[++i]];else return qaFailure(@"Supported QA options: --headless --native-status --version --rpc URL --proof-profile --configure-proof-context FILE --context-sha256 INDEPENDENT_64HEX",YES);}
  BOOL cli=headless||native||showProfile||context||pin;if((context&&!pin)||(!context&&pin)||(native&&(context||showProfile||headless))||(showProfile&&(context||headless))||(version&&argc!=2))return qaFailure(@"Conflicting or incomplete QA options",YES);
  if(version){fwrite(raw.bytes,1,raw.length,stdout);fputc('\n',stdout);return 0;}
  // An explicit task-specific QA root never changes HOME or Foundation's user
  // directory. Only an already existing, current-owner 0700 directory is valid.
  NSString *base=nil;const char *qaRoot=getenv("YNX_NETWORK_QA_DIRECTORY");
  if(qaRoot){NSString *chosen=[NSString stringWithUTF8String:qaRoot];if(!chosen.isAbsolutePath||[chosen lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>4096)return qaFailure(@"YNX_NETWORK_QA_DIRECTORY must name an existing absolute private QA directory",cli);char *physical=realpath(qaRoot,NULL);if(!physical)return qaFailure(@"The explicit QA directory does not exist",cli);base=[NSString stringWithUTF8String:physical];free(physical);struct stat st;if(lstat(base.fileSystemRepresentation,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=geteuid()||(st.st_mode&0777)!=0700)return qaFailure(@"The explicit QA directory must belong to this user with exact 0700 permissions",cli);}
  else{char *physicalHome=realpath(NSHomeDirectory().fileSystemRepresentation,NULL);if(!physicalHome)return qaFailure(@"QA home directory is unavailable",cli);NSString *home=[NSString stringWithUTF8String:physicalHome];free(physicalHome);base=[home stringByAppendingPathComponent:@".ynx-network-qa"];}
  NSString *identifier=build[@"buildID"];if(![identifier isKindOfClass:NSString.class]||![identifier hasPrefix:@"qa-"]||identifier.length!=19||[identifier rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"qa-0123456789abcdef"]invertedSet]].location!=NSNotFound||!privateDirectory(base))return qaFailure(@"Private QA namespace unavailable",cli);NSString *data=[base stringByAppendingPathComponent:identifier];if([[data stringByAppendingPathComponent:@"ipc/network-helper.sock"]lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>103)return qaFailure(@"The private QA path exceeds the macOS IPC socket limit. No helper or user data was changed.",cli);if(!privateDirectory(data))return qaFailure(@"Private version-specific QA directory unavailable",cli);
  if(native){NSArray *args=@[helper,@"--data-dir",data,@"--native-status"];char **values=calloc(args.count+1,sizeof(char*));for(NSUInteger i=0;i<args.count;i++)values[i]=strdup([args[i]UTF8String]);execv(helper.fileSystemRepresentation,values);perror("QA native status");return 2;}
  NSError *error=nil;int session=QAAcquireSession(data,&error);if(session<0)return qaFailure(error.localizedDescription,cli);
  QAProofProfile *profiles=[[QAProofProfile alloc]initWithDirectory:data build:build];
  if(context){NSDictionary *candidate=[profiles candidateForPath:context independentSHA256:pin error:&error];if(!candidate||![profiles save:candidate error:&error])return qaFailure(error.localizedDescription,YES);puts("Independent public context profile saved. This is configuration only; CORE must verify each proof. No Wallet or node authority granted.");close(session);return 0;}
  NSDictionary *profile=[profiles load:&error];if(error&&cli)return qaFailure(error.localizedDescription,YES);
  if(showProfile){NSDictionary *status=profile?@{@"configured":@YES,@"profile":profile,@"authority":@NO}:@{@"configured":@NO,@"authority":@NO};NSData *out=[NSJSONSerialization dataWithJSONObject:status options:NSJSONWritingSortedKeys error:nil];fwrite(out.bytes,1,out.length,stdout);fputc('\n',stdout);close(session);return 0;}
  NSArray<NSString*> *arguments=helperArguments(data,rpc,proof,build,profile);
  if(headless){char **args=calloc(arguments.count+2,sizeof(char*));args[0]=strdup(helper.fileSystemRepresentation);for(NSUInteger i=0;i<arguments.count;i++)args[i+1]=strdup(arguments[i].UTF8String);execv(helper.fileSystemRepresentation,args);perror("QA helper exec");return 2;}
  NSApplication *app=[NSApplication sharedApplication];[app setActivationPolicy:NSApplicationActivationPolicyRegular];installApplicationMenu(app);QAApp *delegate=[QAApp new];delegate.helper=helper;delegate.proof=proof;delegate.data=data;delegate.rpc=rpc;delegate.build=build;delegate.profiles=profiles;app.delegate=delegate;[app run];close(session);return 0;
}}
