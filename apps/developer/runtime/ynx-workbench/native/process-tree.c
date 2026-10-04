#include <libproc.h>
#include <sys/proc_info.h>
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
  if (argc != 2 && !children_only) return 64;
  char *end = NULL; long requested = strtol(argv[1], &end, 10);
  if (!end || *end || requested <= 1 || requested > 2147483647) return 64;
  pid_t root = (pid_t)requested, owner = getppid();
  struct proc_bsdinfo original;
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
  for (int index = 0; index < accepted; index++) {
    struct child_record child = children[index]; struct proc_bsdinfo current;
    if (info(child.pid, &current) && child.started.pbi_start_tvsec == current.pbi_start_tvsec &&
        child.started.pbi_start_tvusec == current.pbi_start_tvusec && descendant(child.pid, root)) kill(child.pid, SIGTERM);
  }
  free(children);
  struct proc_bsdinfo current;
  if (!children_only && info(root, &current) && original.pbi_start_tvsec == current.pbi_start_tvsec &&
      original.pbi_start_tvusec == current.pbi_start_tvusec && descendant(root, owner)) {
    if (group == root) kill(-root, SIGTERM);
    kill(root, SIGTERM);
  }
  return 0;
}
