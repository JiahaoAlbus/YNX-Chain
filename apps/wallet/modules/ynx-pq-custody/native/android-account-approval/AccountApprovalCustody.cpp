#include "AccountApprovalCustodyPrivate.hpp"

#include <chrono>
#include <cstring>
#include <limits>

namespace ynx::mobilepq::android_account_approval {
namespace {
using Failure=AccountApprovalCustody::Failure;
using Plan=AccountApprovalCustody::Plan;
using Bytes=ynx_auth_android_provision_bytes_v1;
namespace ordinary=ynx::auth::android_ordinary;

constexpr uint32_t origin=0x4e415052; // Native account approval
enum Error:int32_t { Invalid=74501, Changed=74502, Closed=74503,
 WrongActor=74504, Internal=74505 };
constexpr size_t planCapacity=128+YNX_WALLET_V4_APPROVAL_E5_MAX+
 YNX_WALLET_V4_APPROVAL_BINDING_MAX+20;

Failure error(Error code) noexcept {return {1,code,origin,0};}
bool valid(Failure f) noexcept {
 return f.present<=1&&(f.present||(!f.code&&!f.origin&&!f.platform_code));
}
void remember(Failure& first,Failure incoming) noexcept {
 if(!valid(incoming))incoming=error(Invalid);
 if(incoming.present&&!first.present)first=incoming;
}
template<class Call> Failure callStatus(Call call) noexcept {
 Failure status=error(Internal);
 try {call(&status);}
 catch(...){if(!status.present)status=error(Internal);}
 return valid(status)?status:error(Invalid);
}
bool inBuffer(Bytes bytes,const std::vector<uint8_t>& buffer,size_t min,size_t max) noexcept {
 if(!bytes.bytes||bytes.length<min||bytes.length>max||bytes.length>buffer.size())return false;
 auto start=reinterpret_cast<uintptr_t>(buffer.data());
 auto ptr=reinterpret_cast<uintptr_t>(bytes.bytes);
 return ptr>=start&&ptr-start<=buffer.size()-bytes.length;
}
bool decimal(Bytes bytes) noexcept {
 if(bytes.bytes[0]=='0')return false;
 uint64_t value=0;
 for(size_t i=0;i<bytes.length;++i){
  auto digit=bytes.bytes[i];
  if(digit<'0'||digit>'9'||value>(std::numeric_limits<uint64_t>::max()-(digit-'0'))/10)return false;
  value=value*10+(digit-'0');
 }
 return value!=0;
}
bool ownerShape(const uint8_t* p) noexcept {
 if(p[0]!='0'||p[1]!='x')return false;
 for(size_t i=2;i<42;++i)if(!((p[i]>='0'&&p[i]<='9')||(p[i]>='a'&&p[i]<='f')))return false;
 return true;
}
bool window(const Plan& p) noexcept {
 const auto now=std::chrono::duration_cast<std::chrono::milliseconds>(
     std::chrono::system_clock::now().time_since_epoch()).count();
 return p.not_before_ms>=0&&p.not_before_ms<=now&&now<p.expires_at_ms;
}
bool validPlan(const Plan& p,const std::vector<uint8_t>& buffer) noexcept {
 return p.version==1&&p.size==sizeof(p)&&
  inBuffer(p.intent_operation_id,buffer,8,128)&&
  inBuffer(p.e5_original,buffer,1,YNX_WALLET_V4_APPROVAL_E5_MAX)&&
  inBuffer(p.account_backup_binding,buffer,1,YNX_WALLET_V4_APPROVAL_BINDING_MAX)&&
  inBuffer(p.key_revision,buffer,1,20)&&decimal(p.key_revision)&&ownerShape(p.canonical_owner)&&
  std::memcmp(p.main_device_operation_id,p.pair_operation_id,32)!=0&&window(p);
}
template<size_t N> bool same(const std::vector<uint8_t>& value,const uint8_t(&expected)[N]) noexcept {
 return value.size()==N&&std::memcmp(value.data(),expected,N)==0;
}
bool matches(const ordinary::OpenedBackup& value,const Plan& p) noexcept {
 const auto& b=value.binding;
 return value.keys.bytes.size()==204&&same(b.network,p.network)&&same(b.owner,p.canonical_owner)&&
  same(b.pkA,p.account_pk_a)&&same(b.pkB,p.account_pk_b)&&
  b.canonical.size()==p.account_backup_binding.length&&
  std::memcmp(b.canonical.data(),p.account_backup_binding.bytes,b.canonical.size())==0;
}
}

AccountApprovalCustody::AccountApprovalCustody(Holder* holder) noexcept
 :actor_(std::this_thread::get_id()),holder_(holder) {}

AccountApprovalCustody::~AccountApprovalCustody(){
 // The production signer explicitly closes and consumes the result. Never
 // retry a selected release in destruction. OpenedBackup always wipes.
}

AccountApprovalCustody::Failure AccountApprovalCustody::open() noexcept {
 if(actor_!=std::this_thread::get_id())return error(WrongActor);
 if(!holder_||selected_||closeSelected_)return error(Closed);
 selected_=true;
 try {
  originalBytes_.resize(planCapacity);
  auto status=callStatus([&](Failure* f){
   ynx_wallet_v4_account_approval_copy_plan_v1(holder_,originalBytes_.data(),originalBytes_.size(),&plan_,f);
  });
  remember(first_,status);
  if(first_.present)return first_;
  if(!validPlan(plan_,originalBytes_))return first_=error(Invalid);

  Bytes encrypted{},credential{};
  // The Wallet slot is published directly so a partial survives late failure.
  status=callStatus([&](Failure* f){
   ynx_wallet_v4_account_approval_claim_backup_once_v1(holder_,&loan_,&encrypted,&credential,f);
  });
  loanAcquired_=loan_!=nullptr;
  remember(first_,status);
  if(first_.present)return first_;
  if(!loan_||!encrypted.bytes||!encrypted.length||encrypted.length>YNX_WALLET_V4_APPROVAL_BACKUP_MAX||
     !credential.bytes||credential.length!=YNX_WALLET_V4_APPROVAL_CREDENTIAL_BYTES)return first_=error(Invalid);
  auto gate=current();
  if(gate.present)return gate;
  auto value=ordinary::decodeOriginalBackup(encrypted.bytes,encrypted.length,credential.bytes,credential.length,
      plan_.account_backup_binding.bytes,plan_.account_backup_binding.length);
  if(!matches(value,plan_))return first_=error(Changed);
  gate=current();
  if(gate.present)return gate;
  backup_.emplace(std::move(value));
 }catch(const ordinary::Failure& f){remember(first_,{1,f.code,origin,0});}
 catch(...){remember(first_,error(Internal));}
 return first_;
}

AccountApprovalCustody::Failure AccountApprovalCustody::current() noexcept {
 if(actor_!=std::this_thread::get_id())return error(WrongActor);
 if(first_.present)return first_;
 if(!holder_||!loan_||closeSelected_)return error(Closed);
 if(!window(plan_))return first_=error(Changed);
 auto status=callStatus([&](Failure* f){ynx_wallet_v4_account_approval_backup_current_v1(holder_,loan_,f);});
 remember(first_,status);
 if(!first_.present&&!window(plan_))first_=error(Changed);
 return first_;
}

AccountApprovalCustody::Drain AccountApprovalCustody::close() noexcept {
 if(actor_!=std::this_thread::get_id())return {error(WrongActor),0,0};
 if(closeSelected_)return closedResult_;
 closeSelected_=true;
 // Wipe the private material before invoking any foreign cleanup boundary.
 backup_.reset();
 if(!loan_)return closedResult_; // No physical release was attempted.
 Drain drain{error(Internal),UINT32_MAX,UINT32_MAX};
 try {
  ynx_wallet_v4_account_approval_release_backup_v1(holder_,&loan_,&drain);
 }catch(...){
  Failure first{};
  remember(first,drain.failure);
  remember(first,error(Internal));
  closedResult_={first,1,0};return closedResult_;
 }
 if(!valid(drain.failure)||drain.unknown>1||drain.physical_done>1||
    (drain.unknown&&drain.physical_done)||(drain.physical_done!=(!loan_))){
  Failure first{};
  remember(first,drain.failure);
  remember(first,error(Invalid));
  closedResult_={first,1,0};return closedResult_;
 }
 closedResult_=drain;
 return closedResult_;
}
}
