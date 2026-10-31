//go:build unix

// Package localstore provides a process-owned kernel lock for Network's private
// local projections. It neither modifies shared locks nor adopts legacy owners.
package localstore

import (
	"errors"
	"io"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

const marker = "YNX-NETWORK-LOCAL-LOCK/v1\n"

type Lock struct {
	file *os.File
	path string
	info os.FileInfo
}

func Acquire(path string) (*Lock, error) {
	flags := unix.O_RDWR | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
	fd, err := unix.Open(path, flags|unix.O_CREAT|unix.O_EXCL, 0600)
	created := err == nil
	if errors.Is(err, syscall.EEXIST) {
		fd, err = unix.Open(path, flags, 0)
	}
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "network-local-owner")
	ok := false
	defer func() {
		if !ok {
			f.Close()
		}
	}()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		return nil, errors.New("owned private regular lock required")
	}
	stat, valid := info.Sys().(*syscall.Stat_t)
	if !valid || stat.Uid != uint32(os.Geteuid()) {
		return nil, errors.New("foreign lock owner")
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return nil, errors.New("Network local journal already has a live writer")
	}
	if created {
		if _, err := f.WriteString(marker); err != nil {
			return nil, err
		}
		if err := f.Sync(); err != nil {
			return nil, err
		}
	} else {
		raw, err := io.ReadAll(io.LimitReader(f, 128))
		if err != nil || string(raw) != marker {
			return nil, errors.New("unknown lock preserved for reconciliation")
		}
	}
	info, err = f.Stat()
	if err != nil {
		return nil, err
	}
	lock := &Lock{file: f, path: path, info: info}
	if err := lock.Check(); err != nil {
		return nil, err
	}
	ok = true
	return lock, nil
}
func (l *Lock) Check() error {
	if l == nil || l.file == nil {
		return errors.New("local owner closed")
	}
	now, err := os.Lstat(l.path)
	if err != nil || !os.SameFile(now, l.info) || now.Mode().Perm() != 0600 {
		return errors.New("local ownership changed; preserve unknown owner")
	}
	return nil
}

// The persistent marker is never deleted. Only this open handle's kernel lock
// is released; a process crash releases it automatically without deleting data.
func (l *Lock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	err := l.Check()
	closeErr := l.file.Close()
	l.file = nil
	if err != nil {
		return err
	}
	return closeErr
}
