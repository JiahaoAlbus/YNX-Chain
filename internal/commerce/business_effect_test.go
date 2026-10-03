package commerce

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLegacyDeletedActorRetirementSurvivesRepresentationAndRestart(t *testing.T) {
	for _, representation := range []string{"native", "canonical"} {
		t.Run(representation, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "legacy11.json")
			s, _ := Open("")
			_, canonical := actor(t, 2)
			native, _ := accountaddress.Encode(canonical)
			old := canonical
			if representation == "native" {
				old = native
			}
			const key = "retired-before-v2-cart"
			intents := []RetiredIntent{{Route: "cart.save", Key: key}}
			receipt, err := s.DeleteBuyerDataRequest(old, "old-deletion-request", intents)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(s.s)
			var fields map[string]json.RawMessage
			_ = json.Unmarshal(raw, &fields)
			fields["Version"] = json.RawMessage("11")
			delete(fields, "BusinessActorNamespaces")
			raw, _ = json.Marshal(fields)
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			for attempt := 0; attempt < 2; attempt++ {
				r, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				err = r.withBusinessAction(context.Background(), businessProof(r), currentBusinessActor, func(tx *Store) error {
					selected, err := tx.resolveBusinessActor(native)
					if err != nil {
						return err
					}
					_, err = tx.SaveCartIntent(selected, CartInput{IdempotencyKey: key})
					return err
				})
				if !errors.Is(err, ErrConflict) || len(r.s.BusinessNonces) != 0 || len(r.s.Idempotency) != 0 || len(r.s.Carts) != 0 || len(r.s.BusinessActorNamespaces) != 0 {
					t.Fatalf("retired replay committed %v", err)
				}
				replay, err := r.DeleteBuyerDataRequest(canonical, "old-deletion-request", intents)
				if err != nil || replay.ReceiptID != receipt.ReceiptID {
					t.Fatal("old deletion receipt lost", err)
				}
				if len(r.s.RetiredIdempotency) != 1 {
					t.Fatal("historical digests rewritten")
				}
			}
		})
	}
}

func effectOrderFixture(t *testing.T, path string) (*Store, string, Order) {
	t.Helper()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	st, p := setupCatalog(t, s, owner, 5)
	o, err := s.CreateOrder(buyer, orderInput(st, p, "effect-order-create"))
	if err != nil {
		t.Fatal(err)
	}
	return s, buyer, o
}

func TestBusinessPayPerDispatchFenceAndReceivedRecovery(t *testing.T) {
	for _, replaceAt := range []int32{0, 1, 2} {
		t.Run(string(rune('0'+replaceAt)), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			s, buyer, order := effectOrderFixture(t, path)
			var calls atomic.Int32
			var active atomic.Bool
			active.Store(true)
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				count := calls.Add(1)
				if r.Header.Get("X-YNX-Pay-Key") != "secret-qa-key" {
					t.Error("lost original Pay authentication")
				}
				if count == replaceAt {
					active.Store(false)
				}
				if r.URL.Path == "/pay/intents" {
					w.Write([]byte(`{"id":"actual-intent"}`))
				} else if r.URL.Path == "/pay/invoices" {
					w.Write([]byte(`{"id":"actual-invoice"}`))
				} else {
					t.Error("unexpected request", r.URL.Path)
				}
			}))
			defer provider.Close()
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
				if !active.Load() {
					return ErrUnauthorized
				}
				return nil
			}}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "secret-qa-key", MerchantID: "merchant", PayoutAddress: buyer}}
			server := NewServer(s, cfg)
			body := `{"IdempotencyKey":"effect-pay-handoff"}`
			route := "/api/orders/" + order.ID + "/pay-handoff"
			w := businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), body)
			if replaceAt == 0 {
				if w.Code != 201 {
					t.Fatal(w.Code, w.Body.String())
				}
			} else {
				if w.Code < 400 {
					t.Fatal("late private result released", w.Code)
				}
			}
			if replaceAt == 1 && calls.Load() != 1 {
				t.Fatal("second external dispatch ignored actor replacement")
			}
			r, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			var record BusinessEffect
			for _, v := range r.s.BusinessEffects {
				record = v
			}
			if len(record.Steps) != int(calls.Load()) || record.Steps[0].Phase != "received" {
				t.Fatal("actual partial receipt lost", record)
			}
			encoded, _ := json.Marshal(r.s)
			if strings.Contains(string(encoded), "secret-qa-key") {
				t.Fatal("credential persisted")
			}
			active.Store(true)
			server = NewServer(r, cfg)
			w = businessHTTPRequest(server, "POST", route, strings.Repeat("c", 43), body)
			if replaceAt == 1 {
				if w.Code != 409 || calls.Load() != 1 {
					t.Fatal("unknown request resent", w.Code)
				}
				w = businessHTTPRequest(server, "POST", route, strings.Repeat("d", 43), `{"IdempotencyKey":"different-effect-key"}`)
				if w.Code != 409 || calls.Load() != 1 {
					t.Fatal("new key bypassed uncertain outcome")
				}
			} else {
				if w.Code != 201 || calls.Load() != 2 {
					t.Fatal("received result was not recovered without resend", w.Code, w.Body.String())
				}
				got, _ := r.Order(buyer, "buyer", order.ID)
				if got.InvoiceID != "actual-invoice" {
					t.Fatal("receipt not bound")
				}
			}
		})
	}
}

func TestBusinessEffectAdmissionDiskFailureDispatchesNothing(t *testing.T) {
	s, buyer, order := effectOrderFixture(t, "")
	blocked := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocked, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocked, "state.json")
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer provider.Close()
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa", MerchantID: "qa", PayoutAddress: buyer}})
	w := businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/pay-handoff", strings.Repeat("b", 43), `{"IdempotencyKey":"no-disk-no-dispatch"}`)
	if w.Code < 400 || calls.Load() != 0 || len(s.s.BusinessEffects) != 0 || len(s.s.BusinessNonces) != 0 {
		t.Fatal("unpersisted admission sent request", w.Code)
	}
}

func TestBusinessAILateReceiptCancellationAndPrivacyBoundary(t *testing.T) {
	for _, known := range []bool{true, false} {
		t.Run(map[bool]string{true: "received", false: "unconfirmed"}[known], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			s, _ := Open(path)
			_, buyer := actor(t, 2)
			job, err := s.CreateAIJob(buyer, AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "private selected context", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "cancel-effect-ai-job"})
			if err != nil {
				t.Fatal(err)
			}
			started, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				close(started)
				<-release
				if !known {
					w.WriteHeader(500)
				}
				w.Write([]byte(`{"Result":"actual private provider result"}`))
			}))
			defer provider.Close()
			server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, AI: HTTPAIGateway{BaseURL: provider.URL, APIKey: "secret-qa"}})
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				done <- businessHTTPRequest(server, "POST", "/api/ai/jobs/"+job.ID+"/run", strings.Repeat("b", 43), `{}`)
			}()
			<-started
			export := s.ExportBuyerData(buyer)
			if len(export.BusinessEffects) != 1 || len(export.BusinessEffects[0].Steps) != 1 {
				close(release)
				<-done
				t.Fatal("own external request missing from privacy export")
			}
			_, other := actor(t, 3)
			if len(s.ExportBuyerData(other).BusinessEffects) != 0 {
				close(release)
				<-done
				t.Fatal("external request export crossed account")
			}
			export.BusinessEffects[0].Steps[0].Request[0] = 0
			if _, err := s.CancelAIJob(buyer, job.ID); err != nil {
				close(release)
				<-done
				t.Fatal(err)
			}
			if _, err := s.DeleteBuyerDataRequest(buyer, "delete-ai-pending-result", nil); !errors.Is(err, ErrInvalidState) {
				close(release)
				<-done
				t.Fatal("uncertain pending work erased", err)
			}
			close(release)
			w := <-done
			if w.Code < 400 || strings.Contains(w.Body.String(), "actual private provider result") {
				t.Fatal("cancelled job received private success")
			}
			r, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			current, _ := r.AIJob(buyer, job.ID)
			if !current.Cancelled || current.Result != "" {
				t.Fatal("late AI revived job")
			}
			for _, effect := range r.s.BusinessEffects {
				if len(effect.Steps) != 1 || effect.Steps[0].Phase != "received" {
					t.Fatal("actual HTTP receipt lost")
				}
				if known && effect.Phase != "abandoned" {
					t.Fatal("known cancelled work not terminal")
				}
				if !known && effect.Phase != "unknown" {
					t.Fatal("provider error treated as safe resend")
				}
			}
			if known {
				if err := r.DeleteAIJob(buyer, job.ID); err != nil {
					t.Fatal(err)
				}
				if len(r.s.BusinessEffects) != 0 || len(r.s.RetiredBusinessEffects) != 1 {
					t.Fatal("explicit result deletion lost replay boundary")
				}
				raw, _ := json.Marshal(r.s)
				if strings.Contains(string(raw), "private selected context") {
					t.Fatal("deleted AI context retained")
				}
			} else {
				if err := r.DeleteAIJob(buyer, job.ID); !errors.Is(err, ErrInvalidState) {
					t.Fatal("unknown result deleted", err)
				}
				if _, err := r.DeleteBuyerDataRequest(buyer, "delete-ai-unknown-result", nil); !errors.Is(err, ErrInvalidState) {
					t.Fatal("unknown result privacy-erased", err)
				}
			}
			if calls.Load() != 1 {
				t.Fatal("AI resent")
			}
		})
	}
}

func TestBusinessEffectReceiptDiskFailureNeverResendsAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, buyer, order := effectOrderFixture(t, path)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Write([]byte(`{"id":"disk-intent"}`))
			return
		}
		// The provider has accepted the second request. Prevent receipt storage.
		if err := os.Mkdir(path+".tmp", 0700); err != nil {
			t.Error(err)
		}
		w.Write([]byte(`{"id":"disk-invoice"}`))
	}))
	defer provider.Close()
	cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa", MerchantID: "merchant", PayoutAddress: buyer}}
	body := `{"IdempotencyKey":"failed-receipt-handoff"}`
	route := "/api/orders/" + order.ID + "/pay-handoff"
	w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), body)
	if w.Code < 400 || calls.Load() != 2 {
		t.Fatal("receipt storage failure reported success", w.Code)
	}
	if err := os.Remove(path + ".tmp"); err != nil {
		t.Fatal(err)
	}
	r, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, effect := range r.s.BusinessEffects {
		if effect.Phase != "dispatching" || len(effect.Steps) != 2 || effect.Steps[0].Phase != "received" || effect.Steps[1].Phase != "dispatching" {
			t.Fatal("lost uncertain dispatch evidence")
		}
	}
	w = businessHTTPRequest(NewServer(r, cfg), "POST", route, strings.Repeat("c", 43), body)
	if w.Code != 409 || calls.Load() != 2 {
		t.Fatal("failed receipt resent after restart", w.Code)
	}
	got, _ := r.Order(buyer, "buyer", order.ID)
	if got.InvoiceID != "" {
		t.Fatal("unpersisted receipt bound order")
	}
	if err := RestoreCommerceBackup(path, nil); err != nil {
		t.Fatal(err)
	}
	r, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	w = businessHTTPRequest(NewServer(r, cfg), "POST", route, strings.Repeat("d", 43), body)
	if w.Code != 409 || calls.Load() != 2 {
		t.Fatal("backup revived uncertain dispatch", w.Code)
	}
}
