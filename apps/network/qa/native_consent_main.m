#import "native_consent.m"
#import <limits.h>
#import <mach-o/dyld.h>
#import <string.h>

// A separate fixed native executable keeps the prompt signature independent
// of the helper and outer App seal. No path, command or presenter is selectable.
static BOOL QAConsentIdentityIdentifier(NSString *identifier) {
    NSString *prefix=@"dev.ynx.network.consent.qa.h";
    if(![identifier isKindOfClass:NSString.class]||identifier.length!=prefix.length+16||![identifier hasPrefix:prefix])return NO;
    for(NSUInteger i=prefix.length;i<identifier.length;i++) {
        unichar c=[identifier characterAtIndex:i];
        if(!(c>='0'&&c<='9')&&!(c>='a'&&c<='f'))return NO;
    }
    return YES;
}
static NSData *QAConsentIdentityData(void) {
    @autoreleasepool {
      @try {
        // Read the process's real main bundle. No supplied path, environment
        // identifier, launch-services registration or NSApplication is used.
        NSBundle *bundle=NSBundle.mainBundle;
        NSDictionary *info=bundle.infoDictionary;
        NSString *fixedExecutable=@"ynx-network-native-consent";
        id identifier=info[@"CFBundleIdentifier"], executable=info[@"CFBundleExecutable"], package=info[@"CFBundlePackageType"];
        if(!QAConsentIdentityIdentifier(identifier)||![executable isKindOfClass:NSString.class]||
           ![executable isEqualToString:fixedExecutable]||![package isKindOfClass:NSString.class]||
           ![package isEqualToString:@"APPL"]||![[bundle.bundleURL pathExtension]isEqualToString:@"app"]||
           ![bundle.bundleIdentifier isEqualToString:identifier]||![[bundle.executableURL lastPathComponent]isEqualToString:fixedExecutable]) {
            fputs("INVALID_NATIVE_CONSENT_IDENTITY\n",stderr);return nil;
        }
        char path[PATH_MAX+1]; uint32_t length=sizeof(path);
        if(_NSGetExecutablePath(path,&length)!=0) { fputs("INVALID_NATIVE_CONSENT_IDENTITY\n",stderr);return nil; }
        NSString *actualPath=[[NSString alloc]initWithUTF8String:path];
        if(![[actualPath lastPathComponent]isEqualToString:fixedExecutable]) { fputs("INVALID_NATIVE_CONSENT_IDENTITY\n",stderr);return nil; }
        NSData *response=[NSJSONSerialization dataWithJSONObject:@{
            @"version":@"YNX-NETWORK-NATIVE-CONSENT-IDENTITY/v1",@"bundleIdentifier":bundle.bundleIdentifier,
            @"executable":fixedExecutable,@"authority":@NO
        } options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:NULL];
        if(!response) { fputs("INVALID_NATIVE_CONSENT_IDENTITY\n",stderr);return nil; }
        return response;
      } @catch(NSException *exception) {
        // Foundation may throw before returning an info dictionary when a
        // malformed Info.plist uses a non-string bundle identifier.
        (void)exception;fputs("INVALID_NATIVE_CONSENT_IDENTITY\n",stderr);return nil;
      }
    }
}
static int QAConsentIdentityMain(void) {
    @autoreleasepool {
        NSData *response=QAConsentIdentityData();if(!response)return 2;
        const uint8_t *bytes=response.bytes;NSUInteger offset=0;
        while(offset<response.length){ssize_t n=write(STDOUT_FILENO,bytes+offset,response.length-offset);if(n<0&&errno==EINTR)continue;if(n<=0)return 2;offset+=(NSUInteger)n;}
        return 0;
    }
}
int main(int argc,const char **argv) {
    if(argc!=2) {
        fputs("FIXED_NATIVE_CONSENT_MODE_REQUIRED\n",stderr);return 2;
    }
    if(strcmp(argv[1],"--identity")==0)return QAConsentIdentityMain();
    if(strcmp(argv[1],"--native-consent")==0){@autoreleasepool{if(!QAConsentIdentityData())return 2;}return QANativeConsentMain();}
    fputs("FIXED_NATIVE_CONSENT_MODE_REQUIRED\n",stderr);return 2;
}
