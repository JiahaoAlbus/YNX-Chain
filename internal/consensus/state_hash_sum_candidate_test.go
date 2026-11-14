package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type sumCandidateWriter struct {
	sum   [sha256.Size]byte
	wrote bool
}

func (w *sumCandidateWriter) Write(raw []byte) (int, error) {
	if w.wrote || len(raw) < 2 || raw[len(raw)-1] != '\n' {
		return 0, errors.New("invalid frame")
	}
	w.wrote = true
	w.sum = sha256.Sum256(raw[:len(raw)-1])
	return len(raw), nil
}
func sumCandidate(doc committedStateHashDocument) (string, error) {
	var w sumCandidateWriter
	if err := json.NewEncoder(&w).Encode(doc.wireValue()); err != nil {
		return "", err
	}
	if !w.wrote {
		return "", errors.New("no output")
	}
	return hex.EncodeToString(w.sum[:]), nil
}
func hashSumFixture(n int) committedStateHashDocument {
	state := CommittedState{Version: PQInvoiceLedgerStateVersion, ChainID: 123456, MigrationStateHash: strings.Repeat("a", 64)}
	for i := 0; i < n; i++ {
		state.Accounts = append(state.Accounts, chain.ConsensusAccount{Address: fmt.Sprintf("fixture_%06d", i), Balance: int64(i), Lots: map[string]int64{"lot_a": int64(i), "lot_b": 1}})
		state.FeeEvents = append(state.FeeEvents, BFTFeeEvent{ID: fmt.Sprintf("fee_%06d", i), TxHash: strings.Repeat("b", 64), Payer: fmt.Sprintf("fixture_%06d", i), RecordedAt: time.Unix(int64(i+1), 0).UTC(), AuditHash: strings.Repeat("c", 64)})
	}
	return state.hashDocument("YNX_ABCI_STATE_V19", state.Version)
}
func TestHashSumCandidateByteEquality(t *testing.T) {
	for _, n := range []int{0, 8, 1024} {
		doc := hashSumFixture(n)
		want, err := hashCommittedStateDocument(doc)
		if err != nil {
			t.Fatal(err)
		}
		got, err := sumCandidate(doc)
		if err != nil || got != want {
			t.Fatal("digest differs", n, err)
		}
	}
	doc := hashSumFixture(1)
	doc.FeeEvents[0].RecordedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
	_, a := hashCommittedStateDocument(doc)
	_, b := sumCandidate(doc)
	if a == nil || b == nil || a.Error() != b.Error() {
		t.Fatal("encoding failure differs", a, b)
	}
}

var hashSumSink string

func BenchmarkHashSumCandidateSynthetic(b *testing.B) {
	for _, n := range []int{8, 1024, 4096} {
		doc := hashSumFixture(n)
		want, err := hashCommittedStateDocument(doc)
		if err != nil {
			b.Fatal(err)
		}
		got, err := sumCandidate(doc)
		if err != nil || got != want {
			b.Fatal("digest mismatch", err)
		}
		for _, tc := range []struct {
			name string
			fn   func(committedStateHashDocument) (string, error)
		}{{"current", hashCommittedStateDocument}, {"sum256", sumCandidate}} {
			b.Run(fmt.Sprintf("events_%d/%s", n, tc.name), func(b *testing.B) {
				b.ReportAllocs()
				for i := 0; i < b.N; i++ {
					hashSumSink, err = tc.fn(doc)
					if err != nil {
						b.Fatal(err)
					}
				}
			})
		}
	}
}
