#include "CustodySession.h"
#include "CustodyABI.h"
#include <algorithm>
#include <limits>
#include <cstring>
namespace ynx::mobilepq {
namespace {
enum { Invalid=7001,Closed=7002,WrongThread=7003,Duplicate=7004,
 Unconfirmed=7005,Bounds=7006,Mode=7007,NotEntered=7008 };
bool span(YNXMobilePQSpan s,size_t max){return s.bytes&&s.length&&s.length<=max;}
bool decimal(YNXMobilePQSpan s){
 if(!span(s,20)||s.bytes[0]=='0')return false;
 uint64_t n=0;for(size_t i=0;i<s.length;++i){auto c=s.bytes[i];if(c<'0'||c>'9'||n>(std::numeric_limits<uint64_t>::max()-(c-'0'))/10)return false;n=n*10+c-'0';}return n>0;
}
struct Busy {bool& value; explicit Busy(bool& v):value(v){value=true;}~Busy(){value=false;}};
}
CustodySession::CustodySession(uint32_t mode,std::shared_ptr<std::atomic<bool>> live):thread_(std::this_thread::get_id()),mode_(mode),runtimeLive_(std::move(live)){}
void CustodySession::requestCancel(){
 cancelRequested_.store(true);
 if(auto* token=cancellationCapture_.load())(void)ynx_auth_mobile_pq_request_cancel_v1(token);
}
void CustodySession::requestRetire(){
 retireRequested_.store(true);
 if(auto* token=cancellationCapture_.load())(void)ynx_auth_mobile_pq_request_cancel_v1(token);
}
bool CustodySession::thread()const{return thread_==std::this_thread::get_id();}
bool CustodySession::fail(int32_t code){if(!outcome_.firstCause.present)outcome_.firstCause={true,code};return false;}
bool CustodySession::cleanup(int32_t code){if(code&&!outcome_.cleanupCause.present)outcome_.cleanupCause={true,code};return code==0;}
bool CustodySession::current(uint32_t phase){
 if(!thread())return fail(WrongThread);
 if(!capture_||retired_||closeEntered_||retireRequested_.load()||(runtimeLive_&&!runtimeLive_->load())||(phase!=YNX_MOBILE_PQ_CURRENT_QUERY&&cancelRequested_.load()))return fail(Closed);
 auto code=ynx_auth_mobile_pq_current_v1(capture_,phase);return code?fail(code):true;
}
bool CustodySession::copyPublic(uint32_t kind,std::vector<uint8_t>& out,bool& selected){
 if(!capture_)return fail(Closed);
 std::vector<uint8_t> bytes(PublicMax);size_t length=0;uint32_t present=0;
 auto code=ynx_auth_mobile_pq_copy_public_v1(capture_,kind,bytes.data(),bytes.size(),&length,&present);
 if(code)return fail(code);
 if(length>bytes.size()||present>1||(!present&&length))return fail(Bounds);
 if(selected){if(!present||length!=out.size()||!std::equal(out.begin(),out.end(),bytes.begin()))return fail(Unconfirmed);return true;}
 if(present){bytes.resize(length);out=std::move(bytes);selected=true;}return true;
}
bool CustodySession::projection(){
 YNXMobilePQProjection next{};next.version=1;next.size=sizeof(next);
 auto code=ynx_auth_mobile_pq_copy_projection_v1(capture_,&next);if(code)return fail(code);
 if(next.version!=1||next.size!=sizeof(next)||next.transaction_hash_present>1)return fail(Invalid);
 if(outcome_.projectionAvailable){auto& prior=outcome_.projection;
  if(std::memcmp(prior.account,next.account,20)||std::memcmp(prior.network_id,next.network_id,32)||std::memcmp(prior.request_digest,next.request_digest,32)||
     (prior.transaction_hash_present&&(!next.transaction_hash_present||std::memcmp(prior.transaction_hash,next.transaction_hash,32))))return fail(Unconfirmed);
 }
 outcome_.projection=next;outcome_.projectionAvailable=true;return true;
}
bool CustodySession::osProjection(){
 YNXMobilePQOSOutcome data{};data.version=1;data.size=sizeof(data);
 auto code=ynx_auth_mobile_pq_copy_os_outcome_v1(capture_,&data);if(code)return fail(code);
 if(data.version!=1||data.size!=sizeof(data)||data.available>1||data.effect_possible>1||data.ack_confirmed>1||data.first_present>1)return fail(Invalid);
 if(!data.available){if(data.action||data.phase||data.effect_possible||data.ack_confirmed||data.first_present||data.first_code)return fail(Invalid);}
 else if((data.action!=2&&data.action!=3)||data.phase<1||data.phase>3||(!data.first_present&&data.first_code))return fail(Invalid);
 outcome_.osOutcome=data;if(data.first_present&&!outcome_.firstCause.present)outcome_.firstCause={true,data.first_code};return true;
}
bool CustodySession::prepare(const std::string& reference){
 if(!thread())return fail(WrongThread);
 if(busy_)return fail(Invalid);Busy busy(busy_);
 if(prepared_||capture_||retired_)return fail(Duplicate);
 prepared_=true;
 if((mode_!=YNX_MOBILE_PQ_TRANSACTION&&mode_!=YNX_MOBILE_PQ_REGISTERED_RESTORE&&mode_!=YNX_MOBILE_PQ_ORIGINAL_QUERY)||reference.empty()||reference.size()>128||
  !std::all_of(reference.begin(),reference.end(),[](unsigned char c){return c>=33&&c<=126;}))return fail(Invalid);
 // Adopt partial before inspecting status; never publish or reconstruct it.
 auto code=ynx_auth_mobile_pq_capture_v1(reinterpret_cast<const uint8_t*>(reference.data()),reference.size(),mode_,&capture_);
 cancellationCapture_.store(capture_);
 if(capture_&&(cancelRequested_.load()||retireRequested_.load()))(void)ynx_auth_mobile_pq_request_cancel_v1(capture_);
 if(code)return fail(code);if(!capture_)return fail(Unconfirmed);
 if(!copyPublic(0,outcome_.review,outcome_.reviewSelected)||!projection()||!current(YNX_MOBILE_PQ_CURRENT_CAPTURE))return false;
 if(mode_==YNX_MOBILE_PQ_ORIGINAL_QUERY){
  uint32_t flags=0;code=ynx_auth_mobile_pq_read_original_state_v1(capture_,&flags);
  if(code)return fail(code);
  if((flags&~31u)||((flags&2)&&!(flags&1))||((flags&4)&&!(flags&2))||((flags&16)&&!(flags&8))||((flags&24)&&(flags&7)))return fail(NotEntered);
  if(!osProjection())return false;
  if(!flags){if(!outcome_.osOutcome.available)return fail(NotEntered);outcome_.state="os-operation-retained";return true;}
  outcome_.signEntered=flags&1;outcome_.storageConfirmed=flags&2;outcome_.submitEntered=flags&4;outcome_.restoreEntered=flags&8;
  outcome_.state=outcome_.submitEntered?"submission-unknown":outcome_.restoreEntered?"restore-unknown":"signing-unknown";return !outcome_.firstCause.present;
 }
 inputs_.version=1;inputs_.size=sizeof(inputs_);
 code=ynx_auth_mobile_pq_inputs_v1(capture_,&inputs_);
 if(code)return fail(code);
 if(inputs_.version!=1||inputs_.size!=sizeof(inputs_)||!span(inputs_.binding,8192))return fail(Invalid);
 if(mode_==YNX_MOBILE_PQ_TRANSACTION&&(!span(inputs_.message,8192)||!span(inputs_.policy,8388608)||!decimal(inputs_.key_version)||!decimal(inputs_.execution_height)||!inputs_.native_chain_id))return fail(Invalid);
 outcome_.state="prepared";return !outcome_.firstCause.present;
}
bool CustodySession::releaseLoan(){
 if(!loan_)return true;auto code=ynx_auth_mobile_pq_release_loan_v1(loan_);if(!cleanup(code))return false;loan_=nullptr;return true;
}
bool CustodySession::open(){
 YNXMobilePQSpan backup{},credential{};
 auto code=ynx_auth_mobile_pq_borrow_backup43_v1(capture_,&loan_,&backup,&credential);
 if(code){fail(code);releaseLoan();return false;}
 if(!loan_||!span(backup,196608)||!span(credential,43)||credential.length!=43){fail(Invalid);releaseLoan();return false;}
 if(!current(mode_==YNX_MOBILE_PQ_REGISTERED_RESTORE?YNX_MOBILE_PQ_CURRENT_RESTORE:YNX_MOBILE_PQ_CURRENT_SIGN)){releaseLoan();return false;}
 // Actual ordinary custody, fixed purpose1. Never open_initial for restore.
 code=ynx_auth_pq_native_open_v1(backup.bytes,backup.length,credential.bytes,credential.length,inputs_.binding.bytes,inputs_.binding.length,1,&owner_);
 if(code)fail(code);
 const bool loanReleased=releaseLoan();
 if(code||!owner_||!loanReleased)return owner_?false:fail(Unconfirmed);
 code=ynx_auth_pq_native_current_v1(owner_);if(code)return fail(code);
 code=ynx_auth_pq_native_assert_binding_v1(owner_,inputs_.binding.bytes,inputs_.binding.length);return code?fail(code):true;
}
bool CustodySession::captureMember(){
 if(!owner_)return false;
 std::vector<uint8_t> bytes(MemberMax);size_t length=0;int32_t status=-1;uint32_t cleanupState=0,selected=0;
 auto code=ynx_auth_pq_native_copy_outcome_v1(owner_,bytes.data(),bytes.size(),&length,&status,&cleanupState,&selected);
 if(code)return fail(code);
 outcome_.primitiveStatus=status;outcome_.primitiveCleanup=cleanupState;
 if(length>MemberMax||selected>1)return fail(Bounds);
 if(length){bytes.resize(length);if(!outcome_.member.empty()&&outcome_.member!=bytes)return fail(Unconfirmed);outcome_.member=std::move(bytes);outcome_.memberRetained=true;}
 return selected==1&&status==0&&cleanupState==2&&length>0;
}
int32_t CustodySession::retainOutcome(){
 if(!owner_||!capture_||!signAdmissionAttempted_)return Unconfirmed;
 const auto ack=ynx_auth_mobile_pq_retain_original_sign_outcome_v1(capture_,owner_);
 if(!ack)outcome_.storageConfirmed=true;
 return ack;
}
bool CustodySession::signOnce(){
 if(!thread())return fail(WrongThread);
 if(busy_)return fail(Invalid);Busy busy(busy_);
 if(mode_!=YNX_MOBILE_PQ_TRANSACTION)return fail(Mode);
 if(outcome_.signEntered)return fail(Duplicate);
 if(outcome_.cancelled||outcome_.firstCause.present||outcome_.cleanupCause.present||!current(YNX_MOBILE_PQ_CURRENT_SIGN))return false;
 outcome_.signEntered=true;outcome_.state="signing-unknown";
 if(!open())return false;
 if(!current(YNX_MOBILE_PQ_CURRENT_SIGN))return false;
 signAdmissionAttempted_=true;
 auto code=ynx_auth_mobile_pq_begin_sign_once_v1(capture_,owner_);if(code)return fail(code);
 code=ynx_auth_pq_native_transaction_once_v1(owner_,inputs_.message.bytes,inputs_.message.length,inputs_.policy.bytes,inputs_.policy.length,inputs_.native_chain_id,inputs_.key_version.bytes,inputs_.key_version.length,inputs_.execution_height.bytes,inputs_.execution_height.length);
 // Preserve public result even when the call or late current check fails.
 const bool copied=captureMember();const auto saved=retainOutcome();
 if(code)fail(code);if(saved)fail(saved);projection();
 if(!copied)fail(Unconfirmed);
 if(code||!copied||!outcome_.storageConfirmed)return false;
 outcome_.state="signed-unsubmitted";
 return current(YNX_MOBILE_PQ_CURRENT_SIGN)&&!outcome_.firstCause.present;
}
bool CustodySession::submitSignedOnce(){
 if(!thread())return fail(WrongThread);
 if(busy_)return fail(Invalid);Busy busy(busy_);
 if(mode_!=YNX_MOBILE_PQ_TRANSACTION)return fail(Mode);
 if(outcome_.submitEntered)return fail(Duplicate);
 if(!outcome_.signEntered||outcome_.member.empty()||!outcome_.storageConfirmed||outcome_.primitiveStatus!=0||outcome_.primitiveCleanup!=2)return fail(Unconfirmed);
 if(outcome_.cancelled||outcome_.firstCause.present||outcome_.cleanupCause.present||!current(YNX_MOBILE_PQ_CURRENT_BROADCAST))return false;
 // Mark uncertainty before entering the original durable admission, even if
 // it loses ACK. Such an attempt can only query its original operation.
 outcome_.submitEntered=true;outcome_.state="submission-unknown";
 auto code=ynx_auth_mobile_pq_begin_submit_once_v1(capture_);if(code)return fail(code);
 if(!current(YNX_MOBILE_PQ_CURRENT_BROADCAST))return false;
 code=ynx_auth_mobile_pq_dispatch_once_v1(capture_);
 // Producer retained response BEFORE returning/throwing. Do not apply a late
 // current fence until it has been copied. No second send on any failure.
 const bool copied=copyPublic(1,outcome_.submission,outcome_.submissionSelected);
 projection();
 if(code)fail(code);if(!copied||code)return false;
 return current(YNX_MOBILE_PQ_CURRENT_BROADCAST)&&!outcome_.firstCause.present;
}
bool CustodySession::queryOriginal(){
 if(!thread())return fail(WrongThread);
 if(busy_)return fail(Invalid);Busy busy(busy_);
 if(outcome_.queryEntered)return !outcome_.query.empty()||outcome_.querySelected;
 if(!current(YNX_MOBILE_PQ_CURRENT_QUERY))return false;
 if(!osProjection())return false;
 const bool heldSignUnknown=signAdmissionAttempted_&&outcome_.state=="signing-unknown";
 const bool heldRestoreUnknown=restoreAdmissionAttempted_&&outcome_.state=="restore-unknown";
 if(!outcome_.submitEntered&&!heldSignUnknown&&!heldRestoreUnknown&&!outcome_.osOutcome.available&&
    !(mode_==YNX_MOBILE_PQ_ORIGINAL_QUERY&&(outcome_.signEntered||outcome_.restoreEntered)))return fail(NotEntered);
 outcome_.queryEntered=true;
 auto code=ynx_auth_mobile_pq_query_original_v1(capture_);
 const bool copied=copyPublic(2,outcome_.query,outcome_.querySelected);
 projection();
 osProjection();
 if(code)fail(code);return copied&&code==0;
}
bool CustodySession::restoreRegisteredEmptyOnce(){
 if(!thread())return fail(WrongThread);
 if(busy_)return fail(Invalid);Busy busy(busy_);
 if(mode_!=YNX_MOBILE_PQ_REGISTERED_RESTORE)return fail(Mode);
 if(outcome_.restoreEntered)return fail(Duplicate);
 if(outcome_.cancelled||outcome_.firstCause.present||outcome_.cleanupCause.present||!current(YNX_MOBILE_PQ_CURRENT_RESTORE))return false;
 outcome_.restoreEntered=true;outcome_.state="restore-unknown";
 if(!open()||!current(YNX_MOBILE_PQ_CURRENT_RESTORE))return false;
 restoreAdmissionAttempted_=true;
 auto code=ynx_auth_mobile_pq_restore_registered_empty_once_v1(capture_,owner_);
 if(code)return fail(code);
 outcome_.state="registered-slot-restored";return current(YNX_MOBILE_PQ_CURRENT_RESTORE)&&!outcome_.firstCause.present;
}
bool CustodySession::cancel(){
 if(!thread())return fail(WrongThread);if(busy_)return fail(Invalid);Busy busy(busy_);
 cancelRequested_=true;
 if(outcome_.cancelled)return true;
 if(!capture_||retired_||closeEntered_)return fail(Closed);
 outcome_.cancelled=true;
 auto code=ynx_auth_mobile_pq_cancel_v1(capture_);if(code)fail(code);
 // Retire the decrypted sign owner only. Original operation capture remains
 // available for Auth's independently checked readonly recovery path.
 if(owner_)cleanup(ynx_auth_pq_native_retire_v1(owner_));
 return code==0;
}
bool CustodySession::retire(){
 if(!thread())return fail(WrongThread);
 if(busy_)return fail(Invalid);Busy busy(busy_);return retireOwned();
}
bool CustodySession::saveOriginal(){
 if(!thread())return fail(WrongThread);if(busy_)return fail(Invalid);Busy busy(busy_);
 if(!capture_||released_)return fail(Unconfirmed);
 if(outcome_.storageConfirmed)return true;
 auto code=owner_?retainOutcome():outcome_.member.empty()?Unconfirmed:
  ynx_auth_mobile_pq_retain_signed_v1(capture_,outcome_.member.data(),outcome_.member.size());
 if(code)return fail(code);outcome_.storageConfirmed=true;return projection();
}
bool CustodySession::retireOwned(){
 retireRequested_=true;retired_=true;bool ok=true;
 if(owner_)ok=cleanup(ynx_auth_pq_native_retire_v1(owner_))&&ok;
 if(capture_)ok=cleanup(ynx_auth_mobile_pq_retire_v1(capture_))&&ok;
 return ok;
}
bool CustodySession::close(){
 if(!thread())return fail(WrongThread);if(released_)return true;
 if(busy_)return fail(Invalid);Busy busy(busy_);
 closeEntered_=true;retireOwned();bool ok=releaseLoan();
 // Public bytes already retained independently; native copy still attempted
 // before releasing the owner. A sign failure can make close return its first
 // cause even though it wiped keys; release_closed is the actual closed gate.
 if(owner_){
  if(outcome_.signEntered)captureMember();
  if(!ownerCloseAttempted_){ownerCloseAttempted_=true;cleanup(ynx_auth_pq_native_close_v1(owner_));}
  // NO release before Auth has cached actual original outcome/closed witness.
  if(signAdmissionAttempted_&&!outcome_.storageConfirmed){const auto ack=retainOutcome();if(ack)cleanup(ack);}
  if(!signAdmissionAttempted_||outcome_.storageConfirmed){const auto released=ynx_auth_pq_native_release_closed_v1(owner_);if(!released)owner_=0;else{cleanup(released);ok=false;}}
 }
 // Wipe private custody, but NEVER release the native result inventory while
 // its signed original lacks an ACK. saveOriginal may only flush these SAME
 // bytes; GC/retire/close cannot turn a failed save into completed cleanup.
 if(!outcome_.member.empty()&&!outcome_.storageConfirmed){cleanup(Unconfirmed);return false;}
 if(capture_&&!loan_&&(!owner_||(!outcome_.storageConfirmed&&outcome_.member.empty()))){auto code=ynx_auth_mobile_pq_close_v1(capture_);cleanup(code);
  // close may have completed while returning its original sticky failure.
  // release_closed is the actual gate; failure keeps the SAME capture/debt.
  code=ynx_auth_mobile_pq_release_closed_v1(capture_);if(code){cleanup(code);ok=false;}else{cancellationCapture_.store(nullptr);capture_=nullptr;}}
 // A definite pre-admission refusal may have no sign debt at all. Only the
 // actual Source closed gate above can confirm that; never infer it from a
 // caller error code or reinterpret a failed primitive as success.
 if(owner_&&!capture_){auto code=ynx_auth_pq_native_release_closed_v1(owner_);if(code){cleanup(code);ok=false;}else owner_=0;}
 released_=ok&&!loan_&&!owner_&&!capture_;outcome_.closed=released_;return released_;
}
Outcome CustodySession::copyOriginalPublicOutcome()const{
 if(!thread()){Outcome out;out.firstCause={true,WrongThread};return out;}return outcome_;
}
Outcome CustodySession::copyProjection()const{
 Outcome out;if(!thread()){out.firstCause={true,WrongThread};return out;}
 out.state=outcome_.state;out.signEntered=outcome_.signEntered;out.submitEntered=outcome_.submitEntered;
 out.restoreEntered=outcome_.restoreEntered;out.storageConfirmed=outcome_.storageConfirmed;out.memberRetained=outcome_.memberRetained;
 out.queryEntered=outcome_.queryEntered;out.querySelected=outcome_.querySelected;out.submissionSelected=outcome_.submissionSelected;
 out.reviewSelected=outcome_.reviewSelected;out.cancelled=outcome_.cancelled;out.closed=outcome_.closed;
 out.primitiveStatus=outcome_.primitiveStatus;out.primitiveCleanup=outcome_.primitiveCleanup;
 out.firstCause=outcome_.firstCause;out.cleanupCause=outcome_.cleanupCause;
 out.projectionAvailable=outcome_.projectionAvailable;out.projection=outcome_.projection;out.osOutcome=outcome_.osOutcome;return out;
}
}
