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
    puts("PASS 10 actual native navigation decisions; no UI launched or remote bridge authority granted");
} return 0; }
