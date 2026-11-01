//go:build linux || darwin

package taskactionv6

import (
	"os"
	"syscall"
)

func openPinned(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
}
