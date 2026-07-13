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
			SourceChain: "ethereum-sepolia", DestinationChain: "ynx_6423-1", SourceAsset: "sepolia-usdc", DestinationAsset: "ynx-usdc",
			MinConfirmations: 12, MaxAmount: "1000", AssetBoundary: "canonical-to-represented", ExternalSubmission: false,
		}},
		Now: func() time.Time { return now },
	}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return &testBridge{service: service, cfg: cfg, private: private, state: state, now: now}
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

func TestBridgeConfigRejectsUnsafeTopology(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	base := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), APIKey: "key", Relayers: map[string]ed25519.PublicKey{"only-one": pub}, Threshold: 1, Policies: []RoutePolicy{{SourceChain: "a-chain", DestinationChain: "b-chain", SourceAsset: "asset-a", DestinationAsset: "asset-b", MinConfirmations: 1, MaxAmount: "1", AssetBoundary: "canonical-to-represented"}}}
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
