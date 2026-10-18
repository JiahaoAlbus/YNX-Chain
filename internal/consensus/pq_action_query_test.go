package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func actionHistoryQuery(t *testing.T, a *Application, hash string) PQActionHistoryView {
	t.Helper()
	r, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQActionHistoryPath + hash})
	var v PQActionHistoryView
	if err != nil || r.Code != 0 || strictPQActionJSON(r.Value, &v) != nil {
		t.Fatalf("actual action history query: %+v %v", r, err)
	}
	if _, _, err := ValidatePQActionHistoryView(v, r.Height); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestPQActionQueryCommittedOnlyOriginalHeightAndRestart(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	raw := pqABCIStake(t, f, false, 2, 2, 0)
	wire, _, err := DecodePQActionTransport(raw)
	if err != nil {
		t.Fatal(err)
	}
	hash := SignedTransactionHash(wire)
	before := mustJSON(t, f.a.committed)
	finalized, err := f.a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{raw}})
	if err != nil || finalized.TxResults[0].Code != 0 {
		t.Fatalf("Finalize: %+v %v", finalized, err)
	}
	r, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQActionHistoryPath + hash})
	if err != nil || r.Code == 0 || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("pending action escaped committed query")
	}
	if _, err = f.a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	first := actionHistoryQuery(t, f.a, hash)
	if !bytes.Equal(first.Transport, raw) || first.ABCITransactionHash != SignedTransactionHash(raw) || first.ExecutionHeight != 3 {
		t.Fatal("original identities changed")
	}
	pqABCIContractBlock(t, f.a, 4, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 3, 4, 1)))
	v := actionHistoryQuery(t, f.a, hash)
	if v.ExecutionHeight != 3 || v.Authorization.ExecutionHeight != 5 || v.Authorization.PQSigningEnabled || !bytes.Equal(v.History, first.History) || !bytes.Equal(v.Effects, first.Effects) {
		t.Fatal("future revocation reinterpreted lawful original history")
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(v, actionHistoryQuery(t, cold, hash)) {
		t.Fatal("cold restore changed original action evidence")
	}
	for _, req := range []*abcitypes.RequestQuery{
		{Path: PQActionHistoryPath + hash, Height: 3}, {Path: PQActionHistoryPath + hash, Height: -1},
		{Path: PQActionHistoryPath + hash, Prove: true}, {Path: PQActionHistoryPath + hash, Data: []byte{1}},
		{Path: PQActionHistoryPath + strings.ToUpper(hash)},
	} {
		r, err := cold.Query(context.Background(), req)
		if err != nil || r.Code == 0 {
			t.Fatalf("unsupported history query accepted: %+v", req)
		}
	}
	for name, mutate := range map[string]func(*PQActionHistoryView){
		"future event":   func(x *PQActionHistoryView) { x.ExecutionHeight = 5 },
		"outer identity": func(x *PQActionHistoryView) { x.ABCITransactionHash = SignedTransactionHash([]byte("other")) },
		"source import":  func(x *PQActionHistoryView) { x.Source = "source_import" },
		"query height":   func(x *PQActionHistoryView) { x.Authorization.CommittedHeight++ },
		"fee injection": func(x *PQActionHistoryView) {
			var tx chain.Transaction
			_ = json.Unmarshal(x.History, &tx)
			tx.Fee = 1
			x.History, _ = json.Marshal(tx)
		},
		"unsigned sponsor": func(x *PQActionHistoryView) {
			var tx chain.Transaction
			_ = json.Unmarshal(x.History, &tx)
			tx.Sponsor = f.other
			x.History, _ = json.Marshal(tx)
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := v
			mutate(&bad)
			if _, _, err := ValidatePQActionHistoryView(bad, 4); err == nil {
				t.Fatal("altered original evidence accepted")
			}
		})
	}
}

func TestPQActionQueryResourceRecordsAndDEXMathAreRecomputed(t *testing.T) {
	t.Run("resource", func(t *testing.T) {
		f := newABCIRevocationFixture(t)
		pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
		delegate := pqABCIResource(t, f, false, pqResourceDelegation(f, false, f.owner, 5, "query-provider"), 2, 0)
		rent := pqABCIResource(t, f, false, pqResourceRental(t, f, false, f.owner, 2, 1, "query-rent", 3), 3, 0)
		pqABCIContractBlock(t, f.a, 3, delegate, rent)
		wire, _, _ := DecodePQActionTransport(rent)
		v := actionHistoryQuery(t, f.a, SignedTransactionHash(wire))
		for _, mutate := range []func(*pqActionEffects){
			func(e *pqActionEffects) { e.Resource.Rental.PriceYNXT++ },
			func(e *pqActionEffects) { e.Resource.Quote.PriceYNXT++ },
			func(e *pqActionEffects) { e.Resource.Idempotency.RequestHash = strings.Repeat("0", 64) },
			func(e *pqActionEffects) { e.Resource.Income[0].Amount++ },
			func(e *pqActionEffects) { e.Resource.Event.BlockHeight++ },
		} {
			var e pqActionEffects
			_ = json.Unmarshal(v.Effects, &e)
			mutate(&e)
			bad := v
			bad.Effects, _ = json.Marshal(e)
			if _, _, err := ValidatePQActionHistoryView(bad, 3); err == nil {
				t.Fatal("changed resource effect accepted")
			}
		}
	})
	t.Run("dex", func(t *testing.T) {
		f := newABCIRevocationFixture(t)
		pqDexLifecycle(t, f)
		var v PQActionHistoryView
		for _, entry := range f.a.committed.PQHistory {
			if isPQDexHistory(entry.Transaction) {
				actual := actionHistoryQuery(t, f.a, entry.Transaction.Hash)
				if entry.Transaction.Type == ynxauth.ActionDexSwapExactInput {
					v = actual
				}
			}
		}
		if v.Transport == nil {
			t.Fatal("missing actual swap original")
		}
		for _, mutate := range []func(*pqActionEffects){
			func(e *pqActionEffects) { e.DEX.Event.Amount1++ },
			func(e *pqActionEffects) { e.DEX.Pools[0].Reserve0 *= 2 },
			func(e *pqActionEffects) { e.DEX.Event.NativeFlows[0].Amount++ },
			func(e *pqActionEffects) { e.Fee.GrossFeeYNXT++ },
			func(e *pqActionEffects) { e.FeeRecipient = f.other },
		} {
			var e pqActionEffects
			_ = json.Unmarshal(v.Effects, &e)
			mutate(&e)
			bad := v
			bad.Effects, _ = json.Marshal(e)
			if _, _, err := ValidatePQActionHistoryView(bad, 3); err == nil {
				t.Fatal("changed DEX math, flow or fee accepted")
			}
		}
	})
}

func TestPQActionQueryContractRuntimeAndSourceImportBoundary(t *testing.T) {
	t.Run("actual compiler and runtime", func(t *testing.T) {
		f := newABCIRevocationFixture(t)
		pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
		artifact, deployment := pqABCIContractDeploy(t, f, ynxauth.ContractCounterName)
		call := pqABCIContractCall(t, f, artifact, pqABCIContractData(artifact.Name, f.other, 4), 3)
		pqABCIContractBlock(t, f.a, 4, call)
		for _, raw := range [][]byte{deployment, call} {
			wire, _, _ := DecodePQActionTransport(raw)
			v := actionHistoryQuery(t, f.a, SignedTransactionHash(wire))
			var e pqActionEffects
			_ = json.Unmarshal(v.Effects, &e)
			e.Contract.OpcodeStepCount++
			bad := v
			bad.Effects, _ = json.Marshal(e)
			if _, _, err := ValidatePQActionHistoryView(bad, 4); err == nil {
				t.Fatal("fabricated runtime result accepted")
			}
		}
	})
	t.Run("source action has no Comet original", func(t *testing.T) {
		f := newABCIRevocationFixture(t)
		if _, _, err := f.d.SubmitAccountMigration(f.registration(t, false, 3)); err != nil {
			t.Fatal(err)
		}
		f.d.ProduceBlock()
		raw := pqABCIStake(t, f, false, 2, 2, 0)
		wire, _, _ := DecodePQActionTransport(raw)
		if _, _, err := f.d.SubmitPQAction(wire); err != nil {
			t.Fatal(err)
		}
		f.d.ProduceBlock()
		migration, err := f.d.ExportConsensusMigrationState()
		if err != nil {
			t.Fatal(err)
		}
		a, err := NewApplication(migration)
		if err != nil {
			t.Fatal(err)
		}
		r, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQActionHistoryPath + SignedTransactionHash(wire)})
		if err != nil || r.Code == 0 || len(r.Value) != 0 {
			t.Fatal("source-only action was assigned a fabricated Comet identity")
		}
	})
}
