package bftgateway

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsAndQueriesQuantMandatesAndVaults(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 73))
	owner, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(owner, 100); err != nil {
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
	upstream := httptest.NewServer(newABCICometFixture(t, app, int64(migration.Height)))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	mandateInput := consensus.StrategyMandateCreatePayload{
		ID: "mandate-alpha", EngineIdentity: "engine-alpha", StrategyHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		StrategyVersion: 1, Venues: []string{"venue-a"}, Assets: []string{"ynxt"}, Markets: []string{"ynxt-usd"}, Methods: []string{assetauth.MethodPlaceOrder},
		CapitalLimitYNXT: 50, PositionLimitYNXT: 40, MaxLeverageBPS: 20_000, MaxSlippageBPS: 100,
		DailyLossLimitYNXT: 10, DrawdownLimitBPS: 2_000, ValidAfter: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2028, 1, 1, 0, 0, 0, 0, time.UTC), NonceDomain: "engine-alpha-orders",
	}
	mandateTx, err := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionStrategyMandateCreate, mandateInput, 1)
	if err != nil {
		t.Fatal(err)
	}
	mandateRaw, _ := consensus.EncodeSignedApplicationAction(mandateTx)
	var mandateResponse struct {
		Source  string                       `json:"source"`
		Version string                       `json:"version"`
		Failure bool                         `json:"failure"`
		Mandate assetauth.StrategyMandate    `json:"mandate"`
		Audit   consensus.BFTAssetAuditEvent `json:"auditEvent"`
	}
	postSignedAction(t, server.URL+"/quant/mandates", mandateRaw, http.StatusCreated, &mandateResponse)
	if mandateResponse.Failure || mandateResponse.Source != "ynx-consensus-abci" || mandateResponse.Version != quantAPIVersion || mandateResponse.Mandate.ID != mandateInput.ID || mandateResponse.Mandate.Owner != owner || mandateResponse.Audit.RecordID != mandateInput.ID {
		t.Fatalf("unexpected mandate response: %+v", mandateResponse)
	}

	vaultTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionStrategyVaultCreate, consensus.StrategyVaultCreatePayload{VaultID: "vault-alpha", MandateID: mandateInput.ID}, 2)
	vaultRaw, _ := consensus.EncodeSignedApplicationAction(vaultTx)
	var vaultResponse struct {
		Failure bool                    `json:"failure"`
		Vault   assetauth.StrategyVault `json:"vault"`
	}
	postSignedAction(t, server.URL+"/quant/vaults", vaultRaw, http.StatusCreated, &vaultResponse)
	if vaultResponse.Failure || vaultResponse.Vault.ID != "vault-alpha" || vaultResponse.Vault.Owner != owner {
		t.Fatalf("unexpected vault response: %+v", vaultResponse)
	}

	depositTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionStrategyVaultDeposit, consensus.StrategyVaultAmountPayload{VaultID: "vault-alpha", AmountYNXT: 20}, 3)
	depositRaw, _ := consensus.EncodeSignedApplicationAction(depositTx)
	postSignedAction(t, server.URL+"/quant/vaults/vault-alpha/deposit", depositRaw, http.StatusOK, &vaultResponse)
	if vaultResponse.Vault.BalanceYNXT != 20 {
		t.Fatalf("unexpected deposited vault: %+v", vaultResponse.Vault)
	}
	postSignedAction(t, server.URL+"/quant/vaults/wrong-vault/deposit", depositRaw, http.StatusBadRequest, nil)

	var mandates struct {
		Source   string                      `json:"source"`
		Failure  bool                        `json:"failure"`
		Mandates []assetauth.StrategyMandate `json:"mandates"`
	}
	getJSON(t, server.URL+"/quant/mandates", &mandates)
	if mandates.Failure || mandates.Source != "ynx-consensus-abci" || len(mandates.Mandates) != 1 || mandates.Mandates[0].ID != mandateInput.ID {
		t.Fatalf("unexpected mandate list: %+v", mandates)
	}
	var audit struct {
		Failure bool                           `json:"failure"`
		Events  []consensus.BFTAssetAuditEvent `json:"events"`
	}
	getJSON(t, server.URL+"/quant/audit", &audit)
	if audit.Failure || len(audit.Events) != 3 || audit.Events[2].Type != consensus.ActionStrategyVaultDeposit {
		t.Fatalf("unexpected Quant audit response: %+v", audit)
	}
}
