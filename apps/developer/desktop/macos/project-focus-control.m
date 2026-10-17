// Disposable public-input native control, never an App admission fixture.
#import "ynx-project-focus.h"
static NSDictionary *recordAt(NSString *profile) {
    NSData *data=[NSData dataWithContentsOfFile:[profile stringByAppendingPathComponent:@"native-focus.json"]];
    return data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
}
static int child(NSString *executable,NSString *profile,NSString *project,BOOL expected) {
    NSTask *task=[NSTask new];task.executableURL=[NSURL fileURLWithPath:executable];task.arguments=@[@"request",profile,project,expected?@"yes":@"no"];
    NSError *error=nil;if(![task launchAndReturnError:&error]){fprintf(stderr,"request spawn failed: %s\n",error.localizedDescription.UTF8String);return 100;}
    [task waitUntilExit];return task.terminationStatus;
}
int main(int argc,const char **argv) {@autoreleasepool{
    if(argc==5&&!strcmp(argv[1],"request")){
        NSMutableDictionary *record=[recordAt(@(argv[2])) mutableCopy];
        // Keep client-side metadata consistent with the requested project, so
        // a foreign-project control exercises the actual receiving owner.
        record[@"projectId"]=@(argv[3]);
        NSDictionary *binding=@{@"workspace":record[@"workspace"]?:@"",@"profile":@(argv[2]),@"projectId":@(argv[3])};
        BOOL actual=[YNXProjectFocus requestBinding:binding record:record];
        return actual==!strcmp(argv[4],"yes")?0:1;
    }
    char root[]="/private/tmp/ynx-focus-control-XXXXXX";if(!mkdtemp(root))return 2;
    NSString *profile=@(root),*project=NSUUID.UUID.UUIDString.lowercaseString;
    NSDictionary *binding=@{@"workspace":profile,@"profile":profile,@"projectId":project};
    __block BOOL ready=YES;__block int activations=0;
    YNXProjectFocus *owner=[YNXProjectFocus new];
    if(![owner startWithBinding:binding focus:^BOOL{if(!ready)return NO;activations++;return YES;}])return 3;
    NSString *socket=recordAt(profile)[@"socket"];
    CFRunLoopRef loop=CFRunLoopGetCurrent();CFRetain(loop);__block int result=0;
    NSString *executable=NSProcessInfo.processInfo.arguments[0];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{@autoreleasepool{
        if(child(executable,profile,project,YES))result=4;
        if(!result&&child(executable,profile,NSUUID.UUID.UUIDString.lowercaseString,NO))result=5;
        NSString *foreign=NSProcessInfo.processInfo.environment[@"YNX_FOCUS_FOREIGN_BINARY"];
        if(!result&&foreign&&child(foreign,profile,project,NO))result=10;
        dispatch_sync(dispatch_get_main_queue(),^{ready=NO;});
        if(!result&&child(executable,profile,project,NO))result=6;
        dispatch_sync(dispatch_get_main_queue(),^{if(activations!=1)result=7;[owner stop];});
        if(!result&&child(executable,profile,project,NO))result=8;
        if([NSFileManager.defaultManager fileExistsAtPath:socket.stringByDeletingLastPathComponent])result=9;
        dispatch_async(dispatch_get_main_queue(),^{CFRunLoopStop(loop);});
    }});
    CFRunLoopRun();CFRelease(loop);
    if(!result)puts("PASS same-code real peer activates once; foreign project, unready owner, stopped owner refuse; socket directory cleaned");
    else fprintf(stderr,"focus control failed stage %d\n",result);
    unlink([profile stringByAppendingPathComponent:@"native-focus.json"].fileSystemRepresentation);rmdir(root);return result;
}}
