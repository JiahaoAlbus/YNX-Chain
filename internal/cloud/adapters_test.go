package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRemoteContractsFailClosedAndBindEvidence(t *testing.T) {
	body := []byte("bounded")
	hash := hashBytes(body)
	var recordedTrust TrustEvent
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token" && r.Header.Get("X-YNX-AI-Key") != "token" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.URL.Path == "/v1/wallet-auth/sessions/verify":
			json.NewEncoder(w).Encode(CentralSessionClaims{VerifierVersion: "wallet-auth-v1", SessionBinding: strings.Repeat("b", 64), ProductClientID: "ynx-cloud-mobile-v1", BundleID: "com.ynxweb4.cloud", ProductDeviceAlgorithm: "p256-sha256", RequestDigest: strings.Repeat("a", 64), Account: owner, Scopes: []string{"files.read"}, IssuedAt: "2026-07-18T00:00:00.000Z", ExpiresAt: "2026-07-18T00:04:00.000Z"})
		case r.URL.Path == "/uploads/presign":
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(DirectUploadPlan{Method: "PUT", URL: server.URL + "/signed/object", Headers: map[string]string{"Content-Type": "application/octet-stream"}, Ref: "direct-ref", ExpiresAt: time.Now().Add(5 * time.Minute)})
		case r.URL.Path == "/uploads/verify":
			json.NewEncoder(w).Encode(DirectUploadVerification{Verified: true, Hash: hash, Size: int64(len(body)), ScanStatus: "accepted"})
		case r.Method == "PUT":
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(map[string]string{"ref": "object-ref", "hash": hash})
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/objects/"):
			w.Write(body)
		case r.Method == "DELETE" && strings.HasPrefix(r.URL.Path, "/objects/") && r.Header.Get("X-Content-SHA256") == hash:
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/v1/cloud/evidence":
			if err := json.NewDecoder(r.Body).Decode(&recordedTrust); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
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
	a := WalletApproval{RequestDigest: strings.Repeat("a", 64), ProductClientID: "ynx-cloud-mobile-v1", BundleID: "com.ynxweb4.cloud", ProductDeviceAlgorithm: "p256-sha256", Account: owner, GrantedScopes: []string{"files.read"}, IssuedAt: "2026-07-18T00:00:00.000Z", ExpiresAt: "2026-07-18T00:04:00.000Z"}
	if _, err := (RemoteWalletVerifier{BaseURL: server.URL, Token: "token"}).Verify(ctx, WalletSessionEnvelope{WalletApproval: a}); err != nil {
		t.Fatal(err)
	}
	store := RemoteObjectStore{BaseURL: server.URL, Token: "token", DirectUploadOrigin: server.URL}
	ref, err := store.Put(ctx, hash, body)
	if err != nil || ref != "object-ref" {
		t.Fatalf("put %s %v", ref, err)
	}
	got, err := store.Get(ctx, ref, hash)
	if err != nil || string(got) != "bounded" {
		t.Fatalf("get %q %v", got, err)
	}
	if err := store.Delete(ctx, ref, hash); err != nil {
		t.Fatalf("delete: %v", err)
	}
	plan, err := store.Presign(ctx, DirectUploadRequest{Hash: hash, Size: int64(len(body)), MIME: "application/octet-stream"})
	if err != nil || plan.Ref != "direct-ref" {
		t.Fatalf("presign: %#v %v", plan, err)
	}
	verified, err := store.VerifyDirect(ctx, plan.Ref, hash, int64(len(body)))
	if err != nil || !verified.Verified || verified.ScanStatus != "accepted" {
		t.Fatalf("verify: %#v %v", verified, err)
	}
	wrongOrigin := store
	wrongOrigin.DirectUploadOrigin = "https://uploads.invalid"
	if _, err := wrongOrigin.Presign(ctx, DirectUploadRequest{Hash: hash, Size: int64(len(body)), MIME: "application/octet-stream"}); err == nil {
		t.Fatal("mismatched direct upload origin accepted")
	}
	ai := RemoteAIProvider{BaseURL: server.URL, Token: "token", Model: "test"}
	answer, err := ai.Complete(ctx, "summarize", []AIContext{{ObjectID: "o", Version: 1, Content: "selected"}})
	if err != nil || answer != "grounded" {
		t.Fatalf("AI %q %v", answer, err)
	}
	event := TrustEvent{Actor: owner, Action: "object.create", ObjectID: "obj_1", Hash: hash}
	if err := (RemoteTrustSink{BaseURL: server.URL, Token: "token"}).Record(ctx, event); err != nil {
		t.Fatal(err)
	}
	if recordedTrust.Actor != event.Actor || recordedTrust.Action != event.Action || recordedTrust.ObjectID != event.ObjectID || recordedTrust.Hash != event.Hash {
		t.Fatalf("Trust evidence fields were not independently encoded: %#v", recordedTrust)
	}
	if err := validRemote("http://198.51.100.1", "token"); err == nil {
		t.Fatal("non-loopback HTTP must fail closed")
	}
}
