//go:build darwin || linux

package consensus

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockSnapshotJournal(f *os.File) error { return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
func unlockSnapshotJournal(f *os.File)     { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN) }
