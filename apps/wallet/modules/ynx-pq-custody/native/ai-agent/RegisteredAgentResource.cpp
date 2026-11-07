#include "ReviewedAgentResourcePrivate.hpp"
#include "AgentOperation.h"
#include <MobileCanonicalDATA.hpp>
#include <MobileAISigningCapturePairedPrivate.hpp>
#include <SelectedAppDirectoryPrivate.h>
#include <OS43Private.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <array>
#include <atomic>
#include <chrono>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
namespace ynx::mobilepq::aiagent {
namespace data=ynx::auth::mobile::qualified::data;namespace dirs=ynx::mobilepq::directories;
namespace {
uint64_t wall(){return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());}uint64_t mono(){return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());}
Failure fail(int32_t c){return{1,c};}
Failure captureFailure(YNXAIMobileSigningCapture*c){auto result=ynx::auth::ai::mobile::captureOriginalAgentBinding(c);if(result.failure.present)return result.failure;if(result.status)return fail(result.status);return result.originals.version==6&&result.originals.size==sizeof(result.originals)?Failure{}:fail(invalid);}void remember(Failure&f,Failure v){if(v.present&&!f.present)f=v;}
void wipe(Bytes&b)noexcept{volatile uint8_t*p=b.data();for(size_t n=b.size();n;--n)*p++=0;}
Bytes copy(YNXAIMobileSpanV6 s,size_t cap){if(!s.data||!s.bytes||s.bytes>cap)throw invalid;return Bytes(s.data,s.data+s.bytes);}
std::string sha(const Bytes&b){uint8_t out[32];if(os43::platformSHA256(b.data(),b.size(),out))throw notSupplied;static const char h[]="0123456789abcdef";std::string result;for(auto v:out){result+=h[v>>4];result+=h[v&15];}return result;}
bool leaf(const std::string&s){return !s.empty()&&s.size()<=255&&s!="."&&s!=".."&&s.find_first_of("/\\\0",0,3)==std::string::npos;}
bool same(const struct stat&a,const struct stat&b){if(a.st_dev!=b.st_dev||a.st_ino!=b.st_ino||a.st_uid!=b.st_uid||a.st_gid!=b.st_gid||a.st_mode!=b.st_mode||a.st_nlink!=b.st_nlink||a.st_size!=b.st_size)return false;
#ifdef __APPLE__
 return a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
 return a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
#ifdef YNX_AI_AGENT_PUBLIC_CONTROLS
extern "C" int ynx_ai_agent_PUBLIC_close(int);extern "C" ssize_t ynx_ai_agent_PUBLIC_pread(int,void*,size_t,off_t);
int closeFD(int fd){return ynx_ai_agent_PUBLIC_close(fd);}ssize_t readFD(int fd,void*p,size_t n,off_t at){return ynx_ai_agent_PUBLIC_pread(fd,p,n,at);}
#else
int closeFD(int fd){return ::close(fd);}ssize_t readFD(int fd,void*p,size_t n,off_t at){return ::pread(fd,p,n,at);}
#endif
struct HeldFile {
 AgentFilePin pin;int fd=-1;struct stat identity{};Bytes bytes;bool closeSelected=false,closed=false;Failure cleanup{};
 int current(int directory){if(fd<0||closeSelected)return aiagent::closed;struct stat held{},named{};if(fstat(fd,&held)||fstatat(directory,pin.leaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!same(identity,held)||!same(identity,named)||sha(bytes)!=pin.sha256)return invalid;return 0;}
 int open(int directory,const AgentFilePin&p,uint32_t uid,uint32_t gid,size_t exact){pin=p;if(!leaf(p.leaf)||p.bytes!=exact||!data::hex(p.sha256))return invalid;fd=openat(directory,p.leaf.c_str(),O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0)return invalid;struct stat named{};if(fstat(fd,&identity)||fstatat(directory,p.leaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!same(identity,named)||!S_ISREG(identity.st_mode)||identity.st_nlink!=1||(identity.st_mode&0777)!=0600||identity.st_uid!=uid||identity.st_gid!=gid||uint64_t(identity.st_dev)!=p.device||uint64_t(identity.st_ino)!=p.inode||identity.st_size<0||uint64_t(identity.st_size)!=p.bytes)return invalid;bytes.resize(exact);size_t at=0;while(at<exact){auto n=readFD(fd,bytes.data()+at,exact-at,off_t(at));if(n<0&&errno==EINTR)continue;if(n<=0)return invalid;at+=size_t(n);}return current(directory);}
 Failure close(){if(closeSelected)return cleanup;closeSelected=true;wipe(bytes);if(fd>=0){auto original=fd;fd=-1;if(closeFD(original)){cleanup=fail(unknown);return cleanup;}}closed=true;return {};}
 ~HeldFile(){wipe(bytes);/* Never retry ambiguous close or hide ownership. */}
};
std::mutex resourcesMutex;auto&resources=*new std::map<const OriginalRegisteredAgentKeyLoan*,std::shared_ptr<OriginalRegisteredAgentKeyLoan>>;
}
#ifdef YNX_AI_AGENT_PUBLIC_RESOURCE_ROWS
#ifndef YNX_AI_AGENT_PUBLIC_CONTROLS
#error "PUBLIC resource rows forbidden in normal builds"
#endif
const std::vector<ReviewedAgentResource>&reviewedOriginalAIAgentResources(){return YNX_AI_AGENT_PUBLIC_RESOURCE_ROWS();}
#else
const std::vector<ReviewedAgentResource>&reviewedOriginalAIAgentResources(){static const std::vector<ReviewedAgentResource>rows{};return rows;}
#endif
struct OriginalRegisteredAgentKeyLoan::State {
 const std::thread::id actor=std::this_thread::get_id();YNXAIMobileSigningCapture*capture=nullptr;
 const ReviewedAgentResource*row=nullptr;std::unique_ptr<dirs::NativeApplicationDirectory>app;
 int appFD=-1,directoryFD=-1;struct stat directoryIdentity{};HeldFile registration,a,b;Bytes registrationDATA,rootOriginal,profileOriginal;
 Bytes publicA,publicB;uint64_t wall0=0,lastWall=0,mono0=0,expiry=0;std::atomic<bool>retired{false};
 bool ready=false,closeSelected=false,closed=false,released=false,directoryCloseSelected=false,directoryClosed=false;Failure first{},cleanup{};
 bool actorCurrent(){if(actor!=std::this_thread::get_id())return false;auto w=wall(),m=mono();if(expiry<=wall0||w<lastWall||w<wall0||w>=expiry||m<mono0||m-mono0>=expiry-wall0)return false;lastWall=w;return true;}
 int directoryCurrent(){if(!app||app->current()||appFD<0||directoryFD<0||!row)return invalid;struct stat held{},named{};if(fstat(directoryFD,&held)||fstatat(appFD,row->directoryLeaf.c_str(),&named,AT_SYMLINK_NOFOLLOW)||!same(held,directoryIdentity)||!same(named,directoryIdentity)||!S_ISDIR(held.st_mode)||(held.st_mode&0777)!=0700||held.st_uid!=row->uid||held.st_gid!=row->gid)return invalid;return 0;}
 Failure current(YNXAIMobileSigningCapture*c){if(actor!=std::this_thread::get_id())return fail(wrongThread);if(first.present)return first;if(c!=capture||!ready||retired||closeSelected||closed||released||!actorCurrent())return fail(aiagent::closed);auto result=captureFailure(c);if(result.present)return result;if(directoryCurrent()||registration.current(directoryFD)||a.current(directoryFD)||b.current(directoryFD)||!actorCurrent())return fail(invalid);return captureFailure(c);}
};
OriginalRegisteredAgentKeyLoan::OriginalRegisteredAgentKeyLoan(std::shared_ptr<State>s):state_(std::move(s)){}
ResourceAcquisition acquireOriginalRegisteredAgentKeyForCapture(YNXAIMobileSigningCapture*c)noexcept{
 ResourceAcquisition out;try{if(!c){out.failure=fail(invalid);return out;}auto read=ynx::auth::ai::mobile::captureOriginalAgentBinding(c);if(read.failure.present){out.failure=read.failure;return out;}if(read.status){out.failure=fail(read.status);return out;}auto v=read.originals;if(v.version!=6||v.size!=sizeof(v)){out.failure=fail(invalid);return out;}int32_t rc=0;auto expectedRaw=copy(v.agent_expected_original,16384),root=copy(v.root_original,16384),profile=copy(v.profile_original,393216);auto expected=data::parseCanonical(expectedRaw,16384);auto rootDigest=sha(root),profileDigest=sha(profile);const ReviewedAgentResource*selected=nullptr;for(const auto&row:reviewedOriginalAIAgentResources())if(row.rootSHA256==rootDigest&&row.profileSHA256==profileDigest&&row.registrationSHA256==expected.at("registrationDigest").text()){if(selected){out.failure=fail(invalid);return out;}selected=&row;}if(!selected){out.failure=fail(notSupplied);return out;}
 auto state=std::make_shared<OriginalRegisteredAgentKeyLoan::State>();state->capture=c;state->row=selected;state->rootOriginal=std::move(root);state->profileOriginal=std::move(profile);state->wall0=state->lastWall=wall();state->mono0=mono();state->expiry=expected.at("expiresAtMs").number();out.owner=std::shared_ptr<OriginalRegisteredAgentKeyLoan>(new OriginalRegisteredAgentKeyLoan(state));{std::lock_guard<std::mutex>lock(resourcesMutex);if(resources.size()>=64){out.failure=fail(capacity);return out;}resources.emplace(out.owner.get(),out.owner);}auto failOwned=[&](int code){remember(state->first,fail(code));out.failure=state->first;};
 if(selected->uid!=geteuid()||selected->gid!=getegid()||!leaf(selected->directoryLeaf)||selected->registration.leaf==selected->privateA.leaf||selected->registration.leaf==selected->privateB.leaf||selected->privateA.leaf==selected->privateB.leaf||selected->registration.bytes<1||selected->registration.bytes>16384||!state->actorCurrent()){failOwned(invalid);return out;}
 rc=dirs::NativeApplicationDirectory::acquire(state->app);if(rc){failOwned(rc);return out;}dirs::ApplicationDirectoryIdentity appIdentity;if((rc=state->app->borrowForNativeInventory(state->appFD,appIdentity))){failOwned(rc);return out;}
 state->directoryFD=openat(state->appFD,selected->directoryLeaf.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(state->directoryFD<0||fstat(state->directoryFD,&state->directoryIdentity)||uint64_t(state->directoryIdentity.st_dev)!=selected->directoryDevice||uint64_t(state->directoryIdentity.st_ino)!=selected->directoryInode||state->directoryCurrent()){failOwned(invalid);return out;}
 if((rc=state->registration.open(state->directoryFD,selected->registration,selected->uid,selected->gid,selected->registration.bytes))){failOwned(rc);return out;}
 auto record=data::parseCanonical(state->registration.bytes,16384);record.keys({"version","purpose","networkId","canonicalOwner","registrationId","keyEpoch","pkA","pkB","sourceId","instanceId","resourceKey","protectedResourceRef","registeredAtMs","expiresAtMs","state","rootDigest"});if(record.at("state").text()!="active"||record.at("purpose").text()!="PRODUCT-SESSION-AI-TASK-ACTION"||record.at("rootDigest").text()!=rootDigest||sha(state->registration.bytes)!=selected->registrationSHA256){failOwned(invalid);return out;}record.o.erase("state");record.o.erase("rootDigest");data::Value digest;digest.type=data::Value::string;digest.s=selected->registrationSHA256;record.o["registrationDigest"]=std::move(digest);auto encoded=data::canonical(record);state->registrationDATA={encoded.begin(),encoded.end()};if(state->registrationDATA!=expectedRaw){failOwned(invalid);return out;}state->publicA=data::unhex(record.at("pkA").text(),2592);state->publicB=data::unhex(record.at("pkB").text(),64);
 // Independent public registration/current is held BEFORE private record read.
 auto captureBefore=captureFailure(c);if(captureBefore.present){remember(state->first,captureBefore);out.failure=state->first;return out;}if((rc=state->a.open(state->directoryFD,selected->privateA,selected->uid,selected->gid,54))){failOwned(rc);return out;}captureBefore=captureFailure(c);if(captureBefore.present){remember(state->first,captureBefore);out.failure=state->first;return out;}if((rc=state->b.open(state->directoryFD,selected->privateB,selected->uid,selected->gid,150))){failOwned(rc);return out;}
 static const uint8_t headA[]={0x30,0x34,0x02,0x01,0x00,0x30,0x0b,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x03,0x13,0x04,0x22,0x80,0x20};static const uint8_t headB[]={0x30,0x81,0x93,0x02,0x01,0x00,0x30,0x0b,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x03,0x19,0x04,0x81,0x80};if(std::memcmp(state->a.bytes.data(),headA,sizeof(headA))||std::memcmp(state->b.bytes.data(),headB,sizeof(headB))){failOwned(invalid);return out;}state->ready=true;out.failure=state->current(c);remember(state->first,out.failure);return out;
 }catch(int32_t code){out.failure=fail(code);if(out.owner)remember(out.owner->state_->first,out.failure);return out;}catch(...){out.failure=fail(unknown);if(out.owner)remember(out.owner->state_->first,out.failure);return out;}}
Failure OriginalRegisteredAgentKeyLoan::current(YNXAIMobileSigningCapture*c)noexcept{if(state_->actor!=std::this_thread::get_id())return fail(wrongThread);try{auto f=state_->current(c);remember(state_->first,f);return f;}catch(...){remember(state_->first,fail(unknown));return state_->first;}}
Failure OriginalRegisteredAgentKeyLoan::copyOriginalRegistrationDATA(Bytes&out)noexcept{try{auto f=current(state_->capture);if(f.present)return f;auto copy=state_->registrationDATA;f=current(state_->capture);if(f.present)return f;out=std::move(copy);return {};}catch(...){return fail(unknown);}}
Failure OriginalRegisteredAgentKeyLoan::borrowForOriginalFixedSign(YNXAIMobileSigningCapture*c,ProtectedKeySpans&out)noexcept{out={};auto f=current(c);if(f.present)return f;ProtectedKeySpans value{{state_->a.bytes.data(),state_->a.bytes.size()},{state_->b.bytes.data(),state_->b.bytes.size()},{state_->publicA.data(),state_->publicA.size()},{state_->publicB.data(),state_->publicB.size()}};f=current(c);if(f.present)return f;out=value;return {};}
void OriginalRegisteredAgentKeyLoan::retire()noexcept{state_->retired=true;}
Failure OriginalRegisteredAgentKeyLoan::close()noexcept{try{auto&s=*state_;if(s.actor!=std::this_thread::get_id())return fail(wrongThread);s.retired=true;if(s.closed)return s.cleanup;if(!s.closeSelected)s.closeSelected=true;wipe(s.a.bytes);wipe(s.b.bytes);for(auto*file:{&s.b,&s.a,&s.registration}){remember(s.cleanup,file->close());if(!file->closed)return s.cleanup.present?s.cleanup:fail(cleanupDebt);}if(!s.directoryCloseSelected){s.directoryCloseSelected=true;if(s.directoryFD>=0){auto fd=s.directoryFD;s.directoryFD=-1;if(closeFD(fd)){remember(s.cleanup,fail(unknown));return s.cleanup;}}s.directoryClosed=true;}if(!s.directoryClosed)return s.cleanup.present?s.cleanup:fail(cleanupDebt);if(s.app){auto rc=s.app->close();if(rc)remember(s.cleanup,fail(rc));if(!s.app->isClosed())return s.cleanup.present?s.cleanup:fail(cleanupDebt);s.app.reset();}s.closed=true;return s.cleanup;}catch(...){remember(state_->cleanup,fail(unknown));return state_->cleanup;}}
Failure OriginalRegisteredAgentKeyLoan::join()noexcept{if(state_->actor!=std::this_thread::get_id())return fail(wrongThread);return state_->closeSelected?close():Failure{};}
bool OriginalRegisteredAgentKeyLoan::isClosed()const noexcept{return state_->actor==std::this_thread::get_id()&&state_->closed;}
Failure OriginalRegisteredAgentKeyLoan::releaseClosed()noexcept{if(state_->actor!=std::this_thread::get_id())return fail(wrongThread);if(!state_->closed)return fail(cleanupDebt);if(state_->released)return {};state_->released=true;std::lock_guard<std::mutex>lock(resourcesMutex);resources.erase(this);return {};}
}
