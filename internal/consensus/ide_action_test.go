package consensus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestApplicationPersistsBoundedIDEDeployCallReceiptAndLogs(t *testing.T) {
	ctx := context.Background()
	key := deterministicPrivateKey(101)
	signer := mustNativeAddress(t, key)
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
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}

	source, bytecode := boundedContractFixture(t, "SampleEVMWriteCounter")
	deploy := IDEContractDeployPayload{Name: "SampleEVMWriteCounter", Source: source, DeployedBytecode: bytecode, ConstructorArgs: []string{"7"}, IdempotencyKey: "deploy-counter-1"}
	deploy.RequestHash = IDEDeployRequestHash(deploy.Name, deploy.Source, deploy.DeployedBytecode, deploy.ConstructorArgs, deploy.IdempotencyKey)
	deployRaw := mustIDEAction(t, key, ActionIDEContractDeploy, deploy, 1)
	deployHash := ApplicationActionHash(deployRaw)
	height := int64(migration.Height) + 1
	commitIDEBlock(t, app, height, time.Date(2026, 7, 12, 16, 0, 0, 0, time.UTC), deployRaw)

	var deploymentReceipt BFTEVMReceipt
	queryJSON(t, app, "/evm/receipts/"+deployHash, &deploymentReceipt)
	if !IsNativeAddress(deploymentReceipt.ContractAddress) || deploymentReceipt.To != "" || deploymentReceipt.Action != ActionIDEContractDeploy {
		t.Fatalf("bad deployment receipt: %+v", deploymentReceipt)
	}
	address := deploymentReceipt.ContractAddress
	var contract BFTContract
	queryJSON(t, app, "/ide/contracts/"+address, &contract)
	if contract.RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"7" {
		t.Fatalf("constructor state was not committed: %+v", contract.RuntimeStorage)
	}

	callData := "0x7cf5dab0" + strings.Repeat("0", 63) + "5"
	call := IDEContractCallPayload{Address: address, Calldata: callData, IdempotencyKey: "increment-counter-1"}
	call.RequestHash = IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	callRaw := mustIDEAction(t, key, ActionIDEContractCall, call, 2)
	callHash := ApplicationActionHash(callRaw)
	commitIDEBlock(t, app, height+1, time.Date(2026, 7, 12, 16, 0, 1, 0, time.UTC), callRaw)

	var callReceipt BFTEVMReceipt
	queryJSON(t, app, "/evm/receipts/"+callHash, &callReceipt)
	if callReceipt.To != address || callReceipt.EncodedResult != "0x"+strings.Repeat("0", 63)+"c" || len(callReceipt.StorageWrites) != 1 || len(callReceipt.Logs) != 1 {
		t.Fatalf("bad call receipt: %+v", callReceipt)
	}
	var logs []BFTEVMLog
	queryJSON(t, app, "/evm/logs", &logs)
	if len(logs) != 1 || logs[0].Address != address || logs[0].TxHash != callHash {
		t.Fatalf("bad committed logs: %+v", logs)
	}
	var staticResult map[string]any
	queryJSON(t, app, "/ide/call/"+address+"/0x06661abd", &staticResult)
	if staticResult["encodedResult"] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatalf("static call did not read committed storage: %+v", staticResult)
	}

	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var restored BFTContract
	queryJSON(t, restarted, "/ide/contracts/"+address, &restored)
	if string(mustJSON(t, restored)) != string(mustJSON(t, contractAfterQuery(t, app, address))) {
		t.Fatal("IDE contract state changed after restart")
	}
	var tamperedState CommittedState
	stateRaw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(stateRaw, &tamperedState); err != nil {
		t.Fatal(err)
	}
	tamperedState.Contracts[0].RuntimeStorage["0x"+strings.Repeat("0", 64)] = "0x" + strings.Repeat("f", 64)
	tamperedRaw, _ := json.Marshal(tamperedState)
	tamperedPath := filepath.Join(t.TempDir(), "tampered-state.json")
	if err := os.WriteFile(tamperedPath, tamperedRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentApplication(migration, tamperedPath); err == nil {
		t.Fatal("tampered persisted IDE state was accepted")
	}

	conflict := call
	conflict.Calldata = "0x7cf5dab0" + strings.Repeat("0", 63) + "1"
	conflict.RequestHash = IDECallRequestHash(conflict.Address, conflict.Calldata, conflict.IdempotencyKey)
	check, _ := restarted.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: mustIDEAction(t, key, ActionIDEContractCall, conflict, 3)})
	if check.Code == 0 {
		t.Fatal("conflicting IDE idempotency request was accepted")
	}
	unsupported := IDEContractCallPayload{Address: address, Calldata: "0xffffffff", IdempotencyKey: "unsupported-call"}
	unsupported.RequestHash = IDECallRequestHash(unsupported.Address, unsupported.Calldata, unsupported.IdempotencyKey)
	check, _ = restarted.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: mustIDEAction(t, key, ActionIDEContractCall, unsupported, 3)})
	if check.Code == 0 {
		t.Fatal("unsupported bounded EVM path was accepted")
	}

	tampered := deploy
	tampered.Source += "\n// tampered"
	tampered.IdempotencyKey = "tampered-deploy"
	tampered.RequestHash = IDEDeployRequestHash(tampered.Name, tampered.Source, tampered.DeployedBytecode, tampered.ConstructorArgs, tampered.IdempotencyKey)
	if _, err := NewSignedApplicationAction(key, 6423, ActionIDEContractDeploy, tampered, 3); err == nil {
		t.Fatal("unpinned source was accepted")
	}
}

func TestBoundedIDEStateIsDeterministicAcrossFourApplicationsAndDuplicateNonce(t *testing.T) {
	key := deterministicPrivateKey(102)
	signer := mustNativeAddress(t, key)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(signer, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	source, bytecode := boundedContractFixture(t, "SampleEVMWriteCounter")
	deploy := IDEContractDeployPayload{Name: "SampleEVMWriteCounter", Source: source, DeployedBytecode: bytecode, ConstructorArgs: []string{"1"}, IdempotencyKey: "four-app-deploy"}
	deploy.RequestHash = IDEDeployRequestHash(deploy.Name, deploy.Source, deploy.DeployedBytecode, deploy.ConstructorArgs, deploy.IdempotencyKey)
	deployRaw := mustIDEAction(t, key, ActionIDEContractDeploy, deploy, 1)
	address := ideContractAddress(signer, ApplicationActionHash(deployRaw))
	call := IDEContractCallPayload{Address: address, Calldata: "0x7cf5dab0" + strings.Repeat("0", 63) + "2", IdempotencyKey: "four-app-call"}
	call.RequestHash = IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	callRaw := mustIDEAction(t, key, ActionIDEContractCall, call, 2)
	blockTime := time.Date(2026, 7, 12, 17, 0, 0, 0, time.UTC)
	var expectedHash string
	var expectedState []byte
	for i := 0; i < 4; i++ {
		app, err := NewApplication(migration)
		if err != nil {
			t.Fatal(err)
		}
		commitIDEBlock(t, app, int64(migration.Height)+1, blockTime, deployRaw)
		height := int64(migration.Height) + 2
		finalized, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime.Add(time.Second), Txs: [][]byte{callRaw, callRaw}})
		if err != nil || len(finalized.TxResults) != 2 || finalized.TxResults[0].Code != 0 || finalized.TxResults[1].Code == 0 {
			t.Fatalf("duplicate nonce was not isolated: %+v %v", finalized, err)
		}
		if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		var state CommittedState
		queryJSON(t, app, "/state", &state)
		if len(state.EVMLogs) != 1 || state.Accounts[accountPosition(t, state.Accounts, signer)].Nonce != 2 {
			t.Fatalf("duplicate nonce changed IDE state twice: %+v", state)
		}
		encoded := mustJSON(t, state)
		if i == 0 {
			expectedHash, expectedState = state.AppHash, encoded
		} else if state.AppHash != expectedHash || string(encoded) != string(expectedState) {
			t.Fatal("four applications produced different committed IDE state")
		}
	}
}

func accountPosition(t *testing.T, accounts []chain.ConsensusAccount, address string) int {
	t.Helper()
	for i := range accounts {
		if accounts[i].Address == address {
			return i
		}
	}
	t.Fatal("account not found")
	return -1
}

func commitIDEBlock(t *testing.T, app *Application, height int64, blockTime time.Time, payload []byte) {
	t.Helper()
	ctx := context.Background()
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: [][]byte{payload}})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("IDE proposal failed: %+v %v", proposal, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: [][]byte{payload}})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 || len(finalized.TxResults[0].Events) != 1 || finalized.TxResults[0].Events[0].Type != "ynx.ide_contract" {
		t.Fatalf("IDE finalize failed: %+v %v", finalized, err)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func boundedContractFixture(t *testing.T, name string) (string, string) {
	t.Helper()
	sourcePath := filepath.Join("..", "..", "contracts", "devtools", name+".sol")
	artifactPath := filepath.Join("..", "..", "artifacts", "contracts", "devtools", name+".sol", name+".json")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	artifactRaw, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		DeployedBytecode string `json:"deployedBytecode"`
	}
	if err := json.Unmarshal(artifactRaw, &artifact); err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(source)), strings.ToLower(artifact.DeployedBytecode)
}

func mustIDEAction(t *testing.T, key *secp256k1.PrivateKey, action string, input any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, action, input, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func contractAfterQuery(t *testing.T, app *Application, address string) BFTContract {
	t.Helper()
	var value BFTContract
	queryJSON(t, app, "/ide/contracts/"+address, &value)
	return value
}
