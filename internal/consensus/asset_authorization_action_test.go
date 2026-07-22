package consensus

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestStrategyMandateAndVaultAreCommittedWithOwnerOnlyWithdrawal(t *testing.T) {
	ctx := context.Background()
	ownerKey, engineKey := deterministicPrivateKey(181), deterministicPrivateKey(182)
	owner, engine := mustNativeAddress(t, ownerKey), mustNativeAddress(t, engineKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(owner, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(engine, 20); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplication(migration, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	blockTime := time.Date(2026, 7, 23, 1, 0, 0, 0, time.UTC)
	strategyHash := sha256.Sum256([]byte("strategy/mandate-1/v1"))
	createMandate := signedAssetAction(t, ownerKey, ActionStrategyMandateCreate, StrategyMandateCreatePayload{
		ID: "mandate-1", EngineIdentity: engine, StrategyHash: hex.EncodeToString(strategyHash[:]), StrategyVersion: 1,
		Venues: []string{"venue-1"}, Assets: []string{"ynxt"}, Markets: []string{"ynxt/usd"}, Methods: []string{assetauth.MethodPlaceOrder, assetauth.MethodCancelOrder},
		CapitalLimitYNXT: 50, PositionLimitYNXT: 25, MaxLeverageBPS: 20_000, MaxSlippageBPS: 100,
		DailyLossLimitYNXT: 5, DrawdownLimitBPS: 1_000, ValidAfter: blockTime, ExpiresAt: blockTime.Add(24 * time.Hour), NonceDomain: "quant/mandate-1",
	}, 1)
	createVault := signedAssetAction(t, ownerKey, ActionStrategyVaultCreate, StrategyVaultCreatePayload{VaultID: "vault-1", MandateID: "mandate-1"}, 2)
	deposit := signedAssetAction(t, ownerKey, ActionStrategyVaultDeposit, StrategyVaultAmountPayload{VaultID: "vault-1", AmountYNXT: 10}, 3)
	unauthorizedWithdrawal := signedAssetAction(t, engineKey, ActionStrategyVaultWithdraw, StrategyVaultAmountPayload{VaultID: "vault-1", AmountYNXT: 1}, 1)
	withdraw := signedAssetAction(t, ownerKey, ActionStrategyVaultWithdraw, StrategyVaultAmountPayload{VaultID: "vault-1", AmountYNXT: 4}, 4)
	kill := signedAssetAction(t, ownerKey, ActionStrategyMandateKill, StrategyMandateControlPayload{MandateID: "mandate-1"}, 5)
	exit := signedAssetAction(t, ownerKey, ActionStrategyVaultExit, StrategyVaultAmountPayload{VaultID: "vault-1"}, 6)
	txs := [][]byte{createMandate, createVault, deposit, unauthorizedWithdrawal, withdraw, kill, exit}
	height := int64(migration.Height) + 1
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: txs})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatalf("proposal containing unauthorized withdrawal was not rejected: %+v %v", proposal, err)
	}
	// FinalizeBlock must still deterministically reject only the invalid member
	// and commit the surrounding valid state transitions.
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil || len(finalized.TxResults) != len(txs) {
		t.Fatalf("asset authorization block failed: %+v %v", finalized, err)
	}
	if finalized.TxResults[3].Code == 0 {
		t.Fatal("engine withdrawal was committed")
	}
	for index, result := range finalized.TxResults {
		if index != 3 && result.Code != 0 {
			t.Fatalf("valid asset action %d failed: %+v", index, result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	var mandate assetauth.StrategyMandate
	queryJSON(t, app, "/quant/mandates/mandate-1", &mandate)
	if mandate.Owner != owner || mandate.EngineIdentity != engine || mandate.KillSwitchAt == nil || mandate.NextNonce != 1 {
		t.Fatalf("unexpected committed mandate: %+v", mandate)
	}
	var vault assetauth.StrategyVault
	queryJSON(t, app, "/quant/vaults/vault-1", &vault)
	if vault.Owner != owner || vault.BalanceYNXT != 0 || vault.ClosedAt == nil {
		t.Fatalf("unexpected committed vault: %+v", vault)
	}
	var audit []BFTAssetAuditEvent
	queryJSON(t, app, "/quant/audit", &audit)
	if len(audit) != 6 || audit[0].Type != ActionStrategyMandateCreate || audit[5].Type != ActionStrategyVaultExit {
		t.Fatalf("unexpected asset audit events: %+v", audit)
	}
	assertConsensusAccount(t, app, owner, 94, 6)
	assertConsensusAccount(t, app, engine, 20, 0)
	if err := app.committed.Validate(migration); err != nil {
		t.Fatalf("committed asset state failed supply/lot validation: %v", err)
	}
}

func TestCommittedStateMigratesVersion8WithoutInventingAssetRecords(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	payer := mustNativeAddress(t, deterministicPrivateKey(183))
	if _, err := devnet.Faucet(payer, 10); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	legacy := initialCommittedState(migration)
	legacy.Version = 8
	legacy.StrategyMandates, legacy.StrategyVaults, legacy.AssetAuditEvents = nil, nil, nil
	legacy.FeeEvents = []BFTFeeEvent{newCurrentFeeEvent("0xlegacy", "transfer", payer, migration.Validators[0].Address, 1, int64(migration.Height)+1, time.Unix(10, 0).UTC())}
	legacy.Initialized = true
	legacy.Height = int64(migration.Height) + 1
	legacy.AppHash, err = legacy.calculateHashFor("YNX_ABCI_STATE_V8", 8)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(legacy)
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := loadCommittedState(path, migration)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Version != 9 || len(migrated.FeeEvents) != 1 || len(migrated.StrategyMandates)+len(migrated.StrategyVaults)+len(migrated.AssetAuditEvents) != 0 {
		t.Fatalf("v8 migration changed history or invented asset records: %+v", migrated)
	}
}

func signedAssetAction(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
