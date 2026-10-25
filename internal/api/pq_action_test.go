package api

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func apiPQStake(t *testing.T, f *apiPQFixture, nonce, amount uint64) []byte {
	t.Helper()
	payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionStake, ynxauth.StakePayload{Amount: amount})
	apiPQMust(t, err)
	message, err := (ynxauth.Action{ChainID: f.network, NativeChainID: 6423, Owner: f.owner, Nonce: nonce, Kind: ynxauth.ActionStake, Payload: payload}).SigningBytes()
	apiPQMust(t, err)
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	apiPQMust(t, err)
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 0)
	apiPQMust(t, err)
	wire, err := ynxbatch.EncodeMember(member)
	apiPQMust(t, err)
	return wire
}

func TestPQActionHTTPPreservesOriginalUnknownAndRejectsTamper(t *testing.T) {
	f := newAPIPQFixture(t)
	apiPQRequest(t, f.h, http.MethodPost, "/accounts/"+f.owner+"/authorization/migrate", "application/octet-stream", f.migration(t), http.StatusOK)
	f.d.ProduceBlock()
	path := "/transactions/pq/actions/broadcast"
	wire := apiPQStake(t, f, 2, 7)
	before, _ := f.d.Account(f.owner)
	apiPQRequest(t, f.h, http.MethodPost, path, "application/json", wire, http.StatusUnsupportedMediaType)
	apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", nil, http.StatusBadRequest)
	bad := bytes.Clone(wire)
	bad[len(bad)-1] ^= 1
	apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", bad, http.StatusUnprocessableEntity)
	unchanged, _ := f.d.Account(f.owner)
	if unchanged.Balance != before.Balance || unchanged.Staked != before.Staked || unchanged.Nonce != before.Nonce {
		t.Fatal("rejected action mutated account")
	}
	marker := filepath.Join(f.dir, "devnet-state.integrity-version.tmp")
	apiPQMust(t, os.Mkdir(marker, 0700))
	apiPQMust(t, os.WriteFile(filepath.Join(marker, "blocked"), []byte("fixture"), 0600))
	w := apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusServiceUnavailable)
	var unknown struct {
		TransactionHash string
		DecimalFields   map[string]string
	}
	apiPQDecode(t, w, &unknown)
	if unknown.TransactionHash == "" || unknown.DecimalFields["nonce"] != "2" || unknown.DecimalFields["fee"] != "0" {
		t.Fatal("UNKNOWN action lost original identity or exact nonce/fee")
	}
	visible, _ := f.d.Account(f.owner)
	if visible.Balance != before.Balance-7 || visible.Staked != before.Staked+7 || visible.Nonce != 2 {
		t.Fatal("post-rename UNKNOWN did not retain original stake exactly once")
	}
	apiPQMust(t, os.RemoveAll(marker))
	w = apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK)
	var replay struct {
		Transaction chain.Transaction
		WireHash    string
		Replayed    bool
	}
	apiPQDecode(t, w, &replay)
	if !replay.Replayed || replay.Transaction.Hash != unknown.TransactionHash || replay.WireHash != unknown.TransactionHash {
		t.Fatal("reconciliation replaced original action")
	}
	after, _ := f.d.Account(f.owner)
	if after.Balance != visible.Balance || after.Staked != visible.Staked || after.Nonce != visible.Nonce {
		t.Fatal("reconciliation executed original stake twice")
	}
	restored, err := chain.NewPersistentDevnet(f.d.Config(), f.dir)
	apiPQMust(t, err)
	after, _ = restored.Account(f.owner)
	if after.Balance != visible.Balance || after.Staked != visible.Staked || after.Nonce != visible.Nonce {
		t.Fatal("restart lost PQ action state")
	}
}
