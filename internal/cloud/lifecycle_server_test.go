package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStorageLifecycleHTTPAuthorizationStrictnessAndArchiveState(t *testing.T) {
	var store *lifecycleTestStore
	service := testService(t, func(cfg *Config) {
		store = &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: cfg.ObjectDir}}
		cfg.ObjectStore = store
	})
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "http-tier.bin", Content: []byte("tier")})
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := service.CreateSession(context.Background(), testWalletEnvelope(t, service, "cloud", "lifecycle-http", []string{"files.read", "files.write"}))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(service).Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/objects/"+object.ID+"/storage-class", bytes.NewBufferString(`{"target":"archive","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("lifecycle strict JSON: %d %s", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects/"+object.ID+"/storage-class", bytes.NewBufferString(`{"target":"archive"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("archive transition: %d %s", rr.Code, rr.Body.String())
	}
	var transition StorageTransition
	if err := json.NewDecoder(rr.Body).Decode(&transition); err != nil {
		t.Fatal(err)
	}
	if transition.Status != "completed" || transition.To != StorageClassArchive || transition.ReadMode != StorageReadRestoreRequired || transition.ProviderEvidence == "" {
		t.Fatalf("archive response truth: %#v", transition)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/objects/"+object.ID+"/content", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable || !bytes.Contains(rr.Body.Bytes(), []byte("restore is required")) {
		t.Fatalf("archive read state: %d %s", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/storage-transitions?objectId="+object.ID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("transition history: %d %s", rr.Code, rr.Body.String())
	}
	var transitions []StorageTransition
	if err := json.NewDecoder(rr.Body).Decode(&transitions); err != nil || len(transitions) != 1 || transitions[0].ID != transition.ID {
		t.Fatalf("transition history body: %#v %v", transitions, err)
	}

	readOnlyToken, _, err := service.CreateSession(context.Background(), testWalletEnvelope(t, service, "cloud", "lifecycle-read-only", []string{"files.read"}))
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects/"+object.ID+"/storage-class", bytes.NewBufferString(`{"target":"hot"}`))
	req.Header.Set("Authorization", "Bearer "+readOnlyToken)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("read-only session changed lifecycle: %d %s", rr.Code, rr.Body.String())
	}

	doc, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "docs", Kind: KindDoc, Name: "product-bound.txt", Content: []byte("docs")})
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects/"+doc.ID+"/storage-class", bytes.NewBufferString(`{"target":"cold"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("cloud session crossed into docs lifecycle: %d %s", rr.Code, rr.Body.String())
	}
}
