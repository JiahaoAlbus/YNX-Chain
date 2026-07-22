package bridgegateway

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const testAPIKey = "bridge-api-key-for-tests"

type testBridge struct {
	service *Service
	cfg     Config
	private map[string]ed25519.PrivateKey
	state   string
	now     time.Time
	clock   *time.Time
}

func newTestBridge(t *testing.T) *testBridge {
	t.Helper()
	private := map[string]ed25519.PrivateKey{}
	public := map[string]ed25519.PublicKey{}
	for _, name := range []string{"relayer-a", "relayer-b", "relayer-c"} {
		pub, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		private[name], public[name] = key, pub
	}
	now := time.Date(2026, 7, 14, 1, 2, 3, 0, time.UTC)
	state := filepath.Join(t.TempDir(), "bridge", "state.json")
	cfg := Config{
		StatePath: state, APIKey: testAPIKey, Relayers: public, Threshold: 2,
		Policies: []RoutePolicy{{
			Provider:       "local-test-provider",
			Classification: "external-bridge-adapter",
			SourceChain:    "ethereum-sepolia", DestinationChain: "ynx_6423-1", SourceAsset: "sepolia-usdc", DestinationAsset: "ynx-usdc",
			MinConfirmations: 12, MaxAmount: "1000", MaxOutstanding: "1000", DailyLimit: "2000", UserOutstandingLimit: "1000", LargeTransferThreshold: "500", LargeTransferDelaySeconds: 3600, AssetBoundary: "canonical-to-represented", ExternalSubmission: false,
		}},
		Now: func() time.Time { return now },
	}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return &testBridge{service: service, cfg: cfg, private: private, state: state, now: now, clock: &now}
}

func validCreate(key string) CreateTransferRequest {
	return CreateTransferRequest{
		IdempotencyKey: key, SourceChain: "ethereum-sepolia", SourceTxHash: "0x" + strings.Repeat("a", 64), SourceEventIndex: 7,
		SourceAsset: "sepolia-usdc", DestinationChain: "ynx_6423-1", DestinationAsset: "ynx-usdc", Amount: "100",
		Sender: "0x" + strings.Repeat("b", 40), Recipient: "ynx1recipient000000000000000000000000000001",
	}
}

func (b *testBridge) signedAttestation(t *testing.T, transfer Transfer, relayer, block string, confirmations uint64) AttestationRequest {
	t.Helper()
	payload := AttestationPayload(transfer, relayer, block, confirmations)
	return AttestationRequest{Relayer: relayer, SourceBlockHash: block, Confirmations: confirmations, Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(b.private[relayer], payload))}
}

func TestBridgeLifecyclePersistenceAndIdempotency(t *testing.T) {
	b := newTestBridge(t)
	created, err := b.service.CreateTransfer(validCreate("create-intent-001"))
	if err != nil {
		t.Fatal(err)
	}
	if created.Replayed || created.Transfer.Status != "pending_attestations" || created.Transfer.ExternalSubmissionEnabled {
		t.Fatalf("unexpected created transfer: %+v", created)
	}
	replay, err := b.service.CreateTransfer(validCreate("create-intent-001"))
	if err != nil || !replay.Replayed || replay.Transfer.ID != created.Transfer.ID {
		t.Fatalf("exact create replay failed: %+v %v", replay, err)
	}
	changed := validCreate("create-intent-001")
	changed.Amount = "101"
	if _, err := b.service.CreateTransfer(changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed idempotency input expected conflict, got %v", err)
	}
	duplicateEvent := validCreate("create-intent-002")
	if _, err := b.service.CreateTransfer(duplicateEvent); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate source event expected conflict, got %v", err)
	}
	if _, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "finalize-intent-001"}); !errors.Is(err, ErrInsufficientQuorum) {
		t.Fatalf("early finalize expected quorum error, got %v", err)
	}
	if _, err := b.service.AddAttestation(created.Transfer.ID, AttestationRequest{Relayer: "unknown-relayer", SourceBlockHash: "0x" + strings.Repeat("c", 64), Confirmations: 12}); !errors.Is(err, ErrUnauthorizedRelayer) {
		t.Fatalf("unknown relayer expected rejection, got %v", err)
	}
	low := b.signedAttestation(t, created.Transfer, "relayer-a", "0x"+strings.Repeat("c", 64), 11)
	if _, err := b.service.AddAttestation(created.Transfer.ID, low); !errors.Is(err, ErrInsufficientQuorum) {
		t.Fatalf("low finality expected rejection, got %v", err)
	}
	bad := b.signedAttestation(t, created.Transfer, "relayer-a", "0x"+strings.Repeat("c", 64), 12)
	bad.Signature = base64.StdEncoding.EncodeToString(make([]byte, ed25519.SignatureSize))
	if _, err := b.service.AddAttestation(created.Transfer.ID, bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad signature expected rejection, got %v", err)
	}
	firstRequest := b.signedAttestation(t, created.Transfer, "relayer-a", "0x"+strings.Repeat("c", 64), 12)
	first, err := b.service.AddAttestation(created.Transfer.ID, firstRequest)
	if err != nil || len(first.Transfer.Attestations) != 1 || first.Transfer.Status != "pending_attestations" {
		t.Fatalf("first attestation failed: %+v %v", first, err)
	}
	firstReplay, err := b.service.AddAttestation(created.Transfer.ID, firstRequest)
	if err != nil || !firstReplay.Replayed {
		t.Fatalf("attestation replay failed: %+v %v", firstReplay, err)
	}
	changedVote := b.signedAttestation(t, created.Transfer, "relayer-a", "0x"+strings.Repeat("c", 64), 13)
	if _, err := b.service.AddAttestation(created.Transfer.ID, changedVote); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed relayer vote expected conflict, got %v", err)
	}
	differentBlock := b.signedAttestation(t, created.Transfer, "relayer-b", "0x"+strings.Repeat("d", 64), 12)
	if _, err := b.service.AddAttestation(created.Transfer.ID, differentBlock); !errors.Is(err, ErrConflict) {
		t.Fatalf("different source block expected conflict, got %v", err)
	}
	secondRequest := b.signedAttestation(t, created.Transfer, "relayer-b", "0x"+strings.Repeat("c", 64), 14)
	ready, err := b.service.AddAttestation(created.Transfer.ID, secondRequest)
	if err != nil || ready.Transfer.Status != "ready_for_local_finalization" || len(ready.Transfer.Attestations) != 2 {
		t.Fatalf("quorum attestation failed: %+v %v", ready, err)
	}
	finalized, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "finalize-intent-001"})
	if err != nil || finalized.Transfer.Status != "finalized_local" || finalized.Transfer.FinalizationID == "" || finalized.Transfer.ExternalSubmissionEnabled {
		t.Fatalf("local finalization failed: %+v %v", finalized, err)
	}
	finalReplay, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "finalize-intent-001"})
	if err != nil || !finalReplay.Replayed || finalReplay.Transfer.FinalizationID != finalized.Transfer.FinalizationID {
		t.Fatalf("finalization replay failed: %+v %v", finalReplay, err)
	}
	if _, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "finalize-intent-002"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("double finalization expected conflict, got %v", err)
	}
	restarted, err := New(b.cfg)
	if err != nil {
		t.Fatal(err)
	}
	afterRestart, err := restarted.Get(created.Transfer.ID)
	if err != nil || afterRestart.Status != "finalized_local" || len(afterRestart.Attestations) != 2 {
		t.Fatalf("restart lost bridge state: %+v %v", afterRestart, err)
	}
	audit := restarted.Audit(0, 100)
	if len(audit) != 4 || audit[0].Action != "transfer_created" || audit[3].Action != "transfer_finalized_local" {
		t.Fatalf("unexpected audit chain: %+v", audit)
	}
	if mode := fileMode(t, b.state); mode != 0o600 {
		t.Fatalf("bridge state mode = %o", mode)
	}
}

func TestBridgePolicyOverflowAndTamperRejection(t *testing.T) {
	b := newTestBridge(t)
	for name, request := range map[string]CreateTransferRequest{
		"overflow": func() CreateTransferRequest {
			r := validCreate("overflow-intent-001")
			r.Amount = "18446744073709551616"
			return r
		}(),
		"above policy": func() CreateTransferRequest { r := validCreate("above-policy-001"); r.Amount = "1001"; return r }(),
		"unsupported route": func() CreateTransferRequest {
			r := validCreate("unsupported-route-001")
			r.DestinationAsset = "unsupported"
			return r
		}(),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := b.service.CreateTransfer(request); !errors.Is(err, ErrInvalid) {
				t.Fatalf("expected invalid request, got %v", err)
			}
		})
	}
	created, err := b.service.CreateTransfer(validCreate("tamper-intent-001"))
	if err != nil || created.Transfer.ID == "" {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(b.state)
	if err != nil {
		t.Fatal(err)
	}
	tampered := strings.Replace(string(raw), `"amount": "100"`, `"amount": "101"`, 1)
	if tampered == string(raw) {
		t.Fatal("tamper fixture did not modify state")
	}
	if err := os.WriteFile(b.state, []byte(tampered), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(b.cfg); err == nil || !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("tampered state expected integrity rejection, got %v", err)
	}
}

func TestBridgeHTTPBoundariesAndTruthfulHealth(t *testing.T) {
	b := newTestBridge(t)
	server := httptest.NewServer(NewServerWithBuild(b.service, buildinfo.Info{Commit: "abc123def456", Release: "ynx-chain-abc123def456", BuildTime: "2026-07-14T00:00:00Z"}).Handler())
	defer server.Close()
	var health Health
	doJSON(t, http.MethodGet, server.URL+"/health", "", nil, http.StatusOK, &health)
	if !health.OK || health.LiveBridge || health.ExternalSubmissionEnabled || health.TruthfulStatus != "local-coordinator-only-no-external-submission" {
		t.Fatalf("health overclaims bridge status: %+v", health)
	}
	doJSON(t, http.MethodGet, server.URL+"/bridge/transfers", "", nil, http.StatusUnauthorized, nil)
	doJSON(t, http.MethodPost, server.URL+"/bridge/transfers", testAPIKey, map[string]any{
		"idempotencyKey": "freeze-native-001", "sourceChain": "ethereum-sepolia", "sourceTxHash": "0x" + strings.Repeat("e", 64), "sourceEventIndex": 1,
		"sourceAsset": "sepolia-usdc", "destinationChain": "ynx_6423-1", "destinationAsset": "ynx-usdc", "amount": "1",
		"sender": "0x" + strings.Repeat("f", 40), "recipient": "ynx1recipient000000000000000000000000000001", "action": "freeze_native_ynxt",
	}, http.StatusBadRequest, nil)
	var created MutationResult
	doJSON(t, http.MethodPost, server.URL+"/bridge/transfers", testAPIKey, validCreate("http-create-001"), http.StatusCreated, &created)
	if created.Transfer.ID == "" || created.Transfer.ExternalSubmissionEnabled {
		t.Fatalf("unexpected HTTP create result: %+v", created)
	}
	var list struct {
		Transfers []Transfer `json:"transfers"`
		Count     int        `json:"count"`
	}
	doJSON(t, http.MethodGet, server.URL+"/bridge/transfers?limit=1", testAPIKey, nil, http.StatusOK, &list)
	if list.Count != 1 || len(list.Transfers) != 1 {
		t.Fatalf("unexpected HTTP list: %+v", list)
	}
	doJSON(t, http.MethodPost, server.URL+"/bridge/freeze", testAPIKey, map[string]string{"asset": "YNXT"}, http.StatusNotFound, nil)
	resp, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	metrics, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(metrics), "ynx_bridge_external_submission_enabled") || !strings.Contains(string(metrics), " 0\n") {
		t.Fatalf("truthful bridge metric missing: %s", metrics)
	}
}

func TestBridgeRequestErrorIDsAndRateLimit(t *testing.T) {
	b := newTestBridge(t)
	b.cfg.RateLimitMax = 2
	b.cfg.RateLimitWindow = time.Minute
	service, err := New(b.cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	for index := 0; index < 3; index++ {
		response, err := http.Get(server.URL + "/health")
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.Header.Get("X-Request-ID") == "" {
			t.Fatal("request id missing")
		}
		if index < 2 && response.StatusCode != http.StatusOK {
			t.Fatalf("early rate rejection: %d %s", response.StatusCode, body)
		}
		if index == 2 {
			if response.StatusCode != http.StatusTooManyRequests || response.Header.Get("X-Error-ID") == "" || !strings.Contains(string(body), `"requestId"`) || !strings.Contains(string(body), `"errorId"`) {
				t.Fatalf("bad rate-limit response: status=%d headers=%v body=%s", response.StatusCode, response.Header, body)
			}
		}
	}
	health := service.Health(buildinfo.Info{})
	if health.RateLimitDenied != 1 || health.RateLimit == "" {
		t.Fatalf("rate limit health mismatch: %+v", health)
	}
}

func TestBridgeTraceContextPropagation(t *testing.T) {
	b := newTestBridge(t)
	server := httptest.NewServer(NewServer(b.service).Handler())
	defer server.Close()
	const traceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	request, err := http.NewRequest(http.MethodGet, server.URL+"/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("traceparent", "00-"+traceID+"-00f067aa0ba902b7-01")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.Header.Get("X-Trace-ID") != traceID || !strings.HasPrefix(response.Header.Get("traceparent"), "00-"+traceID+"-") {
		t.Fatalf("trace context not propagated: trace=%q traceparent=%q", response.Header.Get("X-Trace-ID"), response.Header.Get("traceparent"))
	}
	invalid, err := http.NewRequest(http.MethodGet, server.URL+"/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	invalid.Header.Set("traceparent", "00-not-a-trace-00f067aa0ba902b7-01")
	response, err = http.DefaultClient.Do(invalid)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	generated := response.Header.Get("X-Trace-ID")
	if len(generated) != 32 || generated == traceID {
		t.Fatalf("invalid trace context was not replaced: %q", generated)
	}
}

func TestBridgeDataExportRetentionAndIdentityRedaction(t *testing.T) {
	b := newTestBridge(t)
	b.cfg.RetentionPeriod = 24 * time.Hour
	service, err := New(b.cfg)
	if err != nil {
		t.Fatal(err)
	}
	b.service = service
	created, err := b.service.CreateTransfer(validCreate("privacy-create-001"))
	if err != nil {
		t.Fatal(err)
	}
	exported, err := b.service.ExportAccount(created.Transfer.Sender)
	if err != nil || len(exported.Transfers) != 1 || exported.Source != "ynx-bridge-coordinator" || exported.Coverage != "coordinator-records-only-not-independent-chain-history" {
		t.Fatalf("unexpected account export: %+v %v", exported, err)
	}
	held, replayed, err := b.service.RequestDataDeletion(DataDeletionRequest{IdempotencyKey: "privacy-delete-request-001", Account: created.Transfer.Sender, Reason: "account-closure"})
	if err != nil || replayed || held.Status != "safety_hold" || held.OutstandingTransfers != 1 || held.EligibleAt != "" {
		t.Fatalf("active transfer deletion was not safety-held: %+v %v", held, err)
	}
	if _, _, err := b.service.ExecuteDataDeletion(held.ID, DataDeletionExecuteRequest{IdempotencyKey: "privacy-delete-execute-001"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("active transfer deletion execution should fail closed: %v", err)
	}
	block := "0x" + strings.Repeat("c", 64)
	for _, relayer := range []string{"relayer-a", "relayer-b"} {
		if _, err := b.service.AddAttestation(created.Transfer.ID, b.signedAttestation(t, created.Transfer, relayer, block, 12)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "privacy-finalize-001"}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.service.RecordOutcome(created.Transfer.ID, OutcomeRequest{IdempotencyKey: "privacy-release-001", Outcome: "destination_mint_release", EvidenceRef: "receipt:privacy-release", ReasonCode: "operator-observed"}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.service.RecordOutcome(created.Transfer.ID, OutcomeRequest{IdempotencyKey: "privacy-confirm-001", Outcome: "destination_confirmed", EvidenceRef: "receipt:privacy-confirmed", ReasonCode: "finalized-receipt"}); err != nil {
		t.Fatal(err)
	}
	pending, _, err := b.service.RequestDataDeletion(DataDeletionRequest{IdempotencyKey: "privacy-delete-request-002", Account: created.Transfer.Sender, Reason: "account-closure"})
	if err != nil || pending.Status != "pending_retention" || pending.OutstandingTransfers != 0 || pending.EligibleAt == "" {
		t.Fatalf("terminal transfer deletion request is invalid: %+v %v", pending, err)
	}
	if _, _, err := b.service.ExecuteDataDeletion(pending.ID, DataDeletionExecuteRequest{IdempotencyKey: "privacy-delete-execute-002"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("retention period should block early execution: %v", err)
	}
	*b.clock = b.clock.Add(25 * time.Hour)
	completed, replayed, err := b.service.ExecuteDataDeletion(pending.ID, DataDeletionExecuteRequest{IdempotencyKey: "privacy-delete-execute-003"})
	if err != nil || replayed || completed.Status != "completed" || completed.Account != "" || completed.CompletedAt == "" {
		t.Fatalf("eligible identity redaction failed: %+v %v", completed, err)
	}
	redacted, err := b.service.Get(created.Transfer.ID)
	if err != nil || !redacted.SenderRedacted || !strings.HasPrefix(redacted.Sender, "redacted:sha256:") || redacted.RecipientRedacted || redacted.SourceTxHash != created.Transfer.SourceTxHash || redacted.Amount != created.Transfer.Amount || redacted.Phase != "destination_confirmed" {
		t.Fatalf("redaction changed financial evidence or missed identity: %+v %v", redacted, err)
	}
	exported, err = b.service.ExportAccount(created.Transfer.Sender)
	if err != nil || len(exported.Transfers) != 0 || len(exported.DeletionRequests) != 2 {
		t.Fatalf("post-redaction export should retain request evidence only: %+v %v", exported, err)
	}
	restarted, err := New(b.cfg)
	if err != nil {
		t.Fatalf("redacted state did not restart: %v", err)
	}
	persisted, _ := restarted.Get(created.Transfer.ID)
	if !persisted.SenderRedacted || persisted.Sender != redacted.Sender {
		t.Fatalf("restart lost redaction state: %+v", persisted)
	}
}

func TestBridgeV2StateMigratesToDataLifecycleSchema(t *testing.T) {
	b := newTestBridge(t)
	state := cloneState(b.service.state)
	state.SchemaVersion = 2
	state.DataRequests = nil
	state.Integrity = ""
	digest, err := stateDigest(state)
	if err != nil {
		t.Fatal(err)
	}
	state.Integrity = digest
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(b.state, append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := New(b.cfg)
	if err != nil {
		t.Fatalf("valid v2 state migration failed: %v", err)
	}
	if migrated.state.SchemaVersion != 3 || migrated.state.DataRequests == nil || migrated.state.Integrity == "" {
		t.Fatalf("v2 state not migrated to v3: %+v", migrated.state)
	}
	state.Integrity = "sha256:" + strings.Repeat("0", 64)
	raw, _ = json.Marshal(state)
	if err := os.WriteFile(b.state, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(b.cfg); err == nil || !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("tampered v2 state expected integrity rejection, got %v", err)
	}
}

func TestBridgeConfigRejectsUnsafeTopology(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	base := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), APIKey: "key", Relayers: map[string]ed25519.PublicKey{"only-one": pub}, Threshold: 1, Policies: []RoutePolicy{{Provider: "test-provider", Classification: "external-bridge-adapter", SourceChain: "a-chain", DestinationChain: "b-chain", SourceAsset: "asset-a", DestinationAsset: "asset-b", MinConfirmations: 1, MaxAmount: "1", AssetBoundary: "canonical-to-represented"}}}
	if err := ValidateConfig(base); err == nil {
		t.Fatal("weak API key and single relayer topology unexpectedly passed")
	}
	base.APIKey = testAPIKey
	if err := ValidateConfig(base); err == nil {
		t.Fatal("single relayer topology unexpectedly passed")
	}
	pub2, _, _ := ed25519.GenerateKey(rand.Reader)
	base.Relayers["second"] = pub2
	base.Threshold = 2
	base.Policies[0].ExternalSubmission = true
	if err := ValidateConfig(base); err == nil {
		t.Fatal("external submission policy unexpectedly passed")
	}
	base.Policies[0].ExternalSubmission = false
	base.RetentionPeriod = 23 * time.Hour
	if err := ValidateConfig(base); err == nil {
		t.Fatal("sub-day retention policy unexpectedly passed")
	}
	base.RetentionPeriod = 24 * time.Hour
	if err := ValidateConfig(base); err != nil {
		t.Fatalf("minimum bounded retention policy rejected: %v", err)
	}
}

func TestBridgePauseExposureAndRecoveryLifecycle(t *testing.T) {
	b := newTestBridge(t)
	safety, replayed, err := b.service.SetPause(PauseRequest{IdempotencyKey: "pause-bridge-001", Paused: true, Reason: "incident-response"})
	if err != nil || replayed || !safety.Paused {
		t.Fatalf("pause failed: %+v replay=%v err=%v", safety, replayed, err)
	}
	if _, err := b.service.CreateTransfer(validCreate("paused-create-001")); !errors.Is(err, ErrConflict) {
		t.Fatalf("paused bridge accepted transfer: %v", err)
	}
	if _, _, err := b.service.SetPause(PauseRequest{IdempotencyKey: "pause-bridge-001", Paused: false, Reason: "incident-cleared"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed pause replay expected conflict: %v", err)
	}
	if _, _, err := b.service.SetPause(PauseRequest{IdempotencyKey: "resume-bridge-001", Paused: false, Reason: "incident-cleared"}); err != nil {
		t.Fatal(err)
	}

	request := validCreate("recovery-flow-001")
	request.Amount = "1000"
	created, err := b.service.CreateTransfer(request)
	if err != nil || created.Transfer.Phase != "source_submitted" {
		t.Fatalf("create phase: %+v %v", created, err)
	}
	blocked := validCreate("exposure-block-001")
	blocked.SourceTxHash = "0x" + strings.Repeat("d", 64)
	blocked.SourceEventIndex = 8
	if _, err := b.service.CreateTransfer(blocked); !errors.Is(err, ErrConflict) {
		t.Fatalf("outstanding exposure limit not enforced: %v", err)
	}

	block := "0x" + strings.Repeat("c", 64)
	first, err := b.service.AddAttestation(created.Transfer.ID, b.signedAttestation(t, created.Transfer, "relayer-a", block, 12))
	if err != nil || first.Transfer.Phase != "source_accepted" {
		t.Fatalf("source accepted phase: %+v %v", first, err)
	}
	second, err := b.service.AddAttestation(created.Transfer.ID, b.signedAttestation(t, created.Transfer, "relayer-b", block, 12))
	if err != nil || second.Transfer.Phase != "source_finalized" {
		t.Fatalf("source finalized phase: %+v %v", second, err)
	}
	*b.clock = b.now.Add(time.Hour)
	proof, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "proof-finalize-001"})
	if err != nil || proof.Transfer.Phase != "proof_attestation" {
		t.Fatalf("proof phase: %+v %v", proof, err)
	}
	failed, err := b.service.RecordOutcome(created.Transfer.ID, OutcomeRequest{IdempotencyKey: "outcome-failed-001", Outcome: "failed", EvidenceRef: "audit:provider-timeout-001", ReasonCode: "provider-timeout"})
	if err != nil || failed.Transfer.Phase != "failed" || failed.Transfer.PreviousPhase != "proof_attestation" {
		t.Fatalf("failed phase: %+v %v", failed, err)
	}
	retried, err := b.service.RecordOutcome(created.Transfer.ID, OutcomeRequest{IdempotencyKey: "outcome-retry-001", Outcome: "retry", EvidenceRef: "audit:operator-review-001", ReasonCode: "approved-retry"})
	if err != nil || retried.Transfer.Phase != "proof_attestation" {
		t.Fatalf("retry phase: %+v %v", retried, err)
	}
	release, err := b.service.RecordOutcome(created.Transfer.ID, OutcomeRequest{IdempotencyKey: "outcome-release-001", Outcome: "destination_mint_release", EvidenceRef: "tx:destination-001", ReasonCode: "operator-observed"})
	if err != nil || release.Transfer.Phase != "destination_mint_release" {
		t.Fatalf("release phase: %+v %v", release, err)
	}
	confirmed, err := b.service.RecordOutcome(created.Transfer.ID, OutcomeRequest{IdempotencyKey: "outcome-confirmed-001", Outcome: "destination_confirmed", EvidenceRef: "receipt:destination-001", ReasonCode: "finalized-receipt"})
	if err != nil || confirmed.Transfer.Phase != "destination_confirmed" {
		t.Fatalf("confirmed phase: %+v %v", confirmed, err)
	}

	if _, err := New(b.cfg); err != nil {
		t.Fatalf("restart rejected lifecycle state: %v", err)
	}
	if got := b.service.Health(buildinfo.Info{}); got.Safety.Paused {
		t.Fatalf("health retained cleared pause: %+v", got)
	}
}

func TestBridgeV1StateMigratesOnlyAfterLegacyIntegrityVerification(t *testing.T) {
	b := newTestBridge(t)
	legacy := legacyStateV1{SchemaVersion: 1, Transfers: map[string]legacyTransferV1{}, SourceEvents: map[string]string{}, CreateIdempotency: map[string]idempotencyRecord{}, FinalizeIdempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{}}
	unsigned, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	legacy.Integrity = "sha256:" + hashBytes(unsigned)
	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(b.state, append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := New(b.cfg)
	if err != nil {
		t.Fatalf("valid v1 state migration failed: %v", err)
	}
	if migrated.state.SchemaVersion != SchemaVersion || migrated.state.MutationIdempotency == nil || migrated.state.Integrity == "" {
		t.Fatalf("v1 state not resealed as v3: %+v", migrated.state)
	}
	persisted, err := os.ReadFile(b.state)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(persisted), `"schemaVersion": 3`) {
		t.Fatalf("migrated state not persisted as v3: %s", persisted)
	}

	legacy.Integrity = "sha256:" + strings.Repeat("0", 64)
	raw, _ = json.Marshal(legacy)
	if err := os.WriteFile(b.state, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(b.cfg); err == nil || !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("tampered v1 state was accepted: %v", err)
	}
}

func TestBridgeReconciliationAndPublicTransparencyAreSourceQualified(t *testing.T) {
	b := newTestBridge(t)
	request := ReconciliationRequest{IdempotencyKey: "reconcile-route-001", SourceChain: "ethereum-sepolia", DestinationChain: "ynx_6423-1", SourceAsset: "sepolia-usdc", DestinationAsset: "ynx-usdc", Locked: "700", Burned: "100", Minted: "900", Released: "300", EvidenceRef: "report:operator-cycle-001", ObservedAt: b.now.Add(-time.Minute).Format(time.RFC3339Nano)}
	record, replayed, err := b.service.Reconcile(request)
	// The supplied observations intentionally expose a mismatch; they must not be labeled balanced.
	if err != nil || replayed || record.Balanced || record.OutstandingSupply != "800" || record.ReserveBacking != "400" || record.Difference != "400" {
		t.Fatalf("unexpected reconciliation: %+v replay=%v err=%v", record, replayed, err)
	}
	if record.Source != "operator-submitted-evidence" || record.Verification != "reference-recorded-not-independently-verified" {
		t.Fatalf("reconciliation source overclaim: %+v", record)
	}
	if _, replayed, err = b.service.Reconcile(request); err != nil || !replayed {
		t.Fatalf("reconciliation replay failed: replay=%v err=%v", replayed, err)
	}
	changed := request
	changed.Locked = "701"
	if _, _, err := b.service.Reconcile(changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed reconciliation replay accepted: %v", err)
	}
	invalid := request
	invalid.IdempotencyKey = "reconcile-route-002"
	invalid.Burned = "901"
	if _, _, err := b.service.Reconcile(invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("negative supply reconciliation accepted: %v", err)
	}

	transparency := b.service.Transparency()
	if transparency.LiveBridge || transparency.ExternalSubmissionEnabled || transparency.Source != "ynx-bridge-coordinator" || len(transparency.Routes) != 1 || transparency.Routes[0].LastReconciliation == nil {
		t.Fatalf("bad transparency: %+v", transparency)
	}
	server := httptest.NewServer(NewServer(b.service).Handler())
	defer server.Close()
	var public Transparency
	doJSON(t, http.MethodGet, server.URL+"/bridge/transparency", "", nil, http.StatusOK, &public)
	if public.Routes[0].LastReconciliation.Verification != "reference-recorded-not-independently-verified" {
		t.Fatalf("public reconciliation overclaim: %+v", public)
	}
	var catalog RouteCatalog
	doJSON(t, http.MethodGet, server.URL+"/bridge/routes", "", nil, http.StatusOK, &catalog)
	if catalog.Source != "ynx-bridge-route-registry" || len(catalog.Routes) != 1 || catalog.Routes[0].Availability != "unavailable" || catalog.Routes[0].Executable || catalog.Routes[0].Source.Contract != nil || catalog.Routes[0].Fees.ProviderFee != nil || catalog.Routes[0].Refund.Available {
		t.Fatalf("public route catalog overclaim: %+v", catalog)
	}
	tampered := cloneState(b.service.state)
	for key, reconciliation := range tampered.Reconciliations {
		reconciliation.Difference = "0"
		reconciliation.Balanced = true
		tampered.Reconciliations[key] = reconciliation
	}
	if err := saveState(b.state, &tampered); err != nil {
		t.Fatal(err)
	}
	if _, err := New(b.cfg); err == nil || !strings.Contains(err.Error(), "accounting is inconsistent") && !strings.Contains(err.Error(), "truth boundary is invalid") {
		t.Fatalf("resealed inconsistent reconciliation accepted: %v", err)
	}
}

func TestBridgeDailyUserAndLargeTransferControls(t *testing.T) {
	t.Run("large transfer delay", func(t *testing.T) {
		b := newTestBridge(t)
		request := validCreate("large-delay-create-001")
		request.Amount = "600"
		created, err := b.service.CreateTransfer(request)
		if err != nil || !created.Transfer.LargeTransferDelayApplied || created.Transfer.NotBefore == "" {
			t.Fatalf("large delay not applied: %+v %v", created, err)
		}
		block := "0x" + strings.Repeat("c", 64)
		if _, err = b.service.AddAttestation(created.Transfer.ID, b.signedAttestation(t, created.Transfer, "relayer-a", block, 12)); err != nil {
			t.Fatal(err)
		}
		if _, err = b.service.AddAttestation(created.Transfer.ID, b.signedAttestation(t, created.Transfer, "relayer-b", block, 12)); err != nil {
			t.Fatal(err)
		}
		if _, err = b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "large-delay-finalize-001"}); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "delay has not elapsed") {
			t.Fatalf("early large finalize accepted: %v", err)
		}
		*b.clock = b.now.Add(time.Hour)
		if result, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: "large-delay-finalize-001"}); err != nil || result.Transfer.Phase != "proof_attestation" {
			t.Fatalf("elapsed large finalize failed: %+v %v", result, err)
		}
	})
	t.Run("user and daily limits", func(t *testing.T) {
		b := newTestBridge(t)
		b.cfg.Policies[0].MaxOutstanding = "5000"
		b.cfg.Policies[0].DailyLimit = "1500"
		b.cfg.Policies[0].UserOutstandingLimit = "700"
		service, err := New(b.cfg)
		if err != nil {
			t.Fatal(err)
		}
		b.service = service
		first := validCreate("limit-user-first-001")
		first.Amount = "600"
		if _, err = b.service.CreateTransfer(first); err != nil {
			t.Fatal(err)
		}
		sameUser := validCreate("limit-user-second-001")
		sameUser.SourceTxHash = "0x" + strings.Repeat("d", 64)
		sameUser.SourceEventIndex = 8
		sameUser.Amount = "200"
		sameUser.Sender = "0x" + strings.Repeat("B", 40)
		if _, err = b.service.CreateTransfer(sameUser); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "user outstanding limit") {
			t.Fatalf("user limit not enforced: %v", err)
		}
		second := validCreate("limit-daily-second-001")
		second.SourceTxHash = "0x" + strings.Repeat("e", 64)
		second.SourceEventIndex = 9
		second.Sender = "0x" + strings.Repeat("c", 40)
		second.Amount = "700"
		if _, err = b.service.CreateTransfer(second); err != nil {
			t.Fatal(err)
		}
		daily := validCreate("limit-daily-third-001")
		daily.SourceTxHash = "0x" + strings.Repeat("f", 64)
		daily.SourceEventIndex = 10
		daily.Sender = "0x" + strings.Repeat("d", 40)
		daily.Amount = "300"
		if _, err = b.service.CreateTransfer(daily); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "daily limit") {
			t.Fatalf("daily limit not enforced: %v", err)
		}
	})
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
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		req.Header.Set("X-YNX-Bridge-Key", key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("%s %s status=%d want=%d body=%s", method, url, resp.StatusCode, expected, raw)
	}
	if target != nil {
		if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
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
