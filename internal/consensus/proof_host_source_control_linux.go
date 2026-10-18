//go:build linux

package consensus

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func publishProofHostLiveControl(path string, raw []byte) (err error) {
	parent := filepath.Dir(path)
	name := filepath.Base(path)
	dfd, err := unix.Open(parent, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, unix.Close(dfd)) }()
	var dir unix.Stat_t
	if unix.Fstat(dfd, &dir) != nil || dir.Mode&unix.S_IFMT != unix.S_IFDIR || dir.Mode&07777 != 0700 || dir.Uid != uint32(os.Geteuid()) {
		return errors.New("private live control parent required")
	}
	fd, err := unix.Openat(dfd, name+".partial", unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "live-source-control-partial")
	n, e := f.Write(raw)
	if e == nil && n != len(raw) {
		e = errors.New("short live request write")
	}
	err = errors.Join(e, f.Sync(), f.Close())
	if err != nil {
		return err
	}
	// NOREPLACE preserves any prior request and keeps partial UNKNOWN bytes on
	// failure. No unlink/retry or replacement of an old session is permitted.
	if err = unix.Renameat2(dfd, name+".partial", dfd, name, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	if err = unix.Fsync(dfd); err != nil {
		return err
	}
	var final unix.Stat_t
	if unix.Lstat(parent, &final) != nil || final.Dev != dir.Dev || final.Ino != dir.Ino {
		return errors.New("live request parent replaced; publication UNKNOWN")
	}
	return nil
}
