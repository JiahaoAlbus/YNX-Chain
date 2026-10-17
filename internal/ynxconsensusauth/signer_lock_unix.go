//go:build unix

package ynxconsensusauth

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// Opening the final component without following links prevents another path
// from reading a live history under a distinct lock and replacing that alias
// with its own state. Nonblocking open avoids hanging on a non-regular file.
func openSignerState(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("consensus signer state must be a regular file")
	}
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil || st.Nlink != 1 {
		f.Close()
		return nil, errors.New("consensus signer state must have one filesystem link")
	}
	return f, nil
}

func acquireSignerLock(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDWR|unix.O_CREAT|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
