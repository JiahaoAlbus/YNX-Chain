//go:build !darwin && !linux

package consensus

import (
	"errors"
	"os"
)

func lockSnapshotJournal(*os.File) error {
	return errors.New("snapshot journal requires a supported local advisory lock")
}
func unlockSnapshotJournal(*os.File) {}
func lockSnapshotJournalReader(*os.File) error {
	return errors.New("snapshot journal read lock unsupported on this platform")
}

func lockSnapshotJournalReadersForWrite(*os.File) error {
	return errors.New("snapshot journal writer/read coordination unsupported on this platform")
}
