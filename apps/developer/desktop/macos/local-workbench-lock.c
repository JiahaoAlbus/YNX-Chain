#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <limits.h>
#include <errno.h>

// OS lifetime lock for one local profile. It is never an identity/grant and
// contains no PID lease. The inherited descriptor survives exec and the kernel
// releases it when the backend exits, including crash and forced termination.
int main(int argc, char **argv) {
  if (argc < 3) return 64;
  char canonical[PATH_MAX]; struct stat state;
  if (!realpath(argv[1], canonical) || strcmp(canonical, argv[1])) return 65;
  int directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (directory < 0 || fstat(directory, &state) || !S_ISDIR(state.st_mode) || state.st_uid != getuid() || (state.st_mode & 077)) return 65;
  int lease = openat(directory, "local-workbench.lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
  close(directory);
  if (lease < 0 || fstat(lease, &state) || !S_ISREG(state.st_mode) || state.st_uid != getuid() || (state.st_mode & 077) || state.st_nlink != 1) return 65;
  if (flock(lease, LOCK_EX | LOCK_NB)) {
    if (errno == EWOULDBLOCK || errno == EAGAIN) { fputs("This local project is already open in another YNX Developer window.\n", stderr); return 73; }
    return 74;
  }
  if (fcntl(lease, F_SETFD, 0) < 0 || !realpath(argv[2], canonical) || strcmp(canonical, argv[2]) || stat(argv[2], &state) || !S_ISREG(state.st_mode) || access(argv[2], X_OK)) return 65;
  execv(argv[2], &argv[2]);
  perror("Local workbench executable failed"); return 71;
}
