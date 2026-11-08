#ifndef YNX_SOCIAL_SOURCE_FRAME_DATA_PRIVATE_V1_H
#define YNX_SOCIAL_SOURCE_FRAME_DATA_PRIVATE_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Public DATA only. No signing, authority, parsing or canonicalization.
 * role is exact bounded UTF8 bytes: credential, record-issuer, record-anchor,
 * current-history or directory-checkpoint. Body is ORIGINAL bytes (NUL kept).
 * body:1..32768, frame<=49152. Inputs are copied before output (alias safe).
 * Caller supplies valid buffers; written must not overlap input/output spans.
 * No output/partial on failure. *written is
 * initialized to zero whenever nonnull, also on capacity/argument failures.
 * Status 0 success, 1 bad arguments, 2 invalid original role/body, 3 capacity.
 * Capacity must cover the whole frame. No borrowed Go pointer is returned.
 * This symbol is defined by the same kernel Go archive, not a second encoder.
 */
int32_t ynx_auth_social_source_frame_prepare_v1(
    const uint8_t *role, size_t role_length,
    const uint8_t *body_original, size_t body_length,
    uint8_t *out, size_t capacity, size_t *written);
#ifdef __cplusplus
}
#endif
#endif
