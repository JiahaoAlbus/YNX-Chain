package consensus

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestABCICertificateCacheCheckProposalFinalizeCommitAndRestart(t *testing.T) {
	f := activeABCIWholeFixture(t)
	if f.a.pqCertificateCache == nil {
		t.Fatal("application constructor omitted verification cache")
	}
	f.a.pqCertificateCache.Invalidate()
	initial := f.a.pqCertificateCache.Stats()
	messages := [][]byte{f.transferMessage(t, false, 2, 7), f.transferMessage(t, false, 3, 1)}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	whole, err := ynxbatch.EncodeWhole(ynxbatch.Whole{Certificate: member.Certificate, Messages: messages})
	if err != nil {
		t.Fatal(err)
	}
	memberPayload := mustPQEnvelope(t, PQTransferType, wire)
	wholePayload := mustPQEnvelope(t, PQWholeType, whole)
	ctx := context.Background()
	before := mustJSON(t, f.a.committed)
	ownerBefore := queryConsensusAccount(t, f.a, f.owner)
	for _, payload := range [][]byte{memberPayload, memberPayload, wholePayload} {
		result, err := f.a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
		if err != nil || result.Code != 0 {
			t.Fatalf("cached CheckTx rejected valid proof: %+v %v", result, err)
		}
	}
	stats := f.a.pqCertificateCache.Stats()
	if stats.Certificates.Misses-initial.Certificates.Misses != 1 || stats.Certificates.Hits-initial.Certificates.Hits != 2 || stats.ScopeComputations-initial.ScopeComputations != 1 || stats.RetainedPolicyScopes != 2 {
		t.Fatalf("new execution clones failed to reuse member/Whole certificate and root: before=%+v after=%+v", initial, stats)
	}
	prepared, err := f.a.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{wholePayload}, MaxTxBytes: 1 << 20})
	if err != nil || len(prepared.Txs) != 1 {
		t.Fatalf("prepare: %+v %v", prepared, err)
	}
	processed, err := f.a.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{wholePayload}})
	if err != nil || processed.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("process: %+v %v", processed, err)
	}
	if !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("verification cache mutated committed state")
	}
	finalized, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{wholePayload}})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
		t.Fatalf("finalize: %+v %v", finalized, err)
	}
	stats = f.a.pqCertificateCache.Stats()
	if stats.Certificates.Misses-initial.Certificates.Misses != 1 || stats.Certificates.Hits-initial.Certificates.Hits != 5 || stats.ScopeComputations-initial.ScopeComputations != 1 {
		t.Fatalf("proposal stages repeated provider/root work: %+v", stats)
	}
	if _, err := f.a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	owner := queryConsensusAccount(t, f.a, f.owner)
	if owner.Nonce != 3 || owner.Balance != ownerBefore.Balance-10 || len(f.a.committed.PQBatches) != 1 {
		t.Fatal("cached simulation changed actual business effects")
	}
	stable := mustJSON(t, f.a.committed)
	duplicate, err := f.a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: wholePayload})
	if err != nil || duplicate.Code == 0 || !bytes.Equal(stable, mustJSON(t, f.a.committed)) {
		t.Fatal("cached Whole replay executed business again")
	}
	restored, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stable, mustJSON(t, restored.committed)) || restored.pqCertificateCache.Stats().Certificates.Entries != 0 {
		t.Fatal("restart changed ledger or restored cache as authority")
	}
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 4, 4, 1)))
	stable = mustJSON(t, f.a.committed)
	rejected, err := f.a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: memberPayload})
	if err != nil || rejected.Code == 0 || !strings.Contains(rejected.Log, "post-quantum") || !bytes.Equal(stable, mustJSON(t, f.a.committed)) {
		t.Fatalf("cached key bypassed revocation: %+v %v", rejected, err)
	}
}

func TestABCICertificateCacheOrdinaryMemberDoesNotComputeScope(t *testing.T) {
	f := activeABCIWholeFixture(t)
	f.a.pqCertificateCache.Invalidate()
	before := f.a.pqCertificateCache.Stats()
	payload := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 7))
	for i := 0; i < 2; i++ {
		out, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: payload})
		if err != nil || out.Code != 0 {
			t.Fatalf("ordinary member: %+v %v", out, err)
		}
	}
	after := f.a.pqCertificateCache.Stats()
	if after.ScopeComputations != before.ScopeComputations || after.Certificates != before.Certificates || after.RetainedPolicyScopes > 2 {
		t.Fatalf("ordinary N=1 paid cache/scope cost: before=%+v after=%+v", before, after)
	}
}
