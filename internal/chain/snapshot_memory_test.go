package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Public synthetic material only. The large Memo deliberately models retained
// transaction payload, not a valid signed transaction or a production snapshot.
// Real business history and cold validation are tested separately below.
func snapshotMemoryDenseBlock() Block {
	block := Block{Height: 7, Hash: strings.Repeat("1", 64), ParentHash: strings.Repeat("2", 64), Time: time.Unix(1700000000, 123).UTC(), Validator: "public-synthetic-validator"}
	memo := strings.Repeat("public-record-", 630)
	for i := 0; i < 1024; i++ {
		block.Transactions = append(block.Transactions, Transaction{
			Hash: fmt.Sprintf("public-%04d", i), Type: "transfer", From: "public-alice", To: "public-bob", Amount: 2, Fee: 1, Nonce: uint64(i + 1),
			BlockHash: block.Hash, BlockNum: block.Height, Timestamp: block.Time, Memo: memo,
			LotFlows: []LotFlow{{LotID: "public-lot", Amount: 2, From: "public-alice", To: "public-bob"}},
		})
	}
	return block
}

func snapshotMemoryOldBatchIntegrity(batch replicationBatch) (string, error) {
	batch.Integrity = ""
	raw, err := json.Marshal(batch)
	if err != nil {
		return "", fmt.Errorf("encode replication batch integrity document: %w", err)
	}
	h := sha256.New()
	_, _ = h.Write([]byte(replicationBatchHashDomain + "\x00"))
	_, _ = h.Write(raw)
	return hex.EncodeToString(h.Sum(nil)), nil
}

func TestLegacySnapshotMemoryCanonicalBatchAndBlock(t *testing.T) {
	block := snapshotMemoryDenseBlock()
	// Custom time, omitted state, nil/empty collections, invalid UTF-8 and JSON
	// escaping remain encoding/json contracts, including on the new boundaries.
	block.Transactions[0].Memo = "<>&\u2028\u2029\xff\n\""
	block.Time = block.Time.In(time.FixedZone("offset", 19800))
	snapshot := devnetSnapshot{Version: 2, Blocks: []Block{block}, Accounts: map[string]*Account{"z": {Address: "z", Balance: 17, Nonce: 1 << 54}, "a": nil}}
	batch := replicationBatch{Version: 1, SavedAt: block.Time, Blocks: snapshot.Blocks, State: &snapshot, Complete: true, Integrity: "unchanged-original"}
	for name, value := range map[string]any{
		"block": block, "block-pointer": &block, "block-nil": (*Block)(nil),
		"block-empty": Block{Transactions: []Transaction{}}, "block-null": Block{},
		"batch": batch, "batch-empty": replicationBatch{Blocks: []Block{}}, "batch-null": replicationBatch{},
	} {
		t.Run(name, func(t *testing.T) {
			for _, pretty := range []bool{false, true} {
				var expected []byte
				var err error
				if pretty {
					expected, err = json.MarshalIndent(value, "", "  ")
				} else {
					expected, err = json.Marshal(value)
				}
				if err != nil {
					t.Fatal(err)
				}
				var out bytes.Buffer
				if err := writeCanonicalStateJSON(&out, value, pretty); err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(expected, out.Bytes()) {
					t.Fatalf("canonical bytes changed: %s pretty=%t", name, pretty)
				}
			}
		})
	}
	want, err := snapshotMemoryOldBatchIntegrity(batch)
	if err != nil {
		t.Fatal(err)
	}
	got, err := replicationBatchIntegrity(batch)
	if err != nil || got != want {
		t.Fatalf("replication batch domain/preimage changed: %v", err)
	}
	if batch.Integrity != "unchanged-original" {
		t.Fatal("hashing mutated caller batch")
	}
	batch.SavedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
	_, oldErr := snapshotMemoryOldBatchIntegrity(batch)
	_, newErr := replicationBatchIntegrity(batch)
	if oldErr == nil || newErr == nil || oldErr.Error() != newErr.Error() {
		t.Fatalf("original encoding failure changed: %v / %v", oldErr, newErr)
	}
}

func TestLegacySnapshotMemoryDenseBlockBoundedWrites(t *testing.T) {
	block := snapshotMemoryDenseBlock()
	for _, pretty := range []bool{false, true} {
		var expected []byte
		var err error
		if pretty {
			expected, err = json.MarshalIndent(block, "", "  ")
		} else {
			expected, err = json.Marshal(block)
		}
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.New()
		out := &canonicalStateChunkWriter{writer: digest}
		if err := writeCanonicalStateJSON(out, block, pretty); err != nil {
			t.Fatal(err)
		}
		want := sha256.Sum256(expected)
		if out.bytes != len(expected) || !bytes.Equal(digest.Sum(nil), want[:]) {
			t.Fatal("dense block bytes changed")
		}
		// Each fixture transaction is below 64 KiB. This must not emit the
		// whole multi-MiB block as one leaf, even inside a streamed snapshot.
		if out.max > 64<<10 || out.calls < 100 {
			t.Fatalf("dense block still allocated/emitted as one leaf: bytes=%d maxWrite=%d calls=%d", out.bytes, out.max, out.calls)
		}
	}
}

func snapshotMemoryBusinessFixture(t *testing.T) *Devnet {
	d, _ := snapshotMemoryBusinessSource(t)
	return d
}

func snapshotMemoryBusinessSource(t *testing.T) (*Devnet, devnetSnapshot) {
	t.Helper()
	d := NewDevnet(DefaultNetworkConfig("devnet"))
	// Retain the actual original genesis checkpoint before any mutation. Two
	// separate NewDevnet calls intentionally have different genesis timestamps.
	initial, err := detachDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	initial, err = sealDevnetSnapshot(initial)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Faucet("snapshot-memory-alice", 100000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	for i := 0; i < 128; i++ {
		if _, err := d.Transfer("snapshot-memory-alice", "snapshot-memory-bob", 2); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	for i := 0; i < 258; i++ {
		d.ProduceBlock()
	}
	if _, err := d.Transfer("snapshot-memory-alice", "snapshot-memory-bob", 3); err != nil {
		t.Fatal(err)
	}
	return d, initial
}

func TestLegacySnapshotMemoryFullHistoryColdAndReplication(t *testing.T) {
	d, initial := snapshotMemoryBusinessSource(t)
	original, err := sealDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	unsigned := original
	unsigned.StateIntegrity = ""
	legacy := sha256.New()
	_, _ = legacy.Write([]byte(devnetSnapshotHashDomain + "\x00"))
	// Exact be9 normal hash path: Encoder + newline-stripping body writer.
	body := &jsonBodyWriter{target: legacy}
	if err := json.NewEncoder(body).Encode(unsigned); err != nil {
		t.Fatal(err)
	}
	if err := body.Finish(); err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(legacy.Sum(nil)) != original.StateIntegrity {
		t.Fatal("legacy snapshot hash changed")
	}
	want, err := json.MarshalIndent(original, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	d.dataDir = normalSnapshotStreamDirectory(t)
	if err := d.persistPreparedSnapshot(original); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(d.snapshotPath())
	if err != nil || !bytes.Equal(raw, want) {
		t.Fatal("persisted full-history bytes changed", err)
	}
	cold, err := NewPersistentDevnet(d.cfg, d.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	normalSnapshotStreamEqualState(t, d, cold)
	beforeHash, err := replicationApplicationStateIntegrity(original)
	if err != nil {
		t.Fatal(err)
	}
	afterHash, err := replicationApplicationStateIntegrity(cold.snapshotLocked())
	if err != nil || beforeHash != afterHash {
		t.Fatal("legacy application-state integrity changed after cold reopen", err)
	}
	account, ok := cold.Account("snapshot-memory-alice")
	if !ok || account.Nonce != 129 || account.Balance != 100000-128*3-4 {
		t.Fatalf("exact balance/nonce lost: %+v", account)
	}
	for _, tx := range append(append([]Transaction(nil), original.Blocks[2].Transactions...), original.Pending...) {
		_, durability, ok := cold.TransactionWithDurability(tx.Hash)
		wantStatus := "durable"
		if tx.BlockNum == 0 {
			wantStatus = "pending_durable"
		}
		if !ok || durability.Status != wantStatus {
			t.Fatal("cold checkpoint lost original transaction durability")
		}
	}

	// Apply the original Marshal-produced bytes with its original hash. A
	// partial suffix, a complete state-bearing suffix and cold reopen all run
	// through unchanged production validators and persistence.
	followerDir := normalSnapshotStreamDirectory(t)
	if err := writeDurableSnapshotJSON(filepath.Join(followerDir, "devnet-state.json"), initial); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(followerDir, "devnet-state.integrity-version"), []byte("2\n"), 0600); err != nil {
		t.Fatal(err)
	}
	follower, err := NewPersistentDevnet(d.cfg, followerDir)
	if err != nil {
		t.Fatal(err)
	}
	localObservations, err := detachDevnetSnapshot(follower.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	for follower.LatestHeight() < d.LatestHeight() {
		base := follower.LatestBlock()
		payload, err := d.replicationBatchJSONWithLimit(base.Height, base.Hash, 64, MaxReplicationBatchPayloadBytes)
		if err != nil {
			t.Fatal(err)
		}
		var batch replicationBatch
		if err := json.Unmarshal(payload, &batch); err != nil {
			t.Fatal(err)
		}
		oldHash, err := snapshotMemoryOldBatchIntegrity(batch)
		if err != nil || oldHash != batch.Integrity {
			t.Fatal("normal replication output changed original hash", err)
		}
		if _, err := follower.ApplyReplicationBatchJSON(payload); err != nil {
			t.Fatal(err)
		}
	}
	// Replication deliberately keeps this node's peer observations. Bind them
	// to their exact pre-apply values; every other typed field must equal source.
	expected := d.snapshotLocked()
	expected.Peers, expected.PeerSyncs = localObservations.Peers, localObservations.PeerSyncs
	actual := follower.snapshotLocked()
	expected.SavedAt, actual.SavedAt = time.Time{}, time.Time{}
	expected.StateIntegrity, actual.StateIntegrity = "", ""
	if !reflect.DeepEqual(expected, actual) {
		var different []string
		a, b := reflect.ValueOf(expected), reflect.ValueOf(actual)
		for i := 0; i < a.NumField(); i++ {
			if !reflect.DeepEqual(a.Field(i).Interface(), b.Field(i).Interface()) {
				different = append(different, a.Type().Field(i).Name)
			}
		}
		t.Fatalf("complete replication changed fields relative to source/local observation contract: %v", different)
	}
	reopened, err := NewPersistentDevnet(d.cfg, followerDir)
	if err != nil {
		t.Fatal(err)
	}
	normalSnapshotStreamEqualState(t, follower, reopened)
	// Resealing the envelope cannot bypass inner state/history validation.
	base := NewDevnet(d.cfg)
	payload, err := d.ReplicationBatchJSON(base.LatestHeight(), base.LatestBlock().Hash)
	if err != nil {
		t.Fatal(err)
	}
	var tampered replicationBatch
	if err := json.Unmarshal(payload, &tampered); err != nil {
		t.Fatal(err)
	}
	tampered.State.Accounts["snapshot-memory-alice"].Nonce++
	tampered.Integrity, err = snapshotMemoryOldBatchIntegrity(tampered)
	if err != nil {
		t.Fatal(err)
	}
	payload, err = json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	before := base.snapshotLocked()
	before.SavedAt = time.Time{}
	beforeWire, err := json.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base.ApplyReplicationBatchJSON(payload); err == nil || !strings.Contains(err.Error(), "state integrity mismatch") {
		t.Fatal("resealed corrupt source state did not reach the original state-integrity rejection", err)
	}
	after := base.snapshotLocked()
	after.SavedAt = time.Time{}
	afterWire, err := json.Marshal(after)
	if err != nil || !bytes.Equal(beforeWire, afterWire) {
		t.Fatal("failed replication changed state")
	}
}

func TestLegacySnapshotMemoryLateFailureAndUnknown(t *testing.T) {
	d := snapshotMemoryBusinessFixture(t)
	original, err := sealDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.MarshalIndent(original, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	for _, failure := range []string{"late-tx-encoding", "post-rename-unknown"} {
		t.Run(failure, func(t *testing.T) {
			path := filepath.Join(normalSnapshotStreamDirectory(t), "devnet-state.json")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			candidate, err := detachDevnetSnapshot(original)
			if err != nil {
				t.Fatal(err)
			}
			cause := errors.New("original directory sync failure")
			syncDir := syncSnapshotDirectory
			if failure == "late-tx-encoding" {
				last := len(candidate.Blocks[2].Transactions) - 1
				candidate.Blocks[2].Transactions[last].Timestamp = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
			} else {
				candidate.SavedAt = candidate.SavedAt.Add(time.Second)
				candidate, err = sealDevnetSnapshot(candidate)
				if err != nil {
					t.Fatal(err)
				}
				syncDir = func(string) error { return cause }
			}
			var measurement PQDurableFileMeasurement
			err = writeDurableSnapshotJSONMeasured(path, candidate, syncDir, &measurement)
			retained, readErr := os.ReadFile(path)
			if err == nil || readErr != nil {
				t.Fatal("failure lost original outcome", err, readErr)
			}
			if failure == "late-tx-encoding" {
				if !bytes.Equal(retained, raw) || measurement.Rename.Attempts != 0 || measurement.WriteCalls == 0 {
					t.Fatal("late record failure replaced original or did not stream")
				}
			} else {
				want, encodeErr := json.MarshalIndent(candidate, "", "  ")
				if encodeErr != nil || !errors.Is(err, ErrSnapshotDurabilityUncertain) || !errors.Is(err, cause) || !bytes.Equal(retained, want) {
					t.Fatal("UNKNOWN lost exact replacement/cause", err)
				}
			}
		})
	}
}

type snapshotMemoryObservation struct {
	Bytes               int    `json:"bytes"`
	MaxWrite            int    `json:"maxWrite"`
	Writes              int    `json:"writes"`
	TotalAlloc          uint64 `json:"totalAlloc"`
	FirstWriteHeapDelta uint64 `json:"firstWriteHeapDelta"`
	ElapsedNS           int64  `json:"elapsedNS"`
	SHA256              string `json:"sha256"`
}

type snapshotMemoryObservedWriter struct {
	h           hash.Hash
	baseline    uint64
	observation snapshotMemoryObservation
}

func (w *snapshotMemoryObservedWriter) Write(p []byte) (int, error) {
	if w.observation.Writes == 0 {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		if m.HeapAlloc > w.baseline {
			w.observation.FirstWriteHeapDelta = m.HeapAlloc - w.baseline
		}
	}
	w.observation.Writes++
	w.observation.Bytes += len(p)
	if len(p) > w.observation.MaxWrite {
		w.observation.MaxWrite = len(p)
	}
	return w.h.Write(p)
}

func snapshotMemoryMeasure(t *testing.T, write func(io.Writer) error) snapshotMemoryObservation {
	t.Helper()
	// Drain stdlib's sync.Pool before each arm, with identical collection
	// policy. This measures allocations, not a production heap/cgroup peak.
	runtime.GC()
	runtime.GC()
	w := &snapshotMemoryObservedWriter{h: sha256.New()}
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	w.baseline = before.HeapAlloc
	start := time.Now()
	if err := write(w); err != nil {
		t.Fatal(err)
	}
	w.observation.ElapsedNS = time.Since(start).Nanoseconds()
	runtime.ReadMemStats(&after)
	w.observation.TotalAlloc = after.TotalAlloc - before.TotalAlloc
	w.observation.SHA256 = hex.EncodeToString(w.h.Sum(nil))
	return w.observation
}

func TestLegacySnapshotMemorySameInputAllocation(t *testing.T) {
	block := snapshotMemoryDenseBlock()
	for _, pretty := range []bool{false, true} {
		before := snapshotMemoryMeasure(t, func(w io.Writer) error {
			var raw []byte
			var err error
			// This is the exact f27 writer's Block leaf path.
			if pretty {
				raw, err = json.MarshalIndent(block, "", "  ")
			} else {
				raw, err = json.Marshal(block)
			}
			if err != nil {
				return err
			}
			_, err = w.Write(raw)
			return err
		})
		after := snapshotMemoryMeasure(t, func(w io.Writer) error { return writeCanonicalStateJSON(w, block, pretty) })
		if before.Bytes != after.Bytes || before.SHA256 != after.SHA256 {
			t.Fatal("measured block input/output changed")
		}
		if after.TotalAlloc >= before.TotalAlloc || after.FirstWriteHeapDelta >= before.FirstWriteHeapDelta {
			t.Fatal("record streaming did not reduce this measured allocation overlap")
		}
		raw, _ := json.Marshal(struct {
			Pretty        bool
			Before, After snapshotMemoryObservation
		}{pretty, before, after})
		t.Logf("PUBLIC_SYNTHETIC_BLOCK_ALLOCATION %s", raw)
	}
	batch := replicationBatch{Version: 1, Blocks: []Block{block}, State: &devnetSnapshot{Version: 2, Accounts: map[string]*Account{"public-alice": {Address: "public-alice", Balance: 10000, Nonce: 1024}}}, Complete: true}
	before := snapshotMemoryMeasure(t, func(w io.Writer) error {
		raw, err := json.Marshal(batch)
		if err != nil {
			return err
		}
		_, err = w.Write(raw)
		return err
	})
	after := snapshotMemoryMeasure(t, func(w io.Writer) error { return writeCanonicalStateJSON(w, batch, false) })
	if before.Bytes != after.Bytes || before.SHA256 != after.SHA256 || after.TotalAlloc >= before.TotalAlloc {
		t.Fatal("batch hash preimage allocation/output regression")
	}
	raw, _ := json.Marshal(struct{ Before, After snapshotMemoryObservation }{before, after})
	t.Logf("PUBLIC_SYNTHETIC_BATCH_ALLOCATION %s", raw)
	runtime.KeepAlive(block)
	runtime.KeepAlive(batch)
}

// Unlike the larger encoder-only stress record above, every transaction here
// is produced by the normal legacy business methods and passes the full normal
// history/state validators. Retain the original received bytes throughout both
// hash arms, matching the real receiver's byte+decoded-state overlap.
func TestLegacySnapshotMemoryValidHistoryAllocation(t *testing.T) {
	d := snapshotMemoryBusinessFixture(t)
	for i := 0; i < 2048; i++ {
		if _, err := d.Transfer("snapshot-memory-alice", "snapshot-memory-bob", 2); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	genesis := d.blocks[0]
	received, err := d.ReplicationBatchJSON(genesis.Height, genesis.Hash)
	if err != nil {
		t.Fatal(err)
	}
	var batch replicationBatch
	if err := json.Unmarshal(received, &batch); err != nil {
		t.Fatal(err)
	}
	if err := validateReplicationBatch(batch, d.cfg); err != nil {
		t.Fatal(err)
	}
	originalIntegrity := batch.Integrity
	batch.Integrity = ""
	before := snapshotMemoryMeasure(t, func(w io.Writer) error {
		b, err := json.Marshal(batch)
		if err != nil {
			return err
		}
		_, err = w.Write(b)
		return err
	})
	after := snapshotMemoryMeasure(t, func(w io.Writer) error { return writeCanonicalStateJSON(w, batch, false) })
	if before.Bytes != after.Bytes || before.SHA256 != after.SHA256 || after.TotalAlloc >= before.TotalAlloc {
		t.Fatal("valid complete history hash preimage or allocation changed unexpectedly")
	}
	gotIntegrity, err := replicationBatchIntegrity(batch)
	if err != nil || gotIntegrity != originalIntegrity {
		t.Fatal("original full-state batch integrity changed", err)
	}
	raw, _ := json.Marshal(struct{ Before, After snapshotMemoryObservation }{before, after})
	t.Logf("PUBLIC_VALID_LEGACY_HISTORY_ALLOCATION transactions=2178 complete=true %s", raw)
	// One standard-encoder checkpoint and one new-encoder checkpoint, same
	// input timestamp and full fields, then actual normal cold constructors.
	snapshot, err := sealDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	originalBytes, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	for _, arm := range []string{"standard-encoder", "record-stream"} {
		dir := normalSnapshotStreamDirectory(t)
		path := filepath.Join(dir, "devnet-state.json")
		if arm == "standard-encoder" {
			err = os.WriteFile(path, originalBytes, 0600)
		} else {
			err = writeDurableSnapshotJSON(path, snapshot)
		}
		if err != nil {
			t.Fatal(err)
		}
		retained, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(retained, originalBytes) {
			t.Fatal("same-input original checkpoint bytes differ", err)
		}
		if err := os.WriteFile(filepath.Join(dir, "devnet-state.integrity-version"), []byte("2\n"), 0600); err != nil {
			t.Fatal(err)
		}
		cold, err := NewPersistentDevnet(d.cfg, dir)
		if err != nil {
			t.Fatal(err)
		}
		normalSnapshotStreamEqualState(t, d, cold)
		alice, ok := cold.Account("snapshot-memory-alice")
		if !ok || alice.Nonce != 2177 || alice.Balance != 100000-128*3-4-2048*3 {
			t.Fatalf("valid history cold balance/nonce differs in %s", arm)
		}
	}
	runtime.KeepAlive(received)
	runtime.KeepAlive(batch)
}
