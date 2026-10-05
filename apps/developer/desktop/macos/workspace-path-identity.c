#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

/* Read-only vnode evidence. No process spawning, permissions or file changes. */
int main(int argc, char **argv) {
  char canonical[PATH_MAX], kernel[PATH_MAX];
  struct stat before, opened, after, alias;
  if (argc != 2 || !realpath(argv[1], canonical) || strcmp(canonical, argv[1])) return 64;
  if (lstat(canonical, &before) || S_ISLNK(before.st_mode)) return 65;
  int fd = open(canonical, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return 66;
  int failure = fstat(fd, &opened) || fcntl(fd, F_GETPATH, kernel) || lstat(canonical, &after) || lstat(kernel, &alias);
  if (failure || before.st_dev != opened.st_dev || before.st_ino != opened.st_ino || after.st_dev != opened.st_dev || after.st_ino != opened.st_ino || alias.st_dev != opened.st_dev || alias.st_ino != opened.st_ino || alias.st_uid != opened.st_uid || alias.st_mode != opened.st_mode || (!S_ISDIR(opened.st_mode) && !S_ISREG(opened.st_mode))) { close(fd); return 67; }
  /* Hex avoids JSON/string injection from an OS filename. */
  printf("{\"dev\":\"%lld\",\"ino\":\"%llu\",\"uid\":%u,\"mode\":%u,\"kernelPathHex\":\"", (long long)opened.st_dev, (unsigned long long)opened.st_ino, opened.st_uid, opened.st_mode);
  for (const unsigned char *p = (const unsigned char *)kernel; *p; ++p) printf("%02x", *p);
  puts("\"}"); close(fd); return 0;
}
