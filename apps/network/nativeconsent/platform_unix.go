//go:build darwin || linux

package nativeconsent

import (
	"golang.org/x/sys/unix"
	"os"
	"syscall"
)

func owned(info os.FileInfo) bool {
	s, ok := info.Sys().(*syscall.Stat_t)
	return ok && s.Uid == uint32(os.Geteuid())
}
func unlink(directory *os.File) error     { return unix.Unlinkat(int(directory.Fd()), executableName, 0) }
func unlinkInfo(directory *os.File) error { return unix.Unlinkat(int(directory.Fd()), "Info.plist", 0) }
