//go:build unix

package contribution

import (
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func processCurrentOwner(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Geteuid())
}

func processUnlinkCapture(directory *os.File, name string) error {
	return unix.Unlinkat(int(directory.Fd()), name, 0)
}
