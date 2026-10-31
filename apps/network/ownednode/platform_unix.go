//go:build darwin || linux

package ownednode

import (
	"errors"
	"golang.org/x/sys/unix"
	"math"
	"os"
	"syscall"
)

func platformSupported() bool { return true }
func ownerUID(info os.FileInfo) (uint32, error) {
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, ErrUnsupported
	}
	return s.Uid, nil
}
func lockFile(file *os.File) error   { return unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
func unlockFile(file *os.File) error { return unix.Flock(int(file.Fd()), unix.LOCK_UN) }
func freeBytes(path string) (uint64, error) {
	var s unix.Statfs_t
	if err := unix.Statfs(path, &s); err != nil {
		return 0, err
	}
	if s.Bsize <= 0 || uint64(s.Bavail) > math.MaxUint64/uint64(s.Bsize) {
		return 0, errors.New("invalid filesystem capacity")
	}
	return uint64(s.Bavail) * uint64(s.Bsize), nil
}
