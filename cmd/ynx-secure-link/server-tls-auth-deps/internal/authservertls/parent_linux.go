//go:build linux

package authservertls

import (
	"os"
	"syscall"
)

func openParent(p string) (*os.File, error) {
	const oPath = 0x200000
	fd, e := syscall.Open(p, oPath|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	return os.NewFile(uintptr(fd), p), nil
}
func sameChangeTime(a, b os.FileInfo) bool {
	return a.Sys().(*syscall.Stat_t).Ctim == b.Sys().(*syscall.Stat_t).Ctim
}
