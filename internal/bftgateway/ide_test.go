package bftgateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsBoundedIDEAndReturnsEVMLogs(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 71))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(signer, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "ide-state.json")
	app, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	fixture := newABCICometFixture(t, app, int64(migration.Height))
	var sourceMode atomic.Value
	sourceMode.Store("")
	var blockReads, resultReads atomic.Int64
	var multiHeight int64
	var multiRaw [][]byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mode := sourceMode.Load().(string)
		if r.URL.Path == "/tx" && mode == "tx-bad-gas" {
			result := httptest.NewRecorder(); fixture.ServeHTTP(result, r)
			var body map[string]any
			if err := json.Unmarshal(result.Body.Bytes(), &body); err != nil { t.Error(err); w.WriteHeader(500); return }
			body["result"].(map[string]any)["tx_result"].(map[string]any)["gas_used"] = "2"
			writeJSON(w, http.StatusOK, body); return
		}
		if r.URL.Path == "/status" {
			result := httptest.NewRecorder()
			fixture.ServeHTTP(result, r)
			var body map[string]any
			if err := json.Unmarshal(result.Body.Bytes(), &body); err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			syncInfo := body["result"].(map[string]any)["sync_info"].(map[string]any)
			syncInfo["latest_block_hash"] = fmt.Sprintf("%064X", fixture.height)
			writeJSON(w, http.StatusOK, body)
			return
		}
		if r.URL.Path == "/block_results" {
			resultReads.Add(1)
		}
		if r.URL.Path == "/block_results" && (mode == "bad-gas" || mode == "failed-result" || mode == "missing-result") {
			height := r.URL.Query().Get("height")
			rows := []map[string]any{{"code": 0, "gas_used": "1"}}
			if mode == "bad-gas" {
				rows[0]["gas_used"] = "2"
			}
			if mode == "failed-result" {
				rows[0]["code"] = 1
			}
			if mode == "missing-result" {
				rows = nil
			}
			writeJSON(w, http.StatusOK, map[string]any{"result": map[string]any{"height": height, "txs_results": rows}})
			return
		}
		if r.URL.Path == "/block_results" && r.URL.Query().Get("height") == strconv.FormatInt(multiHeight, 10) && len(multiRaw) > 0 {
			rows := make([]map[string]any, len(multiRaw))
			for i := range rows {
				rows[i] = map[string]any{"code": 0, "gas_used": "1"}
			}
			writeJSON(w, http.StatusOK, map[string]any{"result": map[string]any{"height": strconv.FormatInt(multiHeight, 10), "txs_results": rows}})
			return
		}
		if r.URL.Path == "/abci_query" && mode == "missing-receipt" {
			path, _ := strconv.Unquote(r.URL.Query().Get("path"))
			if strings.HasPrefix(path, "/evm/receipts/") {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
		if r.URL.Path != "/block" {
			fixture.ServeHTTP(w, r)
			return
		}
		blockReads.Add(1)
		result := httptest.NewRecorder()
		fixture.ServeHTTP(result, r)
		if result.Code != http.StatusOK {
			w.WriteHeader(result.Code)
			return
		}
		var body map[string]any
		if err := json.Unmarshal(result.Body.Bytes(), &body); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		height, _ := strconv.ParseInt(r.URL.Query().Get("height"), 10, 64)
		txs := cmttypes.Txs{cmttypes.Tx(fixture.blocks[height])}
		if height == multiHeight && len(multiRaw) > 0 {
			txs = make(cmttypes.Txs, len(multiRaw))
			for i := range multiRaw {
				txs[i] = cmttypes.Tx(multiRaw[i])
			}
		}
		dataHash := hex.EncodeToString(txs.Hash())
		if mode == "bad-data-hash" {
			dataHash = strings.Repeat("a", 64)
		}
		header := body["result"].(map[string]any)["block"].(map[string]any)["header"].(map[string]any)
		header["data_hash"] = dataHash
		header["app_hash"] = strings.Repeat("b", 64)
		if height == multiHeight && len(multiRaw) > 0 {
			encoded := make([]string, len(multiRaw))
			for i := range multiRaw {
				encoded[i] = base64.StdEncoding.EncodeToString(multiRaw[i])
			}
			body["result"].(map[string]any)["block"].(map[string]any)["data"].(map[string]any)["txs"] = encoded
		}
		writeJSON(w, http.StatusOK, body)
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	source, bytecode := gatewayBoundedFixture(t)
	deploy := consensus.IDEContractDeployPayload{Name: "SampleEVMWriteCounter", Source: source, DeployedBytecode: bytecode, ConstructorArgs: []string{"7"}, IdempotencyKey: "gateway-deploy-1"}
	deploy.RequestHash = consensus.IDEDeployRequestHash(deploy.Name, deploy.Source, deploy.DeployedBytecode, deploy.ConstructorArgs, deploy.IdempotencyKey)
	deployRaw := signedIDEFixture(t, key, consensus.ActionIDEContractDeploy, deploy, 1)
	var deployed struct {
		Contract consensus.BFTContract   `json:"contract"`
		Receipt  consensus.BFTEVMReceipt `json:"receipt"`
	}
	postSignedAction(t, server.URL+"/ide/deploy", deployRaw, http.StatusCreated, &deployed)
	if deployed.Contract.Address == "" || deployed.Receipt.ContractAddress != deployed.Contract.Address {
		t.Fatalf("bad gateway deployment: %+v", deployed)
	}
	deployedReceipt := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":41,"method":"eth_getTransactionReceipt","params":["`+deployed.Receipt.TxHash+`"]}`)
	if deployedReceipt["contractAddress"] != deployed.Contract.Address || deployedReceipt["gasUsed"] != "0x1" || deployedReceipt["effectiveGasPrice"] != "0xde0b6b3a7640000" {
		t.Fatal("original IDE deploy fee projection differs")
	}
	// Even a structurally valid contract cannot be returned for a snapshot
	// older than its last update, including when an RPC labels the value H.
	futureContract := deployed.Contract
	futureContract.LastUpdatedHeight = futureContract.BlockHeight + 1
	futureJSON, err := json.Marshal(futureContract)
	if err != nil {
		t.Fatal(err)
	}
	futureRPC := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{
			"code": 0, "height": strconv.FormatInt(futureContract.BlockHeight, 10), "value": base64.StdEncoding.EncodeToString(futureJSON),
		}}})
	}))
	defer futureRPC.Close()
	futureGateway, err := New(Config{CometRPCURL: futureRPC.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := futureGateway.evmContractAtHeight(context.Background(), futureContract.Address, uint64(futureContract.BlockHeight)); err == nil {
		t.Fatal("future contract update accepted for an earlier committed height")
	}
	callHeight := strconv.FormatInt(futureContract.BlockHeight+1, 10)
	callRPC := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("height") != strconv.FormatInt(futureContract.BlockHeight, 10) {
			t.Error("contract call did not request the committed height")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{
			"code": 0, "height": callHeight, "value": base64.StdEncoding.EncodeToString([]byte(`{}`)),
		}}})
	}))
	defer callRPC.Close()
	callGateway, err := New(Config{CometRPCURL: callRPC.URL})
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{callHeight, "", "010"} {
		callHeight = bad
		if err := callGateway.evmCallAtHeight(context.Background(), "/ide/call/example", uint64(futureContract.BlockHeight), &struct{}{}); !errors.Is(err, errEVMCallHeightMismatch) {
			t.Fatalf("contract call accepted wrong response height %q: %v", bad, err)
		}
	}
	var verifier map[string]any
	getJSON(t, server.URL+"/ide/verifier/"+deployed.Contract.Address, &verifier)
	if verifier["verificationStatus"] != "source_and_deployed_bytecode_identity_committed" || verifier["remotePublicProofStatus"] != "not_claimed" {
		t.Fatalf("bad verifier evidence: %+v", verifier)
	}

	callData := "0x7cf5dab0" + strings.Repeat("0", 63) + "5"
	call := consensus.IDEContractCallPayload{Address: deployed.Contract.Address, Calldata: callData, IdempotencyKey: "gateway-call-1"}
	call.RequestHash = consensus.IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	callRaw := signedIDEFixture(t, key, consensus.ActionIDEContractCall, call, 2)
	beforeCall := queryPQGatewayAccount(t, app, signer)
	var executed struct {
		Receipt consensus.BFTEVMReceipt `json:"receipt"`
	}
	postSignedAction(t, server.URL+"/ide/execute", callRaw, http.StatusOK, &executed)
	afterCall := queryPQGatewayAccount(t, app, signer)
	if afterCall.Balance != beforeCall.Balance-consensus.SignedActionFeeYNXT {
		t.Fatal("actual IDE call did not charge original signed fee")
	}
	if len(executed.Receipt.Logs) != 1 || executed.Receipt.To != deployed.Contract.Address {
		t.Fatalf("bad gateway execution: %+v", executed)
	}

	var static map[string]any
	postJSON(t, server.URL+"/ide/call", map[string]string{"address": deployed.Contract.Address, "calldata": "0x06661abd"}, &static)
	if static["encodedResult"] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatalf("bad gateway static call: %+v", static)
	}

	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":10,"method":"eth_getCode","params":["`+deployed.Contract.Address+`","latest"]}`, bytecode)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":110,"method":"eth_call","params":[{"from":"`+signer+`","to":"`+deployed.Contract.Address+`","data":"0x06661abd"},"latest"]}`, "0x"+strings.Repeat("0", 63)+"c")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":101,"method":"eth_getCode","params":["`+deployed.Contract.Address+`"]}`, bytecode)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":11,"method":"eth_getCode","params":["0x0000000000000000000000000000000000000000","latest"]}`, "0x")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":17,"method":"eth_getStorageAt","params":["`+deployed.Contract.Address+`","0x0","latest"]}`, "0x"+strings.Repeat("0", 63)+"c")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":18,"method":"eth_getStorageAt","params":["`+deployed.Contract.Address+`","0x1","latest"]}`, "0x"+strings.Repeat("0", 64))
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":19,"method":"eth_getStorageAt","params":["0x0000000000000000000000000000000000000000","0x0","latest"]}`, "0x"+strings.Repeat("0", 64))
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":12,"method":"eth_call","params":[{"to":"`+deployed.Contract.Address+`","data":"0x06661abd","from":"`+signer+`","gas":"0x10000","value":"0x0"},"finalized"]}`, "0x"+strings.Repeat("0", 63)+"c")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":13,"method":"eth_estimateGas","params":[{"to":"`+deployed.Contract.Address+`","input":"0x06661abd"}]}`, "0x1")
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":14,"method":"eth_getCode","params":["`+deployed.Contract.Address+`","`+hexEVMQuantity(uint64(deployed.Receipt.BlockHeight))+`"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":15,"method":"eth_call","params":[{"to":"`+deployed.Contract.Address+`","data":"0x06661abd","value":"0x1"},"latest"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":16,"method":"eth_call","params":[{"to":"`+deployed.Contract.Address+`","data":"0x06661abd","stateOverride":{}},"latest"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":20,"method":"eth_getStorageAt","params":["`+deployed.Contract.Address+`","0x00","latest"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":21,"method":"eth_getStorageAt","params":["`+deployed.Contract.Address+`","0x0","`+hexEVMQuantity(uint64(deployed.Receipt.BlockHeight))+`"]}`, -32602)

	receipt := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["`+executed.Receipt.TxHash+`"]}`)
	if receipt["contractAddress"] != nil || receipt["to"] != deployed.Contract.Address || len(receipt["logs"].([]any)) != 1 || receipt["logsBloom"] == "0x"+strings.Repeat("0", 512) {
		t.Fatalf("bad committed IDE EVM receipt: %+v", receipt)
	}
	if receipt["gasUsed"] != "0x1" || receipt["effectiveGasPrice"] != "0xde0b6b3a7640000" {
		t.Fatalf("committed IDE fee must be projected in wei: %+v", receipt)
	}
	transaction := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_getTransactionByHash","params":["`+executed.Receipt.TxHash+`"]}`)
	if transaction["gas"] != "0x1" || transaction["gasPrice"] != "0xde0b6b3a7640000" {
		t.Fatalf("signed IDE gas price must be projected in wei: %+v", transaction)
	}
	mapped, err := mappedTransaction(callRaw, uint64(executed.Receipt.BlockHeight), strings.TrimPrefix(receipt["blockHash"].(string), "0x"), fixture.times[executed.Receipt.BlockHeight])
	if err != nil {
		t.Fatal(err)
	}
	for _, alter := range []func(*chain.Transaction){
		func(tx *chain.Transaction) { tx.Hash = "0x" + strings.Repeat("a", 64) },
		func(tx *chain.Transaction) { tx.From = "0x" + strings.Repeat("a", 40) },
		func(tx *chain.Transaction) { tx.To = "0x" + strings.Repeat("a", 40) },
		func(tx *chain.Transaction) { tx.Nonce++ },
		func(tx *chain.Transaction) { tx.Fee++ },
	} {
		bad := mapped
		alter(&bad)
		if _, ok := verifiedIDEFeeAction(bad, callRaw); ok || evmCommittedTransaction(bad, 0, callRaw) != nil || evmCommittedReceipt(bad, 0, 1, 1, callRaw) != nil {
			t.Fatal("changed signed action projected")
		}
	}
	tampered := bytes.Clone(callRaw)
	signatureStart := bytes.Index(tampered, []byte(`"signature":"`)) + len(`"signature":"`)
	if signatureStart < len(`"signature":"`) || signatureStart >= len(tampered) {
		t.Fatal("original action signature missing")
	}
	if tampered[signatureStart] == '0' {
		tampered[signatureStart] = '1'
	} else {
		tampered[signatureStart] = '0'
	}
	badAction, err := consensus.DecodeSignedApplicationAction(tampered)
	if err != nil || badAction.Verify(6423) == nil {
		t.Fatal("canonical bad-signature control did not reach verification", err)
	}
	badMapped := mapped
	badMapped.Hash = consensus.ApplicationActionHash(tampered)
	if _, ok := verifiedIDEFeeAction(badMapped, tampered); ok || evmCommittedTransaction(badMapped, 0, tampered) != nil || evmCommittedReceipt(badMapped, 0, 1, 1, tampered) != nil {
		t.Fatal("invalid original signature projected")
	}
	if evmCommittedReceipt(mapped, 0, 2, 2, callRaw) != nil {
		t.Fatal("incorrect IDE execution gas projected")
	}
	if err := gateway.validateIDEFeeProjection(context.Background(), mapped, 1, callRaw); err == nil {
		t.Fatal("wrong original transaction index accepted")
	}
	for _, mode := range []string{"bad-gas", "failed-result", "missing-result", "bad-data-hash"} {
		sourceMode.Store(mode)
		if err := gateway.validateIDEFeeProjection(context.Background(), mapped, 0, callRaw); err == nil {
			t.Fatal("invalid IDE execution source accepted", mode)
		}
	}
	sourceMode.Store("missing-receipt")
	if _, err := gateway.evmCommittedResult(context.Background(), "eth_getTransactionReceipt", json.RawMessage(`["`+executed.Receipt.TxHash+`"]`)); err == nil {
		t.Fatal("missing IDE receipt was fabricated")
	}
	sourceMode.Store("tx-bad-gas")
	if _, err := gateway.evmCommittedResult(context.Background(), "eth_getTransactionByHash", json.RawMessage(`["`+executed.Receipt.TxHash+`"]`)); err == nil { t.Fatal("mismatched original /tx result gas was projected") }
	sourceMode.Store("")
	logs := assertRPCArray(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_getLogs","params":[{"fromBlock":"`+hexEVMQuantity(uint64(executed.Receipt.BlockHeight))+`","toBlock":"`+hexEVMQuantity(uint64(executed.Receipt.BlockHeight))+`","address":"`+deployed.Contract.Address+`","topics":["`+executed.Receipt.Logs[0].Topics[0]+`"]}]}`)
	if len(logs) != 1 || logs[0].(map[string]any)["transactionHash"] != executed.Receipt.TxHash {
		t.Fatalf("bad committed IDE EVM logs: %+v", logs)
	}
	// Two real distinct signed actions in one synthetic committed block. The
	// full projection must reuse one block/result response for both indices.
	multiRaw = make([][]byte, 2)
	for i := range multiRaw {
		next := consensus.IDEContractCallPayload{Address: deployed.Contract.Address, Calldata: callData, IdempotencyKey: fmt.Sprintf("gateway-multi-%d", i)}
		next.RequestHash = consensus.IDECallRequestHash(next.Address, next.Calldata, next.IdempotencyKey)
		multiRaw[i] = signedIDEFixture(t, key, consensus.ActionIDEContractCall, next, uint64(3+i))
	}
	multiHeight = fixture.height + 1
	at := fixture.times[fixture.height].Add(time.Second)
	final, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: multiHeight, Time: at, Txs: multiRaw})
	if err != nil || len(final.TxResults) != 2 || final.TxResults[0].Code != 0 || final.TxResults[1].Code != 0 {
		t.Fatal("multi-action synthetic finalize", final, err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	fixture.height, fixture.blocks[multiHeight], fixture.times[multiHeight] = multiHeight, multiRaw[0], at
	blockReads.Store(0)
	resultReads.Store(0)
	full, err := gateway.evmCommittedBlockResult(context.Background(), "eth_getBlockByNumber", json.RawMessage(`["latest",true]`))
	if err != nil {
		t.Fatal("full committed IDE block", err)
	}
	rows, ok := full.(map[string]any)["transactions"].([]any)
	if !ok || len(rows) != 2 {
		t.Fatal("missing original IDE rows")
	}
	for _, row := range rows {
		if row.(map[string]any)["gasPrice"] != "0xde0b6b3a7640000" {
			t.Fatal("IDE block gas price differs")
		}
	}
	if blockReads.Load() != 1 || resultReads.Load() != 1 {
		t.Fatal("full block reread original evidence per IDE action", blockReads.Load(), resultReads.Load())
	}
	blockReads.Store(0)
	resultReads.Store(0)
	indexed, code, err := gateway.evmCommittedBlockTransactionResult(context.Background(), "eth_getTransactionByBlockNumberAndIndex", json.RawMessage(`["latest","0x1"]`))
	if err != nil || code != 0 || !reflect.DeepEqual(indexed, rows[1]) || blockReads.Load() != 1 || resultReads.Load() != 1 {
		t.Fatal("indexed IDE original differs or re-read block", code, err, blockReads.Load(), resultReads.Load())
	}
	for _, bad := range []string{"bad-gas", "failed-result", "missing-result", "bad-data-hash"} {
		sourceMode.Store(bad)
		if _, err := gateway.evmCommittedBlockResult(context.Background(), "eth_getBlockByNumber", json.RawMessage(`["latest",true]`)); err == nil {
			t.Fatal("full IDE block accepted inconsistent evidence", bad)
		}
	}
	sourceMode.Store("")
	cold, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal("cold IDE state", err)
	}
	fixture.app = cold
	afterCold, err := gateway.evmCommittedBlockResult(context.Background(), "eth_getBlockByNumber", json.RawMessage(`["latest",true]`))
	if err != nil || !reflect.DeepEqual(full, afterCold) {
		t.Fatal("cold original IDE block changed", err)
	}
	coldReceipt := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":3,"method":"eth_getTransactionReceipt","params":["`+executed.Receipt.TxHash+`"]}`)
	if coldReceipt["effectiveGasPrice"] != "0xde0b6b3a7640000" {
		t.Fatal("cold IDE receipt fee changed")
	}
}

func TestGatewayMapsCometDuplicateApplicationActionToUnprocessable(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 72))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	input := consensus.IDEContractCallPayload{Address: signer, Calldata: "0xffffffff", IdempotencyKey: "duplicate-action"}
	input.RequestHash = consensus.IDECallRequestHash(input.Address, input.Calldata, input.IdempotencyKey)
	raw := signedIDEFixture(t, key, consensus.ActionIDEContractCall, input, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/broadcast_tx_commit" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "Internal error", "data": "tx already exists in cache"}})
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	_, err = gateway.broadcastApplicationAction(t.Context(), raw, mustDecodeIDEAction(t, raw))
	var txErr *gatewayTransactionError
	if !errors.As(err, &txErr) || txErr.status != http.StatusUnprocessableEntity {
		t.Fatalf("duplicate Comet action mapping mismatch: %T %v", err, err)
	}
}

func gatewayBoundedFixture(t *testing.T) (string, string) {
	t.Helper()
	source, err := os.ReadFile(filepath.Join("..", "..", "contracts", "devtools", "SampleEVMWriteCounter.sol"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "artifacts", "contracts", "devtools", "SampleEVMWriteCounter.sol", "SampleEVMWriteCounter.json"))
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		DeployedBytecode string `json:"deployedBytecode"`
	}
	if json.Unmarshal(raw, &artifact) != nil {
		t.Fatal("decode artifact")
	}
	return strings.TrimSpace(string(source)), strings.ToLower(artifact.DeployedBytecode)
}

func signedIDEFixture(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := consensus.NewSignedApplicationAction(key, 6423, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func mustDecodeIDEAction(t *testing.T, raw []byte) consensus.SignedApplicationAction {
	t.Helper()
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tx
}

func postJSON(t *testing.T, endpoint string, input, out any) {
	t.Helper()
	raw, _ := json.Marshal(input)
	response, err := http.Post(endpoint, "application/json", strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("POST %s returned %d", endpoint, response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(out); err != nil {
		t.Fatal(err)
	}
}

func assertRPCArray(t *testing.T, endpoint, payload string) []any {
	t.Helper()
	response, err := http.Post(endpoint, "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var out map[string]any
	if json.NewDecoder(response.Body).Decode(&out) != nil {
		t.Fatal("decode RPC array")
	}
	result, ok := out["result"].([]any)
	if !ok {
		t.Fatalf("expected RPC array: %+v", out)
	}
	return result
}
