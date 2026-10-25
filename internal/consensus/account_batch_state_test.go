package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func copyWholeCommittedState(t *testing.T, state CommittedState) CommittedState {
	t.Helper()
	var out CommittedState
	if err := json.Unmarshal(mustJSON(t, state), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestABCIWholeHistoryProofEffectsAndAppendOnlyCoverage(t *testing.T) {
	f := activeABCIWholeFixture(t)
	wire := abciWhole(t, f, f.transferMessage(t, false, 2, 2), f.transferMessage(t, false, 4, 2), f.transferMessage(t, false, 3, 2), f.transferMessage(t, false, 5, 2))
	hash := SignedTransactionHash(wire)
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQWholeType, wire))
	original := f.a.committed
	for name, mutate := range map[string]func(*CommittedState){
		"reordered members":     func(s *CommittedState) { s.PQHistory[1], s.PQHistory[2] = s.PQHistory[2], s.PQHistory[1] },
		"missing proof":         func(s *CommittedState) { delete(s.PQBatches, hash) },
		"wrong full wire":       func(s *CommittedState) { p := s.PQBatches[hash]; p.Whole[len(p.Whole)-1] ^= 1; s.PQBatches[hash] = p },
		"wrong outer hash":      func(s *CommittedState) { p := s.PQBatches[hash]; p.ABCITransactionHash = hash; s.PQBatches[hash] = p },
		"wrong original height": func(s *CommittedState) { p := s.PQBatches[hash]; p.Height++; s.PQBatches[hash] = p },
		"omitted reference":     func(s *CommittedState) { s.PQHistory = s.PQHistory[:1] },
		"duplicate reference":   func(s *CommittedState) { s.PQHistory = append(s.PQHistory, s.PQHistory[1]) },
		"unexecuted sponsor":    func(s *CommittedState) { s.PQHistory[1].Transaction.Sponsor = f.other },
		"unexecuted logs":       func(s *CommittedState) { s.PQHistory[1].Transaction.Logs = []chain.EVMLog{{Address: f.other}} },
		"unexecuted fee lots": func(s *CommittedState) {
			s.PQHistory[1].Transaction.LotFlows = []chain.LotFlow{{LotID: "forged", From: f.owner, To: f.other, Amount: 1}}
		},
		"missing native receipt": func(s *CommittedState) { s.NativeTransfers = nil },
		"forged native amount":   func(s *CommittedState) { s.NativeTransfers[0].Amount++ },
		"missing member fee":     func(s *CommittedState) { s.FeeEvents = s.FeeEvents[:1] },
		"wrong member fee": func(s *CommittedState) {
			for i := range s.FeeEvents {
				if s.FeeEvents[i].TxHash == s.NativeTransfers[0].TransactionHash {
					s.FeeEvents[i].Payer = f.other
				}
			}
		},
		"rejected acquires receipt": func(s *CommittedState) {
			p := s.PQBatches[hash]
			h, _ := chain.PQBatchTransactionHash(hash, 1)
			p.Results[1].TransactionHash = h
			s.PQBatches[hash] = p
		},
		"result count":         func(s *CommittedState) { p := s.PQBatches[hash]; p.Results = p.Results[:1]; s.PQBatches[hash] = p },
		"owner nonce rollback": func(s *CommittedState) { i, _ := accountIndex(s.Accounts, f.owner); s.Accounts[i].Nonce = 1 },
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyWholeCommittedState(t, original)
			mutate(&bad)
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if bad.Validate(f.m) == nil {
				t.Fatal("rehashed tampered Whole state accepted")
			}
		})
	}
	candidate := copyWholeCommittedState(t, original)
	p := candidate.PQBatches[hash]
	p.Results[1].Error = "changed rejection"
	candidate.PQBatches[hash] = p
	if validateConsensusPQContinuation(original, candidate) == nil {
		t.Fatal("existing original rejection result was mutable")
	}
	candidate = copyWholeCommittedState(t, original)
	delete(candidate.PQBatches, hash)
	if validateConsensusPQContinuation(original, candidate) == nil {
		t.Fatal("shared proof could be deleted")
	}
	cloned := f.a.cloneExecutionState()
	p = cloned.pqBatches[hash]
	p.Whole[0] ^= 1
	p.Results[0].Outcome = "rejected"
	cloned.pqBatches[hash] = p
	if !bytes.Equal(original.PQBatches[hash].Whole, wire) || original.PQBatches[hash].Results[0].Outcome != "admitted" {
		t.Fatal("execution clone aliases committed full proof/results")
	}
}

func TestABCIWholeRevocationKeepsHistoryAndRejectsCurrentOwner(t *testing.T) {
	f := activeABCIWholeFixture(t)
	wire := abciWhole(t, f, f.transferMessage(t, false, 2, 1), f.transferMessage(t, false, 3, 1))
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQWholeType, wire))
	history := cloneConsensusPQBatches(f.a.committed.PQBatches)
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 4, 4, 1)))
	if err := f.a.committed.Validate(f.m); err != nil {
		t.Fatal("future tombstone invalidated original Whole height", err)
	}
	nextWire := abciWhole(t, f, f.transferMessage(t, false, 5, 1))
	check, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: mustPQEnvelope(t, PQWholeType, nextWire)})
	if err != nil || check.Code == 0 {
		t.Fatal("terminal owner acquired new Whole authorization")
	}
	admission, err := authenticateConsensusBatch(wire, f.a.committed.AccountPolicy, 3, f.m.Network.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	defer admission.verifier.Clear()
	if _, err = admission.transfer(0); err != nil {
		t.Fatal("historical member lost original eligibility", err)
	}
	admission.height = 5
	if _, err = admission.transfer(1); err == nil {
		t.Fatal("verified Whole token bypassed per-member revocation resolution")
	}
	restarted, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !reflect.DeepEqual(restarted.committed.PQBatches, history) {
		t.Fatalf("revocation/restart lost old shared proofs: %v", err)
	}
}

func TestABCIWholeSourceMigrationNeverRetriesRejectedIndices(t *testing.T) {
	f := activeABCIWholeFixture(t)
	wire := abciWhole(t, f, f.transferMessage(t, false, 2, 1), f.transferMessage(t, false, 4, 1))
	result, err := f.d.SubmitPQBatch(wire)
	if err != nil || result.Results[0].Outcome != "admitted" || result.Results[1].Outcome != "rejected" {
		t.Fatalf("source fixture: %+v %v", result, err)
	}
	f.d.ProduceBlock()
	m, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewPersistentApplication(m, filepath.Join(t.TempDir(), "source-whole.json"))
	if err != nil {
		t.Fatal(err)
	}
	// Move the current nonce so the old rejected member would otherwise become
	// executable. The old Whole must remain one immutable source decision.
	fresh := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 3, 1))
	commitSponsorBlock(t, a, 4, time.Unix(4, 0).UTC(), fresh)
	before := mustJSON(t, a.committed)
	check, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: mustPQEnvelope(t, PQWholeType, wire)})
	if err != nil || check.Code == 0 || !bytes.Equal(before, mustJSON(t, a.committed)) {
		t.Fatal("imported rejected member was replayed under later nonce")
	}
	response, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: "/pq-batches/" + result.BatchHash})
	if err != nil || response.Code != 0 || !bytes.Equal(response.Value, mustJSON(t, m.Runtime.PQBatches[result.BatchHash])) {
		t.Fatal("source original Whole outcome no longer queryable")
	}
	if len(a.committed.PQBatches) != 0 || !reflect.DeepEqual(a.migration.Runtime.PQBatches, m.Runtime.PQBatches) {
		t.Fatal("source history was copied into newly executed batch state")
	}
}
