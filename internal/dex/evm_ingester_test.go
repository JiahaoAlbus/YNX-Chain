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
	fairFlow := "0x00000000000000000000000000000000000000f4"
	legacy := pollCursor{SchemaVersion: 1, NextBlock: 50, LastBlockHash: fmt.Sprintf("0x%064x", 49), Pools: []poolIdentity{{Address: "0x0000000000000000000000000000000000000011", Token0: "0x0000000000000000000000000000000000000001", Token1: "0x0000000000000000000000000000000000000002", CreatedBlock: 10}}}
	payload, _ := json.Marshal(legacy)
	mac := hmac.New(sha256.New, testSecret)
	_, _ = mac.Write(payload)
	data, _ := json.MarshalIndent(cursorEnvelope{Cursor: legacy, Integrity: hex.EncodeToString(mac.Sum(nil))}, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	store, _ := OpenStore(filepath.Join(directory, "state.json"), testSecret)
	cfg := EVMPollerConfig{RPCURL: "http://rpc.invalid", Factory: factory, StrategyVault: vault, FairFlow: fairFlow, StartBlock: 10, CursorPath: path, CursorSecret: testSecret}
	poller, err := NewEVMPoller(store, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if poller.cursor.SchemaVersion != 4 || poller.cursor.NextBlock != 10 || poller.cursor.LastBlockHash != "" || poller.cursor.StrategyVault != vault || poller.cursor.FairFlow != fairFlow {
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
	other = cfg
	other.FairFlow = "0x00000000000000000000000000000000000000f5"
	if _, err := NewEVMPoller(store, other); err == nil || !strings.Contains(err.Error(), "binding mismatch") {
		t.Fatalf("FairFlow substitution accepted: %v", err)
	}
}

func TestCursorMigratesV2AndRewindsWhenFairFlowIndexingIsEnabled(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "cursor.json")
	factory := "0x00000000000000000000000000000000000000f1"
	vault := "0x00000000000000000000000000000000000000f2"
	fairFlow := "0x00000000000000000000000000000000000000f4"
	legacy := pollCursor{SchemaVersion: 2, StrategyVault: vault, NextBlock: 75, LastBlockHash: fmt.Sprintf("0x%064x", 74), Pools: []poolIdentity{}}
	payload, _ := json.Marshal(legacy)
	mac := hmac.New(sha256.New, testSecret)
	_, _ = mac.Write(payload)
	data, _ := json.MarshalIndent(cursorEnvelope{Cursor: legacy, Integrity: hex.EncodeToString(mac.Sum(nil))}, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	store, _ := OpenStore(filepath.Join(directory, "state.json"), testSecret)
	poller, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: "http://rpc.invalid", Factory: factory, StrategyVault: vault, FairFlow: fairFlow, StartBlock: 10, CursorPath: path, CursorSecret: testSecret})
	if err != nil {
		t.Fatal(err)
	}
	if poller.cursor.SchemaVersion != 4 || poller.cursor.NextBlock != 10 || poller.cursor.LastBlockHash != "" || poller.cursor.FairFlow != fairFlow {
		t.Fatalf("cursor=%#v", poller.cursor)
	}
	backup, err := os.ReadFile(path + ".schema-v2.bak")
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("backup %v", err)
	}
}

func TestCursorMigratesV3AndRewindsWhenLPProtectionIndexingIsEnabled(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "cursor.json")
	factory := "0x00000000000000000000000000000000000000f1"
	vault := "0x00000000000000000000000000000000000000f2"
	fairFlow := "0x00000000000000000000000000000000000000f4"
	protection := "0x00000000000000000000000000000000000000f5"
	legacy := pollCursor{SchemaVersion: 3, StrategyVault: vault, FairFlow: fairFlow, NextBlock: 90, LastBlockHash: fmt.Sprintf("0x%064x", 89), Pools: []poolIdentity{}}
	payload, _ := json.Marshal(legacy)
	mac := hmac.New(sha256.New, testSecret)
	_, _ = mac.Write(payload)
	data, _ := json.MarshalIndent(cursorEnvelope{Cursor: legacy, Integrity: hex.EncodeToString(mac.Sum(nil))}, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	store, _ := OpenStore(filepath.Join(directory, "state.json"), testSecret)
	cfg := EVMPollerConfig{RPCURL: "http://rpc.invalid", Factory: factory, StrategyVault: vault, FairFlow: fairFlow, LPProtection: protection, StartBlock: 10, CursorPath: path, CursorSecret: testSecret}
	poller, err := NewEVMPoller(store, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if poller.cursor.SchemaVersion != 4 || poller.cursor.NextBlock != 10 || poller.cursor.LastBlockHash != "" || poller.cursor.LPProtection != protection {
		t.Fatalf("cursor=%#v", poller.cursor)
	}
	backup, err := os.ReadFile(path + ".schema-v3.bak")
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("backup %v", err)
	}
	other := cfg
	other.LPProtection = "0x00000000000000000000000000000000000000f6"
	if _, err := NewEVMPoller(store, other); err == nil || !strings.Contains(err.Error(), "binding mismatch") {
		t.Fatalf("LP protection substitution accepted: %v", err)
	}
}

func TestEVMPollerConfirmedDecodeRestartAndReorg(t *testing.T) {
	factory := "0x00000000000000000000000000000000000000f1"
	vault := "0x00000000000000000000000000000000000000f2"
	fairFlow := "0x00000000000000000000000000000000000000f4"
	protection := "0x00000000000000000000000000000000000000f5"
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
	txFactory, txLP, txVault, txFair, txProtection := fmt.Sprintf("0x%064x", 91), fmt.Sprintf("0x%064x", 92), fmt.Sprintf("0x%064x", 93), fmt.Sprintf("0x%064x", 94), fmt.Sprintf("0x%064x", 95)
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
				} else if strings.EqualFold(address, fairFlow) && !reorganized.Load() {
					result = []evmLog{{Address: fairFlow, Topics: []string{eventTopics["fair-winner-finalized"], "0x" + abiUint(3), abiAddress(account)}, Data: "0x" + abiUint(2) + abiUint(100) + abiUint(55) + abiUint(700) + abiUint(701), BlockNumber: "0x12", BlockHash: blockHash(18, false), TxHash: txFair, LogIndex: "0x4"}}
				} else if strings.EqualFold(address, protection) && !reorganized.Load() {
					result = []evmLog{{Address: protection, Topics: []string{eventTopics["protection-assessed"], abiAddress(pool), abiAddress(token0), fmt.Sprintf("0x%064x", 702)}, Data: "0x" + abiUint(10_000) + abiUint(145) + abiUint(30) + abiUint(50) + abiUint(10) + abiUint(0) + abiUint(5) + abiUint(50) + abiUint(0) + abiUint(uint64(time.Now().Add(-time.Hour).Unix())), BlockNumber: "0x12", BlockHash: blockHash(18, false), TxHash: txProtection, LogIndex: "0x5"}}
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
	cfg := EVMPollerConfig{RPCURL: rpc.URL, Factory: factory, StrategyVault: vault, FairFlow: fairFlow, LPProtection: protection, StartBlock: 10, Confirmations: 2, BlockRange: 9, ReorgDepth: 4, CursorPath: filepath.Join(directory, "cursor.json"), CursorSecret: testSecret}
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
	fairEvents := store.FairFlowEvents(fairFlow)
	if len(fairEvents) != 1 || fairEvents[0].Type != "winner-finalized" || fairEvents[0].BatchID != "3" || fairEvents[0].Details["rebateBps"] != "100" || fairEvents[0].Details["bestExecutionDigest"] != fmt.Sprintf("0x%064x", 701) {
		t.Fatalf("FairFlow events=%#v", fairEvents)
	}
	protectionEvents := store.LPProtectionEvents(protection, pool)
	if len(protectionEvents) != 1 || protectionEvents[0].Type != "assessed" || protectionEvents[0].Details["totalFeeBps"] != "145" || protectionEvents[0].Details["realizedFeeAmount"] != "145" {
		t.Fatalf("LP protection events=%#v", protectionEvents)
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
	if err != nil || restarted.cursor.NextBlock != 19 || len(restarted.cursor.Pools) != 1 || restarted.cursor.FairFlow != fairFlow || restarted.cursor.LPProtection != protection {
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
	if len(store.FairFlowEvents(fairFlow)) != 0 {
		t.Fatal("reorg retained FairFlow events")
	}
	if len(store.LPProtectionEvents(protection, "")) != 0 {
		t.Fatal("reorg retained LP protection events")
	}
	data, _ := os.ReadFile(cfg.CursorPath)
	data = bytes.Replace(data, []byte(`"nextBlock": 19`), []byte(`"nextBlock": 22`), 1)
	_ = os.WriteFile(cfg.CursorPath, data, 0o600)
	if _, err := NewEVMPoller(store, cfg); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("tampered cursor accepted: %v", err)
	}
}

func TestDecodeEveryFairFlowLifecycleEventAndRejectMalformedBoolean(t *testing.T) {
	fairFlow := "0x00000000000000000000000000000000000000f4"
	token0 := "0x0000000000000000000000000000000000000001"
	token1 := "0x0000000000000000000000000000000000000002"
	actor := "0x00000000000000000000000000000000000000a1"
	intentID := fmt.Sprintf("0x%064x", 501)
	reason := fmt.Sprintf("0x%064x", 502)
	blockHash := fmt.Sprintf("0x%064x", 503)
	timestamp := time.Now().Add(-time.Minute).Unix()
	rpc := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var call struct {
			Method string `json:"method"`
			ID     any    `json:"id"`
		}
		if err := json.NewDecoder(request.Body).Decode(&call); err != nil {
			t.Error(err)
			return
		}
		if call.Method != "eth_getBlockByNumber" {
			t.Errorf("unexpected method %s", call.Method)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": evmBlock{Hash: blockHash, Timestamp: fmt.Sprintf("0x%x", timestamp)}})
	}))
	defer rpc.Close()
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	poller, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: rpc.URL, Factory: "0x00000000000000000000000000000000000000f1", FairFlow: fairFlow, StartBlock: 1, CursorPath: filepath.Join(t.TempDir(), "cursor.json"), CursorSecret: testSecret})
	if err != nil {
		t.Fatal(err)
	}
	batchTopic := "0x" + abiUint(7)
	transaction := func(index uint64) string { return fmt.Sprintf("0x%064x", 600+index) }
	log := func(index uint64, topics []string, words ...string) evmLog {
		return evmLog{Address: fairFlow, Topics: topics, Data: "0x" + strings.Join(words, ""), BlockNumber: "0xb", BlockHash: blockHash, TxHash: transaction(index), LogIndex: fmt.Sprintf("0x%x", index)}
	}
	logs := []evmLog{
		log(0, []string{eventTopics["fair-batch-opened"], batchTopic, abiAddress(token0), abiAddress(token1)}, abiUint(10), abiUint(20), abiUint(30), abiUint(40)),
		log(1, []string{eventTopics["fair-intent-submitted"], intentID, batchTopic, abiAddress(actor)}, abiUint(1), abiUint(100), abiUint(95), abiUint(40), abiUint(9)),
		log(2, []string{eventTopics["fair-intent-cancelled"], intentID, batchTopic, abiAddress(actor)}, abiUint(0)),
		log(3, []string{eventTopics["fair-solution-committed"], batchTopic, abiAddress(actor)}, abiUint(701)),
		log(4, []string{eventTopics["fair-solution-revealed"], batchTopic, abiAddress(actor)}, abiUint(2), abiUint(100), abiUint(55), abiUint(702), abiUint(703)),
		log(5, []string{eventTopics["fair-winner-finalized"], batchTopic, abiAddress(actor)}, abiUint(2), abiUint(100), abiUint(55), abiUint(702), abiUint(703)),
		log(6, []string{eventTopics["fair-intent-settled"], intentID, batchTopic, abiAddress(actor)}, abiUint(100), abiUint(200), abiUint(2), abiUint(3)),
		log(7, []string{eventTopics["fair-batch-settled"], batchTopic, abiAddress(actor)}, abiUint(1), abiUint(2), abiUint(3), abiUint(4), abiUint(5), abiUint(6), abiUint(7), abiUint(8), abiUint(703)),
		log(8, []string{eventTopics["fair-batch-failed"], batchTopic, abiAddress(actor)}, strings.TrimPrefix(reason, "0x"), abiUint(50)),
		log(9, []string{eventTopics["fair-solver-slashed"], batchTopic, abiAddress(actor), reason}, abiUint(50)),
	}
	events, err := poller.decodeFairFlowLogs(context.Background(), logs)
	if err != nil {
		t.Fatal(err)
	}
	wantTypes := []string{"batch-opened", "intent-submitted", "intent-cancelled", "solution-committed", "solution-revealed", "winner-finalized", "intent-settled", "batch-settled", "batch-failed", "solver-slashed"}
	if len(events) != len(wantTypes) {
		t.Fatalf("events=%d", len(events))
	}
	for index, kind := range wantTypes {
		if events[index].Type != kind || events[index].BatchID != "7" || events[index].LogIndex != uint64(index) {
			t.Fatalf("event[%d]=%#v", index, events[index])
		}
	}
	if events[0].Details["token0"] != token0 || events[1].Details["zeroForOne"] != "true" || events[2].Details["batchAborted"] != "false" || events[5].Details["bestExecutionDigest"] != fmt.Sprintf("0x%064x", 703) || events[9].Details["reason"] != reason {
		t.Fatalf("decoded details=%#v %#v %#v %#v %#v", events[0], events[1], events[2], events[5], events[9])
	}
	malformed := logs[1]
	malformed.Data = "0x" + abiUint(2) + abiUint(100) + abiUint(95) + abiUint(40) + abiUint(9)
	if _, err := poller.decodeFairFlowLogs(context.Background(), []evmLog{malformed}); err == nil || !strings.Contains(err.Error(), "boolean") {
		t.Fatalf("malformed boolean accepted: %v", err)
	}
}

func TestDecodeEveryLPProtectionEventAndRejectFeeSubstitution(t *testing.T) {
	protection := "0x00000000000000000000000000000000000000f5"
	pool := "0x0000000000000000000000000000000000000011"
	token0 := "0x0000000000000000000000000000000000000001"
	token1 := "0x0000000000000000000000000000000000000002"
	configHash := fmt.Sprintf("0x%064x", 801)
	sourceHash := fmt.Sprintf("0x%064x", 802)
	blockHash := fmt.Sprintf("0x%064x", 803)
	timestamp := time.Now().Add(-time.Minute).Unix()
	rpc := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var call struct {
			Method string `json:"method"`
			ID     any    `json:"id"`
		}
		if err := json.NewDecoder(request.Body).Decode(&call); err != nil {
			t.Error(err)
			return
		}
		if call.Method != "eth_getBlockByNumber" {
			t.Errorf("unexpected method %s", call.Method)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": evmBlock{Hash: blockHash, Timestamp: fmt.Sprintf("0x%x", timestamp)}})
	}))
	defer rpc.Close()
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	poller, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: rpc.URL, Factory: "0x00000000000000000000000000000000000000f1", LPProtection: protection, StartBlock: 1, CursorPath: filepath.Join(t.TempDir(), "cursor.json"), CursorSecret: testSecret})
	if err != nil {
		t.Fatal(err)
	}
	transaction := func(index uint64) string { return fmt.Sprintf("0x%064x", 900+index) }
	log := func(index uint64, topics []string, words ...string) evmLog {
		return evmLog{Address: protection, Topics: topics, Data: "0x" + strings.Join(words, ""), BlockNumber: "0xc", BlockHash: blockHash, TxHash: transaction(index), LogIndex: fmt.Sprintf("0x%x", index)}
	}
	logs := []evmLog{
		log(0, []string{eventTopics["protection-pool-registered"], abiAddress(pool), abiAddress(token0), abiAddress(token1)}),
		log(1, []string{eventTopics["protection-config-scheduled"], abiAddress(pool), configHash}, abiUint(uint64(timestamp+3600))),
		log(2, []string{eventTopics["protection-config-changed"], abiAddress(pool), configHash}),
		log(3, []string{eventTopics["protection-assessed"], abiAddress(pool), abiAddress(token0), sourceHash}, abiUint(10_000), abiUint(145), abiUint(30), abiUint(50), abiUint(10), abiUint(0), abiUint(5), abiUint(50), abiUint(0), abiUint(uint64(timestamp-10))),
	}
	events, err := poller.decodeLPProtectionLogs(context.Background(), logs)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"pool-registered", "config-scheduled", "config-changed", "assessed"}
	if len(events) != len(want) {
		t.Fatalf("events=%d", len(events))
	}
	for index, kind := range want {
		if events[index].Type != kind || events[index].Pool != pool || events[index].LogIndex != uint64(index) {
			t.Fatalf("event[%d]=%#v", index, events[index])
		}
	}
	assessment := events[3]
	if assessment.TokenIn != token0 || assessment.Details["realizedFeeAmount"] != "145" || assessment.Details["incentiveAmount"] != "0" || assessment.Details["baseFeeBps"] != "30" || assessment.Details["oracleSourceHash"] != sourceHash {
		t.Fatalf("assessment=%#v", assessment)
	}
	malformed := logs[3]
	malformed.Data = "0x" + abiUint(10_000) + abiUint(2_001) + abiUint(30) + abiUint(50) + abiUint(10) + abiUint(0) + abiUint(5) + abiUint(50) + abiUint(0) + abiUint(uint64(timestamp-10))
	if _, err := poller.decodeLPProtectionLogs(context.Background(), []evmLog{malformed}); err == nil || !strings.Contains(err.Error(), "contract cap") {
		t.Fatalf("fee substitution accepted: %v", err)
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
	if _, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: "http://rpc", Factory: "0x0000000000000000000000000000000000000001", FairFlow: "bad", StartBlock: 1, CursorPath: "x", CursorSecret: testSecret}); err == nil {
		t.Fatal("bad FairFlow accepted")
	}
	if _, err := NewEVMPoller(store, EVMPollerConfig{RPCURL: "http://rpc", Factory: "0x0000000000000000000000000000000000000001", LPProtection: "bad", StartBlock: 1, CursorPath: "x", CursorSecret: testSecret}); err == nil {
		t.Fatal("bad LP protection accepted")
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
