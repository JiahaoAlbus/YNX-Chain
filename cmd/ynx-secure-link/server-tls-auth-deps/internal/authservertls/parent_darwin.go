//go:build darwin

package authservertls

import (
	"os"
	"syscall"
)

func openParent(p string) (*os.File, error) {
	fd, e := syscall.Open(p, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	return os.NewFile(uintptr(fd), p), nil
}
func sameChangeTime(a, b os.FileInfo) bool {
	return a.Sys().(*syscall.Stat_t).Ctimespec == b.Sys().(*syscall.Stat_t).Ctimespec
}
