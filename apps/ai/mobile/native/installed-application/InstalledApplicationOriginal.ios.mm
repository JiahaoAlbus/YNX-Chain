#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <TargetConditionals.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <atomic>
#include <algorithm>
#include <limits.h>
#include <array>
#include <thread>
#include <vector>
#include "MobileInstalledApplicationOriginalPrivate.hpp"
#include "MobileAITaskPlatformPrivate.h"

// Both functions must resolve in A's ONE selected combined image. This file
// implements only the P08 OS loan, never the SDK's application6 inventory.
extern "C" void YNXOriginalAIMobileV6RegisterBeforeReactHost(void);
namespace ynx::sdk::mobileapplication {
namespace {
constexpr int32_t unavailable=-68101, invalid=-68102, changed=-68103;
constexpr int32_t wrongActor=-68104, retired=-68105, ioFailure=-68106;
constexpr off_t fileCapacity=512LL*1024*1024;
std::string utf8(NSString *s){return s.UTF8String?std::string(s.UTF8String):std::string();}
std::string hex(const unsigned char *v,size_t n){
 static constexpr char alphabet[]="0123456789abcdef";std::string s(n*2,'0');
 for(size_t i=0;i<n;++i){s[i*2]=alphabet[v[i]>>4];s[i*2+1]=alphabet[v[i]&15];}return s;
}
bool sameFile(const struct stat&a,const struct stat&b){
 return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_size==b.st_size&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&
 a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec&&
 a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec;
}
struct HeldFile {
 int fd=-1;std::string path,observedPath,digest;struct stat captured{};
 HeldFile()=default;HeldFile(const HeldFile&)=delete;HeldFile&operator=(const HeldFile&)=delete;
 HeldFile(HeldFile&&v)noexcept:fd(v.fd),path(std::move(v.path)),observedPath(std::move(v.observedPath)),digest(std::move(v.digest)),captured(v.captured){v.fd=-1;}
 ~HeldFile(){if(fd>=0)::close(fd);}
};
bool hashFD(int fd,const struct stat&before,std::string&out){
 if(!S_ISREG(before.st_mode)||before.st_size<=0||before.st_size>fileCapacity)return false;
 CC_SHA256_CTX hash;CC_SHA256_Init(&hash);std::array<unsigned char,65536>bytes;off_t offset=0;
 while(offset<before.st_size){size_t want=static_cast<size_t>(std::min<off_t>(bytes.size(),before.st_size-offset));
  ssize_t n=pread(fd,bytes.data(),want,offset);if(n<=0)return false;CC_SHA256_Update(&hash,bytes.data(),static_cast<CC_LONG>(n));offset+=n;}
 struct stat after{};if(fstat(fd,&after)||!sameFile(before,after))return false;
 unsigned char result[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(result,&hash);out=hex(result,sizeof(result));return true;
}
bool hold(const std::string&path,HeldFile&out){
 out.path=path;out.fd=open(path.c_str(),O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 return out.fd>=0&&!fstat(out.fd,&out.captured)&&hashFD(out.fd,out.captured,out.digest);
}
bool isCurrent(const HeldFile&file){
 if(!file.observedPath.empty()){char resolved[PATH_MAX];if(!realpath(file.observedPath.c_str(),resolved)||file.path!=resolved)return false;}
 struct stat fdNow{},pathNow{};std::string digest;
 return file.fd>=0&&!fstat(file.fd,&fdNow)&&!lstat(file.path.c_str(),&pathNow)&&
 sameFile(file.captured,fdNow)&&sameFile(file.captured,pathNow)&&hashFD(file.fd,fdNow,digest)&&digest==file.digest;
}
bool inside(const std::string&bundle,const std::string&path){return path.size()>bundle.size()+1&&path.compare(0,bundle.size()+1,bundle+"/")==0;}
std::string resolvePath(NSString*path){char resolved[PATH_MAX];return realpath(path.fileSystemRepresentation,resolved)?std::string(resolved):std::string();}
std::string identityDigest(const std::vector<std::string>&parts){
 // PRIVATE P08 installed identity v1: exact UTF-8 domain, then unsigned big
 // endian u64 length + bytes per field. No manifest stores this derived hash.
 CC_SHA256_CTX hash;CC_SHA256_Init(&hash);
 constexpr char domain[]="YNX_AI_IOS_INSTALLED_IDENTITY_V1";CC_SHA256_Update(&hash,domain,sizeof(domain)-1);
 for(const auto&part:parts){unsigned char length[8];uint64_t n=part.size();for(size_t i=0;i<8;++i)length[7-i]=static_cast<unsigned char>(n>>(i*8));
  CC_SHA256_Update(&hash,length,8);CC_SHA256_Update(&hash,part.data(),static_cast<CC_LONG>(part.size()));}
 unsigned char result[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(result,&hash);return hex(result,sizeof(result));
}
}
struct InstalledApplicationOriginal::Storage {
 std::thread::id actor=std::this_thread::get_id();std::atomic<bool>retired{false};
 bool closed=false,closeUncertain=false;Failure first{},closeFailure{};Capture capture;std::string bundle;std::vector<HeldFile>files;
 Failure fail(int32_t code){if(!first.present)first={true,code};return first;}
 Failure check(){
  if(actor!=std::this_thread::get_id())return {true,wrongActor};
  if(first.present)return first;if(retired||closed)return {true,::ynx::sdk::mobileapplication::retired};
  @autoreleasepool {
   if(resolvePath(NSBundle.mainBundle.bundleURL.path)!=bundle||utf8(NSBundle.mainBundle.bundleIdentifier)!=capture.applicationId)return fail(changed);
   for(const auto&file:files)if(!isCurrent(file))return fail(changed);
  }return {};
 }
};
InstalledApplicationOriginal::InstalledApplicationOriginal():storage_(new Storage){}
InstalledApplicationOriginal::~InstalledApplicationOriginal()=default;
Failure InstalledApplicationOriginal::acquire(std::unique_ptr<InstalledApplicationOriginal>&out)noexcept {
 if(out)return {true,invalid};
 try {
  out=std::unique_ptr<InstalledApplicationOriginal>(new InstalledApplicationOriginal);auto&s=*out->storage_;
#if !TARGET_OS_IOS || TARGET_OS_MACCATALYST
  return s.fail(unavailable);
#else
  @autoreleasepool {
   NSBundle*bundle=NSBundle.mainBundle;s.bundle=resolvePath(bundle.bundleURL.path);
   s.capture.platform="ios";s.capture.applicationId=utf8(bundle.bundleIdentifier);
   if(s.bundle.empty()||s.capture.applicationId!="com.ynxweb4.ai")return s.fail(unavailable);
   NSArray<NSString*>*paths=@[[bundle.bundlePath stringByAppendingPathComponent:@"Info.plist"],bundle.executablePath?:@"",
    [bundle.bundlePath stringByAppendingPathComponent:@"_CodeSignature/CodeResources"],
    [bundle.bundlePath stringByAppendingPathComponent:@"YNXAIInstalledModuleManifest.v6.json"]];
   for(NSString*path in paths){s.files.emplace_back();auto&f=s.files.back();const auto resolved=resolvePath(path);
    f.observedPath=utf8(path);if(!inside(s.bundle,resolved)||!hold(resolved,f))return s.fail(unavailable);}
   auto&manifest=s.files[3];if(manifest.captured.st_size>65536)return s.fail(invalid);
   NSMutableData*bytes=[NSMutableData dataWithLength:static_cast<NSUInteger>(manifest.captured.st_size)];
   if(pread(manifest.fd,bytes.mutableBytes,bytes.length,0)!=static_cast<ssize_t>(bytes.length))return s.fail(ioFailure);
   NSError*error=nil;id value=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:&error];
   if(error||![value isKindOfClass:NSDictionary.class])return s.fail(invalid);NSDictionary*m=value;
   if(m.count!=4||![m[@"version"] isEqual:@"6"]||![m[@"applicationId"] isEqual:@"com.ynxweb4.ai"])return s.fail(invalid);
   const void*symbols[]={reinterpret_cast<const void*>(&ynx_ai_mobile_application_acquire_v6),reinterpret_cast<const void*>(&YNXOriginalAIMobileV6RegisterBeforeReactHost)};
   NSArray<NSString*>*roles=@[@"implementingImage",@"privateModule"];
   for(size_t i=0;i<2;++i){NSDictionary*role=m[roles[i]];
    if(![role isKindOfClass:NSDictionary.class]||role.count!=1||![role[@"relativePath"] isKindOfClass:NSString.class])return s.fail(invalid);
    NSString*relative=role[@"relativePath"];if(relative.isAbsolutePath||[relative.pathComponents containsObject:@".."]||[relative.pathComponents containsObject:@"."])return s.fail(invalid);
    const auto expected=resolvePath([bundle.bundlePath stringByAppendingPathComponent:relative]);Dl_info image{};
    if(expected.empty()||!inside(s.bundle,expected)||!dladdr(symbols[i],&image)||!image.dli_fname)return s.fail(unavailable);
    const auto loaded=resolvePath([NSString stringWithUTF8String:image.dli_fname]);if(expected!=loaded)return s.fail(changed);
    s.files.emplace_back();auto&f=s.files.back();f.observedPath=utf8([bundle.bundlePath stringByAppendingPathComponent:relative]);if(!hold(expected,f))return s.fail(unavailable);
   }
   // A single combined native image, not independent providers/archives.
   if(s.files[4].path!=s.files[5].path)return s.fail(invalid);
   s.capture.manifestDigest=s.files[3].digest;s.capture.implementingImageDigest=s.files[4].digest;s.capture.privateModuleDigest=s.files[5].digest;
   s.capture.installedAppIdentityDigest=identityDigest({s.capture.platform,s.capture.applicationId,s.files[0].digest,s.files[1].digest,s.files[2].digest,s.files[3].digest,s.files[4].digest,s.files[5].digest});
   return s.check();
  }
#endif
 }catch(...){if(out)return out->storage_->fail(ioFailure);return {true,ioFailure};}
}
Failure InstalledApplicationOriginal::readCaptured(Capture&out)noexcept {
 try{auto e=storage_->check();if(e.present)return e;out=storage_->capture;return storage_->check();}catch(...){return storage_->fail(ioFailure);}
}
Failure InstalledApplicationOriginal::current()noexcept {try{return storage_->check();}catch(...){return storage_->fail(ioFailure);}}
void InstalledApplicationOriginal::retire()noexcept {storage_->retired=true;}
Failure InstalledApplicationOriginal::close(bool&physicalDone)noexcept {
 physicalDone=false;auto&s=*storage_;if(s.actor!=std::this_thread::get_id())return {true,wrongActor};
 s.retired=true;if(s.closeUncertain)return s.closeFailure;if(s.closed){physicalDone=true;return {};}
 Failure closeFailure{};for(auto&file:s.files)if(file.fd>=0){int fd=file.fd;file.fd=-1;if(::close(fd)&&!closeFailure.present)closeFailure={true,ioFailure};}
 // Failed close is terminal debt; never retry an FD which may have been reused.
 if(closeFailure.present){s.closeUncertain=true;s.closeFailure=closeFailure;s.fail(closeFailure.code);return closeFailure;}
 s.closed=true;physicalDone=true;return {};
}
}
