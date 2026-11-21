package consensus

import (
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func TestPQHistoryPolicyCallKeepsOriginalEarlyFailure(t *testing.T) {
	state := CommittedState{Version: 14, AccountPolicy: &ynxauth.State{Records: []ynxauth.Record{{PKA: make([]byte, 8<<20)}}}, PQHistory: []PQCommittedAuthorization{{}, {}}}
	for i := range state.PQHistory {
		state.PQHistory[i].Transaction.Memo = pqTransferMemo + strings.Repeat("0", 4)
	}
	var migration chain.ConsensusMigrationState
	original := validateConsensusPQStateWithCallCache(state, migration, nil, nil, chain.NewPQHistoryCertificateCache())
	candidate := validateConsensusPQStateWithCaches(state, migration, nil, nil, chain.NewPQHistoryCertificateCache())
	if original == nil || candidate == nil || original.Error() != candidate.Error() || original.Error() != "legacy ABCI state cannot carry or erase account policy" {
		t.Fatalf("original %v candidate %v", original, candidate)
	}
}
