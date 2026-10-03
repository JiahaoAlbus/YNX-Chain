package music

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func effectFixture(t *testing.T) (*Service, string, Case, map[string]any) {
	t.Helper()
	s := testService(t)
	actor := testAccount(t, 11)
	v, err := s.OpenCaseIdempotent(actor, "effect-case", "report", "", "Rights report", "sha256:evidence")
	if err != nil {
		t.Fatal(err)
	}
	return s, actor, v, map[string]any{"type": "open_case", "idempotencyKey": "effect-case", "subject": "", "requestScope": "music.rights", "purpose": v.Reason, "requestedAction": v.Kind, "evidence": []map[string]any{{"source": "ynx-music", "digest": v.EvidenceRef, "summary": v.Reason, "collectedAt": v.CreatedAt, "visibleToSubject": true}}}
}
func effectScope(s *Service, actor, nonce string) *Service {
	return s.requestService(testBusinessLease(actor, nonce, s.cfg.Now))
}
func runTrustEffect(s *Service, actor string, v Case, input any) error {
	var receipt struct {
		ID string `json:"id"`
	}
	return s.centralBusinessEffect(context.Background(), actor, "trust", v.ID, s.cfg.TrustGatewayURL, s.cfg.TrustGatewayKey, input, &receipt, validateTrustReceipt)
}
func TestBusinessEffectCompleteReceiptRecoversAfterRestartWithoutResend(t *testing.T) {
	s, actor, v, input := effectFixture(t)
	var calls atomic.Int32
	raw, _ := json.Marshal(input)
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		wire, _ := io.ReadAll(r.Body)
		if !bytes.Equal(wire, raw) {
			t.Error("outbound wire changed")
		}
		if r.Header.Get("Authorization") != "Bearer fixture-central-key" || r.Header.Get("X-YNX-Product-Session-Proof-V2") != "" {
			t.Error("wrong authority headers")
		}
		writeJSON(w, 200, map[string]string{"id": "trust-receipt"})
	}))
	defer central.Close()
	s.cfg.HTTPClient = central.Client()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "fixture-central-key"
	if err := runTrustEffect(effectScope(s, actor, "effect_success01"), actor, v, input); err != nil {
		t.Fatal(err)
	}
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	scoped := effectScope(recovered, actor, "effect_success02")
	if err := runTrustEffect(scoped, actor, v, input); err != nil {
		t.Fatal(err)
	}
	linked, err := scoped.LinkCentralCase(actor, v.ID, "trust-receipt")
	if err != nil || linked.CentralCaseID != "trust-receipt" {
		t.Fatalf("receipt recovery failed: %#v %v", linked, err)
	}
	if calls.Load() != 1 {
		t.Fatal("receipt recovery resent external request")
	}
	if len(recovered.state.BusinessEffects) != 1 {
		t.Fatal("journal lost on restart")
	}
}
func TestBusinessEffectUnknownOutcomeIsNeverResent(t *testing.T) {
	for _, mode := range []string{"rejected", "oversized", "multiple JSON", "wrong type", "redirect", "revoked after response", "cancelled after response"} {
		t.Run(mode, func(t *testing.T) {
			s, actor, v, input := effectFixture(t)
			var calls, redirectCalls atomic.Int32
			var revoked atomic.Bool
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			sink := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				redirectCalls.Add(1)
				writeJSON(w, 200, map[string]string{"id": "should-not-reach"})
			}))
			defer sink.Close()
			central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				switch mode {
				case "rejected":
					writeJSON(w, 503, map[string]string{"id": "no"})
				case "oversized":
					w.Header().Set("Content-Type", "application/json")
					w.Write([]byte(strings.Repeat("x", (1<<20)+1)))
				case "multiple JSON":
					w.Header().Set("Content-Type", "application/json")
					w.Write([]byte(`{"id":"x"}{"id":"y"}`))
				case "wrong type":
					w.Header().Set("Content-Type", "text/plain")
					w.Write([]byte(`{"id":"x"}`))
				case "redirect":
					http.Redirect(w, r, sink.URL, http.StatusTemporaryRedirect)
				case "revoked after response":
					revoked.Store(true)
					writeJSON(w, 200, map[string]string{"id": "late"})
				case "cancelled after response":
					cancel()
					writeJSON(w, 200, map[string]string{"id": "late"})
				}
			}))
			defer central.Close()
			s.cfg.HTTPClient = central.Client()
			s.cfg.TrustGatewayURL = central.URL
			s.cfg.TrustGatewayKey = "fixture-key"
			scoped := effectScope(s, actor, "unknown_first01")
			scoped.business.ctx = ctx
			scoped.business.grant.Revalidate = func(context.Context) error {
				if revoked.Load() {
					return ErrUnauthorized
				}
				return nil
			}
			if err := runTrustEffect(scoped, actor, v, input); err == nil {
				t.Fatal("unknown receipt reported success")
			}
			e := s.state.BusinessEffects[effectKey(actor, "trust", v.ID)]
			if e.Status != "dispatch_admitted" || len(e.Receipt) != 0 {
				t.Fatalf("unknown incorrectly committed: %#v", e)
			}
			recovered, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			if err := runTrustEffect(effectScope(recovered, actor, "unknown_retry01"), actor, v, input); !errors.Is(err, ErrConflict) {
				t.Fatalf("unknown retry: %v", err)
			}
			if calls.Load() != 1 || redirectCalls.Load() != 0 {
				t.Fatalf("unknown redispatched: %d redirect %d", calls.Load(), redirectCalls.Load())
			}
			if recovered.state.Cases[v.ID].CentralCaseID != "" {
				t.Fatal("late receipt linked original case")
			}
		})
	}
}
func TestBusinessEffectRevalidatesImmediatelyBeforeDispatch(t *testing.T) {
	s, actor, v, input := effectFixture(t)
	var calls atomic.Int32
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		writeJSON(w, 200, map[string]string{"id": "no"})
	}))
	defer central.Close()
	s.cfg.HTTPClient = central.Client()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "fixture-key"
	scoped := effectScope(s, actor, "predispatch_0001")
	checks := 0
	scoped.business.grant.Revalidate = func(context.Context) error {
		checks++
		if checks >= 2 {
			return ErrUnauthorized
		}
		return nil
	}
	if err := runTrustEffect(scoped, actor, v, input); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revocation ignored: %v", err)
	}
	if calls.Load() != 0 || len(s.state.BusinessEffects) != 1 {
		t.Fatal("dispatch occurred after revocation or admission was lost")
	}
}
func TestBusinessEffectAdmissionFailureMakesNoNetworkCall(t *testing.T) {
	s, actor, v, input := effectFixture(t)
	var calls atomic.Int32
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer central.Close()
	s.cfg.HTTPClient = central.Client()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "fixture-key"
	scoped := effectScope(s, actor, "admission_fail01")
	blocker := filepath.Join(t.TempDir(), "blocker")
	os.WriteFile(blocker, []byte("x"), 0600)
	scoped.cfg.StatePath = filepath.Join(blocker, "state.json")
	if err := runTrustEffect(scoped, actor, v, input); err == nil {
		t.Fatal("failed admission accepted")
	}
	if calls.Load() != 0 || len(s.state.BusinessEffects) != 0 || scoped.business.consumed {
		t.Fatal("failed admission dispatched or consumed nonce")
	}
}
func TestBusinessEffectParallelAdmissionAndNoLockDuringNetwork(t *testing.T) {
	s, actor, v, input := effectFixture(t)
	var calls atomic.Int32
	entered := make(chan struct{})
	release := make(chan struct{})
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		close(entered)
		<-release
		writeJSON(w, 200, map[string]string{"id": "parallel"})
	}))
	defer central.Close()
	s.cfg.HTTPClient = central.Client()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "fixture-key"
	result := make(chan error, 1)
	go func() { result <- runTrustEffect(effectScope(s, actor, "parallel_effect1"), actor, v, input) }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("dispatch did not start")
	}
	other := make(chan error, 1)
	go func() {
		_, err := s.UpsertProfile(testAccount(t, 12), Profile{DisplayName: "other account"})
		other <- err
	}()
	select {
	case err := <-other:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("store lock held during network")
	}
	if err := runTrustEffect(effectScope(s, actor, "parallel_effect2"), actor, v, input); !errors.Is(err, ErrConflict) {
		t.Fatalf("parallel duplicate accepted: %v", err)
	}
	close(release)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("parallel request sent twice")
	}
}
func TestBusinessEffectReceiptRejectsActorAndWireTampering(t *testing.T) {
	s, actor, v, input := effectFixture(t)
	var calls atomic.Int32
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		writeJSON(w, 200, map[string]string{"id": "trusted"})
	}))
	defer central.Close()
	s.cfg.HTTPClient = central.Client()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "fixture-key"
	if err := runTrustEffect(effectScope(s, actor, "tamper_original1"), actor, v, input); err != nil {
		t.Fatal(err)
	}
	if err := runTrustEffect(effectScope(s, actor, "tamper_wire_0001"), actor, v, map[string]string{"purpose": "different"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("tampered wire accepted: %v", err)
	}
	other := testAccount(t, 13)
	if err := runTrustEffect(effectScope(s, other, "tamper_actor001"), other, v, input); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("other actor borrowed receipt: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatal("tamper dispatched network")
	}
}
func TestBusinessEffectActualPayAndTrustHandlersUseDurableReceipts(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 1)
	track := publishTrack(t, s, actor, false)
	listener := testAccount(t, 2)
	s.UpsertProfile(listener, Profile{DisplayName: "Listener"})
	_, usage, err := s.SavePosition(listener, track.ID, "effect-usage", 1200, true)
	if err != nil {
		t.Fatal(err)
	}
	allocation, err := s.Allocate(actor, "source", 1000, []string{usage.ID})
	if err != nil {
		t.Fatal(err)
	}
	var payCalls, trustCalls, nonces atomic.Int32
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q map[string]any
		json.NewDecoder(r.Body).Decode(&q)
		switch q["type"] {
		case "open_case":
			trustCalls.Add(1)
			writeJSON(w, 200, map[string]string{"id": "trust-handler"})
		case "music_creator_settlement":
			payCalls.Add(1)
			if q["amountMicros"] != float64(1000) || q["payTo"] != actor {
				t.Error("original settlement changed")
			}
			writeJSON(w, 200, map[string]string{"id": "pay-handler", "reviewUri": "ynxpay://settlement/review?intent=pay-handler", "status": "requires_wallet_review"})
		default:
			t.Error("unexpected request")
			w.WriteHeader(400)
		}
	}))
	defer central.Close()
	s.cfg.HTTPClient = central.Client()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.PayGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "trust-fixture"
	s.cfg.PayGatewayKey = "pay-fixture"
	s.cfg.BusinessAuthority = fixtureBusinessAuthority(func(ctx context.Context, r *http.Request, scope string, body io.Reader, limit int64) (MusicBusinessGrant, error) {
		raw, err := io.ReadAll(body)
		grant := testBusinessLease(actor, fmt.Sprintf("handler_nonce_%05d", nonces.Add(1)), s.cfg.Now).grant
		grant.BodyDigest = effectDigest(raw)
		return grant, err
	})
	handler := NewServer(s, "https://music.ynx.test", nil).Handler()
	for _, kind := range []string{"trust", "pay"} {
		for i := 0; i < 2; i++ {
			target := "/api/cases"
			input := any(map[string]string{"kind": "report", "trackID": track.ID, "reason": "Rights report", "evidenceRef": "sha256:abc"})
			if kind == "pay" {
				target = "/api/creator/settlements"
				input = map[string]string{"allocationID": allocation.ID, "payTo": actor}
			}
			raw, _ := json.Marshal(input)
			r := httptest.NewRequest("POST", target, bytes.NewReader(raw))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-YNX-Product-Session-Proof-V2", "fixture")
			r.Header.Set("X-YNX-Music-Business-Proof-V2", "fixture")
			r.Header.Set("Idempotency-Key", kind+"-handler-1")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != 201 {
				t.Fatalf("%s actual route: %d %s", kind, w.Code, w.Body.String())
			}
			if kind == "pay" && !strings.Contains(w.Body.String(), "requires_wallet_review") {
				t.Fatal("settlement falsely reported paid")
			}
		}
	}
	if payCalls.Load() != 1 || trustCalls.Load() != 1 || len(s.state.BusinessEffects) != 2 {
		t.Fatalf("actual handler resends: pay=%d trust=%d", payCalls.Load(), trustCalls.Load())
	}
}

type musicEffectTransport func(*http.Request) (*http.Response, error)

func (f musicEffectTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestBusinessEffectReceiptPersistenceFailureDoesNotResend(t *testing.T) {
	s, actor, v, input := effectFixture(t)
	var calls atomic.Int32
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		writeJSON(w, 200, map[string]string{"id": "receipt-not-persisted"})
	}))
	defer central.Close()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "fixture-key"
	scoped := effectScope(s, actor, "receipt_fail_001")
	originalPath := scoped.cfg.StatePath
	blocker := filepath.Join(t.TempDir(), "blocker")
	os.WriteFile(blocker, []byte("x"), 0600)
	client := central.Client()
	transport := client.Transport
	client.Transport = musicEffectTransport(func(r *http.Request) (*http.Response, error) {
		resp, err := transport.RoundTrip(r)
		scoped.cfg.StatePath = filepath.Join(blocker, "state.json")
		return resp, err
	})
	scoped.cfg.HTTPClient = client
	if err := runTrustEffect(scoped, actor, v, input); err == nil {
		t.Fatal("failed receipt persistence reported success")
	}
	scoped.cfg.StatePath = originalPath
	s.cfg.HTTPClient = central.Client()
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := runTrustEffect(effectScope(recovered, actor, "receipt_retry01"), actor, v, input); !errors.Is(err, ErrConflict) {
		t.Fatalf("unpersisted receipt resent: %v", err)
	}
	if calls.Load() != 1 || len(recovered.state.BusinessEffects[effectKey(actor, "trust", v.ID)].Receipt) != 0 {
		t.Fatal("failed receipt incorrectly committed or resent")
	}
}
func TestBusinessEffectInvalidPayReceiptStaysUncommitted(t *testing.T) {
	for _, raw := range []string{`{"id":"p","reviewUri":"ynxpay://settlement/review?intent=p","status":"paid"}`, `{"id":"p","reviewUri":"https://other.example/review","status":"requires_wallet_review"}`, `{"id":"p","reviewUri":"ynxpay://settlement/review","status":"requires_wallet_review","extra":1}`, `{"id":"","reviewUri":"ynxpay://settlement/review","status":"requires_wallet_review"}`} {
		if err := validatePayReceipt([]byte(raw)); err == nil {
			t.Fatalf("unsafe Pay receipt accepted: %s", raw)
		}
	}
}
func TestBusinessEffectSchema3BackupMigratesOnlyRestoreDestination(t *testing.T) {
	s, _, _, _ := effectFixture(t)
	dir := filepath.Join(t.TempDir(), "backup")
	manifest, err := s.CreateBackup(dir)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(dir, "state.json")
	data, _ := os.ReadFile(statePath)
	var st persistentState
	json.Unmarshal(data, &st)
	st.SchemaVersion = 3
	if err := saveState(statePath, &st); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(statePath)
	manifest.StateSchemaVersion = 3
	manifest.StateIntegrityHash = st.IntegrityHash
	manifest.StateSHA256, manifest.StateBytes, err = hashPrivateRegularFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	p := StateCompatibility()
	p.CurrentSchemaVersion = 3
	p.MinimumWritableSchemaVersion = 3
	p.ReadableSchemaVersions = []int{1, 2, 3}
	p.WritableSchemaVersions = []int{3}
	p.AutoMigratedSchemaVersions = []int{1, 2}
	manifest.StateCompatibility = &p
	encoded, _ := json.Marshal(manifest)
	os.WriteFile(filepath.Join(dir, "manifest.json"), encoded, 0600)
	root := filepath.Join(t.TempDir(), "new")
	if err := RestoreBackup(dir, filepath.Join(root, "state.json"), filepath.Join(root, "media")); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("schema3 original backup rewritten")
	}
	recovered, err := New(Config{StatePath: filepath.Join(root, "state.json"), MediaDir: filepath.Join(root, "media"), MaxUploadBytes: 1 << 20})
	if err != nil || recovered.state.SchemaVersion != currentStateSchemaVersion || len(recovered.state.Cases) != 1 {
		t.Fatalf("original case lost: %v", err)
	}
}
