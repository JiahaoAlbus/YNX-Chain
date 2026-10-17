#ifndef YNX_PROCESS_SNAPSHOT_COUNTS_H
#define YNX_PROCESS_SNAPSHOT_COUNTS_H
#include <stdbool.h>
#include <stddef.h>
#include <stdlib.h>
#include <errno.h>
#include <sys/types.h>

#define YNX_MAX_PID_BYTES (65536 * (int)sizeof(pid_t))

// libproc returns bytes, not entries. Reject impossible sizes before reading
// the buffer; a full buffer is valid input but not an exhaustive enumeration.
static bool ynx_pid_bytes_valid(int needed, int capacity, int returned) {
    return needed > 0 && needed <= YNX_MAX_PID_BYTES - 4096 &&
           needed % (int)sizeof(pid_t) == 0 &&
           capacity == needed + 4096 && capacity <= YNX_MAX_PID_BYTES &&
           returned > 0 && returned <= capacity &&
           returned % (int)sizeof(pid_t) == 0;
}

typedef struct {
    int slots, non_positive, positive_entries, duplicates;
    int process_count, uid_count, readable, unreadable;
    int esrch, eperm, eacces, other, no_errno;
} ynx_pid_counts;

typedef bool (*ynx_read_pid_uid)(pid_t pid, uid_t *uid, int *error, void *context);

static int ynx_compare_pid(const void *left, const void *right) {
    pid_t a = *(const pid_t *)left, b = *(const pid_t *)right;
    return (a > b) - (a < b);
}

// Sorting the owned bounded buffer lets duplicate entries be visible without
// treating repeated PIDs as independent processes or allocating an unbounded set.
static ynx_pid_counts ynx_count_pids(pid_t *pids, int slots, uid_t current_uid,
                                   ynx_read_pid_uid read_uid, void *context) {
    ynx_pid_counts out = {0};
    out.slots = slots;
    qsort(pids, (size_t)slots, sizeof(pid_t), ynx_compare_pid);
    pid_t prior = 0;
    for (int i = 0; i < slots; i++) {
        pid_t pid = pids[i];
        if (pid <= 0) { out.non_positive++; continue; }
        out.positive_entries++;
        if (pid == prior) { out.duplicates++; continue; }
        prior = pid;
        out.process_count++;
        uid_t uid = 0;
        int error = 0;
        if (read_uid(pid, &uid, &error, context)) {
            out.readable++;
            if (uid == current_uid) out.uid_count++;
        } else {
            out.unreadable++;
            if (error == ESRCH) out.esrch++;
            else if (error == EPERM) out.eperm++;
            else if (error == EACCES) out.eacces++;
            else if (error == 0) out.no_errno++;
            else out.other++;
        }
    }
    return out;
}
#endif
