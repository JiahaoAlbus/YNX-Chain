package consensus

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
)

// An ordinary, unreserved fresh classic address can be funded and migrated on
// an existing chain without inventing a new genesis or a fee-free birth grant.
// This local ABCI control does not authorize or perform a real transfer.
func TestPQLabSameChainFundMigrateTransferAndCold(t *testing.T) {
	f := newABCIRevocationFixture(t)
	ctx := context.Background()
	newClassic := deterministicPrivateKey(195)
	owner := mustNativeAddress(t, newClassic)
	if _, found := accountIndex(f.a.committed.Accounts, owner); found {
		t.Fatal("fresh account already exists")
	}
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 4}
	register := mustPQEnvelope(t, PQMigrationType, abciRegistrationWire(t, newClassic, nil, key, intent))
	before, err := f.a.CheckTx(ctx, &abci.RequestCheckTx{Tx: register})
	if err != nil || before.Code == 0 {
		t.Fatal("unfunded nonexistent account migrated", before, err)
	}
	funding, err := NewSignedTransfer(f.classic, f.m.Network.ChainID, owner, 30, 1)
	if err != nil {
		t.Fatal(err)
	}
	fundWire, err := EncodeSignedTransaction(funding)
	if err != nil {
		t.Fatal(err)
	}
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), fundWire)
	if a := queryConsensusAccount(t, f.a, owner); a.Balance != 30 || a.Nonce != 0 {
		t.Fatalf("funding did not create expected account: %+v", a)
	}
	check, err := f.a.CheckTx(ctx, &abci.RequestCheckTx{Tx: register})
	if err != nil || check.Code != 0 {
		t.Fatal("funded exact migration refused", check, err)
	}
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), register)
	if a := queryConsensusAccount(t, f.a, owner); a.Balance != 29 || a.Nonce != 1 {
		t.Fatalf("migration fee/nonce changed: %+v", a)
	}
	message, err := (ynxauth.Transfer{ChainID: f.network, NativeChainID: uint64(f.m.Network.ChainID), From: owner, To: f.other, Amount: 7, Fee: 1, Nonce: 2}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, member := consensusPQProof(t, key, f.network, owner, ynxauth.TransactionPurpose, message)
	transfer := mustPQEnvelope(t, PQTransferType, member)
	_, wrongMember := consensusPQProof(t, f.otherKey, f.network, owner, ynxauth.TransactionPurpose, message)
	wrongTransfer := mustPQEnvelope(t, PQTransferType, wrongMember)
	unchanged := mustJSON(t, f.a.committed)
	check, err = f.a.CheckTx(ctx, &abci.RequestCheckTx{Tx: wrongTransfer})
	if err != nil || check.Code == 0 || !bytes.Equal(unchanged, mustJSON(t, f.a.committed)) {
		t.Fatal("unregistered key accepted or changed state", check, err)
	}
	check, err = f.a.CheckTx(ctx, &abci.RequestCheckTx{Tx: transfer})
	if err != nil || check.Code != 0 {
		t.Fatal("active PQ transfer refused", check, err)
	}
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), transfer)
	if a := queryConsensusAccount(t, f.a, owner); a.Balance != 21 || a.Nonce != 2 {
		t.Fatalf("unexpected actual balance/nonce: %+v", a)
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatal("restart changed original enrollment", err)
	}
	check, err = cold.CheckTx(ctx, &abci.RequestCheckTx{Tx: transfer})
	if err != nil || check.Code == 0 {
		t.Fatal("restart admitted original transfer again", check, err)
	}
}
