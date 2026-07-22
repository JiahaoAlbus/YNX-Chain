package dex

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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

func TestCursorMigratesV1AndRewindsWhenVaultIndexingIsEnabled(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "cursor.json")
	factory := "0x00000000000000000000000000000000000000f1"
	vault := "0x00000000000000000000000000000000000000f2"
	legacy := pollCursor{SchemaVersion: 1, NextBlock: 50, LastBlockHash: fmt.Sprintf("0x%064x", 49), Pools: []poolIdentity{{Address: "0x0000000000000000000000000000000000000011", Token0: "0x0000000000000000000000000000000000000001", Token1: "0x0000000000000000000000000000000000000002", CreatedBlock: 10}}}
	payload, _ := json.Marshal(legacy)
	mac := hmac.New(sha256.New, testSecret)
	_, _ = mac.Write(payload)
	data, _ := json.MarshalIndent(cursorEnvelope{Cursor: legacy, Integrity: hex.EncodeToString(mac.Sum(nil))}, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	store, _ := OpenStore(filepath.Join(directory, "state.json"), testSecret)
	cfg := EVMPollerConfig{RPCURL: "http://rpc.invalid", Factory: factory, StrategyVault: vault, StartBlock: 10, CursorPath: path, CursorSecret: testSecret}
	poller, err := NewEVMPoller(store, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if poller.cursor.SchemaVersion != 2 || poller.cursor.NextBlock != 10 || poller.cursor.LastBlockHash != "" || poller.cursor.StrategyVault != vault {
		t.Fatalf("cursor=%#v", poller.cursor)
	}
	backup, err := os.ReadFile(path + ".schema-v1.bak")
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("backup %v", err)
	}
	other := cfg
	other.StrategyVault = "0x00000000000000000000000000000000000000f3"
	if _, err := NewEVMPoller(store, other); err == nil || !strings.Contains(err.Error(), "binding mismatch") {
		t.Fatalf("vault substitution accepted: %v", err)
	}
}

func TestEVMPollerConfirmedDecodeRestartAndReorg(t *testing.T) {
	factory := "0x00000000000000000000000000000000000000f1"
	vault := "0x00000000000000000000000000000000000000f2"
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
	txFactory, txLP, txVault := fmt.Sprintf("0x%064x", 91), fmt.Sprintf("0x%064x", 92), fmt.Sprintf("0x%064x", 93)
	vaultMethod := functionSelector("swapExactInput(uint256,uint256,uint256,address[],uint256)")
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
				if strings.EqualFold(address, factory) && !reorganized.Load() {
					result = []evmLog{{Address: factory, Topics: []string{eventTopics["pool-created"], abiAddress(token0), abiAddress(token1)}, Data: "0x" + abiWordAddress(pool) + abiUint(1), BlockNumber: "0xa", BlockHash: blockHash(10, false), TxHash: txFactory, LogIndex: "0x0"}}
				} else if strings.EqualFold(address, vault) && !reorganized.Load() {
					result = []evmLog{{Address: vault, Topics: []string{eventTopics["vault-action"], "0x" + abiUint(7), abiBytes4(vaultMethod)}, Data: "0x" + abiUint(10_000) + abiUint(9_999), BlockNumber: "0x12", BlockHash: blockHash(18, false), TxHash: txVault, LogIndex: "0x3"}}
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
			var callObject map[string]string
			_ = json.Unmarshal(call.Params[0], &callObject)
			if strings.EqualFold(callObject["to"], vault) && callObject["data"] == nonceDomainSelector {
				result = "0x" + abiUint(777)
			} else {
				result = "0x" + abiUint(5_000) + abiUint(2_500) + abiUint(uint64(time.Now().Add(-time.Hour).Unix()))
			}
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
	cfg := EVMPollerConfig{RPCURL: rpc.URL, Factory: factory, StrategyVault: vault, StartBlock: 10, Confirmations: 2, BlockRange: 9, ReorgDepth: 4, CursorPath: filepath.Join(directory, "cursor.json"), CursorSecret: testSecret}
	poller, err := NewEVMPoller(store, cfg)
	if err != nil {
		t.Fatal(err)
	}
	advanced, err := poller.PollOnce(context.Background())
	if err != nil || !advanced {
		t.Fatalf("poll: %v %v", advanced, err)
	}
	if len(store.Events()) != 4 {
		t.Fatalf("events=%d", len(store.Events()))
	}
	actions := store.VaultActions(vault)
	if len(actions) != 1 || actions[0].ActionNonce != "7" || actions[0].Method != "swapExactInput" || actions[0].NonceDomain != fmt.Sprintf("0x%064x", 777) {
		t.Fatalf("vault actions=%#v", actions)
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
	if _, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: "http://rpc", Factory: "0x0000000000000000000000000000000000000001", StrategyVault: "bad", StartBlock: 1, CursorPath: "x", CursorSecret: testSecret}); err == nil {
		t.Fatal("bad strategy vault accepted")
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
func abiBytes4(selector string) string {
	return "0x" + strings.TrimPrefix(selector, "0x") + strings.Repeat("0", 56)
}
