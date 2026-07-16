package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRemoteContractsFailClosedAndBindEvidence(t *testing.T) {
	body := []byte("bounded")
	hash := hashBytes(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token" && r.Header.Get("X-YNX-AI-Key") != "token" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.URL.Path == "/v1/wallet-auth/verify":
			json.NewEncoder(w).Encode(map[string]any{"active": true, "Account": owner, "Product": "cloud", "ClientID": "ynx-cloud-mobile-v1", "BundleID": "com.ynxweb4.cloud", "Callback": "ynxcloud://wallet-auth/callback"})
		case r.Method == "PUT":
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(map[string]string{"ref": "object-ref", "hash": hash})
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/objects/"):
			w.Write(body)
		case r.URL.Path == "/v1/cloud/evidence":
			w.WriteHeader(201)
		case r.URL.Path == "/ai/stream":
			w.Header().Set("Content-Type", "text/event-stream")
			w.Write([]byte("event: token\ndata: {\"text\":\"grounded\"}\n\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx := context.Background()
	a := WalletAssertion{Product: "cloud", ClientID: "ynx-cloud-mobile-v1", BundleID: "com.ynxweb4.cloud", Callback: "ynxcloud://wallet-auth/callback", Account: owner}
	if err := (RemoteWalletVerifier{BaseURL: server.URL, Token: "token"}).Verify(ctx, a); err != nil {
		t.Fatal(err)
	}
	store := RemoteObjectStore{BaseURL: server.URL, Token: "token"}
	ref, err := store.Put(ctx, hash, body)
	if err != nil || ref != "object-ref" {
		t.Fatalf("put %s %v", ref, err)
	}
	got, err := store.Get(ctx, ref, hash)
	if err != nil || string(got) != "bounded" {
		t.Fatalf("get %q %v", got, err)
	}
	ai := RemoteAIProvider{BaseURL: server.URL, Token: "token", Model: "test"}
	answer, err := ai.Complete(ctx, "summarize", []AIContext{{ObjectID: "o", Version: 1, Content: "selected"}})
	if err != nil || answer != "grounded" {
		t.Fatalf("AI %q %v", answer, err)
	}
	if err := (RemoteTrustSink{BaseURL: server.URL, Token: "token"}).Record(ctx, TrustEvent{Actor: owner}); err != nil {
		t.Fatal(err)
	}
	if err := validRemote("http://198.51.100.1", "token"); err == nil {
		t.Fatal("non-loopback HTTP must fail closed")
	}
}
