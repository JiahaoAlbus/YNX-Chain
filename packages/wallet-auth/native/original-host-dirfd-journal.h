#pragma once
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <cerrno>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>
#include <algorithm>
#include <unordered_map>

namespace ynx_auth_private {
// Fixed syscall owner only, NOT Source authentication or permission. Native
// caller supplies release-selected storage, never renderer/ENV/provider paths.
class HostDirfdJournal {
 struct FD {int number;bool selected=false,complete=false;};
 std::vector<FD> fds;int parent=-1,directory=-1;struct stat parentIdentity{},directoryIdentity{};
 std::string leaf;bool readOnly=false;bool opened=false,retired=false,closeSelected=false,closeResult=false,unknown=false;
 std::unordered_map<std::string,struct stat> recordIdentities;
 std::string first;
 [[noreturn]] void fail(const char *code){unknown=true;if(first.empty())first=code;throw std::runtime_error(first);}
 int own(int fd){if(fd<0)fail("HOST_DIRFD_OPEN_UNKNOWN");for(auto &slot:fds)if(slot.complete){slot={fd,false,false};return fd;}fds.push_back({fd,false,false});return fd;}
 bool closeOnce(int fd){for(auto &item:fds)if(item.number==fd&&!item.complete){if(item.selected)return false;item.selected=true;item.complete=::close(fd)==0;if(!item.complete){unknown=true;if(first.empty())first="HOST_DIRFD_CLOSE_UNKNOWN";}return item.complete;}return true;}
 static bool identity(const struct stat &a,const struct stat &b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode;}
 static bool fileIdentity(const struct stat&a,const struct stat&b){
  if(!identity(a,b)||a.st_nlink!=b.st_nlink||a.st_size!=b.st_size)return false;
#ifdef __APPLE__
  return a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
  return a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
 }
 static bool safeDirectory(const struct stat&s,bool privateOnly){return S_ISDIR(s.st_mode)&&(s.st_uid==getuid()||(!privateOnly&&s.st_uid==0))&&(privateOnly?(s.st_mode&0777)==0700:(s.st_mode&0022)==0);}
 static bool safeFile(const struct stat&s,size_t max){return S_ISREG(s.st_mode)&&s.st_uid==getuid()&&(s.st_mode&0777)==0600&&s.st_nlink==1&&s.st_size>0&&(uint64_t)s.st_size<=max;}
 static bool component(const std::string&s){return !s.empty()&&s!="."&&s!=".."&&s.find('/')==std::string::npos&&s.find('\0')==std::string::npos;}
 static bool recordName(const std::string&s){if(s.size()!=72&&s.size()!=73)return false;for(size_t i=0;i<64;i++)if(!((s[i]>='a'&&s[i]<='f')||(s[i]>='0'&&s[i]<='9')))return false;return s.substr(64)==".entered"||s.substr(64)==".terminal";}
public:
 HostDirfdJournal()=default;HostDirfdJournal(const HostDirfdJournal&)=delete;HostDirfdJournal&operator=(const HostDirfdJournal&)=delete;
 // Destructor intentionally does not retry uncertain close. Original Native
 // inventory retains this owner on incomplete close instead of deleting it.
private:
 void openSelected(const std::string&parentPath,const std::string&journalLeaf,bool existingOnly){
  readOnly=existingOnly;
  if(opened||retired||parentPath.empty()||parentPath[0]!='/'||!component(journalLeaf))fail("HOST_DIRFD_SELECTION_INVALID");opened=true;leaf=journalLeaf;
  int current=own(::open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));
  size_t start=1;
  while(start<parentPath.size()){
   size_t slash=parentPath.find('/',start);std::string part=parentPath.substr(start,slash==std::string::npos?std::string::npos:slash-start);
   if(!component(part))fail("HOST_DIRFD_SELECTION_INVALID");struct stat before{};if(fstat(current,&before)||!safeDirectory(before,false))fail("HOST_DIRFD_PARENT_INVALID");
   int next=own(openat(current,part.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));struct stat named{},held{};
   if(fstat(next,&held)||fstatat(current,part.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!identity(named,held)||!safeDirectory(held,false))fail("HOST_DIRFD_PARENT_CHANGED");
   if(!closeOnce(current))fail("HOST_DIRFD_CLOSE_UNKNOWN");current=next;if(slash==std::string::npos)break;start=slash+1;if(start==parentPath.size())fail("HOST_DIRFD_SELECTION_INVALID");
  }
  parent=current;if(fstat(parent,&parentIdentity)||!safeDirectory(parentIdentity,true))fail("HOST_DIRFD_PARENT_INVALID");
  if(!existingOnly){if(mkdirat(parent,leaf.c_str(),0700)==0){if(fsync(parent))fail("HOST_DIRFD_SYNC_UNKNOWN");}else if(errno!=EEXIST)fail("HOST_DIRFD_CREATE_UNKNOWN");}
  directory=own(openat(parent,leaf.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));struct stat named{};
  if(fstat(directory,&directoryIdentity)||fstatat(parent,leaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!identity(named,directoryIdentity)||!safeDirectory(directoryIdentity,true))fail("HOST_DIRFD_DIRECTORY_CHANGED");
  if(flock(directory,(existingOnly?LOCK_SH:LOCK_EX)|LOCK_NB))fail("HOST_DIRFD_WRITER_ALREADY_HELD");assertCurrent();
 }
public:
 void open(const std::string&parentPath,const std::string&journalLeaf){openSelected(parentPath,journalLeaf,false);}
 // Existing original journal only: no mkdir, write, lease renewal or replay.
 // This is read custody, NOT Source authentication or reclaimed admission.
 void openRetained(const std::string&parentPath,const std::string&journalLeaf){openSelected(parentPath,journalLeaf,true);}
 void assertCurrent(){
  if(!opened||retired||unknown||parent<0||directory<0)fail("HOST_DIRFD_UNRESOLVED");
  struct stat p{},d{},named{};
  if(fstat(parent,&p)||!identity(p,parentIdentity)||!safeDirectory(p,true)||fstat(directory,&d)||!identity(d,directoryIdentity)||!safeDirectory(d,true)||fstatat(parent,leaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!identity(named,directoryIdentity))fail("HOST_DIRFD_DIRECTORY_CHANGED");
 }
 std::vector<std::string> list(){
  assertCurrent();int duplicate=own(fcntl(directory,F_DUPFD_CLOEXEC,0));DIR *dir=fdopendir(duplicate);
  if(!dir){closeOnce(duplicate);fail("HOST_DIRFD_LIST_UNKNOWN");}std::vector<std::string> names;rewinddir(dir);errno=0;
  while(auto *entry=readdir(dir)){std::string name=entry->d_name;if(name=="."||name=="..")continue;if(!recordName(name)||names.size()>=128){int result=closedir(dir);for(auto&fd:fds)if(fd.number==duplicate&&!fd.selected){fd.selected=true;fd.complete=result==0;}fail(result?"HOST_DIRFD_CLOSE_UNKNOWN":"HOST_DIRFD_FOREIGN_OR_CAPACITY");}names.push_back(name);}
  int readError=errno;int result=closedir(dir);for(auto&fd:fds)if(fd.number==duplicate&&!fd.selected){fd.selected=true;fd.complete=result==0;}
  if(result||readError)fail("HOST_DIRFD_LIST_UNKNOWN");std::sort(names.begin(),names.end());assertCurrent();return names;
 }
 std::string read(const std::string&name,size_t maximum=8192){
  assertCurrent();if(!recordName(name))fail("HOST_DIRFD_RECORD_INVALID");int fd=own(openat(directory,name.c_str(),O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC));
  struct stat before{},named{},after{};if(fstat(fd,&before)||!safeFile(before,maximum)||fstatat(directory,name.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!fileIdentity(before,named)||(recordIdentities.count(name)&&!fileIdentity(before,recordIdentities.at(name))))fail("HOST_DIRFD_RECORD_CHANGED");
  if(!recordIdentities.count(name))recordIdentities.emplace(name,before);
  std::string raw((size_t)before.st_size,'\0');size_t offset=0;
  while(offset<raw.size()){ssize_t n=pread(fd,raw.data()+offset,raw.size()-offset,(off_t)offset);if(n<0&&errno==EINTR)continue;if(n<=0)fail("HOST_DIRFD_READ_UNKNOWN");offset+=(size_t)n;}
  if(fstat(fd,&after)||fstatat(directory,name.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!fileIdentity(before,after)||!fileIdentity(before,named))fail("HOST_DIRFD_RECORD_CHANGED");
  if(!closeOnce(fd))fail("HOST_DIRFD_CLOSE_UNKNOWN");assertCurrent();return raw;
 }
 // Source-selected same-parent HostState snapshot; not an arbitrary path and
 // never used to reconstruct a grant, once map or original session capability.
 std::string readRetainedState(const std::string&stateLeaf){
  assertCurrent();if(!readOnly||!component(stateLeaf))fail("HOST_DIRFD_RECLAIM_STATE_SELECTION_INVALID");
  int fd=own(openat(parent,stateLeaf.c_str(),O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC));
  struct stat before{},named{},after{};const std::string key="state:"+stateLeaf;
  if(fstat(fd,&before)||!safeFile(before,32*1024*1024)||fstatat(parent,stateLeaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!fileIdentity(before,named)||(recordIdentities.count(key)&&!fileIdentity(before,recordIdentities.at(key))))fail("HOST_DIRFD_RECLAIM_STATE_CHANGED");
  if(!recordIdentities.count(key))recordIdentities.emplace(key,before);
  std::string raw((size_t)before.st_size,'\0');size_t offset=0;
  while(offset<raw.size()){ssize_t n=pread(fd,raw.data()+offset,raw.size()-offset,(off_t)offset);if(n<0&&errno==EINTR)continue;if(n<=0)fail("HOST_DIRFD_READ_UNKNOWN");offset+=(size_t)n;}
  if(fstat(fd,&after)||fstatat(parent,stateLeaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!fileIdentity(before,after)||!fileIdentity(before,named))fail("HOST_DIRFD_RECLAIM_STATE_CHANGED");
  if(!closeOnce(fd))fail("HOST_DIRFD_CLOSE_UNKNOWN");assertCurrent();return raw;
 }
 void writeExclusive(const std::string&name,const std::string&raw){
  assertCurrent();if(readOnly)fail("HOST_DIRFD_RECLAIM_READ_ONLY");if(!recordName(name)||raw.empty()||raw.size()>8192)fail("HOST_DIRFD_RECORD_INVALID");
  int fd=own(openat(directory,name.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600));struct stat before{};
  if(fstat(fd,&before)||!S_ISREG(before.st_mode)||before.st_uid!=getuid()||(before.st_mode&0777)!=0600||before.st_nlink!=1||before.st_size!=0)fail("HOST_DIRFD_RECORD_CHANGED");size_t offset=0;
  while(offset<raw.size()){ssize_t n=::write(fd,raw.data()+offset,raw.size()-offset);if(n<0&&errno==EINTR)continue;if(n<=0)fail("HOST_DIRFD_WRITE_UNKNOWN");offset+=(size_t)n;}
  if(fsync(fd)||fsync(directory))fail("HOST_DIRFD_SYNC_UNKNOWN");struct stat after{},named{};
  if(fstat(fd,&after)||!safeFile(after,8192)||!identity(before,after)||fstatat(directory,name.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!fileIdentity(after,named))fail("HOST_DIRFD_RECORD_CHANGED");
  recordIdentities.emplace(name,after);if(!closeOnce(fd))fail("HOST_DIRFD_CLOSE_UNKNOWN");assertCurrent();if(read(name)!=raw)fail("HOST_DIRFD_READBACK_UNKNOWN");
 }
 void retire(){retired=true;}
 bool close(){if(closeSelected)return closeResult;closeSelected=true;retired=true;bool ok=true;for(auto it=fds.rbegin();it!=fds.rend();++it)if(!it->complete&&!closeOnce(it->number))ok=false;closeResult=ok;return ok;}
 bool unresolved()const{return unknown;}
 const std::string&firstCause()const{return first;}
};
}
