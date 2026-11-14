#include "cloud-finite-get-control-c.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>

#if !defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_C_TEST)
#error This fixture requires explicit PUBLIC test compilation.
#endif

/* The C TU drives the actual owner API, using sockets owned by the C++ fixture. */
int fixture_cloud_c_receive(ynx_cloud_finite_get_control **owner, int data_fd, int wake_fd,
    const ynx_cloud_control_expected_process *expected, uint8_t original_marker, int canceled) {
    ynx_cloud_control_snapshot snapshot;
    uint8_t marker = 0;
    *owner = ynx_cloud_control_new();
    if (!*owner || ynx_cloud_control_free(owner)) return 0;
    if (ynx_cloud_control_receive(*owner, data_fd, wake_fd, expected, 2000, &marker) != !canceled ||
        !ynx_cloud_control_get_snapshot(*owner, &snapshot)) return 0;
    if (canceled) {
        if (marker || snapshot.descriptor_received || snapshot.peer_bound || !snapshot.first_error_present ||
            snapshot.first_system_error != ECANCELED || !snapshot.first_detail[0] ||
            fcntl(wake_fd, F_GETFD) < 0) return 0;
    } else if (marker != original_marker || !snapshot.descriptor_received || !snapshot.peer_bound ||
               snapshot.first_error_present) return 0;
    return !snapshot.local_closed && !snapshot.close_unknown && fcntl(data_fd, F_GETFD) >= 0;
}

int fixture_cloud_c_close(ynx_cloud_finite_get_control **owner, int data_fd, int wake_fd, int canceled, int unknown) {
    ynx_cloud_control_snapshot before, after;
    uint8_t marker = 0xff;
    if (!ynx_cloud_control_get_snapshot(*owner, &before)) return 0;
    if (canceled) {
        /* Mutating our DATA copy cannot modify the immutable first diagnostic. */
        before.first_detail[0] = 'X';
        if (!ynx_cloud_control_get_snapshot(*owner, &after) || before.first_detail[0] == after.first_detail[0]) return 0;
        before = after;
        if (ynx_cloud_control_receive(*owner, data_fd, wake_fd, NULL, 2000, &marker) || marker) return 0;
    }
    ynx_cloud_control_retire(*owner);
    if (ynx_cloud_control_close(*owner) != !unknown || ynx_cloud_control_close(*owner) != !unknown ||
        !ynx_cloud_control_get_snapshot(*owner, &after) || !after.retired || after.local_closed != !unknown ||
        after.close_unknown != unknown || after.close_error != (unknown ? EIO : 0) ||
        fcntl(data_fd, F_GETFD) < 0 || (wake_fd >= 0 && fcntl(wake_fd, F_GETFD) < 0)) return 0;
    if (canceled && (before.first_system_error != after.first_system_error ||
        strcmp(before.first_detail, after.first_detail) != 0)) return 0;
    if (unknown && (!after.first_error_present || after.first_system_error != EIO)) return 0;
    ynx_cloud_finite_get_control *same = *owner;
    return ynx_cloud_control_free(owner) == !unknown && *owner == (unknown ? same : NULL);
}
