#pragma once
#include "pay_native_actual_context_private.h"
#include "pay_native_source_lease_private.hpp"
namespace ynx::wallet::pay {
// Normal Native composition only. Transport loan is captured INSIDE this
// constructor from actual recognized Root/binding/query, never supplied by a
// Go/C caller. Nonnull ctx must be adopted before checking status.
int32_t capture_original_pay_actual_context(std::shared_ptr<OriginalRootSource>,std::shared_ptr<MainNativeEpoch>,const Binding&,bool query,ynx_wallet_pay_actual_context_v1**)noexcept;
}
