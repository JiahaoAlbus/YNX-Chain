#import <Foundation/Foundation.h>
#import <spawn.h>
#import <sys/socket.h>
#import <sys/wait.h>
#import "ynx-wallet-admission-parent.h"
// PUBLIC caller controls only. No real spawn, identity, broker, service or key.
static BOOL failSpawn,failAdopt,throwAdopt,throwRetire,throwClose,failDebt;
static NSUInteger adoptions,retirements,waitSchedules;
static pid_t adoptedPID;
static id firstAdopt,firstRetire,firstClose,firstDebt;
static int PublicSpawn(pid_t *pid,const char *p,const posix_spawn_file_actions_t *a,const posix_spawnattr_t *b,char *const argv[],char *const env[]){if(failSpawn)return EIO;*pid=31415;return 0;}
#define posix_spawn PublicSpawn
#define dispatch_async(queue,block) (++waitSchedules)
#define dispatch_source_create(...) ((dispatch_source_t)nil)
#define dispatch_source_set_timer(...) ((void)0)
#define dispatch_source_set_event_handler(...) ((void)0)
#define dispatch_resume(...) ((void)0)
#import "ynx-wallet-admission-launch.h"
@interface PublicParent:NSObject<YNXWalletAdmissionParentGuard>
@property int fd;
@property NSUInteger zero,positive,closes;
@property BOOL adopted;
@end
@implementation PublicParent
- (int)descriptor{return self.fd;}
- (pid_t)parentPID{return getppid();}
- (NSURL *)approvedWorkspaceURL{return nil;}
- (BOOL)assertCurrentResources:(NSURL *)r node:(NSURL *)n entry:(NSURL *)e child:(pid_t)c error:(NSError **)error{
 if(c==0){self.zero++;return !self.adopted;}
 self.positive++;return self.adopted&&c==31415;
}
- (void)close{self.closes++;if(throwClose)@throw firstClose;}
@end
BOOL YNXOriginalAdoptIDEAdmissionChild(id<YNXWalletAdmissionParentGuard> guard,pid_t child,NSError **error){
 adoptions++;adoptedPID=child;if(throwAdopt)@throw firstAdopt;
 if(failAdopt){if(error)*error=firstAdopt;return NO;}((PublicParent *)guard).adopted=YES;return YES;
}
void YNXOriginalRetireIDEAdmissionParent(id<YNXWalletAdmissionParentGuard> guard){retirements++;if(throwRetire)@throw firstRetire;}
YNXIDEAdmissionAcquireOutcome *YNXOriginalAcquireIDEAdmissionParent(NSURL *r,pid_t p,NSError **e){return nil;}
BOOL YNXFinishIDEAdmissionAcquireCleanup(YNXIDEAdmissionAcquireOutcome *o,NSError **e){if(failDebt){if(e)*e=firstDebt;return NO;}return YES;}
int main(int argc,const char **argv){@autoreleasepool{
 NSString *mode=argc>1?[NSString stringWithUTF8String:argv[1]]:@"success";
 failSpawn=[mode isEqual:@"spawn-failure"];failAdopt=[mode isEqual:@"adopt-failure"];throwAdopt=[mode isEqual:@"adopt-exception"];throwRetire=[mode isEqual:@"retire-exception"]||[mode isEqual:@"retire-close-debt-failure"];throwClose=[mode hasSuffix:@"close-debt-failure"];failDebt=throwClose;
 firstAdopt=[NSError errorWithDomain:@"PUBLIC_ADOPT" code:41 userInfo:nil];firstRetire=[NSError errorWithDomain:@"PUBLIC_RETIRE" code:42 userInfo:nil];
 firstClose=[NSError errorWithDomain:@"PUBLIC_CLOSE" code:43 userInfo:nil];firstDebt=[NSError errorWithDomain:@"PUBLIC_DEBT" code:44 userInfo:nil];
 int pair[2];if(socketpair(AF_UNIX,SOCK_STREAM,0,pair))return 10;
 PublicParent *parent=[PublicParent new];parent.fd=pair[0];
 NSURL *resources=[NSURL fileURLWithPath:@"/PUBLIC/Resources"];
 YNXWalletAdmissionBackendTask *task=[[YNXWalletAdmissionBackendTask alloc]initWithParent:parent resources:resources];
 task.arguments=@[[resources URLByAppendingPathComponent:@"server.mjs"].path];task.environment=@{};
 NSPipe *io=[NSPipe pipe];task.standardInput=io;task.standardOutput=io.fileHandleForWriting;task.standardError=io.fileHandleForWriting;
 NSError *error=nil;BOOL launched=[task launchAndReturnError:&error];
 if(failSpawn){if(launched||adoptions||parent.positive||waitSchedules||parent.closes!=1||retirements!=1)return 11;}
 else {
  if(!launched||!task.running||adoptions!=1||adoptedPID!=31415||waitSchedules!=1||parent.zero<2){fprintf(stderr,"launched=%d running=%d adopts=%lu pid=%d waits=%lu zero=%lu error=%s\n",launched,task.running,(unsigned long)adoptions,adoptedPID,(unsigned long)waitSchedules,(unsigned long)parent.zero,error.description.UTF8String);return 12;}
  if(failAdopt||throwAdopt){if(parent.positive||retirements!=1||parent.closes!=1||task.admissionFirstFailure!=firstAdopt)return 13;}
  else if(parent.positive!=1)return 14;
  if([task launchAndReturnError:nil]||adoptions!=1)return 15;
 }
 [task retireAdmission];[task retireAdmission];
 if(retirements!=1||parent.closes!=1)return 16;
 if(throwRetire){if([task finishAdmissionCleanup]||task.admissionCleanupFailure!=firstRetire)return 17;}
 else if(throwClose){if([task finishAdmissionCleanup]||task.admissionCleanupFailure!=firstClose)return 19;}
 else if(![task finishAdmissionCleanup])return 18;
 close(pair[0]);close(pair[1]);
 puts("PUBLIC_CALLER_ORDER_PASS");return 0;
}}
