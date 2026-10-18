package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func abciWhole(t *testing.T, f *abciRevocationFixture, messages ...[]byte) []byte {
	t.Helper()
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	wire, err := batch.WholeWire()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func activeABCIWholeFixture(t *testing.T) *abciRevocationFixture {
	t.Helper()
	f := newABCIRevocationFixture(t)
	registration := f.registration(t, false, 3)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, registration))
	// Drive the actual source ledger to the identical account-policy boundary.
	if _, _, err := f.d.SubmitAccountMigration(registration); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	return f
}

func batchCandidateJSON(t *testing.T, s executionState) []byte {
	t.Helper()
	return mustJSON(t, struct {
		Accounts []chain.ConsensusAccount
		Lots     map[string]chain.TrustTraceLot
		Policy   *ynxauth.State
		History  []PQCommittedAuthorization
		Batches  map[string]PQCommittedBatch
		Receipts []BFTNativeTransfer
		Fees     []BFTFeeEvent
	}{cloneExecutionAccounts(s), s.traceLots, s.accountPolicy, s.pqHistory, s.pqBatches, s.nativeTransfers, s.feeEvents.events()})
}

func TestABCIWholePartialExecutionMatchesSourceAndProposalIsolation(t *testing.T) {
	f := activeABCIWholeFixture(t)
	wire := abciWhole(t, f,
		f.transferMessage(t, false, 2, 7),
		f.transferMessage(t, false, 3, 999), // balance rejection must not consume nonce
		f.transferMessage(t, false, 3, 4),
		f.transferMessage(t, false, 5, 1), // nonce rejection stays frozen
	)
	payload := mustPQEnvelope(t, PQWholeType, wire)
	before := mustJSON(t, f.a.committed)
	ownerBefore := queryConsensusAccount(t, f.a, f.owner)
	sourceBefore := make(map[string]chain.Account)
	targetBefore := make(map[string]chain.ConsensusAccount)
	for _, address := range []string{f.owner, f.other, f.a.feeRecipient} {
		sourceBefore[address], _ = f.d.Account(address)
		targetBefore[address] = queryConsensusAccount(t, f.a, address)
	}
	ctx := context.Background()
	check, err := f.a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || check.Code != 0 {
		t.Fatalf("Whole CheckTx: %+v %v", check, err)
	}
	var result PQBatchExecutionResult
	if err = json.Unmarshal(check.Data, &result); err != nil {
		t.Fatal(err)
	}
	if result.ABCITransactionHash != SignedTransactionHash(payload) || result.BatchHash != SignedTransactionHash(wire) || result.ABCITransactionHash == result.BatchHash || len(result.Results) != 4 {
		t.Fatal("Whole identities/result count conflated")
	}
	for i, expected := range []string{"admitted", "rejected", "admitted", "rejected"} {
		if result.Results[i].Index != uint32(i) || result.Results[i].Outcome != expected {
			t.Fatalf("wrong partial outcomes: %+v", result.Results)
		}
	}
	prepared, err := f.a.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{payload, payload}, MaxTxBytes: math.MaxInt64})
	if err != nil || len(prepared.Txs) != 1 {
		t.Fatalf("Whole replay was selected twice: %+v %v", prepared, err)
	}
	processed, err := f.a.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{payload}})
	if err != nil || processed.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("Whole proposal: %+v %v", processed, err)
	}
	duplicate, err := f.a.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{payload, payload}})
	if err != nil || duplicate.Status != abcitypes.ResponseProcessProposal_REJECT || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("proposal leaked state or accepted duplicate Whole")
	}
	source, err := f.d.SubmitPQBatch(wire)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range source.Results {
		if r.Index != result.Results[i].Index || r.Outcome != result.Results[i].Outcome || r.TransactionHash != result.Results[i].TransactionHash {
			t.Fatalf("source and ABCI partial semantics differ at %d", i)
		}
	}
	finalized, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{payload}})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
		t.Fatalf("Whole finalize: %+v %v", finalized, err)
	}
	if !bytes.Equal(finalized.TxResults[0].Data, check.Data) {
		t.Fatal("Whole result changed between deterministic check and finalize")
	}
	if _, err = f.a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	owner := queryConsensusAccount(t, f.a, f.owner)
	if owner.Balance != ownerBefore.Balance-13 || owner.Nonce != 3 || owner.ResourceUsage.BandwidthUsed != ownerBefore.ResourceUsage.BandwidthUsed+2 {
		t.Fatal("Whole charged failed members or lost successful effects")
	}
	for _, address := range []string{f.owner, f.other, f.a.feeRecipient} {
		sourceAccount, ok := f.d.Account(address)
		targetAccount := queryConsensusAccount(t, f.a, address)
		if !ok || sourceAccount.Balance != targetAccount.Balance || sourceAccount.Nonce != targetAccount.Nonce {
			t.Fatalf("source/target transfer balance or nonce differs: %s", address)
		}
		if sourceAccount.ResourceUsage.BandwidthUsed-sourceBefore[address].ResourceUsage.BandwidthUsed != targetAccount.ResourceUsage.BandwidthUsed-targetBefore[address].ResourceUsage.BandwidthUsed {
			t.Fatalf("Whole bandwidth delta differs: %s", address)
		}
		// Compare this operation's lot delta. Existing source registration moved a
		// fee lot, whereas the existing ABCI registration semantics did not;
		// this Whole change must not rewrite either historical registration.
		lotIDs := map[string]bool{}
		for id := range sourceAccount.Lots {
			lotIDs[id] = true
		}
		for id := range targetAccount.Lots {
			lotIDs[id] = true
		}
		for id := range lotIDs {
			sourceDelta := sourceAccount.Lots[id] - sourceBefore[address].Lots[id]
			targetDelta := targetAccount.Lots[id] - targetBefore[address].Lots[id]
			if sourceDelta != targetDelta {
				t.Fatalf("Whole amount-only lot movement differs at %s/%s", address, id)
			}
		}
	}
	proof := f.a.committed.PQBatches[result.BatchHash]
	if !bytes.Equal(proof.Whole, wire) || proof.ABCITransactionHash != result.ABCITransactionHash || !reflect.DeepEqual(proof.Results, result.Results) {
		t.Fatal("original shared proof/results changed")
	}
	if len(f.a.committed.NativeTransfers) != 2 || len(f.a.committed.PQHistory) != 3 {
		t.Fatal("not exactly two native member effects and original registration")
	}
	for _, r := range result.Results {
		expected, _ := chain.PQBatchTransactionHash(result.BatchHash, r.Index)
		if r.Outcome == "admitted" && (r.TransactionHash != expected || r.TransactionHash == result.ABCITransactionHash) {
			t.Fatal("native member hash was replaced by outer hash")
		}
	}
	replay, err := f.a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || replay.Code == 0 {
		t.Fatal("committed Whole re-executed a formerly rejected member")
	}
	query, err := f.a.Query(ctx, &abcitypes.RequestQuery{Path: "/pq-batches/" + result.BatchHash})
	if err != nil || query.Code != 0 || !bytes.Equal(query.Value, mustJSON(t, proof)) {
		t.Fatal("read-only original partial result not queryable")
	}
	restarted, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, f.a.committed), mustJSON(t, restarted.committed)) {
		t.Fatalf("Whole restart differs: %v", err)
	}
}

func TestABCIWholeRejectsEitherSignatureRootsAndNoAdmissionAtomically(t *testing.T) {
	f := activeABCIWholeFixture(t)
	wire := abciWhole(t, f, f.transferMessage(t, false, 2, 1), f.transferMessage(t, false, 3, 1))
	for _, name := range []string{"signature A", "signature B", "reordered messages"} {
		t.Run(name, func(t *testing.T) {
			whole, err := ynxbatch.DecodeWhole(wire)
			if err != nil {
				t.Fatal(err)
			}
			switch name {
			case "signature A":
				whole.Certificate.SigmaA[0] ^= 1
			case "signature B":
				whole.Certificate.SigmaB[0] ^= 1
			default:
				whole.Messages[0], whole.Messages[1] = whole.Messages[1], whole.Messages[0]
			}
			bad, err := ynxbatch.EncodeWhole(whole)
			if err != nil {
				t.Fatal(err)
			}
			candidate := f.a.cloneExecutionState()
			before := batchCandidateJSON(t, candidate)
			if _, _, err = f.a.applyTransaction(candidate, mustPQEnvelope(t, PQWholeType, bad), 3, time.Unix(3, 0).UTC()); err == nil {
				t.Fatal("broken full proof accepted")
			}
			if !bytes.Equal(before, batchCandidateJSON(t, candidate)) {
				t.Fatal("failed Whole mutated original candidate")
			}
		})
	}
	rejected := mustPQEnvelope(t, PQWholeType, abciWhole(t, f, f.transferMessage(t, false, 9, 1), f.transferMessage(t, false, 10, 1)))
	before := mustJSON(t, f.a.committed)
	out, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: rejected})
	if err != nil || out.Code == 0 || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("all rejected Whole stored proof or charged effects")
	}
	var rejectedResult PQBatchExecutionResult
	if err := json.Unmarshal(out.Data, &rejectedResult); err != nil || len(rejectedResult.Results) != 2 || rejectedResult.Results[0].Outcome != "rejected" || rejectedResult.Results[1].Outcome != "rejected" {
		t.Fatal("all-rejected response lost per-index business outcomes")
	}
	good := mustPQEnvelope(t, PQWholeType, wire)
	selected, err := f.a.PrepareProposal(context.Background(), &abcitypes.RequestPrepareProposal{Height: 3, Time: time.Unix(3, 0).UTC(), MaxTxBytes: math.MaxInt64, Txs: [][]byte{rejected, good}})
	if err != nil || len(selected.Txs) != 1 || !bytes.Equal(selected.Txs[0], good) {
		t.Fatal("failed Whole polluted next proposal candidate")
	}
}

func TestABCIWholeCandidateRollbackAndTransferOverflow(t *testing.T) {
	f := activeABCIWholeFixture(t)
	wire := abciWhole(t, f, f.transferMessage(t, false, 2, 2), f.transferMessage(t, false, 2, 1))
	payload := mustPQEnvelope(t, PQWholeType, wire)
	candidate := f.a.cloneExecutionState()
	sender, _ := accountIndex(candidate.accounts, f.owner)
	recipient, _ := accountIndex(candidate.accounts, f.other)
	lots := sortedLotKeys(candidate.accounts[sender].Lots)
	candidate.accounts[sender].Lots = map[string]int64{lots[0]: 1}
	before := batchCandidateJSON(t, candidate)
	next, executed, err := f.a.applyTransaction(candidate, payload, 3, time.Unix(3, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	var result PQBatchExecutionResult
	if err = json.Unmarshal(executed.resultData, &result); err != nil {
		t.Fatal(err)
	}
	if result.Results[0].Outcome != "rejected" || result.Results[1].Outcome != "admitted" || next.accounts[sender].Nonce != 2 || next.accounts[recipient].Lots[lots[0]] != candidate.accounts[recipient].Lots[lots[0]]+1 {
		t.Fatal("partially moved lots from failed member leaked into next member")
	}
	if !bytes.Equal(before, batchCandidateJSON(t, candidate)) {
		t.Fatal("successful Whole mutated caller candidate")
	}
	for _, mode := range []string{"recipient balance", "fee balance", "recipient lot"} {
		t.Run(mode, func(t *testing.T) {
			c := f.a.cloneExecutionState()
			si, _ := accountIndex(c.accounts, f.owner)
			ri, _ := accountIndex(c.accounts, f.other)
			fi, _ := accountIndex(c.accounts, f.a.feeRecipient)
			switch mode {
			case "recipient balance":
				c.accounts[ri].Balance = math.MaxInt64
			case "fee balance":
				c.accounts[fi].Balance = math.MaxInt64
			default:
				c.accounts[ri].Lots[sortedLotKeys(c.accounts[si].Lots)[0]] = math.MaxInt64
			}
			original := batchCandidateJSON(t, c)
			if _, _, err := f.a.applyTransaction(c, payload, 3, time.Unix(3, 0).UTC()); err == nil {
				t.Fatal("overflow admitted")
			}
			if !bytes.Equal(original, batchCandidateJSON(t, c)) {
				t.Fatal("overflow failure leaked state")
			}
		})
	}
	// Default devnet validator names are system accounts, not valid transfer
	// recipients. Use the existing canonical recipient for this isolated alias
	// execution case; the wire codec must continue rejecting system names.
	originalFeeRecipient := f.a.feeRecipient
	f.a.feeRecipient = f.other
	defer func() { f.a.feeRecipient = originalFeeRecipient }()
	message, err := (ynxauth.Transfer{ChainID: f.network, NativeChainID: uint64(f.m.Network.ChainID), From: f.owner, To: f.other, Amount: 2, Fee: 1, Nonce: 2}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	aliasPayload := mustPQEnvelope(t, PQWholeType, abciWhole(t, f, message))
	aliasState := f.a.cloneExecutionState()
	aliasBefore := batchCandidateJSON(t, aliasState)
	aliasNext, _, err := f.a.applyTransaction(aliasState, aliasPayload, 3, time.Unix(3, 0).UTC())
	if err != nil {
		t.Fatal("valid fee recipient alias rejected", err)
	}
	if aliasNext.accounts[recipient].Balance != aliasState.accounts[recipient].Balance+3 || aliasNext.accounts[sender].Balance != aliasState.accounts[sender].Balance-3 || aliasNext.accounts[sender].Nonce != 2 || aliasNext.accounts[recipient].Lots[lots[0]] != aliasState.accounts[recipient].Lots[lots[0]]+2 || !bytes.Equal(aliasBefore, batchCandidateJSON(t, aliasState)) {
		t.Fatal("fee recipient alias lost amount/fee/nonce/amount-only lots or mutated candidate")
	}
	aliasOverflow := f.a.cloneExecutionState()
	aliasOverflow.accounts[recipient].Balance = math.MaxInt64 - 2
	overflowBefore := batchCandidateJSON(t, aliasOverflow)
	if _, _, err := f.a.applyTransaction(aliasOverflow, aliasPayload, 3, time.Unix(3, 0).UTC()); err == nil || !bytes.Equal(overflowBefore, batchCandidateJSON(t, aliasOverflow)) {
		t.Fatal("combined alias amount+fee overflow accepted or leaked state")
	}
}

func TestABCIWholeCanonicalEnvelopeAndTypeSpecificBound(t *testing.T) {
	f := activeABCIWholeFixture(t)
	wire := abciWhole(t, f, f.transferMessage(t, false, 2, 1))
	payload := mustPQEnvelope(t, PQWholeType, wire)
	for _, bad := range [][]byte{append(bytes.Clone(payload), ' '), []byte(strings.Replace(string(payload), "\"version\":1", "\"version\":1,\"unknown\":true", 1)), []byte(strings.Replace(string(payload), "\"version\":1", "\"version\":1,\"version\":1", 1))} {
		if _, _, err := DecodePQTransaction(bad); err == nil {
			t.Fatal("noncanonical envelope accepted")
		}
	}
	if _, err := EncodePQTransaction(PQTransferType, make([]byte, ynxauth.MaxMigrationBytes+1)); err == nil {
		t.Fatal("Whole enlarged ordinary member bound")
	}
	if _, err := EncodePQTransaction(PQWholeType, make([]byte, chain.MaxPQBatchBytes+1)); err == nil {
		t.Fatal("Whole raw bound not enforced")
	}
	if _, err := TransactionEnvelopeType(payload); err != nil {
		t.Fatal(err)
	}
}

func TestABCIWholeAuthenticActionIsRejectedWithoutClassicFallback(t *testing.T) {
	f := activeABCIWholeFixture(t)
	body, err := ynxauth.EncodeActionPayload(ynxauth.ActionStake, ynxauth.StakePayload{Amount: 3})
	if err != nil {
		t.Fatal(err)
	}
	message, err := (ynxauth.Action{ChainID: f.network, NativeChainID: uint64(f.m.Network.ChainID), Owner: f.owner, Nonce: 2, Fee: 0, Kind: ynxauth.ActionStake, Payload: body}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	wire := abciWhole(t, f, message, f.transferMessage(t, false, 2, 1))
	admission, err := authenticateConsensusBatch(wire, f.a.committed.AccountPolicy, 3, f.m.Network.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	defer admission.verifier.Clear()
	checks := admission.verifier.Stats().SignatureChecks
	if checks != 2 {
		t.Fatalf("Whole did not verify exactly two independent signature branches: %d", checks)
	}
	if _, err = admission.transfer(0); err == nil {
		t.Fatal("native action became transfer authorization")
	}
	if _, err = admission.transfer(1); err != nil {
		t.Fatal(err)
	}
	if admission.verifier.Stats().SignatureChecks != checks {
		t.Fatal("member handling reverified full certificate signatures")
	}
	before := queryConsensusAccount(t, f.a, f.owner)
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQWholeType, wire))
	after := queryConsensusAccount(t, f.a, f.owner)
	results := f.a.committed.PQBatches[SignedTransactionHash(wire)].Results
	if results[0].Outcome != "rejected" || results[1].Outcome != "admitted" || before.Staked != after.Staked || after.Balance != before.Balance-2 || after.Nonce != 2 {
		t.Fatal("unsupported action acquired effect or consumed transfer nonce")
	}
	source, err := f.d.SubmitPQBatch(wire)
	if err != nil || source.Results[0].Outcome != "rejected" || source.Results[1].Outcome != "admitted" {
		t.Fatalf("mixed source Whole changed semantics: %+v %v", source, err)
	}
}
