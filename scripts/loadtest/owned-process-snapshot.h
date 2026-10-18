#ifndef YNX_OWNED_PROCESS_SNAPSHOT_H
#define YNX_OWNED_PROCESS_SNAPSHOT_H

// Explicit schema 2 only. The original --full/schema 1 path is unchanged.
typedef struct {
    pid_t pid, parent, group;
    int bsd_error, identity_error;
    bool known, owned, fallback;
} ynx_owned_row;
typedef struct { ynx_owned_row *rows; int count; } ynx_owned_capture;

static bool ynx_capture_identity(pid_t pid, uid_t *uid, int *error, void *opaque) {
    ynx_owned_capture *capture = opaque;
    ynx_owned_row *row = &capture->rows[capture->count++];
    row->pid = pid;
    struct proc_bsdinfo bsd;
    memset(&bsd, 0, sizeof(bsd));
    errno = 0;
    int got = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd, sizeof(bsd));
    *error = errno;
    if (got == sizeof(bsd) && bsd.pbi_pid == (uint32_t)pid) {
        row->parent = bsd.pbi_ppid; row->group = bsd.pbi_pgid;
        row->known = true; *uid = bsd.pbi_uid;
        return true;
    }
    row->bsd_error = *error;
    // A vanished process cannot be an active descendant. Every other error
    // requires a real kernel identity, never exclusion based on UID guesses.
    if (*error != ESRCH) {
        int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid};
        struct kinfo_proc info;
        memset(&info, 0, sizeof(info));
        size_t size = sizeof(info);
        errno = 0;
        int status = sysctl(mib, 4, &info, &size, NULL, 0);
        row->identity_error = errno;
        if (status == 0 && size == sizeof(info) && info.kp_proc.p_pid == pid) {
            row->parent = info.kp_eproc.e_ppid; row->group = info.kp_eproc.e_pgid;
            row->known = true; row->fallback = true;
        } else if (status == 0 && size == 0) {
            row->identity_error = ESRCH;
        }
    }
    // Preserve the original BSD scan's counters/errors, even on fallback.
    return false;
}

static int ynx_owned_snapshot(pid_t launcher, pid_t job) {
    struct timespec started, finished;
    clock_gettime(CLOCK_MONOTONIC, &started);
    stage("list_query", started);
    errno = 0;
    int needed = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0), query_error = errno;
    if (needed <= 0 || needed > YNX_MAX_PID_BYTES - 4096 || needed % sizeof(pid_t)) return 4;
    int capacity = needed + 4096;
    pid_t *pids = calloc(1, capacity);
    ynx_owned_capture capture = {calloc((size_t)capacity / sizeof(pid_t), sizeof(ynx_owned_row)), 0};
    if (!pids || !capture.rows) { free(pids); free(capture.rows); return 5; }
    errno = 0;
    int got = proc_listpids(PROC_ALL_PIDS, 0, pids, capacity), list_error = errno;
    stage("list_returned", started);
    if (!ynx_pid_bytes_valid(needed, capacity, got)) { free(pids); free(capture.rows); return 4; }
    ynx_pid_counts counts = ynx_count_pids(pids, got / (int)sizeof(pid_t), getuid(), ynx_capture_identity, &capture);
    free(pids);
    stage("identity_scan_complete", started);
    int unresolved = 0, vanished = 0, selected = 0;
    bool launcher_found = false, job_found = false;
    for (int i = 0; i < capture.count; i++) {
        ynx_owned_row *row = &capture.rows[i];
        if (!row->known) {
            if (row->bsd_error == ESRCH || row->identity_error == ESRCH) vanished++;
            else unresolved++;
            continue;
        }
        if (row->parent < 0 || row->group < 0) { unresolved++; row->known = false; continue; }
        launcher_found |= row->pid == launcher;
        job_found |= row->pid == job;
        row->owned = row->pid == job || row->group == job;
    }
    pid_t frontier[17] = {job}; int frontier_count = 1;
    bool overflow = false;
    for (int i = 0; i < capture.count; i++) if (capture.rows[i].known && capture.rows[i].owned && capture.rows[i].pid != job) {
        if (frontier_count >= 17) { overflow = true; break; }
        frontier[frontier_count++] = capture.rows[i].pid;
    }
    for (int next = 0; next < frontier_count && !overflow; next++) {
        for (int i = 0; i < capture.count; i++) {
            ynx_owned_row *row = &capture.rows[i];
            if (!row->known || row->owned) continue;
            if (row->parent == frontier[next]) {
                row->owned = true;
                if (frontier_count >= 17) { overflow = true; break; }
                frontier[frontier_count++] = row->pid;
            }
        }
    }
    for (int i = 0; i < capture.count; i++) if (capture.rows[i].known && (capture.rows[i].owned || capture.rows[i].pid == launcher)) selected++;
    bool ownership_complete = launcher_found && job_found && selected <= 16 && !overflow;
    unsigned long long rss = 0;
    unsigned int threads = 0;
    printf("{\"schema\":2,\"scope\":\"native owned process inventory\",\"processes\":[");
    int printed = 0;
    if (selected <= 16) for (int i = 0; i < capture.count; i++) {
        ynx_owned_row *row = &capture.rows[i];
        if (!row->known || (!row->owned && row->pid != launcher)) continue;
        struct proc_taskinfo task;
        memset(&task, 0, sizeof(task)); errno = 0;
        int size = proc_pidinfo(row->pid, PROC_PIDTASKINFO, 0, &task, sizeof(task)), error = errno;
        if (printed++) printf(",");
        if (size != sizeof(task)) printf("{\"pid\":%d,\"readable\":false,\"errno\":%d}", row->pid, error);
        else {
            rss += task.pti_resident_size; threads += task.pti_threadnum;
            printf("{\"pid\":%d,\"readable\":true,\"rssBytes\":%llu,\"threads\":%u}", row->pid, task.pti_resident_size, task.pti_threadnum);
        }
    }
    struct proc_taskinfo own;
    memset(&own, 0, sizeof(own));
    if (proc_pidinfo(getpid(), PROC_PIDTASKINFO, 0, &own, sizeof(own)) != sizeof(own)) { free(capture.rows); return 3; }
    printf("],\"watchedRssBytes\":%llu,\"watchedThreads\":%u,\"samplerRssBytes\":%llu,\"samplerThreads\":%u,\"rssWithControlReserveBytes\":%llu,\"threadsWithControlReserve\":%u", rss, threads, own.pti_resident_size, own.pti_threadnum, rss + 2 * own.pti_resident_size, threads + own.pti_threadnum + 1);
    int pressure = -1; size_t pressure_size = sizeof(pressure); errno = 0;
    bool pressure_ok = sysctlbyname("kern.memorystatus_vm_pressure_level", &pressure, &pressure_size, NULL, 0) == 0 && pressure_size == sizeof(pressure);
    printf(",\"memoryPressure\":{\"source\":\"kern.memorystatus_vm_pressure_level\",\"readable\":%s,\"dispatchLevel\":%d,\"errno\":%d}", pressure_ok ? "true" : "false", pressure, errno);
    struct rlimit limit;
    long long soft = getrlimit(RLIMIT_NPROC, &limit) == 0 && limit.rlim_cur != RLIM_INFINITY ? (long long)limit.rlim_cur : -1;
    printf(",\"host\":{\"processCount\":%d,\"uid\":%u,\"uidProcessCount\":%d,\"unreadableBsdInfo\":%d,\"scanComplete\":%s,\"maxproc\":%d,\"maxprocperuid\":%d,\"rlimitNprocSoft\":%lld}", counts.process_count, getuid(), counts.uid_count, counts.unreadable, got < capacity ? "true" : "false", read_limit("kern.maxproc"), read_limit("kern.maxprocperuid"), soft);
    printf(",\"hostEnumeration\":{\"requiredBytes\":%d,\"capacityBytes\":%d,\"returnedBytes\":%d,\"queryErrno\":%d,\"readErrno\":%d,\"slots\":%d,\"nonPositiveEntries\":%d,\"positiveEntries\":%d,\"duplicateEntries\":%d,\"readableBsdInfo\":%d,\"esrch\":%d,\"eperm\":%d,\"eacces\":%d,\"noErrno\":%d,\"otherErrno\":%d}", needed, capacity, got, query_error, list_error, counts.slots, counts.non_positive, counts.positive_entries, counts.duplicates, counts.readable, counts.esrch, counts.eperm, counts.eacces, counts.no_errno, counts.other);
    printf(",\"inventory\":{\"source\":\"proc_listpids+kernel_identity\",\"complete\":%s,\"launcherPID\":%d,\"jobPID\":%d,\"ownershipComplete\":%s,\"vanished\":%d,\"unresolved\":%d,\"rows\":[", got < capacity && unresolved == 0 ? "true" : "false", launcher, job, ownership_complete ? "true" : "false", vanished, unresolved);
    printed = 0;
    for (int i = 0; i < capture.count; i++) {
        ynx_owned_row *row = &capture.rows[i]; if (!row->known) continue;
        if (printed++) printf(",");
        printf("{\"pid\":%d,\"parent\":%d,\"group\":%d,\"identitySource\":\"%s\"}", row->pid, row->parent, row->group, row->fallback ? "KERN_PROC_PID" : "PROC_PIDTBSDINFO");
    }
    printf("],\"unresolvedRows\":["); printed = 0;
    for (int i = 0; i < capture.count; i++) {
        ynx_owned_row *row = &capture.rows[i];
        if (row->known || row->bsd_error == ESRCH || row->identity_error == ESRCH) continue;
        if (printed++) printf(",");
        printf("{\"pid\":%d,\"bsdErrno\":%d,\"identityErrno\":%d}", row->pid, row->bsd_error, row->identity_error);
    }
    printf("]}"); free(capture.rows);
    struct sigaction action; memset(&action, 0, sizeof(action)); action.sa_handler = SIG_DFL; sigemptyset(&action.sa_mask);
    if (sigaction(SIGCHLD, &action, NULL) != 0) return 6;
    stage("fork_begin", started); errno = 0;
    pid_t child = fork(); int fork_error = errno, wait_error = 0, child_exit = -1, child_signal = 0;
    bool available = false;
    if (child == 0) _exit(0);
    if (child > 0) {
        int status; pid_t waited;
        do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
        if (waited < 0) wait_error = errno;
        else if (WIFEXITED(status)) child_exit = WEXITSTATUS(status);
        else if (WIFSIGNALED(status)) child_signal = WTERMSIG(status);
        available = waited == child && child_exit == 0;
    }
    stage("fork_complete", started);
    printf(",\"forkProbe\":{\"available\":%s,\"forkSucceeded\":%s,\"forkErrno\":%d,\"waitErrno\":%d,\"childExitCode\":%d,\"childSignal\":%d}", available ? "true" : "false", child > 0 ? "true" : "false", child < 0 ? fork_error : 0, wait_error, child_exit, child_signal);
    clock_gettime(CLOCK_MONOTONIC, &finished);
    printf(",\"elapsedMicroseconds\":%lld}%s", (finished.tv_sec-started.tv_sec)*1000000LL+(finished.tv_nsec-started.tv_nsec)/1000, ynx_snapshot_framed ? "" : "\n");
    return 0;
}
#endif
