package consensus

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestSponsoredUserOperationCommitsBatchAndRejectsReplayAtomically(t *testing.T) {
	ownerKey, sponsorKey, bundlerKey := deterministicPrivateKey(191), deterministicPrivateKey(192), deterministicPrivateKey(193)
	owner, sponsor, bundler := mustNativeAddress(t, ownerKey), mustNativeAddress(t, sponsorKey), mustNativeAddress(t, bundlerKey)
	recipient := mustNativeAddress(t, deterministicPrivateKey(194))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for address, amount := range map[string]int64{owner: 100, sponsor: 100, bundler: 10} {
		if _, err := devnet.Faucet(address, amount); err != nil {
			t.Fatal(err)
		}
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	_, ownerSigningKey, _ := ed25519.GenerateKey(nil)
	guardianPublic, _, _ := ed25519.GenerateKey(nil)
	start := time.Date(2026, 7, 23, 3, 0, 0, 0, time.UTC)
	createAccount := signedAssetAction(t, ownerKey, ActionSmartAccountCreate, SmartAccountCreatePayload{
		OwnerAlgorithm: assetauth.SignatureEd25519,
		OwnerPublicKey: ownerSigningKey.Public().(ed25519.PublicKey),
		SessionKeys:    []assetauth.SessionKey{},
		Recovery:       assetauth.GuardianRecoveryPolicy{Guardians: map[string][]byte{"guardian-1": guardianPublic}, Threshold: 1, Delay: time.Hour},
	}, 1)
	createPaymaster := signedAssetAction(t, sponsorKey, ActionPaymasterCreate, PaymasterCreatePayload{
		ID: "wallet-first-action", Products: []string{"wallet"}, Scopes: []string{recipient + ":transfer"}, PerAccountBudget: 5, GlobalBudget: 20, ExpiresAt: start.Add(24 * time.Hour),
	}, 1)
	operation := assetauth.UserOperation{
		Version: 1, ChainID: assetauth.MandateChainID, Account: owner, ProductID: "wallet", NonceDomain: "wallet/main", Nonce: 0,
		Calls:      []assetauth.AccountCall{{Target: recipient, Method: "transfer", ValueYNXT: 10, Asset: "ynxt", PayloadHash: hashText("first sponsored transfer")}},
		MaxFeeYNXT: 1, ValidAfter: start, ValidUntil: start.Add(time.Hour), PaymasterPolicy: "wallet-first-action",
	}
	message, err := operation.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	operation.Signature = ed25519.Sign(ownerSigningKey, message)
	execute := signedAssetAction(t, bundlerKey, ActionUserOperationExecute, UserOperationExecutePayload{Operation: operation}, 1)

	height := int64(migration.Height)
	for index, raw := range [][]byte{createAccount, createPaymaster, execute} {
		height++
		result, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: start.Add(time.Duration(index) * time.Minute), Txs: [][]byte{raw}})
		if err != nil || result.TxResults[0].Code != 0 {
			t.Fatalf("account abstraction action %d failed: %+v %v", index, result, err)
		}
		if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	var account assetauth.SmartAccount
	queryJSON(t, app, "/aa/accounts/"+owner, &account)
	if account.NonceByDomain["wallet/main"] != 1 {
		t.Fatalf("user operation nonce was not committed: %+v", account)
	}
	var paymaster BFTPaymaster
	queryJSON(t, app, "/aa/paymasters/wallet-first-action", &paymaster)
	if paymaster.Policy.GlobalSpent != 1 || paymaster.Policy.AccountSpent[owner] != 1 {
		t.Fatalf("paymaster spend was not committed: %+v", paymaster)
	}
	var events []BFTUserOperationEvent
	queryJSON(t, app, "/aa/user-operations", &events)
	if len(events) != 1 || events[0].Account != owner || events[0].Bundler != bundler || events[0].FeePayer != sponsor || events[0].ValueYNXT != 10 {
		t.Fatalf("unexpected user operation evidence: %+v", events)
	}
	assertConsensusAccount(t, app, owner, 89, 1)
	assertConsensusAccount(t, app, sponsor, 79, 1)
	assertConsensusAccount(t, app, bundler, 10, 1)
	assertConsensusAccount(t, app, recipient, 10, 0)
	if len(app.committed.FeeEvents) != 3 {
		t.Fatalf("user operation fee history did not reconcile: %+v", app.committed.FeeEvents)
	}
	if err := app.committed.Validate(migration); err != nil {
		t.Fatalf("account abstraction supply or audit validation failed: %v", err)
	}

	replay := signedAssetAction(t, bundlerKey, ActionUserOperationExecute, UserOperationExecutePayload{Operation: operation}, 2)
	height++
	result, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: start.Add(3 * time.Minute), Txs: [][]byte{replay}})
	if err != nil || result.TxResults[0].Code == 0 {
		t.Fatalf("user operation replay was not rejected: %+v %v", result, err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	assertConsensusAccount(t, app, bundler, 10, 1)
	queryJSON(t, app, "/aa/paymasters/wallet-first-action", &paymaster)
	if paymaster.Policy.GlobalSpent != 1 {
		t.Fatalf("replay consumed paymaster budget: %+v", paymaster)
	}
}

func TestCommittedStateMigratesVersion10WithoutInventingAccountAbstraction(t *testing.T) {
	key := deterministicPrivateKey(195)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(196))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 10); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	app, _ := NewApplication(migration)
	tx, _ := NewSignedTransfer(key, 6423, recipient, 2, 1)
	raw, _ := EncodeSignedTransaction(tx)
	height := int64(migration.Height) + 1
	if _, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(height, 0).UTC(), Txs: [][]byte{raw}}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	legacy := app.committed
	legacy.Version = 10
	legacy.SmartAccounts, legacy.Paymasters, legacy.UserOperationEvents = nil, nil, nil
	legacy.AppHash, _ = legacy.calculateHashFor("YNX_ABCI_STATE_V10", 10)
	legacyHash := legacy.AppHash
	payload, _ := json.Marshal(legacy)
	path := filepath.Join(t.TempDir(), "state-v10.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := loadCommittedState(path, migration)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Version != CommittedStateVersion || len(migrated.FeeEvents) != 1 || len(migrated.SmartAccounts)+len(migrated.Paymasters)+len(migrated.UserOperationEvents) != 0 || migrated.AppHash == legacyHash {
		t.Fatalf("v10 migration lost history or invented account abstraction records: %+v", migrated)
	}
}

func hashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return fmtHash(sum[:])
}

func fmtHash(value []byte) string {
	const alphabet = "0123456789abcdef"
	encoded := make([]byte, len(value)*2)
	for index, entry := range value {
		encoded[index*2] = alphabet[entry>>4]
		encoded[index*2+1] = alphabet[entry&15]
	}
	return string(encoded)
}
