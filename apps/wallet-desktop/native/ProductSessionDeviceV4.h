#ifndef YNX_AUTH_PRODUCT_DEVICE_V4_PRIVATE_H
#define YNX_AUTH_PRODUCT_DEVICE_V4_PRIVATE_H
#include <stddef.h>
#include <stdint.h>
/* New Auth-owned PRIVATE ABI proposal, NOT an accepted producer or installed
 * callee. Main/A must select its actual implementation before enabling it.
 * Never cast ordinary898/BIRTH owners, Source holder tokens or JS objects.
 * The purpose is the closed string PRODUCT-SESSION-HTTP-PROOF; no numeric
 * ordinary-custody purpose extension or raw-message signing API is defined. */
typedef struct ynx_auth_product_device_v4 ynx_auth_product_device_v4;
typedef struct ynx_auth_product_device_current_v4 ynx_auth_product_device_current_v4;
typedef struct ynx_auth_product_device_proof_v4 ynx_auth_product_device_proof_v4;
typedef struct { const uint8_t *data; size_t bytes; } ynx_auth_device_v4_public_bytes;
/* Expected17 and context12 are EXACT SDK49 canonical originals. Neither their
 * bytes nor this carrier constitutes a recognized Source/current owner. */
typedef struct {
 uint32_t version; /* exactly 4 */
 uint32_t size;
 uint8_t network[32];
 ynx_auth_device_v4_public_bytes unsigned21;
} ynx_auth_device_v4_http_input;
enum { YNX_AUTH_DEVICE_V4_MESSAGE_MAX=16384, YNX_AUTH_DEVICE_V4_MEMBER_MAX=98304 };
#ifdef __cplusplus
extern "C" {
#endif
/* IMPLEMENTED DATA framing only. Caller supplies canonical SDK49-normalized
 * unsigned21; this helper deliberately does not parse/approve it. Never feed
 * its output directly to a private primitive. No Source/device/sign grant.
 * All buffers stable for this synchronous call; outputs disjoint from every
 * input and each other. Failure leaves both output and written unchanged. */
int32_t ynx_auth_device_http_v4_e5_data(const uint8_t network[32],
 const uint8_t owner[42],const uint8_t *canonical_unsigned,size_t unsigned_bytes,
 uint8_t *output,size_t capacity,size_t *written);
#ifdef __cplusplus
}
#endif
#endif
