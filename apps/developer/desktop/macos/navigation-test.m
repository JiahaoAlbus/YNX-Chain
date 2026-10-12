#define main YNXDesktopApplicationMain
#include "main.m"
#undef main
#include <assert.h>

int main(void) { @autoreleasepool {
    NSInteger port=4177;
    NSURL *tools=[NSURL URLWithString:@"http://127.0.0.1:4177/native-tools?sessionId=01234567-1234-4321-8765-0123456789ab"];
    NSURL *public=[NSURL URLWithString:@"https://developer.ynxweb4.com/"];
    assert(YNXNewWindowNavigation(tools,port,WKNavigationTypeLinkActivated,YES)==YNXNavigationAllow);
    assert(YNXNewWindowNavigation(public,port,WKNavigationTypeLinkActivated,YES)==YNXNavigationOpenExternal);
    assert(YNXNewWindowNavigation(tools,port,WKNavigationTypeLinkActivated,NO)==YNXNavigationCancel);
    assert(YNXNewWindowNavigation(public,port,WKNavigationTypeLinkActivated,NO)==YNXNavigationCancel);
    assert(YNXNewWindowNavigation(tools,port,WKNavigationTypeOther,YES)==YNXNavigationCancel);
    assert(YNXNewWindowNavigation([NSURL URLWithString:@"about:blank"],port,WKNavigationTypeLinkActivated,YES)==YNXNavigationCancel);
    assert(YNXNewWindowNavigation([NSURL URLWithString:@"file:///private/tmp/data"],port,WKNavigationTypeLinkActivated,YES)==YNXNavigationCancel);
    assert(YNXNewWindowNavigation([NSURL URLWithString:@"javascript:alert(1)"],port,WKNavigationTypeLinkActivated,YES)==YNXNavigationCancel);
    assert(YNXNewWindowNavigation([NSURL URLWithString:@"http://127.0.0.1:4178/native-tools"],port,WKNavigationTypeLinkActivated,YES)==YNXNavigationOpenExternal);
    assert(YNXNewWindowNavigation([NSURL URLWithString:@"https://127.0.0.1:4177/native-tools"],port,WKNavigationTypeLinkActivated,YES)==YNXNavigationOpenExternal);
    for(NSString *value in @[@"https://developer.ynxweb4.com/projects",@"https://wallet-auth.ynxweb4.com/",@"https://01234567-1234-4321-8765-0123456789ab.runtime.example/"])
        assert(YNXHostedDocument([NSURL URLWithString:value]));
    for(NSString *value in @[@"file:///private/data",@"http://runtime.example/",@"javascript:alert(1)",@"https://user@runtime.example/",@"https://runtime.example:444/",@"https://127.0.0.1/",@"https://localhost/",@"https://runtime.local/",@"about:blank"])
        assert(!YNXHostedDocument([NSURL URLWithString:value]));
    assert(YNXWalletProjectsURL([NSURL URLWithString:@"https://developer.ynxweb4.com/projects"]));
    assert(!YNXWalletProjectsURL([NSURL URLWithString:@"https://developer.ynxweb4.com/projects?token=unexpected"]));
    assert(!YNXWalletProjectsURL([NSURL URLWithString:@"https://other.example/projects"]));
    NSString *pairing=[NSString stringWithFormat:@"wc:%@@2?relay-protocol=irn&symKey=%@",[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0],[@"b" stringByPaddingToLength:64 withString:@"b" startingAtIndex:0]];
    NSURLComponents *route=[NSURLComponents componentsWithString:@"ynxwallet://wc"];route.queryItems=@[[NSURLQueryItem queryItemWithName:@"uri" value:pairing]];
    NSURL *issuer=[NSURL URLWithString:@"https://wallet-auth.ynxweb4.com/v2/browser-sessions/authorize"];
    assert(YNXHostedWalletPair(route.URL,issuer,YES));
    assert(!YNXHostedWalletPair(route.URL,issuer,NO));
    assert(!YNXHostedWalletPair(route.URL,[NSURL URLWithString:@"https://other.example/v2/browser-sessions/authorize"],YES));
    assert(!YNXHostedWalletPair([NSURL URLWithString:@"ynxwallet://wc?uri="],issuer,YES));
    assert(!YNXHostedWalletPair([NSURL URLWithString:[route.URL.absoluteString stringByAppendingString:@"&extra=value"]],issuer,YES));
    route.queryItems=@[[NSURLQueryItem queryItemWithName:@"uri" value:[pairing stringByAppendingString:@"&expiryTimestamp=1"]]];assert(!YNXHostedWalletPair(route.URL,issuer,YES));
    puts("PASS 31 actual native navigation decisions; Wallet Pair URI remained synthetic and no OS launch or remote bridge authority granted");
} return 0; }
