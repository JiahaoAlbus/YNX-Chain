package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPrefixReplayOptionsAreExplicitExclusiveAndBounded(t *testing.T) {
	base := options{manifest: "manifest", transactions: "transactions", concurrency: 4, observers: 4, timeout: 10 * time.Second, poll: 100 * time.Millisecond, rounds: 1, senderMode: "rounds", inclusionMode: "block-scan", offeredRate: 1000, observerPhaseTiming: true, durableStoreByteLimit: durableSnapshotLimit}
	if err := validateOptions(base); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(report{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte(`"prefixDurableReplay"`)) {
		t.Fatal("new mode appears enabled in default report")
	}
	base.prefixDurableReplay = true
	if err = validateOptions(base); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"shared", "timing", "pace", "inclusion", "large", "cache", "rounds", "stream"} {
		o := base
		switch kind {
		case "shared":
			o.sharedDurableReplay = true
		case "timing":
			o.observerPhaseTiming = false
		case "pace":
			o.offeredRate = 0
		case "inclusion":
			o.inclusionMode = "tx-query"
		case "large":
			o.durableStoreByteLimit = 32 << 20
		case "cache":
			o.durableCacheByteBudget = 32 << 20
		case "rounds":
			o.rounds = 2
			o.output = "new-output"
		case "stream":
			o.streamingWorkload = true
		}
		e := validateOptions(o)
		if e == nil || !strings.Contains(e.Error(), "prefix replay") {
			t.Fatal("unsupported prefix option did not fail at its explicit guard", kind, e)
		}
	}
}

func TestPrefixReplayRealStoresPreserveCaptureBusinessAndWorkCounts(t *testing.T) {
	app, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(t.TempDir(), "other.blocks")
	secondApp, err := consensus.NewBlockJournaledApplication(migration, other)
	if err != nil {
		t.Fatal(err)
	}
	response, err := secondApp.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}})
	if err != nil || response.TxResults[0].Code != 0 {
		t.Fatal("second real signed store failed", err)
	}
	if _, err = secondApp.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(other)
	if err != nil || !bytes.Equal(b, data) {
		t.Fatal("original store fixture differs", err)
	}
	if err = os.Chmod(other, 0600); err != nil {
		t.Fatal(err)
	}
	r, err := newDurableReader(migration, []string{path, other})
	if err != nil {
		t.Fatal(err)
	}
	r.prefixDecoder, err = consensus.NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	a, err := r.verify(context.Background(), path, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	c, err := r.verify(context.Background(), other, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	stats := r.stats()
	p := stats.PrefixReplay
	if a.AppHash != c.AppHash || a.StoreSHA256 != c.StoreSHA256 || p == nil || p.Calls != 2 || p.FullReplays != 1 || p.PrefixReuses != 1 || p.Failures != 0 || p.DurationNs <= 0 || p.ReplayedBlocks != 1 || p.ReplayedTransactionInputs != 1 || stats.BytesHashed != uint64(2*len(data)) || stats.SnapshotValidations != 2 || stats.TransactionVerifications != 2 || stats.SharedReplay != nil || stats.ReplayNativeFacts.SuccessfulVerifications != 1 {
		t.Fatal("real capture/fee/nonce/crypto/work counters differ", stats)
	}
	p.FullReplays = 999
	if r.stats().PrefixReplay.FullReplays != 1 {
		t.Fatal("prefix stats snapshot aliases retained counters")
	}
	if &r.slots[path].state.Accounts[0] == &r.slots[other].state.Accounts[0] {
		t.Fatal("private state escaped across stores")
	}
	if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001, 0)}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	changed, err := r.verify(context.Background(), path, raw, height)
	if err != nil || changed.Height != height+1 || changed.StoreSHA256 == a.StoreSHA256 {
		t.Fatal("append returned stale state", changed, err)
	}
	p = r.stats().PrefixReplay
	if p.Calls != 3 || p.FullReplays != 1 || p.PrefixReuses != 2 || p.ReplayedBlocks != 2 || p.ReplayedTransactionInputs != 1 {
		t.Fatal("append counted old work again", p)
	}
	bad := append([]byte(nil), data...)
	bad[len(bad)-2] ^= 1
	if err = os.WriteFile(other, bad, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), other, raw, height); err == nil {
		t.Fatal("tampered store accepted")
	}
	if r.stats().PrefixReplay.Failures != 1 {
		t.Fatal("failed partial work lost or promoted")
	}
	if err = os.WriteFile(other, data, 0600); err != nil {
		t.Fatal(err)
	}
	badTx := append([]byte(nil), raw...)
	badTx[len(badTx)-4] ^= 1
	if _, err = r.verify(context.Background(), other, badTx, height); err == nil {
		t.Fatal("prefix mode skipped transaction signature/fee checks")
	}
}

func TestPrefixReplayPublicationQuorumAndExclusiveReaderRemainRequired(t *testing.T) {
	for _, mode := range []string{"valid", "stale_info", "bad_quorum"} {
		t.Run(mode, func(t *testing.T) {
			g, c, jobs := groupedObservationFixture(t)
			var err error
			g.reader.prefixDecoder, err = consensus.NewBlockJournalPrefixDecoder(g.reader.migration)
			if err != nil {
				t.Fatal(err)
			}
			for _, slot := range g.reader.slots {
				clearDurableCache(slot)
			}
			if mode == "stale_info" {
				c.info.Response.LastBlockHeight--
			}
			if mode == "bad_quorum" {
				c.commit.Commit.Signatures[0].Signature[0] ^= 1
			}
			g.step(context.Background(), jobs)
			for _, job := range jobs {
				confirmed := g.results[job.index].Status == "confirmed" && verifiedBusinessInclusion(g.results[job.index])
				if confirmed != (mode == "valid") {
					t.Fatal("prefix mode changed publication/quorum gate", mode, g.results[job.index])
				}
			}
		})
	}
	_, migration, path, _, _ := durableJournalFixture(t, "block-journal")
	r, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	r.prefixDecoder, err = consensus.NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	r.sharedReplay = &sharedReplayCache{}
	if _, err = r.decodeCurrentSnapshot(context.Background(), []byte("not-a-journal"), [32]byte{}); err == nil {
		t.Fatal("two backends silently combined")
	}
	r.sharedReplay = nil
	if _, err = r.decodePrefixSnapshot(context.Background(), []byte("not-a-journal")); err == nil || r.stats().PrefixReplay.Failures != 1 {
		t.Fatal("unsupported format did not fail closed", err)
	}
}
