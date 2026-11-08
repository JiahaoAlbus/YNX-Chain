#if defined(YNX_ANDROID_CODE_IMAGE_PUBLIC_CONTROLS) && !defined(YNX_CODE_IMAGE_TEST_LIBRARY)
#error "PUBLIC filesystem controls are restricted to the explicit host test library"
#endif
#include "AndroidCodeImageRootPrivate.h"
#include "AndroidCodeImageReviewedPrivate.hpp"
#include <MobileCanonicalDATA.hpp>
#include <OriginalSHA256.hpp>
#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <fcntl.h>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <thread>
#include <unordered_map>
#include <unistd.h>
#include <vector>
#ifdef __APPLE__
#include <libproc.h>
#include <mach/vm_prot.h>
#include <sys/proc_info.h>
#else
#include <sys/sysmacros.h>
#endif

namespace {
namespace data=ynx::auth::mobile::qualified::data;
namespace sha=ynx::auth::android_capture;
using F=ynx_native_android_code_image_failure_v1;
using D=ynx_native_android_code_image_drain_v1;
constexpr uint32_t origin=0x4e43494d;
enum Code:int32_t{NotSupplied=1,Shape,Identity,Content,IO,WrongActor,Retired,Debt,Limit};
F failure(Code c,int e=0){return{1,int32_t(c),origin,e};}
void remember(F&first,F f){if(f.present&&!first.present)first=f;}
struct Actor{
 const pid_t pid=getpid();const uid_t uid=geteuid();const gid_t gid=getegid();
 const std::thread::id thread=std::this_thread::get_id();
 bool same()const noexcept{return pid==getpid()&&thread==std::this_thread::get_id()&&uid==geteuid()&&gid==getegid();}
};
bool sameDirectory(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode;}
bool sameFile(const struct stat&a,const struct stat&b){
 bool s=sameDirectory(a,b)&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size;
#ifdef __APPLE__
 return s&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
 return s&&a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
std::vector<std::string>parts(const std::string&p){
 if(p.empty()||p.size()>4096||p[0]!='/'||p.back()=='/')throw failure(Shape);
 std::vector<std::string>out;size_t at=1;
 while(at<p.size()){auto end=p.find('/',at);auto v=p.substr(at,end==std::string::npos?end:end-at);
  if(v.empty()||v=="."||v==".."||v.find('\\')!=std::string::npos||std::any_of(v.begin(),v.end(),[](unsigned char c){return c<32||c==127;}))throw failure(Shape);
  out.push_back(v);if(end==std::string::npos)break;at=end+1;
 }return out;
}
uint32_t u32(const data::Value&v){auto n=v.number();if(n>UINT32_MAX)throw failure(Shape);return uint32_t(n);}
struct Pin{std::string path,hash;uint64_t bytes=0;uint32_t uid=0,gid=0,mode=0;};
Pin readPin(const data::Value&v,uint64_t cap){v.keys({"path","bytes","sha256","uid","gid","mode"});Pin p{v.at("path").text(),v.at("sha256").text(),v.at("bytes").number(),u32(v.at("uid")),u32(v.at("gid")),u32(v.at("mode"))};parts(p.path);if(!p.bytes||p.bytes>cap||!data::hex(p.hash)||p.mode>07777||(p.mode&0022))throw failure(Shape);return p;}
#ifdef YNX_ANDROID_CODE_IMAGE_PUBLIC_CONTROLS
extern "C" int ynx_android_code_image_PUBLIC_close(int);
int closeFD(int fd){return ynx_android_code_image_PUBLIC_close(fd);}
uint32_t rootUID(){return uint32_t(geteuid());}
#else
int closeFD(int fd){return ::close(fd);}
uint32_t rootUID(){return 0;}
#endif
struct FD{
 int fd=-1;struct stat identity{};bool identified=false,selected=false,done=false;F closeFailure{};
 bool close()noexcept{if(done)return true;if(selected)return false;selected=true;if(fd<0){done=true;return true;}
  struct stat s{};if(identified){if(fstat(fd,&s)){closeFailure=failure(IO,errno);return false;}if(s.st_dev!=identity.st_dev||s.st_ino!=identity.st_ino){closeFailure=failure(Identity);return false;}}
  if(closeFD(fd)){closeFailure=failure(IO,errno);return false;}fd=-1;done=true;return true;
 }
};
struct File{
 std::vector<FD>ancestors;FD held;std::vector<std::string>names;std::string path;std::vector<uint8_t>raw;
 uint64_t expectedBytes=0;bool captureRaw=false,closed=false;F closeFailure{};
 void checkDirectory(const struct stat&s,uint32_t uid,uint32_t gid,bool registration){
  if(!S_ISDIR(s.st_mode)||(s.st_mode&0002)||(s.st_uid!=0&&s.st_uid!=uid))throw failure(Identity);
  if(registration){if(s.st_mode&0020)throw failure(Identity);}else if((s.st_mode&0020)&&s.st_gid!=0&&s.st_gid!=gid)throw failure(Identity);
 }
 void open(const Pin&p,bool registration,bool capture){
  path=p.path;names=parts(path);expectedBytes=p.bytes;captureRaw=capture;
  ancestors.emplace_back();auto&root=ancestors.back();root.fd=::open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(root.fd<0||fstat(root.fd,&root.identity))throw failure(IO,errno);root.identified=true;checkDirectory(root.identity,p.uid,p.gid,registration);
  for(size_t i=0;i+1<names.size();++i){int parent=ancestors.back().fd;ancestors.emplace_back();auto&next=ancestors.back();next.fd=openat(parent,names[i].c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(next.fd<0)throw failure(IO,errno);if(fstat(next.fd,&next.identity))throw failure(IO,errno);next.identified=true;checkDirectory(next.identity,p.uid,p.gid,registration);}
  if(registration&&ancestors.back().identity.st_uid!=rootUID())throw failure(Identity);
  held.fd=openat(ancestors.back().fd,names.back().c_str(),O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(held.fd<0)throw failure(IO,errno);
  if(fstat(held.fd,&held.identity))throw failure(IO,errno);held.identified=true;auto&s=held.identity;
  if(!S_ISREG(s.st_mode)||s.st_nlink!=1||s.st_uid!=p.uid||s.st_gid!=p.gid||(s.st_mode&07777)!=p.mode||s.st_size<1||(p.bytes&&uint64_t(s.st_size)!=p.bytes))throw failure(Identity);
  const uint64_t cap=registration?65536u:(capture?16777216u:268435456u);if(uint64_t(s.st_size)>cap)throw failure(Shape);
  if(!expectedBytes)expectedBytes=uint64_t(s.st_size);
  check();sha::OriginalSHA256Stream hash;std::array<unsigned char,65536>b{};uint64_t at=0;
  if(captureRaw)raw.reserve(size_t(expectedBytes));
  while(at<expectedBytes){auto want=size_t(std::min<uint64_t>(b.size(),expectedBytes-at));auto n=pread(held.fd,b.data(),want,off_t(at));if(n<0&&errno==EINTR)continue;if(n<=0)throw failure(IO,errno);hash.update(b.data(),size_t(n));if(captureRaw)raw.insert(raw.end(),b.begin(),b.begin()+n);at+=uint64_t(n);}
  unsigned char extra=0;if(pread(held.fd,&extra,1,off_t(expectedBytes))!=0)throw failure(Content);
  auto digest=hash.finish();if(!p.hash.empty()&&digest!=p.hash)throw failure(Content);check();
 }
 void check(){
  if(closed||held.selected||held.fd<0||ancestors.empty())throw failure(Retired);
  auto namedCurrent=[&]{char resolved[4097];if(!realpath(path.c_str(),resolved)||path!=resolved)throw failure(Identity);
   struct stat s{},named{};if(fstat(ancestors[0].fd,&s)||!sameDirectory(s,ancestors[0].identity))throw failure(Identity);
   for(size_t i=1;i<ancestors.size();++i)if(fstat(ancestors[i].fd,&s)||!sameDirectory(s,ancestors[i].identity)||fstatat(ancestors[i-1].fd,names[i-1].c_str(),&named,AT_SYMLINK_NOFOLLOW)||!sameDirectory(named,s))throw failure(Identity);
   if(fstat(held.fd,&s)||!sameFile(s,held.identity)||fstatat(ancestors.back().fd,names.back().c_str(),&named,AT_SYMLINK_NOFOLLOW)||!sameFile(s,named))throw failure(Identity);
  };
  namedCurrent();
  if(captureRaw&&!raw.empty()){std::array<uint8_t,65536>b{};size_t at=0;while(at<raw.size()){auto n=pread(held.fd,b.data(),std::min(b.size(),raw.size()-at),off_t(at));if(n<0&&errno==EINTR)continue;if(n<=0||!std::equal(b.begin(),b.begin()+n,raw.begin()+at))throw failure(Content);at+=size_t(n);}}
  namedCurrent();
 }
 bool close()noexcept{if(closed)return true;bool allDone=true;if(!held.close()){allDone=false;remember(closeFailure,held.closeFailure);}for(auto i=ancestors.rbegin();i!=ancestors.rend();++i)if(!i->close()){allDone=false;remember(closeFailure,i->closeFailure);}if(allDone){closed=true;raw.clear();}return allDone;}
};
#ifndef __APPLE__
void openProc(FD&held,const char*path){if(held.selected)throw failure(Retired);if(held.fd>=0)return;held.fd=::open(path,O_RDONLY|O_CLOEXEC);if(held.fd<0)throw failure(IO,errno);if(fstat(held.fd,&held.identity))throw failure(IO,errno);held.identified=true;}
#endif
std::string processName(FD&cmdline){
#ifdef __APPLE__
 (void)cmdline;const char*p=getprogname();if(!p||!*p)throw failure(Identity);return p;
#else
 openProc(cmdline,"/proc/self/cmdline");std::array<char,4097>b{};ssize_t n=0;do{n=pread(cmdline.fd,b.data(),b.size(),0);}while(n<0&&errno==EINTR);
 if(n<=0||n==ssize_t(b.size()))throw failure(IO,errno);auto end=std::find(b.begin(),b.begin()+n,'\0');if(end==b.begin()+n||end==b.begin())throw failure(Identity);return std::string(b.begin(),end);
#endif
}
void mapped(const File&image,FD&maps){
 const auto address=reinterpret_cast<uintptr_t>(&ynx_native_android_code_image_root_acquire_v1);Dl_info info{};
 if(!dladdr(reinterpret_cast<const void*>(address),&info)||!info.dli_fname)throw failure(Identity);
 char resolved[4097];if(!realpath(info.dli_fname,resolved)||image.path!=resolved)throw failure(Identity);
#ifdef __APPLE__
 (void)maps;proc_regionwithpathinfo region{};auto n=proc_pidinfo(getpid(),PROC_PIDREGIONPATHINFO,uint64_t(address),&region,sizeof(region));
 if(n!=sizeof(region)||uint64_t(region.prp_vip.vip_vi.vi_stat.vst_ino)!=uint64_t(image.held.identity.st_ino)||uint64_t(region.prp_vip.vip_vi.vi_stat.vst_dev)!=uint64_t(image.held.identity.st_dev)||(region.prp_prinfo.pri_protection&(VM_PROT_READ|VM_PROT_EXECUTE))!=(VM_PROT_READ|VM_PROT_EXECUTE)||(region.prp_prinfo.pri_protection&VM_PROT_WRITE))throw failure(Identity);
#else
 openProc(maps,"/proc/self/maps");std::string text;std::array<char,16384>chunk{};off_t offset=0;
 for(;;){ssize_t n=0;do{n=pread(maps.fd,chunk.data(),chunk.size(),offset);}while(n<0&&errno==EINTR);if(n<0)throw failure(IO,errno);if(!n)break;if(text.size()+size_t(n)>1048576)throw failure(Shape);text.append(chunk.data(),size_t(n));offset+=n;}
 bool found=false;size_t at=0;
 while(at<text.size()){auto endline=text.find('\n',at);auto line=text.substr(at,endline==std::string::npos?endline:endline-at);unsigned long long start=0,end=0,offsetValue=0,inode=0;unsigned int devMajor=0,devMinor=0;char permissions[5]{};
  if(sscanf(line.c_str(),"%llx-%llx %4s %llx %x:%x %llu",&start,&end,permissions,&offsetValue,&devMajor,&devMinor,&inode)==7&&address>=start&&address<end){found=permissions[0]=='r'&&permissions[1]!='w'&&permissions[2]=='x'&&inode==uint64_t(image.held.identity.st_ino)&&devMajor==major(image.held.identity.st_dev)&&devMinor==minor(image.held.identity.st_dev);break;}
  if(endline==std::string::npos)break;at=endline+1;
 }if(!found)throw failure(Identity);
#endif
}
struct Root{
 const Actor actor;F first{};bool retired=false,closed=false,initialized=false,busy=false,closeSelected=false;size_t children=0;
 File profile,image,record;FD cmdline,maps;Pin imagePin;std::string service,process;uint32_t uid=0,gid=0;
 F fail(F f){remember(first,f);retired=true;return first;}
 void current(){if(!actor.same())throw failure(WrongActor);if(first.present)throw first;if(retired||closed||!initialized)throw failure(Retired);if(processName(cmdline)!=process)throw failure(Identity);profile.check();image.check();record.check();mapped(image,maps);image.check();profile.check();}
};
struct View{const Actor actor;std::shared_ptr<Root>root;F releasedFailure{};bool released=false;explicit View(std::shared_ptr<Root>r):root(std::move(r)){};};
struct Inventory{std::mutex mutex;uintptr_t next=1;std::unordered_map<uintptr_t,std::shared_ptr<Root>>roots;std::unordered_map<uintptr_t,std::shared_ptr<View>>views;};
Inventory&inventory(){static auto*p=new Inventory;return*p;}
template<class T>std::shared_ptr<T>lookup(const void*p,const std::unordered_map<uintptr_t,std::shared_ptr<T>>&map){auto i=map.find(reinterpret_cast<uintptr_t>(p));return i==map.end()?nullptr:i->second;}
std::shared_ptr<Root>rootFor(const void*p){auto&i=inventory();std::lock_guard<std::mutex>lock(i.mutex);return lookup(p,i.roots);}
std::shared_ptr<View>viewFor(const void*p){auto&i=inventory();std::lock_guard<std::mutex>lock(i.mutex);return lookup(p,i.views);}
uintptr_t nextToken(Inventory&i){if(i.next>16384)throw failure(Limit);return i.next++;}
struct Busy{Root&r;explicit Busy(Root&v):r(v){if(r.busy)throw failure(Debt);r.busy=true;}~Busy(){r.busy=false;}};
void initialize(Root&r){
 auto actual=processName(r.cmdline);const ynx::mobilepq::android_code_image::ReviewedLocator*selected=nullptr;
 for(auto&row:ynx::mobilepq::android_code_image::originalReviewedLocators())if(row.processName==actual){if(selected)throw failure(Shape);selected=&row;}
 if(!selected)throw failure(NotSupplied);
 auto directory=selected->registrationDirectory;parts(directory+"/"+selected->registrationLeaf);if(selected->registrationLeaf.empty()||selected->registrationLeaf.find('/')!=std::string::npos)throw failure(Shape);
 std::string registration=directory+"/"+selected->registrationLeaf;
 // The path is selected by reviewed literals. File metadata is constrained to
 // Root ownership; expected JNI size/hash come ONLY from this protected file.
 struct stat named{};if(lstat(registration.c_str(),&named))throw failure(IO,errno);
 if(named.st_uid!=rootUID()||(named.st_mode&0022)||named.st_nlink!=1||!S_ISREG(named.st_mode))throw failure(Identity);
 Pin registrationPin{registration,"",0,rootUID(),uint32_t(named.st_gid),uint32_t(named.st_mode&07777)};
 r.profile.open(registrationPin,true,true);auto v=data::parseCanonical(r.profile.raw,65536);
 v.keys({"version","kind","service","processName","applicationUID","applicationGID","image","buildRecord","sourceCommit","sourceTree"});
 if(v.at("version").number()!=1||v.at("kind").text()!="YNX_ANDROID_AUTH_JNI_CODE_IMAGE_PROFILE/v1"||v.at("service").text()!="YNX_AUTH_ANDROID_DEVICE_V4"||v.at("processName").text()!=actual||!data::hex(v.at("sourceCommit").text(),40)||!data::hex(v.at("sourceTree").text(),40))throw failure(Shape);
 r.uid=u32(v.at("applicationUID"));r.gid=u32(v.at("applicationGID"));if(r.uid!=geteuid()||r.gid!=getegid())throw failure(Identity);
 r.imagePin=readPin(v.at("image"),268435456u);auto recordPin=readPin(v.at("buildRecord"),16777216u);
 if(r.imagePin.path==recordPin.path||r.imagePin.path==registration||recordPin.path==registration)throw failure(Shape);
 r.service=v.at("service").text();r.process=actual;r.image.open(r.imagePin,false,false);r.record.open(recordPin,false,true);
 if(r.image.held.identity.st_dev==r.record.held.identity.st_dev&&r.image.held.identity.st_ino==r.record.held.identity.st_ino)throw failure(Identity);
 r.initialized=true;r.current();
}
F currentRoot(const std::shared_ptr<Root>&r){if(!r)return failure(Shape);if(!r->actor.same())return failure(WrongActor);try{Busy guard(*r);r->current();return{};}catch(F f){if(f.code==Debt)return f;return r->fail(f);}catch(...){return r->fail(failure(Shape));}}
ynx_native_android_code_image_bytes_v1 span(const std::string&s){return{reinterpret_cast<const uint8_t*>(s.data()),s.size()};}
}

extern "C" ynx_native_android_code_image_acquisition_v1 ynx_native_android_code_image_root_acquire_v1(void){
 ynx_native_android_code_image_acquisition_v1 out{};std::shared_ptr<Root>r;
 try{r=std::make_shared<Root>();auto&i=inventory();{std::lock_guard<std::mutex>lock(i.mutex);if(i.roots.size()>=64)throw failure(Limit);auto token=nextToken(i);i.roots.emplace(token,r);out.owner=reinterpret_cast<ynx_native_android_code_image_root_v1*>(token);}Busy guard(*r);initialize(*r);}
 catch(F f){out.failure=r?r->fail(f):f;}catch(...){out.failure=r?r->fail(failure(Shape)):failure(Shape);}return out;
}
extern "C" F ynx_native_android_code_image_root_current_v1(ynx_native_android_code_image_root_v1*p){return currentRoot(rootFor(p));}
extern "C" ynx_native_android_code_image_view_acquisition_v1 ynx_native_android_code_image_root_view_open_v1(ynx_native_android_code_image_root_v1*p){
 ynx_native_android_code_image_view_acquisition_v1 out{};auto r=rootFor(p);if(!r){out.failure=failure(Shape);return out;}if(!r->actor.same()){out.failure=failure(WrongActor);return out;}
 try{Busy guard(*r);r->current();if(r->children>=64)throw failure(Limit);auto v=std::make_shared<View>(r);auto&i=inventory();{std::lock_guard<std::mutex>lock(i.mutex);auto token=nextToken(i);i.views.emplace(token,v);out.owner=reinterpret_cast<ynx_native_android_code_image_view_v1*>(token);}++r->children;r->current();}
 catch(F f){out.failure=(f.code==Debt||f.code==Limit)?f:r->fail(f);}catch(...){out.failure=r->fail(failure(Shape));}return out;
}
extern "C" F ynx_native_android_code_image_view_current_v1(ynx_native_android_code_image_view_v1*p){auto v=viewFor(p);if(!v)return failure(Shape);if(!v->actor.same())return failure(WrongActor);if(v->released||!v->root)return failure(Retired);return currentRoot(v->root);}
extern "C" F ynx_native_android_code_image_view_read_v1(ynx_native_android_code_image_view_v1*p,ynx_native_android_code_image_data_v1*out){
 if(!out)return failure(Shape);auto v=viewFor(p);if(!v)return failure(Shape);if(!v->actor.same())return failure(WrongActor);if(v->released||!v->root)return failure(Retired);auto&r=*v->root;
 try{Busy guard(r);r.current();if(out->version!=1||out->size!=sizeof(*out))throw failure(Shape);ynx_native_android_code_image_data_v1 candidate{};candidate.version=1;candidate.size=sizeof(candidate);candidate.application_uid=r.uid;candidate.application_gid=r.gid;candidate.image_uid=r.imagePin.uid;candidate.image_gid=r.imagePin.gid;candidate.image_mode=r.imagePin.mode;candidate.image_device=uint64_t(r.image.held.identity.st_dev);candidate.image_inode=uint64_t(r.image.held.identity.st_ino);candidate.image_bytes=r.imagePin.bytes;candidate.service=span(r.service);candidate.process_name=span(r.process);candidate.image_path=span(r.imagePin.path);candidate.image_sha256=span(r.imagePin.hash);r.current();*out=candidate;return{};}
 catch(F f){return f.code==Debt?f:r.fail(f);}catch(...){return r.fail(failure(Shape));}
}
extern "C" D ynx_native_android_code_image_view_release_v1(ynx_native_android_code_image_view_v1*p){auto v=viewFor(p);if(!v)return{failure(Shape),0,0};if(!v->actor.same())return{failure(WrongActor),0,0};if(v->released)return{v->releasedFailure,0,1};auto r=v->root;if(!r)return{failure(Debt),0,0};if(r->busy)return{failure(Debt),r->closeSelected?1u:0u,0};if(!r->children)return{failure(Debt),0,0};--r->children;v->releasedFailure=r->first;v->released=true;v->root.reset();return{v->releasedFailure,0,1};}
extern "C" void ynx_native_android_code_image_root_retire_v1(ynx_native_android_code_image_root_v1*p){auto r=rootFor(p);if(r&&r->actor.same())r->retired=true;}
extern "C" D ynx_native_android_code_image_root_close_v1(ynx_native_android_code_image_root_v1*p){auto r=rootFor(p);if(!r)return{failure(Shape),0,0};if(!r->actor.same())return{failure(WrongActor),0,0};r->retired=true;if(r->closed)return{r->first,0,1};if(r->busy||r->children)return{r->first.present?r->first:failure(Debt),r->closeSelected?1u:0u,0};
 r->closeSelected=true;Busy guard(*r);bool done=true;for(auto*f:{&r->record,&r->image,&r->profile})if(!f->close()){done=false;remember(r->first,f->closeFailure);}for(auto*f:{&r->maps,&r->cmdline})if(!f->close()){done=false;remember(r->first,f->closeFailure);}if(!done){return{r->first,1,0};}r->closed=true;return{r->first,0,1};}
extern "C" D ynx_native_android_code_image_root_release_closed_v1(ynx_native_android_code_image_root_v1**p){if(!p||!*p)return{failure(Shape),0,0};auto r=rootFor(*p);if(!r)return{failure(Shape),0,0};if(!r->actor.same())return{failure(WrongActor),0,0};if(!r->closed||r->children||r->busy)return{r->first.present?r->first:failure(Debt),r->closeSelected?1u:0u,0};auto result=r->first;auto&i=inventory();{std::lock_guard<std::mutex>lock(i.mutex);i.roots.erase(reinterpret_cast<uintptr_t>(*p));}*p=nullptr;return{result,0,1};}
