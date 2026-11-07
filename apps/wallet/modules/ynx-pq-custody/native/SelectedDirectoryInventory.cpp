#include "SelectedDirectoryInventory.h"
#include <atomic>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <map>
#include <mutex>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
namespace ynx::mobilepq::directories {
namespace {
struct Pin {
 std::string locator,leaf;
 int parent=-1,directory=-1;
 struct stat parentIdentity{},identity{};
 bool supplied=false,closeUncertain=false;
};
bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid;}
bool protectedDirectory(const struct stat&s){return S_ISDIR(s.st_mode)&&(s.st_mode&07777)==0700&&s.st_uid==geteuid()&&s.st_nlink>0;}
bool locator(const std::string&s){return !s.empty()&&s.size()<=128&&s.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-")==std::string::npos;}
bool leaf(const std::string&s){return !s.empty()&&s.size()<=255&&s!="."&&s!=".."&&s.find('/')==std::string::npos&&s.find('\0')==std::string::npos;}
bool check(const Pin&p){
 struct stat parent{},held{},named{};
 return p.parent>=0&&p.directory>=0&&!p.closeUncertain&&
  !fstat(p.parent,&parent)&&protectedDirectory(parent)&&same(parent,p.parentIdentity)&&
  !fstat(p.directory,&held)&&protectedDirectory(held)&&same(held,p.identity)&&
  !fstatat(p.parent,p.leaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)&&protectedDirectory(named)&&same(named,p.identity);
}
int32_t closeFD(int&fd,bool&uncertain){
 if(fd<0)return 0;
 // Never retry an indeterminate close against a possibly reused FD. Keep the
 // pending owner/debt instead of manufacturing a closed witness.
 if(uncertain)return debt;
 if(::close(fd)){uncertain=true;return io;}
 fd=-1;return 0;
}
}
struct SelectedDirectoryInventory::Impl {
 YNXMobilePQSelectedOriginal* selected;
 const std::thread::id actor=std::this_thread::get_id();
 std::array<Pin,3> pins;
 std::atomic<bool> retired{false};
 mutable std::mutex mutex;
 size_t children=0;
 bool ready=false,closing=false,closed=false;
 int32_t cleanup=0;
 explicit Impl(YNXMobilePQSelectedOriginal*s):selected(s){}
};
SelectedDirectoryInventory::SelectedDirectoryInventory(YNXMobilePQSelectedOriginal*s):impl_(new Impl(s)){}
SelectedDirectoryInventory::~SelectedDirectoryInventory(){
 // A child holds a shared owner, so normal destruction cannot race a loan.
 // Explicit mother close/isClosed remain required for the release witness.
 for(auto&p:impl_->pins){if(!p.closeUncertain){if(p.directory>=0)::close(p.directory);if(p.parent>=0)::close(p.parent);}}
}
int32_t SelectedDirectoryInventory::pin(YNXMobilePQSelectedOriginal*s,const std::array<NativeDirectory,3>&input,std::shared_ptr<SelectedDirectoryInventory>&out){
 return pinImpl(s,input,false,out);
}
int32_t SelectedDirectoryInventory::pinRegisteredSourceOnly(YNXMobilePQSelectedOriginal*s,const NativeDirectory&source,std::shared_ptr<SelectedDirectoryInventory>&out){
 return pinImpl(s,{source,NativeDirectory{},NativeDirectory{}},true,out);
}
int32_t SelectedDirectoryInventory::pinImpl(YNXMobilePQSelectedOriginal*s,const std::array<NativeDirectory,3>&input,bool sourceOnly,std::shared_ptr<SelectedDirectoryInventory>&out){
 if(!s||out)return invalid;
 const size_t count=sourceOnly?1:3;
 for(size_t i=0;i<count;++i)if(input[i].kind!=i+1||!locator(input[i].root_locator)||!leaf(input[i].leaf)||input[i].parent_fd<0||input[i].directory_fd<0)return invalid;
 try{
  out=std::shared_ptr<SelectedDirectoryInventory>(new SelectedDirectoryInventory(s));
  for(size_t i=0;i<count;++i){
   auto&p=out->impl_->pins[i];const auto&v=input[i];p.locator=v.root_locator;p.leaf=v.leaf;
   p.supplied=true;
   p.parent=fcntl(v.parent_fd,F_DUPFD_CLOEXEC,0);if(p.parent<0){out->retire();return io;}
   p.directory=fcntl(v.directory_fd,F_DUPFD_CLOEXEC,0);if(p.directory<0){out->retire();return io;}
   if(fstat(p.parent,&p.parentIdentity)||fstat(p.directory,&p.identity)||!check(p)){out->retire();return changed;}
   // Separate roles cannot silently alias the same directory inode.
   for(size_t j=0;j<i;++j)if(same(p.identity,out->impl_->pins[j].identity)){out->retire();return changed;}
  }
  out->impl_->ready=true;return out->current();
 }catch(...){if(out)out->retire();return io;}
}
bool SelectedDirectoryInventory::belongsTo(YNXMobilePQSelectedOriginal*s)const noexcept{return s&&s==impl_->selected;}
int32_t SelectedDirectoryInventory::current(){
 if(std::this_thread::get_id()!=impl_->actor)return wrongThread;
 std::lock_guard<std::mutex>guard(impl_->mutex);
 if(!impl_->ready||impl_->retired||impl_->closing||impl_->closed)return closed;
 for(const auto&p:impl_->pins)if(p.supplied&&!check(p)){impl_->retired=true;return changed;}
 return 0;
}
void SelectedDirectoryInventory::retire()noexcept{impl_->retired=true;}
int32_t SelectedDirectoryInventory::close(){
 if(std::this_thread::get_id()!=impl_->actor)return wrongThread;
 std::lock_guard<std::mutex>guard(impl_->mutex);
 impl_->retired=true;impl_->closing=true;
 if(impl_->children)return debt;
 if(impl_->closed)return impl_->cleanup;
 bool pending=false;
 for(auto&p:impl_->pins){
  auto e=closeFD(p.directory,p.closeUncertain);if(e&&!impl_->cleanup)impl_->cleanup=e;
  e=closeFD(p.parent,p.closeUncertain);if(e&&!impl_->cleanup)impl_->cleanup=e;
  pending|=p.directory>=0||p.parent>=0;
 }
 impl_->closed=!pending;return impl_->cleanup;
}
bool SelectedDirectoryInventory::isClosed()const noexcept{std::lock_guard<std::mutex>guard(impl_->mutex);return impl_->closed;}
size_t SelectedDirectoryInventory::childDebt()const noexcept{std::lock_guard<std::mutex>guard(impl_->mutex);return impl_->children;}
int32_t SelectedDirectoryInventory::releaseChild(){
 if(std::this_thread::get_id()!=impl_->actor)return wrongThread;
 std::lock_guard<std::mutex>guard(impl_->mutex);
 if(!impl_->children)return invalid;
 --impl_->children;return 0;
}
namespace {
struct Loan {
 const std::thread::id actor=std::this_thread::get_id();
 std::shared_ptr<SelectedDirectoryInventory> inventory;
 YNXMobilePQSelectedOriginal* selected=nullptr;
 bool closed=false;
 int32_t first=0;
};
std::mutex loanMutex;
std::map<uintptr_t,std::shared_ptr<Loan>> loans;
uintptr_t nextLoan=1;
std::shared_ptr<Loan> get(YNXMobilePQSelectedDirectoryLoan*t){std::lock_guard<std::mutex>guard(loanMutex);auto i=loans.find(reinterpret_cast<uintptr_t>(t));return i==loans.end()?nullptr:i->second;}
int32_t actor(const std::shared_ptr<Loan>&l){return !l?invalid:l->actor!=std::this_thread::get_id()?wrongThread:0;}
int32_t fail(const std::shared_ptr<Loan>&l,int32_t e){if(e){if(!l->first)l->first=e;l->inventory->retire();}return e;}
int32_t loanCurrent(const std::shared_ptr<Loan>&l){
 if(auto e=actor(l))return e;
 if(l->closed)return closed;if(l->first)return l->first;
 if(auto e=ynx_mobile_pq_selected_original_current_v1(l->selected,1))return fail(l,e);
 if(auto e=l->inventory->current())return fail(l,e);
 if(auto e=ynx_mobile_pq_selected_original_current_v1(l->selected,1))return fail(l,e);
 return fail(l,l->inventory->current());
}
}
int32_t SelectedDirectoryInventory::borrow(uint32_t kind,YNXMobileSelectedPublicSpan key,YNXMobilePQSelectedDirectoryLoan**out,YNXMobilePQSelectedDirectoryDATA*view,const std::shared_ptr<SelectedDirectoryInventory>&self){
 if(!out||*out||!view||view->version!=1||view->size!=sizeof(*view)||kind<1||kind>3||!key.bytes||!key.length||key.length>128||self.get()!=this)return invalid;
 *view={1,sizeof(*view),-1,0,0,0,0};
 if(auto e=current())return e;
 auto&p=impl_->pins[kind-1];if(!p.supplied)return notSupplied;
 if(key.length!=p.locator.size()||memcmp(key.bytes,p.locator.data(),key.length))return invalid;
 try{
  auto l=std::make_shared<Loan>();l->inventory=self;l->selected=impl_->selected;
  {
   std::lock_guard<std::mutex>guard(loanMutex);
   if(loans.size()>=256||nextLoan==std::numeric_limits<uintptr_t>::max())return bounds;
   const auto token=nextLoan;loans.emplace(token,l);++nextLoan;
   {std::lock_guard<std::mutex>ownerGuard(impl_->mutex);++impl_->children;}
   *out=reinterpret_cast<YNXMobilePQSelectedDirectoryLoan*>(token);
  }
  // Child published BEFORE late checks. Even failed partials retain the
  // mother until Auth closes its dup and closes/releases this exact child.
  if(auto e=loanCurrent(l))return e;
  *view={1,sizeof(*view),p.directory,uint64_t(p.identity.st_dev),uint64_t(p.identity.st_ino),uint32_t(p.identity.st_uid),uint32_t(p.identity.st_gid)};
  return 0;
 }catch(...){retire();return io;}
}
}
using namespace ynx::mobilepq::directories;
extern "C" int32_t ynx_mobile_pq_selected_original_borrow_directory_v1(YNXMobilePQSelectedOriginal*s,uint32_t kind,YNXMobileSelectedPublicSpan key,YNXMobilePQSelectedDirectoryLoan**out,YNXMobilePQSelectedDirectoryDATA*view){
 if(!s||!out||*out||!view||view->version!=1||view->size!=sizeof(*view))return invalid;
 *view={1,sizeof(*view),-1,0,0,0,0};
 try{
  if(auto e=ynx_mobile_pq_selected_original_current_v1(s,1))return e;
  auto inventory=selectedDirectoryInventory(s);
  if(!inventory||!inventory->belongsTo(s))return notSupplied;
  return inventory->borrow(kind,key,out,view,inventory);
 }catch(...){return io;}
}
extern "C" int32_t ynx_mobile_pq_selected_directory_current_v1(YNXMobilePQSelectedDirectoryLoan*t){return loanCurrent(get(t));}
extern "C" int32_t ynx_mobile_pq_selected_directory_close_v1(YNXMobilePQSelectedDirectoryLoan*t){
 auto l=get(t);if(auto e=actor(l))return e;l->closed=true;return 0;
}
extern "C" int32_t ynx_mobile_pq_selected_directory_release_closed_v1(YNXMobilePQSelectedDirectoryLoan*t){
 auto l=get(t);if(auto e=actor(l))return e;if(!l->closed)return debt;
 if(auto e=l->inventory->releaseChild())return e;
 std::lock_guard<std::mutex>guard(loanMutex);loans.erase(reinterpret_cast<uintptr_t>(t));return 0;
}
