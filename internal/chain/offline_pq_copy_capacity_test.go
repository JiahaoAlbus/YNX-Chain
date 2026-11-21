package chain

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
)

func offlinePQCapacityFixture(t *testing.T) (string, string, OfflinePQCopyPins) {
	t.Helper()
	source, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Faucet("ynx_capacity_owner", 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	before, err := ExportConsensusMigrationCheckpoint(source)
	if err != nil {
		t.Fatal(err)
	}
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	return source, filepath.Join(parent, "copy"), OfflinePQCopyPins{OriginalGenesisHash: before.OriginalGenesisHash, SourceStateHash: before.StateHash, SourceHeight: before.Height, AdmissionHeight: before.Height + 10}
}

func TestOfflinePQCopyCapacityCountsRealSnapshotWrites(t *testing.T) {
	source, target, pins := offlinePQCapacityFixture(t)
	before, err := ExportConsensusMigrationCheckpoint(source)
	if err != nil {
		t.Fatal(err)
	}
	d, err := before.RestoreSourceRuntime()
	if err != nil {
		t.Fatal(err)
	}
	a, b, c, err := offlinePQCopyPlannedSizes(d, pins.AdmissionHeight)
	if err != nil {
		t.Fatal(err)
	}
	// Compare all three plans with actual files written by the normal path.
	actualDir := t.TempDir()
	actual, err := before.RestoreSourceRuntime()
	if err != nil {
		t.Fatal(err)
	}
	actual.dataDir = actualDir
	assertWrittenWithin := func(bound uint64) {
		t.Helper()
		info, err := os.Stat(filepath.Join(actualDir, "devnet-state.json"))
		if err != nil || info.Size() <= 0 || uint64(info.Size()) > bound {
			t.Fatal("actual write exceeded its planned bound", info, bound, err)
		}
	}
	if err := actual.persistSnapshot(); err != nil {
		t.Fatal(err)
	}
	assertWrittenWithin(a)
	if err := actual.EnableAccountPQ(pins.AdmissionHeight); err != nil {
		t.Fatal(err)
	}
	assertWrittenWithin(b)
	if _, err := NewPersistentDevnet(before.Network, actualDir); err != nil {
		t.Fatal(err)
	}
	assertWrittenWithin(c)
	needed, err := offlinePQCopyRequiredBytes(a, b, c)
	if err != nil || needed < max(a+b, b+c)+offlinePQCopyFreeFloor {
		t.Fatal("incorrect planned peak", needed, err)
	}
	var checked []uint64
	result, err := prepareOfflinePQScheduledCopy(source, target, pins, nil, func(path string, required uint64) error {
		if len(checked) == 0 && path != filepath.Dir(target) || len(checked) == 1 && path != target || len(checked) > 1 {
			t.Fatal("checked wrong volume", path)
		}
		checked = append(checked, required)
		return nil // Virtual space source; no claim about host free space.
	})
	if err != nil || len(checked) != 2 || checked[0] != needed || checked[1] < c || result.SourceStopProven || result.ActivationAuthorized {
		t.Fatal("planned copy failed", checked, result, err)
	}
	info, err := os.Stat(filepath.Join(target, "devnet-state.json"))
	if err != nil || uint64(info.Size()) > c {
		t.Fatal("cold write exceeded its planned bound", info, c, err)
	}
	err = checkOfflinePQCopySpace(filepath.Dir(target), 1)
	if runtime.GOOS == "linux" || runtime.GOOS == "darwin" {
		if err != nil {
			t.Fatal("real filesystem capacity probe failed", err)
		}
	} else if err == nil {
		t.Fatal("unsupported platform granted capacity admission")
	}
}

func TestOfflinePQCopyCapacityAndConcurrentENOSPCFailClosed(t *testing.T) {
	for _, stage := range []string{"preflight", "post-persistence", "cold-preflight"} {
		t.Run(stage, func(t *testing.T) {
			source, target, pins := offlinePQCapacityFixture(t)
			original := captureOfflineConsensusSource(t, source)
			var hook func() error
			space := func(string, uint64) error { return nil }
			if stage == "preflight" {
				space = func(string, uint64) error { return syscall.ENOSPC }
			} else if stage == "post-persistence" {
				hook = func() error { return syscall.ENOSPC }
			} else {
				calls := 0
				space = func(string, uint64) error {
					calls++
					if calls == 2 {
						return syscall.ENOSPC
					}
					return nil
				}
			}
			result, err := prepareOfflinePQScheduledCopy(source, target, pins, hook, space)
			if !errors.Is(err, syscall.ENOSPC) || result != (OfflinePQCopyResult{}) {
				t.Fatal("lost ENOSPC or reported success", result, err)
			}
			_, statErr := os.Lstat(target)
			if stage == "preflight" && (!errors.Is(statErr, os.ErrNotExist) || errors.Is(err, ErrOfflinePQCopyUnknown)) {
				t.Fatal("preflight created target or claimed UNKNOWN", statErr, err)
			}
			if stage != "preflight" && (statErr != nil || !errors.Is(err, ErrOfflinePQCopyUnknown)) {
				t.Fatal("in-flight ENOSPC failed to retain UNKNOWN target", statErr, err)
			}
			original.assertUnchanged(t)
		})
	}
}

func TestOfflinePQCopyCapacityArithmeticBoundaries(t *testing.T) {
	for _, x := range []struct {
		blocks, size, need uint64
		ok                 bool
	}{{0, 0, 0, false}, {0, 1, 0, true}, {1, 4096, 4096, true}, {1, 4096, 4097, false}, {math.MaxUint64, math.MaxUint64, math.MaxUint64, true}} {
		if offlinePQSpaceEnough(x.blocks, x.size, x.need) != x.ok {
			t.Fatal("block arithmetic mismatch", x)
		}
	}
	for _, x := range [][3]uint64{{0, 1, 1}, {math.MaxUint64, 1, 1}, {1, math.MaxUint64, 1}, {1, 1, math.MaxUint64}} {
		if _, err := offlinePQCopyRequiredBytes(x[0], x[1], x[2]); err == nil {
			t.Fatal("overflowing or empty budget accepted", x)
		}
	}
	for _, n := range []uint64{0, math.MaxUint64} {
		if _, err := offlinePQColdRequiredBytes(n); err == nil {
			t.Fatal("invalid cold budget accepted", n)
		}
	}
}

func TestOfflinePQCopyCapacityExistingTargetPrecedesSpaceCheck(t *testing.T) {
	source, target, pins := offlinePQCapacityFixture(t)
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	called := false
	_, err := prepareOfflinePQScheduledCopy(source, target, pins, nil, func(string, uint64) error {
		called = true
		return syscall.ENOSPC
	})
	if !errors.Is(err, os.ErrExist) || errors.Is(err, ErrOfflinePQCopyUnknown) || called {
		t.Fatal("existing target did not remain untouched", called, err)
	}
}

func TestOfflinePQCopyCapacityRefusesPersistentOwner(t *testing.T) {
	root := t.TempDir()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), root)
	if err != nil {
		t.Fatal(err)
	}
	before := captureOfflineConsensusSource(t, root)
	if _, _, _, err := offlinePQCopyPlannedSizes(d, 100); err == nil {
		t.Fatal("measurement accepted an owner with a persistent data directory")
	}
	if d.accountPolicy != nil {
		t.Fatal("refused measurement enabled persistent policy")
	}
	before.assertUnchanged(t)
	if _, _, _, err := offlinePQCopyPlannedSizes(nil, 100); err == nil {
		t.Fatal("measurement accepted a nil owner")
	}
}
