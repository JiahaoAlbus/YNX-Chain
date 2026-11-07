// PUBLIC filesystem/Native-parent controls. No real account, Source, OS43,
// approved review, Root row, credential, UI, network or signing is supplied.
#include "SelectedDirectoryInventory.h"
#include <cassert>
#include <filesystem>
#include <fcntl.h>
#include <iostream>
#include <limits>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
using namespace ynx::mobilepq::directories;
struct YNXMobilePQSelectedOriginal {
 std::shared_ptr<SelectedDirectoryInventory> inventory;
 std::thread::id actor=std::this_thread::get_id();
 int currentCalls=0,failAt=0;bool retired=false;
};
extern "C" int32_t ynx_mobile_pq_selected_original_current_v1(YNXMobilePQSelectedOriginal*s,uint32_t phase){
 if(!s||phase!=1)return invalid;if(s->actor!=std::this_thread::get_id())return wrongThread;
 ++s->currentCalls;return s->retired||s->currentCalls==s->failAt?closed:0;
}
namespace ynx::mobilepq::directories {
std::shared_ptr<SelectedDirectoryInventory> selectedDirectoryInventory(YNXMobilePQSelectedOriginal*s){return s?s->inventory:nullptr;}
}
namespace {
struct Fixture {
 std::string path;int parent=-1;std::array<int,3> fds{{-1,-1,-1}};
 std::array<NativeDirectory,3> input;
 YNXMobilePQSelectedOriginal selected;
 Fixture(){
  char pattern[]="/tmp/ynx-selected-directory-PUBLIC-XXXXXX";auto p=mkdtemp(pattern);assert(p);path=p;
  assert(!chmod(path.c_str(),0700));parent=open(path.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC);assert(parent>=0);
  for(size_t i=0;i<3;++i){auto name="role"+std::to_string(i+1);assert(!mkdirat(parent,name.c_str(),0700));
   fds[i]=openat(parent,name.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC);assert(fds[i]>=0);
   input[i]={uint32_t(i+1),"native.original.role:"+std::to_string(i+1),name,parent,fds[i]};}
 }
 ~Fixture(){if(selected.inventory){assert(!selected.inventory->childDebt());assert(!selected.inventory->close());assert(selected.inventory->isClosed());selected.inventory.reset();}for(auto fd:fds)if(fd>=0)::close(fd);if(parent>=0)::close(parent);std::filesystem::remove_all(path);}
 int32_t pin(){return SelectedDirectoryInventory::pin(&selected,input,selected.inventory);}
 int32_t borrow(YNXMobilePQSelectedDirectoryLoan*&loan,YNXMobilePQSelectedDirectoryDATA&data,uint32_t kind=1,std::string key={}){
  if(key.empty()&&kind>=1&&kind<=3)key=input[kind-1].root_locator;
  return ynx_mobile_pq_selected_original_borrow_directory_v1(&selected,kind,{reinterpret_cast<const uint8_t*>(key.data()),key.size()},&loan,&data);
 }
};
YNXMobilePQSelectedDirectoryDATA view(){return {1,sizeof(YNXMobilePQSelectedDirectoryDATA),-1,0,0,0,0};}
void drop(YNXMobilePQSelectedDirectoryLoan*t){assert(!ynx_mobile_pq_selected_directory_close_v1(t));assert(!ynx_mobile_pq_selected_directory_release_closed_v1(t));}
template<class F>void control(const char*name,F run){run();std::cout<<"PASS "<<name<<"\n";}
}
int main(){
 control("real Native pins duplicate all three existing named directories",[]{Fixture f;assert(!f.pin());for(uint32_t kind=1;kind<=3;++kind){YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d,kind));struct stat st{};assert(!fstat(f.fds[kind-1],&st));assert(d.directory_fd!=f.fds[kind-1]&&d.device==uint64_t(st.st_dev)&&d.inode==uint64_t(st.st_ino)&&d.uid==st.st_uid&&d.gid==st.st_gid);assert(fcntl(d.directory_fd,F_GETFD)&FD_CLOEXEC);drop(l);}assert(f.selected.inventory->childDebt()==0);});
 control("Auth dup survives until explicitly closed and mother FDs stay open",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));int authDup=fcntl(d.directory_fd,F_DUPFD_CLOEXEC,0);assert(authDup>=0);assert(!ynx_mobile_pq_selected_directory_current_v1(l));assert(!::close(authDup));drop(l);assert(!f.selected.inventory->close());assert(fcntl(d.directory_fd,F_GETFD)==-1);for(auto fd:f.fds)assert(fcntl(fd,F_GETFD)>=0);assert(fcntl(f.parent,F_GETFD)>=0);});
 control("unknown opaque locator never becomes a path or creates a directory",[]{Fixture f;assert(!f.pin());for(auto key:{"/data/native.original.role:1","../role1","native.original.role:2","not-supplied"}){YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(f.borrow(l,d,1,key)==invalid&&!l&&d.directory_fd==-1);}assert(std::distance(std::filesystem::directory_iterator(f.path),std::filesystem::directory_iterator{})==3);});
 control("kind is bounded and cannot select a different role by locator",[]{Fixture f;assert(!f.pin());for(auto kind:{0U,4U,UINT32_MAX}){YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(f.borrow(l,d,kind,"native.original.role:1")==invalid&&!l);}});
 control("pathname locator and non-leaf inventory names rejected before pin",[]{for(int n=0;n<4;++n){Fixture f;if(n==0)f.input[0].root_locator="/data/account";if(n==1)f.input[0].leaf="../role1";if(n==2)f.input[0].leaf=".";if(n==3)f.input[0].leaf=std::string("role1\0x",7);assert(f.pin()==invalid&&!f.selected.inventory);}});
 control("absent selected inventory never fabricates a directory",[]{Fixture f;YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(f.borrow(l,d)==notSupplied&&!l&&d.directory_fd==-1);});
 control("same directory cannot impersonate two Native roles",[]{Fixture f;f.input[1].directory_fd=f.fds[0];f.input[1].leaf=f.input[0].leaf;assert(f.pin()==changed&&f.selected.inventory);assert(!f.selected.inventory->close());});
 control("missing FD adopts partial inventory and preserves every mother FD",[]{Fixture f;f.input[1].directory_fd=std::numeric_limits<int>::max();assert(f.pin()==io&&f.selected.inventory);assert(!f.selected.inventory->close());for(auto fd:f.fds)assert(fcntl(fd,F_GETFD)>=0);});
 control("wrong named inode rejected even while both original FDs are valid",[]{Fixture f;f.input[0].directory_fd=f.fds[1];assert(f.pin()==changed&&f.selected.inventory);});
 control("Native parent 0771 is refused without an OS ancestor exception",[]{Fixture f;assert(!fchmod(f.parent,0771));assert(f.pin()==changed);assert(!fchmod(f.parent,0700));});
 control("observed 0755 and sticky-directory permission changes are refused",[]{for(auto mode:{0755,01700}){Fixture f;assert(!fchmod(f.fds[0],mode));struct stat observed{};assert(!fstat(f.fds[0],&observed)&&(observed.st_mode&07777)==mode);assert(f.pin()==changed);assert(!fchmod(f.fds[0],0700));}});
 control("symlink replacement of a named directory invalidates retained FD",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));assert(!renameat(f.parent,"role1",f.parent,"old"));assert(!symlinkat("old",f.parent,"role1"));assert(ynx_mobile_pq_selected_directory_current_v1(l)==changed);drop(l);});
 control("directory inode replacement invalidates same child",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));assert(!renameat(f.parent,"role1",f.parent,"old"));assert(!mkdirat(f.parent,"role1",0700));assert(ynx_mobile_pq_selected_directory_current_v1(l)==changed);drop(l);});
 control("other-role drift invalidates the whole selected inventory",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));assert(!fchmod(f.fds[2],0755));assert(ynx_mobile_pq_selected_directory_current_v1(l)==changed);drop(l);});
 control("restoring a changed inode name cannot revive a retired pin",[]{Fixture f;assert(!f.pin());assert(!renameat(f.parent,"role1",f.parent,"old"));assert(f.selected.inventory->current()==changed);assert(!renameat(f.parent,"old",f.parent,"role1"));assert(f.selected.inventory->current()==closed);YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(f.borrow(l,d)==closed&&!l);});
 control("selected account or epoch loss invalidates the same held child",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));f.selected.retired=true;assert(ynx_mobile_pq_selected_directory_current_v1(l)==closed);f.selected.retired=false;assert(ynx_mobile_pq_selected_directory_current_v1(l)==closed);drop(l);});
 control("late Native current failure returns an adopted child with no FD",[]{Fixture f;assert(!f.pin());f.selected.failAt=3;YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(f.borrow(l,d)==closed&&l&&d.directory_fd==-1);assert(f.selected.inventory->childDebt()==1);assert(f.selected.inventory->close()==debt&&!f.selected.inventory->isClosed());drop(l);assert(!f.selected.inventory->close()&&f.selected.inventory->isClosed());});
 control("mother close retains debt until child release rather than close",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));assert(f.selected.inventory->close()==debt);assert(fcntl(d.directory_fd,F_GETFD)>=0);assert(ynx_mobile_pq_selected_directory_release_closed_v1(l)==debt);assert(!ynx_mobile_pq_selected_directory_close_v1(l));assert(f.selected.inventory->close()==debt&&f.selected.inventory->childDebt()==1);assert(!ynx_mobile_pq_selected_directory_release_closed_v1(l));assert(!f.selected.inventory->close()&&f.selected.inventory->isClosed());});
 control("all three outstanding children independently retain mother debt",[]{Fixture f;assert(!f.pin());std::array<YNXMobilePQSelectedDirectoryLoan*,3>loans{};for(uint32_t k=1;k<=3;++k){auto d=view();assert(!f.borrow(loans[k-1],d,k));}for(size_t i=0;i<3;++i){assert(f.selected.inventory->close()==debt);drop(loans[i]);assert(f.selected.inventory->childDebt()==2-i);}assert(!f.selected.inventory->close());});
 control("retire from another thread prevents current and new borrows",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));std::thread other([&]{f.selected.inventory->retire();});other.join();assert(ynx_mobile_pq_selected_directory_current_v1(l)==closed);YNXMobilePQSelectedDirectoryLoan*next=nullptr;auto nextData=view();assert(f.borrow(next,nextData)==closed&&!next);drop(l);});
 control("foreign thread cannot use or release actual child",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));std::thread other([&]{assert(ynx_mobile_pq_selected_directory_current_v1(l)==wrongThread);assert(ynx_mobile_pq_selected_directory_close_v1(l)==wrongThread);assert(ynx_mobile_pq_selected_directory_release_closed_v1(l)==wrongThread);assert(f.selected.inventory->close()==wrongThread);});other.join();assert(!ynx_mobile_pq_selected_directory_current_v1(l));drop(l);});
 control("closed child rejects current; release is distinct and cannot ABA",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*old=nullptr;auto d=view();assert(!f.borrow(old,d));assert(!ynx_mobile_pq_selected_directory_close_v1(old));assert(!ynx_mobile_pq_selected_directory_close_v1(old));assert(ynx_mobile_pq_selected_directory_current_v1(old)==closed);assert(!ynx_mobile_pq_selected_directory_release_closed_v1(old));YNXMobilePQSelectedDirectoryLoan*next=nullptr;auto e=view();assert(!f.borrow(next,e)&&next!=old);assert(ynx_mobile_pq_selected_directory_current_v1(old)==invalid);assert(ynx_mobile_pq_selected_directory_release_closed_v1(old)==invalid);drop(next);});
 control("malformed output cannot overwrite a previously adopted child",[]{Fixture f;assert(!f.pin());YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(!f.borrow(l,d));auto original=l;assert(f.borrow(l,d)==invalid&&l==original);YNXMobilePQSelectedDirectoryLoan*next=nullptr;auto bad=view();bad.size=0;assert(f.borrow(next,bad)==invalid&&!next);drop(l);});
 control("another selected mother cannot loan the first mother's inventory",[]{Fixture f,other;assert(!f.pin());other.selected.inventory=f.selected.inventory;YNXMobilePQSelectedDirectoryLoan*l=nullptr;auto d=view();assert(other.borrow(l,d)==notSupplied&&!l&&d.directory_fd==-1);other.selected.inventory.reset();});
 std::cout<<"24 PUBLIC FD-pin/Native-parent controls passed; no genuine SelectedOriginal, Root or mobile app lifecycle is claimed\n";
}
