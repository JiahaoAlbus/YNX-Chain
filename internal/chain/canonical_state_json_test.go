package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"math"
	"testing"
	"time"
)

func TestCanonicalStateJSONMatchesExistingEncoding(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	snapshot := d.snapshotLocked()
	snapshot.SavedAt = time.Date(2026, 10, 26, 4, 5, 6, 123456789, time.FixedZone("offset", 19800))
	snapshot.PQBatches = map[string]PQBatchProof{
		"z\u2028<>&\"": {Whole: []byte{0, 1, 254, 255}, Height: math.MaxUint64},
		"a":            {Whole: []byte{}, Results: []PQBatchMemberResult{}},
	}
	snapshot.ActionRefs = map[string]string{"\xff": "invalid \xff UTF-8", "<a>": "\n\t\u2029", "a": ""}
	snapshot.DexBalances = map[string]map[string]int64{
		"z": {"z": math.MinInt64, "a": math.MaxInt64}, "a": {}, "nil": nil,
	}
	snapshot.Blocks = append(snapshot.Blocks, Block{
		Height: math.MaxUint64, Time: snapshot.SavedAt,
		Transactions: []Transaction{{Nonce: math.MaxUint64, Amount: math.MinInt64, Memo: "<script>\n\u2028", Logs: []EVMLog{{Topics: []string{"z", "a"}, Data: "0x00"}}}},
	})
	runtime := ConsensusRuntimeState(snapshot)
	withRuntime := state
	withRuntime.Runtime = &runtime
	for name, value := range map[string]any{
		"migration": state, "nil-migration": (*ConsensusMigrationState)(nil),
		"runtime": runtime, "runtime-pointer": &runtime, "snapshot": snapshot,
		"migration-runtime": withRuntime, "zero": ConsensusMigrationState{},
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
				var actual bytes.Buffer
				if err := writeCanonicalStateJSON(&actual, value, pretty); err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(actual.Bytes(), expected) {
					t.Fatalf("pretty=%v canonical bytes differ\nactual: %s\nexpected: %s", pretty, actual.Bytes(), expected)
				}
				if sha256.Sum256(actual.Bytes()) != sha256.Sum256(expected) {
					t.Fatal("canonical state hash preimage changed")
				}
			}
		})
	}
}

func TestCanonicalStateJSONStreamsLongHistory(t *testing.T) {
	snapshot := devnetSnapshot{Blocks: make([]Block, 10000)}
	for i := range snapshot.Blocks {
		snapshot.Blocks[i] = Block{Height: uint64(i), Hash: "original-block-hash", ParentHash: "original-parent-hash", Transactions: []Transaction{}}
	}
	for _, pretty := range []bool{false, true} {
		var expected []byte
		var err error
		if pretty {
			expected, err = json.MarshalIndent(snapshot, "", "  ")
		} else {
			expected, err = json.Marshal(snapshot)
		}
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.New()
		out := &canonicalStateChunkWriter{writer: digest}
		if err := writeCanonicalStateJSON(out, snapshot, pretty); err != nil {
			t.Fatal(err)
		}
		want := sha256.Sum256(expected)
		if out.bytes != len(expected) || !bytes.Equal(digest.Sum(nil), want[:]) {
			t.Fatal("streamed long history differs from original complete encoding")
		}
		if out.max > 64*1024 || out.calls < 10 {
			t.Fatalf("history was not emitted as bounded chunks: calls=%d max=%d", out.calls, out.max)
		}
	}
}

func TestCanonicalStateJSONPreservesWriteAndEncodingFailures(t *testing.T) {
	if err := writeCanonicalStateJSON(canonicalStateShortWriter{}, devnetSnapshot{}, true); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("short write not preserved: %v", err)
	}
	want := errors.New("original writer failure")
	if err := writeCanonicalStateJSON(canonicalStateErrorWriter{want}, devnetSnapshot{}, false); !errors.Is(err, want) {
		t.Fatalf("original write error not preserved: %v", err)
	}
	badTime := devnetSnapshot{SavedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}
	if err := writeCanonicalStateJSON(io.Discard, badTime, false); err == nil {
		t.Fatal("custom time marshaler error was ignored")
	}
	if err := writeCanonicalStateJSON(nil, devnetSnapshot{}, false); err == nil {
		t.Fatal("nil writer accepted")
	}
}

func TestCanonicalStateJSONPublicWriterValidatesBeforeWriting(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	expected, err := state.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := state.WriteCanonicalJSON(&out); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(expected, out.Bytes()) {
		t.Fatal("public writer changed the canonical migration document")
	}
	state.StateHash = "invalid"
	out.Reset()
	if err := state.WriteCanonicalJSON(&out); err == nil || out.Len() != 0 {
		t.Fatalf("invalid state wrote output: err=%v bytes=%d", err, out.Len())
	}
}

type canonicalStateChunkWriter struct {
	writer io.Writer
	bytes  int
	calls  int
	max    int
}

func (w *canonicalStateChunkWriter) Write(p []byte) (int, error) {
	w.calls++
	if len(p) > w.max {
		w.max = len(p)
	}
	n, err := w.writer.Write(p)
	w.bytes += n
	return n, err
}

type canonicalStateShortWriter struct{}

func (canonicalStateShortWriter) Write(p []byte) (int, error) { return len(p) - 1, nil }

type canonicalStateErrorWriter struct{ err error }

func (w canonicalStateErrorWriter) Write([]byte) (int, error) { return 0, w.err }
