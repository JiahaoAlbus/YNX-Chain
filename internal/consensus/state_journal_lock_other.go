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
