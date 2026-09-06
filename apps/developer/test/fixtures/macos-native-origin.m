#define main YNXProductionMain
#include "../../desktop/macos/main.m"
#undef main

static void Require(BOOL ok, NSString *message) { if(!ok){fprintf(stderr,"%s\n",message.UTF8String);exit(1);} }
@interface YNXFakeOrigin : NSObject
@property(nonatomic,copy) NSString *protocol;
@property(nonatomic,copy) NSString *host;
@property(nonatomic) NSInteger port;
@end
@implementation YNXFakeOrigin @end
@interface YNXFakeFrame : NSObject
@property(nonatomic,getter=isMainFrame) BOOL mainFrame;
@property(nonatomic,strong) YNXFakeOrigin *securityOrigin;
@end
@implementation YNXFakeFrame @end
@interface YNXFakeWebView : NSObject
@property(nonatomic,copy) NSString *lastScript;
@end
@implementation YNXFakeWebView
- (void)evaluateJavaScript:(NSString *)source completionHandler:(void (^)(id,NSError *))completion { _lastScript=source; }
@end
@interface YNXFakeMessage : NSObject
@property(nonatomic,strong) YNXFakeFrame *frameInfo;
@property(nonatomic,strong) YNXFakeWebView *webView;
@property(nonatomic,copy) NSString *name;
@property(nonatomic,strong) NSDictionary *storedBody;
@property(nonatomic) BOOL rejectBodyRead;
@end
@implementation YNXFakeMessage
- (id)body { if(_rejectBodyRead)@throw [NSException exceptionWithName:@"ForeignPayloadRead" reason:@"Origin rejected message reached its body before rejection" userInfo:nil];return _storedBody; }
@end
@interface YNXObservedBridge : YNXCommandBridge
@property(nonatomic) NSUInteger storageCalls;
@property(atomic) NSUInteger runCalls;
@end
@implementation YNXObservedBridge
- (void)handleWalletStorage:(NSDictionary *)body action:(NSString *)action job:(NSString *)job { _storageCalls++; }
- (void)run:(NSString *)job payload:(NSDictionary *)payload { self.runCalls++; }
@end
@interface YNXObservedWorkspace : YNXWorkspaceBridge
@property(nonatomic) NSUInteger saveCalls;
@end
@implementation YNXObservedWorkspace
- (void)saveProject:(id)value completion:(void (^)(NSError *))completion { _saveCalls++; completion(nil); }
@end
@interface YNXObservedTask : NSObject
@property(nonatomic) NSUInteger cancelCalls;
@end
@implementation YNXObservedTask
- (void)terminate { _cancelCalls++; }
@end

static YNXFakeMessage *Message(YNXFakeWebView *view, NSString *name, NSString *action) {
    YNXFakeOrigin *origin=[YNXFakeOrigin new];origin.protocol=@"http";origin.host=@"127.0.0.1";origin.port=4177;
    YNXFakeFrame *frame=[YNXFakeFrame new];frame.mainFrame=YES;frame.securityOrigin=origin;
    YNXFakeMessage *message=[YNXFakeMessage new];message.webView=view;message.frameInfo=frame;message.name=name;
    message.storedBody=@{@"id":@"job",@"action":action,@"payload":@{},@"project":@{}};return message;
}

int main(void) { @autoreleasepool {
    YNXFakeWebView *view=[YNXFakeWebView new],*otherView=[YNXFakeWebView new];
    YNXObservedBridge *bridge=[[YNXObservedBridge alloc]initWithWebView:(WKWebView *)view nodeURL:[NSURL fileURLWithPath:@"/not-executed"]];bridge.port=4177;
    YNXObservedWorkspace *workspace=[YNXObservedWorkspace new];workspace.webView=(WKWebView *)view;workspace.port=4177;
    NSArray *actions=@[@[@"wallet",@"storage-get"],@[@"wallet",@"storage-set"],@[@"wallet",@"storage-remove"],@[@"wallet",@"open-authorization"],@[@"wallet",@"wallet-availability"],@[@"command",@"run"],@[@"command",@"cancel"],@[@"workspace",@"save-project"],@[@"workspace",@"export-project"]];
    NSUInteger rejected=0;
    for(NSUInteger variant=0;variant<8;variant++)for(NSArray *entry in actions){
        YNXFakeMessage *message=Message(view,entry[0],entry[1]);message.rejectBodyRead=YES;
        switch(variant){
            case 0:message.frameInfo.securityOrigin.host=@"foreign.example";break;
            case 1:message.frameInfo.securityOrigin.protocol=@"https";break;
            case 2:message.frameInfo.securityOrigin.port=4178;break;
            case 3:message.frameInfo.mainFrame=NO;break;
            case 4:message.webView=otherView;break;
            case 5:message.webView=nil;break;
            case 6:message.frameInfo=nil;break;
            case 7:message.name=@"unregistered-handler";break;
        }
        if([entry[0] isEqualToString:@"workspace"])[workspace userContentController:nil didReceiveScriptMessage:(WKScriptMessage *)message];
        else [bridge userContentController:nil didReceiveScriptMessage:(WKScriptMessage *)message];
        rejected++;
    }
    Require(bridge.storageCalls==0 && bridge.runCalls==0 && workspace.saveCalls==0,@"Rejected messages reached native effects");
    YNXFakeMessage *storage=Message(view,@"wallet",@"storage-get");[bridge userContentController:nil didReceiveScriptMessage:(WKScriptMessage *)storage];Require(bridge.storageCalls==1,@"Trusted Wallet message was blocked");
    YNXObservedTask *task=[YNXObservedTask new];bridge.processes[@"job"]=(NSTask *)task;
    [bridge userContentController:nil didReceiveScriptMessage:(WKScriptMessage *)Message(view,@"command",@"cancel")];Require(task.cancelCalls==1,@"Trusted cancellation routing failed");
    [workspace userContentController:nil didReceiveScriptMessage:(WKScriptMessage *)Message(view,@"workspace",@"save-project")];Require(workspace.saveCalls==1,@"Trusted workspace message was blocked");
    [bridge userContentController:nil didReceiveScriptMessage:(WKScriptMessage *)Message(view,@"command",@"run")];
    NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:1];while(!bridge.runCalls && deadline.timeIntervalSinceNow>0)[NSThread sleepForTimeInterval:0.005];Require(bridge.runCalls==1,@"Trusted command did not reach its controlled runner");
    Require(YNXMainNavigation([NSURL URLWithString:@"http://127.0.0.1:4177/"],4177,WKNavigationTypeOther)==YNXNavigationAllow,@"Local navigation failed");
    Require(YNXMainNavigation([NSURL URLWithString:@"about:blank"],4177,WKNavigationTypeOther)==YNXNavigationAllow,@"Recovery page navigation failed");
    Require(YNXMainNavigation([NSURL URLWithString:@"https://foreign.example/"],4177,WKNavigationTypeOther)==YNXNavigationCancel,@"Foreign redirect was allowed");
    Require(YNXMainNavigation([NSURL URLWithString:@"https://foreign.example/"],4177,WKNavigationTypeLinkActivated)==YNXNavigationOpenExternal,@"User external link was not routed outside IDE");
    Require(YNXMainNavigation([NSURL URLWithString:@"ynxwallet://authorize?request=untrusted"],4177,WKNavigationTypeLinkActivated)==YNXNavigationCancel,@"Unreviewed scheme navigation was allowed");
    Require(YNXMainNavigation([NSURL URLWithString:@"http://127.0.0.1:4178/"],4177,WKNavigationTypeOther)==YNXNavigationCancel,@"Wrong port navigation was allowed");
    printf("Rejected %lu foreign-origin/frame/view/name messages before payload access; trusted handlers and navigation gates passed.\n",(unsigned long)rejected);
    printf("BOUND_SCRIPT:%s\n",YNXOriginBoundScript(@"globalThis.delivered=(globalThis.delivered||0)+1;",4177).UTF8String);
    return 0;
} }
