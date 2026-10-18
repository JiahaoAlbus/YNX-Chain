package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func legacyCommittedStateJSON(state CommittedState) ([]byte, error) {
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(payload, '\n'), nil
}

func TestCommittedStateJSONPreservesSnapshotBytes(t *testing.T) {
	weird := "\x00<>&\"\\\n汉字\u2028\u2029" + string([]byte{0xff})
	for _, state := range []CommittedState{
		{},
		{Accounts: []chain.ConsensusAccount{}, FeeEvents: []BFTFeeEvent{}},
		{AppHash: weird, Accounts: []chain.ConsensusAccount{{Address: weird, Lots: map[string]int64{"z": -1, weird: 13, "a": 0}}}, FeeEvents: []BFTFeeEvent{{ID: weird, TxHash: strings.Repeat(weird, 256), RecordedAt: time.Date(2026, 10, 17, 4, 3, 2, 123, time.FixedZone("offset", 8*3600))}}},
	} {
		got, err := encodeCommittedStateJSON(state)
		if err != nil {
			t.Fatal(err)
		}
		want, err := legacyCommittedStateJSON(state)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatal("snapshot byte contract changed")
		}
		if _, err := encodeCommittedStateJSON(CommittedState{AppHash: "next snapshot"}); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatal("later encoding overwrote the prior owned payload")
		}
		var decoded CommittedState
		if err := json.Unmarshal(got, &decoded); err != nil {
			t.Fatal(err)
		}
	}
	invalid := CommittedState{FeeEvents: []BFTFeeEvent{{RecordedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}}}
	if _, err := legacyCommittedStateJSON(invalid); err == nil {
		t.Fatal("legacy invalid timestamp was accepted")
	}
	if payload, err := encodeCommittedStateJSON(invalid); err == nil || payload != nil {
		t.Fatal("candidate did not fail closed on encoding error")
	}
}

func TestCommittedStateJSONBufferRejectsFragments(t *testing.T) {
	var writer committedStateJSONBuffer
	if _, err := writer.Write([]byte(`{"height":1}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte(`{"height":2}`)); err == nil {
		t.Fatal("multiple encoder writes were silently combined")
	}
	var malformed committedStateJSONBuffer
	if _, err := malformed.Write([]byte(`{"height":`)); err == nil {
		t.Fatal("malformed encoder fragment accepted")
	}
}

var committedStateJSONSink []byte

func BenchmarkCommittedStateJSON(b *testing.B) {
	path := os.Getenv("YNX_CHAIN_ENCODING_STATE")
	if path == "" {
		b.Skip("set YNX_CHAIN_ENCODING_STATE to the isolated real 1024-transfer snapshot")
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		b.Fatal(err)
	}
	var state CommittedState
	if err := json.Unmarshal(payload, &state); err != nil {
		b.Fatal(err)
	}
	if len(state.FeeEvents) != 1024 {
		b.Fatal("requires real 1024-transfer snapshot")
	}
	for _, candidate := range []struct {
		name   string
		encode func(CommittedState) ([]byte, error)
	}{
		{"legacy", legacyCommittedStateJSON}, {"direct_indent", encodeCommittedStateJSON},
	} {
		b.Run(candidate.name, func(b *testing.B) {
			got, err := candidate.encode(state)
			if err != nil || !bytes.Equal(got, payload) {
				b.Fatal("fixture byte mismatch", err)
			}
			b.ReportAllocs()
			b.SetBytes(int64(len(payload)))
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				committedStateJSONSink, err = candidate.encode(state)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
