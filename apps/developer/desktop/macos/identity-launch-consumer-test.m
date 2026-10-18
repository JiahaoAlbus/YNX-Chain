#import "ynx-wallet-admission-launch.h"
// PUBLIC lifecycle controls only. This test double is linked instead of Auth;
// it supplies no Source, Root, private key or qualified identity.
static int finishes,duplicates,retires,joins,closes,oldAdoptions;
static BOOL refuseCurrent,refusePost;
@implementation YNXOriginalIdentityPeerLaunchHolder {
    int _testEndpoint,_testPeer,_testDuplicate;
    BOOL _testRetired,_testClosed;
}
- (instancetype)init {if((self=[super init])){int pair[2];if(socketpair(AF_UNIX,SOCK_STREAM,0,pair))return nil;_testEndpoint=pair[0];_testPeer=pair[1];_testDuplicate=-1;}return self;}
+ (instancetype)captureInheritedOriginal:(NSError **)error {return nil;}
- (BOOL)assertCurrent:(NSError **)error {return NSThread.isMainThread&&!refuseCurrent&&!_testRetired;}
- (int)duplicateForBackendSpawn:(NSError **)error {duplicates++;return _testDuplicate=fcntl(_testEndpoint,F_DUPFD_CLOEXEC,10);}
- (BOOL)finishBackendSpawn:(pid_t)pid spawnStatus:(int)status error:(NSError **)error {
    if(!NSThread.isMainThread||fcntl(_testDuplicate,F_GETFD)<0)abort();
    finishes++;close(_testDuplicate);_testDuplicate=-1;return !status&&pid>0&&!refusePost;
}
- (void)retire {if(!NSThread.isMainThread)abort();if(!_testRetired){retires++;_testRetired=YES;}}
- (BOOL)join:(NSError **)error {if(!NSThread.isMainThread)abort();joins++;return _testRetired;}
- (BOOL)close:(NSError **)error {if(!NSThread.isMainThread)abort();if(!_testClosed){closes++;_testClosed=YES;close(_testEndpoint);close(_testPeer);if(_testDuplicate>=0)close(_testDuplicate);}return YES;}
- (NSError *)firstCause {return nil;}
- (BOOL)ready {return !_testRetired&&!refuseCurrent;}
@end
YNXIDEAdmissionAcquireOutcome *YNXOriginalAcquireIDEAdmissionParent(NSURL *r,pid_t p,NSError **e){return nil;}
BOOL YNXFinishIDEAdmissionAcquireCleanup(YNXIDEAdmissionAcquireOutcome *o,NSError **e){return o==nil;}
BOOL YNXOriginalAdoptIDEAdmissionChild(id<YNXWalletAdmissionParentGuard> g,pid_t p,NSError **e){oldAdoptions++;return NO;}
void YNXOriginalRetireIDEAdmissionParent(id<YNXWalletAdmissionParentGuard> g){}

static YNXWalletAdmissionBackendTask *task(NSURL *resources,YNXOriginalIdentityPeerLaunchHolder *holder,NSError *capture) {
    YNXWalletAdmissionBackendTask *value=[[YNXWalletAdmissionBackendTask alloc]initWithAcquireOutcome:nil resources:resources identityHolder:holder captureError:capture];
    value.arguments=@[[resources URLByAppendingPathComponent:@"server.mjs"].path];
    value.environment=@{};value.standardInput=[NSPipe pipe];
    value.standardOutput=[[NSFileHandle alloc]initWithFileDescriptor:open("/dev/null",O_WRONLY|O_CLOEXEC) closeOnDealloc:YES];value.standardError=value.standardOutput;return value;
}
int main(void){@autoreleasepool{
    NSString *root=[NSTemporaryDirectory() stringByAppendingPathComponent:[@"ynx-identity-consumer-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    NSFileManager *fs=NSFileManager.defaultManager;
    [fs createDirectoryAtPath:[root stringByAppendingPathComponent:@"runtime"] withIntermediateDirectories:YES attributes:nil error:nil];
    NSURL *resources=[NSURL fileURLWithPath:root];NSString *executable=[root stringByAppendingPathComponent:@"runtime/node"];
    [fs createSymbolicLinkAtPath:executable withDestinationPath:@"/bin/sh" error:nil];
    // Assert the actual child receives a socket at fd5; public test transport
    // does not attest or authorize an identity.
    [@"test -S /dev/fd/5 || exit 61\nexit 0\n" writeToFile:[root stringByAppendingPathComponent:@"server.mjs"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSError *error=nil;
    for(int mode=0;mode<3;mode++){
        refusePost=mode==1;YNXOriginalIdentityPeerLaunchHolder *holder=[YNXOriginalIdentityPeerLaunchHolder new];
        if(mode==2)[fs removeItemAtPath:executable error:nil];
        YNXWalletAdmissionBackendTask *run=task(resources,holder,nil);BOOL started=[run launchAndReturnError:&error];
        if(started!=(mode!=2)||finishes!=mode+1||duplicates!=mode+1||oldAdoptions){fprintf(stderr,"mode=%d started=%d finishes=%d duplicates=%d error=%s\n",mode,started,finishes,duplicates,error.description.UTF8String);return 10+mode;}
        if(started){[run waitUntilExit];if(run.running||run.terminationStatus!=0)return 20+mode;}
        if(![run finishIdentityCleanupForQuit:&error]||closes!=mode+1)return 30+mode;
        // A repeated launch may not create a second child or re-use the grant.
        if([run launchAndReturnError:&error]||finishes!=mode+1)return 40+mode;
    }
    refuseCurrent=YES;YNXOriginalIdentityPeerLaunchHolder *partial=[YNXOriginalIdentityPeerLaunchHolder new];
    YNXWalletAdmissionBackendTask *denied=task(resources,partial,nil);
    if([denied launchAndReturnError:&error]||finishes!=3||duplicates!=3||![denied finishIdentityCleanupForQuit:&error])return 50;
    NSError *capture=[NSError errorWithDomain:@"PUBLIC_CAPTURE" code:1 userInfo:nil];
    if([task(resources,nil,capture) launchAndReturnError:&error])return 51;
    // Missing identity retains normal local behavior; no old parent is needed.
    refuseCurrent=NO;[fs createSymbolicLinkAtPath:executable withDestinationPath:@"/bin/sh" error:nil];
    [@"exit 0\n" writeToFile:[root stringByAppendingPathComponent:@"server.mjs"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    YNXWalletAdmissionBackendTask *ordinary=task(resources,nil,nil);
    if(![ordinary launchAndReturnError:&error])return 52;[ordinary waitUntilExit];
    if(ordinary.terminationStatus||![ordinary finishIdentityCleanupForQuit:&error]||finishes!=3)return 53;
    [fs removeItemAtPath:root error:nil];
    printf("PUBLIC identity-only spawn/finish, failure ownership, post-failure local exit, partial refusal and standalone controls PASS\n");return 0;
}}
