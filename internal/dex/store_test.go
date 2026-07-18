package dex

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var testSecret = bytes.Repeat([]byte{0x42}, 32)

func fixture(index uint64, kind string) Event {
	return Event{ID: fmt.Sprintf("event-abcdefghijkl-%d", index), ChainID: 6423, ContractVersion: "ynx-dex-cpmm-v1", BlockNumber: 100 + index, BlockHash: fmt.Sprintf("0x%064x", 100+index), TxHash: fmt.Sprintf("0x%064x", 200+index), LogIndex: index, Type: kind, Pool: "0x0000000000000000000000000000000000000011", Account: "ynx1abcdefghijklmnopqrstuv", Token0: "0x0000000000000000000000000000000000000001", Token1: "0x0000000000000000000000000000000000000002", Amount0: "100", Amount1: "200", LPAmount: "50", Fee0: "1", Fee1: "0", Reserve0: "10000", Reserve1: "20000", Timestamp: time.Now().Add(-time.Minute).UTC()}
}

func TestStoreRestartReplayTamperAndConflict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(path, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	event := fixture(1, "liquidity-add")
	created, err := store.Append(event)
	if err != nil || !created {
		t.Fatalf("append %v %v", created, err)
	}
	created, err = store.Append(event)
	if err != nil || created {
		t.Fatalf("idempotency %v %v", created, err)
	}
	if _, err = store.Append(func() Event { value := event; value.Amount0 = "999"; return value }()); err == nil {
		t.Fatal("conflicting replay accepted")
	}
	restarted, err := OpenStore(path, testSecret)
	if err != nil || len(restarted.Events()) != 1 {
		t.Fatalf("restart %v", err)
	}
	data, _ := os.ReadFile(path)
	data = bytes.Replace(data, []byte(`"reserve0": "10000"`), []byte(`"reserve0": "99999"`), 1)
	_ = os.WriteFile(path, data, 0o600)
	if _, err = OpenStore(path, testSecret); err == nil {
		t.Fatal("tampered store accepted")
	}
}

func TestConcurrentAppendIsAtomic(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for i := uint64(1); i <= 40; i++ {
		group.Add(1)
		go func(index uint64) {
			defer group.Done()
			if _, err := store.Append(fixture(index, "swap")); err != nil {
				t.Errorf("append %d: %v", index, err)
			}
		}(i)
	}
	group.Wait()
	if len(store.Events()) != 40 {
		t.Fatalf("events=%d", len(store.Events()))
	}
}

type allowSession struct{}

func (allowSession) Authorize(_ context.Context, binding, account string, scopes []string) error {
	if binding == strings.Repeat("a", 64) && len(scopes) == 2 {
		return nil
	}
	return errors.New("rejected")
}

func TestServerStrictSchemaAuthAndTruthfulSources(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	server, err := NewServer(store, buildinfo.Info{Commit: "abc123", Release: "test"}, strings.Repeat("k", 32), allowSession{})
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	event := fixture(1, "liquidity-add")
	data, _ := json.Marshal(event)
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/events", bytes.NewReader(data))
	request.Header.Set("X-YNX-DEX-Indexer-Key", strings.Repeat("k", 32))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("ingest %d %s", response.Code, response.Body.String())
	}
	bad := map[string]any{}
	_ = json.Unmarshal(data, &bad)
	bad["unknown"] = true
	data, _ = json.Marshal(bad)
	request = httptest.NewRequest(http.MethodPost, "/internal/v1/events", bytes.NewReader(data))
	request.Header.Set("X-YNX-DEX-Indexer-Key", strings.Repeat("k", 32))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields %d", response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/account/positions", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing wallet session %d", response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/account/positions", nil)
	request.Header.Set("X-YNX-Account", event.Account)
	request.Header.Set("X-YNX-Session-Binding", strings.Repeat("a", 64))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "netLpAmount") {
		t.Fatalf("positions %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/analytics", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if !strings.Contains(response.Body.String(), "YNX Testnet EVM events") {
		t.Fatal("analytics source is not explicit")
	}
}
