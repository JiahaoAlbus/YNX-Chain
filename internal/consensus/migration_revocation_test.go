package consensus

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestABCIMigratedRevocationPreservesSourceWholeAndTerminalPolicy(t *testing.T) {
	f := newABCIRevocationFixture(t)
	if _, _, err := f.d.SubmitAccountMigration(f.registration(t, false, 3)); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{f.transferMessage(t, false, 2, 1), f.transferMessage(t, false, 3, 1)}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	whole, err := batch.WholeWire()
	if err != nil {
		t.Fatal(err)
	}
	result, err := f.d.SubmitPQBatch(whole)
	if err != nil || len(result.Results) != 2 || result.Results[0].Outcome != "admitted" || result.Results[1].Outcome != "admitted" {
		t.Fatalf("source Whole was not executed: %+v %v", result, err)
	}
	next, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer next.Destroy()
	rotation := abciRegistrationWire(t, nil, f.key, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 4, ActivateAt: 5})
	if _, _, err = f.d.SubmitAccountMigration(rotation); err != nil {
		t.Fatal(err)
	}
	revocation, _, err := f.d.SubmitAccountRevocation(f.revocation(t, 5, 3, 2))
	if err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	m, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "imported-revocation-state.json")
	a, err := NewPersistentApplication(m, path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a.committed.AccountPolicy, m.AccountPolicy) || !accountsEqual(a.committed.Accounts, m.Accounts) || len(a.committed.PQHistory) != 0 || len(a.committed.FeeEvents) != 0 {
		t.Fatal("source import replayed effects, lost full policy or invented BFT history")
	}
	proof, exists := a.migration.Runtime.PQBatches[result.BatchHash]
	if !exists || !bytes.Equal(proof.Whole, whole) || !reflect.DeepEqual(proof.Results, result.Results) {
		t.Fatal("ABCI migration lost the original shared batch proof")
	}
	if tx, ok := sourceHistoryTransaction(a.migration, revocation.Hash); !ok || tx.Memo != revocation.Memo || tx.Nonce != revocation.Nonce || tx.Type != revocation.Type || tx.BlockNum != m.Height || !reflect.DeepEqual(tx.LotFlows, revocation.LotFlows) {
		t.Fatal("original terminal transaction is no longer queryable")
	}
	if _, err := a.committed.AccountPolicy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, 3); err != nil {
		t.Fatal("source revocation polluted its old execution height")
	}
	if _, err := a.committed.AccountPolicy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, 4); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatal("imported revocation reopened the current old pair")
	}
	classic, err := NewSignedTransfer(f.classic, m.Network.ChainID, f.other, 1, 6)
	if err != nil {
		t.Fatal(err)
	}
	classicWire, err := EncodeSignedTransaction(classic)
	if err != nil {
		t.Fatal(err)
	}
	for _, wire := range [][]byte{classicWire, mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 6, 1))} {
		out, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: wire})
		if err != nil || out.Code == 0 {
			t.Fatal("source revocation fell back to classic or prior PQ authority")
		}
	}
	// This source policy's terminal record belongs only to owner. An unrelated
	// unmigrated account keeps its genuine classic authorization under global v2.
	other, err := NewSignedTransfer(f.otherClassic, m.Network.ChainID, f.owner, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	otherWire, err := EncodeSignedTransaction(other)
	if err != nil {
		t.Fatal(err)
	}
	commitSponsorBlock(t, a, 4, time.Unix(4, 0).UTC(), otherWire)
	commitSponsorBlock(t, a, 5, time.Unix(5, 0).UTC())
	_, pendingMember := consensusPQProof(t, next, f.network, f.owner, ynxauth.TransactionPurpose, f.transferMessage(t, false, 6, 1))
	out, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: mustPQEnvelope(t, PQTransferType, pendingMember)})
	if err != nil || out.Code == 0 {
		t.Fatal("canceled pending rotation became authority after its scheduled activation")
	}
	restarted, err := NewPersistentApplication(m, path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, a.committed), mustJSON(t, restarted.committed)) || !reflect.DeepEqual(restarted.migration.Runtime.PQBatches, a.migration.Runtime.PQBatches) {
		t.Fatal("restart lost live state or complete source Whole evidence")
	}
	bad := restarted.committed
	bad.AccountPolicy = cloneConsensusAccountPolicy(bad.AccountPolicy)
	bad.AccountPolicy.Version, bad.AccountPolicy.Revocations = ynxauth.PolicyVersion, nil
	bad.AppHash, err = bad.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	if bad.Validate(m) == nil {
		t.Fatal("committed state erased source-anchored terminal history")
	}
}
