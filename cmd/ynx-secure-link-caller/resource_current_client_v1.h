#ifndef YNX_LINK_RESOURCE_CURRENT_CLIENT_V1_H
#define YNX_LINK_RESOURCE_CURRENT_CLIENT_V1_H

#include "private_client_v1.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Private same-image native transport, not a Root/Source constructor or a JS
 * registration API. Only Auth's original native factory converts its actual
 * held Root-selected reference to these immutable transport DATA and its
 * original retain/current/release fence. A PUBLIC test fence or a matching
 * UID, PID, image checksum, path, or returned JSON cannot supply that authority.
 * No field may come from a request, renderer, PWA token or JSON installer.
 */
typedef struct ynx_link_resource_current_client_v1 ynx_link_resource_current_client_v1;
enum ynx_link_resource_current_start_kind_v1 {
    YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1 = 1, /* kernel seconds, microseconds */
    YNX_LINK_RESOURCE_CURRENT_LINUX_START_V1 = 2  /* /proc stat field22 ticks, zero */
};
typedef struct ynx_link_resource_current_profile_v1 {
    uint32_t version, size;
    uint32_t peer_uid;
    int32_t peer_pid;
    uint32_t start_kind;
    uint64_t start_a, start_b;
    uint64_t image_bytes;
    uint8_t image_sha256[32];
    char socket_path[104];
    char image_path[4096];
    char source_id[257], instance_id[257], resource_key[257];
    uint32_t timeout_ms; /* 1..10000, original resource_current budget */
} ynx_link_resource_current_profile_v1;

enum ynx_link_resource_current_error_v1 {
    YNX_LINK_RESOURCE_CURRENT_OK_V1 = 0,
    YNX_LINK_RESOURCE_CURRENT_DENIED_V1 = 1,
    YNX_LINK_RESOURCE_CURRENT_BOUNDS_V1 = 2,
    YNX_LINK_RESOURCE_CURRENT_UNAVAILABLE_V1 = 3,
    YNX_LINK_RESOURCE_CURRENT_CANCELLED_V1 = 4,
    YNX_LINK_RESOURCE_CURRENT_DRAINING_V1 = 5,
    YNX_LINK_RESOURCE_CURRENT_NATIVE_CURRENT_V1 = 6,
    YNX_LINK_RESOURCE_CURRENT_CLOSED_V1 = 7,
    YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1 = 8,
    YNX_LINK_RESOURCE_CURRENT_TIMEOUT_V1 = 9
};

/* Adopt every nonnull packet before inspecting rc. Original HTTP headers and
 * body are owned bytes, including a received prefix on error. headers_original
 * contains the original HTTP header block (wire bytes, not a normalized map).
 * body_complete is independent of late peer/fence failure. valid_current_data
 * means this fixed transport/frame check passed, never SDK/Root admission.
 * response owner debt prevents Join/Close until release_packet. No pointers
 * can be serialized into another process or used after packet release.
 */
typedef struct ynx_link_resource_current_packet_v1 {
    uint8_t packet_present, body_complete, valid_current_data, dispatch_possible;
    int32_t status_code, error_code, native_current_code, system_errno;
    uint64_t partial_response_bytes;
    const uint8_t *headers_original;
    size_t headers_original_size;
    const uint8_t *body;
    size_t body_size;
    const char *request_id;
} ynx_link_resource_current_packet_v1;

/* Nonnull open partials must be adopted even on error. retain failure acquires
 * no fence borrow; successful retain is dropped once only after actual drain.
 * current is synchronous bounded IO and belongs outside Source/Store locks.
 * It writes only original POST /v1/call, Host localipc, resource_current {}.
 * One exclusive socket is retained: no reconnect, retry, redirect, alternate
 * endpoint, heartbeat, initialization, signing, task or operation selector.
 * P09's original idle timeout is 3s: idle closure is terminal for this client.
 */
int32_t ynx_link_resource_current_open_v1(const ynx_link_resource_current_profile_v1 *profile,
    const ynx_link_private_client_source_fence_v1 *original_fence,
    ynx_link_resource_current_client_v1 **out_client);
/* Pure observed native local flags and owning PID; no peer/proc/hash/fence/IO. */
int32_t ynx_link_resource_current_current_local_v1(ynx_link_resource_current_client_v1 *client);
int32_t ynx_link_resource_current_read_v1(ynx_link_resource_current_client_v1 *client,
    const ynx_link_resource_current_packet_v1 **out_packet);
int32_t ynx_link_resource_current_release_packet_v1(ynx_link_resource_current_client_v1 *client,
    const ynx_link_resource_current_packet_v1 *packet);
int32_t ynx_link_resource_current_retire_v1(ynx_link_resource_current_client_v1 *client);
/* completed reports physical drain independently from sticky first cause.
 * timeout_ms 0 is a nonblocking probe, 1..10000 a bounded wait. */
int32_t ynx_link_resource_current_join_v1(ynx_link_resource_current_client_v1 *client,
    uint32_t timeout_ms, uint8_t *completed);
int32_t ynx_link_resource_current_close_v1(ynx_link_resource_current_client_v1 *client,
    uint8_t *completed);
int32_t ynx_link_resource_current_first_error_v1(ynx_link_resource_current_client_v1 *client,
    int32_t *native_current_code, int32_t *system_errno);
/* Free requires physical close, and leaves a small nonreusable tombstone.
 * The process has a closed maximum of 1024 client lifetimes (no pointer ABA).
 * A pending/unknown callback or read is never erased to claim successful drain.
 */
int32_t ynx_link_resource_current_free_v1(ynx_link_resource_current_client_v1 *client);

#ifdef __cplusplus
}
#endif
#endif
