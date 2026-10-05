#define main YNXProductionMain
#include "main.m"
#undef main
#include <assert.h>

@interface QAOrigin : NSObject
@property NSString *protocol;@property NSString *host;@property NSInteger port;
@end
@implementation QAOrigin @end
@interface QAFrame : NSObject
@property(getter=isMainFrame) BOOL mainFrame;@property QAOrigin *securityOrigin;@property NSURLRequest *request;
@end
@implementation QAFrame @end
@interface QAView : NSObject
@property NSURL *URL;
@end
@implementation QAView @end
@interface QAMessage : NSObject
@property QAFrame *frameInfo;@property QAView *webView;@property NSString *name;@property BOOL rejectBody;
@end
@implementation QAMessage
- (id)body {assert(!_rejectBody);return @{};}
@end
@interface QAApp : YNXAppDelegate
@property NSUInteger walletCalls;
@end
@implementation QAApp
- (void)handleLocalWalletMessage:(id)value {_walletCalls++;}
@end
static void scopeTest(void) {
    QAApp *app=[QAApp new];app.localWorkbenchMode=YES;QAView *view=[QAView new];app.webView=(WKWebView *)view;
    for(NSNumber *port in @[@4177,@58329]){app.port=port.integerValue;view.URL=[NSURL URLWithString:YNXOrigin(app.port)];
        for(NSUInteger variant=0;variant<8;variant++){QAOrigin *origin=[QAOrigin new];origin.protocol=@"http";origin.host=@"127.0.0.1";origin.port=app.port;QAFrame *frame=[QAFrame new];frame.mainFrame=YES;frame.securityOrigin=origin;frame.request=[NSURLRequest requestWithURL:view.URL];QAMessage *m=[QAMessage new];m.name=@"ynxLocalWallet";m.webView=view;m.frameInfo=frame;m.rejectBody=variant!=0;
            switch(variant){case 1:frame.mainFrame=NO;break;case 2:origin.port++;break;case 3:origin.host=@"foreign.example";break;case 4:origin.protocol=@"https";break;case 5:m.webView=[QAView new];break;case 6:frame.request=[NSURLRequest requestWithURL:[NSURL URLWithString:[YNXOrigin(app.port) stringByAppendingString:@"/webview"]]];break;case 7:view.URL=[NSURL URLWithString:[YNXOrigin(app.port) stringByAppendingString:@"/native-tools"]];break;}
            NSUInteger before=app.walletCalls;[app userContentController:nil didReceiveScriptMessage:(WKScriptMessage *)m];assert(app.walletCalls==before+(variant==0));view.URL=[NSURL URLWithString:YNXOrigin(app.port)];
        }
    }
}

static NSDictionary *line(void) {char *buffer=NULL;size_t capacity=0;ssize_t length=getline(&buffer,&capacity,stdin);assert(length>0&&length<32768);NSData *data=[NSData dataWithBytes:buffer length:(NSUInteger)length];free(buffer);NSDictionary *value=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];assert([value isKindOfClass:NSDictionary.class]);return value;}
static void output(id value) {NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);fflush(stdout);}
static void clean(NSString *tag,NSString *service) {
    assert([tag hasPrefix:@"com.ynxweb4.developer.QA-device-"]&&[service hasPrefix:@"com.ynxweb4.developer.QA-state-"]);
    OSStatus s=SecItemDelete((__bridge CFDictionaryRef)@{(__bridge id)kSecClass:(__bridge id)kSecClassKey,(__bridge id)kSecAttrApplicationTag:[tag dataUsingEncoding:NSUTF8StringEncoding]});assert(s==errSecSuccess||s==errSecItemNotFound);
    s=SecItemDelete((__bridge CFDictionaryRef)@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:service});assert(s==errSecSuccess||s==errSecItemNotFound);
}
int main(int argc,const char **argv) {@autoreleasepool {
    scopeTest();
    assert(argc==5);NSString *mode=@(argv[1]),*tag=@(argv[2]),*service=@(argv[3]),*directory=@(argv[4]);
    assert([tag hasPrefix:@"com.ynxweb4.developer.QA-device-"]&&[service hasPrefix:@"com.ynxweb4.developer.QA-state-"]);
    if([mode isEqual:@"cleanup"]){clean(tag,service);output(@{@"cleaned":@YES});return 0;}
    YNXWalletDeviceBridge *bridge=[[YNXWalletDeviceBridge alloc]initWithTag:tag storageService:service lockDirectory:directory];NSError *error=nil;
    NSDictionary *device=[bridge beginUserOperation:&error];if(!device){fprintf(stderr,"Native QA operation failed: %s\n",error.localizedDescription.UTF8String);return 2;}
    if([mode isEqual:@"device"]){NSMutableDictionary *q=[@{(__bridge id)kSecClass:(__bridge id)kSecClassKey,(__bridge id)kSecAttrApplicationTag:[tag dataUsingEncoding:NSUTF8StringEncoding],(__bridge id)kSecReturnAttributes:@YES} mutableCopy];CFTypeRef r=NULL;assert(SecItemCopyMatching((__bridge CFDictionaryRef)q,&r)==errSecSuccess);NSDictionary *a=CFBridgingRelease(r);NSMutableDictionary *out=[device mutableCopy];out[@"extractablePresent"]=@(a[(__bridge id)kSecAttrIsExtractable]!=nil);out[@"extractable"]=a[(__bridge id)kSecAttrIsExtractable]?:NSNull.null;output(out);[bridge endUserOperation];return 0;}
    NSDictionary *fixture=line();assert([device[@"key"] isEqual:fixture[@"request"][@"deviceKey"]]);
    assert(!YNXDeviceDate(@"2026-99-99T00:00:00.000Z"));
    assert(![bridge stored:@"other-product:secret" error:&error]);assert(error);error=nil;
    assert(![bridge store:@"secret" key:[YNXDeviceStorageBase stringByAppendingString:@":arbitrary"] error:&error]);error=nil;
    assert([bridge store:YNXDeviceCanonical(fixture[@"request"]) key:[YNXDeviceStorageBase stringByAppendingString:@":pending"] error:&error]);
    assert(![bridge prepareAuthorizationURL:@"ynxwallet://developer-deploy?request=AAAA" error:&error]);error=nil;
    assert([bridge prepareAuthorizationURL:fixture[@"route"] error:&error]);
    YNXWalletDeviceBridge *other=[[YNXWalletDeviceBridge alloc]initWithTag:tag storageService:service lockDirectory:directory];
    assert(![other beginUserOperation:&error]);error=nil;
    assert(![other takeRoutedCallback]); // cold/unapproved instance never emits approval
    assert(![other routeCallback:[fixture[@"callback"] stringByReplacingOccurrencesOfString:@"nonce=" withString:@"nonce=X"]]);
    assert([[other routeCallback:fixture[@"callback"]] isEqual:bridge.instanceID]);
    assert([[bridge takeRoutedCallback] isEqual:fixture[@"callback"]]);assert(![other takeRoutedCallback]);
    NSMutableDictionary *wrong=[fixture[@"input"] mutableCopy];wrong[@"purpose"]=@"transaction";assert(![bridge sign:wrong error:&error]);error=nil;
    wrong=[fixture[@"input"] mutableCopy];wrong[@"unexpected"]=@"secret";assert(![bridge sign:wrong error:&error]);error=nil;
    wrong=[fixture[@"input"] mutableCopy];wrong[@"payload"]=YNXDeviceB64([@"YNX_WALLET_TRANSACTION_V2\n{}" dataUsingEncoding:NSUTF8StringEncoding]);assert(![bridge sign:wrong error:&error]);error=nil;
    for(NSDictionary *patch in @[@{@"productId":@"social"},@{@"scopes":@[@"wallet:sign"]},@{@"expiresAt":@"2000-01-01T00:00:00.000Z"},@{@"callback":@"thirdparty://callback"},@{@"origin":@"app://macos/thirdparty"}]){NSMutableDictionary *challenge=[fixture[@"challenge"] mutableCopy];[challenge addEntriesFromDictionary:patch];wrong=[fixture[@"input"] mutableCopy];wrong[@"payload"]=YNXDeviceB64([[NSString stringWithFormat:@"YNX_PRODUCT_SESSION_CHALLENGE_V2\n%@",YNXDeviceCanonical(challenge)] dataUsingEncoding:NSUTF8StringEncoding]);assert(![bridge sign:wrong error:&error]);error=nil;}
    wrong=[fixture[@"input"] mutableCopy];wrong[@"payload"]=[@"A" stringByPaddingToLength:20000 withString:@"A" startingAtIndex:0];assert(![bridge sign:wrong error:&error]);error=nil;
    NSString *signature=[bridge sign:fixture[@"input"] error:&error];if(!signature){fprintf(stderr,"Challenge rejected: %s\n",error.localizedDescription.UTF8String);return 3;}assert(![bridge sign:fixture[@"input"] error:&error]);error=nil;
    output(@{@"signature":signature,@"publicKey":bridge.publicKey});
    NSDictionary *continuation=line();assert([bridge store:YNXDeviceCanonical(continuation[@"session"]) key:YNXDeviceStorageBase error:&error]);
    NSString *proofSignature=[bridge sign:continuation[@"proofInput"] error:&error];if(!proofSignature){fprintf(stderr,"Proof rejected: %s\n",error.localizedDescription.UTF8String);return 4;}
    wrong=[continuation[@"proofInput"] mutableCopy];wrong[@"payload"]=continuation[@"wrongPathPayload"];assert(![bridge sign:wrong error:&error]);error=nil;
    wrong=[continuation[@"proofInput"] mutableCopy];wrong[@"payload"]=continuation[@"wrongBodyPayload"];assert(![bridge sign:wrong error:&error]);error=nil;
    NSString *before=[bridge stored:YNXDeviceStorageBase error:&error];NSMutableDictionary *bad=[continuation[@"session"] mutableCopy];bad[@"account"]=@"ynx100000000000000000000000000000000000000";assert(![bridge store:YNXDeviceCanonical(bad) key:YNXDeviceStorageBase error:&error]);error=nil;assert([[bridge stored:YNXDeviceStorageBase error:&error] isEqual:before]);
    [bridge endUserOperation];assert(![bridge sign:continuation[@"proofInput"] error:&error]);error=nil;
    NSDictionary *resumed=[other beginUserOperation:&error];assert([resumed[@"key"] isEqual:device[@"key"]]); // stable independent of window/port
    NSString *resumeSignature=[other sign:continuation[@"resumeInput"] error:&error];assert(resumeSignature);
    assert([[other stored:[YNXDeviceStorageBase stringByAppendingString:@":return"] error:&error] isEqual:fixture[@"callback"]]); // resumed only after explicit native approval
    NSMutableDictionary *legacy=[continuation[@"session"] mutableCopy];legacy[@"deviceKey"]=[@"A" stringByPaddingToLength:44 withString:@"A" startingAtIndex:0];NSString *preserved=YNXDeviceCanonical(legacy);
    NSDictionary *qaQuery=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:service,(__bridge id)kSecAttrAccount:YNXDeviceStorageBase};assert(SecItemUpdate((__bridge CFDictionaryRef)qaQuery,(__bridge CFDictionaryRef)@{(__bridge id)kSecValueData:[preserved dataUsingEncoding:NSUTF8StringEncoding]})==errSecSuccess);
    assert(![other remove:YNXDeviceStorageBase error:&error]);error=nil;assert(![other store:before key:YNXDeviceStorageBase error:&error]);error=nil;assert([[other stored:YNXDeviceStorageBase error:&error] isEqual:preserved]);
    [other endUserOperation];output(@{@"proofSignature":proofSignature,@"resumeSignature":resumeSignature});
}return 0;}
