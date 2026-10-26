package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func normalSnapshotStreamFixture(t *testing.T) (*Devnet, Transaction) {
	t.Helper()
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	funded, err := d.Faucet("normal-snapshot-stream-funded", 1000)
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	// Retain genuine normal history, including empty blocks. No service or
	// externally supplied state is used, and the memory-only builder does no I/O.
	for i := 0; i < 2048; i++ {
		d.ProduceBlock()
	}
	if _, err := d.Faucet("normal-snapshot-stream-pending", 7); err != nil {
		t.Fatal(err)
	}
	return d, funded
}

func normalSnapshotStreamDirectory(t *testing.T) string {
	t.Helper()
	path, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
	return path
}

func normalSnapshotStreamEqualState(t *testing.T, original, restored *Devnet) {
	t.Helper()
	before, after := original.snapshotLocked(), restored.snapshotLocked()
	// The normal constructor republishes a checkpoint with a new SavedAt. The
	// complete typed ledger, history, pending originals and policies must agree.
	before.SavedAt, after.SavedAt = time.Time{}, time.Time{}
	before.StateIntegrity, after.StateIntegrity = "", ""
	if !reflect.DeepEqual(before, after) {
		t.Fatal("normal cold reopen changed the complete original typed snapshot")
	}
}

func TestNormalSnapshotStreamingPersistenceAndColdReopen(t *testing.T) {
	d, funding := normalSnapshotStreamFixture(t)
	d.dataDir = normalSnapshotStreamDirectory(t)
	var expected []byte
	var measurement PQSnapshotMeasurement
	err := d.persistSnapshotWithWriter(func(snapshot devnetSnapshot) error {
		var err error
		expected, err = json.MarshalIndent(snapshot, "", "  ")
		if err != nil {
			return err
		}
		// Bind the full historical integrity preimage to the previous standard
		// encoder, independently of the writer selected by normal persistence.
		unsigned := snapshot
		unsigned.StateIntegrity = ""
		legacy, err := json.Marshal(unsigned)
		if err != nil {
			return err
		}
		digest := sha256.New()
		_, _ = digest.Write([]byte(devnetSnapshotHashDomain + "\x00"))
		_, _ = digest.Write(legacy)
		if snapshot.StateIntegrity != hex.EncodeToString(digest.Sum(nil)) {
			t.Fatal("normal full-history integrity differs from the original JSON hash")
		}
		return d.persistPreparedSnapshotSerializedMeasured(snapshot, &measurement)
	})
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(d.snapshotPath())
	if err != nil || !bytes.Equal(actual, expected) || bytes.HasSuffix(actual, []byte("\n")) {
		t.Fatal("normal persistence changed the original indented JSON bytes", err)
	}
	// This observes real os.File.Write calls in the production path. The old
	// root Encoder/jsonBodyWriter performs one large write and fails this check.
	if len(actual) < 4*(64<<10) || measurement.SnapshotFile.WriteCalls < uint64(len(actual)/(64<<10)) || measurement.SnapshotFile.BytesWritten != uint64(len(actual)) {
		t.Fatalf("normal history was emitted as a whole-root write: bytes=%d calls=%d", len(actual), measurement.SnapshotFile.WriteCalls)
	}
	pqAssertWrittenFile(t, measurement.SnapshotFile, d.snapshotPath())
	pqAssertWrittenFile(t, measurement.MarkerFile, d.snapshotIntegrityMarkerPath())
	var written devnetSnapshot
	if err := json.Unmarshal(actual, &written); err != nil {
		t.Fatal(err)
	}
	if err := validateDevnetSnapshotIntegrity(written); err != nil {
		t.Fatal(err)
	}
	before, beforeProof, found := d.TransactionWithDurability(funding.Hash)
	if !found || beforeProof.Status != "durable" {
		t.Fatal("normal persistent source has no original transaction durability")
	}
	cold, err := NewPersistentDevnet(d.cfg, d.dataDir)
	if err != nil {
		t.Fatal("normal constructor rejected the streamed checkpoint", err)
	}
	normalSnapshotStreamEqualState(t, d, cold)
	after, proof, found := cold.TransactionWithDurability(funding.Hash)
	if !found || proof.Status != "durable" || !reflect.DeepEqual(after, before) || proof.ExecutionHeight != beforeProof.ExecutionHeight || proof.CheckpointHeight != beforeProof.CheckpointHeight || proof.CheckpointHash != beforeProof.CheckpointHash || !reflect.DeepEqual(proof.FeesThroughTransaction, beforeProof.FeesThroughTransaction) {
		t.Fatal("normal cold startup lost original history or transaction durability")
	}
}

func TestNormalSnapshotStreamingLegacyBytesAndInvalidHistory(t *testing.T) {
	d, _ := normalSnapshotStreamFixture(t)
	snapshot, err := sealDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"legacy-bytes", "wrong-integrity", "resealed-wrong-parent"} {
		t.Run(scenario, func(t *testing.T) {
			original := snapshot
			original.Blocks = append([]Block(nil), snapshot.Blocks...)
			if scenario == "wrong-integrity" {
				original.StateIntegrity = "0000000000000000000000000000000000000000000000000000000000000000"
			}
			if scenario == "resealed-wrong-parent" {
				original.Blocks[len(original.Blocks)-1].ParentHash = "wrong-original-parent"
				original, err = sealDevnetSnapshot(original)
				if err != nil {
					t.Fatal(err)
				}
			}
			// Use the old complete encoder to supply original on-disk bytes.
			raw, err := json.MarshalIndent(original, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			directory := normalSnapshotStreamDirectory(t)
			path := filepath.Join(directory, "devnet-state.json")
			marker := filepath.Join(directory, "devnet-state.integrity-version")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(marker, []byte("2\n"), 0600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			cold, err := NewPersistentDevnet(d.cfg, directory)
			if scenario == "legacy-bytes" {
				if err != nil {
					t.Fatal("normal loader rejected original legacy encoder bytes", err)
				}
				normalSnapshotStreamEqualState(t, d, cold)
				return
			}
			if err == nil {
				t.Fatal("normal startup accepted corrupted original history")
			}
			after, statErr := os.Stat(path)
			retained, readErr := os.ReadFile(path)
			markerRaw, markerErr := os.ReadFile(marker)
			if statErr != nil || readErr != nil || markerErr != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || !before.ModTime().Equal(after.ModTime()) || !bytes.Equal(retained, raw) || string(markerRaw) != "2\n" {
				t.Fatal("failed normal startup repaired or removed original input")
			}
		})
	}
}

func TestNormalSnapshotStreamingFailurePreservesOriginal(t *testing.T) {
	d, _ := normalSnapshotStreamFixture(t)
	original, err := sealDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	old, err := json.MarshalIndent(original, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"late-encoding-error", "directory-sync-unknown"} {
		t.Run(scenario, func(t *testing.T) {
			path := filepath.Join(normalSnapshotStreamDirectory(t), "state.json")
			if err := os.WriteFile(path, old, 0600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			candidate := original
			candidate.Blocks = append([]Block(nil), original.Blocks...)
			var measured PQDurableFileMeasurement
			var cause = errors.New("original containing-directory sync failure")
			syncDirectory := syncSnapshotDirectory
			if scenario == "late-encoding-error" {
				candidate.Blocks[len(candidate.Blocks)-1].Time = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
			} else {
				candidate.SavedAt = candidate.SavedAt.Add(time.Second)
				candidate, err = sealDevnetSnapshot(candidate)
				if err != nil {
					t.Fatal(err)
				}
				syncDirectory = func(string) error { return cause }
			}
			err = writeDurableSnapshotJSONMeasured(path, candidate, syncDirectory, &measured)
			retained, readErr := os.ReadFile(path)
			after, statErr := os.Stat(path)
			if err == nil || readErr != nil || statErr != nil || after.Mode().Perm() != 0600 {
				t.Fatal("failed streaming write removed its retained outcome", err)
			}
			if scenario == "late-encoding-error" {
				if !bytes.Equal(retained, old) || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || measured.WriteCalls < 2 || measured.BytesWritten < 64<<10 || measured.Rename.Attempts != 0 {
					t.Fatal("late streaming error replaced the original or never streamed history")
				}
				pqAssertPhase(t, measured.EncodeWrite, 1, 0, 1)
			} else {
				want, encodeErr := json.MarshalIndent(candidate, "", "  ")
				if encodeErr != nil || !errors.Is(err, ErrSnapshotDurabilityUncertain) || !errors.Is(err, cause) || !bytes.Equal(retained, want) {
					t.Fatal("post-rename UNKNOWN lost its cause or complete output")
				}
				pqAssertPhase(t, measured.Rename, 1, 1, 0)
				pqAssertPhase(t, measured.DirectorySync, 1, 0, 1)
			}
			if _, err := os.Stat(path + ".tmp"); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("completed writer changed its existing temporary-file cleanup contract", err)
			}
		})
	}
}
