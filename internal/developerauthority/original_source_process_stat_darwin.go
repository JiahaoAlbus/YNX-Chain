//go:build darwin

package developerauthority

import "syscall"

func verifierStableStat(a, b *syscall.Stat_t) bool {
	return a != nil && b != nil && a.Dev == b.Dev && a.Ino == b.Ino && a.Uid == b.Uid && a.Gid == b.Gid && a.Mode == b.Mode && a.Nlink == b.Nlink && a.Size == b.Size && a.Mtimespec == b.Mtimespec && a.Ctimespec == b.Ctimespec
}
