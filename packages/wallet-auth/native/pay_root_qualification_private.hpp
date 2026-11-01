#pragma once
#include "pay_native_source_lease_private.hpp"
#include "pay_root_transport_private.hpp"
#include "pay_root_postbuild_private.hpp"
namespace ynx::wallet::pay {
struct RootQualificationAcquisition {std::shared_ptr<OriginalRootSource>owner;int32_t error;std::string cause;};
// Zero-input normal factory. No file/Root/scope/provider/verified input. Adopt
// nonnull owner even on error; same-owner cleanup, no automatic reopen/retry.
RootQualificationAcquisition acquire_original_pay_root_qualification() noexcept;
// Full original Source math+held-FD recheck, intentionally outside native write.
// It cannot refresh an already minted permission's fixed monotonic deadline.
int32_t recheck_original_pay_root_qualification(const std::shared_ptr<OriginalRootSource>&) noexcept;
// Genuine recognized Root ref, BEFORE SourceLease/Go registration. Owned DATA
// from signed scope Ref -> reviewed Root0 protected original -> exact profile.
int32_t read_original_pay_root_transport_profile(const std::shared_ptr<OriginalRootSource>&,root_physical::TransportProfile&) noexcept;
int32_t read_original_pay_root_transport_profile(const std::shared_ptr<OriginalRootSource>&,const Binding&,bool query_only,root_physical::TransportProfile&) noexcept;
int32_t read_original_pay_root_main_locator(const std::shared_ptr<OriginalRootSource>&,root_physical::RootMainLocator&) noexcept;
void retire_original_pay_root_qualification(const std::shared_ptr<OriginalRootSource>&) noexcept;
int32_t close_original_pay_root_qualification(const std::shared_ptr<OriginalRootSource>&) noexcept;
bool original_pay_root_qualification_closed(const std::shared_ptr<OriginalRootSource>&) noexcept;
}
