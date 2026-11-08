#ifndef YNX_ORIGINAL_PRODUCT_SESSION_PROOF_V2_PRIVATE_H
#define YNX_ORIGINAL_PRODUCT_SESSION_PROOF_V2_PRIVATE_H
#include <stddef.h>
#include <stdint.h>
#define YNX_ORIGINAL_PRODUCT_SESSION_PROOF_V2_HEADER_NAME "x-ynx-product-session-proof-v2"
#define YNX_ORIGINAL_PRODUCT_SESSION_PROOF_V2_HEADER_MIN 2u
#define YNX_ORIGINAL_PRODUCT_SESSION_PROOF_V2_HEADER_MAX 16384u
/* Detached transport DATA only, never a Session/Source/role capability.
 * Exactly one fixed header value: ASCII [A-Za-z0-9_-], no padding or CR/LF.
 * Sole SDK decodeProductSessionGatewayProofHeaderV2 + canonical re-encode must
 * match the ORIGINAL bytes. No second proof codec/crypto belongs in LINK/C++.
 * Borrow from the genuine protected session producer, copy under its current
 * before/after fence, retain its owner through the SAME request/socket drain.
 * The fixed GET has no body/Content-Type; the proof itself authorizes the
 * server's exact POST introspection scopes. They are different HTTP contexts.
 * No header name, URL, provider, extra header map, or authority boolean input.
 * Nonempty bytes must be live immutable, nonoverflowing, owned synchronous
 * allocations. This ABI cannot prove arbitrary pointer provenance/lifetime.
 */
typedef struct ynx_original_product_session_proof_v2_header_data_v1 {
 const uint8_t *header_value;
 uint64_t header_value_bytes;
} ynx_original_product_session_proof_v2_header_data_v1;
#ifdef __cplusplus
static_assert(sizeof(void*) == 8, "64-bit private ABI only");
static_assert(sizeof(ynx_original_product_session_proof_v2_header_data_v1) == 16, "proof header span16");
#else
_Static_assert(sizeof(void*) == 8, "64-bit private ABI only");
_Static_assert(sizeof(ynx_original_product_session_proof_v2_header_data_v1) == 16, "proof header span16");
#endif
#endif
