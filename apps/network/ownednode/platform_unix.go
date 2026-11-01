//go:build darwin || linux

package ownednode

import (
	"errors"
	"golang.org/x/sys/unix"
	"math"
	"os"
	"strconv"
	"syscall"
)

func platformSupported() bool { return true }
func identity(info os.FileInfo) FileIdentity {
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return FileIdentity{}
	}
	i := FileIdentity{Device: strconv.FormatUint(uint64(s.Dev), 10), Inode: strconv.FormatUint(uint64(s.Ino), 10), OwnerUID: strconv.FormatUint(uint64(s.Uid), 10), Mode: strconv.FormatUint(uint64(info.Mode()), 10)}
	if info.Mode().IsRegular() {
		i.Bytes = strconv.FormatInt(info.Size(), 10)
	}
	return i
}
func publishArtifact(dir *os.File, from, to string) error {
	return unix.Linkat(int(dir.Fd()), from, int(dir.Fd()), to, 0)
}
func unlinkManagedFile(dir *os.File, name string) error { return unix.Unlinkat(int(dir.Fd()), name, 0) }
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
