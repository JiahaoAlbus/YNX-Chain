package bftgateway

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// The existing real Application/handshake/BlockExecutor harness supplies the
// Whole, original result, validator signatures, inclusion and successor roots.
// Only the configured RPC transport is replaced; no public finality is claimed.
func wholeFinalityObservation(t *testing.T, e *pqActionFinalityEngine, height int64, index int) *pqFinalityFixture {
	t.Helper()
	block := e.blocks.LoadBlock(height)
	results, err := e.store.LoadFinalizeBlockResponse(height)
	if err != nil || block == nil || results == nil || index < 0 || index >= len(block.Data.Txs) || len(results.TxResults) != len(block.Data.Txs) || results.TxResults[index] == nil {
		t.Fatal("actual Whole transaction/result unavailable", err)
	}
	tx := block.Data.Txs[index]
	envelope, wire, err := consensus.DecodePQTransaction(tx)
	if err != nil || envelope.Type != consensus.PQWholeType {
		t.Fatal("actual Whole envelope unavailable", err)
	}
	copyFixture := *e.f
	copyFixture.wire, copyFixture.payload = wire, bytes.Clone(tx)
	v := &pqFinalityFixture{f: &copyFixture, statePath: e.path, bootstrap: e.boot, tx: coretypes.ResultTx{Hash: tx.Hash(), Height: height, Index: uint32(index), TxResult: *results.TxResults[index], Tx: tx, Proof: block.Data.Txs.Proof(index)}}
	v.results = coretypes.ResultBlockResults{Height: height, TxsResults: results.TxResults, FinalizeBlockEvents: results.Events, ValidatorUpdates: results.ValidatorUpdates, ConsensusParamUpdates: results.ConsensusParamUpdates, AppHash: results.AppHash}
	for i := range v.blocks {
		h := height + int64(i)
		b, commit := e.blocks.LoadBlock(h), e.blocks.LoadSeenCommit(h)
		if i == 0 {
			commit = e.blocks.LoadBlockCommit(h)
		}
		set, err := e.store.LoadValidators(h)
		if err != nil || b == nil || commit == nil || set == nil {
			t.Fatal("actual Whole H/H+1 material missing", err)
		}
		v.blocks[i] = *coretypes.NewResultCommit(&b.Header, commit, i == 0)
		v.validators[i] = coretypes.ResultValidators{BlockHeight: h, Validators: set.Validators, Count: len(set.Validators), Total: len(set.Validators)}
	}
	v.status.NodeInfo.Network = e.doc.ChainID
	v.status.SyncInfo = coretypes.SyncInfo{LatestBlockHeight: height + 1, EarliestBlockHeight: e.doc.InitialHeight, LatestBlockHash: v.blocks[1].Header.Hash(), EarliestBlockHash: e.blocks.LoadBlock(e.doc.InitialHeight).Hash()}
	return v
}

func wholeFinalityRoute(f *pqFinalityFixture) string {
	return "/txs/" + consensus.SignedTransactionHash(f.f.payload) + "/pq-finality-proof"
}

func assertWholeFinalityProof(t *testing.T, f *pqFinalityFixture, got PQFinalityView, outcome string) {
	t.Helper()
	if got.Status != "collected" || got.Source != "configured-comet-rpc" || got.ProofVerification != "not-performed" || got.IndependentFinality || got.ObservedExecutionStatus != outcome || got.NativeTransactionHash != consensus.SignedTransactionHash(f.f.wire) || got.ABCITransactionHash != consensus.SignedTransactionHash(f.f.payload) || got.NativeTransactionHash == got.ABCITransactionHash || got.CometIndex == nil || *got.CometIndex != f.tx.Index || got.ExecutionHeight != uint64(f.tx.Height) || got.Proof == nil {
		t.Fatalf("Whole original identity/outcome missing: %+v", got)
	}
	raw, err := json.Marshal(got.Proof)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := consensus.DecodePQTransactionProofRequest(raw)
	if err != nil {
		t.Fatal("normal compiled Whole proof decoder:", err)
	}
	var tx cmttypes.TxProof
	var result abci.ExecTxResult
	var resultProof merkle.Proof
	if cmtjson.Unmarshal(proof.TransactionProof, &tx) != nil || tx.Validate(f.blocks[0].DataHash) != nil || !bytes.Equal(tx.Data, f.f.payload) || result.Unmarshal(proof.ExecutionResult) != nil || cmtjson.Unmarshal(proof.ExecutionProof, &resultProof) != nil || resultProof.Verify(f.blocks[1].LastResultsHash, proof.ExecutionResult) != nil || tx.Proof.Index != int64(f.tx.Index) || resultProof.Index != tx.Proof.Index || resultProof.Total != tx.Proof.Total || result.Code != f.tx.TxResult.Code || !bytes.Equal(result.Data, f.tx.TxResult.Data) {
		t.Fatal("Whole proof changed actual inclusion or deterministic per-member result")
	}
	if len(result.Data) != 0 {
		var actual, retained consensus.PQBatchExecutionResult
		if json.Unmarshal(f.tx.TxResult.Data, &actual) != nil || json.Unmarshal(result.Data, &retained) != nil || !reflect.DeepEqual(actual, retained) || len(retained.Results) == 0 {
			t.Fatal("Whole member outcomes were lost or replaced by an ABCI success hash")
		}
	}
	// The normal verifier still needs independently supplied trust. Collected
	// RPC evidence never becomes a light checkpoint or a Native authorization.
	header := func(b coretypes.ResultCommit) consensus.PQLightProofExpectation {
		return consensus.PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: b.Header.Hash(), StateHeight: b.Height - 1, StateAppHash: b.AppHash}
	}
	native := sha256.Sum256(f.f.wire)
	expected := consensus.PQTransactionProofExpectation{Block: header(f.blocks[0]), Successor: header(f.blocks[1]), TransactionType: consensus.PQWholeType, Envelope: f.f.payload, NativeWire: f.f.wire, TransactionHash: f.tx.Tx.Hash(), NativeWireHash: native[:], Index: int64(f.tx.Index)}
	_, err = consensus.VerifyPQTransactionProof(consensus.PQLightProofTrust{}, expected, proof)
	var trustError *consensus.PQLightProofError
	if !errors.As(err, &trustError) || trustError.Code != "invalid_trust" {
		t.Fatal("Whole proof must stop at missing independent light trust", err)
	}
}

func newWholeFinalityMixedExecution(t *testing.T) (*pqActionFinalityEngine, int64) {
	t.Helper()
	f := newPQGatewayFixture(t)
	e := newPQActionFinalityEngine(t, f)
	// The actual imported account has already paid its source migration fee.
	// Measure this committed baseline, rather than assuming the Faucet's 100.
	ownerBefore := queryPQGatewayAccount(t, f.a, f.owner)
	recipientBefore := queryPQGatewayAccount(t, f.a, f.recipient)
	rejected := signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, [][]byte{f.message(t, 99, 1), f.message(t, 100, 1)})
	rejectedPayload, err := consensus.EncodePQTransaction(consensus.PQWholeType, rejected)
	if err != nil {
		t.Fatal(err)
	}
	invalidAND, err := ynxbatch.DecodeWhole(f.wire)
	if err != nil {
		t.Fatal(err)
	}
	invalidAND.Certificate.SigmaB[0] ^= 1
	invalidWire, err := ynxbatch.EncodeWhole(invalidAND)
	if err != nil {
		t.Fatal(err)
	}
	invalidPayload, err := consensus.EncodePQTransaction(consensus.PQWholeType, invalidWire)
	if err != nil {
		t.Fatal(err)
	}
	height, results := e.apply(t, []byte("invalid synthetic sibling"), f.payload, rejectedPayload, invalidPayload)
	if len(results.TxResults) != 4 || results.TxResults[0].Code == 0 || results.TxResults[1].Code != 0 || results.TxResults[2].Code == 0 || len(results.TxResults[2].Data) == 0 || results.TxResults[3].Code == 0 || len(results.TxResults[3].Data) != 0 {
		t.Fatal("actual mixed Whole outcomes differ", results)
	}
	var partial consensus.PQBatchExecutionResult
	if json.Unmarshal(results.TxResults[1].Data, &partial) != nil || len(partial.Results) != 4 || partial.Results[0].Outcome != "admitted" || partial.Results[1].Outcome != "rejected" || partial.Results[2].Outcome != "admitted" || partial.Results[3].Outcome != "rejected" {
		t.Fatal("actual fixture did not preserve legal partial Whole")
	}
	ownerAfter := queryPQGatewayAccount(t, f.a, f.owner)
	recipientAfter := queryPQGatewayAccount(t, f.a, f.recipient)
	expectedUsage := ownerBefore.ResourceUsage
	expectedUsage.BandwidthUsed += 2
	if ownerAfter.Balance != ownerBefore.Balance-13 || ownerAfter.Nonce != ownerBefore.Nonce+2 || ownerAfter.ResourceUsage != expectedUsage || ownerAfter.Staked != ownerBefore.Staked || recipientAfter.Balance != recipientBefore.Balance+11 || recipientAfter.Nonce != recipientBefore.Nonce || recipientAfter.ResourceUsage != recipientBefore.ResourceUsage {
		t.Fatal("actual partial transfer/fees/nonce differ or rejected Whole charged effects", ownerBefore, ownerAfter, recipientBefore, recipientAfter)
	}
	var moved int64
	for id, before := range ownerBefore.Lots {
		delta := before - ownerAfter.Lots[id]
		moved += delta
		if recipientAfter.Lots[id]-recipientBefore.Lots[id] != delta {
			t.Fatal("actual partial Whole lot movement differs from original transfer")
		}
	}
	if moved != 11 {
		t.Fatal("rejected Whole or transfer fees consumed original trace lots")
	}
	e.apply(t)
	if !reflect.DeepEqual(ownerAfter, queryPQGatewayAccount(t, f.a, f.owner)) || !reflect.DeepEqual(recipientAfter, queryPQGatewayAccount(t, f.a, f.recipient)) {
		t.Fatal("empty successor changed original Whole business effects")
	}
	return e, height
}

func TestGatewayPQWholeFinalityActualPartialRejectedAndColdRead(t *testing.T) {
	e, height := newWholeFinalityMixedExecution(t)
	account := queryPQGatewayAccount(t, e.f.a, e.f.owner)
	recipient := queryPQGatewayAccount(t, e.f.a, e.f.recipient)
	disk, err := os.ReadFile(e.path)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		index   int
		outcome string
	}{{1, "partial"}, {2, "rejected"}, {3, "rejected"}} {
		f := wholeFinalityObservation(t, e, height, test.index)
		g := actionFinalityGateway(t, f)
		code, original := finalityRouteGET(t, g, wholeFinalityRoute(f))
		if code != http.StatusOK {
			t.Fatalf("normal Whole collector: %d %s", code, original.Error)
		}
		assertWholeFinalityProof(t, f, original, test.outcome)
		if test.outcome == "rejected" {
			for _, request := range f.requests {
				if strings.HasPrefix(request, "/abci_query") {
					t.Fatal("rejected Whole required nonexistent committed batch/account history")
				}
			}
		} else {
			batch, policy := false, false
			for _, request := range f.requests {
				batch = batch || strings.Contains(request, "pq-batches")
				policy = policy || strings.Contains(request, "account-policy")
			}
			if !batch || !policy {
				t.Fatal("partial Whole bypassed committed original or account authorization")
			}
		}
		f.f.a, err = consensus.NewPersistentApplicationWithBootstrap(e.f.migration, e.path, e.boot)
		if err != nil {
			t.Fatal(err)
		}
		if code, cold := finalityRouteGET(t, g, wholeFinalityRoute(f)); code != http.StatusOK || !reflect.DeepEqual(cold, original) || !reflect.DeepEqual(account, queryPQGatewayAccount(t, f.f.a, e.f.owner)) || !reflect.DeepEqual(recipient, queryPQGatewayAccount(t, f.f.a, e.f.recipient)) {
			t.Fatal("cold Whole read changed original proof/account", code, cold.Error)
		}
	}
	finalDisk, err := os.ReadFile(e.path)
	if err != nil || !bytes.Equal(disk, finalDisk) {
		t.Fatal("Whole readback wrote persisted state", err)
	}
	// The all-admitted profile uses the same route and retains one Comet index,
	// even though the native batch contains two independently executed members.
	wire := signGatewayWhole(t, e.f.key, e.f.network, e.f.owner, ynxauth.TransactionPurpose, [][]byte{e.f.message(t, account.Nonce+1, 1), e.f.message(t, account.Nonce+2, 2)})
	payload, err := consensus.EncodePQTransaction(consensus.PQWholeType, wire)
	if err != nil {
		t.Fatal(err)
	}
	nextHeight, results := e.apply(t, payload)
	if len(results.TxResults) != 1 || results.TxResults[0].Code != 0 {
		t.Fatal("actual all-admitted Whole failed", results)
	}
	e.apply(t)
	f := wholeFinalityObservation(t, e, nextHeight, 0)
	if code, got := finalityRouteGET(t, actionFinalityGateway(t, f), wholeFinalityRoute(f)); code != http.StatusOK {
		t.Fatal("all-admitted Whole unavailable", code, got.Error)
	} else {
		assertWholeFinalityProof(t, f, got, "committed")
	}
}

func TestGatewayPQWholeFinalityRejectsChangedEvidenceAndWaitsForSuccessor(t *testing.T) {
	e, height := newWholeFinalityMixedExecution(t)
	f := wholeFinalityObservation(t, e, height, 1)
	g := actionFinalityGateway(t, f)
	route := wholeFinalityRoute(f)
	disk, err := os.ReadFile(e.path)
	if err != nil {
		t.Fatal(err)
	}
	type mutation func(*consensus.PQBatchExecutionResult)
	for name, change := range map[string]mutation{
		"wrong-height": func(result *consensus.PQBatchExecutionResult) { result.ExecutionHeight++ },
		"reordered-members": func(result *consensus.PQBatchExecutionResult) {
			result.Results[0], result.Results[1] = result.Results[1], result.Results[0]
		},
		"rejected-effect": func(result *consensus.PQBatchExecutionResult) {
			result.Results[1].TransactionHash = result.Results[0].TransactionHash
		},
		"wrong-member-hash": func(result *consensus.PQBatchExecutionResult) {
			result.Results[0].TransactionHash = result.ABCITransactionHash
		},
		"oversized-error": func(result *consensus.PQBatchExecutionResult) { result.Results[1].Error = strings.Repeat("x", 257) },
	} {
		t.Run(name, func(t *testing.T) {
			f.mutate = func(path string, raw []byte) []byte {
				if path != "/tx" {
					return raw
				}
				var tx coretypes.ResultTx
				var result consensus.PQBatchExecutionResult
				if cmtjson.Unmarshal(raw, &tx) != nil || json.Unmarshal(tx.TxResult.Data, &result) != nil {
					t.Error("actual indexed Whole fixture unavailable")
					return nil
				}
				change(&result)
				data, err := json.Marshal(result)
				if err != nil {
					t.Error(err)
					return nil
				}
				tx.TxResult.Data = data
				b, err := cmtjson.Marshal(&tx)
				if err != nil {
					t.Error(err)
					return nil
				}
				return b
			}
			if code, got := finalityRouteGET(t, g, route); code != http.StatusBadGateway || got.Proof != nil || got.IndependentFinality {
				t.Fatal("changed Whole outcomes produced a proof", code, got.Error)
			}
		})
	}
	for _, endpoint := range []string{"/abci_query", "account-policy", "/block_results"} {
		t.Run(endpoint, func(t *testing.T) {
			f.mutate = func(path string, raw []byte) []byte {
				if path != endpoint && !(endpoint == "account-policy" && path == "/abci_query") {
					return raw
				}
				if path == "/abci_query" {
					var query coretypes.ResultABCIQuery
					if cmtjson.Unmarshal(raw, &query) != nil {
						t.Error("actual Whole query unavailable")
						return nil
					}
					// Preserve the real batch response, then make only the normal
					// account-policy dependency unavailable for this counterexample.
					if endpoint == "account-policy" {
						var proof consensus.PQCommittedBatch
						if json.Unmarshal(query.Response.Value, &proof) == nil && len(proof.Whole) != 0 {
							return raw
						}
					}
					query.Response.Code = 1
					b, err := cmtjson.Marshal(&query)
					if err != nil {
						t.Error(err)
						return nil
					}
					return b
				}
				var results coretypes.ResultBlockResults
				if cmtjson.Unmarshal(raw, &results) != nil || len(results.TxsResults) <= int(f.tx.Index) {
					t.Error("actual Whole block results unavailable")
					return nil
				}
				results.TxsResults[f.tx.Index].Data = []byte(f.f.payload)
				b, err := cmtjson.Marshal(&results)
				if err != nil {
					t.Error(err)
					return nil
				}
				return b
			}
			if code, got := finalityRouteGET(t, g, route); code != http.StatusBadGateway || got.Proof != nil {
				t.Fatal("unavailable or inconsistent Whole source produced a proof", code, got.Error)
			}
		})
	}
	for _, test := range []struct {
		name  string
		index int
	}{{"same-partial-different-reason", 1}, {"empty-rejection-code-drift", 3}} {
		t.Run(test.name, func(t *testing.T) {
			original := wholeFinalityObservation(t, e, height, test.index)
			reads := 0
			original.mutate = func(path string, raw []byte) []byte {
				if path != "/tx" {
					return raw
				}
				reads++
				if reads == 1 {
					return raw
				}
				var tx coretypes.ResultTx
				if cmtjson.Unmarshal(raw, &tx) != nil {
					t.Error("actual indexed Whole drift fixture unavailable")
					return nil
				}
				if test.index == 3 {
					tx.TxResult.Code++ // Both reads still report rejected with no Data.
				} else {
					var result consensus.PQBatchExecutionResult
					if json.Unmarshal(tx.TxResult.Data, &result) != nil || len(result.Results) != 4 {
						t.Error("actual partial result unavailable")
						return nil
					}
					result.Results[1].Error = "a different canonical rejection reason"
					data, err := json.Marshal(result)
					if err != nil {
						t.Error(err)
						return nil
					}
					tx.TxResult.Data = data // Still the same admitted/rejected count.
				}
				b, err := cmtjson.Marshal(&tx)
				if err != nil {
					t.Error(err)
					return nil
				}
				return b
			}
			code, got := finalityRouteGET(t, actionFinalityGateway(t, original), wholeFinalityRoute(original))
			if reads != 2 || code != http.StatusBadGateway || got.Proof != nil || got.Error != "finality Whole execution result differs from first indexed original" {
				t.Fatal("same-outcome Whole drift escaped the first-result comparison", reads, code, got.Error)
			}
			for _, request := range original.requests {
				if strings.HasPrefix(request, "/commit") || strings.HasPrefix(request, "/block_results") {
					t.Fatal("drifted indexed Whole reached block/proof collection")
				}
			}
		})
	}
	reads := 0
	f.mutate = func(path string, raw []byte) []byte {
		if path != "/tx" {
			return raw
		}
		reads++
		if reads == 1 {
			return raw
		}
		var tx coretypes.ResultTx
		var result consensus.PQBatchExecutionResult
		if cmtjson.Unmarshal(raw, &tx) != nil || json.Unmarshal(tx.TxResult.Data, &result) != nil {
			t.Error("actual Whole reread unavailable")
			return nil
		}
		for i := range result.Results {
			result.Results[i].Outcome, result.Results[i].Error = "admitted", ""
			hash, err := chain.PQBatchTransactionHash(result.BatchHash, uint32(i))
			if err != nil {
				t.Error(err)
				return nil
			}
			result.Results[i].TransactionHash = hash
		}
		data, err := json.Marshal(result)
		if err != nil {
			t.Error(err)
			return nil
		}
		tx.TxResult.Data = data
		b, err := cmtjson.Marshal(&tx)
		if err != nil {
			t.Error(err)
			return nil
		}
		return b
	}
	if code, got := finalityRouteGET(t, g, route); reads != 2 || code != http.StatusBadGateway || got.Proof != nil {
		t.Fatal("second indexed read changed partial into success", reads, code, got.Error)
	}
	f.mutate = nil
	f.status.SyncInfo.LatestBlockHeight, f.status.SyncInfo.LatestBlockHash = height, f.blocks[0].Header.Hash()
	if code, got := finalityRouteGET(t, g, route); code != http.StatusAccepted || got.Status != "pending" || got.ObservedExecutionStatus != "partial" || got.Proof != nil || got.IndependentFinality {
		t.Fatal("partial Whole claimed a result proof before successor commitment", code, got)
	}
	finalDisk, err := os.ReadFile(e.path)
	if err != nil || !bytes.Equal(disk, finalDisk) {
		t.Fatal("failed/pending Whole observations wrote original state", err)
	}
}
