package bftgateway

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestGatewayOriginalMigrationHistoryNormalRoutesAndColdRead(t *testing.T) {
	var original chain.Transaction
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		owner, recipient := "0x"+strings.Repeat("1", 40), "0x"+strings.Repeat("2", 40)
		if _, err := d.Faucet(owner, 100); err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
		var err error
		original, err = d.Transfer(owner, recipient, 7)
		if err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
	})
	for _, block := range f.migration.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Hash == original.Hash {
				original = tx
			}
		}
	}
	if original.BlockHash == "" || original.BlockNum == 0 {
		t.Fatal("fixture requires an actual retained native transaction")
	}
	stateBefore, err := os.ReadFile(f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationBefore, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	mode := ""
	var mu sync.Mutex
	var calls []string
	count := func(prefix string) int {
		mu.Lock()
		defer mu.Unlock()
		n := 0
		for _, call := range calls {
			if strings.HasPrefix(call, prefix) {
				n++
			}
		}
		return n
	}
	base := f.serve(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/abci_query" {
			path, _ = strconv.Unquote(r.URL.Query().Get("path"))
		}
		mu.Lock()
		calls = append(calls, path)
		mu.Unlock()
		if path == "/block" || path == "/tx" {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":{"code":-32603,"message":"record not found"}}`))
			return
		}
		if strings.HasPrefix(path, consensus.MigrationHistoryBlockPath) || strings.HasPrefix(path, consensus.MigrationHistoryTransactionPath) {
			if mode == "http" {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			response, err := f.app.Query(r.Context(), &abci.RequestQuery{Path: path})
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			var anchor *consensus.MigrationHistoryAnchor
			if strings.HasPrefix(path, consensus.MigrationHistoryBlockPath) {
				var view consensus.MigrationHistoryBlockView
				if err := json.Unmarshal(response.Value, &view); err != nil {
					t.Error(err)
				}
				anchor = &view.MigrationHistoryAnchor
				mutateMigrationAnchor(anchor, mode)
				switch mode {
				case "record":
					view.Block.Height++
				case "membership":
					view.Found = false
				}
				response.Value, err = json.Marshal(view)
			} else {
				var view consensus.MigrationHistoryTransactionView
				if err := json.Unmarshal(response.Value, &view); err != nil {
					t.Error(err)
				}
				anchor = &view.MigrationHistoryAnchor
				mutateMigrationAnchor(anchor, mode)
				switch mode {
				case "record":
					view.Transaction.Hash = "0x" + strings.Repeat("3", 64)
				case "membership":
					view.Found = false
				}
				response.Value, err = json.Marshal(view)
			}
			if err != nil {
				t.Error(err)
			}
			if mode == "duplicate" {
				response.Value = bytes.Replace(response.Value, []byte(`"found":true`), []byte(`"found":false,"found":true`), 1)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": response.Code, "height": strconv.FormatInt(response.Height, 10), "value": base64.StdEncoding.EncodeToString(response.Value)}}})
			return
		}
		base.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.migration.Height, MigrationBlockHash: f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	read := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}
	checkSource := func(raw []byte) {
		t.Helper()
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil || string(fields["source"]) != `"source_import"` || string(fields["independentFinality"]) != "false" {
			t.Fatal("source history lost its original provenance")
		}
		for _, key := range []string{"cometHash", "cometIndex", "cometTransactionCount", "appHash", "dataHash", "transactionOrder", "headerHeight"} {
			if _, ok := fields[key]; ok {
				t.Fatal("imported record acquired fabricated Comet evidence", key)
			}
		}
	}
	for _, originalBlock := range f.migration.Runtime.Blocks {
		response := read("/blocks/" + strconv.FormatUint(originalBlock.Height, 10))
		var got importedBlockView
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || !reflect.DeepEqual(got.Block, originalBlock) {
			t.Fatal("normal old-height block route lost original bytes/fields", response.Code, response.Body.String())
		}
		checkSource(response.Body.Bytes())
	}
	response := read("/txs/" + original.Hash)
	var got importedTransactionView
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || !reflect.DeepEqual(got.Transaction, original) {
		t.Fatal("normal original transaction route changed the record", response.Code, response.Body.String())
	}
	checkSource(response.Body.Bytes())
	if count("/block") != 0 || count("/tx") != 0 {
		t.Fatal("source history was queried as new Comet history")
	}
	originalResponse := bytes.Clone(response.Body.Bytes())
	cold, err := consensus.NewPersistentApplicationWithBootstrap(f.migration, f.statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	f.app = cold
	if restored := read("/txs/" + original.Hash); restored.Code != 200 || !bytes.Equal(restored.Body.Bytes(), originalResponse) {
		t.Fatal("cold normal route changed original transaction/anchor bytes")
	}
	for _, bad := range []string{"http", "anchor", "genesis", "migration", "chain", "height", "record", "membership", "duplicate"} {
		mode = bad
		for _, path := range []string{"/blocks/" + strconv.FormatUint(original.BlockNum, 10), "/txs/" + original.Hash} {
			if failed := read(path); failed.Code != 502 {
				t.Fatal("invalid source history was accepted", bad, path, failed.Code)
			}
		}
	}
	mode = ""
	if count("/block") != 0 || count("/tx") != 0 {
		t.Fatal("a failed source observation fell back to another history namespace")
	}
	if missing := read("/txs/" + strings.Repeat("5", 64)); missing.Code != 404 || count("/tx") != 0 {
		t.Fatal("absent native hash was forwarded as a Comet transaction")
	}
	if missing := read("/txs/0x" + strings.Repeat("0", 64)); missing.Code != 404 || count("/tx") != 1 {
		t.Fatal("explicit nonmembership did not preserve the Comet lookup path", missing.Code)
	}
	if next := read("/blocks/" + strconv.FormatUint(f.migration.Height+1, 10)); next.Code != 502 || count("/block") != 1 {
		t.Fatal("postmigration block no longer uses original Comet evidence")
	}
	stateAfter, _ := os.ReadFile(f.statePath)
	migrationAfter, _ := f.migration.CanonicalJSON()
	if !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(migrationBefore, migrationAfter) {
		t.Fatal("readonly history changed persisted state or original migration")
	}
}

func mutateMigrationAnchor(anchor *consensus.MigrationHistoryAnchor, mode string) {
	switch mode {
	case "anchor":
		anchor.SourceAnchor = strings.Repeat("a", 64)
	case "genesis":
		anchor.OriginalGenesisHash = strings.Repeat("a", 64)
	case "migration":
		anchor.MigrationBlockHash = strings.Repeat("a", 64)
	case "chain":
		anchor.NativeChainID = 1
	case "height":
		anchor.MigrationHeight++
	}
}
