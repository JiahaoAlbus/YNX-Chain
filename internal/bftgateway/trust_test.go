package bftgateway

import (
	"io"
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
	labelInput := consensus.TrustLabelPayload{Issuer: signer, Subject: signer, SubjectType: "address", Address: signer, Label: "reviewed-risk", RiskWeightBps: 1500, ConfidenceBps: 8000, Source: "case:gateway", EvidenceHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ExpiryHours: 24, ReviewRequired: true, AppealAvailable: true}
	labelRaw := signedPay(t, key, consensus.ActionTrustLabelCreate, labelInput, 3)
	var label consensus.BFTTrustLabel
	postSignedAction(t, server.URL+"/trust/labels", labelRaw, http.StatusCreated, &label)
	appealInput := consensus.TrustAppealPayload{LabelID: label.ID, Subject: label.Subject, Appellant: signer, Claimant: signer, Reason: "false positive", Evidence: []string{"owner proof"}}
	appealRaw := signedPay(t, key, consensus.ActionTrustAppealCreate, appealInput, 4)
	var appeal consensus.BFTTrustAppeal
	postSignedAction(t, server.URL+"/trust/appeals", appealRaw, http.StatusCreated, &appeal)
	resolve := consensus.TrustAppealDecisionPayload{AppealID: appeal.ID, Reviewer: signer, Decision: "LABEL_REMOVED", ResolutionReason: "verified false positive"}
	resolveRaw := signedPay(t, key, consensus.ActionTrustAppealResolve, resolve, 5)
	postSignedAction(t, server.URL+"/trust/appeals/"+appeal.ID+"/resolve", resolveRaw, http.StatusOK, &appeal)
	if appeal.Status != "LABEL_REMOVED" || appeal.ReviewerSigner != signer {
		t.Fatalf("unexpected appeal: %+v", appeal)
	}
	evidenceRaw := signedPay(t, key, consensus.ActionTrustEvidenceCreate, consensus.TrustEvidencePayload{Requester: signer, Subject: signer}, 6)
	var evidence consensus.BFTTrustEvidence
	postSignedAction(t, server.URL+"/trust/evidence", evidenceRaw, http.StatusCreated, &evidence)
	trackingRaw := signedPay(t, key, consensus.ActionTrustTrackingCreate, consensus.TrustTrackingPayload{Requester: signer, Subject: signer, Purpose: "single transfer screening", QueryType: "trace", Scope: "one transfer", Evidence: []string{"case:gateway"}, MinimumNecessary: true, ConfidenceBps: 7600}, 7)
	var tracking consensus.BFTTrackingReview
	postSignedAction(t, server.URL+"/trust/tracking-reviews", trackingRaw, http.StatusCreated, &tracking)
	if tracking.Status != "logged" || tracking.AppealPath != "/trust/appeals" {
		t.Fatalf("unexpected tracking review: %+v", tracking)
	}
	var trace chain.TrustTrace
	getJSON(t, server.URL+"/trust/trace/"+signer, &trace)
	if trace.Address != signer || len(trace.Lots) == 0 {
		t.Fatalf("unexpected Trust trace: %+v", trace)
	}
	resp, err := http.Get(server.URL + "/trust/evidence/" + evidence.ID + ".pdf")
	if err != nil {
		t.Fatal(err)
	}
	pdf, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "application/pdf" || len(pdf) < 5 || string(pdf[:4]) != "%PDF" {
		t.Fatalf("unexpected BFT evidence PDF: status=%d size=%d", resp.StatusCode, len(pdf))
	}

	var lookup consensus.BFTGovernanceRequest
	getJSON(t, server.URL+"/governance/requests/"+request.ID, &lookup)
	if lookup.ID != request.ID || lookup.Status != "reviewed" {
		t.Fatalf("unexpected request lookup: %+v", lookup)
	}
	var report chain.TransparencyReport
	getJSON(t, server.URL+"/governance/transparency", &report)
	if report.EntryCount != 7 || report.AppealCount != 1 || report.ReviewCount < 3 || report.TruthfulStatus != "cometbft-abci-backed-transparency" {
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
	wrongRaw := signedPay(t, key, consensus.ActionGovernanceReject, wrong, 8)
	var ignored map[string]any
	postSignedAction(t, server.URL+"/governance/requests/000000000000000000000000/reject", wrongRaw, http.StatusBadRequest, &ignored)
}
