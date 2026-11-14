#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#include "IdentityBridge.h"
#include <spawn.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/proc_info.h>
#include <libproc.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <pwd.h>

static volatile sig_atomic_t stopped = 0;
static void stop_signal(int value) { (void)value; stopped = 1; }
static void emit(NSDictionary *value) { NSData *data=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil]; if(data){fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);fflush(stdout);} }
static NSString *text(const char *value) { return [NSString stringWithUTF8String:value] ?: @""; }
static BOOL private_regular(NSString *path, off_t maximum) { struct stat s; return !lstat(path.fileSystemRepresentation,&s) && S_ISREG(s.st_mode) && s.st_uid==getuid() && !(s.st_mode&0022) && s.st_size>0 && s.st_size<=maximum; }
static BOOL token(const NSString *value,uint8_t out[32]) { if(value.length!=64)return NO; for(NSUInteger i=0;i<32;i++){unsigned part;NSScanner *scanner=[NSScanner scannerWithString:[value substringWithRange:NSMakeRange(i*2,2)]];if(![scanner scanHexInt:&part]||!scanner.isAtEnd)return NO;out[i]=part;}return YES; }
static int wait_child(pid_t pid,int *status,BOOL *reaped) { if(*reaped)return 1;pid_t result;do{result=waitpid(pid,status,WNOHANG);}while(result<0&&errno==EINTR);if(result==pid){*reaped=YES;return 1;}return result<0?-1:0; }
static NSString *digest(const void *bytes, size_t length) { unsigned char hash[CC_SHA256_DIGEST_LENGTH];CC_SHA256(bytes,(CC_LONG)length,hash);NSMutableString *value=[NSMutableString string];for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++)[value appendFormat:@"%02x",hash[i]];return value; }
static BOOL contains_marker(int fd,NSString *wanted) {
    struct stat s;if(fd<0||fstat(fd,&s)||!S_ISREG(s.st_mode)||s.st_size<1||s.st_size>131072)return NO;
    NSMutableData *data=[NSMutableData dataWithLength:(NSUInteger)s.st_size];size_t used=0;
    while(used<data.length){ssize_t n=pread(fd,(char *)data.mutableBytes+used,data.length-used,(off_t)used);if(n<0&&errno==EINTR)continue;if(n<=0)return NO;used+=(size_t)n;}
    const unsigned char *bytes=data.bytes;size_t begin=0;
    for(size_t i=0;i<data.length;i++)if(bytes[i]=='\n'){size_t end=i;if(end>begin&&bytes[end-1]=='\r')end--;if([digest(bytes+begin,end-begin)isEqual:wanted])return YES;begin=i+1;}
    return NO;
}
static BOOL write_all(int fd,const unsigned char *bytes,size_t length) { size_t offset=0;while(offset<length){ssize_t n=write(fd,bytes+offset,length-offset);if(n<0&&errno==EINTR)continue;if(n<=0)return NO;offset+=(size_t)n;}return YES; }
static BOOL valid_capture_limit(id value,uint64_t *limit) {
    if(!value){*limit=131072;return YES;}
    if(![value isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID())return NO;
    double number=[value doubleValue];
    if(!(number>=1&&number<=16777216)||number!=(double)[value unsignedLongLongValue])return NO;
    *limit=[value unsignedLongLongValue];return YES;
}
static BOOL c_string(NSString *value) {
    if(![value isKindOfClass:NSString.class])return NO;
    NSData *encoded=[value dataUsingEncoding:NSUTF8StringEncoding];
    return encoded&&!memchr(encoded.bytes,0,encoded.length);
}
static BOOL own_home(NSString *value) {
    struct passwd *account=getpwuid(getuid());if(!account||!account->pw_dir)return NO;
    NSString *home=text(account->pw_dir).stringByResolvingSymlinksInPath;
    struct stat s;
    return c_string(value)&&[value hasPrefix:@"/"]&&[value isEqual:home]&&
        [value isEqual:value.stringByResolvingSymlinksInPath]&&[value isEqual:value.stringByStandardizingPath]&&
        !lstat(value.fileSystemRepresentation,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==getuid()&&!(s.st_mode&0022);
}
static BOOL capture_bytes(int log,const unsigned char *bytes,size_t count,BOOL discarding,uint64_t limit,uint64_t *captured,uint64_t *discarded) {
    if(discarding){*discarded=UINT64_MAX-*discarded<(uint64_t)count?UINT64_MAX:*discarded+(uint64_t)count;return YES;}
    if(*captured>limit||(uint64_t)count>limit-*captured){emit(@{@"kind":@"refused",@"operation":@"bounded-backend-output"});return NO;}
    if(!write_all(log,bytes,count)||fsync(log)){emit(@{@"kind":@"refused",@"operation":@"bounded-output-write"});return NO;}
    *captured+=(uint64_t)count;return YES;
}
static void reap_child(pid_t pid,int *status,BOOL *reaped) { pid_t result;do{result=waitpid(pid,status,0);}while(result<0&&errno==EINTR);*reaped=result==pid; }
static void stop_child(pid_t pid,int *status,BOOL *reaped,int input,BOOL started) {
    if(input>=0)close(input); if(*reaped)return;
    if(wait_child(pid,status,reaped)!=0)return; // Lost ownership is UNKNOWN, never signal a reused PID.
    if(!started){kill(pid,SIGKILL);reap_child(pid,status,reaped);return;}
    kill(pid,SIGINT);kill(pid,SIGCONT); // Owned direct child only; permit graceful PT EOF/Arti stop.
    double end=NSProcessInfo.processInfo.systemUptime+3.0;
    while(!wait_child(pid,status,reaped)&&NSProcessInfo.processInfo.systemUptime<end)usleep(10000);
    if(!*reaped){kill(pid,SIGKILL);reap_child(pid,status,reaped);}
}
int main(int argc,const char **argv) {
 @autoreleasepool {
    if(argc!=2)return 64;
    signal(SIGINT,stop_signal);signal(SIGTERM,stop_signal);signal(SIGPIPE,SIG_IGN);
    NSString *configPath=text(argv[1]); if(!private_regular(configPath,65536))return 78;
    NSData *raw=[NSData dataWithContentsOfFile:configPath options:0 error:nil];NSDictionary *c=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
    if(![c isKindOfClass:NSDictionary.class]||![c[@"schema"] isEqual:@"P05_BACKEND_START_GATE_V1"])return 78;
    NSString *target=c[@"target"],*sha=c[@"sha256"],*requirement=c[@"requirement"],*spool=c[@"spool"],*run=c[@"runID"],*epoch=c[@"epoch"],*stream=c[@"output"];
    NSArray *arguments=c[@"arguments"];NSDictionary *environment=c[@"environment"];
    NSString *outputPolicy=c[@"outputPolicy"]?:@"boundedCapture";
    if(![outputPolicy isEqual:@"boundedCapture"]&&![outputPolicy isEqual:@"discardAfterBootstrap"])return 78;
    uint64_t captureLimit=0;
    if(!valid_capture_limit(c[@"outputCaptureLimit"],&captureLimit)||([outputPolicy isEqual:@"discardAfterBootstrap"]&&captureLimit!=131072))return 78;
    if(![target isKindOfClass:NSString.class]||![target hasPrefix:@"/"]||![target.stringByResolvingSymlinksInPath isEqual:target]||![sha isKindOfClass:NSString.class]||sha.length!=64||![requirement isKindOfClass:NSString.class]||requirement.length<1||requirement.length>4096||![arguments isKindOfClass:NSArray.class]||arguments.count>64||![environment isKindOfClass:NSDictionary.class]||![spool isKindOfClass:NSString.class]||![spool.stringByDeletingLastPathComponent isEqual:configPath.stringByDeletingLastPathComponent]||![[NSUUID alloc]initWithUUIDString:epoch]||![run isKindOfClass:NSString.class])return 78;
    struct stat parent;if(lstat(spool.stringByDeletingLastPathComponent.fileSystemRepresentation,&parent)||!S_ISDIR(parent.st_mode)||parent.st_uid!=getuid()||(parent.st_mode&0022))return 78;
    // It is a one-shot private launch manifest, not a product log/history file.
    // No subsequent path reopen is used; deleting it here also covers abrupt UI exit.
    if(unlink(configPath.fileSystemRepresentation))return 78;
    int log=open(spool.fileSystemRepresentation,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(log<0)return 78;
    int out[2],in[2];if(pipe(out)||pipe(in)){close(log);return 78;}
    char **args=calloc(arguments.count+2,sizeof(char *));args[0]=strdup(target.fileSystemRepresentation);
    for(NSUInteger i=0;i<arguments.count;i++){if(!c_string(arguments[i]))return 78;args[i+1]=strdup([arguments[i]UTF8String]);}
    char **env=calloc(environment.count+1,sizeof(char *));NSUInteger e=0;
    for(NSString *key in environment){
        if(!c_string(key)||!c_string(environment[key])||[key containsString:@"="]||
           !([key isEqual:@"PATH"]||[key isEqual:@"RUST_LOG"]||[key hasPrefix:@"TOR_PT_"]||[key hasPrefix:@"YNX_"]||([key isEqual:@"HOME"]&&own_home(environment[key]))))return 78;
        env[e++]=strdup([[NSString stringWithFormat:@"%@=%@",key,environment[key]]UTF8String]);
    }
    posix_spawnattr_t attr;posix_spawn_file_actions_t actions;posix_spawnattr_init(&attr);posix_spawn_file_actions_init(&actions);
    posix_spawnattr_setflags(&attr,POSIX_SPAWN_START_SUSPENDED|POSIX_SPAWN_CLOEXEC_DEFAULT);
    posix_spawn_file_actions_adddup2(&actions,in[0],STDIN_FILENO);
    if([stream isEqual:@"standardOutput"]||[stream isEqual:@"merged"])posix_spawn_file_actions_adddup2(&actions,out[1],STDOUT_FILENO);else posix_spawn_file_actions_addopen(&actions,STDOUT_FILENO,"/dev/null",O_WRONLY,0);
    if([stream isEqual:@"standardError"]||[stream isEqual:@"merged"])posix_spawn_file_actions_adddup2(&actions,out[1],STDERR_FILENO);else posix_spawn_file_actions_addopen(&actions,STDERR_FILENO,"/dev/null",O_WRONLY,0);
    if(stopped)return 78;
    pid_t child=0;int launch=posix_spawn(&child,target.fileSystemRepresentation,&actions,&attr,args,env);
    posix_spawnattr_destroy(&attr);posix_spawn_file_actions_destroy(&actions);close(in[0]);close(out[1]);
    if(launch){emit(@{@"kind":@"refused",@"operation":@"posix_spawn",@"status":@(launch)});return 78;}
    uint8_t audit[32];int32_t nameStatus=0,infoStatus=0;int readStatus=YNXCopyAuditViaTaskName(child,audit,sizeof(audit),&nameStatus,&infoStatus);
    YNXProcessIdentity identity={0};int verify=readStatus?readStatus:YNXInspectAuditIdentity(audit,sizeof(audit),requirement.UTF8String,&identity);
    BOOL reaped=NO;int status=0;BOOL valid=!verify && identity.pid==child && !strcmp(identity.path,target.fileSystemRepresentation) && !strcmp(identity.sha256,sha.UTF8String);
    if(!valid){emit(@{@"kind":@"refused",@"operation":@"post-exec-pin",@"status":@(verify),@"taskNameStatus":@(nameStatus),@"taskInfoStatus":@(infoStatus)});stop_child(child,&status,&reaped,in[1],NO);return 78;}
    NSMutableString *hex=[NSMutableString string];for(int i=0;i<32;i++)[hex appendFormat:@"%02x",audit[i]];
    NSDictionary *pin=@{@"auditTokenHex":hex,@"pid":@(child),@"pidVersion":@(identity.pidVersion),@"path":target,@"sha256":sha,@"requirement":requirement};
    emit(@{@"kind":@"prepared",@"pid":@(child),@"runID":run,@"epoch":epoch,@"processPin":pin,@"state":@"post-exec-suspended",@"outputCaptureLimit":@(captureLimit)});
    NSString *tokenDigest=digest(audit,sizeof(audit));
    fcntl(out[0],F_SETFL,O_NONBLOCK);NSMutableData *pending=[NSMutableData data];BOOL resumed=NO,discarding=NO;uint64_t captured=0,discarded=0;double deadline=NSProcessInfo.processInfo.systemUptime+30.0;
    pid_t owner=getppid();
    while(!stopped&&!wait_child(child,&status,&reaped)) {
        if(getppid()!=owner||(!resumed&&NSProcessInfo.processInfo.systemUptime>deadline)){stopped=1;break;}
        struct pollfd fds[2]={{STDIN_FILENO,POLLIN|POLLHUP,0},{out[0],POLLIN|POLLHUP,0}};poll(fds,2,100);
        // Lifecycle commands take priority over more log bytes at the bootstrap boundary.
        if(fds[0].revents&(POLLIN|POLLHUP)){
            unsigned char bytes[256];ssize_t n=read(STDIN_FILENO,bytes,sizeof(bytes));if(n<=0){stopped=1;break;}[pending appendBytes:bytes length:n];if(pending.length>256){stopped=1;break;}
            for(;;){const unsigned char *start=pending.bytes;const void *found=memchr(start,'\n',pending.length);if(!found)break;NSUInteger count=(const unsigned char *)found-start;NSString *command=[[NSString alloc]initWithBytes:start length:count encoding:NSUTF8StringEncoding];[pending replaceBytesInRange:NSMakeRange(0,count+1)withBytes:NULL length:0];
                if([command isEqual:@"RESUME"]&&!resumed){YNXProcessIdentity current={0};int error=YNXInspectAuditCodeIdentity(audit,sizeof(audit),requirement.UTF8String,&current);if(error||strcmp(current.path,identity.path)||strcmp(current.codeDirectoryHash,identity.codeDirectoryHash)){stopped=1;emit(@{@"kind":@"refused",@"operation":@"resume-incarnation",@"status":@(error)});break;}if(kill(child,SIGCONT)){stopped=1;break;}resumed=YES;if(![c[@"keepStandardInputOpen"]boolValue]){close(in[1]);in[1]=-1;}emit(@{@"kind":@"resumed",@"pid":@(child)});}
                else if([command hasPrefix:@"DROP_OUTPUT "]){
                    NSArray *parts=[command componentsSeparatedByString:@" "];uint8_t ignored[32];
                    BOOL okay=parts.count==4&&resumed&&!discarding&&[outputPolicy isEqual:@"discardAfterBootstrap"]&&[parts[1]isEqual:tokenDigest]&&[[NSUUID alloc]initWithUUIDString:parts[2]]&&token(parts[3],ignored)&&contains_marker(log,parts[3]);
                    if(!okay||ftruncate(log,0)){stopped=1;emit(@{@"kind":@"refused",@"operation":@"output-discard-boundary"});break;}
                    close(log);log=-1;discarding=YES;
                    emit(@{@"kind":@"output-discarding",@"pid":@(child),@"runID":run,@"epoch":epoch,@"backendTokenSHA256":tokenDigest,@"requestNonce":parts[2],@"markerSHA256":parts[3],@"state":@"discarding",@"capturedBytes":@(captured),@"discardedBytes":@(discarded)});
                }
                else if([command isEqual:@"STATUS"]){emit(@{@"kind":@"status",@"pid":@(child),@"state":resumed?@"running":@"suspended",@"outputState":discarding?@"discarding":@"capturing",@"capturedBytes":@(captured),@"discardedBytes":@(discarded)});}
                else if([command isEqual:@"STOP"]){stopped=1;break;}
                else{stopped=1;emit(@{@"kind":@"refused",@"operation":@"invalid-lifecycle-command"});break;}
            }
        }
        if(!stopped&&out[0]>=0&&(fds[1].revents&(POLLIN|POLLHUP))){
            unsigned char bytes[4096];ssize_t n=read(out[0],bytes,sizeof(bytes));
            if(n>0){
                if(!capture_bytes(log,bytes,(size_t)n,discarding,captureLimit,&captured,&discarded)){stopped=1;break;}
            } else if(n==0){close(out[0]);out[0]=-1;} // Output EOF is not process death.
            else if(errno!=EAGAIN&&errno!=EINTR){stopped=1;emit(@{@"kind":@"refused",@"operation":@"backend-output-read"});}
        }
    }
    stop_child(child,&status,&reaped,in[1],resumed);
    // waitpid may win before the last bytes in the pipe have been consumed.
    // Drain only this owned pipe, bounded by the SAME cap and a finite EOF deadline.
    BOOL outputEOF=out[0]<0;
    double drainDeadline=NSProcessInfo.processInfo.systemUptime+2.0;
    while(!stopped&&reaped&&out[0]>=0&&NSProcessInfo.processInfo.systemUptime<drainDeadline){
        unsigned char bytes[4096];ssize_t n=read(out[0],bytes,sizeof(bytes));
        if(n>0){if(!capture_bytes(log,bytes,(size_t)n,discarding,captureLimit,&captured,&discarded)){stopped=1;break;}}
        else if(n==0){outputEOF=YES;close(out[0]);out[0]=-1;break;}
        else if(errno==EAGAIN||errno==EWOULDBLOCK){struct pollfd fd={out[0],POLLIN|POLLHUP,0};poll(&fd,1,20);}
        else if(errno!=EINTR){stopped=1;emit(@{@"kind":@"refused",@"operation":@"backend-output-read"});break;}
    }
    if(!stopped&&reaped&&!outputEOF){stopped=1;emit(@{@"kind":@"refused",@"operation":@"output-eof-unconfirmed"});}
    if(out[0]>=0)close(out[0]);if(log>=0)close(log);
    BOOL captureComplete=!stopped&&reaped&&outputEOF&&[outputPolicy isEqual:@"boundedCapture"];
    NSMutableDictionary *exit=[@{@"kind":@"exit",@"pid":@(child),@"childReaped":@(reaped),@"outputCaptureLimit":@(captureLimit),@"capturedBytes":@(captured),@"outputCaptureComplete":@(captureComplete)}mutableCopy];if(WIFEXITED(status))exit[@"code"]=@(WEXITSTATUS(status));else if(WIFSIGNALED(status))exit[@"signal"]=@(WTERMSIG(status));emit(exit);
    return reaped?0:78;
 }
}
