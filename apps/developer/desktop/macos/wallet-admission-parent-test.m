#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <fcntl.h>
#import <unistd.h>
#import <errno.h>

// PUBLIC dummy bundle only. Compile-local fault, never a product factory or
// real Wallet/provider. Original syscalls are retained for actual file cleanup.
static int (*const OriginalClose)(int)=close;
static int (*const OriginalOpenAt)(int,const char *,int,...)=openat;
static BOOL failClose=NO,closeFaultSelected=NO,throwCapture=NO;
static NSUInteger closeCalls=0,entryOpens=0;
static NSException *originalException;
static int PublicClose(int fd) {
    closeCalls++;
    int result=OriginalClose(fd);
    if(failClose&&!closeFaultSelected){closeFaultSelected=YES;errno=EIO;return -1;}
    return result;
}
static int PublicOpenAt(int fd,const char *name,int flags) {
    if(strcmp(name,"server.mjs")==0)entryOpens++;
    if(throwCapture&&strcmp(name,"runtime")==0)@throw originalException;
    return OriginalOpenAt(fd,name,flags);
}
#define close PublicClose
#define openat PublicOpenAt
#import "ynx-wallet-admission-parent.m"
#import "ynx-wallet-admission-launch.h"
#undef close
#undef openat

int main(int argc,const char **argv) {@autoreleasepool{
    if(argc!=2)return 100;
    NSString *mode=[NSString stringWithUTF8String:argv[1]];
    NSURL *resources=NSBundle.mainBundle.resourceURL;
    // The Node driver creates this dedicated public-probe.app/Resources fixture.
    if(![NSBundle.mainBundle.bundleIdentifier isEqual:@"invalid.ynx.public-observation-probe"])return 101;
    failClose=[mode isEqual:@"close-failure"]||[mode isEqual:@"exception-close-failure"];
    throwCapture=[mode isEqual:@"exception-close-failure"];
    originalException=[NSException exceptionWithName:@"PUBLIC_CAPTURE_EXCEPTION" reason:@"PUBLIC" userInfo:nil];
#if PUBLIC_LEGACY_R4
    id<YNXWalletAdmissionParentGuard> parent=YNXAcquireWalletAdmissionParent(resources);
    YNXWalletAdmissionBackendTask *task=[[YNXWalletAdmissionBackendTask alloc]initWithParent:parent resources:resources];
    printf("{\"legacy\":true,\"guardNil\":%s,\"cleanupComplete\":%s,\"firstCausePresent\":%s,\"closeCalls\":%lu}\n",
        parent?"false":"true",[task finishAdmissionCleanup]?"true":"false",task.admissionFirstFailure?"true":"false",(unsigned long)closeCalls);
#else
    YNXIDEAdmissionAcquireOutcome *outcome=YNXAcquireWalletAdmissionOutcome(resources);
    if(!outcome||outcome.guard||!outcome.firstCause)return 1;
    NSUInteger selected=closeCalls;
    if(failClose){
        if(outcome.kind!=YNXIDEAdmissionCleanupIncomplete||!outcome.cleanupError||!closeFaultSelected)return 2;
        if(throwCapture&&outcome.firstCause!=originalException)return 3;
        if(YNXWalletAdmissionCleanupMayFinish(nil,outcome,nil))return 4;
        NSError *sameError=nil;
        if(YNXFinishIDEAdmissionAcquireCleanup(outcome,&sameError)||sameError!=outcome.cleanupError)return 5;
    }else if(outcome.kind!=YNXIDEAdmissionCleanRefusal||outcome.cleanupError||!YNXWalletAdmissionCleanupMayFinish(nil,outcome,nil))return 6;
    YNXWalletAdmissionBackendTask *task=[[YNXWalletAdmissionBackendTask alloc]initWithAcquireOutcome:outcome resources:resources];
    if(failClose){
        if([task finishAdmissionCleanup]||task.admissionFirstFailure!=outcome.firstCause||task.admissionCleanupFailure!=outcome.cleanupError)return 7;
        if(YNXWalletAdmissionCleanupMayFinish(task,nil,nil))return 8;
        [task retireAdmission];[task terminate];
        if([task finishAdmissionCleanup]||task.terminationStatus==0||task.running||closeCalls!=selected)return 9;
    }else{
        [task retireAdmission];if(!YNXWalletAdmissionCleanupMayFinish(task,nil,nil)||closeCalls!=selected)return 10;
    }
    if([mode isEqual:@"fifo-node"]&&entryOpens!=0)return 11;
    if([mode hasPrefix:@"fifo-"]&&![[(NSError *)outcome.firstCause localizedDescription] isEqual:@"IDE_PARENT_EXECUTABLE_ENTRY_UNAVAILABLE"])return 12;
    printf("{\"mode\":\"%s\",\"guardNil\":true,\"cleanupComplete\":%s,\"closeCalls\":%lu,\"firstCausePreserved\":true}\n",argv[1],failClose?"false":"true",(unsigned long)closeCalls);
#endif
    return 0;
}}
