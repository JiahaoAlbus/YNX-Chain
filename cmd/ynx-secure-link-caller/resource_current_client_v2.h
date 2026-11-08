#ifndef YNX_LINK_RESOURCE_CURRENT_CLIENT_V2_H
#define YNX_LINK_RESOURCE_CURRENT_CLIENT_V2_H
#include "resource_current_client_v1.h"
#ifdef __cplusplus
extern "C" {
#endif

/* Independent successor for P09's original SAME-CONNECTION held reader.
 * v1 bytes/evidence remain unchanged. Native-only profile/fence DATA still
 * come solely from Auth's actual held Root-selected reference; this API never
 * creates Root/Source identity or accepts a JS/JSON configuration installer.
 * All operations use the original socket/reader/session. No session selector,
 * reconnect, retry after unknown effects, initializer, signature or dispatch.
 */
typedef struct ynx_link_resource_current_client_v2 ynx_link_resource_current_client_v2;
typedef struct ynx_link_resource_current_profile_v2 {
    uint32_t version, size; /* 2, sizeof(this struct) */
    ynx_link_resource_current_profile_v1 peer;
    /* Independently selected/OS checked, never copied from response JSON.
     * darwin:<start seconds>:<microseconds>, or
     * linux:<kernel boot UUID>:<process start ticks>. */
    char expected_server_start_identity[128];
} ynx_link_resource_current_profile_v2;

enum ynx_link_resource_current_error_v2 {
    /* Original v1 codes 0..9 retain their meaning. */
    YNX_LINK_RESOURCE_CURRENT_REMOTE_UNKNOWN_V2 = 10
};
typedef struct ynx_link_resource_current_lifetime_v2 {
    uint8_t local_retired, local_joined, local_physical_complete;
    uint8_t remote_acquisition_possible, remote_session_observed;
    uint8_t remote_partial_acquired, remote_retired_ack;
    uint8_t remote_joined_ack, remote_close_ack, remote_unknown;
} ynx_link_resource_current_lifetime_v2;
typedef struct ynx_link_resource_current_packet_v2 {
    /* Same owned original header/entity-body and partial/error DATA rules. */
    ynx_link_resource_current_packet_v1 transport;
    const char *operation;  /* one of the four original P09 fixed operations */
    const char *session_id; /* diagnostic correlation only, never an input */
    ynx_link_resource_current_lifetime_v2 lifetime;
} ynx_link_resource_current_packet_v2;

/* Open dials once, checks original OS peer, and sends the first original
 * resource_current{} to acquire the concrete reader. Adopt BOTH nonnull
 * outputs before inspecting rc, including failed/lost acquisition partials.
 * A possible acquisition retains its native parent borrow until a validated
 * same-session CLOSED/physicalComplete acknowledgement AND local drain.
 */
int32_t ynx_link_resource_current_open_v2(const ynx_link_resource_current_profile_v2 *profile,
    const ynx_link_private_client_source_fence_v1 *original_fence,
    ynx_link_resource_current_client_v2 **out_client,
    const ynx_link_resource_current_packet_v2 **out_packet);
/* Pure local observed flags/PID, not remote Current or Source authority. */
int32_t ynx_link_resource_current_current_local_v2(ynx_link_resource_current_client_v2 *client);
int32_t ynx_link_resource_current_read_v2(ynx_link_resource_current_client_v2 *client,
    const ynx_link_resource_current_packet_v2 **out_packet);
/* Retire immediately blocks new Current. It does NOT shutdown the socket.
 * If a Current is still in flight, returns DRAINING without a new wire write;
 * caller drains that exact response then explicitly resumes original cleanup.
 * Cleanup is allowed after the original native fence is revoked, but only for
 * the same held owner/OS peer; it cannot read/sign/dispatch new work.
 */
int32_t ynx_link_resource_current_retire_v2(ynx_link_resource_current_client_v2 *client,
    const ynx_link_resource_current_packet_v2 **out_packet);
/* Each call issues at most one original Join query; PENDING is known pending,
 * not permission to replace the reader. timeout0 only probes cached/local state.
 * An acknowledgement returned in out_packet remains a real local owner debt:
 * release it, then probe again to obtain completed=1. Cached acknowledged state
 * is never resent. No automatic retry/operation substitution occurs.
 */
int32_t ynx_link_resource_current_join_v2(ynx_link_resource_current_client_v2 *client,
    uint32_t timeout_ms, uint8_t *completed,
    const ynx_link_resource_current_packet_v2 **out_packet);
/* Close sends only the original same-session Close after acknowledged Join.
 * A CLOSED packet sets remote_close_ack, not local_physical_complete. Release
 * the owned packet, then call Close again for local fd/peer/fence finalization.
 * Local shutdown/EOF/timeout alone NEVER proves remote physical completion.
 * Lost/half-framed replies mark remote_unknown and retain the same parent;
 * no redial, guessed ACK, free or borrowed-parent close is permitted.
 * completed is physical local+remote drain independently of sticky firstcause.
 */
int32_t ynx_link_resource_current_close_v2(ynx_link_resource_current_client_v2 *client,
    uint8_t *completed, const ynx_link_resource_current_packet_v2 **out_packet);
int32_t ynx_link_resource_current_release_packet_v2(ynx_link_resource_current_client_v2 *client,
    const ynx_link_resource_current_packet_v2 *packet);
/* Native diagnostic snapshots only, never a publicly constructible capability. */
int32_t ynx_link_resource_current_get_lifetime_v2(ynx_link_resource_current_client_v2 *client,
    ynx_link_resource_current_lifetime_v2 *out_lifetime);
int32_t ynx_link_resource_current_first_error_v2(ynx_link_resource_current_client_v2 *client,
    int32_t *native_current_code, int32_t *system_errno);
int32_t ynx_link_resource_current_free_v2(ynx_link_resource_current_client_v2 *client);

#ifdef __cplusplus
}
#endif
#endif
