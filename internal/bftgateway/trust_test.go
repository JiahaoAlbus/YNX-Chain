package bftgateway

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsAndQueriesSignedTrustWorkflow(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 94))
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

	create := consensus.GovernanceRequestPayload{Requester: signer, Subject: "subject_gateway", Action: "add risk label", AssetType: "address", Scope: "one address", Description: "review one advisory label", Evidence: []string{"case:gateway"}}
	createRaw := signedPay(t, key, consensus.ActionGovernanceCreate, create, 1)
	var request consensus.BFTGovernanceRequest
	postSignedAction(t, server.URL+"/governance/requests", createRaw, http.StatusCreated, &request)
	if request.Requester != signer || request.Status != "pending_review" {
		t.Fatalf("unexpected request: %+v", request)
	}
	review := consensus.GovernanceDecisionPayload{RequestID: request.ID, Reviewer: signer}
	reviewRaw := signedPay(t, key, consensus.ActionGovernanceReview, review, 2)
	postSignedAction(t, server.URL+"/governance/requests/"+request.ID+"/review", reviewRaw, http.StatusOK, &request)
	if request.Status != "reviewed" || request.Reviewer != signer {
		t.Fatalf("unexpected review: %+v", request)
	}
	appealInput := consensus.TrustAppealPayload{RequestID: request.ID, Subject: request.Subject, Appellant: signer, Claimant: signer, Reason: "false positive", Evidence: []string{"owner proof"}}
	appealRaw := signedPay(t, key, consensus.ActionTrustAppealCreate, appealInput, 3)
	var appeal consensus.BFTTrustAppeal
	postSignedAction(t, server.URL+"/trust/appeals", appealRaw, http.StatusCreated, &appeal)
	resolve := consensus.TrustAppealDecisionPayload{AppealID: appeal.ID, Reviewer: signer, Decision: "LABEL_REMOVED", ResolutionReason: "verified false positive"}
	resolveRaw := signedPay(t, key, consensus.ActionTrustAppealResolve, resolve, 4)
	postSignedAction(t, server.URL+"/trust/appeals/"+appeal.ID+"/resolve", resolveRaw, http.StatusOK, &appeal)
	if appeal.Status != "LABEL_REMOVED" || appeal.ReviewerSigner != signer {
		t.Fatalf("unexpected appeal: %+v", appeal)
	}

	var lookup consensus.BFTGovernanceRequest
	getJSON(t, server.URL+"/governance/requests/"+request.ID, &lookup)
	if lookup.ID != request.ID || lookup.Status != "reviewed" {
		t.Fatalf("unexpected request lookup: %+v", lookup)
	}
	var report chain.TransparencyReport
	getJSON(t, server.URL+"/governance/transparency", &report)
	if report.EntryCount != 4 || report.AppealCount != 1 || report.ReviewCount < 2 || report.TruthfulStatus != "cometbft-abci-backed-transparency" {
		t.Fatalf("unexpected report: %+v", report)
	}
	var rules struct {
		Rules []chain.RequestValidityRule `json:"rules"`
	}
	getJSON(t, server.URL+"/governance/request-validity-rules", &rules)
	if len(rules.Rules) == 0 {
		t.Fatal("request validity rules missing")
	}

	wrong := consensus.GovernanceDecisionPayload{RequestID: request.ID, Reviewer: signer, Reason: "reject"}
	wrongRaw := signedPay(t, key, consensus.ActionGovernanceReject, wrong, 5)
	var ignored map[string]any
	postSignedAction(t, server.URL+"/governance/requests/000000000000000000000000/reject", wrongRaw, http.StatusBadRequest, &ignored)
}
