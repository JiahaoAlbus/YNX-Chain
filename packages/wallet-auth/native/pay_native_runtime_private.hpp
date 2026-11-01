#pragma once
#include "pay_native_kernel.hpp"
#include "pay_native_source_lease_private.h"
#include "private_client_v1.h"

namespace ynx::wallet::pay {
// Extract the SAME actual normal registration already retained by this Auth
// native Source owner. No Binding lookup/global registration map/JSON config.
// Binding and query are constraints only. Zero outputs on any failure.
int32_t borrow_original_pay_runtime(
 ynx_wallet_pay_source_lease_v1*actual_source,
 const Binding&constraint,bool query_only,
 ynx_link_private_client_registration_v1**out_registration,
 ynx_link_private_client_source_fence_v1*out_fence)noexcept;
}
