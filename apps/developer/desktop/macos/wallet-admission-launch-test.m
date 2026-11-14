#import <Foundation/Foundation.h>
#import <unistd.h>
#import <fcntl.h>
#import <errno.h>
#import <sys/socket.h>
// PUBLIC OS-boundary fault only. The entire original BackendTask class runs;
// no App, Wallet, qualified acquisition factory or private provider is executed.
static int PublicTarget=-1,PublicErrno=0,PublicCloseCalls=0;
static int PublicRawClose(int fd){return close(fd);}
static int PublicClose(int fd){
    if(fd==PublicTarget&&PublicErrno){PublicCloseCalls++;int result=close(fd);if(result!=0)return result;errno=PublicErrno;return -1;}
    return close(fd);
}
#define close(fd) PublicClose(fd)
#ifndef YNX_PUBLIC_ADMISSION_HEADER
#define YNX_PUBLIC_ADMISSION_HEADER "ynx-wallet-admission-launch.h"
#endif
#import YNX_PUBLIC_ADMISSION_HEADER
#undef close
@interface PublicStrictParent : NSObject <YNXWalletAdmissionParentGuard>
@property(nonatomic) NSUInteger calls,closes;
@property(nonatomic,strong) NSURL *seenNode;
@property(nonatomic) BOOL throwClose;
@end
@implementation PublicStrictParent
- (int)descriptor{return -1;}
- (pid_t)parentPID{return getppid();}
- (NSURL *)approvedWorkspaceURL{return nil;}
- (BOOL)assertCurrentResources:(NSURL *)r node:(NSURL *)n entry:(NSURL *)e child:(pid_t)c error:(NSError **)error{
    self.calls++;self.seenNode=n;return [n isEqual:[r URLByAppendingPathComponent:@"runtime/node"]];
}
- (void)close{self.closes++;if(self.throwClose)@throw [NSException exceptionWithName:@"PUBLIC_CLOSE" reason:@"PUBLIC" userInfo:nil];}
@end
static int PublicLegacyControl(void){@autoreleasepool{
    NSURL *resources=[NSURL fileURLWithPath:@"/PUBLIC/Resources"];
    PublicStrictParent *parent=[PublicStrictParent new];parent.throwClose=YES;
    YNXWalletAdmissionBackendTask *task=[[YNXWalletAdmissionBackendTask alloc]initWithParent:parent resources:resources];
    if(![parent.seenNode isEqual:[resources URLByAppendingPathComponent:@"runtime/node"]])return 1;
    // fd=-1 deliberately denies duplication; no connected native launch.
    if(parent.closes!=1||[task finishAdmissionCleanup]||!task.admissionCleanupFailure)return 2;
    [task retireAdmission];[task terminate];if(parent.closes!=1||task.running||task.terminationStatus==0)return 3;
    parent.throwClose=NO;[task retireAdmission];if([task finishAdmissionCleanup]||parent.closes!=1)return 4;
    YNXWalletAdmissionBackendTask *ordinary=[[YNXWalletAdmissionBackendTask alloc]initWithParent:nil resources:resources];
    [ordinary retireAdmission];if(![ordinary finishAdmissionCleanup])return 5;
    return 0;
}}

@interface PublicFDParent : PublicStrictParent
@property(nonatomic) int originalFD;
@property(nonatomic) BOOL denyCurrent;
@property(nonatomic,strong) NSError *operationCause;
@property(nonatomic,strong) id closeCause;
@end
@implementation PublicFDParent
- (int)descriptor{return self.originalFD;}
- (BOOL)assertCurrentResources:(NSURL *)r node:(NSURL *)n entry:(NSURL *)e child:(pid_t)c error:(NSError **)error{
    if(self.denyCurrent){if(error)*error=self.operationCause;return NO;}
    return [super assertCurrentResources:r node:n entry:e child:c error:error];
}
- (void)close{self.closes++;if(self.closeCause)@throw self.closeCause;PublicRawClose(self.originalFD);self.originalFD=-1;}
@end
static int PublicFail(int code,const char *message){fprintf(stderr,"PUBLIC control failed %d: %s\n",code,message);return code;}
int main(int argc,const char **argv){@autoreleasepool{
    if(argc<2)return PublicLegacyControl();
    NSString *mode=[NSString stringWithUTF8String:argv[1]];
    if([mode isEqual:@"ordinary"]){
        YNXWalletAdmissionBackendTask *task=[[YNXWalletAdmissionBackendTask alloc]initWithParent:nil resources:[NSURL fileURLWithPath:@"/PUBLIC/Resources"]];
        task.executableURL=[NSURL fileURLWithPath:@"/usr/bin/true"];task.arguments=@[];task.environment=@{@"PATH":@"/usr/bin:/bin"};
        NSError *error=nil;if(![task launchAndReturnError:&error])return PublicFail(1,"ordinary PUBLIC process did not launch");
        [task waitUntilExit];[task retireAdmission];
        if(task.running||task.terminationStatus!=0||![task finishAdmissionCleanup])return PublicFail(2,"ordinary process did not finish cleanly");
        puts("PUBLIC ordinary output/exit/cleanup PASS");return 0;
    }
    PublicFDParent *parent=[PublicFDParent new];parent.originalFD=open("/dev/null",O_RDONLY|O_CLOEXEC);
    if(parent.originalFD<0)return PublicFail(3,"PUBLIC source fd unavailable");
    parent.operationCause=[NSError errorWithDomain:@"PUBLIC_OPERATION" code:71 userInfo:nil];
    YNXWalletAdmissionBackendTask *task=[[YNXWalletAdmissionBackendTask alloc]initWithParent:parent resources:[NSURL fileURLWithPath:@"/PUBLIC/Resources"]];
    PublicTarget=[[task valueForKey:@"channelDescriptor"] intValue];
    if(PublicTarget<10)return PublicFail(4,"real owned duplicate not captured");
    parent.denyCurrent=YES;
    if([mode isEqual:@"eio"]||[mode isEqual:@"double"])PublicErrno=EIO;
    if([mode isEqual:@"eintr"])PublicErrno=EINTR;
    if([mode isEqual:@"double"])parent.closeCause=@0; // raw/falsy object identity
    NSError *error=nil;
    if([task launchAndReturnError:&error]||error!=parent.operationCause)return PublicFail(5,"actual launch preflight did not preserve operation failure");
    if(task.admissionFirstFailure!=parent.operationCause||parent.closes!=1)return PublicFail(6,"original operation or parent close selection lost");
    if(PublicErrno){
        if([task finishAdmissionCleanup]||task.terminationStatus==0)return PublicFail(7,"uncertain owned close incorrectly reported complete");
        id cleanup=task.admissionCleanupFailure;
        if(![cleanup isKindOfClass:NSError.class]||[(NSError *)cleanup code]!=PublicErrno)return PublicFail(8,"owned close cause overwritten");
        if([mode isEqual:@"double"]&&[task valueForKey:@"parentCleanupFailure"]!=parent.closeCause)return PublicFail(9,"independent raw parent cleanup cause lost");
        // Recycle only this PUBLIC fixture's now-closed duplicate number. Query
        // and repeated retirement must never close the replacement descriptor.
        int base=open("/dev/null",O_RDONLY|O_CLOEXEC);int recycled=fcntl(base,F_DUPFD_CLOEXEC,PublicTarget);PublicRawClose(base);
        if(recycled!=PublicTarget)return PublicFail(10,"PUBLIC replacement fd was not exact");
        for(int i=0;i<4;i++){[task retireAdmission];(void)[task finishAdmissionCleanup];[task terminate];}
        if(PublicCloseCalls!=1||fcntl(recycled,F_GETFD)<0||[task finishAdmissionCleanup]||task.admissionCleanupFailure!=cleanup||task.admissionFirstFailure!=parent.operationCause)return PublicFail(11,"close retried, first cause changed or debt forgotten");
        PublicRawClose(recycled);
    }else if(![task finishAdmissionCleanup]||task.admissionCleanupFailure)return PublicFail(12,"successful independent cleanup refused");
    if(parent.originalFD>=0)PublicRawClose(parent.originalFD);
    printf("PUBLIC %s actual BackendTask launch/retire/status PASS\n",argv[1]);return 0;
}}
