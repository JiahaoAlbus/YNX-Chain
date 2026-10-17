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

int main(int argc, char **argv) {
    bool full = argc > 1 && strcmp(argv[1], "--full") == 0;
    int first = full ? 2 : 1;
    if (argc - first < 1 || argc - first > 16) return 2;
    pid_t watched[16];
    for (int i = first; i < argc; i++) if (!parse_pid(argv[i], &watched[i - first])) return 2;
    struct timespec started, finished;
    clock_gettime(CLOCK_MONOTONIC, &started);
    unsigned long long rss = 0;
    unsigned int threads = 0;
    printf("{\"schema\":1,\"scope\":\"proc_pidtaskinfo watched processes\",\"processes\":[");
    for (int i = 0; i < argc - first; i++) {
        struct proc_taskinfo info;
        memset(&info, 0, sizeof(info));
        errno = 0;
        int size = proc_pidinfo(watched[i], PROC_PIDTASKINFO, 0, &info, sizeof(info));
        int error = errno;
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
    if (proc_pidinfo(getpid(), PROC_PIDTASKINFO, 0, &own, sizeof(own)) != sizeof(own)) return 3;
    // Reserve another sampler-sized RSS for its brief fork probe child.
    printf("],\"watchedRssBytes\":%llu,\"watchedThreads\":%u,\"samplerRssBytes\":%llu,\"samplerThreads\":%u,\"rssWithControlReserveBytes\":%llu,\"threadsWithControlReserve\":%u",
           rss, threads, own.pti_resident_size, own.pti_threadnum,
           rss + 2 * own.pti_resident_size, threads + own.pti_threadnum + 1);
    if (full) {
        int needed = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
        if (needed <= 0 || needed > (int)(65536 * sizeof(pid_t)) - 4096) return 4;
        int capacity = needed + 4096;
        pid_t *pids = calloc(1, capacity);
        if (!pids) return 5;
        int got = proc_listpids(PROC_ALL_PIDS, 0, pids, capacity);
        int process_count = 0, uid_count = 0, unreadable = 0;
        for (int i = 0; i < got / (int)sizeof(pid_t); i++) {
            if (pids[i] <= 0) continue;
            process_count++;
            struct proc_bsdinfo bsd;
            if (proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &bsd, sizeof(bsd)) == sizeof(bsd)) {
                if (bsd.pbi_uid == getuid()) uid_count++;
            } else unreadable++;
        }
        free(pids);
        struct rlimit limit;
        long long soft = getrlimit(RLIMIT_NPROC, &limit) == 0 && limit.rlim_cur != RLIM_INFINITY ? (long long)limit.rlim_cur : -1;
        printf(",\"host\":{\"processCount\":%d,\"uid\":%u,\"uidProcessCount\":%d,\"unreadableBsdInfo\":%d,\"scanComplete\":%s,\"maxproc\":%d,\"maxprocperuid\":%d,\"rlimitNprocSoft\":%lld}",
               process_count, getuid(), uid_count, unreadable, got > 0 && got < capacity ? "true" : "false", read_limit("kern.maxproc"), read_limit("kern.maxprocperuid"), soft);
        // An inherited SIGCHLD ignore/SA_NOCLDWAIT would make waitpid fail
        // despite a successful fork. Reset only this disposable helper's
        // disposition, not anything in the launcher or host.
        struct sigaction action;
        memset(&action, 0, sizeof(action));
        action.sa_handler = SIG_DFL;
        sigemptyset(&action.sa_mask);
        if (sigaction(SIGCHLD, &action, NULL) != 0) return 6;
        errno = 0;
        pid_t child = fork();
        int fork_error = errno;
        int wait_error = 0, child_exit = -1, child_signal = 0;
        bool available = false;
        if (child == 0) _exit(0);
        if (child > 0) {
            int status;
            pid_t waited;
            do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
            available = waited == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
            if (waited < 0) wait_error = errno;
            else if (WIFEXITED(status)) child_exit = WEXITSTATUS(status);
            else if (WIFSIGNALED(status)) child_signal = WTERMSIG(status);
        }
        printf(",\"forkProbe\":{\"available\":%s,\"forkSucceeded\":%s,\"forkErrno\":%d,\"waitErrno\":%d,\"childExitCode\":%d,\"childSignal\":%d}",
               available ? "true" : "false", child > 0 ? "true" : "false", child < 0 ? fork_error : 0, wait_error, child_exit, child_signal);
    }
    clock_gettime(CLOCK_MONOTONIC, &finished);
    long long elapsed = (finished.tv_sec - started.tv_sec) * 1000000LL + (finished.tv_nsec - started.tv_nsec) / 1000;
    printf(",\"elapsedMicroseconds\":%lld}\n", elapsed);
    return 0;
}
