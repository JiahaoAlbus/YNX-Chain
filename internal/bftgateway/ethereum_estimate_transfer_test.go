package bftgateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// A plain transfer uses the same bounded gas profile as the Chain transaction
// decoder. Estimation is a quote, not an account authorization or finality.
func TestGatewayEstimateGasForEthereumValueTransfer(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 71))
	from, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	to := "0x3535353535353535353535353535353535353535"
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err = d.Faucet(from, 100000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(newABCICometFixture(t, app, int64(migration.Height)))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"`+from+`","to":"`+to+`","value":"0x7d","gasPrice":"0x2"}]}`, "0x5208")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_estimateGas","params":[{"from":"`+from+`","to":"`+to+`","value":"0x7d","maxPriorityFeePerGas":"0x1","maxFeePerGas":"0x2","accessList":[]}]}`, "0x5208")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":6,"method":"eth_estimateGas","params":[{"to":"`+to+`","value":"0x1","accessList":[ ]}]}`, "0x5208")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":5,"method":"eth_estimateGas","params":[{"to":"`+to+`","value":"0x1","data":"0x"}]}`, "0x5208")
	// Calls carrying actual calldata must remain on the pre-existing bounded
	// contract path, rather than receiving a simple-transfer gas quote.
	_, _, handled, err := gateway.evmEstimateValueTransfer(context.Background(), []json.RawMessage{json.RawMessage(`{"to":"` + to + `","data":"0x06661abd"}`)})
	if handled || err != nil {
		t.Fatalf("contract call was intercepted: handled=%v err=%v", handled, err)
	}
	for _, tc := range []struct {
		call string
		code int
	}{
		{`{"from":"` + from + `","to":"` + to + `","value":"0x7d","gas":"0x61a8"}`, -32602},
		{`{"from":"` + from + `","to":"` + to + `","value":"0x7d","nonce":"0x1"}`, -32000},
		{`{"to":"` + to + `","value":"0x1","nonce":"0xgarbage"}`, -32602},
		{`{"to":"` + to + `","value":"0x1","nonce":"0xffffffffffffffff"}`, -32602},
		{`{"from":"` + from + `","to":"` + to + `","value":"0x7d","gasPrice":"0x5"}`, -32000},
		{`{"to":"` + to + `","value":"0x0"}`, -32602},
		{`{"to":"` + to + `","value":"0x1","accessList":[{}]}`, -32602},
		{`{"to":"` + to + `","value":"0x1","accessList":null}`, -32602},
		{`{"to":"` + to + `","value":"0x1","chainId":"0x1"}`, -32602},
	} {
		assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":3,"method":"eth_estimateGas","params":[`+tc.call+`]}`, tc.code)
	}

	// A status H followed by an ABCI account snapshot at H+1 must not be
	// reported as an estimate for H, even when the bytes otherwise look valid.
	fixture := newABCICometFixture(t, app, int64(migration.Height))
	racing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := httptest.NewRecorder()
		fixture.ServeHTTP(rec, r)
		if r.URL.Path == "/abci_query" {
			path, _ := strconv.Unquote(r.URL.Query().Get("path"))
			if path == "/accounts/"+from {
				var body map[string]any
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				body["result"].(map[string]any)["response"].(map[string]any)["height"] = fmt.Sprint(migration.Height + 1)
				_ = json.NewEncoder(w).Encode(body)
				return
			}
		}
		w.WriteHeader(rec.Code)
		_, _ = w.Write(rec.Body.Bytes())
	}))
	defer racing.Close()
	racingGateway, err := New(Config{CometRPCURL: racing.URL})
	if err != nil {
		t.Fatal(err)
	}
	racingServer := httptest.NewServer(racingGateway.Handler())
	defer racingServer.Close()
	assertRPCError(t, racingServer.URL+"/evm", `{"jsonrpc":"2.0","id":4,"method":"eth_estimateGas","params":[{"from":"`+from+`","to":"`+to+`","value":"0x1"}]}`, -32603)
}
