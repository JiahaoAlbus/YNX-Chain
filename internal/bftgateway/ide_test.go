package bftgateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
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
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	fixture := newABCICometFixture(t, app, int64(migration.Height))
	upstream := httptest.NewServer(fixture)
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
	var verifier map[string]any
	getJSON(t, server.URL+"/ide/verifier/"+deployed.Contract.Address, &verifier)
	if verifier["verificationStatus"] != "source_and_deployed_bytecode_identity_committed" || verifier["remotePublicProofStatus"] != "not_claimed" {
		t.Fatalf("bad verifier evidence: %+v", verifier)
	}

	callData := "0x7cf5dab0" + strings.Repeat("0", 63) + "5"
	call := consensus.IDEContractCallPayload{Address: deployed.Contract.Address, Calldata: callData, IdempotencyKey: "gateway-call-1"}
	call.RequestHash = consensus.IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	callRaw := signedIDEFixture(t, key, consensus.ActionIDEContractCall, call, 2)
	var executed struct {
		Receipt consensus.BFTEVMReceipt `json:"receipt"`
	}
	postSignedAction(t, server.URL+"/ide/execute", callRaw, http.StatusOK, &executed)
	if len(executed.Receipt.Logs) != 1 || executed.Receipt.To != deployed.Contract.Address {
		t.Fatalf("bad gateway execution: %+v", executed)
	}

	var static map[string]any
	postJSON(t, server.URL+"/ide/call", map[string]string{"address": deployed.Contract.Address, "calldata": "0x06661abd"}, &static)
	if static["encodedResult"] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatalf("bad gateway static call: %+v", static)
	}

	receipt := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["`+executed.Receipt.TxHash+`"]}`)
	if receipt["contractAddress"] != nil || receipt["to"] != deployed.Contract.Address || len(receipt["logs"].([]any)) != 1 || receipt["logsBloom"] == "0x"+strings.Repeat("0", 512) {
		t.Fatalf("bad committed IDE EVM receipt: %+v", receipt)
	}
	logs := assertRPCArray(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_getLogs","params":[{"fromBlock":"`+hexEVMQuantity(uint64(executed.Receipt.BlockHeight))+`","toBlock":"`+hexEVMQuantity(uint64(executed.Receipt.BlockHeight))+`","address":"`+deployed.Contract.Address+`","topics":["`+executed.Receipt.Logs[0].Topics[0]+`"]}]}`)
	if len(logs) != 1 || logs[0].(map[string]any)["transactionHash"] != executed.Receipt.TxHash {
		t.Fatalf("bad committed IDE EVM logs: %+v", logs)
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
