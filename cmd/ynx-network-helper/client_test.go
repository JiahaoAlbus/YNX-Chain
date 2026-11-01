package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
)

func clientStore(t *testing.T, h *helper) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "private")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "client-receipts.json")
	s, err := receipt.OpenReceiptStore(path)
	if err != nil {
		t.Fatal(err)
	}
	h.receipts = s
	t.Cleanup(func() { _ = s.Close() })
	return path
}
func TestClientNodePartialSourcesNeverBecomeAuthority(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("non-read source operation: %s", r.Method)
		}
		switch r.URL.Path {
		case "/status":
			io.WriteString(w, `{"height":42,"level":"STATE_VERIFIED","nativeGrant":true}`)
		case "/blocks/42":
			w.WriteHeader(503)
		case "/blocks/41", "/blocks/40", "/blocks/39":
			w.WriteHeader(503)
		case "/validators":
			io.WriteString(w, `malformed`)
		default:
			t.Errorf("unexpected route %s", r.URL.Path)
		}
	}))
	defer upstream.Close()
	_, s := fixture(t, upstream.URL)
	ticket := pair(t, s)
	code, out := call(t, s, "/api/node-report", s.URL, ticket, struct{}{})
	if code != 200 || out["classification"] != receipt.RPCOnly {
		t.Fatalf("report: %d %v", code, out)
	}
	reports := out["reports"].(map[string]any)
	if reports["status"].(map[string]any)["status"] != "reported" || reports["latestBlock"].(map[string]any)["code"] != "RPC_HTTP_ERROR" || reports["validators"].(map[string]any)["code"] != "RPC_INVALID_JSON" {
		t.Fatalf("partial reports %v", reports)
	}
}
func TestClientRevokedLateTransportCannotPersistReceipt(t *testing.T) {
	h, s := fixture(t, "https://rpc.example")
	clientStore(t, h)
	ticket := pair(t, s)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	h.client = &http.Client{Transport: lifecycleTransport(func(r *http.Request) (*http.Response, error) {
		once.Do(func() { close(started) })
		<-release
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"level":"STATE_VERIFIED","nativeGrant":true}`))}, nil
	})}
	done := make(chan struct{})
	var code int
	go func() {
		defer close(done)
		code, _ = call(t, s, "/api/client-receipt", s.URL, ticket, map[string]string{"txId": knownTx})
	}()
	awaitLifecycle(t, started)
	if status, _ := call(t, s, "/api/revoke", s.URL, ticket, nil); status != 200 {
		t.Fatal(status)
	}
	close(release)
	awaitLifecycle(t, done)
	if code != 401 || len(h.receipts.List()) != 0 {
		t.Fatalf("late computation persisted: HTTP %d, records %v", code, h.receipts.List())
	}
}
func TestClientOriginalReceiptImmutableAndCorruptionPreserved(t *testing.T) {
	h, _ := fixture(t, "https://rpc.example")
	path := clientStore(t, h)
	view, _ := json.Marshal(receipt.ProofView{TxID: knownTx, Level: receipt.RPCOnly, Source: "https://rpc.example/proof", Reason: "NO_INDEPENDENT_TRUST", Detail: "original first cause"})
	reportText := "{\n \"status\":\"reported\",\"amount\":9007199254740993\n}"
	original, err := h.receipts.Save(receipt.ClientReceipt{TxID: knownTx, View: view, Report: json.RawMessage(reportText), ReportText: reportText})
	if err != nil {
		t.Fatal(err)
	}
	original.Report[0] = '!'
	loaded, ok := h.receipts.Get(original.ReceiptID)
	if !ok || !json.Valid(loaded.Report) {
		t.Fatal("caller mutated saved receipt")
	}
	if _, err := receipt.OpenReceiptStore(path); err == nil {
		t.Fatal("second process store owner accepted")
	}
	if err := h.receipts.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := receipt.OpenReceiptStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := store.Get(original.ReceiptID)
	if !ok || string(got.View) != string(view) || string(got.Report) != string(loaded.Report) || got.ReportText != reportText {
		t.Fatalf("original bytes changed %v", got)
	}
	summaries := store.List()
	if len(summaries) != 1 || summaries[0].ReceiptID != original.ReceiptID || summaries[0].ReportedLevel != receipt.RPCOnly || summaries[0].Source != "https://rpc.example/proof" || summaries[0].Reason != "NO_INDEPENDENT_TRUST" || summaries[0].Detail != "original first cause" {
		t.Fatalf("historical source or first cause lost after restart: %+v", summaries)
	}
	summaries[0].Reason = "caller replacement"
	if store.List()[0].Reason != "NO_INDEPENDENT_TRUST" {
		t.Fatal("caller changed stored first cause through a history projection")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := string(raw) + "!"
	if err := os.WriteFile(path, []byte(corrupt), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := receipt.OpenReceiptStore(path); err == nil {
		t.Fatal("corrupt record accepted")
	}
	after, _ := os.ReadFile(path)
	if string(after) != corrupt {
		t.Fatal("corrupt first cause overwritten")
	}
}
