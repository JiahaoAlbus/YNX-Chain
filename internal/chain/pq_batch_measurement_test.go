package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func pqAssertPhase(t *testing.T, p PQPhaseMeasurement, attempts, completed, failures uint64) {
	t.Helper()
	if p.Attempts != attempts || p.Completed != completed || p.Errors != failures || p.Attempts != p.Completed+p.Errors || p.DurationNs < 0 || (p.Attempts == 0 && p.DurationNs != 0) {
		t.Fatalf("phase does not describe actual completed/failed calls: %+v; want %d/%d/%d", p, attempts, completed, failures)
	}
}

func pqAssertWrittenFile(t *testing.T, m PQDurableFileMeasurement, path string) {
	t.Helper()
	for _, p := range []PQPhaseMeasurement{m.Total, m.OpenTemp, m.EncodeWrite, m.FileSync, m.Close, m.Rename, m.DirectorySync} {
		pqAssertPhase(t, p, 1, 1, 0)
	}
	raw, err := os.ReadFile(path)
	pqMust(t, err)
	if m.WriteCalls == 0 || m.BytesWritten != uint64(len(raw)) {
		t.Fatalf("write counters differ from actual file bytes: %+v / %d", m, len(raw))
	}
}

func TestPQBatchMeasurementDurablePartialAndReplay(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	ownerBefore, _ := f.d.Account(f.owner)
	wire := f.whole(t, f.batchTransfer(2, 3), f.batchTransfer(2, 3), f.batchTransfer(3, 2000), f.batchTransfer(3, 4))
	out, m, err := f.d.SubmitPQBatchMeasured(wire)
	pqMust(t, err)
	if out.Status != "durable" || out.Replayed || m.Version != PQBatchMeasurementVersion || m.WireHash != pqBatchHash(wire) || m.WireHash != out.BatchHash || m.ExecutionHeight != out.ExecutionHeight || !reflect.DeepEqual(m.Result, out) || m.VerifierSignatureChecks != 2 || m.MemberAdmitted != 2 || m.MemberRejected != 2 {
		t.Fatalf("measurement is not bound to actual partial batch outcome: %+v", m)
	}
	for _, p := range []PQPhaseMeasurement{m.Total, m.InputCloneHash, m.LockWait, m.PolicyValidation, m.WireDecode, m.WholeAuthentication, m.Persistence.Total, m.Persistence.SnapshotBuild, m.Persistence.IntegritySeal, m.Persistence.CheckpointBuild, m.Persistence.PersistenceLockWait, m.Persistence.Mkdir} {
		pqAssertPhase(t, p, 1, 1, 0)
	}
	pqAssertPhase(t, m.MemberExecution, 4, 2, 2)
	pqAssertPhase(t, m.Replay, 0, 0, 0)
	pqAssertWrittenFile(t, m.Persistence.SnapshotFile, f.d.snapshotPath())
	pqAssertWrittenFile(t, m.Persistence.MarkerFile, f.d.snapshotIntegrityMarkerPath())
	cp := f.d.durableCheckpoint.Load()
	published := m.Persistence.Published
	if cp == nil || published == nil || published.Version != TransactionDurabilityVersion || published.Height != cp.height || published.Hash != cp.hash || published.SnapshotIntegrity != cp.integrity || m.Persistence.CandidateIntegrity != cp.integrity {
		t.Fatal("published measurement does not match actual final local checkpoint")
	}
	owner, _ := f.d.Account(f.owner)
	if owner.Balance != ownerBefore.Balance-9 || owner.Nonce != ownerBefore.Nonce+2 {
		t.Fatal("measurement altered partial execution fees or nonces")
	}
	before := moduleBusinessState(t, f.d)
	replay, retry, err := f.d.SubmitPQBatchMeasured(wire)
	pqMust(t, err)
	if !replay.Replayed || replay.Status != "durable" || !reflect.DeepEqual(replay.Results, out.Results) || !reflect.DeepEqual(retry.Result, replay) || retry.WireHash != m.WireHash || retry.ExecutionHeight != m.ExecutionHeight || retry.VerifierSignatureChecks != 0 || retry.MemberAdmitted != 0 || retry.MemberRejected != 0 || retry.Persistence != (PQSnapshotMeasurement{}) || f.d.durableCheckpoint.Load() != cp {
		t.Fatal("exact replay was reauthenticated, reexecuted or repersisted")
	}
	pqAssertPhase(t, retry.Replay, 1, 1, 0)
	pqAssertPhase(t, retry.MemberExecution, 0, 0, 0)
	pqAssertPhase(t, retry.WholeAuthentication, 0, 0, 0)
	assertModuleState(t, f.d, before)
	// The two outputs and authoritative history have separate result slices.
	out.Results[0].TransactionHash = "caller-mutation"
	if m.Result.Results[0].TransactionHash == out.Results[0].TransactionHash || f.d.pqBatches[m.WireHash].Results[0].TransactionHash == out.Results[0].TransactionHash {
		t.Fatal("measurement aliases mutable return or authoritative proof")
	}
	raw, err := json.Marshal(m)
	pqMust(t, err)
	var decoded map[string]any
	pqMust(t, json.Unmarshal(raw, &decoded))
	if _, ok := decoded["executionHeight"].(string); !ok {
		t.Fatal("height was emitted as an imprecise JSON number")
	}
	if _, ok := decoded["total"].(map[string]any)["durationNs"].(string); !ok {
		t.Fatal("duration was emitted as an imprecise JSON number")
	}
	restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, before)
	cold, cm, err := restored.SubmitPQBatchMeasured(wire)
	pqMust(t, err)
	if !cold.Replayed || !reflect.DeepEqual(cold.Results, m.Result.Results) || cm.Persistence != (PQSnapshotMeasurement{}) || cm.VerifierSignatureChecks != 0 {
		t.Fatal("cold measured replay changed original outcomes")
	}
}

func TestPQBatchMeasurementUnknownAndRollback(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		name := "before-rename"
		if afterRename {
			name = "after-rename"
		}
		t.Run(name, func(t *testing.T) {
			f := newPQLedger(t)
			f.activate(t)
			wire := f.whole(t, f.batchTransfer(2, 1), f.batchTransfer(3, 1))
			before := moduleBusinessState(t, f.d)
			target := f.d.snapshotPath() + ".tmp"
			if afterRename {
				target = f.d.snapshotIntegrityMarkerPath() + ".tmp"
			}
			unblock := blockSnapshotWrite(t, target)
			out, m, err := f.d.SubmitPQBatchMeasured(wire)
			if err == nil || out.Replayed || m.Persistence.Published != nil || !reflect.DeepEqual(m.Result, out) || m.MemberAdmitted != 2 || m.MemberRejected != 0 || m.VerifierSignatureChecks != 2 {
				t.Fatal("failed checkpoint measurement lost actual admission or claimed durability")
			}
			pqAssertPhase(t, m.Total, 1, 0, 1)
			pqAssertPhase(t, m.Persistence.Total, 1, 0, 1)
			pqAssertPhase(t, m.MemberExecution, 2, 2, 0)
			if afterRename {
				if !errors.Is(err, ErrSnapshotDurabilityUncertain) || out.Status != "uncertain" {
					t.Fatal("post-rename failure lost UNKNOWN")
				}
				pqAssertWrittenFile(t, m.Persistence.SnapshotFile, f.d.snapshotPath())
				pqAssertPhase(t, m.Persistence.MarkerFile.OpenTemp, 1, 0, 1)
				pqAssertPhase(t, m.Persistence.MarkerFile.FileSync, 0, 0, 0)
				retained := moduleBusinessState(t, f.d)
				retry, rm, e := f.d.SubmitPQBatchMeasured(wire)
				if !errors.Is(e, ErrSnapshotDurabilityUncertain) || retry.Status != "uncertain" || retry.Replayed || !reflect.DeepEqual(retry.Results, out.Results) || rm.MemberAdmitted != 0 || rm.VerifierSignatureChecks != 0 || rm.Persistence.Published != nil {
					t.Fatal("blocked original UNKNOWN retry changed identity or executed again")
				}
				pqAssertPhase(t, rm.Replay, 1, 0, 1)
				pqAssertPhase(t, rm.MemberExecution, 0, 0, 0)
				pqAssertPhase(t, rm.Persistence.Total, 1, 0, 1)
				assertModuleState(t, f.d, retained)
				assertModuleState(t, readTransferSnapshot(t, f.d), retained)
			} else {
				if errors.Is(err, ErrSnapshotDurabilityUncertain) || out.Status != "not_committed" || len(f.d.pqBatches) != 0 {
					t.Fatal("pre-rename failed batch was not rolled back")
				}
				pqAssertPhase(t, m.Persistence.SnapshotFile.OpenTemp, 1, 0, 1)
				pqAssertPhase(t, m.Persistence.SnapshotFile.FileSync, 0, 0, 0)
				pqAssertPhase(t, m.Persistence.MarkerFile.Total, 0, 0, 0)
				assertModuleState(t, f.d, before)
			}
			unblock()
			recovered, rm, err := f.d.SubmitPQBatchMeasured(wire)
			pqMust(t, err)
			if recovered.Status != "durable" || recovered.Replayed != afterRename || !reflect.DeepEqual(recovered.Results, out.Results) || rm.Persistence.Published == nil || rm.WireHash != m.WireHash || rm.ExecutionHeight != m.ExecutionHeight {
				t.Fatal("recovery lost original partial results, height or checkpoint")
			}
			if afterRename && (rm.VerifierSignatureChecks != 0 || rm.MemberAdmitted != 0 || rm.MemberExecution.Attempts != 0 || rm.Replay.Completed != 1) {
				t.Fatal("UNKNOWN reconfirm reexecuted or reauthenticated members")
			}
			pqAssertWrittenFile(t, rm.Persistence.SnapshotFile, f.d.snapshotPath())
			pqAssertWrittenFile(t, rm.Persistence.MarkerFile, f.d.snapshotIntegrityMarkerPath())
			a, _ := f.d.Account(f.owner)
			if a.Balance != 995 || a.Nonce != 3 {
				t.Fatal("measured recovery double charged or consumed a second nonce")
			}
			restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			assertModuleState(t, restored, moduleBusinessState(t, f.d))
		})
	}
}

func TestPQBatchMeasurementRejectAndMemoryBoundaries(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	wire := f.whole(t, f.batchTransfer(2, 1), f.batchTransfer(3, 1))
	before := moduleBusinessState(t, f.d)
	cp := f.d.durableCheckpoint.Load()
	for _, branch := range []string{"A", "B"} {
		whole, err := ynxbatch.DecodeWhole(wire)
		pqMust(t, err)
		if branch == "A" {
			whole.Certificate.SigmaA[10] ^= 1
		} else {
			whole.Certificate.SigmaB[10] ^= 1
		}
		bad, err := ynxbatch.EncodeWhole(whole)
		pqMust(t, err)
		_, m, err := f.d.SubmitPQBatchMeasured(bad)
		if err == nil || m.VerifierSignatureChecks != 2 || m.MemberExecution.Attempts != 0 || m.Persistence != (PQSnapshotMeasurement{}) || f.d.durableCheckpoint.Load() != cp {
			t.Fatalf("invalid AND branch %s reached execution/persistence", branch)
		}
		pqAssertPhase(t, m.WholeAuthentication, 1, 0, 1)
		assertModuleState(t, f.d, before)
	}
	rejectedWire := f.whole(t, f.batchTransfer(1, 1), f.batchTransfer(4, 1))
	out, m, err := f.d.SubmitPQBatchMeasured(rejectedWire)
	pqMust(t, err)
	if out.Status != "rejected" || out.Replayed || m.MemberAdmitted != 0 || m.MemberRejected != 2 || m.VerifierSignatureChecks != 2 || m.Persistence != (PQSnapshotMeasurement{}) || len(f.d.pqBatches) != 0 || f.d.durableCheckpoint.Load() != cp {
		t.Fatal("all rejected batch claimed a durable/replayable checkpoint")
	}
	pqAssertPhase(t, m.Total, 1, 1, 0) // successful API response, zero accepted business
	pqAssertPhase(t, m.MemberExecution, 2, 0, 2)
	assertModuleState(t, f.d, before)
	f.d.dataDir = ""
	out, m, err = f.d.SubmitPQBatchMeasured(wire)
	pqMust(t, err)
	if out.Status != "memory" || m.MemberAdmitted != 2 || m.Persistence != (PQSnapshotMeasurement{}) || f.d.durableCheckpoint.Load() != cp {
		t.Fatal("memory-only execution claimed a disk checkpoint")
	}
}

func TestPQBatchMeasurementDirectorySyncAndCanonicalBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.json")
	value := map[string]any{"actual": []int{1, 2, 3}, "wire": "unchanged"}
	canonical, err := json.MarshalIndent(value, "", "  ")
	pqMust(t, err)
	var m PQDurableFileMeasurement
	var directories []string
	failure := errors.New("actual injected directory synchronization failure")
	err = writeDurableSnapshotJSONMeasured(path, value, func(directory string) error {
		directories = append(directories, directory)
		return failure
	}, &m)
	if !errors.Is(err, ErrSnapshotDurabilityUncertain) || !errors.Is(err, failure) || !reflect.DeepEqual(directories, []string{filepath.Dir(path)}) {
		t.Fatal("directory failure was hidden or executed against a different path")
	}
	for _, p := range []PQPhaseMeasurement{m.OpenTemp, m.EncodeWrite, m.FileSync, m.Close, m.Rename} {
		pqAssertPhase(t, p, 1, 1, 0)
	}
	pqAssertPhase(t, m.DirectorySync, 1, 0, 1)
	pqAssertPhase(t, m.Total, 1, 0, 1)
	raw, err := os.ReadFile(path)
	pqMust(t, err)
	if !bytes.Equal(raw, canonical) || m.BytesWritten != uint64(len(raw)) || m.WriteCalls == 0 {
		t.Fatal("instrumentation changed canonical bytes or reported estimated write bytes")
	}
	var memorySafe PQPhaseMeasurement
	start := memorySafe.begin(false)
	memorySafe.finish(false, start, failure)
	if memorySafe != (PQPhaseMeasurement{}) {
		t.Fatal("unmeasured original path accumulated clock/counter state")
	}
}
