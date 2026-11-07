// Existing Auth PUBLIC row function from verbatim receipt.PUBLIC.cpp ONLY.
// Not compiled into production, not a Root selection or normal host supplier.
#include "MobileRegisteredReceiptReleasePrivate.hpp"
ynx::auth::mobile::receipt::ReviewedReceiptRelease publicReceiptRelease();
#define YNX_REVIEWED_MOBILE_RECEIPT_RELEASE_ROWS ::publicReceiptRelease()
