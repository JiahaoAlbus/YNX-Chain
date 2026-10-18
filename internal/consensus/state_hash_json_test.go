package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func legacyHashDocument(doc committedStateHashDocument) (string, error) {
	raw, err := json.Marshal(doc)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func TestStateHashJSONMatchesLegacyCanonicalDocument(t *testing.T) {
	weird := "\x00<>&\"\\\n汉字\u2028\u2029" + string([]byte{0xff})
	states := []CommittedState{
		{},
		{Accounts: []chain.ConsensusAccount{}, FeeEvents: []BFTFeeEvent{}},
		{MigrationStateHash: weird, Accounts: []chain.ConsensusAccount{{Address: weird, Lots: map[string]int64{"z": -1, "a": 0, weird: 13}}}, FeeEvents: []BFTFeeEvent{{ID: weird, TxHash: strings.Repeat(weird, 256), RecordedAt: time.Date(2026, 10, 17, 4, 3, 2, 123, time.FixedZone("offset", 8*3600))}}},
	}
	for _, state := range states {
		// Historical versions are still used when loading/migrating old state.
		for _, version := range []int{1, 8, 9, 10, 11, 12, 13} {
			domain := "YNX_ABCI_STATE_V" + strconv.Itoa(version)
			doc := state.hashDocument(domain, version)
			want, err := legacyHashDocument(doc)
			if err != nil {
				t.Fatal(err)
			}
			got, err := state.calculateHashFor(domain, version)
			if err != nil || got != want {
				t.Fatal("canonical hash bytes changed", version, err)
			}
			if _, err := hashCommittedStateDocument(CommittedState{MigrationStateHash: "later"}.hashDocument(domain, version)); err != nil {
				t.Fatal(err)
			}
			again, err := state.calculateHashFor(domain, version)
			if err != nil || again != want {
				t.Fatal("later encoding changed earlier state")
			}
		}
	}
	invalid := CommittedState{FeeEvents: []BFTFeeEvent{{RecordedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}}}.hashDocument("YNX_ABCI_STATE_V13", 13)
	if _, err := legacyHashDocument(invalid); err == nil {
		t.Fatal("invalid timestamp accepted by legacy")
	}
	if got, err := hashCommittedStateDocument(invalid); err == nil || got != "" {
		t.Fatal("encoding error produced a state hash")
	}
}

func TestStateHashWriterRejectsUnexpectedEncoderFraming(t *testing.T) {
	for _, raw := range []string{"", "\n", "{}", "{}\n"} {
		var writer committedStateHashWriter
		n, err := writer.Write([]byte(raw))
		if raw != "{}\n" {
			if err == nil {
				t.Fatal("invalid framing accepted")
			}
			continue
		}
		if err != nil || n != len(raw) {
			t.Fatal("valid encoder framing refused", err)
		}
		want := sha256.Sum256([]byte("{}"))
		if hex.EncodeToString(writer.digest.Sum(nil)) != hex.EncodeToString(want[:]) {
			t.Fatal("encoder newline entered canonical hash")
		}
		if _, err := writer.Write([]byte("{}\n")); err == nil {
			t.Fatal("multiple encoded fragments accepted")
		}
	}
}

var stateHashSink string

func BenchmarkCommittedStateHashJSON(b *testing.B) {
	path := os.Getenv("YNX_CHAIN_ENCODING_STATE")
	if path == "" {
		b.Skip("requires retained real 1024-transfer snapshot")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		b.Fatal(err)
	}
	var state CommittedState
	if err := json.Unmarshal(raw, &state); err != nil {
		b.Fatal(err)
	}
	if len(state.FeeEvents) != 1024 {
		b.Fatal("requires actual 1024-transfer history")
	}
	doc := state.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion)
	want, err := legacyHashDocument(doc)
	if err != nil || want != state.AppHash {
		b.Fatal("retained real snapshot canonical hash mismatch", err)
	}
	for _, candidate := range []struct {
		name string
		hash func(committedStateHashDocument) (string, error)
	}{{"legacy_marshal", legacyHashDocument}, {"original_borrowed_encoder", hashSingleBufferDocument}, {"fee_chunked_encoder", hashCommittedStateDocument}} {
		b.Run(candidate.name, func(b *testing.B) {
			got, err := candidate.hash(doc)
			if err != nil || got != want {
				b.Fatal("hash differs", err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				stateHashSink, err = candidate.hash(doc)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
