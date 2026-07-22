package resourceproduct

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/canonicalwallet"
)

func TestProductSessionProofExactBindingReplayTamperAndRestart(t *testing.T) {
	now := time.Date(2026, 7, 22, 5, 0, 0, 0, time.UTC)
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	device := base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), privateKey.X, privateKey.Y))
	binding := strings.Repeat("7", 64)
	session := canonicalwallet.Session{
		VerifierVersion: "wallet-auth-v1", SessionBinding: binding, ChainID: canonicalwallet.ChainID,
		RequestingProduct: "resource-market", ProductClientID: "ynx-resource-market-v1",
		BundleID: "com.ynxweb4.resource", Callback: "ynxresource://wallet-auth/callback",
		ProductDeviceAlgorithm: "p256-sha256", ProductDeviceKey: device,
		DeviceBinding: strings.Repeat("8", 64), Account: "ynx1proof", Scopes: []string{"account:read"},
		Nonce: "proof-test", Purpose: "test exact request proof", RequestDigest: strings.Repeat("9", 64),
		ApprovalDigest: strings.Repeat("a", 64), IssuedAt: now.Add(-time.Minute), ExpiresAt: now.Add(10 * time.Minute),
	}
	store := filepath.Join(t.TempDir(), "proof-state.json")
	newService := func() *Service {
		svc, err := New(Config{StorePath: store, Now: func() time.Time { return now }})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := svc.data.Sessions[binding]; !ok {
			svc.data.Sessions[binding] = CentralSession{Session: session, Status: "active"}
			if err := svc.saveLocked(); err != nil {
				t.Fatal(err)
			}
		}
		return svc
	}
	header := func(method, path string, body []byte) string {
		nonce := make([]byte, 24)
		if _, err := rand.Read(nonce); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		proof, err := canonicalwallet.SignProductSessionProof(canonicalwallet.ProductSessionProof{
			Version: "1", SessionBinding: binding, ProductClientID: session.ProductClientID,
			BundleID: session.BundleID, ProductDeviceKey: device, Method: method, Path: path,
			BodyDigest: hex.EncodeToString(digest[:]), Nonce: base64.RawURLEncoding.EncodeToString(nonce),
			IssuedAt:  now.Add(-time.Second).Format("2006-01-02T15:04:05.000Z"),
			ExpiresAt: now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z"),
		}, privateKey)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := canonicalwallet.EncodeProductSessionProofHeader(proof)
		if err != nil {
			t.Fatal(err)
		}
		return encoded
	}
	handler := func(svc *Service) http.Handler {
		return svc.productSessionProofs(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth, err := requireProductSession(r)
			if err != nil || auth.Actor.ID != session.Account {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "verified context missing"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))
	}
	do := func(h http.Handler, method, path string, body []byte, proof string) int {
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set(canonicalwallet.ProductSessionProofHeader, proof)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Code
	}

	svc := newService()
	h := handler(svc)
	body := []byte(`{"kind":"resource"}`)
	valid := header(http.MethodPost, "/api/authority/intents", body)
	if got := do(h, http.MethodPost, "/api/authority/intents", body, valid); got != http.StatusNoContent {
		t.Fatalf("valid proof status=%d", got)
	}
	if got := do(h, http.MethodPost, "/api/authority/intents", body, valid); got != http.StatusConflict {
		t.Fatalf("same-process replay status=%d", got)
	}
	if got := do(handler(newService()), http.MethodPost, "/api/authority/intents", body, valid); got != http.StatusConflict {
		t.Fatalf("restart replay status=%d", got)
	}
	if got := do(h, http.MethodPost, "/api/authority/intents", []byte(`{"kind":"tampered"}`), header(http.MethodPost, "/api/authority/intents", body)); got != http.StatusUnauthorized {
		t.Fatalf("body tamper status=%d", got)
	}
	if got := do(h, http.MethodPost, "/api/authority/intents/other", body, header(http.MethodPost, "/api/authority/intents", body)); got != http.StatusUnauthorized {
		t.Fatalf("path tamper status=%d", got)
	}
}
