//go:build darwin || linux

package consensus

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"time"
)

func lockSnapshotJournal(f *os.File) error { return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
func unlockSnapshotJournal(f *os.File)     { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN) }
func lockSnapshotJournalReader(f *os.File) error {
	return unix.Flock(int(f.Fd()), unix.LOCK_SH|unix.LOCK_NB)
}

func lockSnapshotJournalReadersForWrite(f *os.File) error {
	deadline := time.Now().Add(2 * time.Second)
	for {
		err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			return nil
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EAGAIN) {
			return err
		}
		if !time.Now().Before(deadline) {
			return errors.New("journal reader did not release within bounded writer wait")
		}
		time.Sleep(time.Millisecond)
	}
}
