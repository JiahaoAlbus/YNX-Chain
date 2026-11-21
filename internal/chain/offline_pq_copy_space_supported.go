//go:build darwin || linux

package chain

import (
	"errors"

	"golang.org/x/sys/unix"
)

// A point-in-time admission check only; other writers can still consume space.
func checkOfflinePQCopySpace(path string, needed uint64) error {
	var fs unix.Statfs_t
	if err := unix.Statfs(path, &fs); err != nil {
		return err
	}
	if fs.Bsize <= 0 || !offlinePQSpaceEnough(uint64(fs.Bavail), uint64(fs.Bsize), needed) {
		return errors.New("insufficient available space for offline PQ copy")
	}
	return nil
}
