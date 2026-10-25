package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestPQReadReconciliationPreservesUnknownAndExactOriginal(t *testing.T) {
	for _, kind := range []string{"migration", "transfer"} {
		t.Run(kind, func(t *testing.T) {
			f := newAPIPQFixture(t)
			path := "/accounts/" + f.owner + "/authorization/migrate"
			wire := f.migration(t)
			if kind == "transfer" {
				apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK)
				f.d.ProduceBlock()
				path, wire = "/transactions/pq/broadcast", f.member(t, 2)
			}
			digest := sha256.Sum256(wire)
			hash := "0x" + hex.EncodeToString(digest[:])
			get := "/txs/" + hash
			missing := apiPQRequest(t, f.h, http.MethodGet, get, "", nil, http.StatusNotFound)
			var absent struct {
				Status, TransactionHash string
				ConsensusFinality       bool
			}
			apiPQDecode(t, missing, &absent)
			if absent.Status != "not_found" || absent.TransactionHash != hash || absent.ConsensusFinality || missing.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing local observation lost original identity or claimed finality")
			}
			marker := filepath.Join(f.dir, "devnet-state.integrity-version.tmp")
			apiPQMust(t, os.Mkdir(marker, 0700))
			apiPQMust(t, os.WriteFile(filepath.Join(marker, "blocked"), []byte("fixture"), 0600))
			apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusServiceUnavailable)
			// Removing the failure source does not confirm the earlier UNKNOWN.
			// A GET must remain a read, even when a subsequent write could succeed.
			apiPQMust(t, os.RemoveAll(marker))
			read := func(handler http.Handler, want string) transactionReadDTO {
				t.Helper()
				w := apiPQRequest(t, handler, http.MethodGet, get, "", nil, http.StatusOK)
				var result transactionReadDTO
				apiPQDecode(t, w, &result)
				if result.Hash != hash || result.TransactionHash != hash || result.WireHash != hash || result.ConsensusFinality || result.Source != "authoritative_producer" || result.YNXDurability["status"] != want || result.YNXDurability["scope"] != "local-snapshot" || result.YNXDurability["transactionHash"] != hash || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("incorrect original transaction reconciliation: %s", w.Body.String())
				}
				if result.DecimalFields["fee"] != "1" || (kind == "migration" && (result.DecimalFields["nonce"] != "1" || result.DecimalFields["amount"] != "0" || result.DecimalFields["revision"] != "1" || result.DecimalFields["activationHeight"] != "2")) || (kind == "transfer" && (result.DecimalFields["nonce"] != "2" || result.DecimalFields["amount"] != "2")) {
					t.Fatal("exact signed decimal fields were lost")
				}
				if strings.Contains(w.Body.String(), f.dir) {
					t.Fatal("read response leaked local filesystem details")
				}
				return result
			}
			before := apiPQSnapshot(t, f.d)
			pending := read(f.h, "uncertain")
			if pending.DecimalFields["blockNumber"] != "0" || pending.BlockNum != 0 || pending.YNXDurability["snapshotIntegrity"] != nil {
				t.Fatal("uncertain pending transaction acquired a checkpoint")
			}
			apiPQUnchanged(t, f.d, before)
			// This explicit identical request is confined to the temporary fixture.
			apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK)
			read(f.h, "pending_durable")
			apiPQUnchanged(t, f.d, before)
			f.d.ProduceBlock()
			mined := read(f.h, "durable")
			if mined.DecimalFields["blockNumber"] == "0" || mined.DecimalFields["executionHeight"] != mined.DecimalFields["blockNumber"] || mined.BlockHash == "" || mined.YNXDurability["snapshotIntegrity"] == nil {
				t.Fatal("durable local inclusion missing exact block/checkpoint")
			}
			restarted, err := chain.NewPersistentDevnet(f.d.Config(), f.dir)
			apiPQMust(t, err)
			recovered := read(NewServer(restarted), "durable")
			if recovered.BlockHash != mined.BlockHash || recovered.Nonce != mined.Nonce || recovered.Memo != mined.Memo {
				t.Fatal("restart changed original signed transaction or inclusion")
			}
		})
	}
}

func TestPQReadDecimalProjectionDoesNotRoundUint64(t *testing.T) {
	tx := chain.Transaction{Hash: "0x" + strings.Repeat("1", 64), Amount: math.MaxInt64, Fee: 1, Nonce: math.MaxUint64, BlockNum: 9007199254740993}
	response := transactionReadResponse(tx, chain.TransactionDurability{Status: "memory_only", ExecutionHeight: tx.BlockNum})
	wire, err := json.Marshal(response)
	apiPQMust(t, err)
	var decoded struct{ DecimalFields map[string]string }
	apiPQMust(t, json.Unmarshal(wire, &decoded))
	if decoded.DecimalFields["amount"] != "9223372036854775807" || decoded.DecimalFields["nonce"] != "18446744073709551615" || decoded.DecimalFields["blockNumber"] != "9007199254740993" || decoded.DecimalFields["executionHeight"] != "9007199254740993" {
		t.Fatal("native decimal projection narrowed a uint64 or int64")
	}
	if response.WireHash != "" || response.ConsensusFinality {
		t.Fatal("ordinary transaction falsely gained a wire identity or finality")
	}
}
