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
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestNativeBuyerProtectedAuthorityCartCheckoutInvoiceReadback(t *testing.T) {
	if os.Getenv("YNX_QA_CENTRAL_SOURCE") == "" {
		t.Skip("explicit frozen SDK composition required")
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(pub)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	directory := t.TempDir()
	_ = os.Chmod(directory, 0700)
	cmd := exec.CommandContext(ctx, "node", "testdata/native-buyer-business-node.mjs")
	cmd.Env = append(os.Environ(), "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(directory, "authority"))
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
	var ready struct {
		URL     string
		Session v2.Session
	}
	if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ready) != nil {
		t.Fatal("protected Native authority startup", diagnostic.String())
	}
	local, _ := url.Parse(ready.URL)
	privateReads := 0
	transport := commerceV2RoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v2/browser-sessions/product-revalidate" {
			privateReads++
		}
		copy := r.Clone(r.Context())
		u := *r.URL
		copy.URL = &u
		copy.URL.Scheme = local.Scheme
		copy.URL.Host = local.Host
		return http.DefaultTransport.RoundTrip(copy)
	})
	store, _ := Open(filepath.Join(directory, "commerce.json"))
	_, seller := actor(t, 9)
	st, p := setupCatalog(t, store, seller, 8)
	providerCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.URL.Path == "/pay/intents" {
			w.Write([]byte(`{"id":"native_intent_original"}`))
		} else if r.URL.Path == "/pay/invoices" {
			w.Write([]byte(`{"id":"native_invoice_original"}`))
		} else {
			w.WriteHeader(404)
		}
	}))
	defer provider.Close()
	active := true
	server, err := NewCommerceNativeBuyerV2Server(store, ServerConfig{Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "isolated-provider", MerchantID: "original_merchant", PayoutAddress: seller}}, "android", "qa", key, transport, func(_ context.Context, original v2.Session) (func() error, error) {
		if original.Platform != "android" || original.SessionBinding != ready.Session.SessionBinding || original.Account != ready.Session.Account {
			return nil, ErrUnauthorized
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
	request := func(method, path string, body any, scopes []string) *httptest.ResponseRecorder {
		raw := []byte{}
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		command, _ := json.Marshal(map[string]any{"method": method, "path": path, "body": string(raw), "scopes": scopes})
		if _, err := input.Write(append(command, '\n')); err != nil {
			t.Fatal(err)
		}
		var headers struct{ Introspection, Action string }
		if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &headers) != nil {
			t.Fatal("actual Native proof pipe", diagnostic.String())
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set(v2.ProofHeader, headers.Introspection)
		r.Header.Set(v2.ActionProofHeader, headers.Action)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	orders := []string{"account:read", "shop:orders:write"}
	cart := request("GET", "/api/cart", nil, orders)
	var saved Cart
	if cart.Code != 200 || json.Unmarshal(cart.Body.Bytes(), &saved) != nil {
		t.Fatal("original cart read", cart.Code, cart.Body.String())
	}
	items := orderInput(st, p, "native-original-order-key").Items
	updated := request("PUT", "/api/cart", map[string]any{"Items": items, "ExpectedRevision": saved.Revision, "IdempotencyKey": "native-original-cart-key"}, orders)
	if updated.Code != 200 || json.Unmarshal(updated.Body.Bytes(), &saved) != nil || saved.Revision == "" {
		t.Fatal("cart mutation", updated.Code, updated.Body.String())
	}
	var wire map[string]any
	_ = json.Unmarshal(updated.Body.Bytes(), &wire)
	if wire["WalletBuyer"] != ready.Session.Account || wire["Buyer"] == ready.Session.Account {
		t.Fatal("original alias not preserved/projected")
	}
	original := orderInput(st, p, "native-original-checkout-key")
	original.CartRevision = &saved.Revision
	created := request("POST", "/api/orders", original, orders)
	var order Order
	if created.Code != 201 || json.Unmarshal(created.Body.Bytes(), &order) != nil {
		t.Fatal("checkout", created.Code, created.Body.String())
	}
	path := "/api/orders/" + order.ID + "/pay-handoff"
	if notReady := request("GET", path, nil, orders); notReady.Code != 409 || providerCalls != 0 {
		t.Fatal("unknown invoice triggered provider", notReady.Code, providerCalls)
	}
	receipt := request("POST", path, map[string]any{"IdempotencyKey": "native-original-invoice-key"}, orders)
	if receipt.Code != 201 || providerCalls != 2 {
		t.Fatal("explicit invoice creation", receipt.Code, receipt.Body.String(), providerCalls)
	}
	for i := 0; i < 2; i++ {
		read := request("GET", path, nil, orders)
		if read.Code != 200 || providerCalls != 2 || !bytes.Contains(read.Body.Bytes(), []byte(`"invoiceId":"native_invoice_original"`)) {
			t.Fatal("cold/return readback redispatched invoice", read.Code, providerCalls, read.Body.String())
		}
	}
	if read := request("GET", "/api/orders/"+order.ID, nil, ShopScopes); read.Code != 200 {
		t.Fatal("current original order readback", read.Code, read.Body.String())
	}
	active = false
	if read := request("GET", path, nil, orders); read.Code == 200 || bytes.Contains(read.Body.Bytes(), []byte("native_invoice_original")) {
		t.Fatal("retired Native actor disclosed invoice", read.Code)
	}
	if privateReads == 0 {
		t.Fatal("protected private authority not called")
	}
}
