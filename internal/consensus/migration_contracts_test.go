package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func TestMigratedERC20PreservesTokenOwnershipAndRejectsForeignSpend(t *testing.T) {
	ownerKey, holderKey, foreignKey := deterministicPrivateKey(108), deterministicPrivateKey(109), deterministicPrivateKey(110)
	owner, holder, foreign := mustNativeAddress(t, ownerKey), mustNativeAddress(t, holderKey), mustNativeAddress(t, foreignKey)
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{owner, holder, foreign} {
		if _, err := d.Faucet(address, 1000); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	source, err := os.ReadFile(filepath.Join("..", "..", "contracts", "tokens", "SampleYNXTCompatibleERC20.sol"))
	if err != nil {
		t.Fatal(err)
	}
	contract, _, err := d.DeployContractWithArgs(owner, "SampleYNXTCompatibleERC20", strings.TrimSpace(string(source)), []string{"1000"})
	if err != nil {
		t.Fatal(err)
	}
	transferData := func(to string, amount int) string {
		return "0xa9059cbb" + strings.Repeat("0", 24) + to[2:] + fmt.Sprintf("%064x", amount)
	}
	if _, _, err := d.ExecuteContract(owner, contract.Address, transferData(holder, 50)); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewPersistentApplication(m, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	makeCall := func(to string, amount int, key string) IDEContractCallPayload {
		p := IDEContractCallPayload{Address: contract.Address, Calldata: transferData(to, amount), IdempotencyKey: key}
		p.RequestHash = IDECallRequestHash(p.Address, p.Calldata, p.IdempotencyKey)
		return p
	}
	holderPosition := accountPosition(t, a.committed.Accounts, holder)
	raw := mustIDEAction(t, holderKey, ActionIDEContractCall, makeCall(owner, 10, "old-holder-transfer"), a.committed.Accounts[holderPosition].Nonce+1)
	height := int64(m.Height) + 1
	commitIDEBlock(t, a, height, time.Unix(1900000000, 0).UTC(), raw)
	for address, want := range map[string]int{holder: 40, owner: 960} {
		var result map[string]any
		queryJSON(t, a, "/ide/call/"+contract.Address+"/0x70a08231"+strings.Repeat("0", 24)+address[2:], &result)
		if result["encodedResult"] != "0x"+fmt.Sprintf("%064x", want) {
			t.Fatalf("source token ownership was reset: %+v", result)
		}
	}
	before := mustJSON(t, a.committed)
	foreignPosition := accountPosition(t, a.committed.Accounts, foreign)
	invalid := mustIDEAction(t, foreignKey, ActionIDEContractCall, makeCall(owner, 1, "foreign-spend"), a.committed.Accounts[foreignPosition].Nonce+1)
	result, err := a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1900000001, 0).UTC(), Txs: [][]byte{invalid}})
	if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code == 0 {
		t.Fatalf("foreign token owner spent imported balance: %+v %v", result, err)
	}
	if !bytes.Equal(before, mustJSON(t, a.committed)) || !bytes.Equal(mustJSON(t, a.pending.Accounts), mustJSON(t, a.committed.Accounts)) || !bytes.Equal(mustJSON(t, a.pending.Contracts), mustJSON(t, a.committed.Contracts)) {
		t.Fatal("rejected foreign call leaked state or fees")
	}
}

func sourceCounterMigration(t *testing.T, pq bool) (chain.ConsensusMigrationState, chain.ContractArtifact, string) {
	t.Helper()
	key := deterministicPrivateKey(107)
	owner := mustNativeAddress(t, key)
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Faucet(owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	source, _ := boundedContractFixture(t, "SampleEVMWriteCounter")
	original, deploy, err := d.DeployContractWithArgs(owner, "SampleEVMWriteCounter", source, []string{"7"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := d.ExecuteContract(owner, original.Address, "0x7cf5dab0"+strings.Repeat("0", 63)+"5"); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if pq {
		if err := d.EnableAccountPQ(d.LatestBlock().Height + 1); err != nil {
			t.Fatal(err)
		}
	}
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	original, _ = d.Contract(original.Address)
	if original.RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatal("source fixture did not execute its actual write")
	}
	return m, original, deploy.Hash
}

func TestMigratedContractKeepsAddressStorageAndExecutesNextCall(t *testing.T) {
	m, original, sourceDeployHash := sourceCounterMigration(t, false)
	missingMaterial := m
	missingMaterial.ContractMaterials = nil
	missingMaterial.StateHash = ""
	missingWire, err := json.Marshal(missingMaterial)
	if err != nil {
		t.Fatal(err)
	}
	missingHash := sha256.Sum256(missingWire)
	missingMaterial.StateHash = hex.EncodeToString(missingHash[:])
	if err := missingMaterial.Validate(); err != nil {
		t.Fatalf("source checkpoint should remain inspectable without code material: %v", err)
	}
	blockers := MigrationExecutionBlockers(missingMaterial)
	if len(blockers) != 1 || blockers[0].Module != "contracts/"+original.Address {
		t.Fatalf("missing bytecode did not produce exact source-address blocker: %+v", blockers)
	}
	if _, err := NewApplication(missingMaterial); err == nil {
		t.Fatal("source contract without actual code became executable")
	}
	statePath := filepath.Join(t.TempDir(), "state.json")
	a, err := NewPersistentApplication(m, statePath)
	if err != nil {
		t.Fatal(err)
	}
	owner := original.Deployer
	position := accountPosition(t, a.committed.Accounts, owner)
	before := a.committed.Accounts[position]
	imported := contractAfterQuery(t, a, original.Address)
	if imported.Address != original.Address || imported.SourceAnchor != m.StateHash || imported.BlockHeight != 0 || imported.TxHash != "" || len(a.committed.EVMReceipts) != 0 || !bytes.Equal(mustJSON(t, imported.RuntimeStorage), mustJSON(t, original.RuntimeStorage)) {
		t.Fatal("import fabricated a deployment or reset original storage")
	}
	var sourceRecord chain.Transaction
	queryJSON(t, a, "/migration/transactions/"+sourceDeployHash, &sourceRecord)
	if sourceRecord.Hash != sourceDeployHash || sourceRecord.To != original.Address {
		t.Fatal("original deployment history was replaced")
	}
	var static map[string]any
	queryJSON(t, a, "/ide/call/"+original.Address+"/0x06661abd", &static)
	if static["encodedResult"] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatal("static call ignored existing source storage")
	}
	call := IDEContractCallPayload{Address: original.Address, Calldata: "0x7cf5dab0" + strings.Repeat("0", 63) + "3", IdempotencyKey: "source-counter-next"}
	call.RequestHash = IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	raw := mustIDEAction(t, deterministicPrivateKey(107), ActionIDEContractCall, call, before.Nonce+1)
	height := int64(m.Height) + 1
	commitIDEBlock(t, a, height, time.Unix(1900000000, 0).UTC(), raw)
	live := contractAfterQuery(t, a, original.Address)
	if live.RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"f" || live.LastCallTxHash != ApplicationActionHash(raw) || live.LastUpdatedHeight != height {
		t.Fatal("next call did not execute against preserved storage")
	}
	after := a.committed.Accounts[position]
	if after.Nonce != before.Nonce+1 || after.Balance != before.Balance-SignedActionFeeYNXT || len(a.committed.EVMReceipts) != 1 {
		t.Fatal("new call did not have one real fee/nonce/receipt")
	}
	var legacy LegacyContracts
	queryJSON(t, a, "/ide/source", &legacy)
	if legacy.SourceAnchor != m.StateHash || !bytes.Equal(mustJSON(t, legacy.Contracts[original.Address]), mustJSON(t, original)) {
		t.Fatal("original ABI/compiler/verifier/storage provenance was rewritten")
	}
	beforeInvalid := mustJSON(t, a.committed)
	invalid := call
	invalid.Calldata = "0xffffffff"
	invalid.IdempotencyKey = "source-invalid-selector"
	invalid.RequestHash = IDECallRequestHash(invalid.Address, invalid.Calldata, invalid.IdempotencyKey)
	invalidRaw := mustIDEAction(t, deterministicPrivateKey(107), ActionIDEContractCall, invalid, after.Nonce+1)
	result, err := a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1900000001, 0).UTC(), Txs: [][]byte{invalidRaw}})
	if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code == 0 {
		t.Fatalf("invalid source selector accepted: %+v %v", result, err)
	}
	if !bytes.Equal(beforeInvalid, mustJSON(t, a.committed)) || a.pending.Accounts[position].Balance != after.Balance || a.pending.Accounts[position].Nonce != after.Nonce {
		t.Fatal("failed imported call leaked fee/nonce/storage into state")
	}
	restarted, err := NewPersistentApplication(m, statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, restarted.committed), beforeInvalid) {
		t.Fatal("restart changed source provenance or live contract state")
	}
	missing := a.committed
	missing.Contracts = nil
	if err := missing.Validate(m); err == nil {
		t.Fatal("live imported contract omission accepted")
	}
}

func TestMigratedContractActivePQOwnerCannotUseClassicAction(t *testing.T) {
	m, original, _ := sourceCounterMigration(t, true)
	a, err := NewPersistentApplication(m, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	classic := deterministicPrivateKey(107)
	owner := original.Deployer
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	network, err := hex.DecodeString(m.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	nonce := a.committed.Accounts[accountPosition(t, a.committed.Accounts, owner)].Nonce + 1
	height := m.Height + 1
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 0, NewRevision: 1, LedgerNonce: nonce, ActivateAt: height + 1}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	proof, _ := consensusPQProof(t, key, network, owner, ynxauth.MigrationPurpose, message)
	digest := sha256.Sum256(message)
	registration := ynxauth.Migration{Intent: intent, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize(), NewKeyProof: proof}
	wire, err := registration.Encode()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodePQTransaction(PQMigrationType, wire)
	if err != nil {
		t.Fatal(err)
	}
	result, err := a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: int64(height), Time: time.Unix(1900000000, 0).UTC(), Txs: [][]byte{raw}})
	if err != nil || result.TxResults[0].Code != 0 {
		t.Fatalf("real migration rejected: %+v %v", result, err)
	}
	if _, err := a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	call := IDEContractCallPayload{Address: original.Address, Calldata: "0x7cf5dab0" + strings.Repeat("0", 63) + "1", IdempotencyKey: "source-pq-classic-denied"}
	call.RequestHash = IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	classicRaw := mustIDEAction(t, classic, ActionIDEContractCall, call, nonce+1)
	before, _ := json.Marshal(a.committed)
	check, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: classicRaw})
	if err != nil || check.Code == 0 || !strings.Contains(check.Log, "post-quantum") {
		t.Fatalf("imported contract bypassed policy: %+v %v", check, err)
	}
	after, _ := json.Marshal(a.committed)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected classic call changed imported state")
	}
}
