package dex

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestEVMPollerConfirmedDecodeRestartAndReorg(t *testing.T) {
	factory := "0x00000000000000000000000000000000000000f1"
	pool := "0x0000000000000000000000000000000000000011"
	token0 := "0x0000000000000000000000000000000000000001"
	token1 := "0x0000000000000000000000000000000000000002"
	account := "0x00000000000000000000000000000000000000a1"
	blockHash := func(number uint64, reorg bool) string {
		offset := uint64(0)
		if reorg && number >= 14 {
			offset = 10_000
		}
		return fmt.Sprintf("0x%064x", number+offset)
	}
	txFactory, txLP := fmt.Sprintf("0x%064x", 91), fmt.Sprintf("0x%064x", 92)
	var reorganized atomic.Bool
	rpc := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var call struct {
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
			ID     any               `json:"id"`
		}
		if err := json.NewDecoder(request.Body).Decode(&call); err != nil {
			t.Error(err)
			return
		}
		var result any
		switch call.Method {
		case "eth_chainId":
			result = "0x1917"
		case "eth_blockNumber":
			result = "0x14"
		case "eth_getBlockByNumber":
			var number string
			_ = json.Unmarshal(call.Params[0], &number)
			parsed, _ := parseQuantity(number)
			result = evmBlock{Hash: blockHash(parsed, reorganized.Load()), Timestamp: fmt.Sprintf("0x%x", time.Now().Add(-time.Hour).Unix())}
		case "eth_getLogs":
			var filter map[string]json.RawMessage
			_ = json.Unmarshal(call.Params[0], &filter)
			var address string
			if json.Unmarshal(filter["address"], &address) == nil {
				if !reorganized.Load() {
					result = []evmLog{{Address: factory, Topics: []string{eventTopics["pool-created"], abiAddress(token0), abiAddress(token1)}, Data: "0x" + abiWordAddress(pool) + abiUint(1), BlockNumber: "0xa", BlockHash: blockHash(10, false), TxHash: txFactory, LogIndex: "0x0"}}
				} else {
					result = []evmLog{}
				}
			} else if !reorganized.Load() {
				zero := "0x0000000000000000000000000000000000000000"
				result = []evmLog{
					{Address: pool, Topics: []string{eventTopics["transfer"], abiAddress(zero), abiAddress(account)}, Data: "0x" + abiUint(500), BlockNumber: "0x11", BlockHash: blockHash(17, false), TxHash: txLP, LogIndex: "0x0"},
					{Address: pool, Topics: []string{eventTopics["sync"]}, Data: "0x" + abiUint(1_000) + abiUint(2_000), BlockNumber: "0x11", BlockHash: blockHash(17, false), TxHash: txLP, LogIndex: "0x1"},
					{Address: pool, Topics: []string{eventTopics["mint"], abiAddress(account), abiAddress(account)}, Data: "0x" + abiUint(1_000) + abiUint(2_000), BlockNumber: "0x11", BlockHash: blockHash(17, false), TxHash: txLP, LogIndex: "0x2"},
				}
			} else {
				result = []evmLog{}
			}
		case "eth_call":
			result = "0x" + abiUint(5_000) + abiUint(2_500) + abiUint(uint64(time.Now().Add(-time.Hour).Unix()))
		default:
			t.Errorf("unexpected method %s", call.Method)
			result = nil
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": result})
	}))
	defer rpc.Close()
	directory := t.TempDir()
	store, err := OpenStore(filepath.Join(directory, "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	cfg := EVMPollerConfig{RPCURL: rpc.URL, Factory: factory, StartBlock: 10, Confirmations: 2, BlockRange: 9, ReorgDepth: 4, CursorPath: filepath.Join(directory, "cursor.json"), CursorSecret: testSecret}
	poller, err := NewEVMPoller(store, cfg)
	if err != nil {
		t.Fatal(err)
	}
	advanced, err := poller.PollOnce(context.Background())
	if err != nil || !advanced {
		t.Fatalf("poll: %v %v", advanced, err)
	}
	if len(store.Events()) != 3 {
		t.Fatalf("events=%d", len(store.Events()))
	}
	positions := store.Positions(account)
	if len(positions) != 1 || positions[0].NetLPAmount != "500" || positions[0].AddedToken1 != "2000" {
		t.Fatalf("positions=%#v", positions)
	}
	restarted, err := NewEVMPoller(store, cfg)
	if err != nil || restarted.cursor.NextBlock != 19 || len(restarted.cursor.Pools) != 1 {
		t.Fatalf("restart=%#v %v", restarted, err)
	}
	reorganized.Store(true)
	advanced, err = restarted.PollOnce(context.Background())
	if err != nil || !advanced {
		t.Fatalf("reorg poll: %v %v", advanced, err)
	}
	if events := store.Events(); len(events) != 1 || events[0].Type != "pool-created" {
		t.Fatalf("reorg events=%#v", events)
	}
	data, _ := os.ReadFile(cfg.CursorPath)
	data = bytes.Replace(data, []byte(`"nextBlock": 19`), []byte(`"nextBlock": 22`), 1)
	_ = os.WriteFile(cfg.CursorPath, data, 0o600)
	if _, err := NewEVMPoller(store, cfg); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("tampered cursor accepted: %v", err)
	}
}

func TestEVMPollerRejectsWrongChainAndUnsafeConfig(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if _, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: "http://rpc", Factory: "bad", StartBlock: 1, CursorPath: "x", CursorSecret: testSecret}); err == nil {
		t.Fatal("bad factory accepted")
	}
	rpc := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(response).Encode(map[string]any{"jsonrpc": "2.0", "id": "ynx-dex", "result": "0x1"})
	}))
	defer rpc.Close()
	poller, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: rpc.URL, Factory: "0x0000000000000000000000000000000000000001", StartBlock: 1, CursorPath: filepath.Join(t.TempDir(), "cursor.json"), CursorSecret: testSecret})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = poller.PollOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "chain identity") {
		t.Fatalf("wrong chain accepted: %v", err)
	}
}

func abiUint(value uint64) string { return fmt.Sprintf("%064x", value) }
func abiWordAddress(address string) string {
	return strings.Repeat("0", 24) + strings.TrimPrefix(address, "0x")
}
func abiAddress(address string) string { return "0x" + abiWordAddress(address) }
