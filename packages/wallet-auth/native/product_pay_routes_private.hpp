#pragma once
#include <array>
#include <cstdint>
namespace ynx::wallet::product {
struct ProductPayRouteDATA { const char *operation,*method,*path;bool body; };
/* Templates are DATA constraints, never authority. Actual argument grammar is
 * sole P06 client/SDK contract. LINK rejects mismatch, extra query/fragment,
 * duplicate or encoded separators; no wildcard/Member/sign/broadcast routes. */
inline constexpr std::array<ProductPayRouteDATA,14> product_pay_routes_v1={{
 {"createInvoiceIntent","POST","/v5/pay/invoice-intents",true},
 {"lookupInvoiceIntent","POST","/v5/pay/invoice-intents/lookup",true},
 {"merchantTermsReview","POST","/v5/pay/invoice-intents/{intentId}/merchant-review",true},
 {"readInvoiceIntent","GET","/v5/pay/invoice-intents/{intentId}",false},
 {"readInvoice","GET","/v5/pay/invoices/{merchant}/{invoiceId}",false},
 {"readInvoiceEvents","GET","/v5/pay/invoices/{merchant}/{invoiceId}/events",false},
 {"reviewSettlement","POST","/v5/pay/invoices/{merchant}/{invoiceId}/review",true},
 {"reviewRefund","POST","/v5/pay/invoices/{merchant}/{invoiceId}/refund-review",true},
 {"reconcileInvoiceIntent","POST","/v5/pay/invoice-intents/{intentId}/reconcile",true},
 {"reconcileOperation","POST","/v5/pay/invoices/{merchant}/{invoiceId}/operations/{nativeHash}/reconcile",true},
 {"readOriginalInvoiceIntent","LOCAL","",false},
 {"readInvoiceOriginals","GET","/v5/pay/invoices/{merchant}/{invoiceId}",false},
 {"readOriginalArchiveReceipt","GET","/v5/pay/products/{productId}/{sourceOrder}/invoices/{merchant}/{invoiceId}/originals/{nativeHash}/receipt",false},
 {"readOriginalArchiveReconciliation","GET","/v5/pay/products/{productId}/{sourceOrder}/invoices/{merchant}/{invoiceId}/archive-reconciliation",false}
}};
inline constexpr uint64_t product_pay_request_max_v1=1048576;
inline constexpr uint64_t product_pay_response_max_v1=1048576;
inline constexpr uint64_t product_pay_headers_max_v1=65536;
inline constexpr uint64_t product_pay_timeout_max_ms_v1=30000;
}
