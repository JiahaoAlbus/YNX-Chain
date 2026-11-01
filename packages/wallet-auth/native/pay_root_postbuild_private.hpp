#pragma once
#include "pay_root_public_hold_private.hpp"
#include "pay_root_transport_release_private.hpp"
#include <memory>
namespace ynx::wallet::pay::root_physical {
struct PostbuildAcquisition;
struct RootMainLocator {uint32_t version=1;std::string main_uri,module_sha256;uint64_t module_bytes=0;};
class PayPostbuildOriginal final {
public:
 ~PayPostbuildOriginal();
 Code current() noexcept;
 Code reobserve_code_only() noexcept;
 Code copy_main_locator(RootMainLocator&) noexcept;
 Code copy_main_code_locator(RootMainLocator&) noexcept;
 Code copy_node_loader_code_locator(RootMainLocator&) noexcept;
 Code close() noexcept;
 bool closed()const noexcept;
private:
 struct Impl;std::unique_ptr<Impl> p_;
 explicit PayPostbuildOriginal(std::unique_ptr<Impl>);
 friend struct PostbuildAcquisition;
 friend PostbuildAcquisition capture_pay_postbuild_original(const RootPublicLocator&,const std::string&,const std::string&,const void*,const void*)noexcept;
 friend PostbuildAcquisition capture_pay_postbuild_impl(const RootPublicLocator&,const std::string&,const std::string&,const void*,const void*);
};
struct PostbuildAcquisition {std::unique_ptr<PayPostbuildOriginal>owner;Code error;};
// Locator only from SAME independently released Root resource parent. Exact
// public postbuild record is outside own image; never a compiled self hash.
PostbuildAcquisition capture_pay_postbuild_original(const RootPublicLocator&,const std::string&authenticated_ref,const std::string&authenticated_source_id,const void*actual_entry,const void*source_hidden_marker)noexcept;
PostbuildAcquisition acquire_registered_pay_postbuild_original(const std::string&authenticated_ref,const std::string&authenticated_source_id,OriginalReadWindow,const void*actual_entry,const void*source_hidden_marker)noexcept;
}
