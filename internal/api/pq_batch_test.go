package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func (f *apiPQFixture) whole(t *testing.T, values ...[2]uint64) []byte {
	t.Helper()
	messages := make([][]byte, len(values))
	for i, v := range values {
		var err error
		messages[i], err = (ynxauth.Transfer{ChainID: f.network, NativeChainID: uint64(f.d.Config().ChainID), From: f.owner, To: f.to, Nonce: v[0], Amount: v[1], Fee: 1}).SigningBytes()
		apiPQMust(t, err)
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	apiPQMust(t, err)
	defer batch.Discard()
	wire, err := batch.WholeWire()
	apiPQMust(t, err)
	return wire
}

type apiPQBatchReceipt struct {
	BatchHash, WireHash, Status, ExecutionHeight string
	Replayed                                     bool
	Results                                      []struct {
		Index                                                uint32
		Outcome, TransactionHash, Error, BatchHash, WireHash string
		DecimalFields                                        map[string]string
	}
}

func TestPQHTTPBatchPartialDecimalFieldsAndCommittedPolicyView(t *testing.T) {
	f := newAPIPQFixture(t)
	route := "/accounts/" + f.owner + "/authorization"
	apiPQRequest(t, f.h, http.MethodPost, route+"/migrate", "application/octet-stream", f.migration(t), http.StatusOK)
	f.d.ProduceBlock()
	var view struct {
		PolicyView, Source, RecordsView, CommittedHeight, CommittedBlockHash                 string
		CommittedAlgorithmVersion, CommittedActiveRevision, AlgorithmVersion, ActiveRevision string
	}
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodGet, route, "", nil, http.StatusOK), &view)
	if view.PolicyView != "next_execution" || view.Source != "authoritative_producer" || view.RecordsView != "includes_pending" || view.CommittedHeight != "1" || view.CommittedBlockHash == "" || view.CommittedAlgorithmVersion != "legacy" || view.CommittedActiveRevision != "" || view.AlgorithmVersion != ynxbatch.Version || view.ActiveRevision != "1" {
		t.Fatal("next-execution activation was confused with already-committed policy")
	}
	const large = uint64(9007199254740993)
	wire := f.whole(t, [2]uint64{2, large}, [2]uint64{2, 1}, [2]uint64{large, 1}, [2]uint64{3, 2})
	path := "/transactions/pq/batches/broadcast"
	before := apiPQSnapshot(t, f.d)
	apiPQRequest(t, f.h, http.MethodPost, path, "application/json", wire, http.StatusUnsupportedMediaType)
	apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", make([]byte, chain.MaxPQBatchBytes+1), http.StatusRequestEntityTooLarge)
	bad, err := ynxbatch.DecodeWhole(wire)
	apiPQMust(t, err)
	bad.Certificate.SigmaB[10] ^= 1
	badWire, err := ynxbatch.EncodeWhole(bad)
	apiPQMust(t, err)
	apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", badWire, http.StatusUnprocessableEntity)
	apiPQUnchanged(t, f.d, before)
	var receipt apiPQBatchReceipt
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK), &receipt)
	h := sha256.Sum256(wire)
	batchHash := "0x" + hex.EncodeToString(h[:])
	if receipt.Status != "durable" || receipt.Replayed || receipt.BatchHash != batchHash || receipt.WireHash != batchHash || receipt.ExecutionHeight != "2" || len(receipt.Results) != 4 {
		t.Fatal("batch response lost original wire binding")
	}
	for i, r := range receipt.Results {
		if r.Index != uint32(i) || r.BatchHash != batchHash || r.WireHash != batchHash || r.DecimalFields["executionHeight"] != "2" || r.DecimalFields["fee"] != "1" {
			t.Fatal("member receipt lost decimal/index binding")
		}
		if (r.Outcome == "admitted") != (i == 1 || i == 3) {
			t.Fatal("batch HTTP response concealed partial business results")
		}
		if r.Outcome == "admitted" {
			txHash, e := chain.PQBatchTransactionHash(batchHash, r.Index)
			apiPQMust(t, e)
			if txHash != r.TransactionHash {
				t.Fatal("batch member transaction hash is not canonical E identity")
			}
		}
	}
	if receipt.Results[0].DecimalFields["amount"] != "9007199254740993" || receipt.Results[2].DecimalFields["nonce"] != "9007199254740993" {
		t.Fatal("PQ receipt rounded a JS-unsafe integer")
	}
	before = apiPQSnapshot(t, f.d)
	var retry apiPQBatchReceipt
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK), &retry)
	if !retry.Replayed || !reflect.DeepEqual(retry.Results, receipt.Results) {
		t.Fatal("batch HTTP retry changed per-member outcomes")
	}
	apiPQUnchanged(t, f.d, before)
	a, _ := f.d.Account(f.owner)
	if a.Balance != 994 || a.Nonce != 3 {
		t.Fatal("partial HTTP batch applied rejected members")
	}
	f.d.ProduceBlock()
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodGet, route, "", nil, http.StatusOK), &view)
	if view.CommittedHeight != "2" || view.CommittedAlgorithmVersion != ynxbatch.Version || view.CommittedActiveRevision != "1" {
		t.Fatal("committed policy did not advance at committed activation height")
	}
}

func TestPQHTTPBatchUnknownPreservesOriginalPartialOutcome(t *testing.T) {
	f := newAPIPQFixture(t)
	apiPQRequest(t, f.h, http.MethodPost, "/accounts/"+f.owner+"/authorization/migrate", "application/octet-stream", f.migration(t), http.StatusOK)
	f.d.ProduceBlock()
	wire := f.whole(t, [2]uint64{2, 1}, [2]uint64{2, 1})
	marker := filepath.Join(f.dir, "devnet-state.integrity-version.tmp")
	apiPQMust(t, os.Mkdir(marker, 0700))
	apiPQMust(t, os.WriteFile(filepath.Join(marker, "blocked"), []byte("test"), 0600))
	path := "/transactions/pq/batches/broadcast"
	w := apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusServiceUnavailable)
	var original, retry apiPQBatchReceipt
	apiPQDecode(t, w, &original)
	if original.Status != "uncertain" || original.Replayed || len(original.Results) != 2 || original.Results[0].Outcome != "admitted" || original.Results[1].Outcome != "rejected" || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), f.dir) {
		t.Fatal("batch UNKNOWN falsely acknowledged or lost partial identity")
	}
	before := apiPQSnapshot(t, f.d)
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusServiceUnavailable), &retry)
	if !reflect.DeepEqual(retry, original) {
		t.Fatal("UNKNOWN retry invented a different request or outcome")
	}
	apiPQUnchanged(t, f.d, before)
	apiPQMust(t, os.RemoveAll(marker))
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK), &retry)
	if retry.Status != "durable" || !retry.Replayed || !reflect.DeepEqual(retry.Results, original.Results) {
		t.Fatal("batch recovery re-executed a rejected member")
	}
	apiPQUnchanged(t, f.d, before)
	restored, err := chain.NewPersistentDevnet(f.d.Config(), f.dir)
	apiPQMust(t, err)
	if !bytes.Equal(apiPQSnapshot(t, restored), before) {
		t.Fatal("cold restart lost shared proof or partial outcomes")
	}
}
