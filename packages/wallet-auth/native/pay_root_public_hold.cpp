#include "pay_root_public_hold_private.hpp"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <dlfcn.h>
#include <limits.h>
#include <chrono>
#include <mutex>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#include <libproc.h>
#else
#include <openssl/sha.h>
#endif

namespace ynx::wallet::pay::root_physical {
namespace {
using Clock=std::chrono::steady_clock;
uint64_t wall() {return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
Identity ident(const struct stat&s){return {uint64_t(s.st_dev),uint64_t(s.st_ino),uint64_t(s.st_uid),uint64_t(s.st_gid),uint64_t(s.st_mode&07777),uint64_t(s.st_nlink),uint64_t(s.st_size)};}
bool equal(const Identity&a,const Identity&b){return a.device==b.device&&a.inode==b.inode&&a.uid==b.uid&&a.gid==b.gid&&a.mode==b.mode&&a.links==b.links&&a.bytes==b.bytes;}
bool dirsame(const struct stat&a,const struct stat&b){return S_ISDIR(a.st_mode)&&S_ISDIR(b.st_mode)&&a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&(a.st_mode&07777)==(b.st_mode&07777);}
bool same(const struct stat&a,const struct stat&b){
#if defined(__APPLE__)
 return equal(ident(a),ident(b))&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
 return equal(ident(a),ident(b))&&a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
bool canonical(const std::string&p){char b[PATH_MAX];return !p.empty()&&realpath(p.c_str(),b)&&p==b;}
bool safe_name(const std::string&s){return !s.empty()&&s!="."&&s!=".."&&s.find('/')==std::string::npos&&s.find('\0')==std::string::npos;}
bool root_dir(const struct stat&s){
#if defined(YNX_PAY_PUBLIC_FS_TEST)
 return S_ISDIR(s.st_mode)&&(s.st_uid==getuid()||s.st_uid==0);
#else
 return S_ISDIR(s.st_mode)&&s.st_uid==0&&!(s.st_mode&0022);
#endif
}
bool root_file(const struct stat&s){
#if defined(YNX_PAY_PUBLIC_FS_TEST)
 return S_ISREG(s.st_mode)&&s.st_uid==getuid()&&!(s.st_mode&0022)&&s.st_nlink==1;
#else
 return S_ISREG(s.st_mode)&&s.st_uid==0&&!(s.st_mode&0022)&&s.st_nlink==1;
#endif
}
std::string sha(const std::vector<unsigned char>&b){unsigned char h[32];
#if defined(__APPLE__)
 CC_SHA256(b.data(),CC_LONG(b.size()),h);
#else
 SHA256(b.data(),b.size(),h);
#endif
 const char*x="0123456789abcdef";std::string o;for(unsigned char c:h){o+=x[c>>4];o+=x[c&15];}return o;}
int dirflags(){
#if defined(__linux__)
 return O_PATH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC;
#else
 return O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC;
#endif
}
}
struct PublicOriginalHold::Impl {
 struct Held {int fd;std::string path;struct stat original;bool close_selected=false;};
 std::mutex mu;Spec spec;std::vector<Held> dirs;Held file{-1,"",{}};
 std::vector<unsigned char> bytes;Clock::time_point deadline;uint64_t floor=0;
 bool retired=false,closed=false;Code first=Code::ok;
 Code fail(Code c){if(first==Code::ok)first=c;return first;}
 Code current_locked(bool code_only=false){
  if(closed||retired)return fail(Code::retired);
  if(first!=Code::ok)return first;
  uint64_t now=wall();if(now<floor||now<spec.not_before_ms||(!code_only&&(now>=spec.expires_ms||Clock::now()>=deadline)))return fail(Code::window);floor=now;
  for(const Held&h:dirs){struct stat a,b;if(h.close_selected||fstat(h.fd,&a)||lstat(h.path.c_str(),&b)||!dirsame(a,h.original)||!dirsame(a,b))return fail(Code::identity);}
  struct stat a,b;if(file.fd<0||file.close_selected||fstat(file.fd,&a)||lstat(file.path.c_str(),&b)||!same(a,file.original)||!same(a,b))return fail(Code::identity);
  return Code::ok;
 }
};
PublicOriginalHold::PublicOriginalHold(std::unique_ptr<Impl>p):p_(std::move(p)){}
PublicOriginalHold::~PublicOriginalHold(){if(!closed())std::terminate();}
bool PublicOriginalHold::closed()const noexcept{std::lock_guard<std::mutex>l(p_->mu);return p_->closed;}
Code PublicOriginalHold::current()noexcept{std::lock_guard<std::mutex>l(p_->mu);return p_->current_locked();}
Code PublicOriginalHold::current_code_only()noexcept{std::lock_guard<std::mutex>l(p_->mu);return p_->current_locked(true);}
Code PublicOriginalHold::current_native_image(const void*entry,const void*marker)noexcept{
 std::lock_guard<std::mutex>l(p_->mu);Code c=p_->current_locked();if(c!=Code::ok)return c;
 c=same_native_image(entry,marker,p_->file.path);if(c!=Code::ok)return p_->fail(c);
 return p_->current_locked();
}
Code PublicOriginalHold::current_native_image_code_only(const void*entry,const void*marker)noexcept{
 std::lock_guard<std::mutex>l(p_->mu);Code c=p_->current_locked(true);if(c!=Code::ok)return c;c=same_native_image(entry,marker,p_->file.path);if(c!=Code::ok)return p_->fail(c);return p_->current_locked(true);
}
void PublicOriginalHold::retire()noexcept{std::lock_guard<std::mutex>l(p_->mu);p_->retired=true;}
Code PublicOriginalHold::read_original(std::vector<unsigned char>&out)noexcept{
 try{std::lock_guard<std::mutex>l(p_->mu);Code c=p_->current_locked();if(c!=Code::ok)return c;auto copy=p_->bytes;c=p_->current_locked();if(c==Code::ok)out.swap(copy);return c;}catch(...){return Code::io;}
}
Code PublicOriginalHold::close()noexcept{
 std::lock_guard<std::mutex>l(p_->mu);p_->retired=true;if(p_->closed)return p_->first;
 auto close_one=[&](Impl::Held&h){if(h.fd<0)return true;if(h.close_selected){p_->fail(Code::close_debt);return false;}h.close_selected=true;
  if(::close(h.fd)!=0){p_->fail(Code::close_debt);return false;}h.fd=-1;return true;};
 if(!close_one(p_->file))return p_->first;
 for(auto it=p_->dirs.rbegin();it!=p_->dirs.rend();++it)if(!close_one(*it))return p_->first;
 p_->closed=true;return p_->first;
}
Acquisition hold_internal(const Spec&s,bool capture)noexcept{
 Acquisition r{nullptr,Code::not_supplied};
 try{
  auto p=std::make_unique<PublicOriginalHold::Impl>();p->spec=s;
  r.owner=std::unique_ptr<PublicOriginalHold>(new PublicOriginalHold(std::move(p)));
  auto&v=*r.owner->p_;auto fail=[&](Code c){r.error=v.fail(c);return std::move(r);};
  uint64_t now=wall();if(!s.maximum_bytes||s.maximum_bytes>134217728||(!capture&&(s.original.bytes>s.maximum_bytes||s.sha256.size()!=64||!std::all_of(s.sha256.begin(),s.sha256.end(),[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');}))))return fail(Code::content);
  if(now<s.not_before_ms||now>=s.expires_ms||s.expires_ms-now>30000)return fail(Code::window);
  v.floor=now;v.deadline=Clock::now()+std::chrono::milliseconds(s.expires_ms-now);
  if(!safe_name(s.literal_leaf)||!canonical(s.canonical_parent))return fail(Code::path);
  std::string cur="/";std::vector<std::string> paths{cur};size_t at=1;
  while(at<s.canonical_parent.size()){size_t e=s.canonical_parent.find('/',at);if(e==std::string::npos)e=s.canonical_parent.size();cur=s.canonical_parent.substr(0,e);paths.push_back(cur);at=e+1;}
  for(const auto&path:paths){v.dirs.push_back({-1,path,{}});auto&h=v.dirs.back();h.fd=open(path.c_str(),dirflags());if(h.fd<0)return fail(Code::io);struct stat named;if(fstat(h.fd,&h.original)||lstat(path.c_str(),&named)||!dirsame(h.original,named)||!root_dir(named))return fail(Code::identity);}
  {auto a=ident(v.dirs.back().original),b=s.parent;if(a.device!=b.device||a.inode!=b.inode||a.uid!=b.uid||a.gid!=b.gid||a.mode!=b.mode)return fail(Code::identity);}
  v.file.path=s.canonical_parent+"/"+s.literal_leaf;
  v.file.fd=openat(v.dirs.back().fd,s.literal_leaf.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);
  if(v.file.fd<0)return fail(Code::io);
  if(fstat(v.file.fd,&v.file.original)||!root_file(v.file.original)||v.file.original.st_size<0||uint64_t(v.file.original.st_size)>s.maximum_bytes||(!capture&&!equal(ident(v.file.original),s.original)))return fail(Code::identity);
  v.bytes.resize(size_t(v.file.original.st_size));size_t n=0;while(n<v.bytes.size()){ssize_t got=pread(v.file.fd,v.bytes.data()+n,v.bytes.size()-n,off_t(n));if(got<=0)return fail(Code::io);n+=size_t(got);}
  if(capture){v.spec.original=ident(v.file.original);v.spec.sha256=sha(v.bytes);}else if(sha(v.bytes)!=s.sha256)return fail(Code::content);
  r.error=v.current_locked();return r;
 }catch(...){r.error=Code::io;return r;}
}
Acquisition hold_original(const Spec&s)noexcept{return hold_internal(s,false);}
Acquisition capture_root_public_original(const RootPublicLocator&x)noexcept{return hold_internal({x.parent,x.leaf,x.parent_identity,{},"",x.not_before_ms,x.expires_ms,x.maximum_bytes},true);}
Code same_native_image(const void*a,const void*b,const std::string&p)noexcept{
 try{Dl_info x{},y{};if(!a||!b||!canonical(p)||!dladdr(a,&x)||!dladdr(b,&y)||!x.dli_fbase||x.dli_fbase!=y.dli_fbase||!x.dli_fname||!y.dli_fname)return Code::identity;
 char px[PATH_MAX],py[PATH_MAX];if(!realpath(x.dli_fname,px)||!realpath(y.dli_fname,py)||p!=px||p!=py)return Code::identity;
#if defined(__APPLE__)
 struct stat s{};if(lstat(p.c_str(),&s)||!S_ISREG(s.st_mode))return Code::identity;
 for(const void*addr:{a,b}){proc_regionwithpathinfo info{};int n=proc_pidinfo(getpid(),PROC_PIDREGIONPATHINFO,uint64_t(addr),&info,sizeof info);const auto&v=info.prp_vip.vip_vi.vi_stat;
  if(n!=sizeof info||!memchr(info.prp_vip.vip_path,0,sizeof info.prp_vip.vip_path)||p!=info.prp_vip.vip_path||v.vst_dev!=uint32_t(s.st_dev)||v.vst_ino!=uint64_t(s.st_ino)||v.vst_size!=s.st_size)return Code::identity;}
 return Code::ok;
#else
 // No mapped-vnode implementation has been supplied for a different platform.
 // dladdr/path equality alone MUST NOT qualify an already mapped image.
 return Code::not_supplied;
#endif
 }catch(...){return Code::io;}
}
}
