//go:build darwin || linux

package ownednode

import (
	"errors"
	"math"
	"os"
	"strconv"
	"syscall"

	"golang.org/x/sys/unix"
)

func platformSupported() bool { return true }

func openManagerRoot(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), path), nil
}

func openManagerLock(root *os.File, create bool) (*os.File, error) {
	flags := unix.O_RDWR | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_CLOEXEC
	if create {
		flags |= unix.O_CREAT | unix.O_EXCL
	}
	fd, err := unix.Openat(int(root.Fd()), lockName, flags, 0600)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), lockName), nil
}

func validManagerLock(info os.FileInfo, uid uint32) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uid && stat.Nlink == 1 && info.Mode() == 0600
}

func sameManagerLockSnapshot(a, b os.FileInfo) bool {
	first, firstOK := a.Sys().(*syscall.Stat_t)
	second, secondOK := b.Sys().(*syscall.Stat_t)
	return firstOK && secondOK && os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() &&
		a.ModTime().Equal(b.ModTime()) && managerLockCtime(first) == managerLockCtime(second)
}

func openRegularRead(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err == nil && info.Mode().IsRegular() {
		return file, nil
	}
	_ = file.Close()
	if err != nil {
		return nil, err
	}
	return nil, ErrUnsafePath
}

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
func lockFile(file *os.File) error { return unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
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
