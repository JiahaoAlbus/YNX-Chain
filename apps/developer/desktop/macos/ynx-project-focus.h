// Focus-only IPC. A record locates a peer; it never grants project access.
// Both peers require the kernel PID to satisfy this executable's designated
// code requirement. Old/different builds fail closed to native recovery.
#pragma once
#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <sys/socket.h>
#import <sys/un.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <poll.h>
#import <unistd.h>
#import <arpa/inet.h>
#import <errno.h>
#import <string.h>

static BOOL YNXFocusSameCode(int fd) {
    pid_t pid=0;socklen_t size=sizeof(pid);
    if(getsockopt(fd,SOL_LOCAL,LOCAL_PEERPID,&pid,&size)||size!=sizeof(pid)||pid<=0)return NO;
    uid_t uid;gid_t gid;if(getpeereid(fd,&uid,&gid)||uid!=getuid())return NO;
    SecCodeRef own=NULL,peer=NULL;SecRequirementRef requirement=NULL;
    OSStatus result=SecCodeCopySelf(kSecCSDefaultFlags,&own);
    if(result==errSecSuccess)result=SecCodeCopyDesignatedRequirement(own,kSecCSDefaultFlags,&requirement);
    if(result==errSecSuccess)result=SecCodeCopyGuestWithAttributes(NULL,(__bridge CFDictionaryRef)@{(__bridge NSString *)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&peer);
    if(result==errSecSuccess)result=SecCodeCheckValidity(peer,kSecCSStrictValidate,requirement);
    if(peer)CFRelease(peer);if(requirement)CFRelease(requirement);if(own)CFRelease(own);
    return result==errSecSuccess;
}
static BOOL YNXFocusTransfer(int fd,void *buffer,size_t size,BOOL writing) {
    // One absolute monotonic deadline, including partial reads/writes.
    NSTimeInterval deadline=NSProcessInfo.processInfo.systemUptime+0.5;
    size_t offset=0;while(offset<size){
        NSTimeInterval left=deadline-NSProcessInfo.processInfo.systemUptime;if(left<=0)return NO;
        struct pollfd item={.fd=fd,.events=writing?POLLOUT:POLLIN};
        int ready=poll(&item,1,(int)(left*1000)+1);if(ready<0&&errno==EINTR)continue;
        if(ready<=0||!(item.revents&(writing?POLLOUT:POLLIN)))return NO;
        ssize_t count=writing?send(fd,(char *)buffer+offset,size-offset,0):recv(fd,(char *)buffer+offset,size-offset,0);
        if(count<0&&(errno==EINTR||errno==EAGAIN))continue;if(count<=0)return NO;offset+=(size_t)count;
    }return YES;
}
static BOOL YNXFocusSend(int fd,NSDictionary *value) {
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if(!data.length||data.length>4096)return NO;
    uint32_t length=htonl((uint32_t)data.length);
    return YNXFocusTransfer(fd,&length,sizeof(length),YES)&&YNXFocusTransfer(fd,(void *)data.bytes,data.length,YES);
}
static NSDictionary *YNXFocusRead(int fd) {
    uint32_t length=0;if(!YNXFocusTransfer(fd,&length,sizeof(length),NO))return nil;
    length=ntohl(length);if(!length||length>4096)return nil;
    NSMutableData *data=[NSMutableData dataWithLength:length];if(!YNXFocusTransfer(fd,data.mutableBytes,length,NO))return nil;
    id value=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];return [value isKindOfClass:NSDictionary.class]?value:nil;
}
static int YNXFocusSocket(void) {
    int fd=socket(AF_UNIX,SOCK_STREAM,0);if(fd<0)return -1;
    int yes=1;if(fcntl(fd,F_SETFD,FD_CLOEXEC)||fcntl(fd,F_SETFL,O_NONBLOCK)||setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes))){close(fd);return -1;}return fd;
}
static BOOL YNXFocusAddress(NSString *path,struct sockaddr_un *address) {
    const char *bytes=path.fileSystemRepresentation;if(!bytes||strlen(bytes)>=sizeof(address->sun_path))return NO;
    memset(address,0,sizeof(*address));address->sun_family=AF_UNIX;address->sun_len=sizeof(*address);strlcpy(address->sun_path,bytes,sizeof(address->sun_path));return YES;
}
@interface YNXProjectFocus : NSObject
@property(nonatomic,strong) dispatch_source_t listener;
@property(nonatomic,copy) NSString *directory;
@property(nonatomic,copy) NSString *record;
@property(nonatomic,copy) NSString *instance;
@property(nonatomic,copy) NSDictionary *binding;
@property(nonatomic,copy) BOOL (^focus)(void);
- (BOOL)startWithBinding:(NSDictionary *)binding focus:(BOOL (^)(void))focus;
- (void)stop;
+ (BOOL)requestBinding:(NSDictionary *)binding record:(NSDictionary *)record;
@end
@implementation YNXProjectFocus
- (BOOL)startWithBinding:(NSDictionary *)binding focus:(BOOL (^)(void))focus {
    if(self.listener||!binding[@"projectId"]||!binding[@"workspace"]||!binding[@"profile"]||!focus)return NO;
    char temporary[]="/private/tmp/ynx-focus-XXXXXX";if(!mkdtemp(temporary))return NO;
    self.directory=[NSString stringWithUTF8String:temporary];self.record=[binding[@"profile"] stringByAppendingPathComponent:@"native-focus.json"];
    self.instance=NSUUID.UUID.UUIDString.lowercaseString;self.binding=binding;self.focus=focus;
    NSString *path=[self.directory stringByAppendingPathComponent:@"owner.sock"];
    struct sockaddr_un address;int fd=YNXFocusSocket();
    if(fd<0||!YNXFocusAddress(path,&address)||bind(fd,(struct sockaddr *)&address,sizeof(address))||chmod(path.fileSystemRepresentation,0600)||listen(fd,8)){if(fd>=0)close(fd);[self stop];return NO;}
    dispatch_queue_t queue=dispatch_queue_create("com.ynx.developer.project-focus",DISPATCH_QUEUE_SERIAL);
    self.listener=dispatch_source_create(DISPATCH_SOURCE_TYPE_READ,(uintptr_t)fd,0,queue);
    if(!self.listener){close(fd);[self stop];return NO;}
    __weak typeof(self) weakSelf=self;
    dispatch_source_set_event_handler(self.listener,^{
        typeof(self) owner=weakSelf;if(!owner)return;
        int peer=accept(fd,NULL,NULL);if(peer<0)return;
        int yes=1;if(fcntl(peer,F_SETFD,FD_CLOEXEC)||fcntl(peer,F_SETFL,O_NONBLOCK)||setsockopt(peer,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes))){close(peer);return;}
        NSDictionary *request=YNXFocusSameCode(peer)?YNXFocusRead(peer):nil;
        BOOL exact=request.count==3&&[request[@"action"] isEqual:@"focus"]&&[request[@"projectId"] isEqual:owner.binding[@"projectId"]]&&[request[@"nonce"] isKindOfClass:NSString.class]&&[[NSUUID alloc]initWithUUIDString:request[@"nonce"]];
        __block BOOL focused=NO;if(exact)dispatch_sync(dispatch_get_main_queue(),^{if(owner.listener&&owner.focus)focused=owner.focus();});
        if(exact)YNXFocusSend(peer,@{@"nonce":request[@"nonce"],@"projectId":owner.binding[@"projectId"],@"focused":@(focused)});
        close(peer);
    });
    dispatch_source_set_cancel_handler(self.listener,^{close(fd);});dispatch_resume(self.listener);
    NSDictionary *record=@{@"schemaVersion":@1,@"instance":self.instance,@"socket":path,@"workspace":binding[@"workspace"],@"profile":binding[@"profile"],@"projectId":binding[@"projectId"]};
    NSData *data=[NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
    NSString *pending=[self.record stringByAppendingFormat:@".%@",self.instance];int output=open(pending.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
    BOOL saved=output>=0&&write(output,data.bytes,data.length)==(ssize_t)data.length&&fsync(output)==0;if(output>=0)close(output);
    if(saved)saved=rename(pending.fileSystemRepresentation,self.record.fileSystemRepresentation)==0;
    if(!saved){unlink(pending.fileSystemRepresentation);[self stop];return NO;}return YES;
}
+ (BOOL)requestBinding:(NSDictionary *)binding record:(NSDictionary *)record {
    if(record.count!=6||![record[@"schemaVersion"] isEqual:@1]||![record[@"workspace"] isEqual:binding[@"workspace"]]||![record[@"profile"] isEqual:binding[@"profile"]]||![record[@"projectId"] isEqual:binding[@"projectId"]]||![record[@"instance"] isKindOfClass:NSString.class]||![[NSUUID alloc]initWithUUIDString:record[@"instance"]])return NO;
    NSString *path=record[@"socket"];if(![path isKindOfClass:NSString.class]||![path hasPrefix:@"/private/tmp/ynx-focus-"]||![path.lastPathComponent isEqual:@"owner.sock"])return NO;
    struct stat state;NSString *directory=path.stringByDeletingLastPathComponent;
    if(lstat(directory.fileSystemRepresentation,&state)||!S_ISDIR(state.st_mode)||state.st_uid!=getuid()||(state.st_mode&077)||lstat(path.fileSystemRepresentation,&state)||!S_ISSOCK(state.st_mode)||state.st_uid!=getuid()||(state.st_mode&077))return NO;
    struct sockaddr_un address;if(!YNXFocusAddress(path,&address))return NO;
    int fd=YNXFocusSocket();if(fd<0)return NO;
    // A local Unix connect does not need a network grant. A pending/nonready
    // peer is a recoverable refusal, never an unbounded connect or retry.
    BOOL connected=connect(fd,(struct sockaddr *)&address,sizeof(address))==0;
    NSString *nonce=NSUUID.UUID.UUIDString.lowercaseString;
    BOOL sent=connected&&YNXFocusSameCode(fd)&&YNXFocusSend(fd,@{@"action":@"focus",@"projectId":binding[@"projectId"],@"nonce":nonce});
    NSDictionary *reply=sent?YNXFocusRead(fd):nil;
    BOOL focused=reply.count==3&&[reply[@"nonce"] isEqual:nonce]&&[reply[@"projectId"] isEqual:binding[@"projectId"]]&&[reply[@"focused"] isEqual:@YES];close(fd);return focused;
}
- (void)stop {
    if(self.listener){dispatch_source_cancel(self.listener);self.listener=nil;}self.focus=nil;
    // The record can have been replaced by a newer owner. Never remove it.
    // It is only a locator; a stopped socket cannot authenticate or activate.
    if(self.directory){unlink([self.directory stringByAppendingPathComponent:@"owner.sock"].fileSystemRepresentation);rmdir(self.directory.fileSystemRepresentation);self.directory=nil;}
}
- (void)dealloc { [self stop]; }
@end
