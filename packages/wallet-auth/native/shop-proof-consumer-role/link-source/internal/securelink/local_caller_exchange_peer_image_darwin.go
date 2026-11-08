//go:build darwin

package securelink

import "golang.org/x/sys/unix"

func originalLocalCallerSameImage(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Size == b.Size && a.Mode&unix.S_IFMT == unix.S_IFREG && b.Mode&unix.S_IFMT == unix.S_IFREG && a.Mtim == b.Mtim && a.Ctim == b.Ctim
}
