#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/stat.h>
#import <unistd.h>

static NSString *digest(NSString *file) {
  NSFileHandle *handle=[NSFileHandle fileHandleForReadingAtPath:file]; if(!handle)return nil;
  CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);for(;;){NSData *part=[handle readDataOfLength:65536];if(!part.length)break;CC_SHA256_Update(&ctx,part.bytes,(CC_LONG)part.length);}[handle closeFile];unsigned char result[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(result,&ctx);NSMutableString *text=[NSMutableString string];for(unsigned i=0;i<sizeof(result);i++)[text appendFormat:@"%02x",result[i]];return text;
}
static BOOL privateDirectory(NSString *dir) {
  struct stat st;if(lstat(dir.fileSystemRepresentation,&st)==0)return S_ISDIR(st.st_mode)&&!S_ISLNK(st.st_mode)&&st.st_uid==geteuid()&&(st.st_mode&077)==0;
  return mkdir(dir.fileSystemRepresentation,0700)==0;
}
static int qaFailure(NSString *message,BOOL cli){fprintf(stderr,"%s\n",message.UTF8String);if(!cli){[NSApplication sharedApplication];NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Network QA could not start";alert.informativeText=message;[alert runModal];}return 2;}
@interface QAApp:NSObject<NSApplicationDelegate,WKNavigationDelegate>
@property NSTask *task;@property NSWindow *window;@property WKWebView *web;@property NSTextField *label;@property NSString *origin;@property NSString *code;@property NSMutableString *pending;
@end
@implementation QAApp
-(BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)app{return YES;}
-(void)copyCode:(id)sender{if(self.code.length){[[NSPasteboard generalPasteboard]clearContents];[[NSPasteboard generalPasteboard]setString:self.code forType:NSPasteboardTypeString];}}
-(void)applicationDidFinishLaunching:(NSNotification*)notification{
  self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1040,780) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"YNX Network QA · Local candidate";self.window.minSize=NSMakeSize(740,600);[self.window center];
  NSView *content=self.window.contentView;self.label=[NSTextField labelWithString:@"Starting the local QA helper…"];self.label.frame=NSMakeRect(12,744,860,24);self.label.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;[content addSubview:self.label];NSButton *copy=[NSButton buttonWithTitle:@"Copy pairing code" target:self action:@selector(copyCode:)];copy.frame=NSMakeRect(886,740,142,30);copy.autoresizingMask=NSViewMinXMargin|NSViewMinYMargin;[content addSubview:copy];
  WKWebViewConfiguration *config=[WKWebViewConfiguration new];config.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];config.preferences.javaScriptCanOpenWindowsAutomatically=NO;self.web=[[WKWebView alloc]initWithFrame:NSMakeRect(0,0,1040,730) configuration:config];self.web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;self.web.navigationDelegate=self;[content addSubview:self.web];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
  NSPipe *pipe=[NSPipe pipe];self.task.standardOutput=pipe;self.task.standardError=[NSFileHandle fileHandleWithStandardError];self.pending=[NSMutableString string];__weak QAApp *weak=self;pipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *file){NSData *data=file.availableData;if(!data.length){file.readabilityHandler=nil;return;}NSString *text=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding];dispatch_async(dispatch_get_main_queue(),^{[weak consume:text?:@""];});};self.task.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(),^{weak.label.stringValue=[NSString stringWithFormat:@"Local helper stopped (%d). Close and restart this QA app.",task.terminationStatus];});};NSError *error=nil;if(![self.task launchAndReturnError:&error])self.label.stringValue=error.localizedDescription;
}
-(void)consume:(NSString*)text{
  [self.pending appendString:text];if(self.pending.length>8192){self.label.stringValue=@"Unexpected helper startup output";[self.task terminate];return;}NSRange newline;while((newline=[self.pending rangeOfString:@"\n"]).location!=NSNotFound){NSString *line=[self.pending substringToIndex:newline.location];[self.pending deleteCharactersInRange:NSMakeRange(0,newline.location+1)];if([line hasPrefix:@"Open: "]){NSString *origin=[line substringFromIndex:6];NSURL *url=[NSURL URLWithString:origin];if([url.scheme isEqual:@"http"]&&[url.host isEqual:@"127.0.0.1"]&&url.port.integerValue>0&&url.port.integerValue<65536&&!url.user&&!url.password){self.origin=origin;[self.web loadRequest:[NSURLRequest requestWithURL:url]];}}if([line hasPrefix:@"One-use pairing code: "]){self.code=[line substringFromIndex:22];self.label.stringValue=[NSString stringWithFormat:@"Local QA · Pairing code: %@",self.code];}}
}
-(void)webView:(WKWebView*)web decidePolicyForNavigationAction:(WKNavigationAction*)action decisionHandler:(void(^)(WKNavigationActionPolicy))decision{
  NSURL *url=action.request.URL,*local=[NSURL URLWithString:self.origin];BOOL allow=[url.absoluteString isEqual:@"about:blank"]||(local&&[url.scheme isEqual:local.scheme]&&[url.host isEqual:local.host]&&[url.port isEqual:local.port]&&!url.user&&!url.password);decision(allow?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
-(NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)app{
  if(!self.task.running)return NSTerminateNow;self.task.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(),^{[NSApp replyToApplicationShouldTerminate:YES];});};[self.task terminate];dispatch_after(dispatch_time(DISPATCH_TIME_NOW,8*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(self.task.running)kill(self.task.processIdentifier,SIGKILL);[NSApp replyToApplicationShouldTerminate:YES];});return NSTerminateLater;
}
@end

int main(int argc,const char **argv){@autoreleasepool{
  NSString *executable=[[NSString stringWithUTF8String:argv[0]]stringByStandardizingPath];if(!executable.isAbsolutePath)executable=[[[NSFileManager defaultManager]currentDirectoryPath]stringByAppendingPathComponent:executable];NSString *contents=[[executable stringByDeletingLastPathComponent]stringByDeletingLastPathComponent];NSString *resources=[contents stringByAppendingPathComponent:@"Resources"];NSData *raw=[NSData dataWithContentsOfFile:[resources stringByAppendingPathComponent:@"qa-build.json"]];NSDictionary *build=raw?[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil]:nil;if(![build[@"version"]isEqual:@"YNX-NETWORK-LOCAL-QA/v1"]){fprintf(stderr,"QA build identity missing\n");return 2;}
  NSString *helper=[contents stringByAppendingPathComponent:@"Helpers/ynx-network-helper"],*proof=[contents stringByAppendingPathComponent:@"Helpers/ynx-consensus-proof-verify"];if(![[digest(helper)description]isEqual:build[@"helperSHA256"]]||![[digest(proof)description]isEqual:build[@"proofSHA256"]]){fprintf(stderr,"Packaged executable digest mismatch\n");return 2;}
  BOOL headless=NO,native=NO,version=NO;NSString *rpc=build[@"defaultRPC"];for(int i=1;i<argc;i++){NSString *arg=[NSString stringWithUTF8String:argv[i]];if([arg isEqual:@"--headless"])headless=YES;else if([arg isEqual:@"--native-status"])native=YES;else if([arg isEqual:@"--version"])version=YES;else if([arg isEqual:@"--rpc"]&&i+1<argc)rpc=[NSString stringWithUTF8String:argv[++i]];else{fprintf(stderr,"Supported QA options: --headless --native-status --version --rpc URL\n");return 2;}}
  if(version){fwrite(raw.bytes,1,raw.length,stdout);fputc('\n',stdout);return 0;}NSString *base=[NSHomeDirectory()stringByAppendingPathComponent:@".ynx-network-qa"];NSString *identifier=build[@"buildID"];if(![identifier hasPrefix:@"qa-"]||identifier.length!=19||[identifier rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"qa-0123456789abcdef"]invertedSet]].location!=NSNotFound||!privateDirectory(base))return qaFailure(@"Private QA namespace unavailable",headless||native);NSString *data=[base stringByAppendingPathComponent:identifier];if([[data stringByAppendingPathComponent:@"ipc/network-helper.sock"]lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>103)return qaFailure(@"The private QA path exceeds the macOS IPC socket limit. No helper or user data was changed.",headless||native);if(!privateDirectory(data))return qaFailure(@"Private version-specific QA directory unavailable",headless||native);
  NSMutableArray<NSString*> *arguments=[NSMutableArray arrayWithArray:@[@"--data-dir",data]];if(native)[arguments addObject:@"--native-status"];else[arguments addObjectsFromArray:@[@"--rpc",rpc]];
  if(headless||native){char **args=calloc(arguments.count+2,sizeof(char*));args[0]=strdup(helper.fileSystemRepresentation);for(NSUInteger i=0;i<arguments.count;i++)args[i+1]=strdup(arguments[i].UTF8String);execv(helper.fileSystemRepresentation,args);perror("QA helper exec");return 2;}
  NSApplication *app=[NSApplication sharedApplication];[app setActivationPolicy:NSApplicationActivationPolicyRegular];QAApp *delegate=[QAApp new];delegate.task=[NSTask new];delegate.task.executableURL=[NSURL fileURLWithPath:helper];delegate.task.arguments=arguments;app.delegate=delegate;[app run];return 0;
}}
