package consensus

import (
	"bytes"
	"context"
	abci "github.com/cometbft/cometbft/abci/types"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestBlockJournalPreparedPrefixCombinedTimingRealSignedStateAndCancellation(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	control, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	var last BlockJournalPrefixReadback
	for nonce := uint64(1); nonce <= 3; nonce++ {
		response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 123).UTC(), Txs: [][]byte{journalTransfer(t, nonce)}})
		if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
			t.Fatal("real signed execution differs", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		last, err = candidate.DecodeWithCertificateAndSuffixReplayPhaseTiming(context.Background(), raw)
		if err != nil {
			t.Fatal(err)
		}
		old, err := control.DecodeWithCertificatePhaseTiming(context.Background(), raw)
		if err != nil || !bytes.Equal(old.SnapshotJSON, last.SnapshotJSON) || !reflect.DeepEqual(old.State, last.State) {
			t.Fatal("combined clocks changed canonical state", err)
		}
		if old.WorkPhases.SuffixReplayDetails != nil || last.WorkPhases.SuffixReplayDetails == nil || last.WorkPhases.CertificatePublishDetails == nil || last.WorkPhases.PreparedEncodeDetails == nil {
			t.Fatal("selected or original timing shape differs")
		}
		parts := last.WorkPhases.SuffixReplayDetails
		if nonce == 1 {
			if *parts != (BlockJournalFrameReplayPhases{}) {
				t.Fatal("cold replay mislabeled as suffix")
			}
		} else {
			if parts.Finalize.Calls != 1 || parts.FinalizeDetails == nil || parts.FinalizeDetails.TransactionDetails.NativeFeeEventAppend.Calls != 1 || parts.FinalValidate.Calls != 1 || parts.Finalize.DurationNs <= 0 || parts.Finalize.DurationNs > last.WorkPhases.SuffixReplay.DurationNs {
				t.Fatal("actual suffix/fee/validate child coverage differs")
			}
			if last.WorkPhases.CertificatePublishDetails.PreparedNativeAccepted != 1 || last.WorkPhases.PreparedEncodeDetails.JSONEncode.Calls != 1 {
				t.Fatal("actual prepared normalization/encoding coverage differs")
			}
		}
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	failed, err := candidate.DecodeWithCertificateAndSuffixReplayPhaseTiming(cancelled, []byte("not a journal"))
	if err == nil || failed.WorkPhases == nil || failed.WorkPhases.SuffixReplayDetails.Finalize.Calls != 0 || failed.WorkPhases.CertificatePublish.Calls != 0 {
		t.Fatal("cancelled decode performed replay/publication")
	}
	if last.WorkPhases.SuffixReplayDetails.Finalize.Calls != 1 {
		t.Fatal("later call mutated previous timing result")
	}
}
