#import <Foundation/Foundation.h>
#import <signal.h>
#import <stdio.h>

static NSUInteger checks=0;
static NSMutableArray *rawCalls;
static NSString *rawCallsPath;
static void check(BOOL ok, const char *name) {
    checks++;if(!ok){fprintf(stderr,"FAIL %s\n",name);exit(1);}
}
static NSDictionary *run(NSString *executable, NSArray<NSString *> *arguments) {
    NSTask *task=[NSTask new];task.executableURL=[NSURL fileURLWithPath:executable];task.arguments=arguments;
    // Metadata is still read from the actual main bundle, not an env claim.
    task.environment=@{@"YNX_NETWORK_NATIVE_LOCALE":@"en",@"YNX_NETWORK_NATIVE_THEME":@"system",
      @"QA_NATIVE_CONSENT_BUNDLE_ID":@"dev.ynx.network.consent.qa.hffffffffffffffff"};
    NSPipe *input=[NSPipe pipe],*output=[NSPipe pipe],*errors=[NSPipe pipe];
    task.standardInput=input;task.standardOutput=output;task.standardError=errors;
    NSError *error=nil;
    check([task launchAndReturnError:&error],"actual native process launched");
    [input.fileHandleForWriting closeFile];
    dispatch_semaphore_t finished=dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{[task waitUntilExit];dispatch_semaphore_signal(finished);});
    if(dispatch_semaphore_wait(finished,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC))!=0) {
        if(task.running)kill(task.processIdentifier,SIGKILL);
        dispatch_semaphore_wait(finished,dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC));
        check(NO,"native identity process must not enter GUI or hang");
    }
    NSData *stdoutData=[output.fileHandleForReading readDataToEndOfFile];
    NSData *stderrData=[errors.fileHandleForReading readDataToEndOfFile];
    [rawCalls addObject:@{@"executable":executable,@"arguments":arguments,@"exit":@(task.terminationStatus),@"terminationReason":@(task.terminationReason),
      @"stdout":[[NSString alloc]initWithData:stdoutData encoding:NSUTF8StringEncoding]?:@"INVALID_UTF8",
      @"stderr":[[NSString alloc]initWithData:stderrData encoding:NSUTF8StringEncoding]?:@"INVALID_UTF8"}];
    NSData *raw=[NSJSONSerialization dataWithJSONObject:rawCalls options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:NULL];
    check([raw writeToFile:rawCallsPath atomically:YES],"raw process readback preserved");
    return @{@"exit":@(task.terminationStatus),@"reason":@(task.terminationReason),@"stdout":stdoutData,@"stderr":stderrData};
}
static NSMutableDictionary *info(NSString *identifier) {
    return [@{@"CFBundleIdentifier":identifier,@"CFBundleExecutable":@"ynx-network-native-consent",
      @"CFBundlePackageType":@"APPL",@"CFBundleName":@"YNX Network Consent",
      @"CFBundleDisplayName":@"YNX Network Consent",@"CFBundleShortVersionString":@"0.3.0",
      @"CFBundleVersion":@"1",@"LSMinimumSystemVersion":@"12.0",@"NSHighResolutionCapable":@YES,
      @"NSPrincipalClass":@"NSApplication"}mutableCopy];
}
static NSString *fixture(NSString *root, NSString *name, NSString *wrapper, NSDictionary *metadata) {
    NSString *app=[root stringByAppendingPathComponent:[name stringByAppendingString:@".app"]];
    NSString *contents=[app stringByAppendingPathComponent:@"Contents"];
    NSString *macos=[contents stringByAppendingPathComponent:@"MacOS"];
    NSError *error=nil;
    check([NSFileManager.defaultManager createDirectoryAtPath:macos withIntermediateDirectories:YES attributes:nil error:&error],"private test app directory created");
    NSString *executable=[macos stringByAppendingPathComponent:@"ynx-network-native-consent"];
    check([NSFileManager.defaultManager copyItemAtPath:wrapper toPath:executable error:&error],"actual production wrapper copied");
    if(metadata) {
        NSData *data=[NSPropertyListSerialization dataWithPropertyList:metadata format:NSPropertyListXMLFormat_v1_0 options:0 error:&error];
        check(data&&[data writeToFile:[contents stringByAppendingPathComponent:@"Info.plist"] options:NSDataWritingAtomic error:&error],"actual Info.plist written");
    }
    return executable;
}
static void denied(NSDictionary *result) {
    check([result[@"reason"]integerValue]==NSTaskTerminationReasonExit,"invalid identity exits normally, not by signal");
    check([result[@"exit"]intValue]==2,"invalid bundle/arguments fail with exit2");
    check([result[@"stdout"]length]==0,"invalid identity has no stdout or authority");
}
int main(int argc,const char **argv) {
    @autoreleasepool {
        if(argc!=3){fputs("expected compiled production wrapper and empty artifact directory\n",stderr);return 2;}
        NSString *wrapper=@(argv[1]),*root=@(argv[2]);
        rawCalls=[NSMutableArray new];rawCallsPath=[root stringByAppendingPathComponent:@"identity-process-readbacks.json"];
        check([wrapper.lastPathComponent isEqualToString:@"ynx-network-native-consent"],"production basename fixed");
        check([NSFileManager.defaultManager isExecutableFileAtPath:wrapper],"production wrapper exists");
        NSString *first=nil;
        NSUInteger index=0;
        for(NSString *suffix in @[@"0123456789abcdef",@"fedcba9876543210",@"0000000000000000"]) {
            NSString *identifier=[@"dev.ynx.network.consent.qa.h"stringByAppendingString:suffix];
            NSString *executable=fixture(root,[NSString stringWithFormat:@"valid-%lu",(unsigned long)index++],wrapper,info(identifier));
            if(!first)first=executable;
            NSDictionary *result=run(executable,@[@"--identity"]);
            check([result[@"reason"]integerValue]==NSTaskTerminationReasonExit,"valid identity exits normally");
            check([result[@"exit"]intValue]==0,"real minimal app identity succeeds");
            check([result[@"stderr"]length]==0,"valid identity stderr empty");
            NSDictionary *identity=[NSJSONSerialization JSONObjectWithData:result[@"stdout"] options:0 error:NULL];
            check([identity isKindOfClass:NSDictionary.class]&&identity.count==4,"identity stdout exactly four JSON fields");
            check([identity[@"version"]isEqualToString:@"YNX-NETWORK-NATIVE-CONSENT-IDENTITY/v1"],"fixed identity protocol");
            check([identity[@"bundleIdentifier"]isEqualToString:identifier],"actual NSBundle.mainBundle identifier read back");
            check([identity[@"executable"]isEqualToString:@"ynx-network-native-consent"],"reported executable basename fixed");
            check(identity[@"authority"]==(__bridge id)kCFBooleanFalse,"identity explicitly grants no authority");
            for(NSString *key in @[@"signature",@"humanVerified",@"decision",@"publisher",@"walletApproval"])check(!identity[key],"identity does not claim consent or signature");
        }
        denied(run(wrapper,@[@"--identity"])); // Actual bare invocation, no Info.plist.
        NSString *identifier=@"dev.ynx.network.consent.qa.h0123456789abcdef";
        NSArray *changes=@[
          @[@"CFBundleIdentifier",@"dev.ynx.network.consent.qa.h0123456789abcdeF"],
          @[@"CFBundleIdentifier",@"dev.ynx.network.consent.qa.h0123456789abcde"],
          @[@"CFBundleIdentifier",@"dev.ynx.network.consent.qa.h0123456789abcdef0"],
          @[@"CFBundleIdentifier",@"dev.ynx.network.qa.h0123456789abcdef"],
          @[@"CFBundleIdentifier",@"dev.ynx.network.consent.qa.h0123456789abcdeg"],
          @[@"CFBundleIdentifier",@YES],@[@"CFBundleExecutable",@"other-executable"],
          @[@"CFBundleExecutable",@YES],@[@"CFBundlePackageType",@"BNDL"],@[@"CFBundlePackageType",@YES]
        ];
        for(NSArray *change in changes) {
            NSMutableDictionary *metadata=info(identifier);metadata[change[0]]=change[1];
            NSString *executable=fixture(root,[NSString stringWithFormat:@"invalid-%lu",(unsigned long)index++],wrapper,metadata);
            denied(run(executable,@[@"--identity"]));
        }
        for(NSString *missing in @[@"CFBundleIdentifier",@"CFBundleExecutable",@"CFBundlePackageType"]) {
            NSMutableDictionary *metadata=info(identifier);[metadata removeObjectForKey:missing];
            denied(run(fixture(root,[NSString stringWithFormat:@"missing-%lu",(unsigned long)index++],wrapper,metadata),@[@"--identity"]));
        }
        denied(run(fixture(root,@"no-info",wrapper,nil),@[@"--identity"]));
        // A sibling executable cannot inherit valid metadata and pretend it
        // was launched with the fixed Mach-O basename.
        NSString *renamed=[first.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"renamed-consent"];
        check([NSFileManager.defaultManager copyItemAtPath:wrapper toPath:renamed error:NULL],"renamed executable fixture created");
        denied(run(renamed,@[@"--identity"]));
        for(NSArray *arguments in @[@[],@[@"--unknown"],@[@"--identity",@"extra"],@[@"--native-consent",@"extra"]])denied(run(first,arguments));
        NSDictionary *legacy=run(first,@[@"--native-consent"]);
        denied(legacy);
        check([[[NSString alloc]initWithData:legacy[@"stderr"] encoding:NSUTF8StringEncoding]isEqualToString:@"INVALID_PACKET\n"],"legacy consent mode remains actual parser path with EOF, no GUI");
        printf("PASS %lu native identity checks using real production wrapper and minimal .app Info.plist; no GUI/LaunchServices/human approval observed\n",(unsigned long)checks);
        return 0;
    }
}
