package bftgateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// This exercises read-only EVM queries against an actual synthetic migration;
// no post-migration transaction or production account is used.
func TestEVMMigratedContractOriginalReads(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 71))
	owner, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	source, bytecode := gatewayBoundedFixture(t)
	var address string
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		if _, err := d.Faucet(owner, 1000); err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
		contract, _, err := d.DeployContractWithArgs(owner, "SampleEVMWriteCounter", source, []string{"7"})
		if err != nil {
			t.Fatal(err)
		}
		address = contract.Address
		d.ProduceBlock()
	})
	actual := newABCICometFixture(t, f.app, f.stateHeight)
	var badCaller atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, _ := strconv.Unquote(r.URL.Query().Get("path"))
		if !badCaller.Load() || !strings.HasPrefix(path, "/ide/call-as/") {
			actual.ServeHTTP(w, r)
			return
		}
		recorded := httptest.NewRecorder()
		actual.ServeHTTP(recorded, r)
		var envelope struct {
			Result struct {
				Response struct {
					Code   int    `json:"code"`
					Height string `json:"height"`
					Value  string `json:"value"`
				} `json:"response"`
			} `json:"result"`
		}
		if err := json.Unmarshal(recorded.Body.Bytes(), &envelope); err != nil {
			t.Error(err)
			http.Error(w, "fixture", 500)
			return
		}
		data, err := base64.StdEncoding.DecodeString(envelope.Result.Response.Value)
		if err != nil {
			t.Error(err)
			http.Error(w, "fixture", 500)
			return
		}
		var result map[string]any
		if err = json.Unmarshal(data, &result); err != nil {
			t.Error(err)
			http.Error(w, "fixture", 500)
			return
		}
		result["caller"] = "0x" + strings.Repeat("f", 40)
		data, err = json.Marshal(result)
		if err != nil {
			t.Error(err)
			http.Error(w, "fixture", 500)
			return
		}
		envelope.Result.Response.Value = base64.StdEncoding.EncodeToString(data)
		writeJSON(w, 200, envelope)
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["`+address+`","latest"]}`, bytecode)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_getStorageAt","params":["`+address+`","0x0","latest"]}`, "0x"+strings.Repeat("0", 63)+"7")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":3,"method":"eth_call","params":[{"to":"`+address+`","data":"0x06661abd"},"latest"]}`, "0x"+strings.Repeat("0", 63)+"7")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":4,"method":"eth_call","params":[{"from":"`+owner+`","to":"`+address+`","data":"0x06661abd"},"latest"]}`, "0x"+strings.Repeat("0", 63)+"7")
	badCaller.Store(true)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":5,"method":"eth_call","params":[{"from":"`+owner+`","to":"`+address+`","data":"0x06661abd"},"latest"]}`, -32603)
	badCaller.Store(false)
	contract, found, err := gateway.evmContractAtHeight(context.Background(), address, uint64(f.stateHeight))
	if err != nil || !found {
		t.Fatal("original contract unavailable", err)
	}
	for _, test := range []struct {
		name  string
		alter func(*consensus.BFTContract)
	}{
		{"wrong-anchor", func(c *consensus.BFTContract) { c.SourceAnchor = strings.Repeat("a", 64) }},
		{"invented-deployment", func(c *consensus.BFTContract) { c.BlockHeight = 1 }},
		{"changed-constructor", func(c *consensus.BFTContract) { c.ConstructorArgs = []string{"8"} }},
		{"changed-original-storage", func(c *consensus.BFTContract) {
			c.RuntimeStorage = map[string]string{"0x" + strings.Repeat("0", 64): "0x" + strings.Repeat("0", 63) + "8"}
		}},
		{"missing-update-receipt", func(c *consensus.BFTContract) {
			c.LastCallTxHash = "0x" + strings.Repeat("a", 64)
			c.LastUpdatedHeight = f.stateHeight
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			changed := contract
			test.alter(&changed)
			changed.AuditHash = consensus.BFTContractAuditHash(changed)
			if err := gateway.validateMigratedContractAtHeight(context.Background(), changed, address, uint64(f.stateHeight)); err == nil {
				t.Fatal("inconsistent original contract accepted")
			}
		})
	}
	if err := gateway.validateMigratedContractAtHeight(context.Background(), contract, address, uint64(f.stateHeight+1)); err == nil {
		t.Fatal("different-height original identity accepted")
	}
	wrongMigration, err := New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.migration.Height + 1, MigrationBlockHash: f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	if err := wrongMigration.validateMigratedContractAtHeight(context.Background(), contract, address, uint64(f.stateHeight)); err == nil {
		t.Fatal("different configured migration height accepted")
	}
}
