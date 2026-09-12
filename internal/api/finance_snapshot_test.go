package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestFinanceSnapshotAliasAndTransactionDurability(t *testing.T) {
	dir := t.TempDir()
	cfg := chain.DefaultNetworkConfig("testnet")
	d, err := chain.NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	address := "0x1111111111111111111111111111111111111111"
	alias, err := accountaddress.Encode(address)
	if err != nil {
		t.Fatal(err)
	}
	tx, _, err := d.FaucetWithRequest(address, 100, "req_0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	request := func(path string) map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		NewServer(d).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s status %d: %s", path, w.Code, w.Body.String())
		}
		var b map[string]any
		if json.Unmarshal(w.Body.Bytes(), &b) != nil {
			t.Fatal("bad JSON")
		}
		return b
	}
	s := request("/v1/native-snapshot?account=" + alias)
	if s["account"].(map[string]any)["address"] != address || s["account"].(map[string]any)["balance"] != "100" {
		t.Fatal("snapshot account mapping mismatch")
	}
	lookup := request("/v1/native-transactions/" + tx.Hash)
	if lookup["status"] != "pending_durable" {
		t.Fatal("admission not durable")
	}
	d.ProduceBlock()
	d, err = chain.NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	lookup = request("/v1/native-transactions/" + tx.Hash)
	if lookup["status"] != "durable" || lookup["transaction"].(map[string]any)["amount"] != "100" {
		t.Fatal("cold receipt lost durable exact amount")
	}
	for _, query := range []string{"?account=bad", "?account=" + address + "&account=" + address, "?secret=x", "?account=%ZZ"} {
		w := httptest.NewRecorder()
		NewServer(d).ServeHTTP(w, httptest.NewRequest("GET", "/v1/native-snapshot"+query, nil))
		if w.Code != 400 {
			t.Fatalf("invalid query accepted: %s", query)
		}
	}
	w := httptest.NewRecorder()
	NewServer(d).ServeHTTP(w, httptest.NewRequest("GET", "/v1/native-transactions/0x"+strings.Repeat("f", 64), nil))
	if w.Code != 404 {
		t.Fatal("unknown transaction not explicit")
	}
}
