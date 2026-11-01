package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
)

func TestNetworkBlockWindowStartsBeforeSlowValidators(t *testing.T) {
	blockStarted := make(chan struct{})
	var once sync.Once
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("non-read request %s", r.Method)
		}
		switch r.URL.Path {
		case "/status":
			fmt.Fprintf(w, `{"height":10,"latestBlockHash":"%064x","level":"STATE_VERIFIED"}`, 10)
		case "/validators":
			select {
			case <-blockStarted:
			case <-time.After(2 * time.Second):
				t.Error("validator delayed all block reads")
			}
			fmt.Fprint(w, `{"validators":[]}`)
		default:
			h, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/blocks/"))
			if err != nil || h < 7 || h > 10 {
				t.Errorf("unbounded source route %s", r.URL.Path)
				http.NotFound(w, r)
				return
			}
			if h == 10 {
				once.Do(func() { close(blockStarted) })
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"height": h, "hash": fmt.Sprintf("%064x", h), "parentHash": fmt.Sprintf("%064x", h-1), "time": time.Date(2026, 11, 1, 12, 0, h*3, 0, time.UTC).Format(time.RFC3339Nano), "validator": "public_fixture", "transactions": []any{}})
		}
	}))
	defer upstream.Close()
	_, s := fixture(t, upstream.URL)
	ticket := pair(t, s)
	code, out := call(t, s, "/api/node-report", s.URL, ticket, struct{}{})
	if code != 200 || out["classification"] != receipt.RPCOnly {
		t.Fatal(code, out)
	}
	reports := out["reports"].(map[string]any)
	if reports["latestBlock"].(map[string]any)["status"] != "reported" {
		t.Fatal(reports)
	}
	sample := reports["recentBlocks"].(map[string]any)["data"].(map[string]any)
	if sample["headHeight"] != "10" || len(sample["blocks"].([]any)) != 4 || out["receivedAt"] == nil {
		t.Fatal(sample)
	}
	for _, item := range sample["blocks"].([]any) {
		report := item.(map[string]any)
		if report["status"] != "reported" || report["observedAt"] == nil || report["latencyMicros"] == nil {
			t.Fatal(report)
		}
	}
}

func TestNetworkBlockWindowKeepsPartialErrorsAndNeverGuessesTxCount(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			fmt.Fprint(w, `{"height":2}`)
		case "/validators":
			fmt.Fprint(w, `{"validators":[]}`)
		case "/blocks/2":
			fmt.Fprint(w, `{"height":2,"transactions":null}`)
		case "/blocks/1":
			http.Error(w, "source failure", 503)
		default:
			t.Errorf("unexpected source %s", r.URL.Path)
		}
	}))
	defer upstream.Close()
	_, s := fixture(t, upstream.URL)
	ticket := pair(t, s)
	_, out := call(t, s, "/api/node-report", s.URL, ticket, struct{}{})
	sample := out["reports"].(map[string]any)["recentBlocks"].(map[string]any)["data"].(map[string]any)["blocks"].([]any)
	if len(sample) != 2 || sample[0].(map[string]any)["data"].(map[string]any)["transactions"] != nil || sample[1].(map[string]any)["code"] != "RPC_HTTP_ERROR" {
		t.Fatal(sample)
	}
}
