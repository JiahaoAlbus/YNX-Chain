package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

func journalReaderFixture(t *testing.T) (*consensus.Application, chain.ConsensusMigrationState, string, cmttypes.Tx, int64) {
	return durableJournalFixture(t, "snapshot-journal")
}

func durableJournalFixture(t *testing.T, layout string) (*consensus.Application, chain.ConsensusMigrationState, string, cmttypes.Tx, int64) {
	t.Helper()
	_, migration, atomicPath, raw, height := durableReaderFixture(t)
	path := atomicPath + ".journal"
	constructor := consensus.NewJournaledApplication
	if layout == "block-journal" {
		constructor = consensus.NewBlockJournaledApplication
	}
	app, err := constructor(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	r, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}})
	if err != nil || r.TxResults[0].Code != 0 {
		t.Fatal("actual journal transfer failed", err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	return app, migration, path, raw, height
}

func TestJournalReaderDigestsCompactionTailAndLivePublishedGate(t *testing.T) {
	app, migration, path, raw, height := journalReaderFixture(t)
	r, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	for step := 0; step < 20; step++ {
		first, err := r.verify(context.Background(), path, raw, height)
		if err != nil {
			t.Fatal(err)
		}
		if first.StoreFormat != "snapshot-journal" || first.JournalIncompleteTail || first.SnapshotSHA256 == first.StoreSHA256 {
			t.Fatal("journal/store identities conflated")
		}
		stored, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		storeSum := sha256.Sum256(stored)
		decoded, err := consensus.DecodeSnapshotJournal(context.Background(), stored, migration)
		if err != nil {
			t.Fatal(err)
		}
		snapshotSum := sha256.Sum256(decoded.SnapshotJSON)
		if first.StoreSHA256 != hex.EncodeToString(storeSum[:]) || first.SnapshotSHA256 != hex.EncodeToString(snapshotSum[:]) || first.JournalCompleteBytes != len(stored) {
			t.Fatal("digest or complete-byte evidence incorrect")
		}
		second, err := r.verify(context.Background(), path, raw, height)
		if err != nil || !second.SnapshotCacheHit || second.SnapshotSHA256 != first.SnapshotSHA256 {
			t.Fatal("unchanged journal cache miss", err)
		}
		info, err := app.Info(context.Background(), &abci.RequestInfo{})
		if err != nil {
			t.Fatal(err)
		}
		if err := verifyJournalPublishedState(second, &coretypes.ResultABCIInfo{Response: *info}); err != nil {
			t.Fatal("actual post-Commit published view refused", err)
		}
		old := *info
		old.LastBlockHeight = first.Height - 1
		if !errors.Is(verifyJournalPublishedState(first, &coretypes.ResultABCIInfo{Response: old}), errDurableNotReady) {
			t.Fatal("visible but unpublished record promoted to final")
		}
		wrong := *info
		wrong.LastBlockAppHash = append([]byte(nil), info.LastBlockAppHash...)
		wrong.LastBlockAppHash[0] ^= 1
		if err := verifyJournalPublishedState(first, &coretypes.ResultABCIInfo{Response: wrong}); err == nil {
			t.Fatal("published hash mismatch accepted")
		}
		_, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: info.LastBlockHeight + 1, Time: time.Unix(1802736001+int64(step), 0)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	clean, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	prior, err := r.verify(context.Background(), path, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(append([]byte(nil), clean...), []byte("torn")...), 0o600); err != nil {
		t.Fatal(err)
	}
	tail, err := r.verify(context.Background(), path, raw, height)
	if err != nil || !tail.JournalIncompleteTail || tail.JournalCompleteBytes != len(clean) || tail.SnapshotSHA256 != prior.SnapshotSHA256 || tail.StoreSHA256 == prior.StoreSHA256 {
		t.Fatal("incomplete-tail evidence wrong", err)
	}
	before, _ := os.ReadFile(path)
	if !bytes.Equal(before, append(append([]byte(nil), clean...), []byte("torn")...)) {
		t.Fatal("readback changed tail evidence")
	}
	if _, err := r.verify(context.Background(), path, raw, height+999); !errors.Is(err, errDurableNotReady) {
		t.Fatal("insufficient journal height accepted")
	}
	if err := os.WriteFile(path, clean, 0o600); err != nil {
		t.Fatal(err)
	}
	clean[len(clean)-2] ^= 1
	if err := os.WriteFile(path, clean, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), path, raw, height); err == nil {
		t.Fatal("cached journal hid same-size payload corruption")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := r.verify(ctx, path, raw, height); !errors.Is(err, context.Canceled) {
		t.Fatal("journal cancellation ignored")
	}
}

func TestJournalFinalCountsAndSenderGateRequirePublishedView(t *testing.T) {
	raw := cmttypes.Tx("unit gate only; not business evidence")
	result := gateResult(raw, 2)
	result.DurableStoreFormat = "snapshot-journal"
	if summarize([]transactionResult{result}, 1).FinalSubmitted != 0 {
		t.Fatal("unpublished journal inflated final TPS")
	}
	if err := verifySenderRound([]cmttypes.Tx{raw}, []transactionResult{result}); err == nil {
		t.Fatal("next nonce admitted without published height")
	}
	result.DurableInfoVerified = true
	result.DurableInfoHeight = 2
	if summarize([]transactionResult{result}, 1).FinalSubmitted != 1 {
		t.Fatal("valid published gate not counted")
	}
	if err := verifySenderRound([]cmttypes.Tx{raw}, []transactionResult{result}); err != nil {
		t.Fatal(err)
	}
}
