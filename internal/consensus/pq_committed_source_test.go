package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"math"
	"strings"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
)

func committedSourceTestCheckpoint(t *testing.T, a *Application) (string, int64, []byte) {
	t.Helper()
	a.mu.RLock()
	defer a.mu.RUnlock()
	hash, err := hex.DecodeString(a.committed.AppHash)
	if err != nil || len(hash) != 32 || a.bootstrap == nil {
		t.Fatal("invalid original committed fixture", err)
	}
	return a.bootstrap.record.ChainID, a.committed.Height, hash
}

func committedSourceTestPolicy(t *testing.T, f *invoiceMoneyFixture) CommittedAccountAuthorization {
	t.Helper()
	chainID, height, hash := committedSourceTestCheckpoint(t, f.a)
	v, err := f.a.CommittedAccountAuthorizationForState(chainID, height, hash, f.owner)
	if err != nil || v.Owner != f.owner || v.NativeChainID != f.m.Network.ChainID || v.CommittedHeight != height || !bytes.Equal(v.CommittedAppHash[:], hash) || v.ExecutionHeight != uint64(height)+1 || v.Policy == nil {
		t.Fatal("original committed account policy unavailable or relabeled", v, err)
	}
	return v
}

func committedSourceTestExecution(t *testing.T, f *invoiceMoneyFixture, nativeHash string, raw []byte, executionHeight uint64) CommittedPQExecution {
	t.Helper()
	chainID, height, hash := committedSourceTestCheckpoint(t, f.a)
	v, err := f.a.CommittedPQExecutionForState(chainID, height, hash, nativeHash, raw)
	if err != nil || v.NativeHash != nativeHash || v.ABCITransactionHash != SignedTransactionHash(raw) || v.ExecutionHeight != executionHeight || v.CommittedHeight != height || !bytes.Equal(v.CommittedAppHash[:], hash) || !bytes.Equal(v.Envelope, raw) {
		t.Fatal("original committed execution unavailable or relabeled", v.ExecutionHeight, err)
	}
	return v
}

func TestCommittedPQSourceOriginalPolicyExecutionAndRestore(t *testing.T) {
	f := newInvoiceMoneyFixture(t)
	before := committedSourceTestPolicy(t, f)
	if before.LedgerNonce != 1 || len(before.Policy.Records) != 2 || !bytes.Equal(mustJSON(t, before.Policy), mustJSON(t, f.a.committed.AccountPolicy)) {
		t.Fatal("source returned an owner projection instead of the complete committed ledger")
	}
	t.Run("completePolicyIsDetached", func(t *testing.T) {
		v := committedSourceTestPolicy(t, f)
		v.Policy.NetworkID[0] ^= 1
		for i := range v.Policy.Records {
			v.Policy.Records[i].PKA[0] ^= 1
			v.Policy.Records[i].PKB[0] ^= 1
			v.Policy.Records[i].Revision++
		}
		if !bytes.Equal(mustJSON(t, committedSourceTestPolicy(t, f).Policy), mustJSON(t, before.Policy)) {
			t.Fatal("detached policy or another owner's public keys alias original application state")
		}
	})

	transferWire := f.transfer(t, false, 2, 7)
	transfer := mustPQEnvelope(t, PQTransferType, transferWire)
	transferHash := SignedTransactionHash(transferWire)
	oldChain, oldHeight, oldHash := committedSourceTestCheckpoint(t, f.a)
	request := f.request(transfer)
	finalized, err := f.a.FinalizeBlock(context.Background(), request)
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
		t.Fatal("real signed transfer did not finalize", err)
	}
	t.Run("pendingIsNotCommitted", func(t *testing.T) {
		v := committedSourceTestPolicy(t, f)
		if v.LedgerNonce != before.LedgerNonce || !bytes.Equal(mustJSON(t, v.Policy), mustJSON(t, before.Policy)) {
			t.Fatal("pending execution leaked into the committed account read")
		}
		if _, e := f.a.CommittedAccountAuthorizationForState(oldChain, request.Height, finalized.AppHash, f.owner); e == nil {
			t.Fatal("uncommitted Finalize checkpoint was accepted")
		}
		if _, e := f.a.CommittedPQExecutionForState(oldChain, oldHeight, oldHash, transferHash, transfer); e == nil {
			t.Fatal("pending transfer acquired a committed execution height")
		}
	})
	if _, err = f.a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	transferHeight := uint64(request.Height)
	v := committedSourceTestExecution(t, f, transferHash, transfer, transferHeight)
	v.Envelope[0] ^= 1
	committedSourceTestExecution(t, f, transferHash, transfer, transferHeight)
	if p := committedSourceTestPolicy(t, f); p.LedgerNonce != 2 {
		t.Fatal("committed transfer nonce was not read from the same account checkpoint")
	}
	if _, err = f.a.CommittedPQExecutionForState(oldChain, oldHeight, oldHash, transferHash, transfer); err == nil {
		t.Fatal("stale engine checkpoint was accepted after Commit")
	}

	invoice := f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("committed-source-invoice", 10), 3)
	terms := invoiceEffect(t, f.commit(t, []bool{true}, invoice).TxResults[0])
	invoiceHeight := uint64(f.a.committed.Height)
	committedSourceTestExecution(t, f, terms.NativeHash, invoice, invoiceHeight)
	t.Run("exactNativeAndABCIIdentities", func(t *testing.T) {
		chainID, height, hash := committedSourceTestCheckpoint(t, f.a)
		for _, pair := range []struct {
			native string
			raw    []byte
		}{
			{transferHash, invoice}, {terms.NativeHash, transfer},
			{SignedTransactionHash(invoice), invoice},
			{terms.NativeHash, append(bytes.Clone(invoice), '\n')},
			{terms.NativeHash, nil}, {"0x" + strings.Repeat("0", 64), invoice},
		} {
			if _, e := f.a.CommittedPQExecutionForState(chainID, height, hash, pair.native, pair.raw); e == nil {
				t.Fatal("wrong native identity or non-exact ABCI envelope was accepted")
			}
		}
	})

	whole := mustPQEnvelope(t, PQWholeType, abciWhole(t, f.abciRevocationFixture, f.transferMessage(t, false, 4, 2)))
	wholeResponse := f.commit(t, []bool{true}, whole)
	var batch PQBatchExecutionResult
	if err = json.Unmarshal(wholeResponse.TxResults[0].Data, &batch); err != nil || len(batch.Results) != 1 || batch.Results[0].Outcome != "admitted" {
		t.Fatal("real Whole fixture did not preserve partial outcomes", err)
	}
	t.Run("wholeIsNotAStandaloneMember", func(t *testing.T) {
		chainID, height, hash := committedSourceTestCheckpoint(t, f.a)
		for _, native := range []string{batch.BatchHash, batch.Results[0].TransactionHash} {
			if _, e := f.a.CommittedPQExecutionForState(chainID, height, hash, native, whole); e == nil {
				t.Fatal("Whole or derived member was mislabeled a standalone Comet transaction")
			}
		}
	})

	next, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer next.Destroy()
	rotationHeight := uint64(f.a.committed.Height + 1)
	rotation := abciRegistrationWire(t, nil, f.key, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 5, ActivateAt: rotationHeight + 1})
	f.commit(t, []bool{true}, mustPQEnvelope(t, PQMigrationType, rotation))
	rotated := committedSourceTestPolicy(t, f)
	current, e1 := rotated.Policy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, uint64(rotated.CommittedHeight))
	nextRegistration, e2 := rotated.Policy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, rotated.ExecutionHeight)
	if e1 != nil || e2 != nil || current.PolicyRevision != "1" || nextRegistration.PolicyRevision != "2" || rotated.LedgerNonce != 5 || len(rotated.Policy.Records) != 3 {
		t.Fatal("committed policy lost the exact pending/current revision boundary", e1, e2)
	}
	revokeHeight := uint64(f.a.committed.Height + 1)
	intent := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, AuthorizingRevision: 2, ThroughRevision: 2, LedgerNonce: 6, ExecuteAt: revokeHeight, RevokeAt: revokeHeight + 1}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, proof := consensusPQProof(t, next, f.network, f.owner, ynxauth.RevocationPurpose, message)
	revocation, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: proof}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	f.commit(t, []bool{true}, mustPQEnvelope(t, PQRevocationType, revocation))
	t.Run("revocationAndOtherOwnersRemainComplete", func(t *testing.T) {
		p := committedSourceTestPolicy(t, f)
		if len(p.Policy.Records) != 3 || len(p.Policy.Revocations) != 1 || p.Policy.Revocations[0].ThroughRevision != 2 || p.LedgerNonce != 6 {
			t.Fatal("global policy omitted a revision, other owner or terminal tombstone")
		}
		if _, e := p.Policy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, p.ExecutionHeight); e == nil {
			t.Fatal("data read restored revoked signing authority")
		}
		if _, e := p.Policy.TrustedRegistration(f.other, ynxauth.TransactionPurpose, p.ExecutionHeight); e != nil {
			t.Fatal("another owner's authority disappeared from full global policy", e)
		}
		p.Policy.Revocations[0].ThroughRevision = 999
		if committedSourceTestPolicy(t, f).Policy.Revocations[0].ThroughRevision != 2 {
			t.Fatal("revocation slice aliases the original ledger")
		}
	})
	policyBeforeRestart := mustJSON(t, committedSourceTestPolicy(t, f))
	f.cold(t)
	if !bytes.Equal(policyBeforeRestart, mustJSON(t, committedSourceTestPolicy(t, f))) {
		t.Fatal("normal cold constructor changed the complete committed account source")
	}
	committedSourceTestExecution(t, f, transferHash, transfer, transferHeight)
	committedSourceTestExecution(t, f, terms.NativeHash, invoice, invoiceHeight)
}

func TestCommittedPQSourceFailClosedAndAtomicCheckpoint(t *testing.T) {
	f := newInvoiceMoneyFixture(t)
	chainID, height, hash := committedSourceTestCheckpoint(t, f.a)
	entry := f.a.committed.PQHistory[0]
	_, original, err := pqWalletOriginalEnvelope(entry.Transaction)
	if err != nil {
		t.Fatal(err)
	}
	wrongHash := bytes.Clone(hash)
	wrongHash[31] ^= 1
	for _, bad := range []struct {
		name, chain string
		height      int64
		hash        []byte
	}{
		{"wrongChain", chainID + "-other", height, hash}, {"emptyChain", "", height, hash},
		{"zeroHeight", chainID, 0, hash}, {"staleHeight", chainID, height - 1, hash}, {"futureHeight", chainID, height + 1, hash},
		{"overflowHeight", chainID, math.MaxInt64, hash}, {"wrongHash", chainID, height, wrongHash},
		{"missingHash", chainID, height, nil}, {"shortHash", chainID, height, hash[:31]}, {"longHash", chainID, height, append(bytes.Clone(hash), 0)},
	} {
		t.Run(bad.name, func(t *testing.T) {
			if _, e := f.a.CommittedAccountAuthorizationForState(bad.chain, bad.height, bad.hash, f.owner); e == nil {
				t.Fatal("unbound account checkpoint accepted")
			}
			if _, e := f.a.CommittedPQExecutionForState(bad.chain, bad.height, bad.hash, entry.Transaction.Hash, original); e == nil {
				t.Fatal("unbound execution checkpoint accepted")
			}
		})
	}
	for _, owner := range []string{"", " " + f.owner, strings.ToUpper(f.owner), "0x" + strings.Repeat("0", 40)} {
		if _, err := f.a.CommittedAccountAuthorizationForState(chainID, height, hash, owner); err == nil {
			t.Fatal("noncanonical or absent account accepted")
		}
	}
	var absent *Application
	if _, err := absent.CommittedAccountAuthorizationForState(chainID, height, hash, f.owner); err == nil {
		t.Fatal("nil application supplied policy")
	}
	if _, err := absent.CommittedPQExecutionForState(chainID, height, hash, entry.Transaction.Hash, original); err == nil {
		t.Fatal("nil application supplied execution")
	}
	originalState, bootstrap := f.a.committed, f.a.bootstrap
	for _, mode := range []string{"unbound", "uninitialized", "missingPolicy", "nullPolicy", "malformedHash", "wrongMigration", "wrongNativeChain"} {
		t.Run(mode, func(t *testing.T) {
			f.a.mu.Lock()
			switch mode {
			case "unbound":
				f.a.bootstrap = nil
			case "uninitialized":
				f.a.committed.Initialized = false
			case "missingPolicy":
				f.a.committed.AccountPolicy = nil
			case "nullPolicy":
				f.a.committed.AccountPolicy = &ynxauth.State{}
			case "malformedHash":
				f.a.committed.AppHash = strings.ToUpper(f.a.committed.AppHash)
			case "wrongMigration":
				f.a.committed.MigrationStateHash = strings.Repeat("0", 64)
			case "wrongNativeChain":
				f.a.committed.ChainID++
			}
			f.a.mu.Unlock()
			_, e := f.a.CommittedAccountAuthorizationForState(chainID, height, hash, f.owner)
			f.a.mu.Lock()
			f.a.committed, f.a.bootstrap = originalState, bootstrap
			f.a.mu.Unlock()
			if e == nil {
				t.Fatal("missing or corrupt original source was accepted")
			}
		})
	}
	for _, mode := range []string{"duplicate", "wrongABCIHash", "sourceHeight", "futureExecution", "wrongMemo"} {
		t.Run(mode, func(t *testing.T) {
			f.a.mu.Lock()
			f.a.committed.PQHistory = append([]PQCommittedAuthorization(nil), originalState.PQHistory...)
			switch mode {
			case "duplicate":
				f.a.committed.PQHistory = append(f.a.committed.PQHistory, entry)
			case "wrongABCIHash":
				f.a.committed.PQHistory[0].ABCITransactionHash = "0x" + strings.Repeat("0", 64)
			case "sourceHeight":
				f.a.committed.PQHistory[0].Transaction.BlockNum = f.m.Height
			case "futureExecution":
				f.a.committed.PQHistory[0].Transaction.BlockNum = uint64(height + 1)
			case "wrongMemo":
				f.a.committed.PQHistory[0].Transaction.Memo += "00"
			}
			f.a.mu.Unlock()
			_, e := f.a.CommittedPQExecutionForState(chainID, height, hash, entry.Transaction.Hash, original)
			f.a.mu.Lock()
			f.a.committed = originalState
			f.a.mu.Unlock()
			if e == nil {
				t.Fatal("ambiguous or corrupt execution provenance accepted")
			}
		})
	}
	t.Run("originalSourceHistoryHasNoBFTLocation", func(t *testing.T) {
		if f.m.Runtime != nil {
			for _, block := range f.m.Runtime.Blocks {
				for _, source := range block.Transactions {
					if _, e := f.a.CommittedPQExecutionForState(chainID, height, hash, source.Hash, original); e == nil {
						t.Fatal("original native history acquired fabricated BFT execution")
					}
					return
				}
			}
		}
		t.Fatal("missing actual original source history fixture")
	})
	t.Run("concurrentCommitCannotMixPolicyAndCheckpoint", func(t *testing.T) {
		want := mustJSON(t, committedSourceTestPolicy(t, f))
		request := f.request()
		if _, e := f.a.FinalizeBlock(context.Background(), request); e != nil {
			t.Fatal(e)
		}
		var readers sync.WaitGroup
		start := make(chan struct{})
		failures := make(chan string, 8)
		for i := 0; i < cap(failures); i++ {
			readers.Add(1)
			go func() {
				defer readers.Done()
				<-start
				for j := 0; j < 32; j++ {
					v, e := f.a.CommittedAccountAuthorizationForState(chainID, height, hash, f.owner)
					if e == nil {
						got, marshalErr := json.Marshal(v)
						if marshalErr != nil || !bytes.Equal(got, want) {
							failures <- "mixed account/checkpoint read"
							return
						}
					}
				}
			}()
		}
		close(start)
		if _, e := f.a.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
		readers.Wait()
		close(failures)
		for failure := range failures {
			t.Error(failure)
		}
		if _, e := f.a.CommittedAccountAuthorizationForState(chainID, height, hash, f.owner); e == nil {
			t.Fatal("old tuple survived actual Commit")
		}
		committedSourceTestPolicy(t, f)
	})
}
