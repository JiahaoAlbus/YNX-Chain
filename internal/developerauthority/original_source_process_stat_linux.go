//go:build linux

package developerauthority

import "syscall"

// atime is intentionally excluded: ordinary reads can change it. The identity,
// protection, content-change and metadata-change times must all stay original.
func verifierStableStat(a, b *syscall.Stat_t) bool {
	return a != nil && b != nil && a.Dev == b.Dev && a.Ino == b.Ino && a.Uid == b.Uid && a.Gid == b.Gid && a.Mode == b.Mode && a.Nlink == b.Nlink && a.Size == b.Size && a.Mtim == b.Mtim && a.Ctim == b.Ctim
}
