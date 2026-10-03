package commerce

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func paidTrustFixture(t *testing.T) (*Store, string, Order) {
	t.Helper()
	s, buyer, order, receipt := settlementFixture(t)
	paid, err := s.ConfirmSettlement(order.ID, receipt)
	if err != nil {
		t.Fatal(err)
	}
	return s, buyer, paid
}

func TestBusinessTrustDurableReceiptPrivacyReplayAndLateActorRecovery(t *testing.T) {
	for _, late := range []bool{false, true} {
		t.Run(map[bool]string{false: "normal", true: "late actor"}[late], func(t *testing.T) {
			s, buyer, order := paidTrustFixture(t)
			var calls atomic.Int32
			var active atomic.Bool
			active.Store(true)
			const key = "original-dispute-request"
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "POST" || r.URL.Path != "/api/actions" || r.Header.Get("Authorization") != "Bearer secret-trust-qa" || r.Header.Get("X-YNX-Actor") != buyer {
					t.Error("original Trust contract changed")
				}
				var payload map[string]any
				if json.NewDecoder(r.Body).Decode(&payload) != nil {
					t.Error("invalid Trust payload")
				}
				raw, _ := json.Marshal(payload)
				if strings.Contains(string(raw), "private explanation") || strings.Contains(string(raw), buyer) || payload["idempotencyKey"] != "shop-dispute-"+key || !strings.Contains(string(raw), "sha256:") {
					t.Error("private evidence crossed Trust payload boundary")
				}
				if late {
					active.Store(false)
				}
				w.Write([]byte(`{ "case": {"ID":"source-case","Status":"submitted","CreatedAt":"2026-10-03T00:00:00Z"} }`))
			}))
			defer provider.Close()
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
				if !active.Load() {
					return ErrUnauthorized
				}
				return nil
			}}, Trust: HTTPTrustGateway{BaseURL: provider.URL, APIKey: "secret-trust-qa", PublicBaseURL: "https://trust.ynxweb4.com"}}
			route := "/api/orders/" + order.ID + "/transition"
			body := `{"Action":"disputed","Reason":"not as described","Explanation":"private explanation","IdempotencyKey":"` + key + `"}`
			w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), body)
			current, _ := s.Order(buyer, "buyer", order.ID)
			if late {
				if w.Code < 400 || current.TrustCase != nil || current.TrustStatus != "pending_gateway_handoff" {
					t.Fatal("late result published", w.Code)
				}
			} else if w.Code != 200 || current.TrustCase == nil || current.TrustCase.CaseID != "source-case" {
				t.Fatal(w.Code, w.Body.String())
			}
			reopened, err := Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			for _, effect := range reopened.s.BusinessEffects {
				if effect.Kind != "trust.dispute" || len(effect.Steps) != 1 || effect.Steps[0].Phase != "received" || !strings.Contains(string(effect.Steps[0].Response), `{ "case"`) {
					t.Fatal("raw original receipt lost")
				}
			}
			disk, err := os.ReadFile(s.path)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(disk), "secret-trust-qa") {
				t.Fatal("Trust credential journaled")
			}
			_, other := actor(t, 3)
			if len(reopened.ExportBuyerData(other).BusinessEffects) != 0 {
				t.Fatal("foreign export leaked Trust receipt")
			}
			if len(reopened.ExportBuyerData(buyer).BusinessEffects) != 1 {
				t.Fatal("own receipt omitted from export")
			}
			active.Store(true)
			server := NewServer(reopened, cfg)
			if w := businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), body); w.Code != 409 {
				t.Fatal("consumed action replay accepted", w.Code)
			}
			if w := businessHTTPRequest(server, "POST", route, strings.Repeat("c", 43), body); w.Code != 200 || calls.Load() != 1 {
				t.Fatal("receipt recovery resent Trust case", w.Code, w.Body.String(), calls.Load())
			}
			current, _ = reopened.Order(buyer, "buyer", order.ID)
			if current.TrustCase == nil || current.TrustCase.CaseID != "source-case" || current.Status != "disputed" || current.RefundStatus != "not_requested" {
				t.Fatal("incorrect Trust finalization")
			}
		})
	}
}

func TestBusinessTrustUnknownOutcomeCannotResendAfterRestartBackupOrNewKey(t *testing.T) {
	s, buyer, order := paidTrustFixture(t)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(503)
		w.Write([]byte(`{"error":"unknown case outcome"}`))
	}))
	defer provider.Close()
	cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Trust: HTTPTrustGateway{BaseURL: provider.URL, APIKey: "qa"}}
	route := "/api/orders/" + order.ID + "/transition"
	body := `{"Action":"disputed","Reason":"not delivered","IdempotencyKey":"unknown-trust-case"}`
	if w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), body); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	if err := RestoreCommerceBackup(s.path, nil); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(reopened, cfg)
	for i, key := range []string{"unknown-trust-case", "alternative-trust-key"} {
		changed := strings.ReplaceAll(body, "unknown-trust-case", key)
		if w := businessHTTPRequest(server, "POST", route, strings.Repeat(string(rune('c'+i)), 43), changed); w.Code != 409 || calls.Load() != 1 {
			t.Fatal("unknown submission redispatched", w.Code, calls.Load())
		}
	}
	if _, err := reopened.DeleteBuyerData(buyer); err == nil {
		t.Fatal("privacy deletion erased unknown duplicate guard")
	}
}

func TestBusinessTrustForeignRoleInvalidBodyAndDiskFailureDoNotDispatch(t *testing.T) {
	for _, mode := range []string{"foreign buyer", "seller", "invalid body", "disk"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, order := paidTrustFixture(t)
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
			defer provider.Close()
			actorAccount, role := buyer, "buyer"
			if mode == "foreign buyer" {
				_, actorAccount = actor(t, 3)
			}
			if mode == "seller" {
				_, actorAccount = actor(t, 1)
				role = "seller"
			}
			if mode == "disk" {
				block := filepath.Join(t.TempDir(), "file")
				if err := os.WriteFile(block, []byte("blocked"), 0600); err != nil {
					t.Fatal(err)
				}
				s.path = filepath.Join(block, "state.json")
			}
			body := `{"Action":"disputed","Reason":"claim","IdempotencyKey":"denied-trust-case"}`
			if mode == "invalid body" {
				body = `{"Action":"disputed","Unknown":true}`
			}
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: actorAccount, role: role}, Trust: HTTPTrustGateway{BaseURL: provider.URL, APIKey: "qa"}}
			w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+order.ID+"/transition", strings.Repeat("b", 43), body)
			got, _ := s.Order(buyer, "buyer", order.ID)
			if w.Code < 400 || calls.Load() != 0 || got.Status != "paid" || len(s.s.BusinessEffects) != 0 || len(s.s.BusinessNonces) != 0 {
				t.Fatal("rejected admission changed business", w.Code, calls.Load())
			}
		})
	}
}

func TestBusinessTrustOrderChangeAndReceiptStorageFailureKeepPendingGuard(t *testing.T) {
	for _, mode := range []string{"order changed", "receipt storage"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, order := paidTrustFixture(t)
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if mode == "order changed" {
					s.mu.Lock()
					current := s.s.Orders[order.ID]
					current.TotalYNXT++
					s.s.Orders[order.ID] = current
					if err := s.persistLocked(); err != nil {
						t.Error(err)
					}
					s.mu.Unlock()
				} else if err := os.Mkdir(s.path+".tmp", 0700); err != nil {
					t.Error(err)
				}
				w.Write([]byte(`{"case":{"ID":"accepted-late-case","Status":"submitted","CreatedAt":"2026-10-03T00:00:00Z"}}`))
			}))
			defer provider.Close()
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Trust: HTTPTrustGateway{BaseURL: provider.URL, APIKey: "qa"}}
			route := "/api/orders/" + order.ID + "/transition"
			body := `{"Action":"disputed","Reason":"claim","IdempotencyKey":"late-trust-case-request"}`
			if w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), body); w.Code < 400 {
				t.Fatal("late binding released private success", w.Code)
			}
			if mode == "receipt storage" {
				if err := os.Remove(s.path + ".tmp"); err != nil {
					t.Fatal(err)
				}
			}
			reopened, err := Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			current, _ := reopened.Order(buyer, "buyer", order.ID)
			if current.TrustCase != nil || current.TrustStatus != "pending_gateway_handoff" {
				t.Fatal("unbound receipt finalized")
			}
			if w := businessHTTPRequest(NewServer(reopened, cfg), "POST", route, strings.Repeat("c", 43), body); w.Code < 400 || calls.Load() != 1 {
				t.Fatal("unsafe recovery resent", w.Code, calls.Load())
			}
		})
	}
}
