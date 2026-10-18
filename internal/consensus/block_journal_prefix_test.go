package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	abci "github.com/cometbft/cometbft/abci/types"
	"os"
	"sync"
	"testing"
	"time"
)

type prefixGateObservedContext struct {
	context.Context
	reached chan struct{}
	once    sync.Once
}

func (c *prefixGateObservedContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.reached) })
	return c.Context.Done()
}

func TestBlockJournalPrefixReusesOnlyValidatedBytesAndPreservesRotation(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	reused, fallback := 0, 0
	for nonce := uint64(1); nonce <= 18; nonce++ {
		raw := journalTransfer(t, nonce)
		req := &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0), Txs: [][]byte{raw, raw, []byte("invalid-envelope")}}
		response, e := app.FinalizeBlock(context.Background(), req)
		if e != nil || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce || response.TxResults[2].Code == 0 {
			t.Fatal("real signed fixture execution changed", e)
		}
		if _, e = app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
		data, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		full, e := DecodeBlockJournal(context.Background(), data, migration)
		if e != nil {
			t.Fatal(e)
		}
		got, e := d.Decode(context.Background(), data)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(full.SnapshotJSON, got.SnapshotJSON) || full.CompleteBytes != got.CompleteBytes || full.IncompleteTail != got.IncompleteTail || !journalStateEqual(t, full.State, got.State) {
			t.Fatal("prefix result differs from complete original replay")
		}
		if got.ReusedPrefixBytes > 0 {
			reused++
			if got.ReplayedBlocks != 1 || got.ReplayedTransactionInputs != 3 {
				t.Fatalf("old signed history re-executed: blocks=%d inputs=%d", got.ReplayedBlocks, got.ReplayedTransactionInputs)
			}
		} else {
			fallback++
		}
		// Returned mutable slices/JSON cannot change the next cached-state result.
		got.State.Accounts[0].Balance++
		got.SnapshotJSON[0] ^= 1
		again, e := d.Decode(context.Background(), data)
		if e != nil || again.ReusedPrefixBytes == 0 || again.ReplayedBlocks != 0 || again.ReplayedTransactionInputs != 0 || !bytes.Equal(again.SnapshotJSON, full.SnapshotJSON) {
			t.Fatal("identical prefix was replayed or caller changed cache", e)
		}
	}
	if reused < 15 || fallback < 2 {
		t.Fatal("append reuse/rotation fallback not exercised", reused, fallback)
	}
	finalBytes, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	restarted, e := NewBlockJournalPrefixDecoder(migration)
	if e != nil {
		t.Fatal(e)
	}
	cold, e := restarted.Decode(context.Background(), finalBytes)
	if e != nil || cold.ReusedPrefixBytes != 0 {
		t.Fatal("restart retained an unvalidated prefix", e)
	}
	restored, err := NewBlockJournaledApplication(migration, path)
	if err != nil || !journalStateEqual(t, app.committed, restored.committed) {
		t.Fatal("actual restart differs", err)
	}
}

func TestBlockJournalPrefixTamperIncompleteTailAndFirstErrors(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	appendBlock := func(n uint64) []byte {
		t.Helper()
		raw := journalTransfer(t, n)
		if _, e := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(n), Time: time.Unix(1802736000+int64(n), 0), Txs: [][]byte{raw}}); e != nil {
			t.Fatal(e)
		}
		if _, e := app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
		b, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	first := appendBlock(1)
	if _, err = d.Decode(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	baseEnd := d.prefix.end
	second := appendBlock(2)
	check := func(input []byte) {
		t.Helper()
		full, e1 := DecodeBlockJournal(context.Background(), input, migration)
		got, e2 := d.Decode(context.Background(), input)
		if (e1 == nil) != (e2 == nil) || (e1 != nil && e1.Error() != e2.Error()) {
			t.Fatalf("original first error changed: full=%v candidate=%v", e1, e2)
		}
		if e1 == nil && (!bytes.Equal(full.SnapshotJSON, got.SnapshotJSON) || full.CompleteBytes != got.CompleteBytes || full.IncompleteTail != got.IncompleteTail) {
			t.Fatal("partial/truncated input produced stale state")
		}
	}
	badPrefix := append([]byte(nil), second...)
	badPrefix[len(blockJournalMagic)] ^= 1
	check(badPrefix)
	badFrame := append([]byte(nil), second...)
	badFrame[len(badFrame)-1] ^= 1
	check(badFrame)
	payload, _, _, e := readBlockJournalFrame(bytes.NewReader(second[baseEnd:]))
	if e != nil {
		t.Fatal(e)
	}
	var record blockJournalRecord
	if e = decodeStrictJSON(payload, &record); e != nil {
		t.Fatal(e)
	}
	record.ResponseHash = "not-the-original-response"
	encoded, e := json.Marshal(record)
	if e != nil {
		t.Fatal(e)
	}
	badResponse := append(append([]byte(nil), second[:baseEnd]...), blockJournalFrame(encoded)...)
	badResponse = append(badResponse, encoded...)
	check(badResponse)
	if d.prefix.height != int64(migration.Height)+1 {
		t.Fatal("failed suffix published cache success")
	}
	check(second[:len(second)-2])
	check(second)
	check(first)
	// Old captures cannot displace the latest validated prefix.
	if d.prefix.height != int64(migration.Height)+2 {
		t.Fatal("older capture displaced current certified state")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := d.Decode(ctx, second); !errors.Is(e, context.Canceled) {
		t.Fatal("cancelled replay returned success", e)
	}
}

func TestBlockJournalPrefixCancellationBoundAndIndependentResults(t *testing.T) {
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
	d, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	<-d.gate
	ctx, cancel := context.WithCancel(context.Background())
	observed := &prefixGateObservedContext{Context: ctx, reached: make(chan struct{})}
	done := make(chan error, 1)
	go func() { _, e := d.Decode(observed, data); done <- e }()
	select {
	case <-observed.reached:
	case <-time.After(time.Second):
		cancel()
		d.gate <- struct{}{}
		t.Fatal("decoder never reached cancellable gate wait")
	}
	cancel()
	select {
	case e := <-done:
		if !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("gate wait ignored cancellation")
	}
	d.gate <- struct{}{}
	if d.prefix != nil {
		t.Fatal("cancelled work cached state")
	}
	if _, err = d.Decode(context.Background(), make([]byte, blockJournalPrefixLimit+1)); err == nil {
		t.Fatal("explicit input cap raised")
	}
	var wg sync.WaitGroup
	outputs := make(chan BlockJournalPrefixReadback, 4)
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); v, e := d.Decode(context.Background(), data); outputs <- v; errs <- e }()
	}
	wg.Wait()
	close(outputs)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	states := []CommittedState{}
	for v := range outputs {
		for _, previous := range states {
			if &previous.Accounts[0] == &v.State.Accounts[0] {
				t.Fatal("concurrent callers share mutable accounts")
			}
		}
		states = append(states, v.State)
	}
}

func TestBlockJournalPrefixRevalidatesPrivateCachedState(t *testing.T) {
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
	d, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Decode(context.Background(), data); err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err = decodeStrictJSON(d.prefix.payload, &state); err != nil {
		t.Fatal(err)
	}
	state.Accounts[0].Balance++
	d.prefix.payload, err = encodeCommittedStateJSON(state)
	if err != nil {
		t.Fatal(err)
	}
	if out, e := d.Decode(context.Background(), data); e == nil || out.State.Version != 0 {
		t.Fatal("corrupted private state accepted or success leaked", e)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(data, after) {
		t.Fatal("failed private validation changed original journal", err)
	}
	restarted, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	out, err := restarted.Decode(context.Background(), data)
	if err != nil || out.ReusedPrefixBytes != 0 {
		t.Fatal("restart failed original full recovery", err)
	}
}
