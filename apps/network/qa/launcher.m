#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/stat.h>
#import <unistd.h>
#import "proof_profile.h"

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
static NSArray<NSString*> *helperArguments(NSString *data,NSString *rpc,NSString *proof,NSDictionary *build,NSDictionary *profile) {
  NSMutableArray *args=[NSMutableArray arrayWithArray:@[@"--data-dir",data,@"--rpc",rpc]];
  if(profile)[args addObjectsFromArray:@[@"--pq-verifier",proof,@"--pq-verifier-sha256",build[@"proofSHA256"],@"--pq-context",profile[@"contextPath"],@"--pq-context-sha256",profile[@"contextSHA256"]]];
  return args;
}
@interface QAApp:NSObject<NSApplicationDelegate,WKNavigationDelegate>
@property NSTask *task;@property NSWindow *window;@property WKWebView *web;@property NSTextField *label;@property NSTextField *proofLabel;@property NSButton *configureButton;@property NSString *origin;@property NSString *code;@property NSMutableString *pending;
@property NSString *helper;@property NSString *proof;@property NSString *data;@property NSString *rpc;@property NSDictionary *build;@property QAProofProfile *profiles;@property NSUInteger generation;@property BOOL changing;@property BOOL quitting;
@end
@implementation QAApp
-(BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)app{return YES;}
-(void)copyCode:(id)sender{if(self.code.length){[[NSPasteboard generalPasteboard]clearContents];[[NSPasteboard generalPasteboard]setString:self.code forType:NSPasteboardTypeString];}}
-(void)showError:(NSString*)message{NSAlert *a=[NSAlert new];a.messageText=@"Independent proof materials";a.informativeText=message;[a runModal];}
-(void)applicationDidFinishLaunching:(NSNotification*)notification{
  self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1040,800) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"YNX Network QA · Local candidate";self.window.minSize=NSMakeSize(840,620);[self.window center];
  NSView *content=self.window.contentView;self.label=[NSTextField labelWithString:@"Starting the local QA helper…"];self.label.frame=NSMakeRect(12,764,860,24);self.label.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;[content addSubview:self.label];NSButton *copy=[NSButton buttonWithTitle:@"Copy pairing code" target:self action:@selector(copyCode:)];copy.frame=NSMakeRect(886,760,142,30);copy.autoresizingMask=NSViewMinXMargin|NSViewMinYMargin;[content addSubview:copy];
  self.proofLabel=[NSTextField labelWithString:@"No independent proof context configured · RPC_ONLY"];self.proofLabel.frame=NSMakeRect(12,728,748,26);self.proofLabel.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;self.proofLabel.lineBreakMode=NSLineBreakByTruncatingMiddle;[content addSubview:self.proofLabel];self.configureButton=[NSButton buttonWithTitle:@"Configure independent proof materials…" target:self action:@selector(configureProof:)];self.configureButton.frame=NSMakeRect(760,724,268,32);self.configureButton.autoresizingMask=NSViewMinXMargin|NSViewMinYMargin;[content addSubview:self.configureButton];
  WKWebViewConfiguration *config=[WKWebViewConfiguration new];config.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];config.preferences.javaScriptCanOpenWindowsAutomatically=NO;self.web=[[WKWebView alloc]initWithFrame:NSMakeRect(0,0,1040,718) configuration:config];self.web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;self.web.navigationDelegate=self;[content addSubview:self.web];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];[self startHelper];
}
-(void)startHelper{
  NSError *error=nil;NSDictionary *profile=[self.profiles load:&error];if(error){self.label.stringValue=@"Proof profile failed closed; no helper started.";[self showError:error.localizedDescription];return;}
  if(!packagedFiles(self.helper,self.proof,self.build)){self.label.stringValue=@"Packaged executable changed; no helper started.";return;}
  self.proofLabel.stringValue=profile?[NSString stringWithFormat:@"Context configured · CORE must verify each proof · %@",profile[@"contextPath"]]:@"No independent proof context configured · RPC_ONLY";self.proofLabel.toolTip=profile?@"Configuration is an input only. It grants no verified state, Wallet approval, funds or node management authority.":@"No independent source is inferred from RPC.";
  self.origin=nil;self.code=nil;self.pending=[NSMutableString string];self.generation++;NSUInteger generation=self.generation;
  NSTask *task=[NSTask new];task.executableURL=[NSURL fileURLWithPath:self.helper];task.arguments=helperArguments(self.data,self.rpc,self.proof,self.build,profile);NSPipe *pipe=[NSPipe pipe];task.standardOutput=pipe;task.standardError=[NSFileHandle fileHandleWithStandardError];self.task=task;__weak QAApp *weak=self;
  pipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *file){NSData *data=file.availableData;if(!data.length){file.readabilityHandler=nil;return;}NSString *text=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding];dispatch_async(dispatch_get_main_queue(),^{if(weak.generation==generation)[weak consume:text?:@""];});};
  task.terminationHandler=^(NSTask *ended){dispatch_async(dispatch_get_main_queue(),^{if(weak.generation==generation&&!weak.changing&&!weak.quitting)weak.label.stringValue=[NSString stringWithFormat:@"Local helper stopped (%d). Configuration grants no verification.",ended.terminationStatus];});};
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
  self.changing=YES;self.configureButton.enabled=NO;self.label.stringValue=@"Stopping this App’s helper before changing proof inputs…";self.generation++;self.code=nil;self.origin=nil;[self.web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"about:blank"]]];
  __weak QAApp *weak=self;[self stopOwnedThen:^{NSError *saveError=nil;BOOL saved=[weak.profiles save:candidate error:&saveError];weak.changing=NO;weak.configureButton.enabled=YES;if(!saved){weak.label.stringValue=@"Configuration save failed closed. Helper remains stopped.";[weak showError:saveError.localizedDescription];return;}if(!weak.quitting)[weak startHelper];}];
}
-(void)consume:(NSString*)text{
  [self.pending appendString:text];if(self.pending.length>8192){self.label.stringValue=@"Unexpected helper startup output";[self.task terminate];return;}NSRange newline;while((newline=[self.pending rangeOfString:@"\n"]).location!=NSNotFound){NSString *line=[self.pending substringToIndex:newline.location];[self.pending deleteCharactersInRange:NSMakeRange(0,newline.location+1)];if([line hasPrefix:@"Open: "]){NSString *origin=[line substringFromIndex:6];NSURL *url=[NSURL URLWithString:origin];if([url.scheme isEqual:@"http"]&&[url.host isEqual:@"127.0.0.1"]&&url.port.integerValue>0&&url.port.integerValue<65536&&!url.user&&!url.password){self.origin=origin;[self.web loadRequest:[NSURLRequest requestWithURL:url]];}}if([line hasPrefix:@"One-use pairing code: "]){self.code=[line substringFromIndex:22];self.label.stringValue=[NSString stringWithFormat:@"Local QA · Pairing code: %@",self.code];}}
}
-(void)webView:(WKWebView*)web decidePolicyForNavigationAction:(WKNavigationAction*)action decisionHandler:(void(^)(WKNavigationActionPolicy))decision{
  NSURL *url=action.request.URL,*local=[NSURL URLWithString:self.origin];BOOL allow=[url.absoluteString isEqual:@"about:blank"]||(local&&[url.scheme isEqual:local.scheme]&&[url.host isEqual:local.host]&&[url.port isEqual:local.port]&&!url.user&&!url.password);decision(allow?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
-(NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)app{
  self.quitting=YES;if(!self.task.running)return NSTerminateNow;[self stopOwnedThen:^{[NSApp replyToApplicationShouldTerminate:YES];}];return NSTerminateLater;
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
  NSApplication *app=[NSApplication sharedApplication];[app setActivationPolicy:NSApplicationActivationPolicyRegular];QAApp *delegate=[QAApp new];delegate.helper=helper;delegate.proof=proof;delegate.data=data;delegate.rpc=rpc;delegate.build=build;delegate.profiles=profiles;app.delegate=delegate;[app run];close(session);return 0;
}}
