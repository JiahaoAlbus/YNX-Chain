package stablecoinissuer

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const testAPIKey = "stablecoin-control-key-for-tests"

type testControl struct {
	service *Service
	cfg     Config
	state   string
}

func newTestControl(t *testing.T) *testControl {
	t.Helper()
	state := filepath.Join(t.TempDir(), "stablecoin", "state.json")
	cfg := Config{StatePath: state, APIKey: testAPIKey, Now: func() time.Time { return time.Date(2026, 7, 14, 5, 6, 7, 0, time.UTC) }}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return &testControl{service: service, cfg: cfg, state: state}
}

func evidence(letter string) string { return strings.Repeat(letter, 64) }

func validIssuer(key string) SubmitIssuerRequest {
	return SubmitIssuerRequest{IdempotencyKey: key, LegalName: "Example Issuer Limited", Jurisdiction: "sgp", RegistryReference: "registry-2026-001", ContactDomain: "issuer.test", EvidenceHashes: []string{evidence("a"), evidence("b")}}
}

func review(key, decision string) ReviewRequest {
	return ReviewRequest{IdempotencyKey: key, Decision: decision, Reviewer: "governance-reviewer-01", GovernanceRequestID: "gov_stablecoin_review_001", DecisionEvidenceHash: evidence("c"), Reason: "evidence reviewed under the stablecoin issuer policy"}
}

func validAsset(key, issuerID string) SubmitAssetRequest {
	return SubmitAssetRequest{IdempotencyKey: key, IssuerID: issuerID, Symbol: "XUSD", Name: "Example Test Dollar", AssetClass: "fiat-backed-stablecoin", Canonicality: "canonical", OriginChain: "external-testnet", ContractReference: "0x1111111111111111111111111111111111111111", Decimals: 6, SupplyCeiling: "1000", ReportedSupply: "100", MintPolicy: "issuer request plus governance evidence required", BurnPolicy: "issuer redemption evidence and supply check required", LegalReviewStatus: "pending_external_review", EvidenceHashes: []string{evidence("d")}}
}

func validIntent(key, issuerID, operation, amount string) CreateIntentRequest {
	return CreateIntentRequest{IdempotencyKey: key, IssuerID: issuerID, Operation: operation, Amount: amount, Account: "0x2222222222222222222222222222222222222222", ExternalReference: "issuer-case-2026-001", EvidenceHash: evidence("e")}
}

func approveIssuerAndAsset(t *testing.T, control *testControl) (Issuer, Asset) {
	t.Helper()
	issuerResult, err := control.service.SubmitIssuer(validIssuer("issuer-submit-001"))
	if err != nil {
		t.Fatal(err)
	}
	approvedIssuer, err := control.service.ReviewIssuer(issuerResult.Record.ID, review("issuer-review-001", "approve"))
	if err != nil {
		t.Fatal(err)
	}
	assetResult, err := control.service.SubmitAsset(validAsset("asset-submit-001", approvedIssuer.Record.ID))
	if err != nil {
		t.Fatal(err)
	}
	approvedAsset, err := control.service.ReviewAsset(assetResult.Record.ID, review("asset-review-001", "approve"))
	if err != nil {
		t.Fatal(err)
	}
	return approvedIssuer.Record, approvedAsset.Record
}

func TestIssuerAssetIntentLifecyclePersistenceAndRevocation(t *testing.T) {
	control := newTestControl(t)
	issuerResult, err := control.service.SubmitIssuer(validIssuer("issuer-submit-001"))
	if err != nil || issuerResult.Record.Status != "pending_review" || issuerResult.Record.SupportStatus != "candidate_not_supported" {
		t.Fatalf("issuer submit failed: %+v %v", issuerResult, err)
	}
	issuerReplay, err := control.service.SubmitIssuer(validIssuer("issuer-submit-001"))
	if err != nil || !issuerReplay.Replayed || issuerReplay.Record.ID != issuerResult.Record.ID {
		t.Fatalf("issuer replay failed: %+v %v", issuerReplay, err)
	}
	changedIssuer := validIssuer("issuer-submit-001")
	changedIssuer.LegalName = "Changed Issuer Limited"
	if _, err := control.service.SubmitIssuer(changedIssuer); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed issuer idempotency expected conflict, got %v", err)
	}
	duplicateIssuer := validIssuer("issuer-submit-002")
	if _, err := control.service.SubmitIssuer(duplicateIssuer); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate registry expected conflict, got %v", err)
	}
	if _, err := control.service.SubmitAsset(validAsset("asset-before-approval-001", issuerResult.Record.ID)); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("unapproved issuer expected rejection, got %v", err)
	}
	approvedIssuer, err := control.service.ReviewIssuer(issuerResult.Record.ID, review("issuer-review-001", "approve"))
	if err != nil || approvedIssuer.Record.Status != "approved" || approvedIssuer.Record.Decision == nil {
		t.Fatalf("issuer approval failed: %+v %v", approvedIssuer, err)
	}
	issuerReviewReplay, err := control.service.ReviewIssuer(issuerResult.Record.ID, review("issuer-review-001", "approve"))
	if err != nil || !issuerReviewReplay.Replayed {
		t.Fatalf("issuer review replay failed: %+v %v", issuerReviewReplay, err)
	}
	changedReview := review("issuer-review-001", "reject")
	if _, err := control.service.ReviewIssuer(issuerResult.Record.ID, changedReview); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed review expected conflict, got %v", err)
	}

	assetResult, err := control.service.SubmitAsset(validAsset("asset-submit-001", issuerResult.Record.ID))
	if err != nil || assetResult.Record.Status != "pending_review" || assetResult.Record.ExecutionEnabled || assetResult.Record.NativeYNXT {
		t.Fatalf("asset submit failed: %+v %v", assetResult, err)
	}
	assetReplay, err := control.service.SubmitAsset(validAsset("asset-submit-001", issuerResult.Record.ID))
	if err != nil || !assetReplay.Replayed {
		t.Fatalf("asset replay failed: %+v %v", assetReplay, err)
	}
	approvedAsset, err := control.service.ReviewAsset(assetResult.Record.ID, review("asset-review-001", "approve"))
	if err != nil || approvedAsset.Record.Status != "approved" || approvedAsset.Record.ExecutionEnabled {
		t.Fatalf("asset approval failed: %+v %v", approvedAsset, err)
	}

	mintResult, err := control.service.CreateIntent(assetResult.Record.ID, validIntent("mint-intent-001", issuerResult.Record.ID, "mint", "400"))
	if err != nil || mintResult.Record.Status != "recorded_not_executed" || mintResult.Record.ExecutionEnabled {
		t.Fatalf("mint intent failed: %+v %v", mintResult, err)
	}
	mintReplay, err := control.service.CreateIntent(assetResult.Record.ID, validIntent("mint-intent-001", issuerResult.Record.ID, "mint", "400"))
	if err != nil || !mintReplay.Replayed || mintReplay.Record.ID != mintResult.Record.ID {
		t.Fatalf("mint replay failed: %+v %v", mintReplay, err)
	}
	changedMint := validIntent("mint-intent-001", issuerResult.Record.ID, "mint", "401")
	if _, err := control.service.CreateIntent(assetResult.Record.ID, changedMint); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed mint expected conflict, got %v", err)
	}
	if _, err := control.service.CreateIntent(assetResult.Record.ID, validIntent("mint-intent-002", issuerResult.Record.ID, "mint", "501")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("mint above remaining ceiling expected rejection, got %v", err)
	}
	burnResult, err := control.service.CreateIntent(assetResult.Record.ID, validIntent("burn-intent-001", issuerResult.Record.ID, "burn", "50"))
	if err != nil || burnResult.Record.Operation != "burn" {
		t.Fatalf("burn intent failed: %+v %v", burnResult, err)
	}
	if _, err := control.service.CreateIntent(assetResult.Record.ID, validIntent("burn-intent-002", issuerResult.Record.ID, "burn", "51")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("burn above reported supply expected rejection, got %v", err)
	}
	if _, err := control.service.CreateIntent(assetResult.Record.ID, validIntent("wrong-issuer-001", "iss_not_the_owner", "mint", "1")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong issuer expected rejection, got %v", err)
	}

	restarted, err := New(control.cfg)
	if err != nil {
		t.Fatal(err)
	}
	persistedAsset, err := restarted.GetAsset(assetResult.Record.ID)
	if err != nil || persistedAsset.ReservedMintIntentAmount != "400" || persistedAsset.ReservedBurnIntentAmount != "50" || persistedAsset.ExecutionEnabled {
		t.Fatalf("restart lost bounded intent reservations: %+v %v", persistedAsset, err)
	}
	if len(restarted.Audit(0, 100)) != 6 {
		t.Fatalf("unexpected audit count: %d", len(restarted.Audit(0, 100)))
	}
	report := restarted.Transparency()
	if report.IssuerApplications != 1 || report.IssuerApprovals != 1 || report.AssetApplications != 1 || report.AssetApprovals != 1 || report.MintIntents != 1 || report.BurnIntents != 1 || report.ExecutedMintBurnActions != 0 || report.NativeProtocolActions != 0 || report.ExternalExecutionEnabled || report.IssuerSupportEstablished {
		t.Fatalf("unexpected stablecoin transparency report: %+v", report)
	}
	revoked, err := restarted.RevokeAsset(assetResult.Record.ID, RevokeRequest{IdempotencyKey: "asset-revoke-001", Reviewer: "governance-reviewer-02", GovernanceRequestID: "gov_stablecoin_revoke_001", DecisionEvidenceHash: evidence("f"), Reason: "asset authorization revoked after governance review"})
	if err != nil || revoked.Record.Status != "revoked" || revoked.Record.Revocation == nil {
		t.Fatalf("asset revoke failed: %+v %v", revoked, err)
	}
	if _, err := restarted.CreateIntent(assetResult.Record.ID, validIntent("after-revoke-001", issuerResult.Record.ID, "mint", "1")); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("revoked asset expected rejection, got %v", err)
	}
	issuerRevoked, err := restarted.RevokeIssuer(issuerResult.Record.ID, RevokeRequest{IdempotencyKey: "issuer-revoke-001", Reviewer: "governance-reviewer-03", GovernanceRequestID: "gov_stablecoin_issuer_revoke_001", DecisionEvidenceHash: evidence("a"), Reason: "issuer authorization revoked after governance review"})
	if err != nil || issuerRevoked.Record.Status != "revoked" || issuerRevoked.Record.Revocation == nil {
		t.Fatalf("issuer revoke failed: %+v %v", issuerRevoked, err)
	}
	issuerRevokeReplay, err := restarted.RevokeIssuer(issuerResult.Record.ID, RevokeRequest{IdempotencyKey: "issuer-revoke-001", Reviewer: "governance-reviewer-03", GovernanceRequestID: "gov_stablecoin_issuer_revoke_001", DecisionEvidenceHash: evidence("a"), Reason: "issuer authorization revoked after governance review"})
	if err != nil || !issuerRevokeReplay.Replayed {
		t.Fatalf("issuer revoke replay failed: %+v %v", issuerRevokeReplay, err)
	}
	secondAsset := validAsset("asset-after-issuer-revoke-001", issuerResult.Record.ID)
	secondAsset.ContractReference = "0x3333333333333333333333333333333333333333"
	if _, err := restarted.SubmitAsset(secondAsset); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("revoked issuer expected asset rejection, got %v", err)
	}
	if report := restarted.Transparency(); report.IssuerApprovals != 1 || report.IssuerRevocations != 1 || report.AssetRevocations != 1 {
		t.Fatalf("unexpected revocation transparency: %+v", report)
	}
	if _, err := New(control.cfg); err != nil {
		t.Fatalf("restart after issuer revocation failed: %v", err)
	}
	if mode := fileMode(t, control.state); mode != 0o600 {
		t.Fatalf("stablecoin state mode = %o", mode)
	}
}

func TestNativeYNXTAndGovernanceBoundaries(t *testing.T) {
	control := newTestControl(t)
	issuerResult, err := control.service.SubmitIssuer(validIssuer("issuer-submit-001"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := control.service.ReviewIssuer(issuerResult.Record.ID, ReviewRequest{IdempotencyKey: "bad-review-001", Decision: "approve", Reviewer: "reviewer", GovernanceRequestID: "gov_review_001", Reason: "missing decision evidence"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing governance evidence expected invalid, got %v", err)
	}
	if _, err := control.service.ReviewIssuer(issuerResult.Record.ID, review("issuer-review-001", "approve")); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*SubmitAssetRequest){
		"symbol":   func(r *SubmitAssetRequest) { r.Symbol = "YNXT" },
		"name":     func(r *SubmitAssetRequest) { r.Name = "Native YNXT" },
		"wrapped":  func(r *SubmitAssetRequest) { r.Name = "Wrapped YNXT" },
		"class":    func(r *SubmitAssetRequest) { r.AssetClass = "gas-asset" },
		"contract": func(r *SubmitAssetRequest) { r.ContractReference = "native" },
		"nativeUri": func(r *SubmitAssetRequest) {
			r.ContractReference = "native://ynxt"
		},
		"treasury": func(r *SubmitAssetRequest) { r.AssetClass = "protocol-treasury" },
		"stake":    func(r *SubmitAssetRequest) { r.AssetClass = "validator-stake" },
		"resource": func(r *SubmitAssetRequest) { r.AssetClass = "resource-balance" },
	} {
		t.Run(name, func(t *testing.T) {
			request := validAsset("native-reject-"+name+"-001", issuerResult.Record.ID)
			mutate(&request)
			if _, err := control.service.SubmitAsset(request); !errors.Is(err, ErrInvalid) {
				t.Fatalf("native/protocol asset expected invalid, got %v", err)
			}
		})
	}
	badLegalStatus := validAsset("bad-legal-status-001", issuerResult.Record.ID)
	badLegalStatus.LegalReviewStatus = "legally_approved"
	if _, err := control.service.SubmitAsset(badLegalStatus); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsupported legal status expected invalid, got %v", err)
	}
	overflow := validAsset("overflow-asset-001", issuerResult.Record.ID)
	overflow.SupplyCeiling = "18446744073709551616"
	if _, err := control.service.SubmitAsset(overflow); !errors.Is(err, ErrInvalid) {
		t.Fatalf("supply overflow expected invalid, got %v", err)
	}
	overSupply := validAsset("over-supply-001", issuerResult.Record.ID)
	overSupply.ReportedSupply = "1001"
	if _, err := control.service.SubmitAsset(overSupply); !errors.Is(err, ErrInvalid) {
		t.Fatalf("reported supply above ceiling expected invalid, got %v", err)
	}
}

func TestConcurrentIntentReplayReservesOnce(t *testing.T) {
	control := newTestControl(t)
	issuer, asset := approveIssuerAndAsset(t, control)
	request := validIntent("concurrent-mint-001", issuer.ID, "mint", "100")
	var created atomic.Int32
	var replayed atomic.Int32
	var failed atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := control.service.CreateIntent(asset.ID, request)
			if err != nil {
				failed.Add(1)
			} else if result.Replayed {
				replayed.Add(1)
			} else {
				created.Add(1)
			}
		}()
	}
	wg.Wait()
	if created.Load() != 1 || replayed.Load() != 23 || failed.Load() != 0 {
		t.Fatalf("unexpected concurrent result created=%d replayed=%d failed=%d", created.Load(), replayed.Load(), failed.Load())
	}
	stored, err := control.service.GetAsset(asset.ID)
	if err != nil || stored.ReservedMintIntentAmount != "100" {
		t.Fatalf("concurrent replay reserved more than once: %+v %v", stored, err)
	}
}

func TestStateTamperAndSemanticCorruptionRejected(t *testing.T) {
	control := newTestControl(t)
	_, asset := approveIssuerAndAsset(t, control)
	raw, err := os.ReadFile(control.state)
	if err != nil {
		t.Fatal(err)
	}
	tampered := strings.Replace(string(raw), `"reportedSupply": "100"`, `"reportedSupply": "101"`, 1)
	if tampered == string(raw) {
		t.Fatal("tamper fixture did not modify state")
	}
	if err := os.WriteFile(control.state, []byte(tampered), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(control.cfg); err == nil || !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("tampered state expected integrity rejection, got %v", err)
	}

	if err := os.WriteFile(control.state, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := loadState(control.state)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := state.Assets[asset.ID]
	corrupt.NativeYNXT = true
	state.Assets[asset.ID] = corrupt
	if err := saveState(control.state, &state); err != nil {
		t.Fatal(err)
	}
	if _, err := New(control.cfg); err == nil || !strings.Contains(err.Error(), "violates safety policy") {
		t.Fatalf("semantic corruption with recomputed digest expected rejection, got %v", err)
	}
}

func TestHTTPAuthStrictJSONAndTruthfulStatus(t *testing.T) {
	control := newTestControl(t)
	server := httptest.NewServer(NewServerWithBuild(control.service, buildinfo.Info{Commit: "abc123def456", Release: "ynx-chain-abc123def456", BuildTime: "2026-07-14T00:00:00Z"}).Handler())
	defer server.Close()
	var health Health
	doJSON(t, http.MethodGet, server.URL+"/health", "", nil, http.StatusOK, &health)
	if !health.OK || health.Service != "ynx-stablecoind" || health.IssuerSupportEstablished || health.ExternalExecutionEnabled || health.NativeYNXTIssuerActionsAllowed || health.TruthfulStatus != "local-control-plane-only-no-issuer-support-no-execution" {
		t.Fatalf("health overclaims stablecoin status: %+v", health)
	}
	doJSON(t, http.MethodGet, server.URL+"/stablecoin/issuers", "", nil, http.StatusUnauthorized, nil)
	unsafe := map[string]any{"idempotencyKey": "unsafe-native-001", "issuerId": "iss_fake", "operation": "freeze", "amount": "1", "account": "ynx_native_treasury", "externalReference": "case-001", "evidenceHash": evidence("a"), "action": "seize_native_ynxt"}
	doJSON(t, http.MethodPost, server.URL+"/stablecoin/assets/sca_fake/intents", testAPIKey, unsafe, http.StatusBadRequest, nil)
	doJSON(t, http.MethodPost, server.URL+"/stablecoin/native-ynxt/freeze", testAPIKey, map[string]string{"asset": "YNXT"}, http.StatusNotFound, nil)
	var issuer MutationResult[Issuer]
	doJSON(t, http.MethodPost, server.URL+"/stablecoin/issuers", testAPIKey, validIssuer("http-issuer-001"), http.StatusCreated, &issuer)
	if issuer.Record.ID == "" || issuer.Record.SupportStatus != "candidate_not_supported" {
		t.Fatalf("unexpected HTTP issuer: %+v", issuer)
	}
	var list struct {
		Issuers []Issuer `json:"issuers"`
		Count   int      `json:"count"`
	}
	doJSON(t, http.MethodGet, server.URL+"/stablecoin/issuers?limit=1", testAPIKey, nil, http.StatusOK, &list)
	if list.Count != 1 || len(list.Issuers) != 1 {
		t.Fatalf("unexpected HTTP list: %+v", list)
	}
	var approved MutationResult[Issuer]
	doJSON(t, http.MethodPost, server.URL+"/stablecoin/issuers/"+issuer.Record.ID+"/review", testAPIKey, review("http-issuer-review-001", "approve"), http.StatusOK, &approved)
	if approved.Record.Status != "approved" {
		t.Fatalf("unexpected HTTP issuer approval: %+v", approved)
	}
	var revoked MutationResult[Issuer]
	doJSON(t, http.MethodPost, server.URL+"/stablecoin/issuers/"+issuer.Record.ID+"/revoke", testAPIKey, RevokeRequest{IdempotencyKey: "http-issuer-revoke-001", Reviewer: "governance-reviewer-http", GovernanceRequestID: "gov_stablecoin_http_revoke_001", DecisionEvidenceHash: evidence("f"), Reason: "issuer authorization revoked through HTTP review"}, http.StatusOK, &revoked)
	if revoked.Record.Status != "revoked" || revoked.Record.Revocation == nil {
		t.Fatalf("unexpected HTTP issuer revocation: %+v", revoked)
	}
	doJSON(t, http.MethodGet, server.URL+"/stablecoin/issuers?limit=101", testAPIKey, nil, http.StatusBadRequest, nil)
	response, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	metrics, _ := io.ReadAll(response.Body)
	if !strings.Contains(string(metrics), "ynx_stablecoin_external_execution_enabled") || !strings.Contains(string(metrics), "ynx_stablecoin_native_ynxt_issuer_actions_allowed") || !strings.Contains(string(metrics), " 0\n") {
		t.Fatalf("truthful metrics missing: %s", metrics)
	}
}

func TestConfigRejectsWeakAPIKey(t *testing.T) {
	if err := ValidateConfig(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), APIKey: "short"}); err == nil {
		t.Fatal("weak API key unexpectedly passed")
	}
}

func doJSON(t *testing.T, method, url, key string, body any, expected int, target any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = strings.NewReader(string(raw))
	}
	request, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		request.Header.Set("X-YNX-Stablecoin-Key", key)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != expected {
		raw, _ := io.ReadAll(response.Body)
		t.Fatalf("%s %s status=%d want=%d body=%s", method, url, response.StatusCode, expected, raw)
	}
	if target != nil {
		if err := json.NewDecoder(response.Body).Decode(target); err != nil {
			t.Fatal(err)
		}
	}
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}
