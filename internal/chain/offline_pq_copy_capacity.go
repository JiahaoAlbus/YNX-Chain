package chain

import (
	"errors"
	"math"
	"os"
	"time"
)

const (
	offlinePQCopyFreeFloor         = uint64(1 << 30)
	offlinePQCopyRootReserve       = uint64(425 << 20)
	offlinePQCopyMetadataAllowance = uint64(1 << 20)
)

type offlinePQCountingWriter struct{ count uint64 }

func (w *offlinePQCountingWriter) Write(p []byte) (int, error) {
	if uint64(len(p)) > math.MaxUint64-w.count {
		return 0, errors.New("offline PQ copy serialized size overflows")
	}
	w.count += uint64(len(p))
	return len(p), nil
}

// The exact durable writer uses this same incremental serializer. The fixed
// longest UTC timestamp covers SavedAt variation across the later writes.
// Individual serializer leaves can still allocate; this does not bound RSS.
func offlinePQSnapshotBytes(snapshot devnetSnapshot) (uint64, error) {
	snapshot.SavedAt = time.Date(2000, 1, 1, 0, 0, 0, 999999999, time.UTC)
	snapshot, err := sealDevnetSnapshot(snapshot)
	if err != nil {
		return 0, err
	}
	w := &offlinePQCountingWriter{}
	if err := writeCanonicalStateJSON(w, snapshot, true); err != nil {
		return 0, err
	}
	return w.count, nil
}

// This owner is detached, has no dataDir and has no goroutines. Scheduling it
// for measurement is memory-only; the separately restored owner is later used
// for the original durable EnableAccountPQ operation.
func offlinePQCopyPlannedSizes(d *Devnet, height uint64) (uint64, uint64, uint64, error) {
	if d == nil || d.dataDir != "" {
		return 0, 0, 0, errors.New("offline PQ copy measurement requires a detached memory-only owner")
	}
	d.mu.RLock()
	initial, err := d.detachedSnapshotLocked()
	d.mu.RUnlock()
	if err != nil {
		return 0, 0, 0, err
	}
	a, err := offlinePQSnapshotBytes(initial)
	if err != nil {
		return 0, 0, 0, err
	}
	if err := d.EnableAccountPQ(height); err != nil {
		return 0, 0, 0, err
	}
	d.mu.RLock()
	scheduled := d.snapshotLocked()
	d.mu.RUnlock()
	b, err := offlinePQSnapshotBytes(scheduled)
	if err != nil {
		return 0, 0, 0, err
	}
	// Match the normal constructor's decode/apply/default/detach path before
	// its rewrite. No source bytes are edited or signed by this simulation.
	reloaded, err := detachDevnetSnapshot(scheduled)
	if err != nil {
		return 0, 0, 0, err
	}
	cold := NewDevnet(d.cfg)
	cold.applySnapshotLocked(reloaded)
	cold.mu.RLock()
	last, err := cold.detachedSnapshotLocked()
	cold.mu.RUnlock()
	if err != nil {
		return 0, 0, 0, err
	}
	c, err := offlinePQSnapshotBytes(last)
	return a, b, c, err
}

func offlinePQCopyRequiredBytes(a, b, c uint64) (uint64, error) {
	if a == 0 || b == 0 || c == 0 || a > math.MaxUint64-b || b > math.MaxUint64-c {
		return 0, errors.New("invalid or overflowing offline PQ copy size")
	}
	peak := max(a+b, b+c)
	margin := offlinePQCopyFreeFloor + offlinePQCopyRootReserve + offlinePQCopyMetadataAllowance
	if peak > math.MaxUint64-margin {
		return 0, errors.New("offline PQ copy budget overflows")
	}
	return peak + margin, nil
}

// Read the actual scheduled snapshot through the cold constructor's loader
// before sizing the rewrite; the earlier in-memory simulation is not proof
// that a future snapshot schema will decode identically.
func offlinePQColdRewriteBytes(cfg NetworkConfig, target string) (uint64, error) {
	cold := NewDevnet(cfg)
	cold.dataDir = target
	info, err := os.Stat(cold.snapshotPath())
	if err != nil || !info.Mode().IsRegular() {
		return 0, errors.Join(errors.New("scheduled snapshot unavailable for cold sizing"), err)
	}
	if err := cold.loadSnapshot(); err != nil {
		return 0, err
	}
	cold.mu.RLock()
	snapshot, err := cold.detachedSnapshotLocked()
	cold.mu.RUnlock()
	if err != nil {
		return 0, err
	}
	return offlinePQSnapshotBytes(snapshot)
}

func offlinePQColdRequiredBytes(c uint64) (uint64, error) {
	margin := offlinePQCopyFreeFloor + offlinePQCopyRootReserve + offlinePQCopyMetadataAllowance
	if c == 0 || c > math.MaxUint64-margin {
		return 0, errors.New("invalid or overflowing cold rewrite budget")
	}
	return c + margin, nil
}

func offlinePQSpaceEnough(blocks, blockSize, needed uint64) bool {
	return blockSize > 0 && (needed/blockSize < blocks || needed/blockSize == blocks && needed%blockSize == 0)
}
