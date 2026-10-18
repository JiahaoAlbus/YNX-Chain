#import <Foundation/Foundation.h>
#import <spawn.h>
#import <sys/socket.h>
#import <sys/wait.h>
#import <fcntl.h>
#import <unistd.h>
#import <errno.h>
#import "ynx-wallet-admission-parent.h"
#import "original-ide-parent-supplier.h"
#import "original-ide-identity-launch-holder.h"

// This is a fixed ORIGINAL protected supplier link, never a renderer factory,
// ENV-selected module, command-line flag or selected public key. The original
// Auth/native owner must implement authenticated parent/executor custody.
// Merely finding a duplex descriptor, PID or matching file is not approval.

static NSError *YNXAdmissionLaunchError(void) {
    return [NSError errorWithDomain:@"YNXWalletAdmissionLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Original Wallet parent admission is not supplied or is no longer current."}];
}
static BOOL YNXAdmissionDuplexDescriptor(int fd) {
    int type=0;socklen_t length=sizeof(type);struct sockaddr_storage peer;socklen_t peerLength=sizeof(peer);
    return fd==4&&fcntl(fd,F_GETFD)>=0&&getsockopt(fd,SOL_SOCKET,SO_TYPE,&type,&length)==0&&type==SOCK_STREAM
        &&getpeername(fd,(struct sockaddr *)&peer,&peerLength)==0&&peer.ss_family==AF_UNIX;
}
static YNXIDEAdmissionAcquireOutcome *YNXAcquireWalletAdmissionOutcome(NSURL *resources) {
    NSError *error=nil;
    // Keep the explicit result, including its private cleanup-only owner. A
    // clean unavailable connection is distinct from an uncertain close.
    return YNXOriginalAcquireIDEAdmissionParent(resources,getppid(),&error);
}

// Exact owned backend launch. Standalone uses the existing NSTask behavior.
// A connected launch explicitly duplicates the ORIGINAL inherited endpoint
// to its own Node child; it never creates a replacement Wallet socketpair.
@interface YNXWalletAdmissionBackendTask : NSObject
@property(nonatomic,strong) NSURL *executableURL;
@property(nonatomic,copy) NSArray<NSString *> *arguments;
@property(nonatomic,copy) NSDictionary<NSString *,NSString *> *environment;
@property(nonatomic,strong) id standardInput;
@property(nonatomic,strong) NSFileHandle *standardOutput;
@property(nonatomic,strong) NSFileHandle *standardError;
@property(nonatomic,copy) void (^terminationHandler)(YNXWalletAdmissionBackendTask *task);
@property(nonatomic,readonly,getter=isRunning) BOOL running;
@property(nonatomic,readonly) int terminationStatus;
@property(nonatomic,readonly) NSTaskTerminationReason terminationReason;
- (instancetype)initWithParent:(id<YNXWalletAdmissionParentGuard>)parent resources:(NSURL *)resources;
- (instancetype)initWithAcquireOutcome:(YNXIDEAdmissionAcquireOutcome *)outcome resources:(NSURL *)resources;
- (instancetype)initWithAcquireOutcome:(YNXIDEAdmissionAcquireOutcome *)outcome resources:(NSURL *)resources identityHolder:(YNXOriginalIdentityPeerLaunchHolder *)holder captureError:(NSError *)captureError;
- (BOOL)finishIdentityCleanupForQuit:(NSError **)error;
- (BOOL)launchAndReturnError:(NSError **)error;
- (void)terminate;
- (void)waitUntilExit;
- (void)retireAdmission;
- (BOOL)finishAdmissionCleanup;
@property(nonatomic,readonly) id admissionFirstFailure;
@property(nonatomic,readonly) id admissionCleanupFailure;
@end
@implementation YNXWalletAdmissionBackendTask {
    id<YNXWalletAdmissionParentGuard> _parent;
    YNXIDEAdmissionAcquireOutcome *_acquireOutcome;
    NSURL *_resources;
    NSTask *_ordinary;
    NSCondition *_condition;
    pid_t _pid;
    int _channelDescriptor;
    BOOL _running,_started,_retired,_cleanupSelected,_cleanupComplete;
    id _admissionFirstFailure,_admissionCleanupFailure;
    int _status;
    NSTaskTerminationReason _reason;
    dispatch_source_t _monitor;
    YNXOriginalIdentityPeerLaunchHolder *_identityHolder;
    NSError *_identityCaptureError,*_identityFailure;
    dispatch_source_t _identityMonitor;
}
- (instancetype)initWithParent:(id<YNXWalletAdmissionParentGuard>)parent resources:(NSURL *)resources {
    if((self=[super init])){_channelDescriptor=-1;_parent=parent;_resources=resources;_condition=[NSCondition new];
        self.executableURL=[resources URLByAppendingPathComponent:@"runtime/node"];_cleanupComplete=parent==nil;
        if(parent){NSError *error=nil;if(![self current:&error]||(_channelDescriptor=fcntl(parent.descriptor,F_DUPFD_CLOEXEC,10))<0){if(!_admissionFirstFailure)_admissionFirstFailure=error?:YNXAdmissionLaunchError();[self retireAdmission];}}}
    return self;
}
- (instancetype)initWithAcquireOutcome:(YNXIDEAdmissionAcquireOutcome *)outcome resources:(NSURL *)resources {
    if((self=[self initWithParent:outcome.guard resources:resources])){
        _acquireOutcome=outcome;
        if(outcome.kind==YNXIDEAdmissionCleanupIncomplete){
            _cleanupComplete=NO;_admissionFirstFailure=outcome.firstCause;
            [self retireAdmission];
        }
    }
    return self;
}
- (instancetype)initWithAcquireOutcome:(YNXIDEAdmissionAcquireOutcome *)outcome resources:(NSURL *)resources identityHolder:(YNXOriginalIdentityPeerLaunchHolder *)holder captureError:(NSError *)captureError {
    if((self=[self initWithAcquireOutcome:outcome resources:resources])){_identityHolder=holder;_identityCaptureError=captureError;}
    return self;
}
// This capability has a separate main-thread owner. The old four-operation
// admission monitor and backend reaper must never call its APIs on utility queues.
- (void)retireIdentity {
    if(!NSThread.isMainThread){dispatch_async(dispatch_get_main_queue(),^{[self retireIdentity];});return;}
    if(_identityMonitor){dispatch_source_cancel(_identityMonitor);_identityMonitor=nil;}
    [_identityHolder retire];
}
- (BOOL)finishIdentityCleanupForQuit:(NSError **)error {
    if(!NSThread.isMainThread){if(error)*error=YNXAdmissionLaunchError();return NO;}
    if(!_identityHolder)return _identityCaptureError==nil;
    [self retireIdentity];
    // Called only after the editor's normal save/close approval. Wait/reap stays
    // with this exact task; identity failure alone never kills a coding session.
    if(self.running){[self terminate];[self waitUntilExit];}
    return [_identityHolder join:error]&&[_identityHolder close:error];
}
- (BOOL)isRunning {if(_ordinary)return _ordinary.running;[_condition lock];BOOL v=_running;[_condition unlock];return v;}
- (int)terminationStatus {if(_retired&&!self.finishAdmissionCleanup)return 1;if(_ordinary)return _ordinary.terminationStatus;[_condition lock];int v=_status;[_condition unlock];return v;}
- (NSTaskTerminationReason)terminationReason {if(_ordinary)return _ordinary.terminationReason;[_condition lock];NSTaskTerminationReason v=_reason;[_condition unlock];return v;}
- (void)retireAdmission {
    @synchronized(self){if(_retired)return;_retired=YES;if(_monitor){dispatch_source_cancel(_monitor);_monitor=nil;}
        // Shut down only our retained duplicate, never a possibly recycled
        // descriptor obtained from a retired supplier's getter.
        BOOL retirementFailed=NO;
        if(_parent){@try{YNXOriginalRetireIDEAdmissionParent(_parent);}@catch(id failure){retirementFailed=YES;if(!_admissionCleanupFailure)_admissionCleanupFailure=failure;_cleanupComplete=NO;}}
        if(_channelDescriptor>=0){shutdown(_channelDescriptor,SHUT_RDWR);close(_channelDescriptor);_channelDescriptor=-1;}
        if(_parent&&!_cleanupSelected){_cleanupSelected=YES;@try{[_parent close];_cleanupComplete=!retirementFailed;if(!retirementFailed)_parent=nil;}@catch(id error){if(!_admissionCleanupFailure)_admissionCleanupFailure=error;_cleanupComplete=NO;fprintf(stderr,"YNX_WALLET_PARENT_CLEANUP_INCOMPLETE\n");}}
        NSError *debtError=nil;
        if(!YNXFinishIDEAdmissionAcquireCleanup(_acquireOutcome,&debtError)){
            _cleanupComplete=NO;if(!_admissionCleanupFailure)_admissionCleanupFailure=debtError;
        }}
}
- (BOOL)finishAdmissionCleanup { @synchronized(self){return _cleanupComplete&&YNXFinishIDEAdmissionAcquireCleanup(_acquireOutcome,nil);} }
- (id)admissionFirstFailure { @synchronized(self){return _admissionFirstFailure;} }
- (id)admissionCleanupFailure { @synchronized(self){return _admissionCleanupFailure;} }
- (BOOL)current:(NSError **)error {
    @synchronized(self){if(_retired||!_parent||_parent.parentPID!=getppid()
        ||![_parent assertCurrentResources:_resources node:self.executableURL entry:[_resources URLByAppendingPathComponent:@"server.mjs"] child:_pid error:error]){
        if(error&&!*error)*error=YNXAdmissionLaunchError();if(!_admissionFirstFailure)_admissionFirstFailure=(error&&*error)?*error:YNXAdmissionLaunchError();return NO;}return YES;}
}
- (BOOL)launchAndReturnError:(NSError **)error {
    if(_started){if(error)*error=YNXAdmissionLaunchError();return NO;}_started=YES;
    if(!NSThread.isMainThread||_identityCaptureError||(_identityHolder&&![_identityHolder assertCurrent:error])){
        if(error&&!*error)*error=_identityCaptureError?:_identityHolder.firstCause?:YNXAdmissionLaunchError();
        [self retireIdentity];return NO;
    }
    if((!_parent||_retired)&&!_identityHolder){
        _ordinary=[NSTask new];_ordinary.executableURL=self.executableURL;_ordinary.arguments=self.arguments;
        _ordinary.environment=self.environment;if(self.standardInput)_ordinary.standardInput=self.standardInput;
        _ordinary.standardOutput=self.standardOutput;_ordinary.standardError=self.standardError;
        __weak typeof(self) weakSelf=self;_ordinary.terminationHandler=^(NSTask *task){typeof(self) owner=weakSelf;if(owner.terminationHandler)owner.terminationHandler(owner);};
        return [_ordinary launchAndReturnError:error];
    }
    if(_parent&&!_retired&&![self current:error]){[self retireAdmission];[self retireIdentity];return NO;}
    // Original guard independently approves executable/entry/provenance. These
    // structural checks only ensure this caller cannot switch the approved pair.
    NSString *entry=[_resources URLByAppendingPathComponent:@"server.mjs"].path;
    if(![self.executableURL isEqual:[_resources URLByAppendingPathComponent:@"runtime/node"]]
       ||self.arguments.count!=1||![self.arguments.firstObject isEqual:entry]){[self retireAdmission];if(error)*error=YNXAdmissionLaunchError();return NO;}
    NSFileHandle *input=[self.standardInput isKindOfClass:NSPipe.class]?[self.standardInput fileHandleForReading]:self.standardInput;
    int sources[5]={input.fileDescriptor,self.standardOutput.fileDescriptor,self.standardError.fileDescriptor,-1,-1};
    int targets[5]={0,1,2,4,5},held[5]={-1,-1,-1,-1,-1};
    if(_parent&&!_retired)sources[3]=_channelDescriptor;
    posix_spawn_file_actions_t actions;posix_spawnattr_t attributes;
    int result=posix_spawn_file_actions_init(&actions);if(result){[self retireAdmission];if(error)*error=[NSError errorWithDomain:NSPOSIXErrorDomain code:result userInfo:nil];return NO;}
    result=posix_spawnattr_init(&attributes);
    if(result){posix_spawn_file_actions_destroy(&actions);[self retireAdmission];if(error)*error=[NSError errorWithDomain:NSPOSIXErrorDomain code:result userInfo:nil];return NO;}
    char **argv=NULL,**envp=NULL;BOOL spawnAttempted=NO;
    @try {
        if(!input||!self.standardOutput||!self.standardError)@throw YNXAdmissionLaunchError();
        // Stage every source above reserved descriptors to prevent dup2 actions
        // from clobbering a subsequent source. Darwin closes all other handles.
        if(_identityHolder){sources[4]=[_identityHolder duplicateForBackendSpawn:error];if(sources[4]<0)@throw YNXAdmissionLaunchError();}
        for(int i=0;i<5;i++){if(i>=3&&sources[i]<0)continue;held[i]=fcntl(sources[i],F_DUPFD_CLOEXEC,10);if(held[i]<0)@throw YNXAdmissionLaunchError();
            result=posix_spawn_file_actions_adddup2(&actions,held[i],targets[i]);if(result)@throw YNXAdmissionLaunchError();}
        result=posix_spawnattr_setflags(&attributes,POSIX_SPAWN_CLOEXEC_DEFAULT);if(result)@throw YNXAdmissionLaunchError();
        argv=calloc(3,sizeof(char *));envp=calloc(self.environment.count+1,sizeof(char *));if(!argv||!envp)@throw YNXAdmissionLaunchError();
        argv[0]=strdup(self.executableURL.path.fileSystemRepresentation);argv[1]=strdup(entry.fileSystemRepresentation);
        if(!argv[0]||!argv[1])@throw YNXAdmissionLaunchError();
        NSUInteger n=0;for(NSString *key in self.environment){NSString *v=self.environment[key];
            NSCharacterSet *nul=[NSCharacterSet characterSetWithRange:NSMakeRange(0,1)];
            if(![key isKindOfClass:NSString.class]||![v isKindOfClass:NSString.class]||[key containsString:@"="]||[key rangeOfCharacterFromSet:nul].location!=NSNotFound||[v rangeOfCharacterFromSet:nul].location!=NSNotFound)@throw YNXAdmissionLaunchError();
            envp[n]=strdup([[NSString stringWithFormat:@"%@=%@",key,v] UTF8String]);if(!envp[n++])@throw YNXAdmissionLaunchError();}
        if(_parent&&!_retired&&![self current:error])@throw YNXAdmissionLaunchError();
        if(_identityHolder&&![_identityHolder assertCurrent:error])@throw YNXAdmissionLaunchError();
        spawnAttempted=YES;
        result=posix_spawn(&_pid,argv[0],&actions,&attributes,argv,envp);
    } @catch(id failure) {if(!result)result=EINVAL;}
    // The Auth holder owns sources[4]; close only our additional staging copies.
    for(int i=0;i<5;i++)if(held[i]>=0)close(held[i]);
    if(argv){for(int i=0;i<2;i++)free(argv[i]);free(argv);}if(envp){for(NSUInteger i=0;i<self.environment.count;i++)free(envp[i]);free(envp);}
    posix_spawnattr_destroy(&attributes);posix_spawn_file_actions_destroy(&actions);
    if(spawnAttempted&&_identityHolder){NSError *identityError=nil;
        if(![_identityHolder finishBackendSpawn:_pid spawnStatus:result error:&identityError]){
            _identityFailure=identityError?:_identityHolder.firstCause?:YNXAdmissionLaunchError();[self retireIdentity];
        }}
    if(result){[self retireAdmission];[self retireIdentity];if(error&&!*error)*error=[NSError errorWithDomain:NSPOSIXErrorDomain code:result userInfo:nil];return NO;}
    [_condition lock];_running=YES;[_condition unlock];
    if([self.standardInput isKindOfClass:NSPipe.class])[[self.standardInput fileHandleForReading] closeFile];
    // Failed post-launch authority retires ONLY the capability. The owned local
    // backend still runs local coding; no unrelated window/process is killed.
    NSError *adoptionFailure=nil;
    BOOL adopted=NO;
    @try{if(_parent&&!_retired)adopted=YNXOriginalAdoptIDEAdmissionChild(_parent,_pid,&adoptionFailure);}
    @catch(id failure){if(!_admissionFirstFailure)_admissionFirstFailure=failure;}
    if(_parent&&!adopted){
        if(!_admissionFirstFailure)_admissionFirstFailure=adoptionFailure?:YNXAdmissionLaunchError();
        [self retireAdmission];
    }else if(_parent&&![self current:nil])[self retireAdmission];
    __weak typeof(self) weakSelf=self;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{typeof(self) owner=weakSelf;if(!owner)return;int status=0;pid_t waited;siginfo_t info;int observed;
        // Keep the exited owned child unreaped until signalling is fenced under
        // the same lock. A historical/reused PID must never be terminated.
        do{observed=waitid(P_PID,owner->_pid,&info,WEXITED|WNOWAIT);}while(observed<0&&errno==EINTR);
        [owner->_condition lock];owner->_running=NO;
        do{waited=waitpid(owner->_pid,&status,0);}while(waited<0&&errno==EINTR);
        owner->_status=waited<0?1:WIFEXITED(status)?WEXITSTATUS(status):WIFSIGNALED(status)?WTERMSIG(status):1;
        owner->_reason=waited>=0&&WIFSIGNALED(status)?NSTaskTerminationReasonUncaughtSignal:NSTaskTerminationReasonExit;
        [owner->_condition broadcast];[owner->_condition unlock];[owner retireAdmission];
        dispatch_async(dispatch_get_main_queue(),^{[owner retireIdentity];NSError *cleanupError=nil;
            if(owner->_identityHolder&&![owner finishIdentityCleanupForQuit:&cleanupError]&&!owner->_identityFailure)owner->_identityFailure=cleanupError;
        });
        if(owner.terminationHandler)owner.terminationHandler(owner);
    });
    @synchronized(self){if(_parent&&!_retired){_monitor=dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,0,0,dispatch_get_global_queue(QOS_CLASS_UTILITY,0));
        dispatch_source_set_timer(_monitor,dispatch_time(DISPATCH_TIME_NOW,250*NSEC_PER_MSEC),250*NSEC_PER_MSEC,10*NSEC_PER_MSEC);
        dispatch_source_set_event_handler(_monitor,^{typeof(self) owner=weakSelf;if(owner&&![owner current:nil])[owner retireAdmission];});dispatch_resume(_monitor);}}
    if(_identityHolder&&!_identityFailure){_identityMonitor=dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,0,0,dispatch_get_main_queue());
        dispatch_source_set_timer(_identityMonitor,dispatch_time(DISPATCH_TIME_NOW,250*NSEC_PER_MSEC),250*NSEC_PER_MSEC,10*NSEC_PER_MSEC);
        dispatch_source_set_event_handler(_identityMonitor,^{typeof(self) owner=weakSelf;if(!owner)return;NSError *identityError=nil;
            if(![owner->_identityHolder assertCurrent:&identityError]){if(!owner->_identityFailure)owner->_identityFailure=identityError?:owner->_identityHolder.firstCause;[owner retireIdentity];}
        });dispatch_resume(_identityMonitor);}
    return YES;
}
- (void)terminate { [self retireAdmission];if(_ordinary){[_ordinary terminate];return;}[_condition lock];if(_running)kill(_pid,SIGTERM);[_condition unlock]; }
- (void)waitUntilExit {if(_ordinary){[_ordinary waitUntilExit];return;}[_condition lock];while(_running)[_condition wait];[_condition unlock];}
@end

// Shared with the actual native quit gate and bounded PUBLIC controls. This
// reads the same owners' completion; logging/nil business guard is insufficient.
static BOOL YNXWalletAdmissionCleanupMayFinish(YNXWalletAdmissionBackendTask *task,
    YNXIDEAdmissionAcquireOutcome *pending,id<YNXWalletAdmissionParentGuard> parent) {
    return (!task||[task finishAdmissionCleanup])&&YNXFinishIDEAdmissionAcquireCleanup(pending,nil)&&!parent;
}
