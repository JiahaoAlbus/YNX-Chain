// Actual protected Source private opener CODE, not a renderer/HTTP key loader.
// NO key generation, guessed path, asset key, restore, export or generic signer.
// Normal release rows are EMPTY. Root independently supplies admitted records.
#include "original-ide-deployment-v2-key-loan.h"
#include <array>
#include <vector>
#include <string>
#include <mutex>
#include <unordered_set>
#include <memory>
#include <thread>
#include <chrono>
#include <cstring>
#include <cerrno>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif
namespace {
enum:int{OK=0,INVALID=1,NOT_SUPPLIED=2,UNSAFE=3,CHANGED=4,EXPIRED=5,CLOSED=6,CLOSE_UNKNOWN=7};
struct FilePin{const char*path;uint64_t device,inode;uint32_t uid,gid,mode;size_t bytes;std::array<uint8_t,32>sha256;};
// Canonical public role/current/approval context is separately Source-verified.
// These are private immutable release selections, never args/ENV/JSON setters.
struct RootKeyReleaseRow{YNXIDEDeploymentV2LoanContext context;FilePin source_current,approval,record_a,record_b;std::array<uint8_t,2592>pk_a;std::array<uint8_t,64>pk_b;};
const std::array<RootKeyReleaseRow,0>&root_rows(){static const std::array<RootKeyReleaseRow,0>rows{};return rows;}
void wipe(std::vector<uint8_t>&v){volatile uint8_t*p=v.data();for(size_t n=v.size();n;n--)*p++=0;}
std::array<uint8_t,32>hash(const std::vector<uint8_t>&b){std::array<uint8_t,32>out{};
#ifdef __APPLE__
 CC_SHA256(b.data(),(CC_LONG)b.size(),out.data());
#else
 SHA256(b.data(),b.size(),out.data());
#endif
 return out;}
uint64_t wall(){return(uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
uint64_t mono(){return(uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
bool same_stat(const struct stat&a,const struct stat&b){
 if(a.st_dev!=b.st_dev||a.st_ino!=b.st_ino||a.st_uid!=b.st_uid||a.st_gid!=b.st_gid||a.st_mode!=b.st_mode||a.st_nlink!=b.st_nlink||a.st_size!=b.st_size)return false;
#ifdef __APPLE__
 return a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
 return a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
struct ProtectedOriginal{
 FilePin pin{};int fd=-1;struct stat selected{};std::vector<std::pair<std::string,struct stat>>parents;std::vector<uint8_t>bytes;bool close_selected=false;int close_first=0;
 int open_original(const FilePin&p,size_t exact_bytes){
  pin=p;if(!p.path||p.path[0]!='/'||!p.bytes||p.bytes!=exact_bytes||p.mode!=0600||p.uid!=getuid())return UNSAFE;
  std::string path(p.path);if(path.find("//")!=std::string::npos||path.find("/../")!=std::string::npos||path.find("/./")!=std::string::npos)return UNSAFE;
  for(size_t at=1;;){size_t next=path.find('/',at);if(next==std::string::npos)break;const std::string parent=path.substr(0,next);struct stat s{};if(lstat(parent.c_str(),&s)||!S_ISDIR(s.st_mode)||S_ISLNK(s.st_mode)||(s.st_mode&0022)||(s.st_uid!=0&&s.st_uid!=getuid()))return UNSAFE;parents.emplace_back(parent,s);at=next+1;}
  fd=::open(p.path,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0)return UNSAFE;
  struct stat named{};if(fstat(fd,&selected)||lstat(p.path,&named)||!S_ISREG(selected.st_mode)||selected.st_nlink!=1||selected.st_uid!=p.uid||selected.st_gid!=p.gid||(selected.st_mode&0777)!=p.mode||(uint64_t)selected.st_dev!=p.device||(uint64_t)selected.st_ino!=p.inode||(size_t)selected.st_size!=p.bytes||!same_stat(selected,named))return UNSAFE;
  bytes.resize(p.bytes);size_t done=0;while(done<bytes.size()){ssize_t n=::read(fd,bytes.data()+done,bytes.size()-done);if(n<0&&errno==EINTR)continue;if(n<=0)return CHANGED;done+=(size_t)n;}
  if(hash(bytes)!=p.sha256)return CHANGED;return current();
 }
 int current(){if(fd<0||close_selected)return CLOSED;struct stat a{},b{};if(fstat(fd,&a)||lstat(pin.path,&b)||!same_stat(selected,a)||!same_stat(selected,b))return CHANGED;for(auto&p:parents){struct stat s{};if(lstat(p.first.c_str(),&s)||!same_stat(p.second,s)||!S_ISDIR(s.st_mode))return CHANGED;}return hash(bytes)==pin.sha256?OK:CHANGED;}
 int close(){if(close_selected)return close_first;close_selected=true;wipe(bytes);if(fd>=0&&::close(fd)){close_first=CLOSE_UNKNOWN;return close_first;}fd=-1;return OK;}
 ~ProtectedOriginal(){wipe(bytes);/* no uncertain-close retry from destructor */}
};
bool equal_context(const YNXIDEDeploymentV2LoanContext&a,const YNXIDEDeploymentV2LoanContext&b){return a.version==2&&a.size==sizeof(a)&&b.version==2&&b.size==sizeof(b)&&!memcmp(a.source_scope_sha256,b.source_scope_sha256,32)&&!memcmp(a.approved_payload_sha3_512,b.approved_payload_sha3_512,64)&&!memcmp(a.approved_payload_sha512,b.approved_payload_sha512,64)&&a.payload_bytes==b.payload_bytes&&a.publisher_epoch==b.publisher_epoch&&a.issuer_epoch==b.issuer_epoch&&a.source_generation==b.source_generation&&a.source_sequence==b.source_sequence&&a.source_floor==b.source_floor&&a.not_before_ms==b.not_before_ms&&a.expires_ms==b.expires_ms;}
std::mutex registry_mutex;
std::unordered_set<YNXIDEDeploymentV2KeyLoan*>registry;
std::unordered_set<std::string>selected_operations;
}
struct YNXIDEDeploymentV2KeyLoan{
 const RootKeyReleaseRow*row;std::thread::id thread=std::this_thread::get_id();ProtectedOriginal source,approval,a,b;uint64_t wall_floor=0,mono_floor=0,deadline=0;bool retired=false,close_selected=false;int first=0,close_first=0;
 explicit YNXIDEDeploymentV2KeyLoan(const RootKeyReleaseRow*r):row(r){}
 int remember(int code){if(code&&!first)first=code;return first?first:code;}
 int clock(){uint64_t w=wall(),m=mono();if(w<row->context.not_before_ms||w>=row->context.expires_ms||w<wall_floor||m<mono_floor||(deadline&&m>=deadline))return EXPIRED;wall_floor=w;mono_floor=m;return OK;}
 int current(const YNXIDEDeploymentV2LoanContext&c){if(thread!=std::this_thread::get_id()||retired||close_selected)return CLOSED;if(first)return first;if(!equal_context(c,row->context))return remember(INVALID);int rc=clock();for(auto*p:{&source,&approval,&a,&b})if(!rc)rc=p->current();if(!rc)rc=clock();return rc?remember(rc):OK;}
 int open(){if(row->context.payload_bytes<1||row->context.payload_bytes>16384||!row->context.publisher_epoch||!row->context.issuer_epoch||!row->context.source_generation||row->context.source_floor>row->context.source_sequence||row->source_current.bytes>393216||row->approval.bytes>32768)return remember(INVALID);int rc=clock();if(rc)return remember(rc);const uint64_t m=mono(),remaining=row->context.expires_ms-wall();if(remaining>30000||UINT64_MAX-m<remaining)return remember(EXPIRED);deadline=m+remaining;
  // Public current + approval ORIGINAL files are held before private bytes.
  if((rc=source.open_original(row->source_current,row->source_current.bytes))||(rc=approval.open_original(row->approval,row->approval.bytes))||(rc=clock()))return remember(rc);
  if((rc=a.open_original(row->record_a,54))||(rc=source.current())||(rc=approval.current())||(rc=clock()))return remember(rc);
  if((rc=b.open_original(row->record_b,150)))return remember(rc);
  static const uint8_t headA[]={0x30,0x34,0x02,0x01,0x00,0x30,0x0b,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x03,0x13,0x04,0x22,0x80,0x20};
  static const uint8_t headB[]={0x30,0x81,0x93,0x02,0x01,0x00,0x30,0x0b,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x03,0x19,0x04,0x81,0x80};
  if(memcmp(a.bytes.data(),headA,sizeof(headA))||memcmp(b.bytes.data(),headB,sizeof(headB)))return remember(INVALID);
  return current(row->context);
 }
 int close(){if(close_selected)return close_first;close_selected=true;retired=true;for(auto*p:{&b,&a,&approval,&source}){int rc=p->close();if(rc&&!close_first)close_first=rc;}return close_first;}
};
extern "C" int ynx_source_ide_deployment_v2_key_loan_acquire(const YNXIDEDeploymentV2LoanContext*c,YNXIDEDeploymentV2KeyLoan**out){
 if(!c||!out)return INVALID;*out=nullptr;const RootKeyReleaseRow*selected=nullptr;for(const auto&r:root_rows())if(equal_context(*c,r.context)){if(selected)return INVALID;selected=&r;}if(!selected)return NOT_SUPPLIED;
 auto*p=new(std::nothrow)YNXIDEDeploymentV2KeyLoan(selected);if(!p)return INVALID;{std::lock_guard<std::mutex>lock(registry_mutex);const std::string operation((const char*)c->source_scope_sha256,32);if(selected_operations.count(operation)){delete p;return INVALID;}selected_operations.insert(operation);registry.insert(p);}*out=p;try{return p->open();}catch(...){return p->remember(23);}
}
extern "C" int ynx_source_ide_deployment_v2_key_loan_current(YNXIDEDeploymentV2KeyLoan*p,const YNXIDEDeploymentV2LoanContext*c){std::lock_guard<std::mutex>lock(registry_mutex);if(!p||!c||!registry.count(p))return INVALID;return p->current(*c);}
extern "C" int ynx_source_ide_deployment_v2_key_loan_borrow(YNXIDEDeploymentV2KeyLoan*p,const YNXIDEDeploymentV2LoanContext*c,YNXIDEDeploymentV2NativeKeySpans*out){std::lock_guard<std::mutex>lock(registry_mutex);if(!out)return INVALID;*out={};if(!p||!c||!registry.count(p))return INVALID;int rc=p->current(*c);if(rc)return rc;const YNXIDEDeploymentV2NativeKeySpans borrowed={p->a.bytes.data(),p->a.bytes.size(),p->b.bytes.data(),p->b.bytes.size(),p->row->pk_a.data(),p->row->pk_a.size(),p->row->pk_b.data(),p->row->pk_b.size()};rc=p->current(*c);if(rc)return rc;*out=borrowed;return OK;}
extern "C" void ynx_source_ide_deployment_v2_key_loan_retire(YNXIDEDeploymentV2KeyLoan*p){std::lock_guard<std::mutex>lock(registry_mutex);if(p&&registry.count(p))p->retired=true;}
extern "C" int ynx_source_ide_deployment_v2_key_loan_join(YNXIDEDeploymentV2KeyLoan*p){std::lock_guard<std::mutex>lock(registry_mutex);return p&&registry.count(p)&&p->thread==std::this_thread::get_id()?OK:INVALID;}
extern "C" int ynx_source_ide_deployment_v2_key_loan_close(YNXIDEDeploymentV2KeyLoan*p){std::lock_guard<std::mutex>lock(registry_mutex);if(!p||!registry.count(p)||p->thread!=std::this_thread::get_id())return INVALID;return p->close();}
