#include "journal.hpp"
#include <openssl/sha.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstring>
#include <stdexcept>
#include <cstdlib>
namespace ynx::social::finite {
static void require(bool p,const char*s){if(!p)throw std::runtime_error(s);}
Digest sha(const Bytes&b){Digest d{};require(SHA256(b.data(),b.size(),d.data())!=nullptr,"DIGEST");return d;}
std::string hex(const Digest&d){static const char h[]="0123456789abcdef";std::string s;for(auto b:d){s+=h[b>>4];s+=h[b&15];}return s;}
static void u32(Bytes&b,std::uint32_t n){for(int i=3;i>=0;--i)b.push_back((n>>(i*8))&255);}
static void part(Bytes&b,const Bytes&p){require(p.size()<=49152,"PART");u32(b,p.size());b.insert(b.end(),p.begin(),p.end());}
Bytes Intent::encode()const{
 require((role==1||role==2)&&!body.empty()&&body.size()<=32768&&!frame.empty()&&frame.size()<=49152,"INTENT_FIELDS");
 Bytes b;const char domain[]="YNX/SOCIAL/FINITE-JOINT-INTENT/V1";b.insert(b.end(),domain,domain+sizeof(domain));u32(b,1);u32(b,role);
 for(auto*d:{&source_history,&canonical_role,&source_resource,&binding_resource})b.insert(b.end(),d->begin(),d->end());part(b,body);part(b,frame);return b;
}
std::string Intent::operation()const{
 // DATA address only. body/frame intentionally excluded: same captured Source
 // and canonical role cannot open another once slot by changing body/resource
 // aliases. canonical_role comes from independent registration/key/epoch.
 Bytes b;const char domain[]="YNX/SOCIAL/FINITE-JOINT-ONCE/V1";b.insert(b.end(),domain,domain+sizeof(domain));b.insert(b.end(),source_history.begin(),source_history.end());b.insert(b.end(),canonical_role.begin(),canonical_role.end());u32(b,role);return hex(sha(b));
}
static bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtime==b.st_mtime&&a.st_ctime==b.st_ctime
#ifdef __APPLE__
 &&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec
#else
 &&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec
#endif
 ;}
static std::string name(const std::string&op,const char*stage){require(op.size()==64,"OPERATION");require(!std::strcmp(stage,"entered")||!std::strcmp(stage,"classic")||!std::strcmp(stage,"pair")||!std::strcmp(stage,"terminal"),"STAGE");return "joint-source-"+op+"."+stage;}
Journal::Journal(int fd,const Intent&i,const std::string&registered):intent_(i),original_(i.encode()),operation_(i.operation()),registered_path_(registered){
 fd_=fcntl(fd,F_DUPFD_CLOEXEC,3);require(fd_>=0,"JOURNAL_DUP");struct stat s{};if(fstat(fd_,&s)||!S_ISDIR(s.st_mode)||s.st_uid!=geteuid()||(s.st_mode&07777)!=0700){int f;if(!close(f))std::abort();throw std::runtime_error("JOURNAL_CUSTODY");}dev_=s.st_dev;ino_=s.st_ino;uid_=s.st_uid;gid_=s.st_gid;
}
Journal::~Journal(){if(fd_>=0||(!closed_&&close_selected_))std::abort();}
void Journal::current()const{struct stat s{};require(fd_>=0&&!close_selected_&&fstat(fd_,&s)==0&&S_ISDIR(s.st_mode)&&s.st_nlink>0&&std::uint64_t(s.st_dev)==dev_&&std::uint64_t(s.st_ino)==ino_&&s.st_uid==uid_&&s.st_gid==gid_&&(s.st_mode&07777)==0700,"JOURNAL_CHANGED");if(!registered_path_.empty()){struct stat n{};require(registered_path_[0]=='/'&&lstat(registered_path_.c_str(),&n)==0&&S_ISDIR(n.st_mode)&&n.st_nlink>0&&n.st_dev==s.st_dev&&n.st_ino==s.st_ino&&n.st_uid==s.st_uid&&n.st_gid==s.st_gid&&n.st_mode==s.st_mode,"REGISTERED_JOURNAL_REPLACED");}}
Bytes Journal::read(const char*stage,std::size_t cap,bool missing)const{
 current();auto n=name(operation_,stage);int fd=openat(fd_,n.c_str(),O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0&&errno==ENOENT&&missing)return{};require(fd>=0,"READ_ORIGINAL");
 struct stat a{},b{},named{};Bytes raw;int first=0;
 try{require(fstat(fd,&a)==0&&S_ISREG(a.st_mode)&&a.st_uid==uid_&&a.st_gid==gid_&&(a.st_mode&07777)==0600&&a.st_nlink==1&&a.st_size>0&&std::uint64_t(a.st_size)<=cap,"RECORD_CUSTODY");raw.resize(a.st_size);std::size_t at=0;while(at<raw.size()){ssize_t k=pread(fd,raw.data()+at,raw.size()-at,at);require(k>0,"RECORD_READ");at+=k;}require(fstat(fd,&b)==0&&fstatat(fd_,n.c_str(),&named,AT_SYMLINK_NOFOLLOW)==0&&same(a,b)&&same(a,named),"RECORD_CHANGED");current();}catch(...){first=1;}
 // A close ambiguity must not be silently converted into a safe parent release.
 if(::close(fd)!=0)std::abort();require(first==0,"ORIGINAL_UNKNOWN");return raw;
}
void Journal::exclusive(const char*stage,const Bytes&raw){
 current();require(!raw.empty()&&raw.size()<=131072,"WRITE_BOUND");auto n=name(operation_,stage);int fd=openat(fd_,n.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);require(fd>=0,"ONCE_EXISTS_OR_UNKNOWN");int failed=0;
 std::size_t at=0;while(at<raw.size()){auto k=write(fd,raw.data()+at,raw.size()-at);if(k<=0){failed=1;break;}at+=k;}if(fsync(fd))failed=1;if(::close(fd))std::abort();if(fsync(fd_))failed=1;
 // Never unlink/retry/reset on write/fsync/ACK uncertainty.
 require(!failed,"WRITE_UNKNOWN");require(read(stage,131072)==raw,"READBACK_UNKNOWN");
}
void Journal::enter(){exclusive("entered",original_);intentCurrent();}
bool Journal::probeEntered()const{auto raw=read("entered",131072,true);if(raw.empty())return false;require(raw==original_,"INTENT_CONFLICT");return true;}
void Journal::intentCurrent()const{require(read("entered",131072)==original_,"INTENT_CONFLICT");}
void Journal::retainClassic(const Bytes&b){intentCurrent();require(!b.empty()&&b.size()<=65536,"PUBLIC_BOUND");exclusive("classic",b);}
void Journal::retainPair(const Bytes&b){intentCurrent();require(!b.empty()&&b.size()<=65536,"PUBLIC_BOUND");exclusive("pair",b);}
void Journal::terminal(){intentCurrent();auto pair=read("pair",65536);Bytes b;const char d[]="YNX/SOCIAL/FINITE-JOINT-TERMINAL/V1";b.insert(b.end(),d,d+sizeof(d));auto a=sha(original_),p=sha(pair);b.insert(b.end(),a.begin(),a.end());b.insert(b.end(),p.begin(),p.end());exclusive("terminal",b);}
Observation Journal::query()const{Observation o;queryInto(o);return o;}
void Journal::queryInto(Observation&o)const{intentCurrent();o.entered=true;o.classic=read("classic",65536,true);o.pair=read("pair",65536,true);o.terminal=read("terminal",131072,true);if(!o.terminal.empty()){require(!o.pair.empty(),"TERMINAL_WITHOUT_PAIR");Bytes e;const char d[]="YNX/SOCIAL/FINITE-JOINT-TERMINAL/V1";e.insert(e.end(),d,d+sizeof(d));auto a=sha(original_),p=sha(o.pair);e.insert(e.end(),a.begin(),a.end());e.insert(e.end(),p.begin(),p.end());require(e==o.terminal,"TERMINAL_CONFLICT");}}
bool Journal::close(int&first)noexcept{if(closed_){first=first_;return true;}if(close_selected_){first=first_?first_:8;return false;}close_selected_=true;if(::close(fd_)!=0){first_=8;first=first_;return false;}fd_=-1;closed_=true;first=first_;return true;}
}
