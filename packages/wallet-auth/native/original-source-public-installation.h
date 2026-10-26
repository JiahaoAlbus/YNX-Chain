#pragma once
#include <array>
#include "original-auth-identity-public-limits.h"
#include <vector>
#include <string>
#include <set>
#include <stdexcept>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <climits>
#include <cstdlib>
#include <cstdio>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/stat.h>
#include <sys/acl.h>
#include <CommonCrypto/CommonDigest.h>
namespace ynx_auth_private {
// Private filesystem mechanics, NOT an enrollment/permission constructor.
// The normal Native receiver supplies only its fixed kernel-UID registry
// location and verified original Source copies. No JS/path/key installer.
class SourcePublicInstallation final {
public:
 using Bytes=std::vector<unsigned char>;
 using Bundle=std::array<Bytes,4>;
 struct Receipt{std::string name,sha256;struct stat identity{};};
private:
 struct Descriptor{int fd=-1;bool selected=false,complete=false;};
 struct File{std::size_t slot=SIZE_MAX;std::size_t written=0;struct stat identity{};bool present=false;};
 std::array<Descriptor,16> fds_{};
 std::array<File,4> files_{},readFiles_{};
 std::size_t parent_=SIZE_MAX,directory_=SIZE_MAX,readDirectory_=SIZE_MAX;
 struct stat parentIdentity_{},directoryIdentity_{};nlink_t parentLinks_=0;
 std::string path_,name_;Bundle expected_{};
 bool parentSelected_=false,stageSelected_=false,publishSelected_=false;
 bool owned_=false,published_=false,retained_=false,closeSelected_=false,closed_=false;
 const char *first_=nullptr,*closeCause_=nullptr;
 inline static constexpr const char *finalName_="original-auth-identity";
 inline static constexpr const char *names_[4]={"root.original","enrollment.original","profile.original","head.original"};
 [[noreturn]] void fail(const char *s){if(!first_)first_=s;throw std::runtime_error(s);}
 static bool stable(const struct stat&a,const struct stat&b,bool file){
  return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&(!file||a.st_size==b.st_size);
 }
 static bool noAllowACL(acl_t acl){
  // Darwin returns NULL/ENOENT for an existing inode with no extended ACL.
  // All callers also fence the opened/named inode with stat before/after;
  // any other ACL retrieval failure remains a refusal.
  if(!acl)return errno==ENOENT;
  bool okay=acl_valid(acl)==0;acl_entry_t entry;int which=ACL_FIRST_ENTRY;
  while(okay){errno=0;int r=acl_get_entry(acl,which,&entry);
   if(r<0){okay=errno==EINVAL;break;}
   acl_tag_t tag;if(acl_get_tag_type(entry,&tag)||tag!=ACL_EXTENDED_DENY){okay=false;break;}
   which=ACL_NEXT_ENTRY;
  }
  if(acl_free(acl))okay=false;
  return okay;
 }
 static bool protectedACL(int fd){return noAllowACL(acl_get_fd_np(fd,ACL_TYPE_EXTENDED));}
 static std::string digest(const Bytes&bytes){
  unsigned char out[CC_SHA256_DIGEST_LENGTH];
  if(!CC_SHA256(bytes.data(),(CC_LONG)bytes.size(),out))throw std::runtime_error("SOURCE_PROVISIONING_HASH_FAILED");
  static constexpr char h[]="0123456789abcdef";std::string s;
  for(auto b:out){s.push_back(h[b>>4]);s.push_back(h[b&15]);}return s;
 }
 std::size_t adopt(int fd){
  if(fd<0)fail("SOURCE_PROVISIONING_OPEN_FAILED");
  for(std::size_t n=0;n<fds_.size();n++)if(fds_[n].fd<0){fds_[n]={fd,false,false};return n;}
  // Finite slots are preallocated; no open is attempted without capacity in
  // normal paths. Do not close/retry a possibly shared numeric descriptor.
  std::abort();
 }
 int fd(std::size_t slot){if(slot>=fds_.size()||fds_[slot].fd<0||fds_[slot].selected)fail("SOURCE_PROVISIONING_DESCRIPTOR_UNKNOWN");return fds_[slot].fd;}
 void parentCurrent(){
  struct stat held{},named{};char canonical[PATH_MAX];
  if(fstat(fd(parent_),&held)||lstat(path_.c_str(),&named))fail("SOURCE_PROVISIONING_PARENT_STAT_FAILED");
  if(!realpath(path_.c_str(),canonical)||path_!=canonical)fail("SOURCE_PROVISIONING_PARENT_NOT_CANONICAL");
  if(!stable(parentIdentity_,held,false)||!stable(held,named,false)||held.st_nlink!=parentLinks_)fail("SOURCE_PROVISIONING_PARENT_CHANGED");
  if(!protectedACL(fd(parent_)))fail("SOURCE_PROVISIONING_PARENT_ACL_REFUSED");
 }
 void parentDelta(int delta){
  parentLinks_=(nlink_t)((std::int64_t)parentLinks_+delta);parentIdentity_.st_nlink=parentLinks_;parentCurrent();
 }
 bool absent(const std::string&name){
  struct stat s{};if(!fstatat(fd(parent_),name.c_str(),&s,AT_SYMLINK_NOFOLLOW))return false;
  if(errno!=ENOENT)fail("SOURCE_PROVISIONING_ABSENCE_UNKNOWN");return true;
 }
 std::set<std::string> inventory(int directory){
  auto slot=adopt(fcntl(directory,F_DUPFD_CLOEXEC,10));
  DIR *stream=fdopendir(fd(slot));if(!stream)fail("SOURCE_PROVISIONING_DIRECTORY_READ_FAILED");
  rewinddir(stream);
  std::set<std::string> names;bool okay=true;
  for(;;){errno=0;dirent *entry=readdir(stream);if(!entry){if(errno)okay=false;break;}
   std::string name(entry->d_name);if(name=="."||name=="..")continue;
   if(names.size()>=5||!names.insert(name).second){okay=false;break;}
  }
  fds_[slot].selected=true;int result=closedir(stream);fds_[slot].complete=result==0;
  if(!result)fds_[slot].fd=-1;
  if(!okay||result)fail("SOURCE_PROVISIONING_DIRECTORY_INVENTORY_UNKNOWN");return names;
 }
 void directoryCurrent(){
  parentCurrent();struct stat held{},named{};
  if(fstat(fd(directory_),&held)||fstatat(fd(parent_),name_.c_str(),&named,AT_SYMLINK_NOFOLLOW)||
   !stable(directoryIdentity_,held,false)||!stable(held,named,false)||!S_ISDIR(held.st_mode)||!protectedACL(fd(directory_)))fail("SOURCE_PROVISIONING_DIRECTORY_CHANGED");
 }
 void directoryDelta(int delta){
  // Darwin directory nlink counts its named entries, including regular files.
  // Update only the exact expected own create/unlink; never absorb drift.
  directoryIdentity_.st_nlink=(nlink_t)((std::int64_t)directoryIdentity_.st_nlink+delta);
  directoryCurrent();
 }
 void exactInventory(int dir){
  std::set<std::string> expected;for(auto n:names_)expected.insert(n);
  if(inventory(dir)!=expected)fail("SOURCE_PROVISIONING_FOREIGN_OBJECT");
 }
 Bytes read(int descriptor,std::size_t size){
  if(size>OriginalAuthPublicOriginalMax)fail("SOURCE_PROVISIONING_CAPACITY");Bytes bytes(size);std::size_t at=0;
  while(at<size){auto n=pread(descriptor,bytes.data()+at,size-at,(off_t)at);if(n<=0)fail("SOURCE_PROVISIONING_READ_UNKNOWN");at+=(std::size_t)n;}return bytes;
 }
 void fileCurrent(File &file,std::size_t n,int dir){
  if(!file.present)fail("SOURCE_PROVISIONING_FILE_NOT_CAPTURED");
  struct stat held{},named{};
  if(fstat(fd(file.slot),&held)||fstatat(dir,names_[n],&named,AT_SYMLINK_NOFOLLOW)||
   !stable(file.identity,held,true)||!stable(held,named,true)||!S_ISREG(held.st_mode)||held.st_nlink!=1||
   held.st_uid!=parentIdentity_.st_uid||held.st_size!=(off_t)file.written||(held.st_mode&0777)!=0644||!protectedACL(fd(file.slot)))fail("SOURCE_PROVISIONING_FILE_CHANGED");
  Bytes expected(expected_[n].begin(),expected_[n].begin()+file.written);
  if(read(fd(file.slot),file.written)!=expected)fail("SOURCE_PROVISIONING_CONTENT_CHANGED");
  struct stat after{};if(fstat(fd(file.slot),&after)||!stable(held,after,true))fail("SOURCE_PROVISIONING_FILE_CHANGED");
 }
 void captureFile(File &file,std::size_t n,int dir,bool create){
  int flags=create?O_RDWR|O_CREAT|O_EXCL:O_RDONLY;
  file.slot=adopt(openat(dir,names_[n],flags|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK,0644));
  if(fstat(fd(file.slot),&file.identity)||!S_ISREG(file.identity.st_mode)||file.identity.st_uid!=parentIdentity_.st_uid||file.identity.st_nlink!=1)fail("SOURCE_PROVISIONING_FILE_INVALID");
  file.present=true;
  if(create){if(fchmod(fd(file.slot),0644))fail("SOURCE_PROVISIONING_MODE_FAILED");
   struct stat now{};if(fstat(fd(file.slot),&now)||now.st_dev!=file.identity.st_dev||now.st_ino!=file.identity.st_ino||now.st_uid!=file.identity.st_uid||now.st_gid!=file.identity.st_gid||now.st_nlink!=1)fail("SOURCE_PROVISIONING_FILE_CHANGED");file.identity=now;
  }else file.written=expected_[n].size();
 }
public:
 static bool protectedRootAncestors(const std::string&path){
  if(path.empty()||path[0]!='/'||path.size()>=PATH_MAX)return false;
  char canonical[PATH_MAX];if(!realpath(path.c_str(),canonical)||path!=canonical)return false;
  std::string part;std::size_t at=1;
  for(;;){auto end=path.find('/',at);part=path.substr(0,end);struct stat s{},after{};
   if(lstat(part.c_str(),&s)||!S_ISDIR(s.st_mode)||s.st_uid!=0||(s.st_mode&0022)||
    !noAllowACL(acl_get_file(part.c_str(),ACL_TYPE_EXTENDED))||lstat(part.c_str(),&after)||!stable(s,after,false))return false;
   if(end==std::string::npos)break;at=end+1;
  }
  return true;
 }
 // This low-level component is NOT a path/UID authorization API. The sole
 // Native receiver derives the fixed path from kernel getuid and requires
 // root privilege plus protected root-owned ancestors before calling it.
 bool captureParent(const std::string &originalPath,uid_t expectedOwner){
  try{if(parentSelected_)fail("SOURCE_PROVISIONING_ALREADY_SELECTED");parentSelected_=true;path_=originalPath;
   parent_=adopt(open(path_.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));
   if(fstat(fd(parent_),&parentIdentity_)||!S_ISDIR(parentIdentity_.st_mode)||parentIdentity_.st_uid!=expectedOwner||(parentIdentity_.st_mode&0022))fail("SOURCE_PROVISIONING_PARENT_INVALID");
   parentLinks_=parentIdentity_.st_nlink;parentCurrent();return true;
  }catch(const std::exception&){return false;}
 }
 bool stage(const Bundle &originals){
  try{if(first_||stageSelected_)fail("SOURCE_PROVISIONING_STAGE_REUSED");stageSelected_=true;parentCurrent();
   if(!absent(finalName_))fail("SOURCE_PROVISIONING_ALREADY_INSTALLED_NO_REPLACE");
   for(const auto &b:originals)if(b.empty()||b.size()>OriginalAuthPublicOriginalMax)fail("SOURCE_PROVISIONING_CAPACITY");expected_=originals;
   unsigned char nonce[16];arc4random_buf(nonce,sizeof(nonce));static constexpr char h[]="0123456789abcdef";
   name_=".original-auth-identity.pending.";for(auto b:nonce){name_.push_back(h[b>>4]);name_.push_back(h[b&15]);}
   if(mkdirat(fd(parent_),name_.c_str(),0700))fail("SOURCE_PROVISIONING_STAGE_CREATE_FAILED");owned_=true;
   directory_=adopt(openat(fd(parent_),name_.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));
   if(fstat(fd(directory_),&directoryIdentity_)||!S_ISDIR(directoryIdentity_.st_mode)||directoryIdentity_.st_uid!=parentIdentity_.st_uid||directoryIdentity_.st_nlink!=2)fail("SOURCE_PROVISIONING_DIRECTORY_INVALID");
   parentDelta(1);
   for(std::size_t n=0;n<4;n++){captureFile(files_[n],n,fd(directory_),true);directoryDelta(1);
    while(files_[n].written<expected_[n].size()){
     auto wrote=write(fd(files_[n].slot),expected_[n].data()+files_[n].written,expected_[n].size()-files_[n].written);
     if(wrote<=0)fail("SOURCE_PROVISIONING_WRITE_UNKNOWN");files_[n].written+=(std::size_t)wrote;
     struct stat next{};if(fstat(fd(files_[n].slot),&next)||next.st_dev!=files_[n].identity.st_dev||next.st_ino!=files_[n].identity.st_ino||next.st_uid!=files_[n].identity.st_uid||next.st_gid!=files_[n].identity.st_gid||next.st_mode!=files_[n].identity.st_mode||next.st_nlink!=1||next.st_size!=(off_t)files_[n].written)fail("SOURCE_PROVISIONING_FILE_CHANGED");files_[n].identity=next;
    }
    if(fsync(fd(files_[n].slot)))fail("SOURCE_PROVISIONING_FILE_SYNC_UNKNOWN");fileCurrent(files_[n],n,fd(directory_));
   }
   exactInventory(fd(directory_));if(fchmod(fd(directory_),0755))fail("SOURCE_PROVISIONING_MODE_FAILED");
   struct stat after{};if(fstat(fd(directory_),&after)||after.st_dev!=directoryIdentity_.st_dev||after.st_ino!=directoryIdentity_.st_ino||after.st_uid!=directoryIdentity_.st_uid||after.st_gid!=directoryIdentity_.st_gid||after.st_nlink!=6||(after.st_mode&0777)!=0755)fail("SOURCE_PROVISIONING_DIRECTORY_CHANGED");directoryIdentity_=after;
   if(fsync(fd(directory_))||fsync(fd(parent_)))fail("SOURCE_PROVISIONING_DIRECTORY_SYNC_UNKNOWN");directoryCurrent();return true;
  }catch(const std::exception&){return false;}
 }
 bool publish(){
  try{if(first_||!owned_||publishSelected_)fail("SOURCE_PROVISIONING_PUBLICATION_REUSED");publishSelected_=true;
   directoryCurrent();exactInventory(fd(directory_));for(std::size_t n=0;n<4;n++)fileCurrent(files_[n],n,fd(directory_));
   if(!absent(finalName_))fail("SOURCE_PROVISIONING_ALREADY_INSTALLED_NO_REPLACE");
   int rc=renameatx_np(fd(parent_),name_.c_str(),fd(parent_),finalName_,RENAME_EXCL);
   struct stat finalState{},pending{};bool finalExists=fstatat(fd(parent_),finalName_,&finalState,AT_SYMLINK_NOFOLLOW)==0;
   bool pendingExists=fstatat(fd(parent_),name_.c_str(),&pending,AT_SYMLINK_NOFOLLOW)==0;
   if(finalExists&&stable(directoryIdentity_,finalState,false)&&!pendingExists){name_=finalName_;published_=true;}
   if(rc||!published_)fail("SOURCE_PROVISIONING_RENAME_UNKNOWN");
   if(fsync(fd(parent_)))fail("SOURCE_PROVISIONING_PARENT_SYNC_UNKNOWN");directoryCurrent();return true;
  }catch(const std::exception&){return false;}
 }
 bool captureExisting(const Bundle &expected){
  try{if(first_||stageSelected_)fail("SOURCE_PROVISIONING_COLD_CAPTURE_REUSED");stageSelected_=true;expected_=expected;
   for(const auto &b:expected)if(b.empty()||b.size()>OriginalAuthPublicOriginalMax)fail("SOURCE_PROVISIONING_CAPACITY");parentCurrent();name_=finalName_;
   directory_=adopt(openat(fd(parent_),name_.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));
   if(fstat(fd(directory_),&directoryIdentity_)||!S_ISDIR(directoryIdentity_.st_mode)||directoryIdentity_.st_uid!=parentIdentity_.st_uid||directoryIdentity_.st_nlink!=6||(directoryIdentity_.st_mode&0777)!=0755)fail("SOURCE_PROVISIONING_DIRECTORY_INVALID");
   directoryCurrent();exactInventory(fd(directory_));published_=true;return true;
  }catch(const std::exception&){return false;}
 }
 bool readBack(std::array<Receipt,4>&receipts){
  try{if(first_||!published_)fail("SOURCE_PROVISIONING_READBACK_UNAVAILABLE");directoryCurrent();
   if(readDirectory_==SIZE_MAX){readDirectory_=adopt(openat(fd(parent_),name_.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));
    struct stat again{};if(fstat(fd(readDirectory_),&again)||!stable(directoryIdentity_,again,false))fail("SOURCE_PROVISIONING_DIRECTORY_CHANGED");
    for(std::size_t n=0;n<4;n++)captureFile(readFiles_[n],n,fd(readDirectory_),false);
   }
   exactInventory(fd(readDirectory_));
   for(std::size_t n=0;n<4;n++){
    if(owned_)fileCurrent(files_[n],n,fd(directory_));
    fileCurrent(readFiles_[n],n,fd(readDirectory_));
    receipts[n]={names_[n],digest(expected_[n]),readFiles_[n].identity};
   }
   directoryCurrent();return true;
  }catch(const std::exception&){return false;}
 }
 bool retainPublishedData(){if(first_||!owned_||!published_||readDirectory_==SIZE_MAX)return false;retained_=true;return true;}
 bool close(){
  if(closeSelected_)return closed_;closeSelected_=true;bool okay=true;
  if(owned_&&!retained_){try{directoryCurrent();
    // Refuse the entire cleanup if foreign entries, changed inode/content,
    // symlinks or hardlinks exist. Never recursively delete a directory.
    std::set<std::string> expected;for(std::size_t n=0;n<4;n++)if(files_[n].present)expected.insert(names_[n]);
    if(inventory(fd(directory_))!=expected)fail("SOURCE_PROVISIONING_FOREIGN_OBJECT");
    for(std::size_t n=0;n<4;n++)if(files_[n].present)fileCurrent(files_[n],n,fd(directory_));
    for(std::size_t n=0;n<4;n++)if(files_[n].present){fileCurrent(files_[n],n,fd(directory_));if(unlinkat(fd(directory_),names_[n],0))fail("SOURCE_PROVISIONING_UNLINK_UNKNOWN");files_[n].present=false;directoryDelta(-1);}
    directoryCurrent();if(unlinkat(fd(parent_),name_.c_str(),AT_REMOVEDIR))fail("SOURCE_PROVISIONING_RMDIR_UNKNOWN");owned_=false;parentDelta(-1);
    if(!absent(name_)||fsync(fd(parent_)))fail("SOURCE_PROVISIONING_FINAL_ABSENCE_UNKNOWN");
   }catch(const std::exception&){okay=false;closeCause_=first_?first_:"SOURCE_PROVISIONING_CLEANUP_UNKNOWN";}}
  for(auto &d:fds_){if(d.fd<0)continue;if(d.selected){if(!d.complete)okay=false;continue;}
   d.selected=true;d.complete=::close(d.fd)==0;if(d.complete)d.fd=-1;else{okay=false;if(!closeCause_)closeCause_="SOURCE_PROVISIONING_DESCRIPTOR_CLOSE_UNKNOWN";}
  }
  closed_=okay;return closed_;
 }
 const char *firstCause()const{return first_;}
 const char *closeCause()const{return closeCause_;}
 const std::string &ownedName()const{return name_;}
 bool publishedData()const{return retained_;}
 bool cleanupComplete()const{return closed_;}
};
}
