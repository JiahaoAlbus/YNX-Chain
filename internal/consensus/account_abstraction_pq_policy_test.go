package consensus

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func aaPolicyAction(t *testing.T, key *secp256k1.PrivateKey, kind string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, kind, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func aaPolicyStateBytes(t *testing.T, state CommittedState) []byte {
	t.Helper()
	wire, err := encodeCommittedStateJSON(state)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

// The original bypass passes the unchanged inner Ed25519/P-256/session proof
// through a separate, still-classic bundler. The paymaster case independently
// migrates only the budget sponsor; neither the account nor bundler has PQ keys.
// Real registration/dual possession proofs are committed through the ABCI path.
func TestAAUserOperationCannotBypassActivatedInnerPQPolicy(t *testing.T) {
	for _, scenario := range []struct {
		name, algorithm, migrate string
		session, sponsored       bool
	}{
		{"owner_ed25519", assetauth.SignatureEd25519, "owner", false, true},
		{"owner_p256", assetauth.SignatureP256SHA256, "owner", false, true},
		{"owner_session", assetauth.SignatureEd25519, "owner", true, true},
		{"owner_self_paid", assetauth.SignatureEd25519, "owner", false, false},
		{"paymaster_sponsor", assetauth.SignatureEd25519, "sponsor", false, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx := context.Background()
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
			if err := devnet.EnableAccountPQ(2); err != nil {
				t.Fatal(err)
			}
			migration, err := devnet.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "account-policy.json")
			app, err := NewPersistentApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			start := time.Unix(1802736000, 0).UTC()
			blockTime := func(height int64) time.Time {
				return start.Add(time.Duration(height-int64(migration.Height)) * time.Minute)
			}
			commit := func(app *Application, transactions ...[]byte) {
				t.Helper()
				height := app.committed.Height + 1
				response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: blockTime(height), Txs: transactions})
				if err != nil {
					t.Fatal(err)
				}
				for _, result := range response.TxResults {
					if result.Code != 0 {
						t.Fatal("authentic fixture transaction rejected", result.Log)
					}
				}
				if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
			}
			ownerPublic, edKey, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			public := []byte(ownerPublic)
			var p256Key *ecdsa.PrivateKey
			if scenario.algorithm == assetauth.SignatureP256SHA256 {
				p256Key, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				if err != nil {
					t.Fatal(err)
				}
				public = elliptic.MarshalCompressed(elliptic.P256(), p256Key.X, p256Key.Y)
			}
			guardian, _, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			var sessions []assetauth.SessionKey
			var sessionKey ed25519.PrivateKey
			if scenario.session {
				var sessionPublic ed25519.PublicKey
				sessionPublic, sessionKey, err = ed25519.GenerateKey(rand.Reader)
				if err != nil {
					t.Fatal(err)
				}
				sessions = []assetauth.SessionKey{{ID: "wallet-session", Algorithm: assetauth.SignatureEd25519, PublicKey: sessionPublic, Scopes: []string{recipient + ":transfer"}, NonceDomain: "wallet/main", SpendLimitYNXT: 20, ExpiresAt: start.Add(24 * time.Hour)}}
			}
			commit(app, aaPolicyAction(t, ownerKey, ActionSmartAccountCreate, SmartAccountCreatePayload{OwnerAlgorithm: scenario.algorithm, OwnerPublicKey: public, SessionKeys: sessions, Recovery: assetauth.GuardianRecoveryPolicy{Guardians: map[string][]byte{"guardian": guardian}, Threshold: 1, Delay: time.Hour}}, 1))
			commit(app, aaPolicyAction(t, sponsorKey, ActionPaymasterCreate, PaymasterCreatePayload{ID: "pq-policy-budget", Products: []string{"wallet"}, Scopes: []string{recipient + ":transfer"}, PerAccountBudget: 5, GlobalBudget: 20, ExpiresAt: start.Add(24 * time.Hour)}, 1))
			operation := assetauth.UserOperation{Version: assetauth.UserOperationVersion, ChainID: assetauth.MandateChainID, Account: owner, ProductID: "wallet", NonceDomain: "wallet/main", Nonce: 0, Calls: []assetauth.AccountCall{{Target: recipient, Method: "transfer", ValueYNXT: 10, Asset: "ynxt", PayloadHash: hashText("unchanged classic user operation")}}, MaxFeeYNXT: 1, ValidAfter: start, ValidUntil: start.Add(time.Hour)}
			if scenario.sponsored {
				operation.PaymasterPolicy = "pq-policy-budget"
			}
			if scenario.session {
				operation.SessionKeyID = "wallet-session"
			}
			message, err := operation.SigningBytes()
			if err != nil {
				t.Fatal(err)
			}
			switch {
			case scenario.session:
				operation.Signature = ed25519.Sign(sessionKey, message)
			case p256Key != nil:
				operation.Signature, err = ecdsa.SignASN1(rand.Reader, p256Key, message)
				if err != nil {
					t.Fatal(err)
				}
			default:
				operation.Signature = ed25519.Sign(edKey, message)
			}
			execute := aaPolicyAction(t, bundlerKey, ActionUserOperationExecute, UserOperationExecutePayload{Operation: operation}, 1)
			check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: execute})
			if err != nil || check.Code != 0 {
				t.Fatal("unmigrated classic operation was not eligible", err, check)
			}

			migratingKey, migratingOwner := ownerKey, owner
			if scenario.migrate == "sponsor" {
				migratingKey, migratingOwner = sponsorKey, sponsor
			}
			pqKey, pair, err := ynxbatch.KeyGen()
			if err != nil {
				t.Fatal(err)
			}
			defer pqKey.Destroy()
			network, err := hex.DecodeString(migration.OriginalGenesisHash)
			if err != nil {
				t.Fatal(err)
			}
			activation := uint64(app.committed.Height + 3)
			intent := ynxauth.RegistrationIntent{ChainID: network, Owner: migratingOwner, PKA: pair.PKA, PKB: pair.PKB, PriorRevision: 0, NewRevision: 1, LedgerNonce: 2, ActivateAt: activation}
			intentBytes, err := intent.SigningBytes()
			if err != nil {
				t.Fatal(err)
			}
			whole, _ := consensusPQProof(t, pqKey, network, migratingOwner, ynxauth.MigrationPurpose, intentBytes)
			digest := sha256.Sum256(intentBytes)
			registration := ynxauth.Migration{Intent: intent, ClassicPublicKey: migratingKey.PubKey().SerializeCompressed(), ClassicSignature: secpECDSA.Sign(migratingKey, digest[:]).Serialize(), NewKeyProof: whole}
			registrationWire, err := registration.Encode()
			if err != nil {
				t.Fatal(err)
			}
			migrationTx, err := EncodePQTransaction(PQMigrationType, registrationWire)
			if err != nil {
				t.Fatal(err)
			}
			commit(app, migrationTx)
			if len(app.committed.AccountPolicy.Records) != 1 {
				t.Fatal("real migration did not append its policy record")
			}
			check, err = app.CheckTx(ctx, &abci.RequestCheckTx{Tx: execute})
			if err != nil || check.Code != 0 || app.pending != nil {
				t.Fatal("pending PQ registration prematurely disabled classic authority", err, check)
			}
			// Fork a byte-for-byte committed checkpoint to prove the very same
			// signed outer and inner request really executes before activation.
			checkpoint, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			controlPath := filepath.Join(t.TempDir(), "classic-control.json")
			if err := os.WriteFile(controlPath, checkpoint, 0o600); err != nil {
				t.Fatal(err)
			}
			control, err := NewPersistentApplication(migration, controlPath)
			if err != nil {
				t.Fatal(err)
			}
			commit(control, execute)
			if len(control.committed.UserOperationEvents) != 1 || control.committed.UserOperationEvents[0].Bundler != bundler || control.committed.SmartAccounts[0].NonceByDomain["wallet/main"] != 1 {
				t.Fatal("preactivation control did not actually execute the original request")
			}
			spent := uint64(0)
			if scenario.sponsored {
				spent = 1
			}
			if control.committed.Paymasters[0].Policy.GlobalSpent != spent || control.committed.Paymasters[0].Policy.AccountSpent[owner] != spent {
				t.Fatal("control did not consume the expected real sponsor budget")
			}
			commit(app) // Advance the original branch to the activation boundary.
			if uint64(app.committed.Height+1) != activation || app.committed.AccountPolicy.RequireLegacy(bundler, activation) != nil {
				t.Fatal("fixture must retain a different eligible classic bundler")
			}
			beforeHeight := app.committed.Height
			before := aaPolicyStateBytes(t, app.committed)
			fileBefore, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			check, err = app.CheckTx(ctx, &abci.RequestCheckTx{Tx: execute})
			if err != nil || check.Code != CodeInvalidTx || !strings.Contains(check.Log, "post-quantum") {
				t.Fatal("separate classic bundler bypassed activated inner policy", err, check)
			}
			if app.pending != nil || !bytes.Equal(before, aaPolicyStateBytes(t, app.committed)) {
				t.Fatal("rejected CheckTx mutated state, nonce, session allowance or paymaster budget")
			}
			response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: beforeHeight + 1, Time: blockTime(beforeHeight + 1), Txs: [][]byte{execute}})
			if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != CodeInvalidTx || !strings.Contains(response.TxResults[0].Log, "post-quantum") {
				t.Fatal("Finalize allowed the same old inner signature after PQ activation", err, response)
			}
			if !bytes.Equal(before, aaPolicyStateBytes(t, app.committed)) || app.pending == nil {
				t.Fatal("failed transaction published or lost pending block state")
			}
			pending := *app.pending
			pending.Height = beforeHeight // Only the empty block's height may change.
			if !bytes.Equal(before, aaPolicyStateBytes(t, pending)) {
				t.Fatal("rejected inner authority consumed balance, nonce, resources, session or sponsorship in pending state")
			}
			fileAfter, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(fileBefore, fileAfter) {
				t.Fatal("rejected transaction changed the original durable checkpoint before Commit", err)
			}
			if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			cold, err := NewPersistentApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			recovered := cold.committed
			recovered.Height = beforeHeight
			if !bytes.Equal(before, aaPolicyStateBytes(t, recovered)) {
				t.Fatal("cold restart lost original AA balance/nonces/budgets after rejection")
			}
			check, err = cold.CheckTx(ctx, &abci.RequestCheckTx{Tx: execute})
			if err != nil || check.Code != CodeInvalidTx || !strings.Contains(check.Log, "post-quantum") {
				t.Fatal("cold restart restored classic inner authority", err, check)
			}
		})
	}
}
