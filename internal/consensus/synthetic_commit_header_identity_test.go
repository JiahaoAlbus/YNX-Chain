package consensus

import (
	"context"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestSyntheticCommitHeaderIdentityOverflowRefuses(t *testing.T) {
	newApp := func() *Application {
		return &Application{migration: chain.ConsensusMigrationState{Network: chain.NetworkConfig{ChainID: PQLabNativeChainID, Slug: "pq-lab-overflow"}}, statePath: "/synthetic-test-only"}
	}
	t.Run("epoch", func(t *testing.T) {
		a := newApp()
		a.syntheticHeaderCaptureEpoch = ^uint64(0)
		if err := a.SetSyntheticCommitHeaderCapture(true); err == nil || a.commitHeaderCapture != nil {
			t.Fatal("exhausted epoch was reused")
		}
	})
	t.Run("attempt", func(t *testing.T) {
		a := newApp()
		if err := a.SetSyntheticCommitHeaderCapture(true); err != nil {
			t.Fatal(err)
		}
		originalEpoch := a.commitHeaderCapture.epoch
		a.commitHeaderCapture.attempt = ^uint64(0) - 1
		a.commitHeaderCapture.latest = &syntheticCommitHeader{CaptureEpoch: originalEpoch, Attempt: a.commitHeaderCapture.attempt}
		a.pending = &CommittedState{}
		if _, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{}); err == nil {
			t.Fatal("pending block was overwritten")
		}
		if a.commitHeaderCapture.attempt != ^uint64(0) || a.commitHeaderCapture.exhausted || a.commitHeaderCapture.latest != nil {
			t.Fatal("last attempt was not handled conservatively")
		}
		if _, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{}); err == nil {
			t.Fatal("pending block was overwritten")
		}
		if !a.commitHeaderCapture.exhausted || a.commitHeaderCapture.attempt != ^uint64(0) {
			t.Fatal("attempt counter wrapped")
		}
		if _, ok := a.LastSyntheticCommitHeader(); ok {
			t.Fatal("exhausted capture exposed an observation")
		}
		if err := a.SetSyntheticCommitHeaderCapture(false); err != nil {
			t.Fatal(err)
		}
		a.pending = nil
		if err := a.SetSyntheticCommitHeaderCapture(true); err != nil {
			t.Fatal(err)
		}
		if a.commitHeaderCapture.epoch <= originalEpoch || a.commitHeaderCapture.attempt != 0 {
			t.Fatal("fresh epoch did not separate attempts")
		}
	})
}
