#include <assert.h>
#include <stdio.h>
#include "process-snapshot-counts.h"

static bool read_uid(pid_t pid, uid_t *uid, int *error, void *context) {
    int *calls = context;
    (*calls)++;
    if (pid == 1) { *uid = 501; return true; }
    if (pid == 2) { *uid = 0; return true; }
    switch (pid) {
        case 3: *error = ESRCH; break;
        case 4: *error = EPERM; break;
        case 5: *error = EACCES; break;
        case 6: *error = 0; break;
        default: *error = EINVAL; break;
    }
    return false;
}

int main(void) {
    int needed = 32 * (int)sizeof(pid_t), capacity = needed + 4096;
    assert(ynx_pid_bytes_valid(needed, capacity, needed));
    assert(ynx_pid_bytes_valid(needed, capacity, capacity));
    assert(!ynx_pid_bytes_valid(needed, capacity, capacity + 4));
    assert(!ynx_pid_bytes_valid(needed, capacity, needed - 1));
    assert(!ynx_pid_bytes_valid(needed, capacity, -1));
    assert(!ynx_pid_bytes_valid(needed, capacity, 0));
    assert(!ynx_pid_bytes_valid(needed, capacity - 4, needed));
    assert(!ynx_pid_bytes_valid(YNX_MAX_PID_BYTES, YNX_MAX_PID_BYTES + 4096, 4));
    pid_t pids[] = {7, 1, 0, -1, 2, 3, 4, 5, 6, 1, 7};
    int calls = 0;
    ynx_pid_counts c = ynx_count_pids(pids, 11, 501, read_uid, &calls);
    assert(c.slots == 11 && c.non_positive == 2 && c.positive_entries == 9);
    assert(c.duplicates == 2 && c.process_count == 7 && calls == 7);
    assert(c.readable == 2 && c.uid_count == 1 && c.unreadable == 5);
    assert(c.esrch == 1 && c.eperm == 1 && c.eacces == 1 && c.no_errno == 1 && c.other == 1);
    assert(c.readable + c.unreadable == c.process_count);
    assert(c.esrch + c.eperm + c.eacces + c.no_errno + c.other == c.unreadable);
    assert(c.process_count + c.duplicates + c.non_positive == c.slots);
    puts("PASS: bounded byte lengths, duplicate/zero filtering, readable UID counts and errno conservation");
    return 0;
}
