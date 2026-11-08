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

func TestShopSessionInventoryActualAcceptedV2NormalEntry(t *testing.T) {
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
	_, _ = setupCatalog(t, store, seller, 8)
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

	// PUBLIC deployment qualification only; the original issuer/proofs below are
	// produced by the actual accepted SDK and verified by the normal Go consumer.
	store.shopSessionDomain = &originalShopSessionDomain{realm: ChainName, tenant: seller, current: func(context.Context) error { return nil }}
	recording := &shopSessionRecordingVerifier{underlying: server.cfg.businessV2}
	server.cfg.businessV2 = recording
	command, _ := json.Marshal(map[string]any{"method": "GET", "path": "/api/cart", "body": "", "scopes": []string{"account:read", "shop:orders:write"}})
	if _, err := input.Write(append(command, '\n')); err != nil {
		t.Fatal(err)
	}
	var headers struct{ Introspection, Action string }
	if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &headers) != nil {
		t.Fatal("actual original proof pipe", diagnostic.String())
	}
	r := httptest.NewRequest("GET", "/api/cart", nil)
	r.Header.Set(v2.ProofHeader, headers.Introspection)
	r.Header.Set(v2.ActionProofHeader, headers.Action)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	if w.Code != 200 || len(store.s.ShopSessions) != 1 || recording.verified == nil || recording.verified.shopSessionIssuer == nil {
		t.Fatal("normal verified entry failed inventory", w.Code, w.Body.String())
	}
	original := context.WithValue(context.Background(), businessRequestContextKey{}, recording.verified)
	held, err := store.CaptureOriginalShopSession(original)
	if held != nil {
		defer held.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	data, err := held.DATA(original)
	if err != nil || data.Account != ready.Session.Account || data.Role != "buyer" || data.Generation != 1 {
		t.Fatal(data, err)
	}

	// The fixed Source GET reuses only the original accepted introspection proof;
	// it never turns the empty action nonce into a business-effect admission.
	makeRead := func() *http.Request {
		command, _ := json.Marshal(map[string]any{"method": "GET", "path": OriginalShopInvoiceReadPath + "PUBLIC-order", "body": "", "scopes": ShopScopes})
		if _, e := input.Write(append(command, '\n')); e != nil {
			t.Fatal(e)
		}
		var proof struct{ Introspection, Action string }
		if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &proof) != nil {
			t.Fatal(diagnostic.String())
		}
		req := httptest.NewRequest("GET", OriginalShopInvoiceReadPath+"PUBLIC-order", nil)
		req.Header.Set(v2.ProofHeader, proof.Introspection)
		return req
	}
	scope := originalShopInvoiceReadScope{realm: ChainName, tenant: seller, actor: data.Actor, role: "buyer"}
	readHold, e := store.captureOriginalShopSessionForRead(context.Background(), makeRead(), scope)
	if readHold != nil {
		defer readHold.Close()
	}
	if e != nil {
		t.Fatal("original private proof/header capture", e)
	}
	if store.s.ShopSessionGeneration != 1 {
		t.Fatal("private recheck invented session generation")
	}
	scope.tenant = "PUBLIC-wrong-tenant"
	bad, e := store.captureOriginalShopSessionForRead(context.Background(), makeRead(), scope)
	if bad != nil {
		defer bad.Close()
	}
	if e == nil {
		t.Fatal("Source comparison namespace replaced business namespace")
	}
	if _, e = store.captureOriginalShopSessionForRead(context.Background(), httptest.NewRequest("GET", OriginalShopInvoiceReadPath+"PUBLIC-order", nil), scope); e == nil {
		t.Fatal("Source constraints alone became authenticated session")
	}
	active = false
	if held.Current(original) == nil || held.CurrentLocal() == nil {
		t.Fatal("original actor retirement ignored")
	}
	if providerCalls != 0 {
		t.Fatal("session capture invoked invoice or money path")
	}
	t.Log("Actual accepted SDK v2 issuer/proof -> normal Go HTTP -> inventory -> opaque capture/current; PUBLIC deployment only, genuine Root admission false")
}

type shopSessionRecordingVerifier struct {
	underlying businessVerifier
	verified   *verifiedBusinessRequest
}

func (v *shopSessionRecordingVerifier) verify(r *http.Request, b []byte, p businessRoutePolicy) (*verifiedBusinessRequest, error) {
	out, err := v.underlying.verify(r, b, p)
	if err == nil {
		v.verified = out
	}
	return out, err
}
