#include "AccountApprovalCustodyPrivate.hpp"
#include "AccountApprovalReceiptPrivate.h"
#include <product_session_approval_v4.h>

#include <cstring>
#include <limits>

namespace {
using Custody=ynx::mobilepq::android_account_approval::AccountApprovalCustody;
using Failure=Custody::Failure;
using Bytes=YNXProductSessionApprovalBytesV4;
constexpr uint32_t origin=0x4e415052;
constexpr int32_t invalid=74501, internal=74505, cleanupDebt=74506, badOutput=74507;
static_assert(int(YNX_PRODUCT_SESSION_APPROVAL_MEMBER_CAPACITY_V4)==int(YNX_WALLET_V4_APPROVAL_MEMBER_MAX));
static_assert(int(YNX_PRODUCT_SESSION_APPROVAL_E5_MAX_V4)==int(YNX_WALLET_V4_APPROVAL_E5_MAX));

Failure failure(int32_t code,int64_t detail=0) noexcept {return {1,code,origin,detail};}
void keep(Failure& first,Failure next) noexcept {
 if(!first.present&&next.present)first=next;
}
template<class T> bool aligned(T* p) noexcept {
 return p&&reinterpret_cast<uintptr_t>(p)%alignof(T)==0;
}
bool range(const void* p,size_t n) noexcept {
 return p&&n<=std::numeric_limits<uintptr_t>::max()-reinterpret_cast<uintptr_t>(p);
}
bool overlap(const void* a,size_t n,const void* b,size_t m) noexcept {
 const auto x=reinterpret_cast<uintptr_t>(a),y=reinterpret_cast<uintptr_t>(b);
 return x<y+m&&y<x+n;
}
bool outputs(uint8_t* member,size_t capacity,size_t* length,Failure* status) noexcept {
 return capacity==YNX_WALLET_V4_APPROVAL_MEMBER_MAX&&range(member,capacity)&&
  aligned(length)&&range(length,sizeof(*length))&&aligned(status)&&range(status,sizeof(*status))&&
  !overlap(member,capacity,length,sizeof(*length))&&!overlap(member,capacity,status,sizeof(*status))&&
  !overlap(length,sizeof(*length),status,sizeof(*status));
}
template<size_t N> Bytes bytes(const uint8_t(&v)[N]) noexcept {return {v,N};}
Bytes bytes(ynx_auth_android_provision_bytes_v1 v) noexcept {return {v.bytes,v.length};}
}

extern "C" void ynx_wallet_v4_account_approval_sign_n1_v1(
 Custody::Holder* holder,uint8_t* member,size_t capacity,size_t* length,Failure* status) {
 if(!outputs(member,capacity,length,status))return;
 *length=0;
 if(!holder){*status=failure(invalid);return;}
 Custody custody(holder);
 ynx_wallet_v4_account_approval_native_receipt_v1 receipt{};
 receipt.version=1;
 receipt.size=sizeof(receipt);
 auto first=custody.open();
 if(!first.present)first=custody.current();
 if(!first.present){
  const auto& plan=custody.originalPlan();
  const auto* backup=custody.opened();
  if(!backup)first=failure(internal);
  else {
   const auto* der=backup->keys.bytes.data();
   YNXProductSessionApprovalRequestV4 request{};
   request.version=YNX_PRODUCT_SESSION_APPROVAL_VERSION_V4;
   request.struct_size=sizeof(request);
   request.e5_original=bytes(plan.e5_original);
   request.expected={bytes(plan.network),bytes(plan.canonical_owner),bytes(plan.account_pk_a),
                     bytes(plan.account_pk_b),bytes(plan.key_revision)};
   request.pkcs8_a={der,54};request.pkcs8_b={der+54,150};
   request.pk_a={backup->binding.pkA.data(),backup->binding.pkA.size()};
   request.pk_b={backup->binding.pkB.data(),backup->binding.pkB.size()};

   size_t written=0;
   uint32_t cleanup=YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_UNKNOWN_V4;
   receipt.core_invoked=1;
   try {
    receipt.core_result=YNXProductSessionApprovalSignV4(&request,member,capacity,&written,&cleanup);
    receipt.core_result_present=1;
   }catch(...){keep(first,failure(internal));}
   receipt.core_cleanup=receipt.core_result_present?cleanup:YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_UNKNOWN_V4;
   // Capture bounded public bytes before interpreting Core, late current or
   // cleanup. Core owns the encoding; its error does not discard a partial.
   if(written<=capacity)*length=written;
   else keep(first,failure(badOutput));
   if(receipt.core_result_present&&receipt.core_result!=YNX_PRODUCT_SESSION_APPROVAL_OK_V4)
    keep(first,failure(receipt.core_result,cleanup));
   if(cleanup!=YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_LOGICAL_COMPLETE_V4)
    keep(first,failure(cleanupDebt,cleanup));
   if(!*length&&!first.present)first=failure(badOutput);
   keep(first,custody.current());
  }
 }
 receipt.backup_acquired=custody.hadLoan();
 receipt.backup_release_attempted=receipt.backup_acquired;
 receipt.backup_drain=custody.close();
 keep(first,receipt.backup_drain.failure);
 if(receipt.backup_acquired&&!receipt.backup_drain.physical_done)keep(first,failure(cleanupDebt));
 receipt.first=first;
 Failure persisted=failure(internal);
 try {ynx_wallet_v4_account_approval_record_native_receipt_v1(holder,&receipt,&persisted);}
 catch(...){if(!persisted.present)persisted=failure(internal);}
 if(persisted.present>1||(!persisted.present&&(persisted.code||persisted.origin||persisted.platform_code)))
  persisted=failure(internal);
 keep(first,persisted);
 *status=first;
}
