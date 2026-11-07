#include "MobileRegisteredReceiptPrivate.hpp"
#include "MobileReceiptNativeSelectionPrivate.hpp"
#include "MobileRegisteredReceiptReleasePrivate.hpp"
#include "MobileHeldOriginals.hpp"
#include "SelectedAppDirectoryPrivate.h"
#include <atomic>
#include <chrono>
#include <map>
#include <mutex>
#include <thread>
#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <limits>
namespace ynx::auth::mobile::receipt {
namespace q=ynx::auth::mobile::qualified;namespace d=q::data;namespace engine=ynx::core::mobile::registered;
using Failure=engine::Failure;
enum:int32_t{invalid=11601,notSupplied=11602,changed=11603,expired=11604,wrongThread=11605,debt=11606,unknown=11607};
namespace {
void first(Failure&f,int32_t code){if(!f.present)f={true,code};}
void first(Failure&f,Failure cause){if(cause.present&&!f.present)f=cause;}
void need(bool p){if(!p)throw std::runtime_error("REGISTERED_RECEIPT_BINDING");}
#ifdef YNX_RECEIPT_PUBLIC_CLOCK
extern "C" uint64_t ynx_receipt_PUBLIC_wall();extern "C" uint64_t ynx_receipt_PUBLIC_mono();
uint64_t wall(){return ynx_receipt_PUBLIC_wall();}uint64_t mono(){return ynx_receipt_PUBLIC_mono();}
#else
uint64_t wall(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
uint64_t mono(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
#endif
bool leaf(const std::string&s){return!s.empty()&&s.size()<=128&&s!="."&&s!=".."&&s.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")==std::string::npos;}
}
struct OriginalEngineSource final {
 std::thread::id actor=std::this_thread::get_id();const ReviewedReceiptRelease*row=nullptr;
 std::unique_ptr<ynx::mobilepq::directories::NativeApplicationDirectory>application;
 std::shared_ptr<q::physical::HeldOriginals>account,originals;
 q::SourceOriginals raw;q::SourceMetadata metadata;EngineSelection selection;
 int appFD=-1,accountFD=-1,accountOpen=-1,sourceOpen=-1;
 uint64_t wall0=0,mono0=0,lastWall=0;size_t borrowers=0;
 std::atomic<bool>retired{false};bool ready=false,closeSelected=false,closed=false;
 Failure failure,closeFailure;
};
class RegisteredAccountReceipt final {
 friend ReceiptAcquisition acquireOriginalRegisteredAccountReceipt()noexcept;
 friend engine::ReadResult readOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&,ReceiptDATA&)noexcept;
 friend engine::ReadResult originalReceiptCurrent(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
 friend void retireOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
 friend Failure joinOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
 friend Failure closeOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
 friend bool originalReceiptClosed(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
 friend engine::ReadResult readOriginalSourceSelection(const std::shared_ptr<RegisteredAccountReceipt>&,OriginalSourceSelection&)noexcept;
 friend DirectoryAcquisition borrowOriginalReceiptDirectory(const std::shared_ptr<RegisteredAccountReceipt>&,uint32_t)noexcept;
 friend engine::ReadResult currentOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
 friend Failure closeOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
 std::thread::id actor_=std::this_thread::get_id();
 std::shared_ptr<OriginalEngineSource>source_;engine::CommittedAccountProof*proof_=nullptr;
 engine::CapturedPolicy captured_;ReceiptDATA data_;Failure failure_,closeFailure_;
 std::atomic<bool>retired_{false};bool ready_=false,closeSelected_=false,engineClose_=false,closed_=false;
 size_t directoryChildren_=0;
 RegisteredAccountReceipt()=default;
 Failure fail(Failure f)noexcept{first(failure_,f);retired_=true;if(source_)source_->retired=true;return failure_;}
 int32_t finishClose()noexcept;
};
class ReceiptDirectoryLoan final {
 friend DirectoryAcquisition borrowOriginalReceiptDirectory(const std::shared_ptr<RegisteredAccountReceipt>&,uint32_t)noexcept;
 friend engine::ReadResult currentOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
 friend engine::ReadResult readOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&,DirectoryDATA&)noexcept;
 friend Failure closeOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
 friend bool originalReceiptDirectoryClosed(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
 std::shared_ptr<RegisteredAccountReceipt>receipt_;std::string leaf_;
 DirectoryDATA data_;Failure first_,closeFailure_;
 bool parentHeld_=false,closeSelected_=false,closed_=false;
 ReceiptDirectoryLoan()=default;
};
namespace {
std::mutex&mutex=*new std::mutex;
auto&sources=*new std::map<OriginalEngineSource*,std::shared_ptr<OriginalEngineSource>>;
auto&receipts=*new std::map<const RegisteredAccountReceipt*,std::shared_ptr<RegisteredAccountReceipt>>;
auto&directoryLoans=*new std::map<const ReceiptDirectoryLoan*,std::shared_ptr<ReceiptDirectoryLoan>>;
std::shared_ptr<OriginalEngineSource>known(OriginalEngineSource*p){std::lock_guard<std::mutex>l(mutex);auto i=sources.find(p);return i==sources.end()?nullptr:i->second;}
bool known(const std::shared_ptr<RegisteredAccountReceipt>&p){if(!p)return false;std::lock_guard<std::mutex>l(mutex);auto i=receipts.find(p.get());return i!=receipts.end()&&i->second==p;}
bool known(const std::shared_ptr<ReceiptDirectoryLoan>&p){if(!p)return false;std::lock_guard<std::mutex>l(mutex);auto i=directoryLoans.find(p.get());return i!=directoryLoans.end()&&i->second==p;}
bool clock(OriginalEngineSource&s){auto w=wall(),m=mono();if(s.retired||!s.ready||s.metadata.expires<=s.wall0||w<s.lastWall||w<s.wall0||w>=s.metadata.expires||m<s.mono0||m-s.mono0>=s.metadata.expires-s.wall0)return false;s.lastWall=w;return true;}
int32_t fail(OriginalEngineSource&s,int32_t code){first(s.failure,code);s.retired=true;return code;}
int32_t physical(OriginalEngineSource&s){if(s.application->current()||s.account->current()||s.originals->current())return changed;struct stat a{},o{};if(s.row->accountLeaf.empty()){if(fstat(s.appFD,&a))return changed;}else if(fstatat(s.appFD,s.row->accountLeaf.c_str(),&a,AT_SYMLINK_NOFOLLOW))return changed;if(fstatat(s.accountFD,s.row->sourceLeaf.c_str(),&o,AT_SYMLINK_NOFOLLOW))return changed;for(auto*p:{&a,&o})if(!S_ISDIR(p->st_mode)||(p->st_mode&07777)!=0700||p->st_uid!=s.row->uid||p->st_gid!=s.row->gid)return changed;return(uint64_t)a.st_dev==s.row->accountDevice&&(uint64_t)a.st_ino==s.row->accountInode&&(uint64_t)o.st_dev==s.row->sourceDevice&&(uint64_t)o.st_ino==s.row->sourceInode?0:changed;}
int32_t initialize(OriginalEngineSource&s,const ReviewedReceiptRelease&r){s.row=&r;need((r.accountLeaf.empty()||leaf(r.accountLeaf))&&leaf(r.sourceLeaf)&&!r.engineReference.empty()&&r.engineReference.size()<=128&&!r.chainId.empty()&&r.chainId.size()<=128&&r.uid==geteuid()&&r.gid==getegid());if(auto e=ynx::mobilepq::directories::NativeApplicationDirectory::acquire(s.application))return e;ynx::mobilepq::directories::ApplicationDirectoryIdentity app;if(auto e=s.application->borrowForNativeInventory(s.appFD,app))return e;s.accountOpen=r.accountLeaf.empty()?-1:openat(s.appFD,r.accountLeaf.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);int account=r.accountLeaf.empty()?s.appFD:s.accountOpen;need(account>=0);q::physical::DirectorySpec a{"",r.uid,r.gid,r.accountDevice,r.accountInode,{}};a.borrowedNativeFD=account;auto held=q::physical::openSelectedPublicOriginals(a);s.account=held.owner;if(held.error)return held.error;struct stat ignored{};if(auto e=s.account->borrowDirectory(s.accountFD,ignored))return e;s.sourceOpen=openat(s.accountFD,r.sourceLeaf.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);need(s.sourceOpen>=0);q::physical::DirectorySpec files{"",r.uid,r.gid,r.sourceDevice,r.sourceInode,{{"root.original",16384},{"enrollment.original",393216},{"profile.original",393216},{"current.original",393216},{"registered-root.original",8388608},{"registered-profile.original",8388608},{"registered-current.original",8388608},{"registered-subject.original",8388608}}};files.borrowedNativeFD=s.sourceOpen;held=q::physical::openSelectedPublicOriginals(files);s.originals=held.owner;if(held.error)return held.error;const char*names[]={"root.original","enrollment.original","profile.original","current.original"};q::Bytes*values[]={&s.raw.root,&s.raw.enrollment,&s.raw.profile,&s.raw.current};for(unsigned i=0;i<4;++i)need(!s.originals->copy(names[i],*values[i]));const char*roles[]={"registered-root.original","registered-profile.original","registered-current.original","registered-subject.original"};for(unsigned i=0;i<4;++i)need(!s.originals->copy(roles[i],s.raw.registered[i]));s.wall0=s.lastWall=wall();s.mono0=mono();s.metadata=q::verifySourceOriginals(s.raw,r.sourcePolicy,s.wall0);need(s.metadata.mode==2&&r.sourcePolicy.originalRegistrationDigest.empty()&&!r.nativeChainID.empty()&&s.metadata.context.at("nativeChainID").text()==r.nativeChainID);auto profile=d::parseCanonical(s.raw.profile,393216);auto body=d::parseCanonical(d::unbase64url(profile.at("body").text(),65536),65536);s.selection={1,r.sourcePolicy.platform,r.engineReference,r.chainId,s.metadata.context.at("account").text(),body.at("sourceId").text(),body.at("instanceId").text(),r.minimumCommittedHeight,s.metadata.expires};s.ready=true;auto f=originalEngineSourceCurrent(&s);return f.present?(f.code?f.code:changed):0;}
int32_t closeSource(OriginalEngineSource&s){s.retired=true;if(s.borrowers)return debt;if(s.closeSelected)return s.closeFailure.present?s.closeFailure.code:0;s.closeSelected=true;auto closeHeld=[&](auto&p){if(!p)return true;auto rc=p->close();if(rc)first(s.closeFailure,rc);return p->closed();};if(!closeHeld(s.originals)||!closeHeld(s.account))return debt;for(int*p:{&s.sourceOpen,&s.accountOpen})if(*p>=0){int fd=*p;*p=-1;if(::close(fd)){first(s.closeFailure,unknown);return unknown;}}if(s.application){auto rc=s.application->close();if(rc)first(s.closeFailure,rc);if(!s.application->isClosed())return debt;}s.closed=true;s.raw={};s.metadata={};s.selection={};s.originals.reset();s.account.reset();s.application.reset();s.row=nullptr;s.appFD=s.accountFD=-1;return s.closeFailure.present?s.closeFailure.code:0;}
// Core's sealed capture/continuation is the authentication boundary. These
// checks independently tie its detached facts to Auth Root/Source originals.
void activePolicy(const engine::AccountView&a,const OriginalEngineSource&s,const engine::Checkpoint&checkpoint){
 need(a.owner==s.selection.canonicalOwner&&a.networkId==d::unhex(s.metadata.context.at("networkId").text(),32)&&a.nativeChainID>=0&&std::to_string(a.nativeChainID)==s.metadata.context.at("nativeChainID").text());
 need(checkpoint.height&&checkpoint.height<UINT64_MAX&&a.committedHeight==checkpoint.height&&a.executionHeight==checkpoint.height+1&&a.policyOriginal.size()>0&&a.policyOriginal.size()<=8388608&&a.pqSigningEnabled&&a.executionRegistration.has_value());
 const auto&v=*a.executionRegistration;need(v.owner==a.owner&&v.algorithmVersion=="YNX-BATCH/v0.1"&&v.pkA.size()==2592&&v.pkB.size()==64&&v.revision&&v.registeredAt<UINT64_MAX&&v.activeFrom>v.registeredAt&&v.activeFrom<=a.executionHeight);
 const auto&original=s.metadata.subjectRegistration;
 need(v.pkA==d::unhex(original.at("pkA").text(),2592)&&v.pkB==d::unhex(original.at("pkB").text(),64)&&v.revision==d::u64(original.at("revision").text())&&v.registeredAt==d::u64(original.at("registeredAt").text(),true)&&v.activeFrom==d::u64(original.at("activeFrom").text(),true));
 // No Source canonical parsing of policyOriginal: Core's genuine sealed view
 // supplies actual DecodeWalletPolicyProjection/TrustedRegistration results.
 // CommittedRegistration and ExecutionRegistration are distinct at activation.
}
}
const std::vector<ReviewedReceiptRelease>&reviewedReceiptReleases(){static const std::vector<ReviewedReceiptRelease>v={
#ifdef YNX_REVIEWED_MOBILE_RECEIPT_RELEASE_ROWS
 YNX_REVIEWED_MOBILE_RECEIPT_RELEASE_ROWS
#endif
};return v;}
Failure originalEngineSourceCurrent(OriginalEngineSource*p)noexcept{auto s=known(p);if(!s)return{true,invalid};if(s->actor!=std::this_thread::get_id())return{true,wrongThread};if(s->failure.present)return s->failure;if(s->retired||s->closed||s->closeSelected||!s->ready)return{true,expired};try{if(!clock(*s))return{true,fail(*s,expired)};if(auto e=physical(*s))return{true,fail(*s,e)};auto m=q::verifySourceOriginals(s->raw,s->row->sourcePolicy,wall());if(m.scopeOriginal!=s->metadata.scopeOriginal||m.head!=s->metadata.head||m.height!=s->metadata.height)return{true,fail(*s,changed)};if(auto e=physical(*s))return{true,fail(*s,e)};return clock(*s)?Failure{}:Failure{true,fail(*s,expired)};}catch(...){return{true,fail(*s,changed)};}}
Failure readOriginalEngineSelection(OriginalEngineSource*p,EngineSelection&out)noexcept{auto s=known(p);if(!s)return{true,invalid};auto f=originalEngineSourceCurrent(p);if(f.present)return f;try{auto copy=s->selection;f=originalEngineSourceCurrent(p);if(f.present)return f;out=std::move(copy);return{};}catch(...){return{true,fail(*s,unknown)};}}
Failure retainOriginalEngineSource(OriginalEngineSource*p)noexcept{auto s=known(p);if(!s)return{true,invalid};auto f=originalEngineSourceCurrent(p);if(f.present)return f;if(s->borrowers==SIZE_MAX)return{true,debt};++s->borrowers;return{};}
Failure releaseOriginalEngineSource(OriginalEngineSource*p)noexcept{auto s=known(p);if(!s||s->actor!=std::this_thread::get_id()||!s->borrowers)return{true,invalid};--s->borrowers;return{};}
ReceiptAcquisition acquireOriginalRegisteredAccountReceipt()noexcept{ReceiptAcquisition out;try{out.owner=std::shared_ptr<RegisteredAccountReceipt>(new RegisteredAccountReceipt);{std::lock_guard<std::mutex>l(mutex);receipts.emplace(out.owner.get(),out.owner);}const auto&rows=reviewedReceiptReleases();if(rows.size()!=1){out.failure={true,rows.empty()?notSupplied:changed};out.owner->failure_=out.failure;return out;}auto&s=out.owner->source_;s=std::make_shared<OriginalEngineSource>();{std::lock_guard<std::mutex>l(mutex);sources.emplace(s.get(),s);}if(auto e=initialize(*s,rows[0])){out.failure={true,e};out.owner->fail(out.failure);return out;}auto acquired=engine::acquireCommittedAccountProof(s.get());out.owner->proof_=acquired.owner;if(acquired.failure.present){out.failure=acquired.failure;out.owner->fail(out.failure);return out;}if(!out.owner->proof_)throw(int32_t)notSupplied;auto state=originalReceiptCurrent(out.owner);out.ready=state.ready;out.failure=state.failure;out.pendingCause=state.pendingCause;return out;}catch(int32_t e){out.failure={true,e};if(out.owner)out.owner->fail(out.failure);return out;}catch(...){out.failure={true,changed};if(out.owner)out.owner->fail(out.failure);return out;}}
engine::ReadResult originalReceiptCurrent(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{if(!known(p))return{false,{true,invalid}};if(p->actor_!=std::this_thread::get_id())return{false,{true,wrongThread}};if(p->failure_.present)return{false,p->failure_};if(p->retired_||p->closed_||p->closeSelected_)return{false,{true,expired}};try{auto f=originalEngineSourceCurrent(p->source_.get());if(f.present)return{false,p->fail(f)};if(!p->ready_){auto read=engine::readCaptured(p->proof_,p->captured_);if(read.failure.present)return{false,p->fail(read.failure)};f=originalEngineSourceCurrent(p->source_.get());if(f.present)return{false,p->fail(f)};if(!read.ready){need(read.notReady);return read;}auto&c=p->captured_;auto&s=*p->source_;need(c.version==2&&c.platform==s.selection.platform&&c.engineReference==s.selection.engineReference&&c.proof.chainId==s.selection.chainId&&c.proof.height>=s.selection.minimumHeight&&c.proof.fullAppHash.size()==32&&!c.blockOriginal.empty()&&!c.successorOriginal.empty()&&c.blockOriginal.size()<=10485760&&c.successorOriginal.size()<=10485760);activePolicy(c.historicalAccount,s,c.proof);auto&v=*c.historicalAccount.executionRegistration;p->data_={1,c.platform,c.proof.chainId,s.metadata.context.at("networkId").text(),c.historicalAccount.owner,s.metadata.context.at("account").text(),s.selection.sourceId,s.selection.instanceId,s.metadata.context.at("registrationDigest").text(),s.metadata.context.at("keyVersion").text(),c.proof.height,c.proof.height+1,c.proof.height,v.revision,c.historicalAccount.ledgerNonce,c.proof.fullAppHash,v.pkA,v.pkB};p->ready_=true;}
 engine::Continuation c;auto state=engine::current(p->proof_,c);if(state.failure.present)return{false,p->fail(state.failure)};f=originalEngineSourceCurrent(p->source_.get());if(f.present)return{false,p->fail(f)};if(!state.ready){need(state.notReady);return state;}need(c.version==2&&c.captured.chainId==p->captured_.proof.chainId&&c.captured.height==p->captured_.proof.height&&c.captured.fullAppHash==p->captured_.proof.fullAppHash&&c.currentCheckpoint.chainId==c.captured.chainId&&c.currentCheckpoint.height>=p->captured_.proof.height+1&&c.currentCheckpoint.height>=p->data_.currentEngineHeight&&c.currentCheckpoint.fullAppHash.size()==32);activePolicy(c.currentAccount,*p->source_,c.currentCheckpoint);need(c.currentAccount.ledgerNonce==p->captured_.historicalAccount.ledgerNonce);if(!clock(*p->source_))return{false,p->fail({true,expired})};p->data_.currentEngineHeight=c.currentCheckpoint.height;return{true,{}};}catch(...){return{false,p->fail({true,changed})};}}
engine::ReadResult readOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p,ReceiptDATA&out)noexcept{auto state=originalReceiptCurrent(p);if(state.failure.present||!state.ready)return state;try{state=originalReceiptCurrent(p);if(state.failure.present||!state.ready)return state;out=p->data_;return{true,{}};}catch(...){return{false,p->fail({true,unknown})};}}
void retireOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{if(!known(p))return;p->retired_=true;if(p->source_)p->source_->retired=true;if(p->actor_==std::this_thread::get_id()&&p->proof_)engine::retire(p->proof_);}
int32_t RegisteredAccountReceipt::finishClose()noexcept{if(directoryChildren_)return debt;if(proof_){if(!engineClose_){engineClose_=true;first(closeFailure_,engine::close(proof_));}if(!engine::isClosed(proof_))return debt;auto f=engine::releaseClosed(proof_);if(f.present){first(closeFailure_,f);return f.code?f.code:debt;}proof_=nullptr;}if(source_){auto e=closeSource(*source_);if(e)first(closeFailure_,e);if(!source_->closed)return e?e:debt;}closed_=true;captured_={};data_={};return 0;}
Failure joinOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{if(!known(p)||p->actor_!=std::this_thread::get_id())return{true,invalid};Failure joined;if(p->proof_){joined=engine::join(p->proof_);first(p->closeFailure_,joined);}if(p->closeSelected_&&!p->closed_){auto rc=p->finishClose();if(rc)return p->closeFailure_.present?p->closeFailure_:Failure{true,rc};}return joined;}
Failure closeOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{if(!known(p)||p->actor_!=std::this_thread::get_id())return{true,invalid};retireOriginalReceipt(p);if(p->closeSelected_)return p->closeFailure_;p->closeSelected_=true;first(p->closeFailure_,p->failure_);first(p->closeFailure_,joinOriginalReceipt(p));return p->closeFailure_;}
bool originalReceiptClosed(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{return known(p)&&p->actor_==std::this_thread::get_id()&&p->closed_;}
engine::ReadResult readOriginalSourceSelection(const std::shared_ptr<RegisteredAccountReceipt>&p,OriginalSourceSelection&out)noexcept{auto f=originalReceiptCurrent(p);if(f.failure.present||!f.ready)return f;try{auto&m=p->source_->metadata;auto&c=m.context;OriginalSourceSelection v;v.mode=m.mode;v.reference=m.reference;v.declaredOriginalOperationId=m.operationID;v.networkId=c.at("networkId").text();v.account=c.at("account").text();v.platform=c.at("platform").text();v.applicationId=c.at("applicationId").text();v.protectedResourceRef=c.at("protectedResourceRef").text();v.nativeChainID=c.at("nativeChainID").text();v.vaultRevision=c.at("vaultRevision").text();v.registrationDigest=c.at("registrationDigest").text();v.keyVersion=c.at("keyVersion").text();v.sourceExecutionHeight=c.at("executionHeight").text();v.sourceNonce=c.at("nonce").text();v.spendingBudgetOriginalDigest=c.at("spendingBudgetOriginalDigest").text();v.issuedAtMs=m.issued;v.expiresAtMs=m.scope.at("expiresAtMs").number();v.scopeOriginal.assign(m.scopeOriginal.begin(),m.scopeOriginal.end());auto context=d::canonical(c);v.contextOriginal.assign(context.begin(),context.end());f=originalReceiptCurrent(p);if(f.failure.present||!f.ready)return f;out=std::move(v);return{true,{}};}catch(...){return{false,p->fail({true,changed})};}}
DirectoryAcquisition borrowOriginalReceiptDirectory(const std::shared_ptr<RegisteredAccountReceipt>&p,uint32_t role)noexcept{DirectoryAcquisition out;if(!known(p)||p->actor_!=std::this_thread::get_id()||role<1||role>3){out.failure={true,invalid};return out;}try{out.owner=std::shared_ptr<ReceiptDirectoryLoan>(new ReceiptDirectoryLoan);auto&loan=*out.owner;loan.receipt_=p;{std::lock_guard<std::mutex>l(mutex);directoryLoans.emplace(&loan,out.owner);}auto state=originalReceiptCurrent(p);out.failure=state.failure;if(out.failure.present){loan.first_=out.failure;return out;}if(!state.ready){out.pendingCause=state.pendingCause;return out;}auto&r=*p->source_->row;loan.leaf_=role==1?r.sourceLeaf:role==2?r.journalLeaf:r.registeredSlotLeaf;auto dev=role==1?r.sourceDevice:role==2?r.journalDevice:r.slotDevice;auto ino=role==1?r.sourceInode:role==2?r.journalInode:r.slotInode;need(role==1||loan.leaf_!=r.sourceLeaf);if(!leaf(loan.leaf_)||!dev||!ino){out.failure=loan.first_={true,notSupplied};return out;}if(p->directoryChildren_==SIZE_MAX){out.failure=loan.first_={true,debt};return out;}++p->directoryChildren_;loan.parentHeld_=true;loan.data_={1,role,r.uid,r.gid,-1,dev,ino};loan.data_.borrowedFD=openat(p->source_->accountFD,loan.leaf_.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(loan.data_.borrowedFD<0){out.failure=loan.first_={true,changed};return out;}state=currentOriginalReceiptDirectory(out.owner);out.failure=state.failure;out.ready=state.ready;out.pendingCause=state.pendingCause;return out;}catch(...){out.failure={true,changed};if(out.owner)out.owner->first_=out.failure;return out;}}
engine::ReadResult currentOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&p)noexcept{if(!known(p)||!p->receipt_||p->receipt_->actor_!=std::this_thread::get_id())return{false,{true,invalid}};if(p->first_.present)return{false,p->first_};if(p->closed_||p->closeSelected_)return{false,{true,expired}};auto f=originalReceiptCurrent(p->receipt_);if(f.failure.present){p->first_=f.failure;return f;}if(!f.ready)return f;struct stat a{},b{};auto&v=p->data_;if(v.borrowedFD<0||fstat(v.borrowedFD,&a)||fstatat(p->receipt_->source_->accountFD,p->leaf_.c_str(),&b,AT_SYMLINK_NOFOLLOW)||!S_ISDIR(a.st_mode)||!S_ISDIR(b.st_mode)||(a.st_mode&07777)!=0700||(b.st_mode&07777)!=0700||a.st_uid!=v.uid||a.st_gid!=v.gid||b.st_uid!=v.uid||b.st_gid!=v.gid||(uint64_t)a.st_dev!=v.device||(uint64_t)a.st_ino!=v.inode||a.st_dev!=b.st_dev||a.st_ino!=b.st_ino){p->first_={true,changed};return{false,p->first_};}f=originalReceiptCurrent(p->receipt_);if(f.failure.present)p->first_=f.failure;return f;}
engine::ReadResult readOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&p,DirectoryDATA&out)noexcept{auto f=currentOriginalReceiptDirectory(p);if(f.failure.present||!f.ready)return f;out=p->data_;return{true,{}};}
Failure closeOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&p)noexcept{if(!known(p)||!p->receipt_||p->receipt_->actor_!=std::this_thread::get_id())return{true,invalid};if(p->closeSelected_)return p->closeFailure_;p->closeSelected_=true;p->closeFailure_=p->first_;if(p->data_.borrowedFD>=0){int fd=p->data_.borrowedFD;p->data_.borrowedFD=-1;if(::close(fd)){first(p->closeFailure_,unknown);return p->closeFailure_;}}if(p->parentHeld_){if(!p->receipt_->directoryChildren_){first(p->closeFailure_,debt);return p->closeFailure_;}--p->receipt_->directoryChildren_;p->parentHeld_=false;}p->closed_=true;return p->closeFailure_;}
bool originalReceiptDirectoryClosed(const std::shared_ptr<ReceiptDirectoryLoan>&p)noexcept{return known(p)&&p->closed_;}
}
