#define main YNXProductionMain
#include "../../desktop/macos/main.m"
#undef main

static void Require(BOOL ok, NSString *message) { if(!ok){fprintf(stderr,"%s\n",message.UTF8String);exit(1);} }
static BOOL PumpUntil(BOOL (^done)(void), NSTimeInterval seconds) {
    NSDate *end=[NSDate dateWithTimeIntervalSinceNow:seconds];
    while(!done() && end.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
    return done();
}
int main(int argc,const char *argv[]) { @autoreleasepool {
    Require(argc==2,@"Temporary support directory is required");
    setenv("YNX_CODE_DESKTOP_SUPPORT_DIR",argv[1],1);
    NSDictionary *original=@{@"id":@"async-recovery",@"name":@"Existing project",@"revision":@1,@"remoteRevision":@0,@"files":@{@"main.cpp":@"original saved text"},@"folders":@[],@"open":@[@"main.cpp"],@"active":@"main.cpp"};
    NSMutableDictionary *changed=[original mutableCopy];changed[@"files"]=@{@"main.cpp":@"new text"};changed[@"revision"]=@2;
    NSURL *url=YNXWorkspaceSnapshotURL();NSError *writeError=nil;
    Require(YNXWriteWorkspaceSnapshot(url,original,&writeError),@"Fixture snapshot write failed");
    NSData *before=[NSData dataWithContentsOfURL:url];
    YNXWorkspaceBridge *bridge=[YNXWorkspaceBridge new];
    Require(!bridge.restoreComplete && !bridge.restoring && !bridge.initialProject,@"Bridge init must not perform recovery I/O");
    dispatch_semaphore_t entered=dispatch_semaphore_create(0),release=dispatch_semaphore_create(0);
    __block BOOL finished=NO,mainResponsive=NO,saveRejected=NO,duplicateRejected=NO;
    __block NSUInteger readCount=0;
    [bridge restoreUsingReader:^NSDictionary *(NSError **error){
        readCount++;dispatch_semaphore_signal(entered);dispatch_semaphore_wait(release,DISPATCH_TIME_FOREVER);
        return YNXReadWorkspaceSnapshot(url,error);
    } completion:^(NSError *error){Require(NSThread.isMainThread,@"Recovery completion must return to main");Require(!error,@"Delayed read failed");finished=YES;}];
    Require(dispatch_semaphore_wait(entered,dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC))==0,@"Reader did not start");
    dispatch_async(dispatch_get_main_queue(),^{mainResponsive=YES;});
    Require(PumpUntil(^BOOL{return mainResponsive;},1),@"A blocked snapshot read blocked the main queue");
    Require(bridge.restoring && !bridge.restoreComplete && !finished,@"Unfinished read must not be treated as an empty workspace");
    [bridge saveProject:changed completion:^(NSError *error){saveRejected=error!=nil;}];
    Require(saveRejected,@"Unfinished recovery must reject default/changed snapshot writes");
    [bridge restoreUsingReader:^NSDictionary *(NSError **error){readCount++;return nil;} completion:^(NSError *error){duplicateRejected=error!=nil;}];
    Require(duplicateRejected && readCount==1,@"Retry while blocked must not create another in-flight reader");
    Require([before isEqualToData:[NSData dataWithContentsOfURL:url]],@"Pending recovery changed the saved file");
    dispatch_semaphore_signal(release);
    Require(PumpUntil(^BOOL{return finished;},2),@"Delayed recovery did not complete");
    Require(bridge.restoreComplete && [bridge.initialProject isEqual:original],@"Late recovery must restore the original project");
    __block BOOL saved=NO;
    [bridge saveProject:changed completion:^(NSError *error){Require(NSThread.isMainThread && !error,@"Save acknowledgement failed");saved=YES;}];
    Require(PumpUntil(^BOOL{return saved;},2),@"Serialized save did not acknowledge");
    NSError *readError=nil;Require([YNXReadWorkspaceSnapshot(url,&readError) isEqual:changed],@"Acknowledged save did not preserve current edits");
    NSData *acknowledged=[NSData dataWithContentsOfURL:url];
    __block BOOL failed=NO;
    [bridge restoreUsingReader:^NSDictionary *(NSError **error){*error=[NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadNoPermissionError userInfo:nil];return nil;} completion:^(NSError *error){failed=error!=nil;}];
    Require(PumpUntil(^BOOL{return failed;},2),@"Read failure was not delivered");
    Require(!bridge.restoreComplete && bridge.readError!=nil,@"Permission failure must never initialize an empty workspace");
    saveRejected=NO;[bridge saveProject:original completion:^(NSError *error){saveRejected=error!=nil;}];
    Require(saveRejected && [acknowledged isEqualToData:[NSData dataWithContentsOfURL:url]],@"Failed recovery overwrote acknowledged data");
    printf("Blocked recovery keeps the main queue responsive; pending/failed reads reject writes; late restore and serialized save preserve the project.\n");
    return 0;
} }
