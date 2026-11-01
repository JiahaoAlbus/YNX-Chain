#pragma once
#include "pay_root_qualification_private.hpp"
#include "pay_root_transport_loan_private.h"
namespace ynx::wallet::pay {
// Actual RootSource required, NOT base MainCodeRoot. Adopt nonnull loan before
// status. This is BEFORE any SourceLease/registration borrow, avoiding cycles.
int32_t capture_original_pay_root_transport(const std::shared_ptr<OriginalRootSource>&,const Binding&,bool query_only,ynx_wallet_pay_root_transport_loan_v1**out)noexcept;
}
