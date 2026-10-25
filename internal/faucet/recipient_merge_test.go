package faucet

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestAuthoritativeRecipientAliasesPreserveDurableRequestAndQuota(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var mutations atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/faucet/requests" {
			mutations.Add(1)
		}
		core.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	s := openTestFaucet(t, cfg)
	canonical := nativeAddress(t, 23)
	alias, err := accountaddress.Encode(canonical)
	if err != nil {
		t.Fatal(err)
	}
	request := Request{Address: alias, RequestID: admissionTestID}
	first, status, err := s.Request(context.Background(), request, "192.0.2.1:80")
	if err != nil || status != http.StatusCreated || first.Address != canonical || first.Transaction.To != canonical || first.TransactionHash != first.Transaction.Hash {
		t.Fatalf("alias was not bound to its canonical ledger recipient: %+v %d %v", first, status, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestFaucet(t, cfg)
	for _, address := range []string{canonical, strings.ToUpper(alias)} {
		request.Address = address
		replay, status, err := s.Request(context.Background(), request, "198.51.100.2:99")
		if err != nil || status != http.StatusOK || !replay.Replayed || replay.Address != canonical || replay.Transaction.Hash != first.Transaction.Hash || mutations.Load() != 1 {
			t.Fatalf("alias changed the original durable request: %+v %d %v mutations=%d", replay, status, err, mutations.Load())
		}
	}
	badChecksum := alias[:len(alias)-1] + "q"
	if strings.HasSuffix(alias, "q") {
		badChecksum = alias[:len(alias)-1] + "p"
	}
	for _, address := range []string{badChecksum, chain.FaucetAddress} {
		if _, status, err := s.Request(context.Background(), Request{Address: address, RequestID: "invalid_0123456789abcdef0123456789abcdef"}, "203.0.113.3:80"); err == nil || status != http.StatusBadRequest || mutations.Load() != 1 {
			t.Fatalf("invalid recipient reached authoritative mutation: %q %d %v", address, status, err)
		}
	}
	if _, status, err := s.Request(context.Background(), Request{Address: canonical, RequestID: "other_0123456789abcdef0123456789abcdef"}, "192.0.2.1:80"); err == nil || status != http.StatusTooManyRequests {
		t.Fatalf("cold alias replay lost its original quota identity: %d %v", status, err)
	}
	account, exists := d.Account(canonical)
	if !exists || account.Balance != cfg.DefaultAmount || mutations.Load() != 1 {
		t.Fatalf("canonical recipient was credited more than once: %+v mutations=%d", account, mutations.Load())
	}
}
