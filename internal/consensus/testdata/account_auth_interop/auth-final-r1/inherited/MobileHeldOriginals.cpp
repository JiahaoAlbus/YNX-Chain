#include "MobileHeldOriginals.hpp"
#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <limits>
namespace ynx::auth::mobile::qualified::physical {
namespace {
#ifdef YNX_MOBILE_QUALIFIED_PUBLIC_CLOCK
extern "C" int32_t ynx_mobile_qualified_PUBLIC_close_fd(int32_t);
int closeOriginalFD(int fd){return ynx_mobile_qualified_PUBLIC_close_fd(fd);}
#else
int closeOriginalFD(int fd){return ::close(fd);}
#endif
bool same(const struct stat&a,const struct stat&b,bool directory=false){
 bool v=a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode;
 if(directory)return v;
 v=v&&a.st_nlink==b.st_nlink;
#if defined(__APPLE__)
 return v&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
 return v&&a.st_size==b.st_size&&a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
bool leaf(const std::string&s){return !s.empty()&&s!="."&&s!=".."&&s.size()<=128&&std::all_of(s.begin(),s.end(),[](unsigned char c){return(c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='.'||c=='-'||c=='_';});}
bool readExact(int fd,size_t n,std::vector<uint8_t>&out){std::vector<uint8_t>b(n);size_t at=0;while(at<n){auto count=pread(fd,b.data()+at,n-at,(off_t)at);if(count<0&&errno==EINTR)continue;if(count<=0)return false;at+=static_cast<size_t>(count);}uint8_t extra=0;if(pread(fd,&extra,1,(off_t)n)!=0)return false;out=std::move(b);return true;}
}
HeldOriginals::HeldOriginals(DirectorySpec spec):spec_(std::move(spec)){}
int32_t HeldOriginals::fail(int32_t e)noexcept{if(e&&!first_)first_=e;if(e)retire();return e;}
int32_t HeldOriginals::initialize()noexcept{try{
 if(spec_.uid!=geteuid()||spec_.gid!=getegid()||!spec_.inode||spec_.files.size()>16)return fail(invalid);
 if(spec_.borrowedNativeFD>=0){if(!spec_.canonicalPath.empty())return fail(invalid);int fd=fcntl(spec_.borrowedNativeFD,F_DUPFD_CLOEXEC,0);if(fd<0)return fail(io);parents_.push_back({fd,"",{}, {}});if(fstat(fd,&parents_.back().identity))return fail(io);}
 else{
 if(spec_.canonicalPath.empty()||spec_.canonicalPath[0]!='/'||spec_.canonicalPath.back()=='/'||spec_.canonicalPath.find('\0')!=std::string::npos)return fail(invalid);
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0)return fail(io);parents_.push_back({fd,"",{}, {}});if(fstat(fd,&parents_.back().identity))return fail(io);
 size_t at=1;while(at<spec_.canonicalPath.size()){auto end=spec_.canonicalPath.find('/',at);auto part=spec_.canonicalPath.substr(at,end==std::string::npos?end:end-at);if(part.empty()||part=="."||part=="..")return fail(invalid);int next=openat(parents_.back().fd,part.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(next<0)return fail(io);parents_.push_back({next,part,{}, {}});auto&entry=parents_.back();if(fstat(next,&entry.identity)||!S_ISDIR(entry.identity.st_mode)||(entry.identity.st_mode&0022)||(entry.identity.st_uid!=0&&entry.identity.st_uid!=spec_.uid))return fail(changed);if(end==std::string::npos)break;at=end+1;}
 }
 directory_=parents_.back().fd;identity_=parents_.back().identity;if(!S_ISDIR(identity_.st_mode)||(identity_.st_mode&0777)!=0700||identity_.st_uid!=spec_.uid||identity_.st_gid!=spec_.gid||(uint64_t)identity_.st_dev!=spec_.device||(uint64_t)identity_.st_ino!=spec_.inode)return fail(changed);
 for(const auto&s:spec_.files){if(!leaf(s.leaf)||!s.maximum||s.maximum>8388608||std::any_of(files_.begin(),files_.end(),[&](const Entry&e){return e.name==s.leaf;}))return fail(invalid);int f=openat(directory_,s.leaf.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(f<0)return fail(io);files_.push_back({f,s.leaf,{}, {}});auto&e=files_.back();if(fstat(f,&e.identity)||!S_ISREG(e.identity.st_mode)||(e.identity.st_mode&0777)!=0600||e.identity.st_uid!=spec_.uid||e.identity.st_gid!=spec_.gid||e.identity.st_nlink!=1||e.identity.st_size<0||(uint64_t)e.identity.st_size>s.maximum||!readExact(f,(size_t)e.identity.st_size,e.bytes))return fail(changed);}
 return current();
 }catch(...){return fail(io);}}
int32_t HeldOriginals::observedCurrent()const noexcept{return retired_.load(std::memory_order_acquire)?physical::closed:0;}
int32_t HeldOriginals::current()noexcept{if(actor_!=std::this_thread::get_id())return wrongThread;if(auto e=observedCurrent())return e;try{
 for(size_t i=0;i<parents_.size();++i){struct stat s{},named{};const auto&e=parents_[i];if(fstat(e.fd,&s)||!same(e.identity,s,true)||(i&&(fstatat(parents_[i-1].fd,e.name.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!same(e.identity,named,true))))return fail(changed);}
 for(const auto&e:files_){struct stat s{},named{};std::vector<uint8_t>b;if(fstat(e.fd,&s)||!same(e.identity,s)||fstatat(directory_,e.name.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!same(e.identity,named)||!readExact(e.fd,e.bytes.size(),b)||b!=e.bytes)return fail(changed);if(fstat(e.fd,&s)||!same(e.identity,s))return fail(changed);}
 return 0;}catch(...){return fail(io);}}
int32_t HeldOriginals::copy(const std::string&name,std::vector<uint8_t>&out)noexcept{if(auto e=current())return e;try{for(const auto&e:files_)if(e.name==name){auto b=e.bytes;if(auto rc=current())return rc;out=std::move(b);return 0;}return invalid;}catch(...){return fail(io);}}
int32_t HeldOriginals::copyCaptured(const std::string&name,std::vector<uint8_t>&out)const noexcept{if(actor_!=std::this_thread::get_id())return wrongThread;try{for(const auto&e:files_)if(e.name==name){out=e.bytes;return 0;}return invalid;}catch(...){return io;}}
int32_t HeldOriginals::borrowDirectory(int&fd,struct stat&identity)noexcept{if(auto e=current())return e;fd=directory_;identity=identity_;return 0;}
int32_t HeldOriginals::retain()noexcept{if(auto e=current())return e;if(loans_==std::numeric_limits<size_t>::max())return fail(debt);++loans_;return 0;}
void HeldOriginals::release()noexcept{if(actor_!=std::this_thread::get_id()||!loans_){fail(debt);return;}--loans_;}
int32_t HeldOriginals::close()noexcept{retire();if(actor_!=std::this_thread::get_id())return wrongThread;if(closeSelected_)return closeResult_;if(loans_)return debt;closeSelected_=true;closeResult_=first_;for(auto&e:files_){int fd=e.fd;e.fd=-1;if(fd>=0&&closeOriginalFD(fd)){physicalUnknown_=true;if(!closeResult_)closeResult_=io;}}for(auto i=parents_.rbegin();i!=parents_.rend();++i){int fd=i->fd;i->fd=-1;if(fd>=0&&closeOriginalFD(fd)){physicalUnknown_=true;if(!closeResult_)closeResult_=io;}}directory_=-1;closed_=!physicalUnknown_;return closeResult_;}
HeldOriginals::~HeldOriginals(){// A physically held child must keep its shared parent; no implicit renewal.
 if(!loans_)(void)close();}
struct Factory{static Acquisition open(DirectorySpec s){Acquisition a;try{a.owner=std::shared_ptr<HeldOriginals>(new HeldOriginals(std::move(s)));a.error=a.owner->initialize();}catch(...){a.error=io;}return a;}};
Acquisition openSelectedPublicOriginals(DirectorySpec spec)noexcept{return Factory::open(std::move(spec));}
}
