#include "pay_native_link_channel.hpp"
#include "pay_native_runtime_private.hpp"

namespace {
struct DropSource {
 void operator()(ynx_wallet_pay_source_lease_v1*p)const{
  if(p)ynx_wallet_pay_source_lease_drop_v1(p);
 }
};
[[noreturn]] void source_failure(int32_t code){
 throw ynx::wallet::pay::Failure{"PAY_NATIVE_SOURCE_LEASE_"+std::to_string(code)};
}
}

// The one normal Native capture symbol. Source/registration comes from the
// actual Auth child, never a selector map, JS callback, URL or Core transport.
extern "C" void ynx_wallet_capture_original_pay_channel_v1(
 const ynx::wallet::pay::Binding*binding,bool query,
 ynx_wallet_pay_source_lease_v1*actual_source,
 std::unique_ptr<ynx::wallet::pay::QualifiedPayChannel>*out){
 if(!out)throw ynx::wallet::pay::Failure{"PAY_LINK_PARTIAL_OUT_REQUIRED"};
 if(*out)throw ynx::wallet::pay::Failure{"PAY_LINK_ALREADY_ADOPTED"};
 ynx_wallet_pay_source_lease_v1*partial=nullptr;
 const auto retained=ynx_wallet_pay_source_lease_retain_v1(actual_source,&partial);
 std::unique_ptr<ynx_wallet_pay_source_lease_v1,DropSource>source(partial);
 // Adopt the source partial before status, including a nonnull error borrow.
 if(retained!=YNX_PAY_SOURCE_CURRENT)source_failure(retained);
 if(!binding||!source)source_failure(YNX_PAY_SOURCE_ARGUMENT);
 ynx_link_private_client_registration_v1*registration=nullptr;
 ynx_link_private_client_source_fence_v1 fence{};
 const auto status=ynx::wallet::pay::borrow_original_pay_runtime(source.get(),*binding,query,&registration,&fence);
 if(status!=YNX_PAY_SOURCE_CURRENT)source_failure(status);
 ynx::wallet::pay::producer::capture_registered_channel(*binding,query,registration,fence,out);
 // LINK's successful native fence retain owns the SAME original source ctx
 // through real work+Join+Close. Only our temporary retain is dropped here.
}
