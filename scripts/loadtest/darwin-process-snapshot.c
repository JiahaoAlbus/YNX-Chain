// Read-only macOS resource telemetry for the isolated local Chain runner.
// --full additionally enumerates host processes and probes one ordinary fork.
// No host limit is changed and no command/account/environment text is read.
#include <errno.h>
#include <libproc.h>
#include <stdbool.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "process-snapshot-counts.h"

static bool read_pid_uid(pid_t pid, uid_t *uid, int *error, void *context) {
    (void)context;
    struct proc_bsdinfo bsd;
    memset(&bsd, 0, sizeof(bsd));
    errno = 0;
    int size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd, sizeof(bsd));
    *error = errno;
    if (size != sizeof(bsd)) return false;
    *uid = bsd.pbi_uid;
    return true;
}

static void stage(const char *name, struct timespec started) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    long long elapsed = (now.tv_sec - started.tv_sec) * 1000000LL +
                        (now.tv_nsec - started.tv_nsec) / 1000;
    fprintf(stderr, "{\"stage\":\"%s\",\"pid\":%d,\"elapsedMicroseconds\":%lld}\n", name, getpid(), elapsed);
    fflush(stderr);
}

static int read_limit(const char *name) {
    int value = 0;
    size_t size = sizeof(value);
    return sysctlbyname(name, &value, &size, NULL, 0) == 0 ? value : -1;
}

static bool parse_pid(const char *text, pid_t *out) {
    char *end = NULL;
    errno = 0;
    long value = strtol(text, &end, 10);
    if (errno || !text[0] || *end || value <= 0 || value > 2147483647L) return false;
    *out = (pid_t)value;
    return true;
}

#include "owned-process-snapshot.h"

int main(int argc, char **argv) {
    struct timespec started, finished;
    clock_gettime(CLOCK_MONOTONIC, &started);
    stage("main_entry", started);
    if (argc > 1 && strcmp(argv[1], "--owned-full") == 0) {
        pid_t launcher, job;
        if (argc != 4 || !parse_pid(argv[2], &launcher) || !parse_pid(argv[3], &job) || launcher == job) return 2;
        return ynx_owned_snapshot(launcher, job);
    }
    bool full = argc > 1 && strcmp(argv[1], "--full") == 0;
    int first = full ? 2 : 1;
    if (argc - first < 1 || argc - first > 16) return 2;
    pid_t watched[16];
    for (int i = first; i < argc; i++) if (!parse_pid(argv[i], &watched[i - first])) return 2;
    stage("arguments_validated", started);
    unsigned long long rss = 0;
    unsigned int threads = 0;
    printf("{\"schema\":1,\"scope\":\"proc_pidtaskinfo watched processes\",\"processes\":[");
    for (int i = 0; i < argc - first; i++) {
        struct proc_taskinfo info;
        memset(&info, 0, sizeof(info));
        errno = 0;
        fprintf(stderr, "{\"stage\":\"watched_query_begin\",\"pid\":%d,\"watchedPID\":%d,\"index\":%d}\n", getpid(), watched[i], i);
        fflush(stderr);
        errno = 0;
        int size = proc_pidinfo(watched[i], PROC_PIDTASKINFO, 0, &info, sizeof(info));
        int error = errno;
        fprintf(stderr, "{\"stage\":\"watched_query_end\",\"pid\":%d,\"watchedPID\":%d,\"index\":%d,\"returnedBytes\":%d,\"errno\":%d}\n", getpid(), watched[i], i, size, error);
        fflush(stderr);
        if (i) printf(",");
        if (size != sizeof(info)) {
            printf("{\"pid\":%d,\"readable\":false,\"errno\":%d}", watched[i], error);
        } else {
            rss += info.pti_resident_size;
            threads += info.pti_threadnum;
            printf("{\"pid\":%d,\"readable\":true,\"rssBytes\":%llu,\"virtualBytes\":%llu,\"threads\":%u}", watched[i], info.pti_resident_size, info.pti_virtual_size, info.pti_threadnum);
        }
    }
    struct proc_taskinfo own;
    memset(&own, 0, sizeof(own));
    stage("self_query_begin", started);
    if (proc_pidinfo(getpid(), PROC_PIDTASKINFO, 0, &own, sizeof(own)) != sizeof(own)) return 3;
    stage("self_query_end", started);
    // Reserve another sampler-sized RSS for its brief fork probe child.
    printf("],\"watchedRssBytes\":%llu,\"watchedThreads\":%u,\"samplerRssBytes\":%llu,\"samplerThreads\":%u,\"rssWithControlReserveBytes\":%llu,\"threadsWithControlReserve\":%u",
           rss, threads, own.pti_resident_size, own.pti_threadnum,
           rss + 2 * own.pti_resident_size, threads + own.pti_threadnum + 1);
    // This sysctl returns dispatch NOTE_* levels (1/2/4), not the kernel's
    // internal enum. It is a pressure signal, never an available-byte estimate.
    int pressure = -1;
    size_t pressure_size = sizeof(pressure);
    errno = 0;
    stage("pressure_query_begin", started);
    errno = 0;
    bool pressure_readable = sysctlbyname("kern.memorystatus_vm_pressure_level", &pressure, &pressure_size, NULL, 0) == 0 && pressure_size == sizeof(pressure);
    int pressure_error = errno;
    stage("pressure_query_end", started);
    printf(",\"memoryPressure\":{\"source\":\"kern.memorystatus_vm_pressure_level\",\"readable\":%s,\"dispatchLevel\":%d,\"errno\":%d}",
           pressure_readable ? "true" : "false", pressure, pressure_error);
    if (full) {
        stage("list_query", started);
        errno = 0;
        int needed = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
        int query_error = errno;
        if (needed <= 0 || needed > YNX_MAX_PID_BYTES - 4096 || needed % sizeof(pid_t)) {
            fprintf(stderr, "invalid PID size query: needed=%d errno=%d\n", needed, query_error);
            return 4;
        }
        int capacity = needed + 4096;
        pid_t *pids = calloc(1, capacity);
        if (!pids) return 5;
        errno = 0;
        int got = proc_listpids(PROC_ALL_PIDS, 0, pids, capacity);
        int list_error = errno;
        stage("list_returned", started);
        if (!ynx_pid_bytes_valid(needed, capacity, got)) {
            fprintf(stderr, "invalid PID buffer: needed=%d capacity=%d returned=%d errno=%d\n", needed, capacity, got, list_error);
            free(pids);
            return 4;
        }
        ynx_pid_counts counts = ynx_count_pids(pids, got / (int)sizeof(pid_t), getuid(), read_pid_uid, NULL);
        stage("bsd_scan_complete", started);
        free(pids);
        struct rlimit limit;
        long long soft = getrlimit(RLIMIT_NPROC, &limit) == 0 && limit.rlim_cur != RLIM_INFINITY ? (long long)limit.rlim_cur : -1;
        printf(",\"host\":{\"processCount\":%d,\"uid\":%u,\"uidProcessCount\":%d,\"unreadableBsdInfo\":%d,\"scanComplete\":%s,\"maxproc\":%d,\"maxprocperuid\":%d,\"rlimitNprocSoft\":%lld}",
               counts.process_count, getuid(), counts.uid_count, counts.unreadable, got < capacity ? "true" : "false", read_limit("kern.maxproc"), read_limit("kern.maxprocperuid"), soft);
        printf(",\"hostEnumeration\":{\"requiredBytes\":%d,\"capacityBytes\":%d,\"returnedBytes\":%d,\"queryErrno\":%d,\"readErrno\":%d,\"slots\":%d,\"nonPositiveEntries\":%d,\"positiveEntries\":%d,\"duplicateEntries\":%d,\"readableBsdInfo\":%d,\"esrch\":%d,\"eperm\":%d,\"eacces\":%d,\"noErrno\":%d,\"otherErrno\":%d}",
               needed, capacity, got, query_error, list_error, counts.slots, counts.non_positive, counts.positive_entries, counts.duplicates, counts.readable, counts.esrch, counts.eperm, counts.eacces, counts.no_errno, counts.other);
        // An inherited SIGCHLD ignore/SA_NOCLDWAIT would make waitpid fail
        // despite a successful fork. Reset only this disposable helper's
        // disposition, not anything in the launcher or host.
        struct sigaction action;
        memset(&action, 0, sizeof(action));
        action.sa_handler = SIG_DFL;
        sigemptyset(&action.sa_mask);
        if (sigaction(SIGCHLD, &action, NULL) != 0) return 6;
        stage("fork_begin", started);
        errno = 0;
        pid_t child = fork();
        int fork_error = errno;
        int wait_error = 0, child_exit = -1, child_signal = 0;
        bool available = false;
        if (child == 0) _exit(0);
        stage(child < 0 ? "fork_refused" : "wait_begin", started);
        if (child > 0) {
            int status;
            pid_t waited;
            do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
            available = waited == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
            if (waited < 0) wait_error = errno;
            else if (WIFEXITED(status)) child_exit = WEXITSTATUS(status);
            else if (WIFSIGNALED(status)) child_signal = WTERMSIG(status);
        }
        stage("fork_complete", started);
        printf(",\"forkProbe\":{\"available\":%s,\"forkSucceeded\":%s,\"forkErrno\":%d,\"waitErrno\":%d,\"childExitCode\":%d,\"childSignal\":%d}",
               available ? "true" : "false", child > 0 ? "true" : "false", child < 0 ? fork_error : 0, wait_error, child_exit, child_signal);
    }
    clock_gettime(CLOCK_MONOTONIC, &finished);
    long long elapsed = (finished.tv_sec - started.tv_sec) * 1000000LL + (finished.tv_nsec - started.tv_nsec) / 1000;
    printf(",\"elapsedMicroseconds\":%lld}\n", elapsed);
    return 0;
}
