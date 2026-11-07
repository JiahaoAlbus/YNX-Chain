#include "SelectedAppDirectoryPrivate.h"
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>
namespace ynx::mobilepq::directories {
namespace {
bool protectedApp(const struct stat&s){return S_ISDIR(s.st_mode)&&(s.st_mode&07777)==0700&&s.st_uid==geteuid()&&s.st_nlink>0;}
bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid;}
bool validOSPath(const std::string&s){return !s.empty()&&s.size()<=4096&&s.front()=='/'&&s.find('\0')==std::string::npos;}
}
NativeApplicationDirectory::~NativeApplicationDirectory(){if(fd_>=0&&!closeUncertain_)::close(fd_);}
int32_t NativeApplicationDirectory::fail(int32_t e)noexcept{if(e){if(!first_)first_=e;retired_=true;}return e;}
int32_t NativeApplicationDirectory::acquire(std::unique_ptr<NativeApplicationDirectory>&out)noexcept{
 if(out)return invalid;
 try{
  out=std::unique_ptr<NativeApplicationDirectory>(new NativeApplicationDirectory);
  if(auto e=platformApplicationDirectory(out->originalPath_))return out->fail(e);
  if(!validOSPath(out->originalPath_))return out->fail(invalid);
  // This path came from the real platform Context, never Root/caller DATA.
  out->fd_=open(out->originalPath_.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(out->fd_<0)return out->fail(errno==ENOENT?notSupplied:io);
  if(fstat(out->fd_,&out->identity_)||!protectedApp(out->identity_))return out->fail(changed);
  out->ready_=true;return out->current();
 }catch(...){if(out)out->fail(io);return io;}
}
int32_t NativeApplicationDirectory::current()noexcept{
 if(std::this_thread::get_id()!=actor_)return wrongThread;
 if(first_)return first_;
 if(retired_||!ready_||closeSelected_||closed_)return closed;
 try{
  std::string observed;struct stat held{},named{};
  if(auto e=platformApplicationDirectory(observed))return fail(e);
  if(observed!=originalPath_||fstat(fd_,&held)||!protectedApp(held)||!same(held,identity_)||
     lstat(originalPath_.c_str(),&named)||!protectedApp(named)||!same(named,identity_))return fail(changed);
  observed.clear();if(auto e=platformApplicationDirectory(observed))return fail(e);
  return observed==originalPath_&&!retired_?0:fail(changed);
 }catch(...){return fail(io);}
}
int32_t NativeApplicationDirectory::borrowForNativeInventory(int&out,ApplicationDirectoryIdentity&identity)noexcept{
 if(out!=-1)return invalid;
 if(auto e=current())return e;
 identity={uint64_t(identity_.st_dev),uint64_t(identity_.st_ino),uint32_t(identity_.st_uid),uint32_t(identity_.st_gid)};
 out=fd_;return 0;
}
void NativeApplicationDirectory::retire()noexcept{retired_=true;}
int32_t NativeApplicationDirectory::close()noexcept{
 if(std::this_thread::get_id()!=actor_)return wrongThread;
 retire();ready_=false;closeSelected_=true;
 if(closed_)return cleanup_;
 if(closeUncertain_)return cleanup_?cleanup_:debt;
 if(fd_>=0){
  struct stat held{};
  // Do not close an unrelated descriptor after accidental borrowed-FD misuse.
  if(fstat(fd_,&held)||!same(held,identity_)){closeUncertain_=true;return cleanup_=changed;}
  if(::close(fd_)){closeUncertain_=true;return cleanup_=io;}
  fd_=-1;
 }
 closed_=true;return cleanup_;
}
}
