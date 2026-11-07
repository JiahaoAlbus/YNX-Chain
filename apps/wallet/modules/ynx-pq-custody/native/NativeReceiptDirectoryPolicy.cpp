#include "NativeReceiptDirectoryPolicy.h"
#include <array>
namespace ynx::mobilepq::registered {
namespace {
struct Binding {
 uint32_t mode;
 const char *platform,*application,*resource,*network,*account;
 std::array<const char*,3>locators;
};
#ifdef YNX_NATIVE_RECEIPT_DIRECTORY_PUBLIC_CONTROLS
// Compile-time PUBLIC controls only. Never part of the normal OS target.
constexpr std::array<Binding,3>bindings{{
 {2,"android","PUBLIC-app","PUBLIC-source-resource","PUBLIC-network","0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",{{"PUBLIC-source-locator","",""}}},
 {2,"android","PUBLIC-ambiguous","PUBLIC-source-resource","PUBLIC-network","0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",{{"PUBLIC-source-locator","",""}}},
 {2,"android","PUBLIC-ambiguous","PUBLIC-source-resource","PUBLIC-network","0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",{{"PUBLIC-source-locator","",""}}}
}};
#else
// Original Native reviewed release rows belong HERE, in a fresh matching
// source/image after independent review. Auth's own locator is never copied
// into this table at runtime. No reviewed Native rows have been supplied.
constexpr std::array<Binding,0>bindings{};
#endif
}
bool matchesNativeCompiledReceiptDirectory(
 const ynx::auth::mobile::receipt::OriginalSourceSelection&s,
 const ynx::auth::mobile::receipt::DirectoryDATA&d)noexcept{
 if(s.version!=1||d.version!=2||d.role<1||d.role>3||d.rootLocator.empty())return false;
 size_t matched=0;
 for(const auto&row:bindings){
  if(s.mode!=row.mode||s.platform!=row.platform||s.applicationId!=row.application||
     s.protectedResourceRef!=row.resource||s.networkId!=row.network||s.account!=row.account)continue;
  // Ambiguous identity is refused even if both rows happen to name one key.
  if(++matched!=1||!*row.locators[d.role-1]||d.rootLocator!=row.locators[d.role-1])return false;
 }
 return matched==1;
}
}
