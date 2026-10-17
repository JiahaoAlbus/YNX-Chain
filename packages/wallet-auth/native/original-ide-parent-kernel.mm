#import "original-ide-parent-kernel.h"
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#import <bsm/libbsm.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <sys/sysctl.h>
#import <sys/stat.h>
#import <mach/mach.h>
#import <fcntl.h>
#import <unistd.h>
#include <chrono>
#include <vector>
// Exact Apple XNU userspace SPI declaration (SDK does not ship codesign.h):
// https://github.com/apple/darwin-xnu/blob/main/bsd/sys/codesign.h
extern "C" int csops_audittoken(pid_t,unsigned int,void *,size_t,audit_token_t *);
namespace ynx_auth_ide_private {
KernelProcess observeKernel(pid_t pid){
 KernelProcess out;struct proc_bsdinfo b{};char path[PROC_PIDPATHINFO_MAXSIZE]{};
 if(pid<=1||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))!=(int)sizeof(b)||b.pbi_pid!=(uint32_t)pid||proc_pidpath(pid,path,sizeof(path))<=0)throw std::runtime_error("IDE_KERNEL_PROCESS_UNAVAILABLE");
 out.original={b.pbi_pid,b.pbi_ppid,b.pbi_uid,b.pbi_gid,b.pbi_start_tvsec,b.pbi_start_tvusec};out.image=[NSString stringWithUTF8String:path];
 SecCodeRef dynamic=nullptr;SecStaticCodeRef image=nullptr;CFDictionaryRef metadata=nullptr;
 OSStatus rc=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString*)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&dynamic);
 if(rc==errSecSuccess)rc=SecCodeCheckValidity(dynamic,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopyStaticCode(dynamic,kSecCSDefaultFlags,&image);
 if(rc==errSecSuccess)rc=SecStaticCodeCheckValidity(image,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopySigningInformation(image,kSecCSSigningInformation,&metadata);
 id unique=metadata?((__bridge NSDictionary*)metadata)[(__bridge NSString*)kSecCodeInfoUnique]:nil;
 if(rc==errSecSuccess&&[unique isKindOfClass:NSData.class])out.codeIdentity=[unique copy];
 if(metadata)CFRelease(metadata);if(image)CFRelease(image);if(dynamic)CFRelease(dynamic);
 if(!out.codeIdentity||!out.image)throw std::runtime_error("IDE_KERNEL_CODE_UNAVAILABLE");return out;
}
audit_token_t originalSelfAudit(){audit_token_t token{};mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;if(task_info(mach_task_self(),TASK_AUDIT_TOKEN,(task_info_t)&token,&count)!=KERN_SUCCESS||count!=TASK_AUDIT_TOKEN_COUNT||audit_token_to_pid(token)!=getpid())throw std::runtime_error("IDE_SELF_AUDIT_UNAVAILABLE");return token;}
bool verifyKernelAudit(const std::array<unsigned char,32>&raw,const ProcessOriginal&expected){
 audit_token_t token{};static_assert(sizeof(token)==32);std::memcpy(&token,raw.data(),32);uint32_t status=0;
 if(expected.pid<=1||expected.pid>INT_MAX||audit_token_to_pid(token)!=(pid_t)expected.pid||audit_token_to_euid(token)!=expected.uid||audit_token_to_egid(token)!=expected.gid||csops_audittoken((pid_t)expected.pid,0,&status,sizeof(status),&token)||(status&1u)==0)return false;
 return observeKernel((pid_t)expected.pid).original==expected;
}
bool sameKernel(const KernelProcess&a,const KernelProcess&b){return a.original==b.original&&[a.image isEqual:b.image]&&[a.codeIdentity isEqual:b.codeIdentity];}
NSString *actualNodeParentResources(){
 auto parent=observeKernel(getppid()),self=observeKernel(getpid());
 NSString *app=parent.image.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;
 NSBundle *bundle=[NSBundle bundleWithPath:app];NSString *resources=bundle.resourceURL.path;
 if(!bundle.resourceURL.isFileURL||![bundle.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"]||![bundle.executableURL.path isEqual:parent.image]||![self.image isEqual:[resources stringByAppendingPathComponent:@"runtime/node"]])throw std::runtime_error("IDE_NODE_ACTUAL_PARENT_BUNDLE_MISMATCH");return resources;
}
bool actualNodeEntry(NSString *resources,NSString *entryFileURL){
 NSURL *url=[NSURL URLWithString:entryFileURL];NSString *entry=[resources stringByAppendingPathComponent:@"server.mjs"];
 if(!url.isFileURL||url.host.length||url.query.length||url.fragment.length||![url.path isEqual:entry])return false;
 int mib[]={CTL_KERN,KERN_PROCARGS2,getpid()};size_t length=0;
 if(sysctl(mib,3,nullptr,&length,nullptr,0)||length<8||length>262144)return false;
 std::vector<char>raw(length);if(sysctl(mib,3,raw.data(),&length,nullptr,0))return false;
 int argc=0;std::memcpy(&argc,raw.data(),sizeof(argc));if(argc!=2)return false;
 size_t at=sizeof(argc);while(at<length&&raw[at])at++;while(at<length&&!raw[at])at++;
 for(int index=0;index<2;index++){size_t start=at;while(at<length&&raw[at])at++;if(at>=length)return false;
  if(index==1){NSString *observed=[[NSString alloc]initWithBytes:raw.data()+start length:at-start encoding:NSUTF8StringEncoding];if(![observed isEqual:entry])return false;}at++;
 }return true;
}
static bool identity(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
static bool fileDigest(NSString *path,NSString *expected,ResourceCloseDebt&debt){
 char canonical[PATH_MAX];if(!realpath(path.fileSystemRepresentation,canonical)||![path isEqual:[NSString stringWithUTF8String:canonical]])return false;
 int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0)return false;
 struct stat before{},named{},after{};bool ok=fstat(fd,&before)==0&&lstat(path.fileSystemRepresentation,&named)==0&&identity(before,named)&&S_ISREG(before.st_mode)&&before.st_nlink==1&&!(before.st_mode&0022)&&before.st_size>0&&before.st_size<=134217728;
 CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);unsigned char bytes[16384];off_t at=0;
 while(ok&&at<before.st_size){ssize_t n=pread(fd,bytes,(size_t)std::min<off_t>(sizeof(bytes),before.st_size-at),at);if(n<=0){ok=false;break;}CC_SHA256_Update(&ctx,bytes,(CC_LONG)n);at+=n;}
 unsigned char digest[32];CC_SHA256_Final(digest,&ctx);NSMutableString *hex=[NSMutableString string];for(auto b:digest)[hex appendFormat:@"%02x",b];
 ok=ok&&fstat(fd,&after)==0&&lstat(path.fileSystemRepresentation,&named)==0&&identity(before,after)&&identity(before,named)&&[hex isEqual:expected];
 // Never retry an uncertain close. A failure denies all use of these bytes.
 if(::close(fd)){debt.unknown.push_back({fd,before});ok=false;}return ok;
}
bool registeredResources(NSString *resources,const SourceBinding&source,ResourceCloseDebt&debt){
 if(!debt.clean())return false;NSDictionary *r=source.registration();return fileDigest([resources stringByAppendingPathComponent:@"runtime/node"],r[@"nodeSHA256"],debt)&&fileDigest([resources stringByAppendingPathComponent:@"server.mjs"],r[@"entrySHA256"],debt)&&fileDigest([resources stringByAppendingPathComponent:@"build-provenance.json"],r[@"provenanceSHA256"],debt);
}
std::array<unsigned char,32> originalRequestDigest(const SourceBinding&s){
 NSData *raw=[NSJSONSerialization dataWithJSONObject:s.request() options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!raw||raw.length>65536)throw std::runtime_error("IDE_SOURCE_REQUEST_CAPACITY");std::array<unsigned char,32>digest{};CC_SHA256(raw.bytes,(CC_LONG)raw.length,digest.data());return digest;
}
Prelude originalPrelude(PreludeKind kind,const SourceBinding&s){Prelude p{};p.kind=kind;p.source=originalRequestDigest(s);NSString *nonce=s.request()[@"requestNonce"];if([nonce lengthOfBytesUsingEncoding:NSUTF8StringEncoding]!=43)throw std::runtime_error("IDE_SOURCE_INTENT_INVALID");std::memcpy(p.intent.data(),nonce.UTF8String,43);auto token=originalSelfAudit();std::memcpy(p.audit.data(),&token,32);arc4random_buf(p.challenge.data(),32);return p;}
bool originalPreludeBinding(const Prelude&p,const SourceBinding&s){return p.source==originalRequestDigest(s)&&std::memcmp(p.intent.data(),[s.request()[@"requestNonce"] UTF8String],43)==0;}
std::uint64_t monotonicMS(){return (uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
std::uint64_t wallMS(){return (uint64_t)(NSDate.date.timeIntervalSince1970*1000);}
}
