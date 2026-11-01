#pragma once
#include "product_pay_resource_private.hpp"
#include "product_pay_transport_private.h"
namespace ynx::wallet::product {
// Private producer ONLY. The same actual Root and independently protected
// resource must both remain held. Not callable with caller JSON or a proof DTO.
// Returns a nonnull partial before any late error; release it, never re-mint
// that operation after UNKNOWN. LOCAL operation 10 has no transport loan.
int32_t borrow_original_product_pay_source(
 const std::shared_ptr<OriginalProductRoot>&,
 const std::shared_ptr<ProductPayResourceRoot>&,
 uint32_t operation,ynx_product_pay_source_loan_v1 **out) noexcept;
}
