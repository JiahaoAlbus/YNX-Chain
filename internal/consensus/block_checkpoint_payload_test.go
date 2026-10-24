package consensus

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestBlockCheckpointBorrowedPayloadPreservesMarshalBytesAndFrame(t *testing.T) {
	_, actual := retainedSealFixture(t)
	weird := "\x00<>&\"\\\n汉字\u2028\u2029" + string([]byte{0xff})
	states := []CommittedState{{}, actual, {Accounts: []chain.ConsensusAccount{{Address: weird, Lots: map[string]int64{"z": 2, "a": 1, weird: 9}}}, FeeEvents: []BFTFeeEvent{{ID: weird, RecordedAt: time.Date(2026, 10, 24, 1, 2, 3, 456, time.FixedZone("offset", 19800))}}}}
	for _, state := range states {
		want, err := encodeBlockCheckpoint(state)
		if err != nil {
			t.Fatal(err)
		}
		calls := 0
		var retained []byte
		err = visitBlockCheckpointPayload(state, func(payload []byte) error {
			calls++
			if !bytes.Equal(payload, want) || !bytes.Equal(blockJournalFrame(payload), blockJournalFrame(want)) {
				t.Fatal("checkpoint payload/frame bytes changed")
			}
			retained = append([]byte(nil), payload...)
			return nil
		})
		if err != nil || calls != 1 {
			t.Fatal("checkpoint visitor failed or repeated", err, calls)
		}
		if err = visitBlockCheckpointPayload(CommittedState{Height: 123}, func([]byte) error { return nil }); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(retained, want) {
			t.Fatal("later encoding changed owned checkpoint copy")
		}
	}
	invalid := CommittedState{FeeEvents: []BFTFeeEvent{{RecordedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}}}
	_, before := encodeBlockCheckpoint(invalid)
	called := false
	after := visitBlockCheckpointPayload(invalid, func([]byte) error { called = true; return nil })
	if before == nil || after == nil || before.Error() != after.Error() || called {
		t.Fatal("encoding error changed or visitor ran before encoding succeeded", before, after)
	}
	expected := errors.New("controlled checkpoint sink failure")
	if err := visitBlockCheckpointPayload(actual, func([]byte) error { return expected }); !errors.Is(err, expected) {
		t.Fatal("sink first cause lost", err)
	}
}

func TestBlockCheckpointBorrowedDurableFileAndFaultBoundaries(t *testing.T) {
	migration, state := retainedSealFixture(t)
	for _, failAt := range []string{"", "compaction_synced", "compaction_renamed"} {
		t.Run("boundary_"+failAt, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.journal")
			journal, _, err := openBlockJournal(path, migration)
			if err != nil {
				t.Fatal(err)
			}
			expected := errors.New("controlled original boundary failure")
			var seen []string
			journal.io.fault = func(stage string) error {
				seen = append(seen, stage)
				if stage == failAt {
					return expected
				}
				return nil
			}
			err = journal.replaceCheckpoint(state, migration)
			if failAt != "" {
				if !errors.Is(err, expected) || !journal.io.poisoned {
					t.Fatal("checkpoint error/uncertain writer changed", err)
				}
				if err = journal.replaceCheckpoint(state, migration); err == nil {
					t.Fatal("uncertain writer reused without reopen")
				}
				if _, _, err = openBlockJournal(path, migration); err != nil {
					t.Fatal("original boundary recovery failed", err)
				}
				return
			}
			if err != nil || !reflect.DeepEqual(seen, []string{"compaction_synced", "compaction_renamed"}) {
				t.Fatal("original boundary order changed", seen, err)
			}
			payload, err := encodeBlockCheckpoint(state)
			if err != nil {
				t.Fatal(err)
			}
			want := append([]byte(blockJournalMagic+migration.StateHash+"\n"), blockJournalFrame(payload)...)
			want = append(want, payload...)
			got, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(got, want) {
				t.Fatal("actual durable file differs from original Marshal/frame", err)
			}
			_, reopened, err := openBlockJournal(path, migration)
			if err != nil || !journalStateEqual(t, reopened, state) {
				t.Fatal("durable checkpoint recovery changed", err)
			}
		})
	}
}

func TestBlockCheckpointBorrowedWriterRejectsFramingAndRepeat(t *testing.T) {
	for _, payload := range []string{"", "\n", "{}"} {
		w := blockCheckpointPayloadWriter{visit: func([]byte) error { t.Fatal("bad framing reached visitor"); return nil }}
		if _, err := w.Write([]byte(payload)); err == nil {
			t.Fatal("bad framing accepted")
		}
	}
	calls := 0
	w := blockCheckpointPayloadWriter{visit: func([]byte) error { calls++; return nil }}
	if n, err := w.Write([]byte("{}\n")); n != 3 || err != nil {
		t.Fatal("valid framing refused", n, err)
	}
	if _, err := w.Write([]byte("{}\n")); err == nil || calls != 1 {
		t.Fatal("second write repeated persistence")
	}
}

var checkpointPayloadSumSink [sha256.Size]byte

func BenchmarkBlockCheckpointPayloadActualHistory(b *testing.B) {
	_, state := retainedSealFixture(b)
	payload, err := encodeBlockCheckpoint(state)
	if err != nil {
		b.Fatal(err)
	}
	want := sha256.Sum256(payload)
	for index, borrow := range []bool{false, true, true, false, false, true} {
		name := "original_marshal_copy"
		if borrow {
			name = "borrowed_encoder_buffer"
		}
		b.Run(fmt.Sprintf("%02d_%s", index, name), func(b *testing.B) {
			encode := func() error {
				if borrow {
					return visitBlockCheckpointPayload(state, func(p []byte) error { checkpointPayloadSumSink = sha256.Sum256(p); return nil })
				}
				p, err := encodeBlockCheckpoint(state)
				if err == nil {
					checkpointPayloadSumSink = sha256.Sum256(p)
				}
				return err
			}
			if err := encode(); err != nil || checkpointPayloadSumSink != want {
				b.Fatal("complete checkpoint bytes/hash changed", err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if err := encode(); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
