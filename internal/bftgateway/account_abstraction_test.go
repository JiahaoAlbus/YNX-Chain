package bftgateway

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsSponsoredUserOperationWithAuthoritativeEvidence(t *testing.T) {
	ownerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 81))
	sponsorKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 82))
	bundlerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 83))
	owner, _ := consensus.NativeAddress(ownerKey.PubKey().SerializeCompressed())
	sponsor, _ := consensus.NativeAddress(sponsorKey.PubKey().SerializeCompressed())
	bundler, _ := consensus.NativeAddress(bundlerKey.PubKey().SerializeCompressed())
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 84))
	recipient, _ := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for address, amount := range map[string]int64{owner: 100, sponsor: 100, bundler: 10} {
		if _, err := devnet.Faucet(address, amount); err != nil {
			t.Fatal(err)
		}
	}
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(newABCICometFixture(t, app, int64(migration.Height)))
	defer upstream.Close()
	gateway, _ := New(Config{CometRPCURL: upstream.URL})
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	_, userKey, _ := ed25519.GenerateKey(nil)
	guardian, _, _ := ed25519.GenerateKey(nil)
	create, _ := consensus.NewSignedApplicationAction(ownerKey, 6423, consensus.ActionSmartAccountCreate, consensus.SmartAccountCreatePayload{OwnerAlgorithm: assetauth.SignatureEd25519, OwnerPublicKey: userKey.Public().(ed25519.PublicKey), SessionKeys: []assetauth.SessionKey{}, Recovery: assetauth.GuardianRecoveryPolicy{Guardians: map[string][]byte{"guardian": guardian}, Threshold: 1, Delay: time.Hour}}, 1)
	createRaw, _ := consensus.EncodeSignedApplicationAction(create)
	var accountResponse struct {
		Source  string                 `json:"source"`
		Version string                 `json:"version"`
		Failure bool                   `json:"failure"`
		Account assetauth.SmartAccount `json:"account"`
	}
	postSignedAction(t, server.URL+"/aa/accounts", createRaw, http.StatusCreated, &accountResponse)
	if accountResponse.Failure || accountResponse.Source != "ynx-consensus-abci" || accountResponse.Version != accountAbstractionAPIVersion || accountResponse.Account.Address != owner {
		t.Fatalf("unexpected smart account response: %+v", accountResponse)
	}

	start := accountResponse.Account.CreatedAt
	paymasterTx, _ := consensus.NewSignedApplicationAction(sponsorKey, 6423, consensus.ActionPaymasterCreate, consensus.PaymasterCreatePayload{ID: "wallet-sponsor", Products: []string{"wallet"}, Scopes: []string{recipient + ":transfer"}, PerAccountBudget: 5, GlobalBudget: 20, ExpiresAt: start.Add(24 * time.Hour)}, 1)
	paymasterRaw, _ := consensus.EncodeSignedApplicationAction(paymasterTx)
	var paymasterResponse struct {
		Failure   bool                   `json:"failure"`
		Paymaster consensus.BFTPaymaster `json:"paymaster"`
	}
	postSignedAction(t, server.URL+"/aa/paymasters", paymasterRaw, http.StatusCreated, &paymasterResponse)
	if paymasterResponse.Failure || paymasterResponse.Paymaster.Policy.Sponsor != sponsor {
		t.Fatalf("unexpected paymaster response: %+v", paymasterResponse)
	}

	callHash := sha256.Sum256([]byte("gateway sponsored call"))
	operation := assetauth.UserOperation{Version: 1, ChainID: assetauth.MandateChainID, Account: owner, ProductID: "wallet", NonceDomain: "wallet/main", Calls: []assetauth.AccountCall{{Target: recipient, Method: "transfer", ValueYNXT: 10, Asset: "ynxt", PayloadHash: hex.EncodeToString(callHash[:])}}, MaxFeeYNXT: 1, ValidAfter: start, ValidUntil: start.Add(time.Hour), PaymasterPolicy: "wallet-sponsor"}
	message, _ := operation.SigningBytes()
	operation.Signature = ed25519.Sign(userKey, message)
	execute, _ := consensus.NewSignedApplicationAction(bundlerKey, 6423, consensus.ActionUserOperationExecute, consensus.UserOperationExecutePayload{Operation: operation}, 1)
	executeRaw, _ := consensus.EncodeSignedApplicationAction(execute)
	var operationResponse struct {
		Failure       bool                            `json:"failure"`
		UserOperation consensus.BFTUserOperationEvent `json:"userOperation"`
	}
	postSignedAction(t, server.URL+"/aa/user-operations", executeRaw, http.StatusCreated, &operationResponse)
	if operationResponse.Failure || operationResponse.UserOperation.Account != owner || operationResponse.UserOperation.Bundler != bundler || operationResponse.UserOperation.FeePayer != sponsor || operationResponse.UserOperation.PaymasterID != "wallet-sponsor" {
		t.Fatalf("unexpected user operation response: %+v", operationResponse)
	}

	var listed struct {
		Failure        bool                              `json:"failure"`
		UserOperations []consensus.BFTUserOperationEvent `json:"userOperations"`
	}
	getJSON(t, server.URL+"/aa/user-operations", &listed)
	if listed.Failure || len(listed.UserOperations) != 1 || listed.UserOperations[0].ID != operationResponse.UserOperation.ID {
		t.Fatalf("unexpected user operation list: %+v", listed)
	}
	postSignedAction(t, server.URL+"/aa/paymasters", executeRaw, http.StatusBadRequest, nil)
}
