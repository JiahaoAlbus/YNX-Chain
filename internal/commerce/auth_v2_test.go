//go:build commerce_v2

package commerce

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type commerceV2RoundTrip func(*http.Request) (*http.Response, error)

func (f commerceV2RoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestCommerceV2ActualSDKAndGoHTTPProfileBoundary(t *testing.T) {
	if os.Getenv("YNX_QA_CENTRAL_SOURCE") == "" {
		t.Skip("requires explicit frozen SDK source composition")
	}
	for _, platform := range []string{"web", "android", "macos"} {
		t.Run(platform, func(t *testing.T) {
			public, key, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			der, _ := x509.MarshalPKIXPublicKey(public)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "node", "testdata/v2-business-node.mjs")
			directory := t.TempDir()
			if err := os.Chmod(directory, 0700); err != nil {
				t.Fatal(err)
			}
			cmd.Env = append(os.Environ(), "YNX_QA_PLATFORM="+platform, "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(directory, "authority"))
			var diagnostic bytes.Buffer
			cmd.Stderr = &diagnostic
			pipe, _ := cmd.StdoutPipe()
			input, _ := cmd.StdinPipe()
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
			scanner := bufio.NewScanner(pipe)
			scanner.Buffer(make([]byte, 4096), 65536)
			var ready struct{ URL, Account, Binding string }
			if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ready) != nil {
				t.Fatal("QA authority startup failed", diagnostic.String())
			}
			local, err := url.Parse(ready.URL)
			if err != nil {
				t.Fatal(err)
			}
			transport := commerceV2RoundTrip(func(r *http.Request) (*http.Response, error) {
				copy := r.Clone(r.Context())
				u := *r.URL
				copy.URL = &u
				copy.URL.Scheme = local.Scheme
				copy.URL.Host = local.Host
				return http.DefaultTransport.RoundTrip(copy)
			})
			account, err := accountaddress.Normalize(ready.Account)
			if err != nil {
				t.Fatal("QA Wallet account checksum failed", err)
			}
			store, _ := Open(filepath.Join(directory, "commerce.json"))
			active := true
			revokeAfterAuthorize := false
			var payCalls atomic.Int32
			var settlementCalls atomic.Int32
			payProvider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/pay/invoices/signed-invoice/settlement" && r.Method == "GET" {
					settlementCalls.Add(1)
					var observed Order
					for _, candidate := range store.Orders(account, "buyer") {
						if candidate.InvoiceID == "signed-invoice" {
							observed = candidate
						}
					}
					json.NewEncoder(w).Encode(SettlementEvidence{InvoiceID: observed.InvoiceID, IntentID: observed.PayIntentID, Merchant: observed.PayMerchant, Payer: ready.Account, PayoutAddress: ready.Account, Status: "paid", Currency: NativeSymbol, AmountYNXT: observed.TotalYNXT, BlockHeight: 47, ConfirmedAt: time.Now().UTC(), TransactionHash: "0x" + strings.Repeat("a", 64), AuditHash: strings.Repeat("b", 64)})
					return
				}
				payCalls.Add(1)
				if r.URL.Path == "/pay/intents" {
					w.Write([]byte(`{"id":"signed-intent"}`))
				} else if r.URL.Path == "/pay/invoices" {
					w.Write([]byte(`{"id":"signed-invoice"}`))
				} else {
					w.WriteHeader(404)
				}
			}))
			defer payProvider.Close()
			var trustCalls atomic.Int32
			trustProvider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				trustCalls.Add(1)
				if r.URL.Path != "/api/actions" || r.Method != "POST" || r.Header.Get("X-YNX-Actor") != account {
					t.Error("signed Trust dispatch lost original binding")
				}
				w.Write([]byte(`{"case":{"ID":"signed-trust-case","Status":"submitted","CreatedAt":"2026-10-03T00:00:00Z"}}`))
			}))
			defer trustProvider.Close()
			cfg := ServerConfig{Pay: HTTPPayVerifier{BaseURL: payProvider.URL, APIKey: "qa-pay", MerchantID: "signed-merchant", PayoutAddress: account}, Trust: HTTPTrustGateway{BaseURL: trustProvider.URL, APIKey: "qa-trust"}}
			server, err := NewCommerceV2Server(store, cfg, []string{platform}, "qa", key, transport, func(_ context.Context, session v2.Session) (func() error, error) {
				if session.Account != ready.Account || session.SessionBinding != ready.Binding {
					return nil, ErrUnauthorized
				}
				if revokeAfterAuthorize {
					if _, err := input.Write([]byte("{\"revoke\":true}\n")); err != nil {
						return nil, err
					}
					var receipt struct{ Revoked bool }
					if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &receipt) != nil || !receipt.Revoked {
						return nil, ErrUnavailable
					}
				}
				return func() error {
					if !active {
						return ErrUnauthorized
					}
					return nil
				}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			request := func(method, path, body string, scopes []string, reuse bool, wire string) *httptest.ResponseRecorder {
				command, _ := json.Marshal(map[string]any{"method": method, "path": path, "body": body, "scopes": scopes, "reuseAction": reuse})
				if _, err := input.Write(append(command, '\n')); err != nil {
					t.Fatal(err)
				}
				var headers struct{ Introspection, Action string }
				if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &headers) != nil {
					t.Fatal("QA proof pipe failed", diagnostic.String())
				}
				r := httptest.NewRequest(method, path, bytes.NewBufferString(wire))
				r.Header.Set(v2.ProofHeader, headers.Introspection)
				r.Header.Set(v2.ActionProofHeader, headers.Action)
				if platform == "web" {
					r.Header.Set("Origin", "https://shop.ynxweb4.com")
				}
				w := httptest.NewRecorder()
				server.Handler().ServeHTTP(w, r)
				return w
			}
			body := `{"DisplayName":"exact SDK wire"}`
			scopes := []string{"account:read", "shop:profile:write"}
			if w := request("PUT", "/api/profile", body, scopes, false, body); w.Code != 200 || store.Profile(account).DisplayName != "exact SDK wire" {
				t.Fatal("actual signed write failed", w.Code, w.Body.String())
			}
			if w := request("PUT", "/api/profile", body, scopes, true, body); w.Code != 409 {
				t.Fatal("action replay accepted", w.Code, w.Body.String())
			}
			if w := request("PUT", "/api/profile", body, scopes, false, `{"DisplayName":"tampered wire"}`); w.Code != 403 || store.Profile(account).DisplayName != "exact SDK wire" {
				t.Fatal("tampered body accepted", w.Code, w.Body.String())
			}
			if w := request("GET", "/api/profile", "", scopes, false, ""); w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("exact SDK wire")) {
				t.Fatal("signed own read failed", w.Code, w.Body.String())
			}
			active = false
			if w := request("GET", "/api/profile", "", scopes, false, ""); w.Code != 403 || bytes.Contains(w.Body.Bytes(), []byte("exact SDK wire")) {
				t.Fatal("replaced actor read leaked", w.Code)
			}
			active = true
			_, owner := actor(t, 1)
			shop, product := setupCatalog(t, store, owner, 5)
			order, err := store.CreateOrder(account, orderInput(shop, product, "actual-sdk-order-key"))
			if err != nil {
				t.Fatal(err)
			}
			payBody := `{"IdempotencyKey":"actual-sdk-pay-key"}`
			payPath := "/api/orders/" + order.ID + "/pay-handoff"
			payScopes := []string{"account:read", "shop:orders:write"}
			if w := request("POST", payPath, payBody, payScopes, false, payBody); w.Code != 201 || payCalls.Load() != 2 {
				t.Fatal("signed external operation failed", w.Code, w.Body.String())
			}
			if w := request("POST", payPath, payBody, payScopes, true, payBody); w.Code != 409 || payCalls.Load() != 2 {
				t.Fatal("signed external replay sent again", w.Code)
			}
			if w := request("POST", payPath, payBody, payScopes, false, payBody); w.Code != 201 || payCalls.Load() != 2 {
				t.Fatal("fresh authorization did not recover actual receipt", w.Code, w.Body.String())
			}
			settlementPath := "/api/orders/" + order.ID + "/confirm-payment"
			if w := request("POST", settlementPath, `{}`, payScopes, false, `{}`); w.Code != 200 || settlementCalls.Load() != 1 {
				t.Fatal("actual signed settlement failed", w.Code, w.Body.String())
			}
			if w := request("POST", settlementPath, `{}`, payScopes, true, `{}`); w.Code != 409 || settlementCalls.Load() != 1 {
				t.Fatal("settlement action replay queried again", w.Code)
			}
			settled, err := store.Order(account, "buyer", order.ID)
			if err != nil || settled.Status != "paid" || settled.Settlement == nil || settled.Settlement.Payer != ready.Account {
				t.Fatal("original raw Wallet representation lost from settlement", err)
			}
			trustBody := `{"Action":"disputed","Reason":"signed owned claim","IdempotencyKey":"signed-trust-request"}`
			trustPath := "/api/orders/" + order.ID + "/transition"
			if w := request("POST", trustPath, trustBody, ShopScopes, false, trustBody); w.Code != 200 || trustCalls.Load() != 1 {
				t.Fatal("actual signed Trust submission failed", w.Code, w.Body.String())
			}
			if w := request("POST", trustPath, trustBody, ShopScopes, true, trustBody); w.Code != 409 || trustCalls.Load() != 1 {
				t.Fatal("Trust action replay resubmitted", w.Code)
			}
			if w := request("POST", trustPath, trustBody, ShopScopes, false, trustBody); w.Code != 200 || trustCalls.Load() != 1 {
				t.Fatal("signed received Trust recovery resent", w.Code, w.Body.String())
			}
			cancelOrder, err := store.CreateOrder(account, orderInput(shop, product, "actual-sdk-cancel-order"))
			if err != nil {
				t.Fatal(err)
			}
			cancelBody := `{"Action":"cancelled","IdempotencyKey":"actual-sdk-cancel-action"}`
			cancelPath := "/api/orders/" + cancelOrder.ID + "/transition"
			if w := request("POST", cancelPath, cancelBody, ShopScopes, false, cancelBody); w.Code != 200 {
				t.Fatal("signed buyer cancel failed", w.Code, w.Body.String())
			}
			if w := request("POST", cancelPath, cancelBody, ShopScopes, true, cancelBody); w.Code != 409 {
				t.Fatal("cancel action replay accepted", w.Code)
			}
			revokeAfterAuthorize = true
			nonces := len(store.s.BusinessNonces)
			if w := request("PUT", "/api/profile", body, scopes, false, body); w.Code != 401 || len(store.s.BusinessNonces) != nonces || store.Profile(account).DisplayName != "exact SDK wire" {
				t.Fatal("authority revocation after authorization did not stop commit", w.Code, w.Body.String())
			}
			_ = io.Closer(input).Close()
		})
	}
}
