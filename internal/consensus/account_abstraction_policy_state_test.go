package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type aaPolicyHistoryFixture struct {
	migration  chain.ConsensusMigrationState
	state      CommittedState
	path       string
	activation int64
	blockTime  func(int64) time.Time
}

// Only the selected authority migrates. The fixture executes the original AA
// request before activation, then persists and recovers that genuine history
// after activation. Registration uses actual classic authorization and dual PoP.
func newAAPolicyHistoryFixture(t *testing.T, role string) aaPolicyHistoryFixture {
	t.Helper()
	ctx := context.Background()
	ownerKey, sponsorKey, bundlerKey := deterministicPrivateKey(191), deterministicPrivateKey(192), deterministicPrivateKey(193)
	owner, sponsor, bundler := mustNativeAddress(t, ownerKey), mustNativeAddress(t, sponsorKey), mustNativeAddress(t, bundlerKey)
	recipient := mustNativeAddress(t, deterministicPrivateKey(194))
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for _, address := range []string{owner, sponsor, bundler} {
		if _, err := d.Faucet(address, 100); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "original-aa-checkpoint.json")
	app, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Unix(1802736000, 0).UTC()
	blockTime := func(h int64) time.Time { return start.Add(time.Duration(h-int64(migration.Height)) * time.Minute) }
	commit := func(txs ...[]byte) {
		t.Helper()
		h := app.committed.Height + 1
		response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Time: blockTime(h), Txs: txs})
		if err != nil {
			t.Fatal(err)
		}
		for _, result := range response.TxResults {
			if result.Code != 0 {
				t.Fatal("authentic AA history fixture rejected", result.Log)
			}
		}
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	ownerPublic, ownerPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	guardian, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	commit(aaPolicyAction(t, ownerKey, ActionSmartAccountCreate, SmartAccountCreatePayload{OwnerAlgorithm: assetauth.SignatureEd25519, OwnerPublicKey: ownerPublic, Recovery: assetauth.GuardianRecoveryPolicy{Guardians: map[string][]byte{"guardian": guardian}, Threshold: 1, Delay: time.Hour}}, 1))
	commit(aaPolicyAction(t, sponsorKey, ActionPaymasterCreate, PaymasterCreatePayload{ID: "aa-history-budget", Products: []string{"wallet"}, Scopes: []string{recipient + ":transfer"}, PerAccountBudget: 5, GlobalBudget: 20, ExpiresAt: start.Add(24 * time.Hour)}, 1))

	migratingKey, migratingOwner := ownerKey, owner
	switch role {
	case "account":
	case "bundler":
		migratingKey, migratingOwner = bundlerKey, bundler
	case "paymaster sponsor":
		migratingKey, migratingOwner = sponsorKey, sponsor
	default:
		t.Fatal("unknown fixture authority", role)
	}
	pqKey, pair, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pqKey.Destroy)
	network, err := hex.DecodeString(migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	activation := app.committed.Height + 3
	migratingIndex, ok := accountIndex(app.committed.Accounts, migratingOwner)
	if !ok {
		t.Fatal("migrating authority lacks its real account")
	}
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: migratingOwner, PKA: pair.PKA, PKB: pair.PKB, NewRevision: 1, LedgerNonce: app.committed.Accounts[migratingIndex].Nonce + 1, ActivateAt: uint64(activation)}
	intentBytes, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	proof, _ := consensusPQProof(t, pqKey, network, migratingOwner, ynxauth.MigrationPurpose, intentBytes)
	digest := sha256.Sum256(intentBytes)
	registration := ynxauth.Migration{Intent: intent, ClassicPublicKey: migratingKey.PubKey().SerializeCompressed(), ClassicSignature: secpECDSA.Sign(migratingKey, digest[:]).Serialize(), NewKeyProof: proof}
	registrationWire, err := registration.Encode()
	if err != nil {
		t.Fatal(err)
	}
	registrationTx, err := EncodePQTransaction(PQMigrationType, registrationWire)
	if err != nil {
		t.Fatal(err)
	}
	commit(registrationTx)

	operation := assetauth.UserOperation{Version: assetauth.UserOperationVersion, ChainID: assetauth.MandateChainID, Account: owner, ProductID: "wallet", NonceDomain: "wallet/main", Calls: []assetauth.AccountCall{{Target: recipient, Method: "transfer", ValueYNXT: 10, Asset: "ynxt", PayloadHash: hashText("actual retained AA execution")}}, MaxFeeYNXT: 1, ValidAfter: start, ValidUntil: start.Add(time.Hour), PaymasterPolicy: "aa-history-budget"}
	message, err := operation.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	operation.Signature = ed25519.Sign(ownerPrivate, message)
	bundlerIndex, _ := accountIndex(app.committed.Accounts, bundler)
	ownerIndex, _ := accountIndex(app.committed.Accounts, owner)
	ownerBefore := app.committed.Accounts[ownerIndex]
	bundlerBefore := app.committed.Accounts[bundlerIndex]
	commit(aaPolicyAction(t, bundlerKey, ActionUserOperationExecute, UserOperationExecutePayload{Operation: operation}, bundlerBefore.Nonce+1))
	ownerIndex, _ = accountIndex(app.committed.Accounts, owner)
	bundlerIndex, _ = accountIndex(app.committed.Accounts, bundler)
	recipientIndex, found := accountIndex(app.committed.Accounts, recipient)
	if !found || app.committed.Accounts[ownerIndex].Balance != ownerBefore.Balance-10 || app.committed.Accounts[recipientIndex].Balance != 10 || app.committed.Accounts[bundlerIndex].Nonce != bundlerBefore.Nonce+1 || app.committed.SmartAccounts[0].NonceByDomain["wallet/main"] != 1 || app.committed.Paymasters[0].Policy.GlobalSpent != 1 || app.committed.Paymasters[0].Policy.AccountSpent[owner] != 1 || len(app.committed.UserOperationEvents) != 1 || app.committed.UserOperationEvents[0].BlockHeight != activation-1 {
		t.Fatal("preactivation operation did not execute its original balance, nonce and sponsor effects")
	}
	commit() // Effective policy must not retroactively invalidate the earlier event.
	if app.committed.Height != activation || app.committed.AccountPolicy.RequireLegacy(migratingOwner, uint64(activation)) == nil {
		t.Fatal("fixture did not reach actual PQ activation")
	}
	for _, subject := range []string{owner, sponsor, bundler} {
		if subject != migratingOwner && app.committed.AccountPolicy.RequireLegacy(subject, uint64(activation)) != nil {
			t.Fatal("fixture migrated an unrelated authority")
		}
	}
	cold, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal("real preactivation history did not survive cold recovery after activation", err)
	}
	if !bytes.Equal(aaPolicyStateBytes(t, app.committed), aaPolicyStateBytes(t, cold.committed)) {
		t.Fatal("cold recovery changed the original committed history")
	}
	return aaPolicyHistoryFixture{migration: migration, state: cold.committed, path: path, activation: activation, blockTime: blockTime}
}

// Move only retained execution metadata. Balances, transaction hashes, nonce
// domains, policy proofs and escrow spend remain the actual committed values.
// Recomputing public checksums must not authorize forbidden historical effects.
func aaHistoryAt(t *testing.T, f aaPolicyHistoryFixture, height int64) CommittedState {
	t.Helper()
	var state CommittedState
	if err := json.Unmarshal(aaPolicyStateBytes(t, f.state), &state); err != nil {
		t.Fatal(err)
	}
	event := &state.UserOperationEvents[0]
	event.BlockHeight, event.ExecutedAt = height, f.blockTime(height)
	event.AuditHash = userOperationAuditHash(*event)
	for i := range state.FeeEvents {
		fee := &state.FeeEvents[i]
		if fee.TxHash == event.TransactionHash && fee.TransactionType == "user_operation" {
			fee.BlockHeight, fee.RecordedAt = height, event.ExecutedAt
			fee.AuditHash = feeEventAuditHash(*fee)
		}
	}
	index, ok := paymasterIndex(state.Paymasters, event.PaymasterID)
	if !ok {
		t.Fatal("original paymaster missing")
	}
	state.Paymasters[index].BlockHeight = height
	state.Paymasters[index].AuditHash = paymasterAuditHash(state.Paymasters[index])
	if !reflect.DeepEqual(state.Accounts, f.state.Accounts) || !reflect.DeepEqual(state.SmartAccounts, f.state.SmartAccounts) || !reflect.DeepEqual(state.AccountPolicy, f.state.AccountPolicy) || !reflect.DeepEqual(state.PQHistory, f.state.PQHistory) {
		t.Fatal("history counterexample changed balances, nonces or original PQ proofs")
	}
	// The existing AA accounting validator must still accept this counterexample;
	// otherwise the test never reaches the missing historical-policy condition.
	if _, err := validateAccountAbstractionState(state.SmartAccounts, state.Paymasters, state.UserOperationEvents, state.FeeEvents); err != nil {
		t.Fatal("counterexample did not preserve original AA validation", err)
	}
	var err error
	state.AppHash, err = state.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestAACommittedHistoryRejectsActivatedAuthorityOnColdRecovery(t *testing.T) {
	for _, role := range []string{"account", "bundler", "paymaster sponsor"} {
		t.Run(role, func(t *testing.T) {
			f := newAAPolicyHistoryFixture(t, role)
			before, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			bad := aaHistoryAt(t, f, f.activation)
			want := role + " authorization at height"
			if err := bad.Validate(f.migration); err == nil || !strings.Contains(err.Error(), want) {
				t.Fatal("rechecksummed AA history bypassed the original-height authority rule", role, err)
			}
			path := filepath.Join(t.TempDir(), "rechecksummed-aa-history.json")
			if err := os.WriteFile(path, aaPolicyStateBytes(t, bad), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := NewPersistentApplication(f.migration, path); err == nil || !strings.Contains(err.Error(), want) {
				t.Fatal("normal cold constructor accepted forbidden AA history", role, err)
			}
			after, err := os.ReadFile(f.path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected replacement changed the original checkpoint", err)
			}
			// The exact previous-height record remains valid under the now-active
			// complete policy and retains its original application hash.
			control := aaHistoryAt(t, f, f.activation-1)
			if err := control.Validate(f.migration); err != nil || control.AppHash != f.state.AppHash {
				t.Fatal("preactivation history or its original AppHash changed", err)
			}
		})
	}
}

func TestAACommittedHistoryRejectsFutureExecutionHeight(t *testing.T) {
	f := newAAPolicyHistoryFixture(t, "account")
	bad := aaHistoryAt(t, f, f.state.Height+1)
	if err := bad.Validate(f.migration); err == nil || !strings.Contains(err.Error(), "outside committed tip") {
		t.Fatal("AA history accepted an execution beyond the actual committed checkpoint", err)
	}
	path := filepath.Join(t.TempDir(), "future-aa-history.json")
	if err := os.WriteFile(path, aaPolicyStateBytes(t, bad), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentApplication(f.migration, path); err == nil || !strings.Contains(err.Error(), "outside committed tip") {
		t.Fatal("normal cold recovery accepted future AA execution", err)
	}
}
