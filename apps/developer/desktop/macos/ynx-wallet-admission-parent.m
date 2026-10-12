#import "ynx-wallet-admission-parent.h"
#import <Security/Security.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <fcntl.h>
#import <unistd.h>
#import <errno.h>

static NSError *YNXParentError(NSString *reason, int osError) {
    return [NSError errorWithDomain:@"YNXOriginalIDEAdmissionParent" code:osError ?: 1
        userInfo:@{NSLocalizedDescriptionKey:reason}];
}
static BOOL YNXSameFile(struct stat a, struct stat b) {
    return a.st_dev==b.st_dev && a.st_ino==b.st_ino && a.st_mode==b.st_mode
        && a.st_uid==b.st_uid && a.st_gid==b.st_gid && a.st_size==b.st_size
        && a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec
        && a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
}
static BOOL YNXProcess(pid_t pid, struct proc_bsdinfo *info, NSString **path) {
    char executable[PROC_PIDPATHINFO_MAXSIZE]={0};
    if(pid<=1 || proc_pidinfo(pid,PROC_PIDTBSDINFO,0,info,sizeof(*info))!=sizeof(*info)
       || info->pbi_pid!=(uint32_t)pid || proc_pidpath(pid,executable,sizeof(executable))<=0)return NO;
    if(path)*path=[[NSFileManager defaultManager] stringWithFileSystemRepresentation:executable length:strlen(executable)];
    return YES;
}
static BOOL YNXSameProcess(struct proc_bsdinfo a, struct proc_bsdinfo b) {
    return a.pbi_pid==b.pbi_pid && a.pbi_ppid==b.pbi_ppid && a.pbi_uid==b.pbi_uid
        && a.pbi_gid==b.pbi_gid && a.pbi_start_tvsec==b.pbi_start_tvsec
        && a.pbi_start_tvusec==b.pbi_start_tvusec;
}
static BOOL YNXEndpointPeer(int fd, pid_t expected) {
    int type=0; socklen_t n=sizeof(type); struct sockaddr_storage address;
    socklen_t addressSize=sizeof(address); pid_t peer=0; socklen_t peerSize=sizeof(peer);
    return fd>=0 && fcntl(fd,F_GETFD)>=0
        && getsockopt(fd,SOL_SOCKET,SO_TYPE,&type,&n)==0 && type==SOCK_STREAM
        && getpeername(fd,(struct sockaddr *)&address,&addressSize)==0 && address.ss_family==AF_UNIX
        && getsockopt(fd,SOL_LOCAL,LOCAL_PEERPID,&peer,&peerSize)==0
        && peerSize==sizeof(peer) && peer==expected;
}
// Observe the OS's code object, not a caller-supplied hash or trusted key.
// Even a valid signature here is NOT a registered Wallet/executor grant.
static NSDictionary *YNXCodeObservation(pid_t pid) {
    SecCodeRef code=NULL; SecStaticCodeRef staticCode=NULL; CFDictionaryRef information=NULL;
    OSStatus status=SecCodeCopyGuestWithAttributes(NULL,(__bridge CFDictionaryRef)@{(__bridge NSString *)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&code);
    if(status==errSecSuccess)status=SecCodeCheckValidity(code,kSecCSStrictValidate,NULL);
    if(status==errSecSuccess)status=SecCodeCopyStaticCode(code,kSecCSDefaultFlags,&staticCode);
    if(status==errSecSuccess)status=SecCodeCopySigningInformation(staticCode,kSecCSSigningInformation,&information);
    NSDictionary *result=information ? [(__bridge NSDictionary *)information copy] : nil;
    if(information)CFRelease(information); if(staticCode)CFRelease(staticCode); if(code)CFRelease(code);
    return status==errSecSuccess ? result : nil;
}

// Private custody of observations made during the synchronous acquire. These
// are never serialized, sent to Wallet, or exposed as a business guard. Each
// descriptor is owned here; fd4 itself remains the original caller's endpoint.
@interface YNXIDEParentObservation : NSObject
- (BOOL)captureResources:(NSURL *)resources parent:(pid_t)parent error:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (BOOL)finishCleanup:(NSError **)error;
@end
@implementation YNXIDEParentObservation {
    int _root,_runtime,_node,_entry,_endpoint;
    NSString *_resourcesPath,*_parentPath,*_selfPath;
    struct stat _rootStat,_runtimeStat,_nodeStat,_entryStat,_endpointStat;
    struct proc_bsdinfo _parentInfo,_selfInfo;
    NSDictionary *_parentCode,*_selfCode;
    BOOL _retired,_closeSelected,_cleanupComplete;
    NSError *_cleanupFailure;
}
- (instancetype)init {
    if((self=[super init]))_root=_runtime=_node=_entry=_endpoint=-1;
    return self;
}
- (BOOL)fail:(NSError **)error reason:(NSString *)reason {
    if(error)*error=YNXParentError(reason,errno); return NO;
}
- (BOOL)captureResources:(NSURL *)resources parent:(pid_t)parent error:(NSError **)error {
    if(!resources.isFileURL || !resources.path.length || parent!=getppid())
        return [self fail:error reason:@"IDE_PARENT_INVALID_NORMAL_CALLER"];
    NSString *parentPath=nil,*selfPath=nil;
    if(!YNXProcess(parent,&_parentInfo,&parentPath) || !YNXProcess(getpid(),&_selfInfo,&selfPath)
       || _selfInfo.pbi_ppid!=(uint32_t)parent)
        return [self fail:error reason:@"IDE_PARENT_PROCESS_PROVENANCE_UNAVAILABLE"];
    _parentPath=parentPath; _selfPath=selfPath;
    char canonical[PATH_MAX];
    if(!realpath(resources.path.fileSystemRepresentation,canonical))
        return [self fail:error reason:@"IDE_PARENT_RESOURCES_UNAVAILABLE"];
    _resourcesPath=[[NSFileManager defaultManager] stringWithFileSystemRepresentation:canonical length:strlen(canonical)];
    char bundled[PATH_MAX]; NSURL *actualResources=NSBundle.mainBundle.resourceURL;
    if(!actualResources.isFileURL || !realpath(actualResources.path.fileSystemRepresentation,bundled)
       || strcmp(canonical,bundled)!=0)
        return [self fail:error reason:@"IDE_PARENT_RESOURCES_NOT_ACTUAL_BUNDLE"];
    _root=open(canonical,O_RDONLY|O_DIRECTORY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC);
    if(_root<0 || fstat(_root,&_rootStat)<0 || !S_ISDIR(_rootStat.st_mode))return [self fail:error reason:@"IDE_PARENT_RESOURCES_UNAVAILABLE"];
    _runtime=openat(_root,"runtime",O_RDONLY|O_DIRECTORY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC);
    if(_runtime<0 || fstat(_runtime,&_runtimeStat)<0 || !S_ISDIR(_runtimeStat.st_mode))return [self fail:error reason:@"IDE_PARENT_RUNTIME_UNAVAILABLE"];
    _node=openat(_runtime,"node",O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC);
    if(_node<0 || fstat(_node,&_nodeStat)<0 || !S_ISREG(_nodeStat.st_mode) || !(_nodeStat.st_mode&0111))
        return [self fail:error reason:@"IDE_PARENT_EXECUTABLE_ENTRY_UNAVAILABLE"];
    _entry=openat(_root,"server.mjs",O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC);
    if(_entry<0 || fstat(_entry,&_entryStat)<0 || !S_ISREG(_entryStat.st_mode))
        return [self fail:error reason:@"IDE_PARENT_EXECUTABLE_ENTRY_UNAVAILABLE"];
    if(!YNXEndpointPeer(4,parent))return [self fail:error reason:@"IDE_PARENT_ORIGINAL_ENDPOINT_UNAVAILABLE"];
    _endpoint=fcntl(4,F_DUPFD_CLOEXEC,10);
    if(_endpoint<0 || fstat(_endpoint,&_endpointStat)<0)
        return [self fail:error reason:@"IDE_PARENT_ORIGINAL_ENDPOINT_UNAVAILABLE"];
    _parentCode=YNXCodeObservation(parent); _selfCode=YNXCodeObservation(getpid());
    if(!_parentCode || !_selfCode)return [self fail:error reason:@"IDE_PARENT_OS_CODE_PROVENANCE_UNAVAILABLE"];
    return [self assertCurrent:error];
}
- (BOOL)assertCurrent:(NSError **)error {
    if(_retired)return [self fail:error reason:@"IDE_PARENT_OBSERVATION_RETIRED"];
    struct proc_bsdinfo parent,selfInfo; NSString *parentPath=nil,*selfPath=nil;
    if(getppid()!=(pid_t)_parentInfo.pbi_pid || !YNXProcess((pid_t)_parentInfo.pbi_pid,&parent,&parentPath)
       || !YNXProcess(getpid(),&selfInfo,&selfPath) || !YNXSameProcess(parent,_parentInfo)
       || !YNXSameProcess(selfInfo,_selfInfo) || ![parentPath isEqual:_parentPath] || ![selfPath isEqual:_selfPath]
       || !YNXEndpointPeer(_endpoint,(pid_t)_parentInfo.pbi_pid))
        return [self fail:error reason:@"IDE_PARENT_PROVENANCE_CHANGED"];
    struct stat root,runtime,node,entry,endpoint,originalEndpoint,namedRoot,namedRuntime,namedNode,namedEntry;
    if(fstat(_root,&root)<0 || fstat(_runtime,&runtime)<0 || fstat(_node,&node)<0 || fstat(_entry,&entry)<0
       || fstat(_endpoint,&endpoint)<0 || fstat(4,&originalEndpoint)<0
       || !YNXEndpointPeer(4,(pid_t)_parentInfo.pbi_pid)
       || lstat(_resourcesPath.fileSystemRepresentation,&namedRoot)<0
       || fstatat(_root,"runtime",&namedRuntime,AT_SYMLINK_NOFOLLOW)<0
       || fstatat(_runtime,"node",&namedNode,AT_SYMLINK_NOFOLLOW)<0
       || fstatat(_root,"server.mjs",&namedEntry,AT_SYMLINK_NOFOLLOW)<0
       || !YNXSameFile(root,_rootStat) || !YNXSameFile(runtime,_runtimeStat)
       || !YNXSameFile(node,_nodeStat) || !YNXSameFile(entry,_entryStat)
       || !YNXSameFile(endpoint,_endpointStat) || !YNXSameFile(originalEndpoint,_endpointStat)
       || !YNXSameFile(namedRoot,_rootStat)
       || !YNXSameFile(namedRuntime,_runtimeStat) || !YNXSameFile(namedNode,_nodeStat)
       || !YNXSameFile(namedEntry,_entryStat)
       || ![YNXCodeObservation((pid_t)_parentInfo.pbi_pid) isEqual:_parentCode]
       || ![YNXCodeObservation(getpid()) isEqual:_selfCode])
        return [self fail:error reason:@"IDE_PARENT_CAPTURED_CODE_CHANGED"];
    return YES;
}
- (BOOL)finishCleanup:(NSError **)error {
    @synchronized(self){
        _retired=YES;
        if(!_closeSelected){
            _closeSelected=YES;
            int *owned[]={&_endpoint,&_entry,&_node,&_runtime,&_root};
            for(unsigned i=0;i<sizeof(owned)/sizeof(owned[0]);i++){
                int fd=*owned[i]; if(fd<0)continue;
                // Never retry an uncertain close and risk a recycled fd. Retain
                // the exact observation/debt instead of reporting success.
                if(close(fd)<0){if(!_cleanupFailure)_cleanupFailure=YNXParentError(@"IDE_PARENT_OBSERVATION_CLEANUP_INCOMPLETE",errno);}
                else *owned[i]=-1;
            }
            _cleanupComplete=_cleanupFailure==nil;
        }
        if(!_cleanupComplete && error)*error=_cleanupFailure;
        return _cleanupComplete;
    }
}
@end

@interface YNXIDEAdmissionAcquireOutcome ()
- (instancetype)initWithCause:(id)cause debt:(YNXIDEParentObservation *)debt cleanupError:(NSError *)cleanupError;
- (BOOL)finishCleanup:(NSError **)error;
@end
@implementation YNXIDEAdmissionAcquireOutcome {
    id _firstCause;
    NSError *_cleanupError;
    YNXIDEParentObservation *_cleanupDebt;
}
- (instancetype)initWithCause:(id)cause debt:(YNXIDEParentObservation *)debt cleanupError:(NSError *)cleanupError {
    if((self=[super init])){_firstCause=cause;_cleanupDebt=debt;_cleanupError=cleanupError;}return self;
}
- (YNXIDEAdmissionAcquireKind)kind {return _cleanupDebt ? YNXIDEAdmissionCleanupIncomplete : YNXIDEAdmissionCleanRefusal;}
- (id<YNXWalletAdmissionParentGuard>)guard {return nil;}
- (id)firstCause {return _firstCause;}
- (NSError *)cleanupError {return _cleanupError;}
- (BOOL)finishCleanup:(NSError **)error {
    // The getter already selected close. This reads that exact object's status;
    // its once gate prevents retries or new resource/authority acquisition.
    return !_cleanupDebt || [_cleanupDebt finishCleanup:error];
}
@end
BOOL YNXFinishIDEAdmissionAcquireCleanup(YNXIDEAdmissionAcquireOutcome *outcome,NSError **error) {
    return !outcome || [outcome finishCleanup:error];
}

YNXIDEAdmissionAcquireOutcome *YNXOriginalAcquireIDEAdmissionParent(NSURL *resources,pid_t parent,NSError **error) {
    YNXIDEParentObservation *observation=[YNXIDEParentObservation new]; NSError *failure=nil;
    id firstCause=nil;
    BOOL observed=NO;
    @try { observed=[observation captureResources:resources parent:parent error:&failure]; }
    @catch(id exception){ firstCause=exception;failure=YNXParentError(@"IDE_PARENT_OS_OBSERVATION_FAILED",1); }
    if(observed){
        // Existing Auth's frozen normal contract supplies no native qualification
        // carrier. OS observations above establish provenance only. No existing
        // receipt schema authorizes an OS parent/executor/IDE-child relationship.
        // Do not construct a guard, renew a deadline, or turn fd4 into a grant.
        failure=YNXParentError(@"IDE_ORIGINAL_REGISTERED_PARENT_EXECUTOR_QUALIFICATION_NOT_SUPPLIED",1);
    }
    if(!firstCause)firstCause=failure;
    NSError *cleanupFailure=nil;
    if(![observation finishCleanup:&cleanupFailure]){
        if(error)*error=[NSError errorWithDomain:@"YNXOriginalIDEAdmissionParent" code:2
            userInfo:@{NSLocalizedDescriptionKey:cleanupFailure.localizedDescription,
                NSUnderlyingErrorKey:failure ?: YNXParentError(@"IDE_PARENT_ACQUIRE_FAILED",1)}];
        return [[YNXIDEAdmissionAcquireOutcome alloc]initWithCause:firstCause debt:observation cleanupError:cleanupFailure];
    }
    if(error)*error=failure;
    return [[YNXIDEAdmissionAcquireOutcome alloc]initWithCause:firstCause debt:nil cleanupError:nil];
}
