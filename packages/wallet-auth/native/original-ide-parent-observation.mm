#import "original-ide-parent-observation.h"
#import "original-ide-parent-kernel.h"
#import <Security/Security.h>
#import <bsm/libbsm.h>
#import <mach/mach.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <fcntl.h>
#import <unistd.h>
#import <poll.h>
#include <cstring>
#include <vector>

namespace ynx_auth_ide_private {
static bool same(struct stat a,struct stat b){
 return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&
 a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
}
static bool process(pid_t pid,ProcessOriginal&out,NSString **path){
 struct proc_bsdinfo b{};char image[PROC_PIDPATHINFO_MAXSIZE]{};
 if(pid<=1||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))!=(int)sizeof(b)||b.pbi_pid!=(uint32_t)pid||proc_pidpath(pid,image,sizeof(image))<=0)return false;
 out={(uint64_t)b.pbi_pid,(uint64_t)b.pbi_ppid,b.pbi_uid,b.pbi_gid,b.pbi_start_tvsec,b.pbi_start_tvusec};
 *path=[NSString stringWithUTF8String:image];return *path!=nil;
}
static NSData *code(pid_t pid){
 SecCodeRef dynamic=nullptr;SecStaticCodeRef image=nullptr;CFDictionaryRef metadata=nullptr;
 OSStatus rc=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString *)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&dynamic);
 if(rc==errSecSuccess)rc=SecCodeCheckValidity(dynamic,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopyStaticCode(dynamic,kSecCSDefaultFlags,&image);
 if(rc==errSecSuccess)rc=SecStaticCodeCheckValidity(image,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopySigningInformation(image,kSecCSSigningInformation,&metadata);
 id unique=metadata?((__bridge NSDictionary *)metadata)[(__bridge NSString *)kSecCodeInfoUnique]:nil;
 NSData *result=(rc==errSecSuccess&&[unique isKindOfClass:NSData.class])?[unique copy]:nil;
 if(metadata)CFRelease(metadata);if(image)CFRelease(image);if(dynamic)CFRelease(dynamic);return result;
}
struct Observation::Impl {
 int fds[5]={-1,-1,-1,-1,-1};struct stat files[5]{};
 ProcessOriginal wallet{},ide{},node{};audit_token_t ideToken{},walletToken{};
 NSString *__strong resources=nil,*walletPath=nil,*idePath=nil,*nodePath=nil;
 NSData *__strong walletCode=nil,*ideCode=nil,*nodeCode=nil;
 NSError *__strong first=nil,*cleanup=nil;
 bool entered=false,invalid=false,childSelected=false,selected=false,completed=false;
 bool inheritedOwned=false,inheritedSelected=false,inheritedClosed=false;
 bool fail(NSString *why,NSError **e){invalid=true;if(!first)first=[NSError errorWithDomain:@"YNXOriginalIDEObservation" code:1 userInfo:@{NSLocalizedDescriptionKey:why}];if(e)*e=first;return false;}
 bool peer(int fd){
  int kind=0;socklen_t n=sizeof(kind);sockaddr_un address{};socklen_t length=sizeof(address);audit_token_t token{};socklen_t tokenLength=sizeof(token);
  pollfd state{fd,POLLIN,0};int polled=poll(&state,1,0);
  if(polled<0||(state.revents&(POLLHUP|POLLERR|POLLNVAL)))return false;
  return getsockopt(fd,SOL_SOCKET,SO_TYPE,&kind,&n)==0&&kind==SOCK_STREAM&&getpeername(fd,(sockaddr *)&address,&length)==0&&address.sun_family==AF_UNIX&&
   getsockopt(fd,SOL_LOCAL,LOCAL_PEERTOKEN,&token,&tokenLength)==0&&tokenLength==sizeof(token)&&
   audit_token_to_pid(token)==(pid_t)wallet.pid&&audit_token_to_euid(token)==wallet.uid&&std::memcmp(&token,&walletToken,sizeof(token))==0;
 }
 bool captureFile(unsigned index,int fd,bool directory,bool executable,NSError **e){
  fds[index]=fd; // retain before all late checks, including failure
  if(fd<0||fstat(fd,&files[index])||!(directory?S_ISDIR(files[index].st_mode):S_ISREG(files[index].st_mode))||
     (!directory&&files[index].st_nlink!=1)||(files[index].st_mode&0022)||(executable&&!(files[index].st_mode&0111)))return fail(@"IDE_OBSERVATION_RESOURCE_UNAVAILABLE",e);
  return true;
 }
};
Observation::Observation():p_(new Impl){}
// Destruction never retries close. An unresolved owner is retained as native
// cleanup debt rather than silently discarding uncertain descriptor identity.
Observation::~Observation(){
 if(p_->selected&&p_->completed){delete p_;return;}
 // Keep the actual allocation, descriptor identities and first cause. No
 // destructor retry, fd-number recycling hazard, or false completed status.
 static auto *retainedCleanupDebt=new std::vector<Impl *>;
 retainedCleanupDebt->push_back(p_);
}
bool Observation::captureActualIDE(NSError **e){
 auto&p=*p_;if(p.entered||p.selected)return p.fail(@"IDE_OBSERVATION_ACQUIRE_ALREADY_SELECTED",e);p.entered=true;
 NSString *idePath=nil,*walletPath=nil;
 if(!process(getpid(),p.ide,&idePath)||!process(getppid(),p.wallet,&walletPath)||p.ide.parent!=p.wallet.pid||p.ide.uid!=p.wallet.uid)return p.fail(@"IDE_OBSERVATION_LINEAGE_UNAVAILABLE",e);
 p.idePath=idePath;p.walletPath=walletPath;
 mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;
 if(task_info(mach_task_self(),TASK_AUDIT_TOKEN,(task_info_t)&p.ideToken,&count)!=KERN_SUCCESS||count!=TASK_AUDIT_TOKEN_COUNT||audit_token_to_pid(p.ideToken)!=getpid()||audit_token_to_euid(p.ideToken)!=p.ide.uid||audit_token_to_egid(p.ideToken)!=p.ide.gid)return p.fail(@"IDE_OBSERVATION_SELF_AUDIT_UNAVAILABLE",e);
 socklen_t n=sizeof(p.walletToken);
 if(getsockopt(4,SOL_LOCAL,LOCAL_PEERTOKEN,&p.walletToken,&n)||n!=sizeof(p.walletToken)||!p.peer(4))return p.fail(@"IDE_OBSERVATION_ORIGINAL_PEER_UNAVAILABLE",e);
 NSURL *bundle=NSBundle.mainBundle.resourceURL;char canonical[PATH_MAX]{};
 if(!bundle.isFileURL||![NSBundle.mainBundle.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"]||!realpath(bundle.path.fileSystemRepresentation,canonical)||![bundle.path isEqual:[NSString stringWithUTF8String:canonical]])return p.fail(@"IDE_OBSERVATION_ACTUAL_RESOURCES_UNAVAILABLE",e);
 p.resources=[bundle.path copy];
 if(!p.captureFile(0,open(canonical,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK),true,false,e)||
    !p.captureFile(1,openat(p.fds[0],"runtime",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK),true,false,e)||
    !p.captureFile(2,openat(p.fds[1],"node",O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK),false,true,e)||
    !p.captureFile(3,openat(p.fds[0],"server.mjs",O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK),false,false,e))return false;
 p.fds[4]=fcntl(4,F_DUPFD_CLOEXEC,10);
 if(p.fds[4]<0||fstat(p.fds[4],&p.files[4])||!p.peer(p.fds[4]))return p.fail(@"IDE_OBSERVATION_ENDPOINT_UNAVAILABLE",e);
 p.walletCode=code((pid_t)p.wallet.pid);p.ideCode=code(getpid());
 if(!p.walletCode||!p.ideCode)return p.fail(@"IDE_OBSERVATION_CODE_UNAVAILABLE",e);
 return assertOriginals(e);
}
bool Observation::assertOriginals(NSError **e){
 auto&p=*p_;if(!p.entered||p.invalid||p.selected)return p.fail(@"IDE_OBSERVATION_RETIRED",e);
 audit_token_t actualToken{};mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;
 if(task_info(mach_task_self(),TASK_AUDIT_TOKEN,(task_info_t)&actualToken,&count)!=KERN_SUCCESS||count!=TASK_AUDIT_TOKEN_COUNT||std::memcmp(&actualToken,&p.ideToken,sizeof(actualToken)))return p.fail(@"IDE_OBSERVATION_SELF_AUDIT_CHANGED",e);
 std::array<unsigned char,32> peerAudit{};std::memcpy(peerAudit.data(),&p.walletToken,32);if(!verifyKernelAudit(peerAudit,p.wallet))return p.fail(@"IDE_OBSERVATION_PARENT_AUDIT_CHANGED",e);
 ProcessOriginal wallet,ide;NSString *walletPath=nil,*idePath=nil;
 if(!process((pid_t)p.wallet.pid,wallet,&walletPath)||!process(getpid(),ide,&idePath)||!(wallet==p.wallet)||!(ide==p.ide)||
    ![walletPath isEqual:p.walletPath]||![idePath isEqual:p.idePath]||![code((pid_t)p.wallet.pid) isEqual:p.walletCode]||![code(getpid()) isEqual:p.ideCode]||!p.peer(4)||!p.peer(p.fds[4]))return p.fail(@"IDE_OBSERVATION_ORIGINAL_CHANGED",e);
 for(unsigned i=0;i<5;i++){struct stat now{};if(fstat(p.fds[i],&now)||!same(now,p.files[i]))return p.fail(@"IDE_OBSERVATION_HELD_RESOURCE_CHANGED",e);}
 struct stat named[5]{};
 if(lstat(p.resources.fileSystemRepresentation,&named[0])||fstatat(p.fds[0],"runtime",&named[1],AT_SYMLINK_NOFOLLOW)||
    fstatat(p.fds[1],"node",&named[2],AT_SYMLINK_NOFOLLOW)||fstatat(p.fds[0],"server.mjs",&named[3],AT_SYMLINK_NOFOLLOW)||fstat(4,&named[4]))return p.fail(@"IDE_OBSERVATION_NAMED_RESOURCE_UNAVAILABLE",e);
 for(unsigned i=0;i<5;i++)if(!same(named[i],p.files[i]))return p.fail(@"IDE_OBSERVATION_NAMED_RESOURCE_CHANGED",e);
 return true;
}
bool Observation::captureActualSpawnedNode(pid_t actualPID,NSError **e){
 auto&p=*p_;if(p.childSelected)return p.fail(@"IDE_OBSERVATION_CHILD_ALREADY_SELECTED",e);p.childSelected=true;
 if(!assertOriginals(e))return false;
 NSString *nodePath=nil;
 if(!process(actualPID,p.node,&nodePath)||p.node.parent!=p.ide.pid||p.node.uid!=p.ide.uid||![nodePath isEqual:[p.resources stringByAppendingPathComponent:@"runtime/node"]])return p.fail(@"IDE_OBSERVATION_CHILD_LINEAGE_MISMATCH",e);
 p.nodePath=nodePath;
 p.nodeCode=code(actualPID);if(!p.nodeCode)return p.fail(@"IDE_OBSERVATION_CHILD_CODE_UNAVAILABLE",e);
 return assertActualSpawnedNode(e);
}
bool Observation::assertActualSpawnedNode(NSError **e){
 auto&p=*p_;if(!assertOriginals(e)||!p.childSelected||p.node.pid<=1)return p.fail(@"IDE_OBSERVATION_CHILD_UNAVAILABLE",e);
 ProcessOriginal child;NSString *path=nil;
 if(!process((pid_t)p.node.pid,child,&path)||!(child==p.node)||![path isEqual:p.nodePath]||![code((pid_t)p.node.pid) isEqual:p.nodeCode])return p.fail(@"IDE_OBSERVATION_CHILD_CHANGED",e);
 return assertOriginals(e);
}
const ProcessOriginal&Observation::wallet()const{return p_->wallet;}
const ProcessOriginal&Observation::ide()const{return p_->ide;}
const ProcessOriginal&Observation::node()const{return p_->node;}
const audit_token_t&Observation::ideAuditToken()const{return p_->ideToken;}
const audit_token_t&Observation::walletPeerAuditToken()const{return p_->walletToken;}
int Observation::ownedEndpoint()const{return p_->fds[4];}
NSString *Observation::actualResources()const{return p_->resources;}
NSData *Observation::walletCodeIdentity()const{return p_->walletCode;}
NSData *Observation::ideCodeIdentity()const{return p_->ideCode;}
bool Observation::retireEndpoint(NSError **e){
 auto&p=*p_;struct stat now{};
 if(p.selected||p.fds[4]<0||fstat(p.fds[4],&now)||!same(now,p.files[4]))return p.fail(@"IDE_OBSERVATION_ENDPOINT_RETIRE_IDENTITY_UNKNOWN",e);
 if(shutdown(p.fds[4],SHUT_RDWR)&&errno!=ENOTCONN)return p.fail(@"IDE_OBSERVATION_ENDPOINT_RETIRE_UNKNOWN",e);return true;
}
bool Observation::takeInheritedEndpoint(NSError **e){auto&p=*p_;if(p.inheritedOwned||p.selected||!p.peer(4))return p.fail(@"IDE_OBSERVATION_INHERITED_TRANSFER_MISMATCH",e);struct stat current{};if(fstat(4,&current)||!same(current,p.files[4]))return p.fail(@"IDE_OBSERVATION_INHERITED_TRANSFER_CHANGED",e);p.inheritedOwned=true;return true;}
bool Observation::closeOnce(NSError **e){
 auto&p=*p_;p.invalid=true;if(!p.selected){p.selected=true;bool done=true;for(unsigned index=0;index<5;index++){int&i=p.fds[index];if(i<0)continue;struct stat now{};bool matched=fstat(i,&now)==0&&same(now,p.files[index]);if(!matched||::close(i)){done=false;if(!p.cleanup)p.cleanup=[NSError errorWithDomain:@"YNXOriginalIDEObservation" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_OBSERVATION_CLOSE_UNKNOWN"}];}else i=-1;}
  if(p.inheritedOwned&&!p.inheritedSelected){p.inheritedSelected=true;struct stat current{};p.inheritedClosed=fstat(4,&current)==0&&same(current,p.files[4])&&::close(4)==0;if(!p.inheritedClosed){done=false;if(!p.cleanup)p.cleanup=[NSError errorWithDomain:@"YNXOriginalIDEObservation" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_INHERITED_ENDPOINT_CLOSE_UNKNOWN"}];}}
  p.completed=done;}
 if(!p.completed&&e)*e=p.cleanup;return p.completed;
}
}
