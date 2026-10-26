package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"testing"
	"time"
	"unicode/utf8"
)

func migrationDetachedFixture(t *testing.T, pq bool) ConsensusMigrationState {
	t.Helper()
	d := ownedMigrationSnapshotFixture(t, pq)
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func migrationDetachedOldOracle(t *testing.T, source ConsensusMigrationState) ([]byte, ConsensusMigrationState) {
	t.Helper()
	raw, err := source.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	var decoded ConsensusMigrationState
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return raw, decoded
}

func TestConsensusMigrationDetachedMatchesOldCanonicalJSONAndDecodedValues(t *testing.T) {
	for _, name := range []string{"legacy-account-state", "complete-runtime", "complete-pq-runtime", "durable-dex"} {
		t.Run(name, func(t *testing.T) {
			state := migrationDetachedFixture(t, name == "complete-pq-runtime")
			if name == "legacy-account-state" {
				state.Version, state.SourceFormat = LegacyConsensusMigrationVersion, "ynx-devnet-state-v1"
				state.ContractMaterials, state.OriginalGenesisHash, state.AccountPolicy, state.Runtime = nil, "", nil, nil
			} else if name == "durable-dex" {
				d, _ := dexPersistenceFixture(t, NativeDexActionSwapExactInput)
				var err error
				state, err = d.ExportConsensusMigrationState()
				if err != nil {
					t.Fatal(err)
				}
			} else {
				// These required slices preserve null versus an explicit empty
				// array, while omitted empty optional maps retain JSON semantics.
				state.Runtime.Pending = []Transaction{}
				state.Runtime.Blocks[len(state.Runtime.Blocks)-1].Transactions = []Transaction{}
			}
			var err error
			state.StateHash, err = state.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			wantRaw, wantDetached := migrationDetachedOldOracle(t, state)
			before := ownedMigrationJSON(t, state)
			var out bytes.Buffer
			got, err := state.WriteDetachedCanonicalJSON(&out)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(out.Bytes(), wantRaw) || sha256.Sum256(out.Bytes()) != sha256.Sum256(wantRaw) || !reflect.DeepEqual(got, wantDetached) {
				t.Fatal("stream/detached result differs from the original CanonicalJSON followed by Unmarshal")
			}
			if !bytes.Equal(before, ownedMigrationJSON(t, state)) {
				t.Fatal("detaching changed source metadata, history or empty values")
			}
		})
	}
}

func TestConsensusMigrationDetachedPreservesOriginalBytesWhenDecodeNormalizes(t *testing.T) {
	state := migrationDetachedFixture(t, false)
	state.Network.Name = "source <&> invalid \xff"
	state.Runtime.Config = state.Network
	state.Runtime.Blocks[1].Validator = "validator-\xff\xfe"
	state.Runtime.Blocks[1].Time = time.Now() // Includes its original monotonic reading.
	state.Runtime.Blocks[2].Time = time.Date(2026, 10, 25, 4, 5, 6, 123, time.FixedZone("source-zone", 19800))
	var err error
	state.StateHash, err = state.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	wantRaw, wantDetached := migrationDetachedOldOracle(t, state)
	originalTime := state.Runtime.Blocks[1].Time
	originalValidator := state.Runtime.Blocks[1].Validator
	var out bytes.Buffer
	got, err := state.WriteDetachedCanonicalJSON(&out)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(wantRaw, out.Bytes()) || !reflect.DeepEqual(got, wantDetached) {
		t.Fatal("normalization changed the original raw-byte binding or the original decoded values")
	}
	if utf8.ValidString(state.Network.Name) || !utf8.ValidString(got.Network.Name) || !utf8.ValidString(got.Runtime.Blocks[1].Validator) {
		t.Fatal("fixture did not exercise the original invalid-UTF-8 decoder normalization")
	}
	if state.Runtime.Blocks[1].Time != originalTime || state.Runtime.Blocks[1].Validator != originalValidator {
		t.Fatal("header normalization mutated original source data")
	}
	normalizedRaw, err := json.MarshalIndent(got, "", "  ")
	if err != nil || bytes.Equal(normalizedRaw, wantRaw) {
		t.Fatal("fixture must distinguish original canonical bytes from re-encoded decoded values:", err)
	}
}

func TestConsensusMigrationDetachedHasNoNestedSourceOrExecutionAliases(t *testing.T) {
	state := migrationDetachedFixture(t, true)
	detached, err := state.WriteDetachedCanonicalJSON(io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Runtime.Blocks[1].Transactions) == 0 || len(state.Runtime.Blocks[1].Transactions[0].Logs) == 0 || len(state.Runtime.Blocks[1].Transactions[0].Logs[0].Topics) == 0 || len(state.Runtime.Blocks[1].Transactions[0].LotFlows) == 0 {
		t.Fatal("fixture lacks original nested receipt and lot-flow records")
	}
	beforeDetached := ownedMigrationJSON(t, detached)
	state.Accounts[0].Lots["source-execution-only"] = 1
	state.ResourcePolicy.Notes[0] = "source execution notes"
	state.AccountPolicy.NetworkID[0] ^= 1
	state.Runtime.AccountPolicy.NetworkID[0] ^= 1
	state.Runtime.Accounts["ynx_owned_export_sender"].Nonce++
	state.Runtime.Accounts["ynx_owned_export_sender"].Lots["source-runtime-only"] = 1
	state.Runtime.Policy.Notes[0] = "source runtime notes"
	state.Runtime.Blocks[1].Transactions[0].Logs[0].Topics[0] = "source log topic"
	state.Runtime.Blocks[1].Transactions[0].LotFlows[0].Amount++
	state.Runtime.Blocks[2].Hash = "source header"
	if !bytes.Equal(beforeDetached, ownedMigrationJSON(t, detached)) {
		t.Fatal("detached state retained a source map, pointer, byte slice, history or nested transaction alias")
	}
	beforeSource := ownedMigrationJSON(t, state)
	detached.Accounts[0].Lots["detached-execution-only"] = 1
	detached.ResourcePolicy.Notes[0] = "detached execution notes"
	detached.AccountPolicy.NetworkID[0] ^= 1
	detached.Runtime.AccountPolicy.NetworkID[1] ^= 1
	detached.Runtime.Accounts["ynx_owned_export_sender"].Lots["detached-runtime-only"] = 1
	detached.Runtime.Policy.Notes[0] = "detached runtime notes"
	detached.Runtime.Blocks[1].Transactions[0].Logs[0].Topics[0] = "detached log topic"
	detached.Runtime.Blocks[1].Transactions[0].LotFlows[0].Amount++
	detached.Runtime.Blocks[2].Hash = "detached header"
	if !bytes.Equal(beforeSource, ownedMigrationJSON(t, state)) {
		t.Fatal("mutating the detached result changed its original source")
	}
	if detached.Runtime.Policy.Notes[0] == detached.ResourcePolicy.Notes[0] || detached.Runtime.AccountPolicy.NetworkID[0] == detached.AccountPolicy.NetworkID[0] {
		t.Fatal("separately encoded execution and runtime copies became aliases")
	}
}

func TestConsensusMigrationDetachedFailureNeverReturnsAWitness(t *testing.T) {
	state := migrationDetachedFixture(t, false)
	invalid := state
	invalid.StateHash = "invalid"
	want := invalid.Validate()
	var out bytes.Buffer
	got, err := invalid.WriteDetachedCanonicalJSON(&out)
	if want == nil || err == nil || want.Error() != err.Error() || out.Len() != 0 || !reflect.DeepEqual(got, ConsensusMigrationState{}) {
		t.Fatal("invalid state emitted bytes, changed its validation cause or returned a candidate", err)
	}
	original := errors.New("original detached-writer failure")
	for _, writer := range []io.Writer{canonicalStateShortWriter{}, canonicalStateErrorWriter{original}, nil} {
		got, err := state.WriteDetachedCanonicalJSON(writer)
		if err == nil || !reflect.DeepEqual(got, ConsensusMigrationState{}) {
			t.Fatal("writer failure returned a usable detached migration", err)
		}
	}
	if _, err := state.WriteDetachedCanonicalJSON(canonicalStateShortWriter{}); !errors.Is(err, io.ErrShortWrite) {
		t.Fatal("original short-write cause was lost:", err)
	}
	if _, err := state.WriteDetachedCanonicalJSON(canonicalStateErrorWriter{original}); !errors.Is(err, original) {
		t.Fatal("original writer cause was lost:", err)
	}
	partial := &migrationDetachedPartialWriter{limit: 128, err: original}
	got, err = state.WriteDetachedCanonicalJSON(partial)
	if !errors.Is(err, original) || partial.written == 0 || !reflect.DeepEqual(got, ConsensusMigrationState{}) {
		t.Fatal("partial output was treated as a witness or lost its first write failure:", err)
	}
}

type migrationDetachedPartialWriter struct {
	limit, written int
	err            error
}

func (w *migrationDetachedPartialWriter) Write(p []byte) (int, error) {
	n := len(p)
	if n > w.limit-w.written {
		n = w.limit - w.written
	}
	w.written += n
	return n, w.err
}

func TestConsensusMigrationDetachedStreamsCompleteHistoryInBoundedChunks(t *testing.T) {
	d := ownedMigrationSnapshotFixture(t, false)
	for i := 0; i < 512; i++ {
		d.ProduceBlock()
	}
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	wantRaw, wantDetached := migrationDetachedOldOracle(t, state)
	digest := sha256.New()
	out := &canonicalStateChunkWriter{writer: digest}
	detached, err := state.WriteDetachedCanonicalJSON(out)
	if err != nil {
		t.Fatal(err)
	}
	wantHash := sha256.Sum256(wantRaw)
	if out.bytes != len(wantRaw) || out.max > 64*1024 || out.calls < 2 || !bytes.Equal(digest.Sum(nil), wantHash[:]) || !reflect.DeepEqual(detached, wantDetached) {
		t.Fatal("streamed complete history changed canonical bytes, omitted records or exceeded output chunk size")
	}
	if &state.Runtime.Blocks[0] == &detached.Runtime.Blocks[0] {
		t.Fatal("detached constructor borrowed the caller's historical block array")
	}
}
