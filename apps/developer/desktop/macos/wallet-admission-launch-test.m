#import <Foundation/Foundation.h>
#import "ynx-wallet-admission-launch.h"
// PUBLIC host syntax harness, no spawn/key/private/custodian/runtime execution.
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
int main(void){@autoreleasepool{
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
