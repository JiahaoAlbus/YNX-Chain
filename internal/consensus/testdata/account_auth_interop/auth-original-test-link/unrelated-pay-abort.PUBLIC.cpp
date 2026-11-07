// HOST-MATH TEST ONLY. The combined one-runtime archive also contains unrelated
// Pay Go callbacks. These two deliberately ABORT if reached; they cannot grant
// Source or substitute a mobile producer. Production/mobile must NOT link this.
#include "product_pay_transport_private.h"
#include "pay_native_actual_context_private.h"
#include <cstdlib>
extern "C" int32_t ynx_product_pay_source_current_no_io_v1(ynx_product_pay_source_loan_v1*){std::abort();}
extern "C" int32_t ynx_wallet_pay_source_adopt_registration_v1(ynx_wallet_pay_actual_context_v1*,ynx_link_private_client_registration_borrow_v1*,ynx_wallet_pay_source_lease_v1**){std::abort();}
