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

// No elevated privileges, executable arguments, filesystem access or signals
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
  return 0;
}
