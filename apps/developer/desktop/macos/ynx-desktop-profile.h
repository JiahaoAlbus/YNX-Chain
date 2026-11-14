#import <Foundation/Foundation.h>

// QA is a sealed package choice, not an instruction to clear/migrate the normal
// user profile. One build ID survives Finder copy and subsequent reopen.
static NSString *YNXDesktopProfileSupportRoot(NSDictionary *environment,NSDictionary *info,NSString *home) {
    id identifier=info[@"YNXQAProfileIdentifier"];
    if(identifier){
        if(![identifier isKindOfClass:NSString.class])return nil;
        NSString *pattern=@"^[0-9a-f]{40}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
        NSRange matched=[identifier rangeOfString:pattern options:NSRegularExpressionSearch];
        if(matched.location!=0||matched.length!=[identifier length])return nil;
    }
    NSString *explicit=environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"];
    if(explicit.length)return explicit;
    if(identifier)return [[home stringByAppendingPathComponent:@"Library/Application Support/YNXDeveloper-QA"] stringByAppendingPathComponent:identifier];
    return [home stringByAppendingPathComponent:@"Library/Application Support/YNXDeveloper"];
}
static BOOL YNXDesktopUsesQAProfile(void) {
    return NSProcessInfo.processInfo.environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"].length||NSBundle.mainBundle.infoDictionary[@"YNXQAProfileIdentifier"]!=nil;
}
static NSString *YNXDesktopSupportRoot(void) {
    return YNXDesktopProfileSupportRoot(NSProcessInfo.processInfo.environment,NSBundle.mainBundle.infoDictionary,NSHomeDirectory());
}
static NSString *YNXDesktopFrameName(NSString *normal) {
    NSString *identifier=NSBundle.mainBundle.infoDictionary[@"YNXQAProfileIdentifier"];
    return identifier?[normal stringByAppendingFormat:@"-QA-%@",identifier]:normal;
}
static NSString *YNXDesktopProfileNamespace(NSString *normal,NSDictionary *info) {
    NSString *identifier=info[@"YNXQAProfileIdentifier"];
    return identifier?[normal stringByAppendingFormat:@".qa.%@",identifier]:normal;
}
static NSUUID *YNXDesktopQAWebsiteIdentifier(NSDictionary *info) {
    NSString *identifier=info[@"YNXQAProfileIdentifier"];
    if(!identifier||!YNXDesktopProfileSupportRoot(@{},info,@"/"))return nil;
    return [[NSUUID alloc]initWithUUIDString:[identifier substringFromIndex:41]];
}
static NSUserDefaults *YNXDesktopPreferences(void) {
    NSString *identifier=NSBundle.mainBundle.infoDictionary[@"YNXQAProfileIdentifier"];
    return identifier?[[NSUserDefaults alloc]initWithSuiteName:[@"com.ynxweb4.developer.qa." stringByAppendingString:identifier]]:NSUserDefaults.standardUserDefaults;
}
