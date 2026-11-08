#include "SourceParentOriginalProfilePrivate.hpp"
#include "SourceParentReviewedProfilePrivate.hpp"
#include "MobileCanonicalDATA.hpp"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstring>
#include <thread>
#include <algorithm>
#include <limits>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#include <dlfcn.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif
namespace ynx::auth::sourceparent {
namespace {
namespace d=ynx::auth::mobile::qualified::data;
#ifdef YNX_SOURCEPARENT_PUBLIC_FS
extern "C" int ynx_sourceparent_PUBLIC_close(int);
int dropFD(int fd){return ynx_sourceparent_PUBLIC_close(fd);}
uint32_t registrationUID(){return uint32_t(geteuid());}
#else
int dropFD(int fd){return ::close(fd);}
uint32_t registrationUID(){return 0;}
#endif
ProfileFailure failure(ProfileCode c,int e=0){return{true,int32_t(c),e};}
std::string hexBytes(const uint8_t*p,size_t n){static const char h[]="0123456789abcdef";std::string out;out.reserve(n*2);for(size_t i=0;i<n;++i){out+=h[p[i]>>4];out+=h[p[i]&15];}return out;}
bool stamp(const struct stat&a,const struct stat&b){bool same=a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size;
#ifdef __APPLE__
 return same&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
 return same&&a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
bool directoryStamp(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode;}
bool safePart(const std::string&s){return !s.empty()&&s!="."&&s!=".."&&s.find_first_of("/\\\0") ==std::string::npos&&std::none_of(s.begin(),s.end(),[](unsigned char c){return c<32||c==127;});}
std::vector<std::string>parts(const std::string&s,bool absolute){if(s.empty()||s.size()>4096||(s.front()=='/')!=absolute)throw failure(ProfileCode::Path);std::vector<std::string>p;size_t at=absolute?1:0;while(at<s.size()){auto end=s.find('/',at);auto part=s.substr(at,end==std::string::npos?s.size()-at:end-at);if(!safePart(part))throw failure(ProfileCode::Path);p.push_back(part);if(end==std::string::npos)break;at=end+1;if(at==s.size())throw failure(ProfileCode::Path);}if(p.empty())throw failure(ProfileCode::Path);return p;}
struct SHA {
#ifdef __APPLE__
 CC_SHA256_CTX value{};SHA(){CC_SHA256_Init(&value);}void add(const uint8_t*p,size_t n){CC_SHA256_Update(&value,p,CC_LONG(n));}std::array<uint8_t,32>finish(){std::array<uint8_t,32>o{};CC_SHA256_Final(o.data(),&value);return o;}
#else
 SHA256_CTX value{};SHA(){SHA256_Init(&value);}void add(const uint8_t*p,size_t n){SHA256_Update(&value,p,n);}std::array<uint8_t,32>finish(){std::array<uint8_t,32>o{};SHA256_Final(o.data(),&value);return o;}
#endif
};
} // namespace
// Implementation-only field types need named linkage for Impl under GCC.
// They stay in this translation unit; no header or caller ABI is exposed.
namespace profile_detail {
struct FD {int fd=-1;bool closeSelected=false,closed=false;struct stat original{};bool identity=false;
 bool close(){if(fd<0){closed=true;return true;}if(closeSelected)return closed;closeSelected=true;struct stat now{};if(identity&&(fstat(fd,&now)||!directoryStamp(original,now)))return false;if(dropFD(fd))return false;fd=-1;closed=true;return true;}
};
struct Directory {std::string path;uint32_t uid=0;std::vector<FD>held;bool closed=false;
 ProfileFailure open(const std::string&p,uint32_t owner){path=p;uid=owner;auto components=parts(p,true);held.emplace_back();held.back().fd=::open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(held.back().fd<0)return failure(ProfileCode::IO,errno);if(fstat(held.back().fd,&held.back().original))return failure(ProfileCode::IO,errno);held.back().identity=true;
  for(auto&part:components){held.emplace_back();auto&f=held.back();f.fd=openat(held[held.size()-2].fd,part.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(f.fd<0)return failure(ProfileCode::Path,errno);if(fstat(f.fd,&f.original))return failure(ProfileCode::IO,errno);f.identity=true;if(!S_ISDIR(f.original.st_mode)||(f.original.st_mode&0022)||(f.original.st_uid!=0&&f.original.st_uid!=owner))return failure(ProfileCode::Identity);}
  if(held.back().original.st_uid!=owner){return failure(ProfileCode::Identity);}
  return current();
 }
 ProfileFailure current()const {if(closed||held.empty())return failure(ProfileCode::Retired);auto components=parts(path,true);struct stat old{},now{};if(fstat(held[0].fd,&now)||!directoryStamp(now,held[0].original))return failure(ProfileCode::Identity);for(size_t i=0;i<components.size();++i){if(fstat(held[i+1].fd,&now)||!directoryStamp(now,held[i+1].original)||fstatat(held[i].fd,components[i].c_str(),&old,AT_SYMLINK_NOFOLLOW)||!directoryStamp(old,now))return failure(ProfileCode::Identity);}return{};}
 bool close(){for(auto i=held.rbegin();i!=held.rend();++i)if(!i->close())return false;closed=true;return true;}
 int descriptor()const{return held.empty()?-1:held.back().fd;}
};
struct File {Directory parent;FD file;std::string leaf;uint64_t bytes=0;std::array<uint8_t,32>digest{};std::vector<uint8_t>raw;bool captured=false;
 ProfileFailure open(const std::string&dir,const std::string&name,uint32_t uid,uint64_t cap,const std::string&expected,uint64_t expectedBytes,bool captureRaw,bool executable){leaf=name;if(!safePart(name))return failure(ProfileCode::Path);if(auto f=parent.open(dir,uid);f.present)return f;file.fd=openat(parent.descriptor(),name.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);if(file.fd<0)return failure(ProfileCode::IO,errno);if(fstat(file.fd,&file.original))return failure(ProfileCode::IO,errno);file.identity=true;auto&s=file.original;if(!S_ISREG(s.st_mode)||s.st_uid!=uid||(s.st_mode&0022)||s.st_nlink!=1||s.st_size<1||uint64_t(s.st_size)>cap||(expectedBytes&&uint64_t(s.st_size)!=expectedBytes)||(executable&&!(s.st_mode&0111)))return failure(ProfileCode::Identity);bytes=uint64_t(s.st_size);auto f=hash(captureRaw);if(f.present)return f;if(!expected.empty()&&hexBytes(digest.data(),digest.size())!=expected)return failure(ProfileCode::Content);captured=true;return current();}
 ProfileFailure hash(bool captureRaw){SHA h;std::array<uint8_t,65536>b{};std::vector<uint8_t>copy;if(captureRaw)copy.reserve(size_t(bytes));uint64_t at=0;while(at<bytes){size_t want=size_t(std::min<uint64_t>(b.size(),bytes-at));ssize_t n=pread(file.fd,b.data(),want,off_t(at));if(n<0&&errno==EINTR)continue;if(n<=0)return failure(ProfileCode::IO,errno);h.add(b.data(),size_t(n));if(captureRaw)copy.insert(copy.end(),b.begin(),b.begin()+n);at+=uint64_t(n);}uint8_t extra;if(pread(file.fd,&extra,1,off_t(bytes))!=0)return failure(ProfileCode::Content);digest=h.finish();if(captureRaw)raw=std::move(copy);return{};}
 ProfileFailure current(){if(auto f=parent.current();f.present)return f;struct stat now{},named{};if(file.fd<0||fstat(file.fd,&now)||!stamp(file.original,now)||fstatat(parent.descriptor(),leaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!stamp(now,named))return failure(ProfileCode::Identity);auto before=digest;auto f=hash(false);if(f.present)return f;if(captured&&before!=digest)return failure(ProfileCode::Content);if(fstat(file.fd,&now)||!stamp(file.original,now)||fstatat(parent.descriptor(),leaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!stamp(now,named))return failure(ProfileCode::Identity);return parent.current();}
 bool close(){if(!file.close())return false;return parent.close();}
};
} // namespace profile_detail
namespace {
struct Pin{std::string path,hash;uint64_t bytes=0;};
Pin pin(const d::Value&v){v.keys({"path","bytes","sha256"});Pin p{v.at("path").text(),v.at("sha256").text(),v.at("bytes").number()};parts(p.path,false);if(!d::hex(p.hash)||!p.bytes)return{};return p;}
std::pair<std::string,std::string>location(const std::string&root,const std::string&relative){auto p=parts(relative,false);std::string dir=root;for(size_t i=0;i+1<p.size();++i)dir+="/"+p[i];return{dir,p.back()};}
bool mappedExecutableSame(const struct stat&s){
#ifdef __APPLE__
 Dl_info info{};if(!dladdr((const void*)&acquireOriginalSourceParentNativeProfile,&info)||info.dli_fbase!=(const void*)_dyld_get_image_header(0))return false;
 proc_regionwithpathinfo region{};int n=proc_pidinfo(getpid(),PROC_PIDREGIONPATHINFO,uint64_t(uintptr_t(info.dli_fbase)),&region,sizeof(region));return n==sizeof(region)&&uint64_t(region.prp_vip.vip_vi.vi_stat.vst_ino)==uint64_t(s.st_ino)&&uint64_t(region.prp_vip.vip_vi.vi_stat.vst_dev)==uint64_t(s.st_dev);
#else
 struct stat mapped{};return !stat("/proc/self/exe",&mapped)&&mapped.st_dev==s.st_dev&&mapped.st_ino==s.st_ino;
#endif
}
std::string executablePath(){
#ifdef __APPLE__
 uint32_t bytes=0;_NSGetExecutablePath(nullptr,&bytes);if(!bytes||bytes>8192)throw failure(ProfileCode::Role);std::vector<char>b(bytes);if(_NSGetExecutablePath(b.data(),&bytes))throw failure(ProfileCode::Role);char resolved[8192];if(!realpath(b.data(),resolved))throw failure(ProfileCode::Role);return resolved;
#else
 std::array<char,8192>b{};auto n=readlink("/proc/self/exe",b.data(),b.size()-1);if(n<=0||size_t(n)>=b.size()-1)throw failure(ProfileCode::Role);return std::string(b.data(),size_t(n));
#endif
}
}
struct OriginalSourceParentImageProfile::Impl {std::thread::id actor=std::this_thread::get_id();profile_detail::File registered,images[3],records[3],info,actual;ProfileImages result;ProfileFailure first{};bool retired=false,closed=false;size_t children=0;ProfileFailure fail(ProfileFailure f){retired=true;if(!first.present)first=f;return first;}
 ProfileFailure current(){if(actor!=std::this_thread::get_id())return failure(ProfileCode::WrongActor);if(first.present)return first;if(retired||closed)return failure(ProfileCode::Retired);if(!mappedExecutableSame(actual.file.original))return fail(failure(ProfileCode::Role));for(auto*f:{&registered,&images[0],&images[1],&images[2],&records[0],&records[1],&records[2],&info,&actual})if(auto e=f->current();e.present)return fail(e);if(!mappedExecutableSame(actual.file.original))return fail(failure(ProfileCode::Role));return{};}
};
OriginalSourceParentImageProfile::OriginalSourceParentImageProfile():impl_(new Impl){}
OriginalSourceParentImageProfile::~OriginalSourceParentImageProfile(){if(!impl_->closed)abort();}
ProfileFailure OriginalSourceParentImageProfile::current()noexcept{try{return impl_->current();}catch(ProfileFailure f){return impl_->fail(f);}catch(...){return impl_->fail(failure(ProfileCode::IO));}}
ProfileFailure OriginalSourceParentImageProfile::readOriginalImagesDATA(ProfileImages&out)noexcept{if(auto f=current();f.present)return f;auto copy=impl_->result;if(auto f=current();f.present)return f;out=copy;return{};}
ProfileFailure OriginalSourceParentImageProfile::retainChild()noexcept{if(auto f=current();f.present)return f;if(impl_->children==SIZE_MAX)return failure(ProfileCode::Pending);++impl_->children;return{};}
ProfileFailure OriginalSourceParentImageProfile::releaseChild()noexcept{if(impl_->actor!=std::this_thread::get_id())return failure(ProfileCode::WrongActor);if(!impl_->children)return failure(ProfileCode::Pending);--impl_->children;return{};}
void OriginalSourceParentImageProfile::retire()noexcept{if(impl_->actor==std::this_thread::get_id())impl_->retired=true;}
bool OriginalSourceParentImageProfile::isClosed()const noexcept{return impl_->closed;}
ProfileFailure OriginalSourceParentImageProfile::close(bool&done)noexcept{done=false;if(impl_->actor!=std::this_thread::get_id())return failure(ProfileCode::WrongActor);impl_->retired=true;if(impl_->closed){done=true;return impl_->first;}if(impl_->children)return failure(ProfileCode::Pending);bool ok=true;for(auto*f:{&impl_->actual,&impl_->info,&impl_->records[2],&impl_->records[1],&impl_->records[0],&impl_->images[2],&impl_->images[1],&impl_->images[0],&impl_->registered})if(!f->close())ok=false;if(!ok)return impl_->fail(failure(ProfileCode::Pending,errno));impl_->closed=true;done=true;return impl_->first;}
struct OriginalProfileFactory {static OriginalProfileAcquisition acquire(ProfileRole role)noexcept{OriginalProfileAcquisition out;try{const ReviewedProfileLocator*row=nullptr;for(auto&r:originalReviewedProfileLocators())if(r.imageOwnerUID==uint32_t(geteuid())){if(row){out.failure=failure(ProfileCode::Registration);return out;}row=&r;}if(!row){out.failure=failure(ProfileCode::NotSupplied);return out;}out.owner=std::shared_ptr<OriginalSourceParentImageProfile>(new OriginalSourceParentImageProfile);auto&s=*out.owner->impl_;auto reject=[&](ProfileFailure f){out.failure=s.fail(f);return out;};if(auto f=s.registered.open(row->registrationDirectory,row->registrationLeaf,registrationUID(),65536,"",0,true,false);f.present)return reject(f);
 auto v=d::parseCanonical(s.registered.raw,65536);v.keys({"version","kind","images","nativeInfo"});if(v.at("version").number()!=1||v.at("kind").text()!="YNX_SOURCE_PARENT_IMAGE_BUILD_PROFILE/v1")return reject(failure(ProfileCode::Registration));auto&is=v.at("images");is.keys({"parentCreator","coreChild","nativeChild"});const char*roles[]={"parentCreator","coreChild","nativeChild"};std::string paths[3],records[3];for(size_t i=0;i<3;++i){auto&entry=is.at(roles[i]);entry.keys({"image","sourceCommit","sourceTree","record"});if(entry.at("sourceCommit").text().size()!=40||entry.at("sourceTree").text().size()!=40||!d::hex(entry.at("sourceCommit").text(),40)||!d::hex(entry.at("sourceTree").text(),40))return reject(failure(ProfileCode::Content));auto image=pin(entry.at("image")),record=pin(entry.at("record"));if(image.path.empty()||record.path.empty()||image.bytes>uint64_t(2)*1024*1024*1024||record.bytes>16*1024*1024)return reject(failure(ProfileCode::Content));paths[i]=image.path;records[i]=record.path;if(i==0&&image.path!="Contents/Helpers/ynx-network-helper")return reject(failure(ProfileCode::Role));if(i==2&&image.path!="Contents/Helpers/YNX Network Resource Host.app/Contents/MacOS/ynx-network-resource-host")return reject(failure(ProfileCode::Role));if(i==1&&(image.path.find("proof-verify")!=std::string::npos||image.path.find(".node")!=std::string::npos||image.path.find(".dylib")!=std::string::npos))return reject(failure(ProfileCode::Role));for(size_t j=0;j<i;++j)if(paths[j]==paths[i]||records[j]==records[i])return reject(failure(ProfileCode::Role));auto a=location(row->packageDirectory,image.path),b=location(row->packageDirectory,record.path);if(auto f=s.images[i].open(a.first,a.second,row->imageOwnerUID,2ULL*1024*1024*1024,image.hash,image.bytes,false,true);f.present)return reject(f);if(auto f=s.records[i].open(b.first,b.second,row->imageOwnerUID,16*1024*1024,record.hash,record.bytes,false,false);f.present)return reject(f);}
 auto info=pin(v.at("nativeInfo"));if(info.path!="Contents/Helpers/YNX Network Resource Host.app/Contents/Info.plist")return reject(failure(ProfileCode::Role));auto where=location(row->packageDirectory,info.path);if(auto f=s.info.open(where.first,where.second,row->imageOwnerUID,1048576,info.hash,info.bytes,false,false);f.present)return reject(f);auto exe=executablePath();auto slash=exe.find_last_of('/');if(slash==std::string::npos)return reject(failure(ProfileCode::Role));size_t index=size_t(role)-1;auto expected=hexBytes(s.images[index].digest.data(),32);if(auto f=s.actual.open(exe.substr(0,slash),exe.substr(slash+1),row->imageOwnerUID,2ULL*1024*1024*1024,expected,s.images[index].bytes,false,true);f.present)return reject(f);s.result={s.images[0].digest,s.images[1].digest,s.images[2].digest};out.failure=out.owner->current();return out;
 }catch(ProfileFailure f){out.failure=out.owner?out.owner->impl_->fail(f):f;return out;}catch(...){out.failure=failure(ProfileCode::Content);if(out.owner)out.failure=out.owner->impl_->fail(out.failure);return out;}}};
OriginalProfileAcquisition acquireOriginalSourceParentParentProfile()noexcept{return OriginalProfileFactory::acquire(ProfileRole::ParentCreator);}
OriginalProfileAcquisition acquireOriginalSourceParentCoreProfile()noexcept{return OriginalProfileFactory::acquire(ProfileRole::CoreChild);}
OriginalProfileAcquisition acquireOriginalSourceParentNativeProfile()noexcept{return OriginalProfileFactory::acquire(ProfileRole::NativeChild);}
}
