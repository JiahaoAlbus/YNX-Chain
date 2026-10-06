#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/proc.h>
#include <sys/types.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <sys/clonefile.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <dirent.h>
#include <limits.h>

// Filesystem operation is separate from process cleanup. It has no fallback:
// callers must budget a full copy before handling unsupported clone filesystems.
static int clone_entries(int source, int target, unsigned depth, unsigned *count) {
  if (depth > 128) { errno = ELOOP; return -1; }
  DIR *entries = fdopendir(dup(source));
  if (!entries) return -1;
  struct dirent *entry; int result = 0;
  while (1) {
    errno = 0; entry = readdir(entries);
    if (!entry) { if (errno) result = -1; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (++*count > 100000) { errno = EFBIG; result = -1; break; }
    int fd = openat(source, entry->d_name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    struct stat stat;
    if (fd < 0 || fstat(fd, &stat)) { if (fd >= 0) close(fd); result = -1; break; }
    if (S_ISDIR(stat.st_mode)) {
      if (mkdirat(target, entry->d_name, 0700)) result = -1;
      else {
        int child = openat(target, entry->d_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (child < 0) result = -1;
        else { result = clone_entries(fd, child, depth + 1, count); if (!result && fchmod(child, stat.st_mode & 0777)) result = -1; int saved = errno; close(child); errno = saved; }
      }
    } else if (S_ISREG(stat.st_mode)) {
      result = fclonefileat(fd, target, entry->d_name, CLONE_NOOWNERCOPY);
      if (!result) {
        struct stat copied;
        if (fstatat(target, entry->d_name, &copied, AT_SYMLINK_NOFOLLOW) || !S_ISREG(copied.st_mode) ||
            (copied.st_dev == stat.st_dev && copied.st_ino == stat.st_ino)) { errno = EINVAL; result = -1; }
      }
    } else { errno = EINVAL; result = -1; }
    int saved = errno; close(fd); errno = saved;
    if (result) break;
  }
  int saved = errno; closedir(entries); errno = saved; return result;
}
static int clone_plugins(const char *source, const char *target) {
  char canonical[PATH_MAX];
  if (source[0] != '/' || target[0] != '/' || !realpath(source, canonical) || strcmp(canonical, source) ||
      !realpath(target, canonical) || strcmp(canonical, target)) return 77;
  int src = open(source, O_RDONLY | O_DIRECTORY | O_NOFOLLOW), dst = open(target, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat a, b; int result = 77;
  if (src < 0 || dst < 0 || fstat(src, &a) || fstat(dst, &b) || b.st_uid != getuid() || (b.st_mode & 0777) != 0700 ||
      (a.st_dev == b.st_dev && a.st_ino == b.st_ino)) goto finish;
  DIR *entries = fdopendir(dup(dst));
  if (!entries) goto finish;
  struct dirent *entry; int empty = 1;
  while ((entry = readdir(entries))) if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..")) { empty = 0; break; }
  closedir(entries); if (!empty) goto finish;
  unsigned count = 0;
  if (clone_entries(src, dst, 0, &count)) { int error = errno; result = error == EXDEV || error == ENOTSUP || error == ENOSYS ? 78 : error == ENOSPC ? 73 : 1; }
  else { puts("YNX_PLUGIN_CLONE_VERIFIED"); result = 0; }
finish:
  if (src >= 0) close(src); if (dst >= 0) close(dst); return result;
}

// No elevated privileges, executable arguments or signals
// to unrelated processes. The helper's parent is the owning Node backend.
static int info(pid_t pid, struct proc_bsdinfo *out) {
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, out, sizeof(*out)) == sizeof(*out);
}
static int descendant(pid_t pid, pid_t parent) {
  for (int depth = 0; depth < 128 && pid > 1; depth++) {
    struct proc_bsdinfo value;
    if (!info(pid, &value) || value.pbi_uid != getuid()) return 0;
    if ((pid_t)value.pbi_ppid == parent) return depth + 1;
    if ((pid_t)value.pbi_ppid == pid) return 0;
    pid = value.pbi_ppid;
  }
  return 0;
}
struct child_record { pid_t pid; int depth; struct proc_bsdinfo started; };
static int deepest_first(const void *left, const void *right) {
  return ((const struct child_record *)right)->depth - ((const struct child_record *)left)->depth;
}
int main(int argc, char **argv) {
  if (argc == 4 && !strcmp(argv[1], "--clone-plugins")) return clone_plugins(argv[2], argv[3]);
  int children_only = argc == 3 && strcmp(argv[2], "--children") == 0;
  int force = argc == 3 && strcmp(argv[2], "--force") == 0;
  int graceful = argc == 3 && strcmp(argv[2], "--graceful-root") == 0;
  if (graceful) force = 1;
  if (argc != 2 && !children_only && !force) return 64;
  int termination_signal = SIGTERM;
  char *end = NULL; long requested = strtol(argv[1], &end, 10);
  if (!end || *end || requested <= 1 || requested > 2147483647) return 64;
  pid_t root = (pid_t)requested, owner = getppid();
  struct proc_bsdinfo original, owning;
  if (!info(owner, &owning) || owning.pbi_uid != getuid()) return 77;
  if (!info(root, &original)) {
    // libproc does not reliably set ESRCH for an already-reaped process. The
    // separate signal-0 probe confirms absence; a live/inaccessible PID still
    // fails closed and never receives a termination signal.
    if (kill(root, 0) < 0 && errno == ESRCH) return 0;
    fputs("process identity unavailable\n", stderr); return 1;
  }
  if (children_only ? root != owner : root == owner || !descendant(root, owner)) { fputs("foreign process refused\n", stderr); return 77; }
  int count = proc_listallpids(NULL, 0);
  if (count <= 0 || count > 131072) return 1;
  pid_t *pids = calloc(count + 1024, sizeof(pid_t));
  if (!pids) return 1;
  int found = proc_listallpids(pids, (count + 1024) * sizeof(pid_t));
  if (found < 0 || found > count + 1024) { free(pids); return 1; }
  struct child_record *children = calloc(found ? found : 1, sizeof(struct child_record));
  if (!children) { free(pids); return 1; }
  int accepted = 0;
  pid_t group = getpgid(root);
  for (int index = 0; index < found; index++) {
    pid_t pid = pids[index];
    if (pid <= 1 || pid == root || pid == getpid()) continue;
    int depth = descendant(pid, root);
    if (depth && info(pid, &children[accepted].started)) {
      children[accepted].pid = pid; children[accepted].depth = depth; accepted++;
    }
  }
  free(pids);
  qsort(children, accepted, sizeof(struct child_record), deepest_first);
  if (graceful) {
    // Capture the descendants before asking the backend to stop: it can exit
    // and reparent detached workers while its awaited shutdown hooks run.
    struct proc_bsdinfo current;
    if (!info(root, &current) || current.pbi_uid != getuid() ||
        current.pbi_start_tvsec != original.pbi_start_tvsec || current.pbi_start_tvusec != original.pbi_start_tvusec ||
        !descendant(root, owner)) { free(children); return 1; }
    if (kill(root, SIGTERM) < 0 && errno != ESRCH) { free(children); return 1; }
    // Theia grants two five-second shutdown phases. Normal shutdown exits
    // immediately; a hung hook reaches the bounded identity-checked fallback.
    for (int attempt = 0; attempt < 550; attempt++) {
      if (!info(root, &current) || current.pbi_status == SZOMB) break;
      if (current.pbi_uid != getuid() || current.pbi_start_tvsec != original.pbi_start_tvsec ||
          current.pbi_start_tvusec != original.pbi_start_tvusec) { free(children); return 1; }
      usleep(20000);
    }
  }
  for (int index = 0; index < accepted; index++) {
    struct child_record child = children[index]; struct proc_bsdinfo current;
    if (info(child.pid, &current) && child.started.pbi_start_tvsec == current.pbi_start_tvsec &&
        child.started.pbi_start_tvusec == current.pbi_start_tvusec && descendant(child.pid, root)) kill(child.pid, termination_signal);
  }
  if (force) {
    // Retain the original authorized set across TERM: an intermediate parent
    // can exit and reparent its detached worker before the escalation. The
    // root may have completed graceful shutdown; disappearance is allowed,
    // reuse or loss of the still-live owning backend identity is refused.
    usleep(300000);
    struct proc_bsdinfo guard, owning_now;
    int root_present = info(root, &guard);
    // After graceful exit macOS can hide the reaping root from libproc while
    // signal-0 still refuses it. No root signal is sent without a fresh matching
    // identity below; captured descendants remain independently identity-bound.
    if (getppid() != owner || !info(owner, &owning_now) || owning_now.pbi_uid != getuid() ||
        owning_now.pbi_start_tvsec != owning.pbi_start_tvsec || owning_now.pbi_start_tvusec != owning.pbi_start_tvusec ||
        (root_present ? guard.pbi_uid != getuid() || guard.pbi_start_tvsec != original.pbi_start_tvsec ||
          guard.pbi_start_tvusec != original.pbi_start_tvusec || !descendant(root, owner) : !graceful && !(kill(root, 0) < 0 && errno == ESRCH))) {
      fputs("cleanup owner/root identity changed\n", stderr);
      free(children); return 1;
    }
    // The root may have exited in response to its children's TERM. Only this
    // invocation's captured UID/start-time records remain eligible; no new
    // enumeration or historical session PID is accepted after reparenting.
    for (int index = 0; index < accepted; index++) {
      struct child_record child = children[index]; struct proc_bsdinfo now;
      if (info(child.pid, &now) && now.pbi_uid == getuid() && now.pbi_start_tvsec == child.started.pbi_start_tvsec &&
          now.pbi_start_tvusec == child.started.pbi_start_tvusec && now.pbi_status != SZOMB) {
        if (kill(child.pid, SIGKILL) < 0 && errno != ESRCH) { free(children); return 1; }
      }
    }
    for (int attempt = 0; attempt < 100; attempt++) {
      int live = 0;
      for (int index = 0; index < accepted; index++) {
        struct child_record child = children[index]; struct proc_bsdinfo now;
        if (info(child.pid, &now) && now.pbi_uid == getuid() && now.pbi_start_tvsec == child.started.pbi_start_tvsec &&
            now.pbi_start_tvusec == child.started.pbi_start_tvusec && now.pbi_status != SZOMB) live++;
      }
      if (!live) break;
      if (attempt == 99) { free(children); fputs("cleanup child exit unverified\n", stderr); return 1; }
      usleep(20000);
    }
    termination_signal = SIGKILL;
  }
  free(children);
  struct proc_bsdinfo current;
  if (!children_only && info(root, &current) && original.pbi_start_tvsec == current.pbi_start_tvsec &&
      original.pbi_start_tvusec == current.pbi_start_tvusec && descendant(root, owner)) {
    if (group == root) kill(-root, termination_signal);
    kill(root, termination_signal);
  }
  // Root close is independently awaited by the caller. Initial ESRCH above
  // deliberately emits no receipt: it captured no descendant identities.
  if (graceful) puts("YNX_PROCESS_TREE_CLEANUP_VERIFIED");
  return 0;
}
