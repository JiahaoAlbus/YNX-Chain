package exchangeproduct

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGuestSnapshotProjectsActualMatchesWithoutPrivateAccountFields(t *testing.T) {
	service, chain, _ := newTestService(t)
	seller := accountSession(t, service, alice, "guest-feed-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, service, bob, "guest-feed-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, service, chain, seller, "aabbccddeeff0011", 20*AmountScale)
	if _, err := service.CreditTestQuote(adminKey, bob, 100*AmountScale, "feed-credit-buyer"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, service, seller, "sell", 2*AmountScale, 10*AmountScale, "feed-sell-order"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, service, buyer, "buy", 2*AmountScale, 4*AmountScale, "feed-buy-order"); err != nil {
		t.Fatal(err)
	}
	server := NewServer(service)
	for _, path := range []string{"/v1/market-data/snapshot", "/v1/market-data/trades", "/v1/orderbook"} {
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s: %d", path, response.Code)
		}
		body := response.Body.String()
		for _, forbidden := range []string{`"account"`, `"buyer"`, `"seller"`, `"authorizationDigest"`, `"reservedMicro"`, `"buyOrderId"`, `"sellOrderId"`, `"buyerFeeMicro"`, alice, bob} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s leaks private field %s", path, forbidden)
			}
		}
		if path == "/v1/market-data/snapshot" {
			var snapshot MarketDataSnapshot
			if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
				t.Fatal(err)
			}
			if snapshot.SchemaVersion != "exchange-public-market-v1" || len(snapshot.Trades) != 1 || len(snapshot.OrderBook.Asks) != 1 || snapshot.Trades[0].AmountMicro != 4*AmountScale || snapshot.OrderBook.Asks[0].FilledMicro != 4*AmountScale {
				t.Fatalf("snapshot not bound to actual partial match: %+v", snapshot)
			}
			if snapshot.Trades[0].SourceDigest != service.Snapshot(alice).Trades[0].SourceDigest {
				t.Fatal("public match digest drift")
			}
		}
	}
	// A new instance reads the persisted matches; no price/depth seed is needed.
	restarted, err := New(service.cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	response := httptest.NewRecorder()
	NewServer(restarted).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/market-data/snapshot", nil))
	var after MarketDataSnapshot
	if err := json.Unmarshal(response.Body.Bytes(), &after); err != nil {
		t.Fatal(err)
	}
	if len(after.Trades) != 1 || after.Trades[0].ID != service.PublicTrades(1)[0].ID {
		t.Fatal("restart lost matched data")
	}
	privateResponse := httptest.NewRecorder()
	server.ServeHTTP(privateResponse, httptest.NewRequest(http.MethodGet, "/v1/account", nil))
	if privateResponse.Code == http.StatusOK {
		t.Fatal("guest gained account capability")
	}
}

func TestGuestClientConsumesActualHTTPAndMatchesForTwoIndependentReaders(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js required for Web transport integration")
	}
	service, chain, _ := newTestService(t)
	seller := accountSession(t, service, alice, "two-readers-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, service, bob, "two-readers-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, service, chain, seller, "aabbccddeeff2233", 20*AmountScale)
	if _, err := service.CreditTestQuote(adminKey, bob, 100*AmountScale, "two-readers-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, service, seller, "sell", 2*AmountScale, 10*AmountScale, "two-readers-sell"); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", NewServer(service)))
	server := httptest.NewServer(mux)
	defer server.Close()
	type reader struct {
		command *exec.Cmd
		lines   chan string
		errors  bytes.Buffer
	}
	readers := []*reader{}
	for i := 0; i < 2; i++ {
		r := &reader{command: exec.Command(node, filepath.Join("..", "..", "apps", "exchange", "tests", "http-market-flow.mjs"), server.URL), lines: make(chan string, 3)}
		r.command.Stderr = &r.errors
		stdout, err := r.command.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := r.command.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = r.command.Process.Kill() })
		go func() {
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				r.lines <- scanner.Text()
			}
			close(r.lines)
		}()
		readers = append(readers, r)
	}
	for _, r := range readers {
		select {
		case line := <-r.lines:
			if line != "READY" {
				t.Fatalf("reader not ready: %s", line)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("reader timeout")
		}
	}
	// Test-only keys and chain input drive the real venue matching code. Both
	// independent guest processes consume its public HTTP/SSE projection.
	if _, err := place(t, service, buyer, "buy", 2*AmountScale, 4*AmountScale, "two-readers-buy"); err != nil {
		t.Fatal(err)
	}
	expected := "MATCH=" + service.PublicTrades(1)[0].SourceDigest
	for _, r := range readers {
		select {
		case line := <-r.lines:
			if line != expected {
				t.Fatalf("wrong match: %s", line)
			}
		case <-time.After(8 * time.Second):
			t.Fatal("match timeout")
		}
		if err := r.command.Wait(); err != nil {
			t.Fatalf("Web transport failed: %v %s", err, r.errors.String())
		}
	}
}
