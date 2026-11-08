#include "PendingReviewOwner.h"
#include "MainPendingAppDirectoryRequiredPrivate.h"
#include <AndroidDeviceRegistrationPortsPrivate.h>
#include <AndroidDevicePendingJournalPrivate.h>
#include <array>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <memory>
#include <mutex>
#include <sys/stat.h>
#include <thread>
#include <unordered_map>
#include <unistd.h>
namespace {
using F=ynx_auth_android_provision_failure_v1;
using D=ynx_auth_android_provision_drain_v1;
using Source=ynx_auth_android_pending_source_v1;
using Main=ynx_main_android_pending_appdir_hold_v1;
using Constraints=ynx_auth_android_pending_journal_constraints_v1;
using Identity=ynx_auth_android_pending_directory_identity_v1;
static_assert(sizeof(Identity)==32&&sizeof(Constraints)==104,"matching private journal ABI");
using ReviewOwner=ynx::mobilepq::android_pending::PendingReviewOwner;
constexpr uint32_t origin=0x4e504449;
constexpr char leaf[]="ynx-product-device-v4";
enum Code:int32_t{Invalid=2,Changed=3,IO=5,Actor=6,Retired=7,Internal=8,Once=9,Pending=10,Limit=11};
F error(Code c,int e=0){return{1,int32_t(c),origin,e};}
bool valid(F f){return f.present<=1&&(f.present||(!f.code&&!f.origin&&!f.platform_code));}
F checked(F f){return valid(f)?f:error(Invalid);}
void keep(F&first,F f){f=checked(f);if(f.present&&!first.present)first=f;}
struct NativeActor{
 const pid_t pid=getpid();const uid_t uid=geteuid();const gid_t gid=getegid();const std::thread::id thread=std::this_thread::get_id();
 bool same()const noexcept{return pid==getpid()&&thread==std::this_thread::get_id()&&uid==geteuid()&&gid==getegid();}
};
bool sameIdentity(const Identity&a,const Identity&b){return a.device==b.device&&a.inode==b.inode&&a.uid==b.uid&&a.gid==b.gid&&a.mode==b.mode&&a.reserved==b.reserved;}
bool tuple(const struct stat&s,const Identity&i){return S_ISDIR(s.st_mode)&&uint64_t(s.st_dev)==i.device&&uint64_t(s.st_ino)==i.inode&&s.st_uid==i.uid&&s.st_gid==i.gid&&(s.st_mode&07777)==i.mode;}
bool shape(const Constraints&v){
 if(v.version!=1||v.size!=sizeof(v)||!v.parent.device||!v.parent.inode||!v.directory.device||!v.directory.inode||v.parent.reserved||v.directory.reserved||v.parent.uid!=geteuid()||v.parent.gid!=getegid()||v.directory.uid!=geteuid()||v.directory.gid!=getegid()||v.parent.mode!=0700||v.directory.mode!=0700||(v.parent.device==v.directory.device&&v.parent.inode==v.directory.inode))return false;
 std::array<char,32>expected{};std::memcpy(expected.data(),leaf,sizeof(leaf));return !std::memcmp(v.leaf,expected.data(),expected.size());
}
bool same(const Constraints&a,const Constraints&b){return a.version==b.version&&a.size==b.size&&sameIdentity(a.parent,b.parent)&&sameIdentity(a.directory,b.directory)&&!std::memcmp(a.leaf,b.leaf,sizeof(a.leaf));}
#ifdef YNX_ANDROID_PENDING_DIRECTORY_PUBLIC_CONTROLS
extern "C" int ynx_android_pending_directory_PUBLIC_close(int);
int closeLeaf(int fd){return ynx_android_pending_directory_PUBLIC_close(fd);}
#else
int closeLeaf(int fd){return ::close(fd);}
#endif
struct Directory{
 const NativeActor actor;Source*const source;
 std::shared_ptr<ReviewOwner>review;Main*main=nullptr;
 Constraints root{};bool rootSet=false,ready=false,busy=false,borrowSelected=false,closed=false;
 std::atomic<bool>retired{false};
 int parentFD=-1,leafFD=-1;uint64_t ownLeafDevice=0,ownLeafInode=0;bool ownLeafKnown=false;bool leafSelected=false,leafDone=false,mainInFlight=false,mainUnknown=false;
 F first{},physicalFirst{},leafCloseFailure{};
 explicit Directory(Source*s):source(s){}
 F local()const{if(!actor.same())return error(Actor);if(retired.load(std::memory_order_acquire)||closed)return error(Retired);return{};}
 F foreign(F f){f=checked(f);keep(first,f);if(f.present)return f;return local();}
 F authorization(){
  auto f=local();if(f.present)return f;if(first.present)return first;if(!review)return error(Internal);
  f=review->requireIndependentApproval();if((f=foreign(f)).present)return f;
  f=local();if(f.present)return f;Constraints value{};F observed=error(Internal);
  ynx_auth_android_pending_source_copy_journal_constraints_v1(source,&value,&observed);
  f=foreign(observed);if(f.present)return f;if(!shape(value)){keep(first,error(Invalid));return first;}
  if(rootSet&&!same(root,value)){keep(first,error(Changed));return first;}root=value;rootSet=true;
  f=local();if(f.present)return f;f=review->current();return foreign(f);
 }
 F physicalForeign(){
  auto gate=local();if(gate.present)return gate;if(!main)return error(Internal);
  F f=error(Internal);ynx_main_android_pending_appdir_hold_current_v1(main,&f);
  f=checked(f);keep(first,f);keep(physicalFirst,f);if(f.present)return f;return local();
 }
 F physical(){
  auto f=local();if(f.present)return f;if(physicalFirst.present)return physicalFirst;
  if(!rootSet||parentFD<0||leafFD<0||leafSelected||!main)return error(Invalid);
  f=physicalForeign();if(f.present)return f;
  auto check=[&]()->F{struct stat p{},c{},named{};
   if(fstat(parentFD,&p)||fstat(leafFD,&c)||fstatat(parentFD,leaf,&named,AT_SYMLINK_NOFOLLOW))return error(IO,errno);
   if(!tuple(p,root.parent)||!tuple(c,root.directory)||!tuple(named,root.directory))return error(Changed);return{};
  };
  f=check();if(f.present){keep(first,f);keep(physicalFirst,f);return f;}
  f=physicalForeign();if(f.present)return f;f=check();if(f.present){keep(first,f);keep(physicalFirst,f);}return f;
 }
};
struct Inventory{std::mutex mutex;uintptr_t next=1;size_t active=0;std::unordered_map<uintptr_t,std::shared_ptr<Directory>>rows;};
Inventory&inventory(){static auto*p=new Inventory;return*p;}
std::shared_ptr<Directory>known(void*p){auto&i=inventory();std::lock_guard<std::mutex>lock(i.mutex);auto it=i.rows.find(reinterpret_cast<uintptr_t>(p));return it==i.rows.end()?nullptr:it->second;}
struct Call{Directory&d;explicit Call(Directory&v):d(v){if(d.busy)throw error(Pending);d.busy=true;}~Call(){d.busy=false;}};
void failed(Directory&d,F f){keep(d.first,f);}
void open(Directory&d){
 auto f=ReviewOwner::acquire(d.source,d.review);if((f=d.foreign(f)).present)throw f;
 f=d.authorization();if(f.present)throw f;
 f=d.local();if(f.present)throw f;F observed=error(Internal);
 ynx_main_android_pending_appdir_hold_capture_v1(d.source,&d.main,&observed); // nonnull partial adopted first
 f=d.foreign(observed);if(f.present)throw f;if(!d.main)throw error(Internal);
 f=d.authorization();if(f.present)throw f;
 f=d.local();if(f.present)throw f;observed=error(Internal);
 ynx_main_android_pending_appdir_hold_borrow_v1(d.main,&d.parentFD,&observed);
 f=d.foreign(observed);if(f.present)throw f;if(d.parentFD<0)throw error(Invalid);
 struct stat parent{};if(fstat(d.parentFD,&parent))throw error(IO,errno);if(!tuple(parent,d.root.parent))throw error(Changed);
 f=d.local();if(f.present)throw f;
 d.leafFD=openat(d.parentFD,leaf,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC); // no create/chmod/path input
 if(d.leafFD<0)throw error(IO,errno);
 // Observed identity is ONLY for safely closing this just-opened Native FD,
 // never an expected Root tuple. Authorization still compares independent root.
 struct stat opened{};if(fstat(d.leafFD,&opened))throw error(IO,errno);d.ownLeafDevice=uint64_t(opened.st_dev);d.ownLeafInode=uint64_t(opened.st_ino);d.ownLeafKnown=true;
 f=d.local();if(f.present)throw f;
 f=d.physical();if(f.present)throw f;f=d.authorization();if(f.present)throw f;
 f=d.physical();if(f.present)throw f;f=d.local();if(f.present)throw f;d.ready=true;
}
D close(Directory&d){
 if(!d.actor.same())return{error(Actor),0,0};d.retired.store(true,std::memory_order_release);if(d.review)d.review->retire();
 if(d.closed)return{d.first,0,1};if(d.busy)return{d.first,(d.leafSelected&&!d.leafDone)||d.mainInFlight||d.mainUnknown?1u:0u,0};
 Call call(d);
 if(!d.leafDone){if(d.leafSelected)return{d.first,1,0};d.leafSelected=true;
  if(d.leafFD<0)d.leafDone=true;else{struct stat s{};if(fstat(d.leafFD,&s)){d.leafCloseFailure=error(IO,errno);}else if(!d.ownLeafKnown||uint64_t(s.st_dev)!=d.ownLeafDevice||uint64_t(s.st_ino)!=d.ownLeafInode){d.leafCloseFailure=error(Changed);}else if(closeLeaf(d.leafFD)){d.leafCloseFailure=error(IO,errno);}else{d.leafFD=-1;d.leafDone=true;}keep(d.first,d.leafCloseFailure);}
 }
 if(!d.leafDone)return{d.first,1,0};
 if(d.mainUnknown)return{d.first,1,0};
 if(d.main){Main*original=d.main;D result{error(Internal),UINT32_MAX,UINT32_MAX};d.mainInFlight=true;
  try{ynx_main_android_pending_appdir_hold_close_v1(&d.main,&result);}catch(...){d.mainInFlight=false;d.mainUnknown=true;keep(d.first,error(Internal));return{d.first,1,0};}d.mainInFlight=false;keep(d.first,result.failure);
  bool validDrain=valid(result.failure)&&result.unknown<=1&&result.physical_done<=1&&!(result.unknown&&result.physical_done);
  if(!validDrain||(!d.main&&!result.physical_done)||(d.main&&result.physical_done)){if(!d.main)d.main=original;keep(d.first,error(Invalid));d.mainUnknown=true;return{d.first,1,0};}
  if(!result.physical_done){if(result.unknown)d.mainUnknown=true;return{d.first,result.unknown,0};}
 }
 d.closed=true;d.ready=false;d.parentFD=-1;d.review.reset();auto&i=inventory();{std::lock_guard<std::mutex>lock(i.mutex);if(i.active)--i.active;}return{d.first,0,1};
}
}
extern "C" void ynx_original_android_pending_directory_open_v1(Source*source,ynx_original_android_pending_directory_v1**out,F*f){
 if(!f)return;*f=error(Invalid);if(!out||*out||!source)return;std::shared_ptr<Directory>d;
 try{d=std::make_shared<Directory>(source);auto&i=inventory();{std::lock_guard<std::mutex>lock(i.mutex);if(i.active>=64||i.next>16384)throw error(Limit);auto id=i.next++;i.rows.emplace(id,d);++i.active;*out=reinterpret_cast<ynx_original_android_pending_directory_v1*>(id);}Call call(*d);open(*d);*f={};}
 catch(F e){if(d)failed(*d,e);*f=d?d->first:e;}catch(...){if(d)failed(*d,error(Internal));*f=d?d->first:error(Internal);}
}
extern "C" void ynx_original_android_pending_directory_borrow_v1(ynx_original_android_pending_directory_v1*p,int*out,F*f){
 if(!f)return;*f=error(Invalid);auto d=known(p);if(!d)return;if(!d->actor.same()){*f=error(Actor);return;}if(!out||*out!=-1)return;
 try{Call call(*d);auto gate=d->local();if(gate.present)throw gate;if(!d->ready)throw error(Invalid);if(d->borrowSelected)throw error(Once);d->borrowSelected=true;
  auto e=d->authorization();if(e.present)throw e;e=d->physical();if(e.present)throw e;e=d->authorization();if(e.present)throw e;e=d->local();if(e.present)throw e;*out=d->leafFD;*f={};
 }catch(F e){if(!d->closed&&!(e.origin==origin&&(e.code==Once||e.code==Pending)))failed(*d,e);*f=e;}catch(...){failed(*d,error(Internal));*f=d->first;}
}
extern "C" void ynx_original_android_pending_directory_current_v1(ynx_original_android_pending_directory_v1*p,F*f){
 if(!f)return;*f=error(Invalid);auto d=known(p);if(!d)return;if(!d->actor.same()){*f=error(Actor);return;}
 try{Call call(*d);*f=d->physical();if(f->present&&!d->closed)failed(*d,*f);}catch(F e){*f=e;}catch(...){failed(*d,error(Internal));*f=d->first;}
}
extern "C" void ynx_original_android_pending_directory_close_v1(ynx_original_android_pending_directory_v1**p,D*out){
 if(!out)return;*out={error(Invalid),0,0};if(!p||!*p)return;auto d=known(*p);if(!d)return;
 try{*out=close(*d);if(out->physical_done)*p=nullptr;}catch(F e){*out={e,0,0};}catch(...){failed(*d,error(Internal));*out={d->first,1,0};}
}
