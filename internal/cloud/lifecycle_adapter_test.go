package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRemoteLifecycleContractBindsRequestAndEvidence(t *testing.T) {
	var observed StorageTransitionRequest
	var mismatch bool
	var copyResult bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") == "" {
			http.Error(w, "rejected", http.StatusUnauthorized)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&observed); err != nil {
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		result := StorageTransitionResult{
			TransitionID:     observed.TransitionID,
			Ref:              observed.Ref,
			Hash:             observed.Hash,
			From:             observed.From,
			To:               observed.To,
			Status:           "completed",
			ReadMode:         StorageReadImmediate,
			ProviderEvidence: "provider-receipt-1",
			AsOf:             time.Now().UTC(),
		}
		if observed.To == StorageClassArchive {
			result.ReadMode = StorageReadRestoreRequired
		}
		if observed.CopyRequired && copyResult {
			result.Ref = observed.Ref + "-isolated-copy"
		}
		if mismatch {
			result.TransitionID = "wrong-transition"
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}))
	defer server.Close()

	store := RemoteObjectStore{BaseURL: server.URL, Token: "[REDACTED_SECRET]"}
	request := StorageTransitionRequest{
		TransitionID: "storage-transition-1",
		Scope:        objectStorageScope(owner, "cloud"),
		Ref:          "provider/object/ref",
		Hash:         hashBytes([]byte("tiered")),
		From:         StorageClassHot,
		To:           StorageClassArchive,
	}
	result, err := store.Transition(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if observed != request || result.TransitionID != request.TransitionID || result.ReadMode != StorageReadRestoreRequired || result.ProviderEvidence == "" {
		t.Fatalf("lifecycle binding: observed=%#v result=%#v", observed, result)
	}

	copyRequest := request
	copyRequest.TransitionID = "storage-transition-copy"
	copyRequest.CopyRequired = true
	if _, err := store.Transition(context.Background(), copyRequest); err == nil {
		t.Fatal("shared blob lifecycle accepted without an isolated result ref")
	}
	copyResult = true
	copyResponse, err := store.Transition(context.Background(), copyRequest)
	if err != nil || copyResponse.Ref == copyRequest.Ref {
		t.Fatalf("isolated lifecycle copy rejected: %#v %v", copyResponse, err)
	}
	copyResult = false

	mismatch = true
	if _, err := store.Transition(context.Background(), request); err == nil {
		t.Fatal("provider transition-id substitution accepted")
	}
	invalid := request
	invalid.Scope = "invalid"
	if _, err := store.Transition(context.Background(), invalid); err == nil {
		t.Fatal("invalid lifecycle scope accepted")
	}
}
