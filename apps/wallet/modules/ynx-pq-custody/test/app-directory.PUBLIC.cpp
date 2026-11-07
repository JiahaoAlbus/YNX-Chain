// PUBLIC OS-path seam and real temporary FS; not Android Context/iOS sandbox.
// No production path/provider setter, account, receipt, Source or UI is used.
#include "SelectedAppDirectoryPrivate.h"
#include <cassert>
#include <filesystem>
#include <fcntl.h>
#include <iostream>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
using namespace ynx::mobilepq::directories;
namespace {std::string osPath;int osCode=0,calls=0,changeAt=0;}
namespace ynx::mobilepq::directories {
int32_t platformApplicationDirectory(std::string&out)noexcept{++calls;if(osCode)return osCode;out=calls==changeAt?osPath+"-changed":osPath;return 0;}
}
namespace {
struct Fixture {
 std::string path;std::unique_ptr<NativeApplicationDirectory>owner;
 Fixture(){char pattern[]="/tmp/ynx-app-dir-PUBLIC-XXXXXX";auto p=mkdtemp(pattern);assert(p);path=p;assert(!chmod(path.c_str(),0700));osPath=path;osCode=calls=changeAt=0;}
 ~Fixture(){if(owner){assert(!owner->close());assert(owner->isClosed());owner.reset();}std::filesystem::remove_all(path);}
 int32_t acquire(){return NativeApplicationDirectory::acquire(owner);}
 int fd(){int out=-1;ApplicationDirectoryIdentity identity;assert(!owner->borrowForNativeInventory(out,identity));struct stat st{};assert(!fstat(out,&st));assert(identity.device==uint64_t(st.st_dev)&&identity.inode==uint64_t(st.st_ino)&&identity.uid==st.st_uid&&identity.gid==st.st_gid);return out;}
};
template<class F>void control(const char*n,F f){f();std::cout<<"PASS "<<n<<"\n";}
}
int main(){
 control("actual held app directory is readonly CLOEXEC and matches OS identity",[]{Fixture f;assert(!f.acquire());int fd=f.fd();assert(fcntl(fd,F_GETFD)&FD_CLOEXEC);assert((fcntl(fd,F_GETFL)&O_ACCMODE)==O_RDONLY);assert(!f.owner->current());assert(!f.owner->close()&&f.owner->isClosed());assert(fcntl(fd,F_GETFD)==-1&&std::filesystem::exists(f.path));});
 control("missing platform Context retains closeable partial without path fallback",[]{Fixture f;osCode=notSupplied;assert(f.acquire()==notSupplied&&f.owner);int fd=-1;ApplicationDirectoryIdentity id;assert(f.owner->borrowForNativeInventory(fd,id)==notSupplied&&fd==-1);assert(!f.owner->close());});
 control("absent OS-named app directory is never created",[]{Fixture f;osPath=f.path+"/missing";assert(f.acquire()==notSupplied&&f.owner&&!std::filesystem::exists(osPath));});
 control("unprotected application directory adopts partial then refuses",[]{Fixture f;assert(!chmod(f.path.c_str(),0755));assert(f.acquire()==changed&&f.owner);assert(!f.owner->close());assert(!chmod(f.path.c_str(),0700));});
 control("OS directory leaf cannot be substituted by a symlink",[]{Fixture f;assert(!rename(f.path.c_str(),(f.path+"-original").c_str()));assert(!symlink((f.path+"-original").c_str(),f.path.c_str()));assert(f.acquire()!=0&&f.owner);assert(!f.owner->close());assert(!unlink(f.path.c_str()));assert(!rename((f.path+"-original").c_str(),f.path.c_str()));});
 control("relative or nul OS strings are invalid and never interpreted as locators",[]{for(auto path:{std::string("native.account:1"),std::string("/tmp/abc\0def",12)}){Fixture f;osPath=path;assert(f.acquire()==invalid&&f.owner);}});
 control("OS application path drift permanently retires original owner",[]{Fixture f;assert(!f.acquire());int fd=f.fd();osPath=f.path+"/different";assert(f.owner->current()==changed);osPath=f.path;assert(f.owner->current()==changed&&fcntl(fd,F_GETFD)>=0);});
 control("same path inode replacement refuses and does not close replacement",[]{Fixture f;assert(!f.acquire());int oldFD=f.fd();assert(!rename(f.path.c_str(),(f.path+"-old").c_str()));assert(!mkdir(f.path.c_str(),0700));int replacement=open(f.path.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC);assert(replacement>=0);assert(f.owner->current()==changed);assert(!f.owner->close());assert(fcntl(oldFD,F_GETFD)==-1&&fcntl(replacement,F_GETFD)>=0);assert(!::close(replacement));std::filesystem::remove_all(f.path+"-old");});
 control("permission drift invalidates despite identical held inode",[]{Fixture f;assert(!f.acquire());assert(!chmod(f.path.c_str(),0755));assert(f.owner->current()==changed);assert(!chmod(f.path.c_str(),0700));assert(f.owner->current()==changed);});
 control("late OS Context change preserves partial for explicit cleanup",[]{Fixture f;changeAt=3;assert(f.acquire()==changed&&f.owner);assert(!f.owner->close()&&f.owner->isClosed());});
 control("foreign thread cannot borrow or close; any-thread retire stops use",[]{Fixture f;assert(!f.acquire());std::thread other([&]{int fd=-1;ApplicationDirectoryIdentity id;assert(f.owner->borrowForNativeInventory(fd,id)==wrongThread&&fd==-1);assert(f.owner->current()==wrongThread&&f.owner->close()==wrongThread);f.owner->retire();});other.join();assert(f.owner->current()==closed);});
 control("closed owner cannot reopen and output ownership cannot be overwritten",[]{Fixture f;assert(!f.acquire());int held=f.fd();ApplicationDirectoryIdentity id;assert(f.owner->borrowForNativeInventory(held,id)==invalid);assert(f.acquire()==invalid);assert(!f.owner->close()&&!f.owner->close());int fd=-1;assert(f.owner->borrowForNativeInventory(fd,id)==closed&&fd==-1);});
 std::cout<<"12 PUBLIC app-directory physical/lifetime controls passed; real platform Context, receipt, selected mother and Root remain unverified\n";
}
