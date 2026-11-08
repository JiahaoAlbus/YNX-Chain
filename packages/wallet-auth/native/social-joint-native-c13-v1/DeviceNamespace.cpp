#include "DeviceNamespace.hpp"
#include "DeviceV4AccountNamespacePrivate.h"

namespace ynx::social::joint::original {
Result matchQualifiedDeviceNamespace(ynx_auth_device_v4_view_v1*view,
 const AccountNamespace&account,ynx_auth_device_v4_failure_v1&original)noexcept {
 original={};
 try {
  const ynx_auth_device_v4_bytes_v1 issuer{
   reinterpret_cast<const std::uint8_t*>(account.issuer.data()),account.issuer.size()};
  const ynx_auth_device_v4_bytes_v1 subject{
   reinterpret_cast<const std::uint8_t*>(account.subject.data()),account.subject.size()};
  const auto compared=ynx_auth_device_v4_view_match_account_namespace_v1(view,issuer,subject);
  original=compared.failure; // Preserve presence/code0/origin/platform together.
  if(original.present>1||(!original.present&&(original.code||original.origin||original.platform_code)))
   return {true,-41602,true,false};
  if(original.present)return {true,original.code,false,false};
  if(compared.matched>1)return {true,-41602,true,false};
  if(!compared.matched)return {true,-41601,false,false};
  return {};
 }catch(...){return {true,-41606,true,false};}
}
}
