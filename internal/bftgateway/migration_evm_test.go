package bftgateway

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	abci "github.com/cometbft/cometbft/abci/types"
)

// A real original-ledger import and Application.Query are used below. Only the
// HTTP transport is substituted; this is not a running Comet/finality fixture.
func TestGatewayOriginalEthereumTransactionAndUnavailableReceipt(t *testing.T) {
	raw, eth := migrationEthereumVector(t, "valid")
	secondRaw, _ := migrationEthereumVector(t, "second")
	nativeHash := "0x" + strings.Repeat("a", 64)
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		if _, err := d.Faucet(eth.From, 100); err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
		if err := d.SetEthereumNativeTransfers(true); err != nil {
			t.Fatal(err)
		}
		// Keep another real source transaction before the RLP in its block, so
		// a zero/default transaction index cannot satisfy this regression.
		if _, err := d.Faucet(eth.To, 1); err != nil {
			t.Fatal(err)
		}
		if _, replay, err := d.SubmitSignedTransfer(chain.SignedTransferInput{Hash: eth.Hash, From: eth.From, To: eth.To, Amount: eth.Amount, Fee: 1, Nonce: eth.Nonce + 1, EthereumRaw: raw}); err != nil || replay {
			t.Fatalf("original Ethereum admission: replay=%v err=%v", replay, err)
		}
		d.ProduceBlock()
		// This existing trusted-input API also admits ordinary native transfers;
		// the original record deliberately contains no Ethereum envelope.
		if _, replay, err := d.SubmitSignedTransfer(chain.SignedTransferInput{Hash: nativeHash, From: eth.To, To: eth.From, Amount: 1, Fee: 1, Nonce: 1}); err != nil || replay {
			t.Fatalf("original native admission: replay=%v err=%v", replay, err)
		}
		d.ProduceBlock()
	})
	var original chain.Transaction
	for _, block := range f.migration.Runtime.Blocks {
		for i, tx := range block.Transactions {
			if tx.Hash == eth.Hash {
				original = tx
				if i != 1 {
					t.Fatal("fixture must retain a nonzero source transaction index")
				}
			}
		}
	}
	if original.BlockNum == 0 || original.Nonce != eth.Nonce+1 {
		t.Fatal("fixture lost original Ethereum inclusion or native nonce")
	}
	stateBefore, err := os.ReadFile(f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationBefore, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	var mode atomic.Value
	mode.Store("")
	var cometReads atomic.Int64
	base := f.serve(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/tx" {
			cometReads.Add(1)
			writeJSON(w, 200, map[string]any{"error": map[string]any{"code": -32603, "message": "tx not found"}})
			return
		}
		path, _ := strconv.Unquote(r.URL.Query().Get("path"))
		isBlock := strings.HasPrefix(path, consensus.MigrationHistoryBlockPath)
		if r.URL.Path != "/abci_query" || !isBlock && !strings.HasPrefix(path, consensus.MigrationHistoryTransactionPath) {
			base.ServeHTTP(w, r)
			return
		}
		current := mode.Load().(string)
		if current == "source-http" || current == "block-http" && isBlock {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		response, err := f.app.Query(r.Context(), &abci.RequestQuery{Path: path})
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		mutate := func(tx *chain.Transaction) {
			if tx.Hash != eth.Hash {
				return
			}
			switch current {
			case "amount":
				tx.Amount++
			case "nonce":
				tx.Nonce++
			case "malformed-memo":
				tx.Memo = ethnative.MemoPrefix + "zz"
			case "different-signed-memo":
				tx.Memo = ethnative.MemoPrefix + hex.EncodeToString(secondRaw)
			}
		}
		if isBlock {
			var view consensus.MigrationHistoryBlockView
			if err := json.Unmarshal(response.Value, &view); err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			if view.Block != nil {
				for i := range view.Block.Transactions {
					mutate(&view.Block.Transactions[i])
				}
				switch current {
				case "wrong-block":
					view.Block.Hash = strings.Repeat("b", 64)
				case "duplicate-position":
					view.Block.Transactions = append(view.Block.Transactions, original)
				case "missing-position":
					view.Block.Transactions = view.Block.Transactions[:1]
				case "different-record":
					view.Block.Transactions[1].Fee++
				case "block-anchor":
					view.SourceAnchor = strings.Repeat("c", 64)
				}
			}
			response.Value, err = json.Marshal(view)
		} else {
			var view consensus.MigrationHistoryTransactionView
			if err := json.Unmarshal(response.Value, &view); err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			if view.Transaction != nil {
				mutate(view.Transaction)
			}
			if current == "inconsistent-membership" {
				view.Found = false
			}
			response.Value, err = json.Marshal(view)
		}
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		writeJSON(w, 200, map[string]any{"result": map[string]any{"response": map[string]any{"code": response.Code, "height": strconv.FormatInt(response.Height, 10), "value": base64.StdEncoding.EncodeToString(response.Value)}}})
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.migration.Height, MigrationBlockHash: f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	read := func(method, hash string) ([]byte, map[string]any, string) {
		t.Helper()
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":%q,"params":[%q]}`, method, hash))))
		var response struct {
			Result map[string]any `json:"result"`
			Error  *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
			t.Fatal("invalid original Ethereum HTTP response", w.Code, w.Body.String())
		}
		if response.Error != nil {
			if response.Error.Code != -32602 || response.Result != nil {
				t.Fatal("source rejection changed the normal EVM error contract", w.Body.String())
			}
			return bytes.Clone(w.Body.Bytes()), nil, response.Error.Message
		}
		return bytes.Clone(w.Body.Bytes()), response.Result, ""
	}
	first, result, failure := read("eth_getTransactionByHash", eth.Hash)
	if failure != "" || result == nil {
		t.Fatal("normal original Ethereum query failed", failure)
	}
	for key, want := range map[string]string{
		"hash": eth.Hash, "from": eth.From, "to": eth.To, "value": ethnative.Quantity(eth.Value), "nonce": hexEVMQuantity(eth.Nonce),
		"gas": hexEVMQuantity(eth.Gas), "gasPrice": ethnative.Quantity(eth.GasPrice), "input": "0x", "type": "0x0", "chainId": "0x1917",
		"v": ethnative.Quantity(eth.V), "r": fmt.Sprintf("0x%064x", eth.R), "s": fmt.Sprintf("0x%064x", eth.S),
		"blockHash": "0x" + original.BlockHash, "blockNumber": hexEVMQuantity(original.BlockNum), "transactionIndex": "0x1",
	} {
		if result[key] != want {
			t.Fatalf("original %s changed: got=%v want=%s", key, result[key], want)
		}
	}
	anchor, ok := result["ynxSourceHistory"].(map[string]any)
	if !ok || anchor["source"] != "source_import" || anchor["sourceAnchor"] != f.migration.StateHash || result["independentFinality"] != false {
		t.Fatal("original transaction acquired new consensus authority", result)
	}
	for _, forbidden := range []string{"gasUsed", "status", "logsBloom", "stateRoot", "receiptsRoot", "cometHash", "cometIndex", "appHash"} {
		if _, exists := result[forbidden]; exists {
			t.Fatal("original transaction acquired invented execution evidence", forbidden)
		}
	}
	if _, _, failure := read("eth_getTransactionReceipt", eth.Hash); !strings.Contains(failure, "no retained Ethereum execution receipt") {
		t.Fatal("old receipt absence was masked or fabricated", failure)
	}
	if _, _, failure := read("eth_getTransactionByHash", nativeHash); !strings.Contains(failure, "historical Ethereum projection is unsupported") {
		t.Fatal("ordinary original native transaction was projected as Ethereum", failure)
	}
	for _, bad := range []string{"source-http", "block-http", "amount", "nonce", "malformed-memo", "different-signed-memo", "wrong-block", "duplicate-position", "missing-position", "different-record", "block-anchor", "inconsistent-membership"} {
		mode.Store(bad)
		if _, _, failure := read("eth_getTransactionByHash", eth.Hash); failure == "" {
			t.Fatal("invalid original source accepted", bad)
		}
	}
	mode.Store("")
	if cometReads.Load() != 0 {
		t.Fatal("original membership or source failure fell back to Comet")
	}
	cold, err := consensus.NewPersistentApplicationWithBootstrap(f.migration, f.statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	f.app = cold
	if again, _, failure := read("eth_getTransactionByHash", eth.Hash); failure != "" || !bytes.Equal(first, again) {
		t.Fatal("cold source query changed original Ethereum fields", failure)
	}
	if _, result, failure := read("eth_getTransactionByHash", "0x"+strings.Repeat("0", 64)); failure != "" || result != nil || cometReads.Load() != 1 {
		t.Fatal("explicit source nonmembership did not preserve original Comet lookup", failure, cometReads.Load())
	}
	stateAfter, err := os.ReadFile(f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationAfter, err := f.migration.CanonicalJSON()
	if err != nil || !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(migrationBefore, migrationAfter) {
		t.Fatal("original Ethereum read/cold recovery rewrote retained state or migration", err)
	}
}

func migrationEthereumVector(t *testing.T, name string) ([]byte, ethnative.Transfer) {
	t.Helper()
	data, err := os.ReadFile("../../testdata/ethereum-native/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Vectors []struct{ Name, Raw string } }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, vector := range fixture.Vectors {
		if vector.Name != name {
			continue
		}
		raw, err := hex.DecodeString(strings.TrimPrefix(vector.Raw, "0x"))
		if err != nil {
			t.Fatal(err)
		}
		eth, err := ethnative.Verify(raw, 6423)
		if err != nil {
			t.Fatal(err)
		}
		return raw, eth
	}
	t.Fatal("public original Ethereum vector absent", name)
	return nil, ethnative.Transfer{}
}
