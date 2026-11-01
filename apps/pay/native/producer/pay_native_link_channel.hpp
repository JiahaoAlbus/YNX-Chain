#pragma once
#include "pay_native_channel_private.hpp"
#include "private_client_v1.h"

namespace ynx::wallet::pay::producer {
// Private composition only: both arguments must come from the actual native
// Source child's original registration/retained native fence. No JS installer,
// destination selector or authority is produced by this adapter.
void capture_registered_channel(const Binding&,bool query_only,
 ynx_link_private_client_registration_v1*,
 const ynx_link_private_client_source_fence_v1&,
 std::unique_ptr<QualifiedPayChannel>* out);
}
