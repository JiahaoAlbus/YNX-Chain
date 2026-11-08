#ifndef YNX_ANDROID_CODE_IMAGE_PUBLIC_CONTROLS
#error "PUBLIC CODE-image boundary fixture only"
#endif
#include "../native/android-code-image-root/AndroidCodeImageRootPrivate.h"
#include <atomic>
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <fcntl.h>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>
#ifdef YNX_CODE_IMAGE_TEST_LIBRARY
namespace {int calls=0,failAt=0,imageAttempts=0;std::string failingImage;bool imageFailed=false;ynx_native_android_code_image_root_v1*reentrant=nullptr;bool rejected=false;}
extern "C" int ynx_android_code_image_PUBLIC_close(int fd){++calls;if(reentrant){auto*p=reentrant;reentrant=nullptr;auto d=ynx_native_android_code_image_root_close_v1(p);rejected=d.unknown==1&&d.physical_done==0;}if(failAt&&calls==failAt){errno=0;return -1;}
 if(!failingImage.empty()){char path[4097]{};if(fcntl(fd,F_GETPATH,path)==0&&failingImage==path){++imageAttempts;if(!imageFailed){imageFailed=true;errno=0;return -1;}}}auto result=::close(fd);if(imageFailed)errno=ENOMEM;return result;}
extern "C" void public_fail_image_close(const char*path){calls=0;failingImage=path;imageFailed=false;imageAttempts=0;}
extern "C" int public_image_close_attempts(){return imageAttempts;}
extern "C" void public_close_failure(int at){calls=0;failAt=at;}
extern "C" int public_close_calls(){return calls;}
extern "C" void public_reentrant_close(ynx_native_android_code_image_root_v1*p){reentrant=p;rejected=false;}
extern "C" bool public_reentrant_rejected(){return rejected;}
#else
#define CHECK(v) do{if(!(v)){std::fprintf(stderr,"CHECK line %d: %s\n",__LINE__,#v);return 1;}}while(false)
namespace {
template<class T>T symbol(void*h,const char*name){auto*p=dlsym(h,name);if(!p){std::fprintf(stderr,"symbol %s missing\n",name);std::exit(2);}return reinterpret_cast<T>(p);}
std::string text(ynx_native_android_code_image_bytes_v1 s){return std::string(reinterpret_cast<const char*>(s.bytes),s.length);}
bool append(const char*p){int fd=::open(p,O_WRONLY|O_APPEND|O_CLOEXEC);if(fd<0)return false;char c='x';bool ok=write(fd,&c,1)==1;return ::close(fd)==0&&ok;}
}
int main(int argc,char**argv){
 if(argc!=5)return 2;std::string mode=argv[1];void*h=dlopen(argv[2],RTLD_NOW|RTLD_LOCAL);if(!h){std::fprintf(stderr,"dlopen:%s\n",dlerror());return 2;}
 auto acquire=symbol<decltype(&ynx_native_android_code_image_root_acquire_v1)>(h,"ynx_native_android_code_image_root_acquire_v1");
 auto current=symbol<decltype(&ynx_native_android_code_image_root_current_v1)>(h,"ynx_native_android_code_image_root_current_v1");
 auto viewOpen=symbol<decltype(&ynx_native_android_code_image_root_view_open_v1)>(h,"ynx_native_android_code_image_root_view_open_v1");
 auto read=symbol<decltype(&ynx_native_android_code_image_view_read_v1)>(h,"ynx_native_android_code_image_view_read_v1");
 auto viewCurrent=symbol<decltype(&ynx_native_android_code_image_view_current_v1)>(h,"ynx_native_android_code_image_view_current_v1");
 auto releaseView=symbol<decltype(&ynx_native_android_code_image_view_release_v1)>(h,"ynx_native_android_code_image_view_release_v1");
 auto retire=symbol<decltype(&ynx_native_android_code_image_root_retire_v1)>(h,"ynx_native_android_code_image_root_retire_v1");
 auto close=symbol<decltype(&ynx_native_android_code_image_root_close_v1)>(h,"ynx_native_android_code_image_root_close_v1");
 auto release=symbol<decltype(&ynx_native_android_code_image_root_release_closed_v1)>(h,"ynx_native_android_code_image_root_release_closed_v1");
 auto closeFailure=symbol<void(*)(int)>(h,"public_close_failure");auto closeCalls=symbol<int(*)()>(h,"public_close_calls");
 auto reentrant=symbol<void(*)(ynx_native_android_code_image_root_v1*)>(h,"public_reentrant_close");auto reentrantRejected=symbol<bool(*)()>(h,"public_reentrant_rejected");
 auto a=acquire();CHECK(a.owner);auto*p=a.owner;
 if(mode=="refusal"||mode=="default-empty"){
  CHECK(a.failure.present==1);CHECK(current(p).present==1);auto d=close(p);CHECK(d.physical_done==1&&d.failure.present==1);auto first=d.failure;
  auto r=release(&p);CHECK(!p&&r.physical_done==1&&r.failure.present==1&&r.failure.code==first.code&&r.failure.platform_code==first.platform_code);std::puts("PASS partial refused acquisition adopted and physically released");return 0;
 }
 CHECK(a.failure.present==0);CHECK(current(p).present==0);
 if(mode=="unknown-close"||mode=="image-unknown-all-fds"){
  if(mode=="image-unknown-all-fds")symbol<void(*)(const char*)>(h,"public_fail_image_close")(argv[2]);else closeFailure(1);auto d=close(p);CHECK(d.failure.present==1&&d.failure.platform_code==0&&d.unknown==1&&!d.physical_done);auto n=closeCalls();CHECK(n>0);if(mode=="image-unknown-all-fds"){size_t expected=0;for(int j=2;j<5;++j){std::string path=argv[j];expected+=size_t(std::count(path.begin(),path.end(),'/'))+1;}CHECK(n==int(expected));CHECK(symbol<int(*)()>(h,"public_image_close_attempts")()==1);}
  auto d2=close(p);CHECK(d2.unknown&&!d2.physical_done&&d2.failure.code==d.failure.code&&closeCalls()==n);
  auto r=release(&p);CHECK(r.unknown&&!r.physical_done&&p==a.owner&&closeCalls()==n);std::puts("PASS close UNKNOWN retained once with original platform0");return 0;
 }
 if(mode=="reentrant-close"){
  reentrant(p);auto d=close(p);CHECK(d.physical_done==1&&reentrantRejected());auto r=release(&p);CHECK(r.physical_done==1&&!p);std::puts("PASS reentrant physical close rejected");return 0;
 }
 if(mode=="capacity"){
  for(int i=0;i<70;++i){auto v=viewOpen(p);CHECK(v.owner&&!v.failure.present);CHECK(releaseView(v.owner).physical_done==1);}
  std::vector<ynx_native_android_code_image_view_v1*>views;for(int i=0;i<64;++i){auto v=viewOpen(p);CHECK(v.owner&&!v.failure.present);views.push_back(v.owner);}
  auto extra=viewOpen(p);CHECK(!extra.owner&&extra.failure.present==1);auto pending=close(p);CHECK(!pending.unknown&&!pending.physical_done);
  for(auto*v:views)CHECK(releaseView(v).physical_done==1);CHECK(close(p).physical_done==1);CHECK(release(&p).physical_done==1&&!p);std::puts("PASS active64 bound and closed historical views restore capacity");return 0;
 }
 if(mode=="lookup-race"){
  std::atomic<bool>ready{false},go{false};std::atomic<unsigned>rejected{0};auto*original=p;std::thread foreign([&]{ready=true;while(!go.load())std::this_thread::yield();for(unsigned i=0;i<1000;++i)if(current(original).present==1)++rejected;});
  while(!ready.load())std::this_thread::yield();go=true;auto d=close(p);CHECK(d.physical_done==1);CHECK(release(&p).physical_done==1&&!p);foreign.join();CHECK(rejected==1000&&current(original).present==1);std::puts("PASS shared lookup retains memory across foreign actor release race");return 0;
 }
 auto v=viewOpen(p);CHECK(v.owner&&!v.failure.present);ynx_native_android_code_image_data_v1 d{};d.version=1;d.size=sizeof(d);CHECK(!read(v.owner,&d).present);
 CHECK(text(d.service)=="YNX_AUTH_ANDROID_DEVICE_V4"&&text(d.image_path)==argv[2]&&d.application_uid==geteuid()&&d.application_gid==getegid()&&d.image_bytes>0&&d.image_sha256.length==64&&d.image_inode&&d.image_device);
 if(mode=="foreign-token"){
  auto fake=reinterpret_cast<ynx_native_android_code_image_root_v1*>(uintptr_t(0x7fffffff));auto invalidView=reinterpret_cast<ynx_native_android_code_image_view_v1*>(p);auto before=d;
  CHECK(current(fake).present==1&&read(invalidView,&d).present==1&&std::memcmp(&d,&before,sizeof(d))==0);auto x=release(&fake);CHECK(!x.physical_done&&fake==reinterpret_cast<ynx_native_android_code_image_root_v1*>(uintptr_t(0x7fffffff)));CHECK(!current(p).present);
 }else if(mode=="actor"){
  std::atomic<bool>ok{true};std::thread foreign([&]{auto q=current(p);auto x=viewCurrent(v.owner);auto r=releaseView(v.owner);auto c=close(p);if(!q.present||!x.present||r.physical_done||c.physical_done)ok=false;});foreign.join();CHECK(ok.load());
  auto child=fork();CHECK(child>=0);if(child==0){auto q=current(p);auto x=releaseView(v.owner);_exit(q.present&&!x.physical_done?0:4);}int status=0;CHECK(waitpid(child,&status,0)==child&&WIFEXITED(status)&&WEXITSTATUS(status)==0);
 }else if(mode=="malformed-read"){auto bad=d;bad.version=0;auto before=bad;CHECK(read(v.owner,&bad).present==1);CHECK(std::memcmp(&bad,&before,sizeof(bad))==0);}
 else if(mode=="directory-change"){std::string name=argv[3];auto at=name.find_last_of('/');CHECK(at!=std::string::npos);CHECK(chmod(name.substr(0,at).c_str(),0710)==0);CHECK(current(p).present==1);}
 else if(mode=="profile-change"){CHECK(append(argv[3]));CHECK(current(p).present==1);}
 else if(mode=="record-change"){CHECK(append(argv[4]));CHECK(current(p).present==1);}
 else if(mode=="image-change"){CHECK(append(argv[2]));CHECK(current(p).present==1);}
 else if(mode=="profile-replace"){std::string moved=std::string(argv[3])+".old";CHECK(rename(argv[3],moved.c_str())==0);CHECK(link(moved.c_str(),argv[3])==0);CHECK(current(p).present==1);}
 else if(mode=="retire"){retire(p);CHECK(current(p).present==1);auto q=viewOpen(p);CHECK(!q.owner&&q.failure.present==1);}
 else if(mode!="positive"){std::fprintf(stderr,"unknown mode\n");return 2;}
 auto pending=close(p);CHECK(!pending.unknown&&!pending.physical_done);auto blocked=release(&p);CHECK(!blocked.unknown&&!blocked.physical_done&&p==a.owner);auto r=releaseView(v.owner);CHECK(r.physical_done==1);CHECK(releaseView(v.owner).physical_done==1);CHECK(viewCurrent(v.owner).present==1);
 std::atomic<bool>releasedActor{false};std::thread after([&]{releasedActor=releaseView(v.owner).physical_done==0;});after.join();CHECK(releasedActor.load());
 auto final=close(p);CHECK(final.physical_done==1&&!final.unknown);CHECK(final.failure.present==((mode=="positive"||mode=="actor"||mode=="foreign-token")?0u:1u));auto n=closeCalls();CHECK(close(p).physical_done==1&&closeCalls()==n);auto last=release(&p);CHECK(last.physical_done==1&&!p&&last.failure.present==final.failure.present&&last.failure.code==final.failure.code&&last.failure.origin==final.failure.origin&&last.failure.platform_code==final.failure.platform_code);CHECK(current(a.owner).present==1);
 std::printf("PASS %s same-root typed view and original cleanup\n",mode.c_str());return 0;
}
#endif
