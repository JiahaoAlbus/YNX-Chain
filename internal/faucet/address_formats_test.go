package faucet

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestFaucetAddressFormatsDoNotCreateSeparateRecipients(t *testing.T) {
	formats, _ := accountaddress.Resolve("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf")
	for _, first := range []string{formats.YNX, formats.EVM, strings.ToUpper(formats.YNX), strings.ToUpper(formats.EVM)} {
		t.Run(first, func(t *testing.T) {
			devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
			rpc := httptest.NewServer(api.NewServer(devnet))
			defer rpc.Close()
			s, err := New(Config{RPCURL: rpc.URL, FaucetKey: "synthetic", DefaultAmount: 100, MaxAmount: 100, Window: time.Hour, MaxRequests: 1, RequestLog: t.TempDir() + "/requests.jsonl"})
			if err != nil {
				t.Fatal(err)
			}
			resp, status, err := s.Request(context.Background(), Request{Address: first}, "127.0.0.1:1000")
			if err != nil || status != 201 || resp.Address != formats.EVM || resp.Transaction.To != formats.EVM || resp.AddressFormats == nil || *resp.AddressFormats != formats {
				t.Fatalf("wrong recipient or display: %d %+v %v", status, resp, err)
			}
			for _, next := range []string{formats.YNX, formats.EVM, strings.ToUpper(formats.YNX), strings.ToUpper(formats.EVM)} {
				if !ValidAddress(next) {
					t.Fatalf("valid format rejected: %s", next)
				}
				_, status, err := s.Request(context.Background(), Request{Address: next}, "127.0.0.1:1001")
				if status != http.StatusTooManyRequests || err == nil {
					t.Fatalf("format changed quota: %s %d %v", next, status, err)
				}
			}
		})
	}
	if ValidAddress(formats.YNX[:len(formats.YNX)-1]+"q") || ValidAddress("0x1234") || ValidAddress("ynx1qqqqqq") {
		t.Fatal("invalid address accepted")
	}
}

func TestFaucetConverterDoesNotRequireService(t *testing.T) {
	handler := NewServer(nil).Handler()
	for _, path := range []string{"/address", "/assets/ynx-address.js", "/assets/ynx-address-converter.js", "/favicon.ico", "/api/address?address=0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != 200 {
			t.Fatalf("offline address tool %s: %d", path, w.Code)
		}
	}
}
