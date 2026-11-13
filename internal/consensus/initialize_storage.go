package consensus

import (
	"errors"
	"fmt"
)

type initializationStorage struct {
	blockSize, availableBlocks uint64
	availableInodes            uint64
	reportsInodes              bool
}

func initializationStateBytes(layout, migrationHash string, compactBytes, atomicBytes int) (uint64, error) {
	switch layout {
	case "atomic-json":
		return uint64(atomicBytes), nil
	case "snapshot-journal":
		return uint64(len(snapshotJournalMagic) + len(migrationHash) + 1), nil
	case "block-journal":
		// encodeBlockCheckpoint wraps the compact committed state in a record
		// with only kind and snapshot set. Account for the wrapper without
		// encoding another full copy of the same state just to measure it.
		const checkpointWrapper = `{"kind":"checkpoint","snapshot":}`
		payload := uint64(compactBytes) + uint64(len(checkpointWrapper))
		if payload > blockJournalMaxFrame {
			return 0, errors.New("initial checkpoint exceeds block journal frame bound")
		}
		return payload + uint64(len(blockJournalMagic)+len(migrationHash)+1+snapshotJournalHeader), nil
	default:
		return 0, errors.New("unknown initialization storage layout")
	}
}

func (s initializationStorage) check(stateBytes, markerBytes uint64, layout string) error {
	if s.blockSize == 0 {
		return errors.New("invalid application initialization filesystem allocation unit")
	}
	blocks := func(bytes uint64) uint64 {
		if bytes == 0 {
			return 0
		}
		return 1 + (bytes-1)/s.blockSize
	}
	// The destination directory and writer lock each get one allocation unit.
	// The journal layouts also create their own writer and reader lock files.
	entries := uint64(4) // directory, state, attempt marker, application writer lock
	if layout != "atomic-json" {
		entries += 2
	}
	required := blocks(stateBytes) + blocks(markerBytes) + entries - 2
	if s.availableBlocks < required || s.reportsInodes && s.availableInodes < entries {
		return fmt.Errorf("insufficient application initialization storage: layout=%s state_bytes=%d allocation_unit=%d blocks_available=%d blocks_required=%d inodes_available=%d inodes_required=%d", layout, stateBytes, s.blockSize, s.availableBlocks, required, s.availableInodes, entries)
	}
	return nil
}
