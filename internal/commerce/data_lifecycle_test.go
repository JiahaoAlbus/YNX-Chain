package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSellerDataExportIsOwnerOnlyStoreScopedAndDeepCopied(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 29, 2, 30, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	_, ownerA := actor(t, 71)
	_, ownerB := actor(t, 72)
	_, buyer := actor(t, 73)
	storeA, productA := setupCatalog(t, store, ownerA, 3)
	storeB, productB := setupCatalog(t, store, ownerB, 2)
	order, err := store.CreateOrder(buyer, orderInput(storeA, productA, "export-order-key-0001"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSellerInvitation(ownerA, storeA.ID, ownerB, SellerRoleViewer, time.Hour); err != nil {
		t.Fatal(err)
	}

	exported, err := store.ExportSellerData(ownerA, storeA.ID, "service exit portability request")
	if err != nil {
		t.Fatal(err)
	}
	if exported.SchemaVersion != sellerDataExportSchemaVersion || exported.SnapshotVersion != CurrentPersistenceSchemaVersion || exported.Source != "ynx-seller-console-local-authority" {
		t.Fatalf("unexpected export metadata: %+v", exported)
	}
	if exported.Store.ID != storeA.ID || len(exported.Products) != 1 || exported.Products[0].ID != productA.ID || len(exported.Orders) != 1 || exported.Orders[0].ID != order.ID {
		t.Fatalf("export was not store scoped: %+v", exported)
	}
	if exported.Products[0].ID == productB.ID || exported.Store.ID == storeB.ID {
		t.Fatal("unrelated store data leaked into export")
	}
	if exported.Roles[ownerA] != SellerRoleOwner || len(exported.Invitations) != 1 {
		t.Fatalf("authority lifecycle missing from export: roles=%v invitations=%v", exported.Roles, exported.Invitations)
	}
	foundAudit := false
	for _, audit := range exported.Audits {
		if audit.Action == "seller_data_exported" && audit.ObjectID == storeA.ID {
			foundAudit = true
		}
	}
	if !foundAudit {
		t.Fatal("export access was not included in store-scoped audit evidence")
	}
	if _, err := store.ExportSellerData(ownerB, storeA.ID, "unauthorized"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected owner-only export, got %v", err)
	}

	exported.Products[0].Title = "mutated outside store"
	exported.Roles[ownerA] = SellerRoleViewer
	persistedProduct, err := store.Product(productA.ID)
	if err != nil {
		t.Fatal(err)
	}
	roles, err := store.SellerRoles(ownerA, storeA.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persistedProduct.Title == "mutated outside store" || roles[ownerA] != SellerRoleOwner {
		t.Fatal("export returned aliases into authoritative store state")
	}
}

func TestHTTPSellerDataExportRequiresCanonicalOwnerSession(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 74)
	_, viewer := actor(t, 75)
	created, _ := setupCatalog(t, store, owner, 1)
	invitation, err := store.CreateSellerInvitation(owner, created.ID, viewer, SellerRoleViewer, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.AcceptSellerInvitation(viewer, invitation.ID); err != nil {
		t.Fatal(err)
	}
	srv := NewServer(store, ServerConfig{Auth: testAuth{principals: map[string]Principal{"owner": principal(owner, "seller"), "viewer": principal(viewer, "seller")}}}).Handler()

	request := func(token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/seller/stores/"+created.ID+"/exports", bytes.NewBufferString(`{"Purpose":"operator-approved portability"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		return rec
	}
	if rec := request("viewer"); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer export status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec := request("owner")
	if rec.Code != http.StatusCreated {
		t.Fatalf("owner export status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Export SellerDataExport `json:"export"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Export.Store.ID != created.ID || body.Export.Roles[owner] != SellerRoleOwner {
		t.Fatalf("unexpected HTTP export: %+v", body.Export)
	}
}

func TestTransientRetentionPreviewAndPruneProtectAuthorityAndFinancialEvidence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	key := bytes.Repeat([]byte{0x3c}, 32)
	store, err := OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 29, 3, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	cutoff := now.Add(-45 * 24 * time.Hour)
	_, owner := actor(t, 76)
	created, product := setupCatalog(t, store, owner, 2)
	_, buyer := actor(t, 77)
	order, err := store.CreateOrder(buyer, orderInput(created, product, "retention-order-key-0001"))
	if err != nil {
		t.Fatal(err)
	}

	store.mu.Lock()
	store.s.AIJobs["old-terminal"] = AIJob{ID: "old-terminal", Actor: owner, Status: "rejected", UpdatedAt: cutoff.Add(-time.Hour)}
	store.s.AIJobs["old-retryable"] = AIJob{ID: "old-retryable", Actor: owner, Status: "failed", UpdatedAt: cutoff.Add(-time.Hour)}
	store.s.AIJobs["recent-terminal"] = AIJob{ID: "recent-terminal", Actor: owner, Status: "cancelled", UpdatedAt: cutoff.Add(time.Hour)}
	store.s.RequestWindow["old"] = []time.Time{cutoff.Add(-time.Hour), cutoff.Add(time.Hour)}
	store.s.Idempotency["protected"] = IdempotencyRecord{Actor: owner, Route: "store.create", Key: "protected", RequestHash: strings.Repeat("a", 64), ObjectID: created.ID, CreatedAt: cutoff.Add(-24 * time.Hour)}
	if err := store.persistLocked(); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()

	preview, err := store.PreviewTransientDataPrune(cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if preview.AIJobs != 1 || preview.RequestSamples != 1 {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	if _, err := store.PreviewTransientDataPrune(now.Add(-7 * 24 * time.Hour)); err == nil {
		t.Fatal("retention accepted a cutoff newer than the minimum boundary")
	}
	result, err := store.PruneTransientData(cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if result.AIJobs != 1 || result.RequestSamples != 1 {
		t.Fatalf("unexpected prune result: %+v", result)
	}

	reopened, err := OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := reopened.s.AIJobs["old-terminal"]; ok {
		t.Fatal("old terminal AI job survived retention prune")
	}
	if _, ok := reopened.s.AIJobs["old-retryable"]; !ok {
		t.Fatal("retryable failed AI job was destructively pruned")
	}
	if _, ok := reopened.s.AIJobs["recent-terminal"]; !ok {
		t.Fatal("recent terminal AI job was pruned before cutoff")
	}
	if len(reopened.s.RequestWindow["old"]) != 1 || !reopened.s.RequestWindow["old"][0].Equal(cutoff.Add(time.Hour)) {
		t.Fatalf("request-window retention mismatch: %v", reopened.s.RequestWindow["old"])
	}
	if _, ok := reopened.s.Idempotency["protected"]; !ok {
		t.Fatal("idempotency evidence was pruned")
	}
	if _, ok := reopened.s.Orders[order.ID]; !ok {
		t.Fatal("financial/order evidence was pruned")
	}
	if reopened.s.SellerRoles[created.ID][owner] != SellerRoleOwner || len(reopened.s.Audits) == 0 {
		t.Fatal("authority or audit evidence was pruned")
	}
}
