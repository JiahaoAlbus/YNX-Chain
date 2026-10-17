package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestConsensusMigrationRevocationPreservesGlobalHistoryAndWholeProof(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	whole := f.whole(t, f.batchTransfer(2, 1), f.batchTransfer(3, 1))
	result, err := f.d.SubmitPQBatch(whole)
	pqMust(t, err)
	if len(result.Results) != 2 || result.Results[0].Outcome != "admitted" || result.Results[1].Outcome != "admitted" {
		t.Fatal("migration fixture did not execute the genuine original Whole")
	}
	next, public, err := ynxbatch.KeyGen()
	pqMust(t, err)
	defer next.Destroy()
	// A pending rotation and its terminal decision share execution height 2.
	// The terminal proof binds both revisions while the current pair remains r1.
	_, _, err = f.d.SubmitAccountMigration(pqRevocationRotation(t, f, next, public, 4, 4))
	pqMust(t, err)
	_, _, err = f.d.SubmitAccountRevocation(pqRevocationWire(t, f, 5, 2, 2))
	pqMust(t, err)
	f.d.ProduceBlock()
	m, err := f.d.ExportConsensusMigrationState()
	pqMust(t, err)
	if m.AccountPolicy.Version != ynxauth.PolicyRevocationVersion || len(m.AccountPolicy.Records) != 2 || len(m.AccountPolicy.Revocations) != 1 || len(m.Runtime.PQBatches) != 1 || !reflect.DeepEqual(m.AccountPolicy, m.Runtime.AccountPolicy) {
		t.Fatal("migration omitted full global v2 history or original shared Whole")
	}
	if !bytes.Equal(whole, m.Runtime.PQBatches[result.BatchHash].Whole) || !reflect.DeepEqual(result.Results, m.Runtime.PQBatches[result.BatchHash].Results) || m.OriginalGenesisHash != f.d.blocks[0].Hash {
		t.Fatal("migration rewrote Whole bytes, business results or original genesis")
	}
	wire, err := m.CanonicalJSON()
	pqMust(t, err)
	var decoded ConsensusMigrationState
	pqMust(t, json.Unmarshal(wire, &decoded))
	pqMust(t, decoded.Validate())
	if !reflect.DeepEqual(decoded.AccountPolicy, m.AccountPolicy) || !reflect.DeepEqual(decoded.Runtime.PQBatches, m.Runtime.PQBatches) || decoded.StateHash != m.StateHash {
		t.Fatal("migration canonical roundtrip changed public history")
	}
	restored, err := decoded.RestoreSourceRuntime()
	pqMust(t, err)
	if !reflect.DeepEqual(restored.accountPolicy, f.d.accountPolicy) || !reflect.DeepEqual(restored.pqBatches, f.d.pqBatches) || !reflect.DeepEqual(restored.blocks, f.d.blocks) {
		t.Fatal("source runtime restoration erased terminal policy or original block/proof state")
	}
	// Full-state verification uses each batch's original height. The same proof
	// is no longer authority for a new transaction at the next current height.
	admission, err := authenticatePQBatch(whole, decoded.AccountPolicy, result.ExecutionHeight, decoded.Network.ChainID)
	pqMust(t, err)
	defer admission.verifier.Clear()
	for i := range result.Results {
		_, err = admission.transfer(uint32(i), result.ExecutionHeight)
		pqMust(t, err)
		if _, err = admission.transfer(uint32(i), result.ExecutionHeight+1); !errors.Is(err, ynxauth.ErrPolicy) {
			t.Fatal("imported Whole member bypassed current terminal registration")
		}
	}
	for _, block := range decoded.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Type == "account_migration" || tx.Type == "account_revocation" {
				pqMust(t, ValidateConsensusHistoricalPQTransaction(tx, decoded.AccountPolicy, block.Height, decoded.Network.ChainID))
			}
		}
	}
	if err := decoded.AccountPolicy.RequireLegacy(f.owner, decoded.Height+1); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatal("source migration turned terminal PQ policy back into classic authority")
	}
	for name, mutate := range map[string]func(*ConsensusMigrationState){
		"Whole omitted": func(s *ConsensusMigrationState) { delete(s.Runtime.PQBatches, result.BatchHash) },
		"Whole result rewritten": func(s *ConsensusMigrationState) {
			p := s.Runtime.PQBatches[result.BatchHash]
			p.Results[0].Outcome = "rejected"
			s.Runtime.PQBatches[result.BatchHash] = p
		},
		"tombstone removed from both views": func(s *ConsensusMigrationState) {
			s.AccountPolicy.Version, s.AccountPolicy.Revocations = ynxauth.PolicyVersion, nil
			s.Runtime.AccountPolicy = cloneAccountPolicy(s.AccountPolicy)
		},
		"tombstone moved after history": func(s *ConsensusMigrationState) {
			s.AccountPolicy.Revocations[0].RegisteredAt++
			s.AccountPolicy.Revocations[0].RevokedFrom++
			s.Runtime.AccountPolicy = cloneAccountPolicy(s.AccountPolicy)
		},
	} {
		t.Run(name, func(t *testing.T) {
			var bad ConsensusMigrationState
			pqMust(t, json.Unmarshal(wire, &bad))
			mutate(&bad)
			bad.StateHash, err = bad.calculateHash()
			pqMust(t, err)
			if err := bad.Validate(); err == nil {
				t.Fatal("rehashed migration accepted incomplete or rewritten authorization history")
			}
		})
	}
}
