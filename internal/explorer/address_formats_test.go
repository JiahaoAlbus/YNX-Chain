package explorer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func TestAddressSearchDoesNotDependOnTransactionIndexer(t *testing.T) {
	formats, _ := accountaddress.Resolve("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf")
	var indexerRequests atomic.Int64
	idx := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		indexerRequests.Add(1)
		http.Error(w, "unavailable", 503)
	}))
	defer idx.Close()
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/contracts/") {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/accounts/"+formats.EVM {
			t.Errorf("unexpected upstream recipient %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": formats.EVM, "balance": 100, "nonce": 2}})
	}))
	defer rpc.Close()
	s, _ := New(Config{RPCURL: rpc.URL, IndexerURL: idx.URL})
	for _, input := range []string{formats.EVM, formats.YNX, strings.ToUpper(formats.EVM), strings.ToUpper(formats.YNX)} {
		result, err := s.Search(context.Background(), input)
		if err != nil || result.Type != "account" || result.NormalizedAddress != formats.EVM || result.Path != "/api/accounts/"+formats.EVM || result.DeepLink != "/address/"+formats.YNX {
			t.Fatalf("search %s: %+v %v", input, result, err)
		}
		detail, err := s.Account(context.Background(), input)
		if err != nil || detail.AddressFormats == nil || detail.AddressFormats.YNX != formats.YNX || detail.Account.Balance != 100 || detail.Account.Nonce != 2 {
			t.Fatalf("account %s: %+v %v", input, detail, err)
		}
	}
	if indexerRequests.Load() != 0 {
		t.Fatal("account lookup contacted failing transaction indexer")
	}
}

func TestExplorerConverterDoesNotRequireLiveChain(t *testing.T) {
	handler := NewServer(nil).Handler()
	for _, path := range []string{"/address", "/assets/ynx-address.js", "/assets/ynx-address-converter.js", "/favicon.ico", "/ynx-tab-icon.png", "/api/address?address=0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != 200 {
			t.Fatalf("address tool %s: %d", path, w.Code)
		}
	}
}

func TestContractSearchUsesNativeLinkAndCanonicalRPCIdentity(t *testing.T) {
	formats, _ := accountaddress.Resolve("0x2b5ad5c4795c026514f8317c7a215e218dccd6cf")
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/contracts/"+formats.EVM {
			t.Errorf("unexpected upstream contract %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"address": formats.EVM, "name": "Synthetic test contract"})
	}))
	defer rpc.Close()
	s, _ := New(Config{RPCURL: rpc.URL, IndexerURL: rpc.URL})
	for _, input := range []string{formats.EVM, formats.YNX, strings.ToUpper(formats.EVM), strings.ToUpper(formats.YNX)} {
		result, err := s.Search(context.Background(), input)
		if err != nil || result.Type != "contract" || result.NormalizedAddress != formats.EVM || result.Path != "/api/contracts/"+formats.EVM || result.DeepLink != "/contract/"+formats.YNX {
			t.Fatalf("contract search %s: %+v %v", input, result, err)
		}
	}
}
