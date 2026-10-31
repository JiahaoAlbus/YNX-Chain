#import "original-auth-runtime-image-private.h"
#import "original-auth-runtime-image-source-internal.h"
#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <limits.h>
#include <mutex>
#include <vector>
#include <stdexcept>
#include <cstring>

namespace {
__attribute__((noinline,visibility("hidden"))) void originalRuntimeImageMarker() { asm volatile("" ::: "memory"); }
[[noreturn]] void refuse(const char *c) { throw std::runtime_error(c); }
bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
std::string string(id v){if(![v isKindOfClass:NSString.class])refuse("AUTH_RUNTIME_IMAGE_STRING");const char*p=[v UTF8String];if(!p||strlen(p)!=[v lengthOfBytesUsingEncoding:NSUTF8StringEncoding])refuse("AUTH_RUNTIME_IMAGE_UTF8");return p;}
void shape(id v,NSArray *keys){if(![v isKindOfClass:NSDictionary.class]||[v count]!=keys.count)refuse("AUTH_RUNTIME_IMAGE_SHAPE");for(id key in keys)if(!v[key])refuse("AUTH_RUNTIME_IMAGE_SHAPE");}
std::string canonical(const std::string&p){char out[PATH_MAX];if(p.empty()||p.size()>4096||p[0]!='/'||!realpath(p.c_str(),out)||p!=out)refuse("AUTH_RUNTIME_IMAGE_CANONICAL_PATH");return p;}
uint64_t size(id v,uint64_t cap){if(![v isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)v)==CFBooleanGetTypeID()||CFNumberIsFloatType((__bridge CFNumberRef)v))refuse("AUTH_RUNTIME_IMAGE_BYTES");auto n=[v unsignedLongLongValue];if(!n||n>cap||[v longLongValue]<0)refuse("AUTH_RUNTIME_IMAGE_BYTES");return n;}
bool hex(const std::string&s){return s.size()==64&&s.find_first_not_of("0123456789abcdef")==std::string::npos;}
std::string hashFD(int fd,uint64_t bytes){CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);unsigned char buf[32768];uint64_t offset=0;while(offset<bytes){ssize_t n=pread(fd,buf,std::min<uint64_t>(sizeof buf,bytes-offset),offset);if(n<=0)refuse("AUTH_RUNTIME_IMAGE_READ_UNKNOWN");CC_SHA256_Update(&ctx,buf,(CC_LONG)n);offset+=n;}unsigned char digest[32];CC_SHA256_Final(digest,&ctx);static const char h[]="0123456789abcdef";std::string out;for(auto b:digest){out+=h[b>>4];out+=h[b&15];}return out;}
struct Held{int fd=-1;std::string path,digest;struct stat identity{};bool directory=false,selected=false,closed=false;};
void protectedOwner(const struct stat&s,const std::string&p){
#ifdef YNX_AUTH_RUNTIME_IMAGE_PUBLIC_OS_FIXTURE
 // PUBLIC test build ONLY: no Root or production admission is claimed. Normal
 // build has no runtime switch and requires UID0 all the way to filesystem /.
 const std::string prefix=YNX_AUTH_RUNTIME_IMAGE_PUBLIC_OS_FIXTURE;
 if(p==prefix||p.rfind(prefix+"/",0)==0){if(s.st_uid!=getuid()||(s.st_mode&0022))refuse("AUTH_RUNTIME_IMAGE_PUBLIC_OWNER");return;}
 return;
#else
 if(s.st_uid!=0||(s.st_mode&0022))refuse("AUTH_RUNTIME_IMAGE_INSTALL_NOT_PROTECTED");
#endif
}
void mapped(const void*addr,const std::string&path,const struct stat&s){
 proc_regionwithpathinfo info{};auto n=proc_pidinfo(getpid(),PROC_PIDREGIONPATHINFO,(uint64_t)addr,&info,sizeof info);
 const auto&v=info.prp_vip.vip_vi.vi_stat;
 if(n!=sizeof info||!memchr(info.prp_vip.vip_path,0,sizeof info.prp_vip.vip_path)||path!=info.prp_vip.vip_path||v.vst_dev!=(uint32_t)s.st_dev||v.vst_ino!=(uint64_t)s.st_ino||v.vst_size!=s.st_size)
  refuse("AUTH_RUNTIME_IMAGE_MAPPED_VNODE_MISMATCH");
}
}
namespace ynx_auth_private {
struct OriginalRuntimeImageReadLeaseV1::State {
 std::recursive_mutex mutex;YNXAuthIdentitySourceAuthority *__strong source=nil;NSDictionary *__strong binding=nil;
 const void*caller=nullptr;const void*base=nullptr;OriginalRuntimeImageViewV1 view;
 std::vector<Held> held;bool loan=false,retired=false,closeSelected=false,closed=false;std::string firstCause;
 void fail(const char*c){if(firstCause.empty())firstCause=c;retired=true;}
 void alive(){if(retired||closeSelected||!firstCause.empty())refuse(firstCause.empty()?"AUTH_RUNTIME_IMAGE_RETIRED":firstCause.c_str());}
 void hold(const std::string&p,bool dir,uint64_t bytes=0,const std::string&digest=""){
  for(auto&h:held)if(h.path==p)return;
  canonical(p);Held h;h.path=p;h.directory=dir;h.digest=digest;
  h.fd=open(p.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK|(dir?O_DIRECTORY:0));if(h.fd<0)refuse("AUTH_RUNTIME_IMAGE_OPEN_NOT_SUPPLIED");
  held.push_back(h);auto&owned=held.back();struct stat named{};
  if(fstat(owned.fd,&owned.identity)||lstat(p.c_str(),&named)||!same(owned.identity,named))refuse("AUTH_RUNTIME_IMAGE_IDENTITY");
  protectedOwner(owned.identity,p);
  if(dir?!S_ISDIR(named.st_mode):(!S_ISREG(named.st_mode)||named.st_nlink!=1||(uint64_t)named.st_size!=bytes))refuse("AUTH_RUNTIME_IMAGE_FILE_TUPLE");
  if(!dir&&hashFD(owned.fd,bytes)!=digest)refuse("AUTH_RUNTIME_IMAGE_HASH");
 }
 void ancestors(const std::string&p){NSString*path=[NSString stringWithUTF8String:p.c_str()];std::string part="";hold("/",true);for(NSString*n in path.stringByDeletingLastPathComponent.pathComponents){if([n isEqual:@"/"])continue;part+="/"+string(n);hold(part,true);}}
 void imageAddresses(){Dl_info a{},m{};if(!caller||!dladdr(caller,&a)||!dladdr((const void*)&originalRuntimeImageMarker,&m)||!a.dli_fbase||a.dli_fbase!=m.dli_fbase||!a.dli_fname||!m.dli_fname||canonical(a.dli_fname)!=view.imagePath||canonical(m.dli_fname)!=view.imagePath||(base&&base!=a.dli_fbase))refuse("AUTH_RUNTIME_IMAGE_SAME_NODE_REQUIRED");base=a.dli_fbase;
  for(auto&h:held)if(h.path==view.imagePath){mapped(caller,h.path,h.identity);mapped((const void*)&originalRuntimeImageMarker,h.path,h.identity);return;}refuse("AUTH_RUNTIME_IMAGE_HOLD_REQUIRED");}
 void filesCurrent(){for(auto&h:held){struct stat fd{},named{};if(h.selected||fstat(h.fd,&fd)||lstat(h.path.c_str(),&named)||!same(h.identity,fd)||!same(h.identity,named))refuse("AUTH_RUNTIME_IMAGE_SUBSTITUTION");protectedOwner(fd,h.path);canonical(h.path);if(!h.directory&&hashFD(h.fd,fd.st_size)!=h.digest)refuse("AUTH_RUNTIME_IMAGE_HASH_CHANGED");}}
 void current(){alive();NSError*e=nil;if(![source checkOriginalRuntimeImageBinding:binding error:&e]||e)refuse(e.localizedDescription.UTF8String?:"AUTH_RUNTIME_IMAGE_SOURCE_CURRENT");alive();filesCurrent();imageAddresses();if(![source checkOriginalRuntimeImageBinding:binding error:&e]||e)refuse(e.localizedDescription.UTF8String?:"AUTH_RUNTIME_IMAGE_SOURCE_POST_CURRENT");alive();filesCurrent();imageAddresses();if(![source finishOriginalRuntimeImageBinding:binding error:&e]||e)refuse(e.localizedDescription.UTF8String?:"AUTH_RUNTIME_IMAGE_TERMINAL_CURRENT");alive();}
};
OriginalRuntimeImageReadLeaseV1::OriginalRuntimeImageReadLeaseV1(YNXAuthIdentitySourceAuthority*source,const void*caller,NSError**error):state_(new State){
 auto&s=*state_;s.source=source;s.caller=caller;
 try{@try{
  NSError*e=nil;s.binding=[source retainOriginalRuntimeImageBinding:&e];s.loan=s.binding!=nil;
  if(e||!s.binding)refuse(e.localizedDescription.UTF8String?:"AUTH_RUNTIME_IMAGE_BINDING_V1_NOT_SUPPLIED");
  auto b=s.binding;shape(b,@[@"version",@"normalPackageRoot",@"fixedLoader",@"runtimeManifest",@"implementingImage",@"privateModule"]);
  if(![b[@"version"]isEqual:@"1"])refuse("AUTH_RUNTIME_IMAGE_VERSION");
  s.view.normalPackageRoot=canonical(string(b[@"normalPackageRoot"]));
  NSString*root=b[@"normalPackageRoot"];if(![root hasSuffix:@"/packages/wallet-auth"])refuse("AUTH_RUNTIME_IMAGE_NORMAL_ROOT");
  NSArray*names=@[@"fixedLoader",@"runtimeManifest",@"implementingImage",@"privateModule"];
  NSArray*paths=@[[root stringByAppendingString:@"/src/original-auth-identity-fixed-native-image.js"],[root stringByAppendingString:@"/native/original-ide-auth-runtime-manifest.json"],[[root stringByAppendingString:@"/../../apps/wallet-desktop/native/original-auth-identity.node"]stringByStandardizingPath],[root stringByAppendingString:@"/src/original-http-binary-v5-client-private.js"]];
  for(NSUInteger i=0;i<names.count;i++){
   NSDictionary *pin=b[names[i]];shape(pin,i==3?@[@"path",@"bytes",@"sha256",@"uri"]:@[@"path",@"bytes",@"sha256"]);
   auto p=canonical(string(pin[@"path"]));if(p!=string(paths[i]))refuse("AUTH_RUNTIME_IMAGE_PATH_RELATION");auto digest=string(pin[@"sha256"]);auto n=size(pin[@"bytes"],i==0?16384:i==1?1048576:16777216);if(!hex(digest))refuse("AUTH_RUNTIME_IMAGE_SHA256");
   if(i==0&&(n!=3401||digest!="04d8bd31b1ab26f9902e67bed062e718c4507242210ea142d7c76e2385e7edb4"))refuse("AUTH_RUNTIME_IMAGE_LOADER_CODEPIN");
   s.ancestors(p);s.hold(p,false,n,digest);
   if(i==2){s.view.imagePath=p;s.view.imageSHA256=digest;s.view.imageBytes=n;auto&h=s.held.back();s.view.imageDevice=h.identity.st_dev;s.view.imageInode=h.identity.st_ino;}
   if(i==3){s.view.privateModulePath=p;s.view.privateModuleURI=string(pin[@"uri"]);if(![pin[@"uri"]isEqual:[NSURL fileURLWithPath:pin[@"path"]].absoluteString])refuse("AUTH_RUNTIME_IMAGE_MODULE_URI");}
  }
  s.current();
 }@catch(NSException*){refuse("AUTH_RUNTIME_IMAGE_OBJC_EXCEPTION");}}
 catch(const std::exception&e){s.fail(e.what());if(error)*error=[NSError errorWithDomain:@"YNXOriginalRuntimeImage" code:1 userInfo:@{NSLocalizedDescriptionKey:[NSString stringWithUTF8String:s.firstCause.c_str()]}];}
 catch(...){s.fail("AUTH_RUNTIME_IMAGE_CPP_EXCEPTION");if(error)*error=[NSError errorWithDomain:@"YNXOriginalRuntimeImage" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_RUNTIME_IMAGE_CPP_EXCEPTION"}];}
}
OriginalRuntimeImageReadLeaseV1::~OriginalRuntimeImageReadLeaseV1(){close();}
void OriginalRuntimeImageReadLeaseV1::assertCurrent(){auto&s=*state_;std::lock_guard<std::recursive_mutex>l(s.mutex);try{@try{s.current();}@catch(NSException*){refuse("AUTH_RUNTIME_IMAGE_OBJC_CURRENT_EXCEPTION");}}catch(const std::exception&e){s.fail(e.what());throw;}catch(...){s.fail("AUTH_RUNTIME_IMAGE_CURRENT_EXCEPTION");throw;}}
const OriginalRuntimeImageViewV1&OriginalRuntimeImageReadLeaseV1::readOriginalRuntimeImageView(){assertCurrent();return state_->view;}
void OriginalRuntimeImageReadLeaseV1::retire()noexcept{auto&s=*state_;std::lock_guard<std::recursive_mutex>l(s.mutex);s.retired=true;}
bool OriginalRuntimeImageReadLeaseV1::close()noexcept{auto&s=*state_;std::lock_guard<std::recursive_mutex>l(s.mutex);s.retired=true;if(s.closeSelected)return s.closed;s.closeSelected=true;bool ok=true;for(auto i=s.held.rbegin();i!=s.held.rend();++i){i->selected=true;i->closed=::close(i->fd)==0;if(!i->closed)ok=false;}s.closed=ok;if(ok&&s.loan){[s.source releaseOriginalRuntimeImageLoan];s.loan=false;}if(!ok)s.fail("AUTH_RUNTIME_IMAGE_CLOSE_UNKNOWN");return s.closed;}
std::shared_ptr<OriginalRuntimeImageReadLeaseV1>borrowOriginalRuntimeImageReadLeaseV1(YNXAuthIdentitySourceAuthority*s,const void*a,NSError**e){return std::shared_ptr<OriginalRuntimeImageReadLeaseV1>(new OriginalRuntimeImageReadLeaseV1(s,a,e));}
}
@implementation YNXAuthIdentitySourceAuthority(RuntimeImageNativePrivateV1)
- (std::shared_ptr<ynx_auth_private::OriginalRuntimeImageReadLeaseV1>)borrowOriginalRuntimeImageReadLeaseForNativeAddress:(const void*)address error:(NSError**)error{return ynx_auth_private::borrowOriginalRuntimeImageReadLeaseV1(self,address,error);}
@end
