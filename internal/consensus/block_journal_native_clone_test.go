package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestBlockJournalPrefixNativeClonePreservesNilEmptyAndOwnsEveryMutableField(t *testing.T) {
	if nativeCloneType(reflect.TypeOf(struct{ Future *string }{})) || nativeCloneType(reflect.TypeOf(struct{ Lots map[string]int64 }{})) {
		t.Fatal("future mutable schema accepted without a copier")
	}
	state := CommittedState{Accounts: []chain.ConsensusAccount{{Lots: nil}, {Lots: map[string]int64{}}, {Lots: map[string]int64{"x": 9}}}, FeeEvents: []BFTFeeEvent{{ID: "fee", RecordedAt: time.Unix(1802736000, 0).UTC()}}}
	v := reflect.ValueOf(&state).Elem()
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		if f.Kind() == reflect.Slice && f.Len() == 0 {
			f.Set(reflect.MakeSlice(f.Type(), 0, 2))
		}
	}
	got, ok := cloneNativeCommittedState(state)
	if !ok || !reflect.DeepEqual(got, state) {
		t.Fatal("native clone changed fields/nil identity")
	}
	got.Accounts[2].Lots["x"] = 99
	got.Accounts[0].Nonce++
	got.FeeEvents[0].ID = "caller"
	if state.Accounts[2].Lots["x"] != 9 || state.Accounts[0].Nonce != 0 || state.FeeEvents[0].ID != "fee" {
		t.Fatal("caller changed original native history")
	}
	w := reflect.ValueOf(&got).Elem()
	for i := 0; i < w.NumField(); i++ {
		f := w.Field(i)
		if f.Kind() == reflect.Slice && f.Len() == 0 && !f.IsNil() && f.Cap() != 0 {
			t.Fatal("empty domain retained append capacity", w.Type().Field(i).Name)
		}
	}
	// Every other populated domain must fall back, including future slices.
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		name := v.Type().Field(i).Name
		if f.Kind() != reflect.Slice || name == "Accounts" || name == "FeeEvents" {
			continue
		}
		probe := state
		field := reflect.ValueOf(&probe).Elem().Field(i)
		field.Set(reflect.MakeSlice(field.Type(), 1, 1))
		if _, ok := cloneNativeCommittedState(probe); ok {
			t.Fatal("unsupported populated domain cloned", name)
		}
	}
}

func TestBlockJournalPrefixNativeClonePreservesSignedHistoryAndRejectsCorruption(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	control, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	for nonce := uint64(1); nonce <= 4; nonce++ {
		raw := journalTransfer(t, nonce)
		response, e := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0), Txs: [][]byte{raw, raw, []byte("invalid-envelope")}})
		if e != nil || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce || response.TxResults[2].Code == 0 {
			t.Fatal("signed/nonce/malformed outcomes changed", e)
		}
		if _, e = app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
		data, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		want, e := control.Decode(context.Background(), data)
		if e != nil {
			t.Fatal(e)
		}
		got, e := candidate.DecodeWithPhaseTiming(context.Background(), data)
		if e != nil || !bytes.Equal(got.SnapshotJSON, want.SnapshotJSON) || !journalStateEqual(t, got.State, want.State) {
			t.Fatal("new prefix changed canonical/business state", e)
		}
		if candidate.prefix.native == nil {
			t.Fatal("native fixture not cached")
		}
		got.State.Accounts[0].Balance++
		got.State.FeeEvents[0].AuditHash = "caller"
		got.SnapshotJSON[0] ^= 1
		again, e := candidate.DecodeWithPhaseTiming(context.Background(), data)
		if e != nil || !bytes.Equal(again.SnapshotJSON, want.SnapshotJSON) || !journalStateEqual(t, again.State, want.State) || again.WorkPhases.PrivateNativeClone == nil || again.WorkPhases.PrivateNativeClone.Calls != 1 || again.WorkPhases.PrivateJSON.Calls != 0 || again.WorkPhases.PrivateValidate.Calls != 1 || again.ReplayedTransactionInputs != 0 {
			t.Fatal("hot native copy skipped validation, shared state, or still parsed JSON", e)
		}
		// Corrupt retained fee history while preserving the certified identity:
		// original full semantic/hash validation must still reject it.
		candidate.prefix.native.FeeEvents[0].AuditHash = "corrupt"
		if out, e := candidate.Decode(context.Background(), data); e == nil || out.State.Version != 0 {
			t.Fatal("corrupt private fee history accepted")
		}
		candidate, err = NewBlockJournalNativeClonePrefixDecoder(migration)
		if err != nil {
			t.Fatal(err)
		}
		if _, e = candidate.Decode(context.Background(), data); e != nil {
			t.Fatal("original restart recovery changed", e)
		}
		candidate.prefix.payload[0] ^= 1
		if out, e := candidate.Decode(context.Background(), data); e == nil || out.State.Version != 0 {
			t.Fatal("corrupt canonical certificate accepted")
		}
		candidate, err = NewBlockJournalNativeClonePrefixDecoder(migration)
		if err != nil {
			t.Fatal(err)
		}
		if _, e = candidate.Decode(context.Background(), data); e != nil {
			t.Fatal(e)
		}
	}
	if candidate.VerificationStats().SuccessfulVerifications != control.VerificationStats().SuccessfulVerifications {
		t.Fatal("mathematical verification coverage changed")
	}
	// Opt-in does not add an empty field to historical control JSON.
	b, e := json.Marshal(BlockJournalPrefixWorkPhases{})
	if e != nil || bytes.Contains(b, []byte("privateNativeClone")) {
		t.Fatal("historical phase schema changed", e)
	}
}

func TestBlockJournalPrefixNativeCloneHotReuseEliminatesPrivateJSON(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 1, Time: time.Unix(1802736001, 0), Txs: [][]byte{journalTransfer(t, 1)}}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	first, err := d.Decode(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		out, e := d.DecodeWithPhaseTiming(context.Background(), data)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(out.SnapshotJSON, first.SnapshotJSON) || !journalStateEqual(t, out.State, first.State) || out.ReplayedBlocks != 0 {
			t.Fatal("hot state changed")
		}
		if out.WorkPhases.PrivateJSON.Calls != 0 {
			t.Fatalf("hot reuse still decoded canonical JSON: calls=%d ns=%d", out.WorkPhases.PrivateJSON.Calls, out.WorkPhases.PrivateJSON.DurationNs)
		}
		if out.WorkPhases.PrivateNativeClone == nil || out.WorkPhases.PrivateNativeClone.Calls != 1 || out.WorkPhases.PrivateValidate.Calls != 1 {
			t.Fatal("private clone/full validation coverage missing")
		}
	}
	var group sync.WaitGroup
	for i := 0; i < 4; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			out, e := d.DecodeWithPhaseTiming(context.Background(), data)
			if e != nil || !journalStateEqual(t, out.State, first.State) {
				t.Error("concurrent private snapshot changed", e)
				return
			}
			out.State.Accounts[0].Balance++
			out.State.FeeEvents[0].AuditHash = "private caller"
			out.SnapshotJSON[0] ^= 1
		}()
	}
	group.Wait()
	out, e := d.Decode(context.Background(), data)
	if e != nil || !journalStateEqual(t, out.State, first.State) || !bytes.Equal(out.SnapshotJSON, first.SnapshotJSON) {
		t.Fatal("parallel caller changed cache", e)
	}
}
