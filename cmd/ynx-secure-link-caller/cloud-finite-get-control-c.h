#ifndef YNX_LINK_CLOUD_FINITE_GET_CONTROL_C_H
#define YNX_LINK_CLOUD_FINITE_GET_CONTROL_C_H

#include <stddef.h>
#include <stdint.h>

/* Private implementation ABI for the fixed native accept owner. A C/Node
 * wrapper must never expose these calls, FDs, or expected-process input to JS. */
#if defined(__GNUC__) || defined(__clang__)
#define YNX_CLOUD_CONTROL_PRIVATE __attribute__((visibility("hidden")))
#else
#define YNX_CLOUD_CONTROL_PRIVATE
#endif
#ifdef __cplusplus
extern "C" {
#endif

typedef struct ynx_cloud_finite_get_control ynx_cloud_finite_get_control;

typedef struct {
    uint32_t uid;
    int32_t pid;
    uint32_t start_kind;
    uint64_t start_a, start_b;
    const char *image_path;
    size_t image_path_bytes;
    uint64_t image_bytes;
    uint8_t image_sha256[32];
} ynx_cloud_control_expected_process;

typedef struct {
    int descriptor_received, peer_bound, retired, local_closed, close_unknown;
    int close_error, first_error_present, first_system_error;
    char first_detail[192];
} ynx_cloud_control_snapshot;

/* Adopt the handle before attempting any I/O. An unsuccessful receive leaves
 * that same handle, its first diagnostic, and any received descriptor debt. */
YNX_CLOUD_CONTROL_PRIVATE ynx_cloud_finite_get_control *ynx_cloud_control_new(void);

/* One serialized worker. accepted_fd and optional wake_fd (-1 for none) are
 * borrowed and stay open until the call returns. The listener's original
 * worker owns its wake duplicate and remaining timeout. The marker is observed
 * only after strong peer validation. The eventual Cloud owner checks the SDK
 * marker and retains this exact handle for the later C++ request/loan phase. */
YNX_CLOUD_CONTROL_PRIVATE int ynx_cloud_control_receive(ynx_cloud_finite_get_control *owner, int accepted_fd,
    int wake_fd, const ynx_cloud_control_expected_process *expected, uint32_t remaining_ms, uint8_t *marker);

/* Wait for the original worker before retire, close, or reading state. Each
 * state read copies DATA. It exposes no operation for attesting remote close. */
YNX_CLOUD_CONTROL_PRIVATE int ynx_cloud_control_get_snapshot(const ynx_cloud_finite_get_control *owner, ynx_cloud_control_snapshot *out);
YNX_CLOUD_CONTROL_PRIVATE void ynx_cloud_control_retire(ynx_cloud_finite_get_control *owner);
YNX_CLOUD_CONTROL_PRIVATE int ynx_cloud_control_close(ynx_cloud_finite_get_control *owner);

/* Free succeeds only after a known local close of the bridge's own resources.
 * UNKNOWN leaves the pointer untouched and requires the original owner to keep
 * the handle. The original HTTP FD and remote Auth actor close independently. */
YNX_CLOUD_CONTROL_PRIVATE int ynx_cloud_control_free(ynx_cloud_finite_get_control **owner);

#ifdef __cplusplus
}
namespace ynx::cloud_finite_get_detail {
class Control;
/* Later C++ Cloud composition borrows this exact already-bound object. The C
 * owner retains it, serializes operations, and alone retires/closes/frees it. */
YNX_CLOUD_CONTROL_PRIVATE Control *borrow_accepted_control(ynx_cloud_finite_get_control *owner);
}
#endif
#undef YNX_CLOUD_CONTROL_PRIVATE
#endif
