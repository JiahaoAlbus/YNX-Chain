package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalPrefixSuffixReplayDetailsRealSignedHistoryAndFailures(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	control, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	appendBlock := func(nonce uint64) []byte {
		t.Helper()
		res, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 123).UTC(), Txs: [][]byte{journalTransfer(t, nonce)}})
		if err != nil || len(res.TxResults) != 1 || res.TxResults[0].Code != 0 {
			t.Fatal("signed execution", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	var aggregate BlockJournalPrefixWorkPhases
	var last BlockJournalPrefixReadback
	var latest, faultBase []byte
	for nonce := uint64(1); nonce <= 32; nonce++ {
		raw := appendBlock(nonce)
		latest = raw
		if nonce == 31 {
			faultBase = append([]byte(nil), raw...)
		}
		last, err = d.DecodeWithSuffixReplayPhaseTiming(context.Background(), raw)
		if err != nil {
			t.Fatal(err)
		}
		old, err := control.DecodeWithPhaseTiming(context.Background(), raw)
		if err != nil || !bytes.Equal(last.SnapshotJSON, old.SnapshotJSON) || !reflect.DeepEqual(last.State, old.State) {
			t.Fatal("timing changed replay", err)
		}
		if old.WorkPhases.SuffixReplayDetails != nil {
			t.Fatal("old timed API shape changed")
		}
		parts := last.WorkPhases.SuffixReplayDetails
		if parts == nil {
			t.Fatal("selected children missing")
		}
		if last.WorkPhases.SuffixReplay.Calls == 1 {
			if parts.ReadFrame.Calls != 2 || parts.CheckpointValidate.Calls != 0 {
				t.Fatal("suffix frame/EOF coverage differs")
			}
			var total int64
			for _, phase := range []BlockJournalPrefixPhase{parts.ReadFrame, parts.DecodeRecord, parts.DecodeRequest, parts.Finalize, parts.VerifyResponse, parts.MemoryCommit, parts.FinalValidate} {
				if phase.Calls == 0 || phase.Errors != 0 || phase.DurationNs <= 0 {
					t.Fatal("actual child absent", phase)
				}
				total += phase.DurationNs
			}
			if parts.Finalize.Calls != 1 || parts.MemoryCommit.Calls != 1 || parts.FinalValidate.Calls != 1 || total > last.WorkPhases.SuffixReplay.DurationNs {
				t.Fatal("child work/time coverage differs")
			}
		} else if *parts != (BlockJournalFrameReplayPhases{}) {
			t.Fatal("cold full replay mislabeled as suffix")
		}
		aggregate.Add(*last.WorkPhases)
	}
	if aggregate.SuffixReplay.Calls < 28 || aggregate.SuffixReplayDetails.Finalize.Calls != aggregate.SuffixReplay.Calls {
		t.Fatal("real suffix coverage missing")
	}
	expected := aggregate.SuffixReplayDetails.FinalValidate.Calls
	last.WorkPhases.SuffixReplayDetails.FinalValidate.Calls = 999
	if aggregate.SuffixReplayDetails.FinalValidate.Calls != expected {
		t.Fatal("aggregate aliases caller counters")
	}
	// Use the real31 ->32 append pair. The next real33 write compacts the
	// checkpoint and cannot be assumed to preserve the previous byte prefix.
	d, err = NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Decode(context.Background(), faultBase); err != nil {
		t.Fatal(err)
	}
	prior := d.prefix
	raw := latest
	if prior.end >= len(raw) || !bytes.Equal(raw[:prior.end], faultBase) {
		t.Fatal("fault fixture is not an actual append")
	}
	payload, _, _, err := readBlockJournalFrameLimit(bytes.NewReader(raw[prior.end:]), 2*blockJournalMaxRequest)
	if err != nil || payload == nil {
		t.Fatal(err)
	}
	for _, fault := range []string{"frame", "request", "response"} {
		var record blockJournalRecord
		if err := decodeStrictJSON(payload, &record); err != nil {
			t.Fatal(err)
		}
		switch fault {
		case "request":
			record.Request = []byte{0xff}
		case "response":
			record.ResponseHash = strings.Repeat("0", 64)
		}
		encoded, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		bad := append(append([]byte(nil), raw[:prior.end]...), blockJournalFrame(encoded)...)
		bad = append(bad, encoded...)
		if fault == "frame" {
			bad[len(bad)-1] ^= 1
		}
		got, err := d.DecodeWithSuffixReplayPhaseTiming(context.Background(), bad)
		_, originalErr := DecodeBlockJournal(context.Background(), bad, migration)
		if err == nil || originalErr == nil || err.Error() != originalErr.Error() || d.prefix != prior {
			t.Fatalf("%s changed failure/publication: %v / %v", fault, err, originalErr)
		}
		parts := got.WorkPhases.SuffixReplayDetails
		if got.WorkPhases.SuffixReplay.Errors != 1 || parts.MemoryCommit.Calls != 0 || parts.FinalValidate.Calls != 0 {
			t.Fatal("failed suffix published later work")
		}
		if fault == "frame" && parts.ReadFrame.Errors != 1 || fault == "request" && parts.DecodeRequest.Errors != 1 || fault == "response" && parts.VerifyResponse.Errors != 1 {
			t.Fatal("first failed stage absent", fault)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err := d.DecodeWithSuffixReplayPhaseTiming(ctx, raw)
	if err == nil || got.WorkPhases.SuffixReplayDetails.ReadFrame.Calls != 0 || d.prefix != prior {
		t.Fatal("cancelled decode performed suffix work")
	}
	encoded, err := json.Marshal(aggregate)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("REAL_SIGNED_SUFFIX_CHILDREN_32 %s", encoded)
}
