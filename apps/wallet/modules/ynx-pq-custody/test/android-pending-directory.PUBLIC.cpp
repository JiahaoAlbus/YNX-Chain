#ifndef YNX_ANDROID_PENDING_DIRECTORY_PUBLIC_CONTROLS
#error "Finite PUBLIC Source/Root/Main seams only, never a product supplier"
#endif
#include "../native/android-pending-device/MainPendingAppDirectoryRequiredPrivate.h"
#include <AndroidDeviceRegistrationPortsPrivate.h>
#include <AndroidDevicePendingJournalPrivate.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <memory>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>
using F=ynx_auth_android_provision_failure_v1;using D=ynx_auth_android_provision_drain_v1;using Source=ynx_auth_android_pending_source_v1;
struct ynx_main_android_pending_appdir_hold_v1{int fd=-1;};
namespace {
constexpr char leaf[]="ynx-product-device-v4";
int sourceObject=1;Source*source=reinterpret_cast<Source*>(&sourceObject);
ynx_auth_android_pending_journal_constraints_v1 root{};
int parent=-1,mainCapture=0,mainBorrow=0,mainCurrent=0,mainClose=0,leafClose=0,authCalls=0,rootCalls=0,approvalCalls=0;
bool revoked=false,sourceLate0=false,approvalLate0=false,rootLate0=false,partialMain0=false,sourceSwitch=false,mainPhysical0=false;
bool unknownLeaf=false,unknownMain=false,nullNoDone=false,untouchedDrain=false,lateClose0=false,mainPending=false;
bool rootReentry=false,currentReentry=false,leafReentry=false,mainReentry=false;
std::string sourceID="actual-PUBLIC-source";std::vector<std::unique_ptr<ynx_main_android_pending_appdir_hold_v1>>holds;
ynx_original_android_pending_directory_v1**published=nullptr;D nested{};
F fail(int32_t code=0,int64_t platform=41){return{1,code,0x5055424c,platform};}
F invalid(){return fail(2);}
bool sameSource(Source*p){return p==source;}
void reenter(){if(published&&*published)ynx_original_android_pending_directory_close_v1(published,&nested);}
ynx_auth_android_pending_directory_identity_v1 identity(int fd){struct stat s{};if(fstat(fd,&s))std::abort();return{uint64_t(s.st_dev),uint64_t(s.st_ino),uint32_t(s.st_uid),uint32_t(s.st_gid),uint32_t(s.st_mode&07777),0};}
void review(uint8_t*b,size_t n,ynx_auth_android_pending_review_data_v1*out){
 using Span=ynx_auth_android_provision_bytes_v1;ynx_auth_android_pending_review_data_v1 v{};v.version=1;v.size=sizeof(v);v.kind=1;v.null_mask=1;v.not_before_ms=1;v.expires_at_ms=9999999;
 size_t at=0;auto put=[&](const std::string&s)->Span{if(at+s.size()>n)std::abort();auto*p=b+at;if(!s.empty())std::memcpy(p,s.data(),s.size());at+=s.size();return{p,s.size()};};
 v.scope_original=put("PUBLIC verified scope only");v.registration_original=put("PUBLIC registration");v.request_original=put("PUBLIC original request");v.challenge_original=put("");v.pending_id=put(std::string(64,'1'));v.registration_digest=put(std::string(64,'2'));v.request_digest=put("");v.approval_digest=put(std::string(64,'3'));
 v.source_id=put(sourceID);v.instance_id=put("actual-instance");v.source_generation=put("1");v.stable_device_identity=put("");v.device_generation=put("2");v.account=put("ynx:PUBLIC-account");v.product_id=put("social");v.client_id=put("native");v.application_id=put("com.ynx.social");v.bundle_id={};v.package_id=put("com.ynx.social");v.origin=put("");v.callback=put("ynx://callback");v.device_id=put("device");v.network[0]=1;v.canonical_owner[0]='0';v.canonical_owner[1]='x';std::memset(v.canonical_owner+2,'a',40);v.device_pk_a[0]=1;v.device_pk_b[0]=2;*out=v;
}
}
extern "C" void ynx_auth_android_pending_source_current_v1(Source*p,F*f){++authCalls;*f=!sameSource(p)?invalid():(revoked||sourceLate0?fail():F{});}
extern "C" void ynx_auth_android_pending_source_copy_review_v1(Source*p,uint8_t*b,size_t n,ynx_auth_android_pending_review_data_v1*out,F*f){++authCalls;if(!sameSource(p)){*f=invalid();return;}review(b,n,out);*f=revoked?fail():F{};}
extern "C" void ynx_auth_android_pending_source_copy_user_approval_v1(Source*p,uint8_t*b,size_t n,ynx_auth_android_provision_bytes_v1*a,ynx_auth_android_provision_bytes_v1*policy,F*f){++approvalCalls;if(!sameSource(p)||n<15){*f=invalid();return;}std::memcpy(b,"approval-policy",15);*a={b,8};*policy={b+8,7};*f=approvalLate0?fail():F{};}
extern "C" void ynx_auth_android_pending_source_copy_journal_constraints_v1(Source*p,ynx_auth_android_pending_journal_constraints_v1*out,F*f){++rootCalls;if(!sameSource(p)){*f=invalid();return;}*out=root;*f=rootLate0?fail():F{};if(rootReentry){rootReentry=false;reenter();}}
extern "C" void ynx_main_android_pending_appdir_hold_capture_v1(Source*p,ynx_main_android_pending_appdir_hold_v1**out,F*f){++mainCapture;if(!sameSource(p)){*f=invalid();return;}auto q=std::make_unique<ynx_main_android_pending_appdir_hold_v1>();q->fd=dup(parent);*out=q.get();holds.push_back(std::move(q));if(sourceSwitch)sourceID="different-source";*f=partialMain0?fail():F{};}
extern "C" void ynx_main_android_pending_appdir_hold_borrow_v1(ynx_main_android_pending_appdir_hold_v1*p,int*out,F*f){++mainBorrow;*out=p->fd;*f={};}
extern "C" void ynx_main_android_pending_appdir_hold_current_v1(ynx_main_android_pending_appdir_hold_v1*p,F*f){++mainCurrent;struct stat s{};*f=fstat(p->fd,&s)?invalid():(mainPhysical0?fail():F{});if(currentReentry){currentReentry=false;reenter();}}
extern "C" void ynx_main_android_pending_appdir_hold_close_v1(ynx_main_android_pending_appdir_hold_v1**p,D*out){++mainClose;if(mainReentry){mainReentry=false;reenter();}if(untouchedDrain)return;if(unknownMain){*out={{},1,0};return;}if(nullNoDone){*p=nullptr;*out={{},0,0};return;}if(mainPending){mainPending=false;*out={fail(),0,0};return;}if(::close((*p)->fd))std::abort();(*p)->fd=-1;*p=nullptr;*out={lateClose0?fail():F{},0,1};}
extern "C" int ynx_android_pending_directory_PUBLIC_close(int fd){++leafClose;if(leafReentry){leafReentry=false;reenter();}if(unknownLeaf){errno=0;return-1;}return::close(fd);}
#define CHECK(x) do{if(!(x)){std::fprintf(stderr,"CHECK line%d: %s\n",__LINE__,#x);return 1;}}while(false)
int main(int argc,char**argv){
 if(argc!=3)return 2;std::string mode=argv[1],base=argv[2];std::string child=base+"/"+leaf;
 parent=::open(base.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC);CHECK(parent>=0);int c=::open(child.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC);CHECK(c>=0);root={1,sizeof(root),identity(parent),identity(c),{}};std::memcpy(root.leaf,leaf,sizeof(leaf));CHECK(::close(c)==0);
 if(mode=="source-pre0")sourceLate0=true;if(mode=="approval0")approvalLate0=true;if(mode=="root-late0")rootLate0=true;if(mode=="main-partial0")partialMain0=true;if(mode=="source-switch")sourceSwitch=true;if(mode=="root-reentry"||mode=="retire-late0")rootReentry=true;if(mode=="retire-late0")rootLate0=true;
 if(mode=="root-parent-mismatch")++root.parent.inode;if(mode=="root-child-mismatch")++root.directory.inode;if(mode=="bad-version")root.version=2;if(mode=="bad-mode")root.directory.mode=0750;if(mode=="reserved")root.parent.reserved=1;if(mode=="leaf-tail")root.leaf[31]='x';if(mode=="root-alias")root.directory=root.parent;
 ynx_original_android_pending_directory_v1*p=nullptr;published=&p;F f{};ynx_original_android_pending_directory_open_v1(source,&p,&f);CHECK(p);
 if(mode=="source-pre0"||mode=="approval0"||mode=="root-late0"||mode=="main-partial0"||mode=="source-switch"||mode=="root-reentry"||mode=="retire-late0"||mode=="root-parent-mismatch"||mode=="root-child-mismatch"||mode=="bad-version"||mode=="bad-mode"||mode=="reserved"||mode=="leaf-tail"||mode=="root-alias"){
  CHECK(f.present==1);if(mode=="source-pre0"||mode=="approval0"||mode=="root-late0"||mode=="retire-late0"||mode=="main-partial0")CHECK(f.code==0&&f.platform_code==41);
  if(mode=="root-reentry"||mode=="retire-late0")CHECK(nested.unknown==0&&!nested.physical_done);if(mode!="main-partial0"&&mode!="source-switch"&&mode!="root-parent-mismatch"&&mode!="root-child-mismatch")CHECK(mainCapture==0);
  int fd=-1;F b{};ynx_original_android_pending_directory_borrow_v1(p,&fd,&b);CHECK(b.present&&fd==-1);
  auto before=f;D d{};ynx_original_android_pending_directory_close_v1(&p,&d);CHECK(!p&&d.physical_done==1&&d.failure.present==1&&d.failure.code==before.code&&d.failure.platform_code==before.platform_code);
  CHECK(leafClose==(mode=="root-child-mismatch"?1:0));CHECK(mainClose==mainCapture);std::puts("PASS partial admission failure retained and same owner cleaned");return 0;
 }
 CHECK(!f.present);
 if(mode=="revoke-before-borrow"){
  revoked=true;int fd=-1;ynx_original_android_pending_directory_borrow_v1(p,&fd,&f);CHECK(f.present&&f.code==0&&fd==-1);int calls=authCalls+rootCalls+approvalCalls;ynx_original_android_pending_directory_current_v1(p,&f);CHECK(!f.present&&calls==authCalls+rootCalls+approvalCalls);D d{};ynx_original_android_pending_directory_close_v1(&p,&d);CHECK(!p&&d.physical_done&&d.failure.present&&d.failure.code==0&&d.failure.platform_code==41&&calls==authCalls+rootCalls+approvalCalls);std::puts("PASS physical-current after observed Source revoke retains original code0 through close");return 0;
 }
 if(mode=="capacity"){
  std::vector<ynx_original_android_pending_directory_v1*>all{p};for(int i=1;i<64;++i){ynx_original_android_pending_directory_v1*q=nullptr;ynx_original_android_pending_directory_open_v1(source,&q,&f);CHECK(q&&!f.present);all.push_back(q);}ynx_original_android_pending_directory_v1*extra=nullptr;ynx_original_android_pending_directory_open_v1(source,&extra,&f);CHECK(!extra&&f.present);
  for(auto q:all){D d{};ynx_original_android_pending_directory_close_v1(&q,&d);CHECK(!q&&d.physical_done);}
  for(int i=0;i<70;++i){ynx_original_android_pending_directory_v1*q=nullptr;ynx_original_android_pending_directory_open_v1(source,&q,&f);CHECK(q&&!f.present);D d{};ynx_original_android_pending_directory_close_v1(&q,&d);CHECK(!q&&d.physical_done);}std::puts("PASS active64 bound and closed history does not consume capacity");return 0;
 }
 int fd=-1;ynx_original_android_pending_directory_borrow_v1(p,&fd,&f);CHECK(fd>=0&&!f.present);int again=-1;ynx_original_android_pending_directory_borrow_v1(p,&again,&f);CHECK(f.present&&again==-1);int sourceCalls=authCalls+rootCalls+approvalCalls;
 if(mode=="physical-after-revoke"){revoked=true;ynx_original_android_pending_directory_current_v1(p,&f);CHECK(!f.present&&authCalls+rootCalls+approvalCalls==sourceCalls);}
 else if(mode=="named-replacement"){CHECK(rename(child.c_str(),(base+"/original-held").c_str())==0);CHECK(mkdir(child.c_str(),0700)==0);ynx_original_android_pending_directory_current_v1(p,&f);CHECK(f.present);}
 else if(mode=="main-current0"){mainPhysical0=true;ynx_original_android_pending_directory_current_v1(p,&f);CHECK(f.present&&f.code==0);}
 else if(mode=="current-reentry"){currentReentry=true;ynx_original_android_pending_directory_current_v1(p,&f);CHECK(f.present&&!nested.unknown&&!nested.physical_done&&p);}
 else if(mode=="actor"){
  std::atomic<bool>ok{false};std::thread other([&]{F x{};ynx_original_android_pending_directory_current_v1(p,&x);D d{};auto q=p;ynx_original_android_pending_directory_close_v1(&q,&d);ok=x.present&&!d.physical_done&&q==p;});other.join();CHECK(ok);
  auto pid=fork();CHECK(pid>=0);if(!pid){F x{};ynx_original_android_pending_directory_current_v1(p,&x);_exit(x.present?0:4);}int status=0;CHECK(waitpid(pid,&status,0)==pid&&WIFEXITED(status)&&!WEXITSTATUS(status));
 }else if(mode=="reused-fd"){
  CHECK(mkdir((base+"/unrelated").c_str(),0700)==0);int other=::open((base+"/unrelated").c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC);CHECK(other>=0&&dup2(other,fd)==fd);CHECK(::close(other)==0);D d{};ynx_original_android_pending_directory_close_v1(&p,&d);CHECK(p&&d.unknown&&!d.physical_done&&leafClose==0&&mainClose==0);struct stat s{};CHECK(!fstat(fd,&s));std::puts("PASS foreign FD substitution is not closed or promoted");return 0;
 }
 if(mode=="unknown-leaf")unknownLeaf=true;if(mode=="unknown-main")unknownMain=true;if(mode=="null-no-done")nullNoDone=true;if(mode=="untouched-drain")untouchedDrain=true;if(mode=="late-close0")lateClose0=true;if(mode=="main-pending")mainPending=true;if(mode=="leaf-reentry")leafReentry=true;if(mode=="main-reentry")mainReentry=true;
 if(mode=="lookup-race"){
  auto*original=p;std::atomic<bool>ready{false},go{false};std::atomic<int>n{0};std::thread thread([&]{ready=true;while(!go)std::this_thread::yield();for(int i=0;i<1000;++i){F x{};ynx_original_android_pending_directory_current_v1(original,&x);if(x.present)++n;}});while(!ready)std::this_thread::yield();go=true;D d{};ynx_original_android_pending_directory_close_v1(&p,&d);thread.join();CHECK(n==1000&&!p&&d.physical_done);std::puts("PASS shared lookup storage survives concurrent foreign lookup/close");return 0;
 }
 D d{};ynx_original_android_pending_directory_close_v1(&p,&d);
 if(mode=="unknown-leaf"||mode=="unknown-main"||mode=="null-no-done"||mode=="untouched-drain"){
  CHECK(p&&d.unknown&&!d.physical_done);if(mode=="unknown-leaf")CHECK(d.failure.present&&d.failure.platform_code==0&&mainClose==0);int l=leafClose,m=mainClose;ynx_original_android_pending_directory_close_v1(&p,&d);CHECK(p&&d.unknown&&!d.physical_done&&l==leafClose&&m==mainClose);std::puts("PASS selected UNKNOWN/no-ack never retries or clears parent debt");return 0;
 }
 if(mode=="main-pending"){CHECK(p&&!d.unknown&&!d.physical_done&&d.failure.present&&d.failure.code==0);revoked=true;int calls=authCalls+rootCalls+approvalCalls;ynx_original_android_pending_directory_close_v1(&p,&d);CHECK(!p&&d.physical_done&&d.failure.present&&d.failure.code==0&&mainClose==2&&leafClose==1&&calls==authCalls+rootCalls+approvalCalls);}
 else CHECK(!p&&d.physical_done&&!d.unknown&&leafClose==1&&mainClose==1);
 if(mode=="late-close0"||mode=="main-current0")CHECK(d.failure.present&&d.failure.code==0&&d.failure.platform_code==41);
 if(mode=="leaf-reentry"||mode=="main-reentry")CHECK(nested.unknown&&!nested.physical_done);
 CHECK(authCalls+rootCalls+approvalCalls==sourceCalls);std::printf("PASS %s physical directory lifecycle\n",mode.c_str());return 0;
}
