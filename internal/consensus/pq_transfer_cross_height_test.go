package consensus

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// Each scenario retains one locally generated transfer envelope throughout.
// CheckTx examines committed H+1; FinalizeBlock uses its actual height. This
// does not grant Wallet approval or authorize retry of an UNKNOWN operation.
func TestABCIPQOriginalTransferAcrossCommittedHeights(t *testing.T) {
	check := func(t *testing.T, a *Application, wire []byte, accept bool) {
		t.Helper()
		before := mustJSON(t, a.committed)
		result, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: wire})
		if err != nil || (result.Code == 0) != accept || !bytes.Equal(before, mustJSON(t, a.committed)) {
			t.Fatalf("CheckTx accept=%v result=%+v err=%v", accept, result, err)
		}
	}
	finalize := func(t *testing.T, a *Application, height int64, wire []byte, accept bool) {
		t.Helper()
		result, err := a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(height, 0).UTC(), Txs: [][]byte{wire}})
		if err != nil || len(result.TxResults) != 1 || (result.TxResults[0].Code == 0) != accept {
			t.Fatalf("FinalizeBlock height=%d accept=%v result=%+v err=%v", height, accept, result, err)
		}
		if _, err = a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	restart := func(t *testing.T, f *abciRevocationFixture) *Application {
		t.Helper()
		a, err := NewPersistentApplication(f.m, f.path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(mustJSON(t, f.a.committed), mustJSON(t, a.committed)) {
			t.Fatal("restart lost committed state")
		}
		return a
	}
	setup := func(t *testing.T) *abciRevocationFixture {
		t.Helper()
		f := newABCIRevocationFixture(t)
		commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
		return f
	}
	t.Run("unchanged policy and nonce", func(t *testing.T) {
		f := setup(t)
		original := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 7))
		check(t, f.a, original, true) // next H=3
		commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC())
		check(t, f.a, original, true) // same original, next H=4
		finalize(t, f.a, 4, original, true)
		owner, recipient := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, f.other)
		if owner.Nonce != 2 || owner.Balance != 91 || recipient.Balance != 107 {
			t.Fatalf("unexpected executed transfer: owner=%+v recipient=%+v", owner, recipient)
		}
		check(t, restart(t, f), original, false)
	})
	t.Run("pending key rotation becomes active", func(t *testing.T) {
		f := setup(t)
		commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC())
		next, public, err := ynxbatch.KeyGen()
		if err != nil {
			t.Fatal(err)
		}
		defer next.Destroy()
		rotation := abciRegistrationWire(t, nil, f.key, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 2, ActivateAt: 6})
		commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQMigrationType, rotation))
		original := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 3, 7))
		check(t, f.a, original, true) // old pair remains active at H=5
		commitSponsorBlock(t, f.a, 5, time.Unix(5, 0).UTC())
		check(t, f.a, original, false) // old pair is no longer active at H=6
		before := queryConsensusAccount(t, f.a, f.owner)
		finalize(t, f.a, 6, original, false)
		if after := queryConsensusAccount(t, f.a, f.owner); before.Nonce != after.Nonce || before.Balance != after.Balance {
			t.Fatal("rejected old-key transfer changed account")
		}
		check(t, restart(t, f), original, false)
	})
	t.Run("revocation becomes effective", func(t *testing.T) {
		f := setup(t)
		commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC())
		original := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 7))
		check(t, f.a, original, true) // next H=4
		commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 2, 4, 1)))
		check(t, f.a, original, false) // revoked at H=5; revocation also consumed nonce 2
		before := queryConsensusAccount(t, f.a, f.owner)
		finalize(t, f.a, 5, original, false)
		if after := queryConsensusAccount(t, f.a, f.owner); before.Nonce != after.Nonce || before.Balance != after.Balance {
			t.Fatal("revoked transfer changed account")
		}
		check(t, restart(t, f), original, false)
	})
	t.Run("intervening nonce consumption", func(t *testing.T) {
		f := setup(t)
		original := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 7))
		check(t, f.a, original, true)
		other := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 1))
		commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), other)
		check(t, f.a, original, false)
		before := queryConsensusAccount(t, f.a, f.owner)
		finalize(t, f.a, 4, original, false)
		if after := queryConsensusAccount(t, f.a, f.owner); before.Nonce != after.Nonce || before.Balance != after.Balance {
			t.Fatal("stale nonce transfer changed account")
		}
		check(t, restart(t, f), original, false)
	})
}
