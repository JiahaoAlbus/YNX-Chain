package commerce

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPrivacyDeletionRejectsRetiredIntentAfterRestartAndMaintenance(t *testing.T) {
	for _, authenticated := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "authenticated"}[authenticated], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "commerce.json")
			var integrityKey []byte
			if authenticated {
				integrityKey = bytes.Repeat([]byte{0x6b}, 32)
			}
			s, err := open(path, integrityKey)
			if err != nil {
				t.Fatal(err)
			}
			_, owner := actor(t, 71)
			_, buyer := actor(t, 72)
			_, anotherBuyer := actor(t, 73)
			shop, product := setupCatalog(t, s, owner, 4)
			input := orderInput(shop, product, "retired-private-order-intent")
			order, err := s.CreateOrder(buyer, input)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil, "retired-private-cancel-intent"); err != nil {
				t.Fatal(err)
			}
			ai := AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "Private comparison request", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "retired-private-ai-intent"}
			if _, err := s.CreateAIJob(buyer, ai); err != nil {
				t.Fatal(err)
			}
			if _, err := s.DeleteBuyerData(buyer); err != nil {
				t.Fatal(err)
			}
			assertRejected := func() {
				t.Helper()
				before, _ := s.Product(product.ID)
				orderCount := len(s.s.Orders)
				jobCount := len(s.s.AIJobs)
				if result, err := s.CreateOrder(buyer, input); !errors.Is(err, ErrConflict) || result.ID != "" {
					t.Fatalf("deleted order intent was treated as a new purchase: id=%s err=%v", result.ID, err)
				}
				changed := input
				changed.Address.Line1 = "A different address"
				if _, err := s.CreateOrder(buyer, changed); !errors.Is(err, ErrConflict) {
					t.Fatalf("changed request revived a retired key: %v", err)
				}
				if result, err := s.CreateAIJob(buyer, ai); !errors.Is(err, ErrConflict) || result.ID != "" {
					t.Fatalf("deleted AI intent was recreated: id=%s err=%v", result.ID, err)
				}
				after, _ := s.Product(product.ID)
				if len(s.s.Orders) != orderCount || len(s.s.AIJobs) != jobCount || before.Variants[0].Reserved != after.Variants[0].Reserved {
					t.Fatal("rejected intent changed orders, AI jobs or inventory")
				}
			}
			assertRejected()
			s, err = open(path, integrityKey)
			if err != nil {
				t.Fatal(err)
			}
			assertRejected()
			if _, err := s.PruneTransientData(time.Now().UTC().Add(-365 * 24 * time.Hour)); err != nil {
				t.Fatal(err)
			}
			if err := s.Recover(); err != nil {
				t.Fatal(err)
			}
			s, err = open(path, integrityKey)
			if err != nil {
				t.Fatal(err)
			}
			assertRejected()
			// A new purchase is still permitted, and another account does not
			// inherit this account's key revocations.
			fresh := input
			fresh.IdempotencyKey = "fresh-private-order-intent"
			if result, err := s.CreateOrder(buyer, fresh); err != nil || result.ID == order.ID {
				t.Fatalf("new buyer intent was blocked: %v", err)
			}
			if _, err := s.CreateOrder(anotherBuyer, input); err != nil {
				t.Fatalf("retired key leaked across account scope: %v", err)
			}
			freshAI := ai
			freshAI.IdempotencyKey = input.IdempotencyKey
			if _, err := s.CreateAIJob(buyer, freshAI); err != nil {
				t.Fatalf("retired key leaked across route scope: %v", err)
			}
		})
	}
}

func TestPrivacyDeletionMetadataIsOpaqueAndReceiptRetryPreservesNewData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 71)
	_, buyer := actor(t, 72)
	shop, product := setupCatalog(t, s, owner, 4)
	if _, err := s.SaveProfile(buyer, "Old private name", []Address{{Recipient: "Old private name", Line1: "Old private address", Country: "PT"}}); err != nil {
		t.Fatal(err)
	}
	intents := []RetiredIntent{{Route: "order.create", Key: "private-unseen-order-key"}, {Route: "ai.create", Key: "private-unseen-ai-key"}}
	requestID := "a8d65c43-0b54-4126-93a8-f3cd093f9d9e"
	first, err := s.DeleteBuyerDataRequest(buyer, requestID, intents)
	if err != nil {
		t.Fatal(err)
	}
	if first.DeletionRequestID != requestID || first.RetiredIntentsVersion != 1 || first.RetiredIntentsCount != len(intents) {
		t.Fatal("deletion receipt did not acknowledge the supplied request")
	}
	if len(s.s.RetiredIdempotency) != 2 || len(s.s.BuyerDeletions) != 1 {
		t.Fatal("missing durable deletion protection")
	}
	for digest := range s.s.RetiredIdempotency {
		decoded, err := hex.DecodeString(digest)
		if err != nil || len(decoded) != 32 {
			t.Fatal("retired record is not a SHA-256 digest")
		}
	}
	metadata, _ := json.Marshal([]any{s.s.RetiredIdempotency, s.s.BuyerDeletions})
	for _, private := range []string{buyer, requestID, intents[0].Key, intents[1].Key, "Old private name", "Old private address", "order.create", "ai.create"} {
		if bytes.Contains(metadata, []byte(private)) {
			t.Fatalf("deletion protection retained plaintext request data of length %d", len(private))
		}
	}
	// A response consumer cannot alter the persisted receipt's retention notice.
	first.RetainedRecords[0] = "response mutation"
	if _, err := s.SaveProfile(buyer, "New profile from another device", nil); err != nil {
		t.Fatal(err)
	}
	newOrder, err := s.CreateOrder(buyer, orderInput(shop, product, "new-order-after-deletion"))
	if err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PruneTransientData(time.Now().UTC().Add(-365 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(s.s)
	replayed, err := s.DeleteBuyerDataRequest(buyer, requestID, []RetiredIntent{intents[1], intents[0]})
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(s.s)
	if !bytes.Equal(before, after) || replayed.ReceiptID != first.ReceiptID || replayed.DeletedAt != first.DeletedAt || replayed.DeletionRequestID != requestID || replayed.RetainedRecords[0] == "response mutation" {
		t.Fatal("receipt replay changed current state or repeated deletion")
	}
	if s.Profile(buyer).DisplayName != "New profile from another device" {
		t.Fatal("deletion retry erased new profile")
	}
	if got, err := s.Order(buyer, "buyer", newOrder.ID); err != nil || got.Status != "payment_pending" {
		t.Fatal("deletion retry erased a new active order")
	}
	changed := append([]RetiredIntent(nil), intents...)
	changed[0].Key = "a-different-new-intent"
	if _, err := s.DeleteBuyerDataRequest(buyer, requestID, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("same request ID accepted a changed intent list: %v", err)
	}
	unchanged, _ := json.Marshal(s.s)
	if !bytes.Equal(after, unchanged) {
		t.Fatal("conflicting deletion retry changed state")
	}
	_, anotherBuyer := actor(t, 73)
	if _, err := s.SaveProfile(anotherBuyer, "Other account data", nil); err != nil {
		t.Fatal(err)
	}
	otherReceipt, err := s.DeleteBuyerDataRequest(anotherBuyer, requestID, intents)
	if err != nil || otherReceipt.ReceiptID == first.ReceiptID || !otherReceipt.ProfileDeleted {
		t.Fatalf("deletion receipt key crossed the authenticated account boundary: %v", err)
	}
}

func TestPrivacyDeletionValidationAndFailureAreAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 71)
	_, buyer := actor(t, 72)
	shop, product := setupCatalog(t, s, owner, 4)
	if _, err := s.SaveProfile(buyer, "Private name", []Address{{Recipient: "Private", Line1: "Private address", Country: "PT"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveCart(buyer, []CartItem{{ProductID: product.ID, VariantID: product.Variants[0].ID, Quantity: 1}}); err != nil {
		t.Fatal(err)
	}
	input := orderInput(shop, product, "atomic-existing-order-key")
	order, err := s.CreateOrder(buyer, input)
	if err != nil {
		t.Fatal(err)
	}
	cancelIntent := RetiredIntent{Route: "order.transition." + order.ID, Key: "atomic-cancel-request-key"}
	if _, err := s.DeleteBuyerDataRequest(buyer, "atomic-delete-request", []RetiredIntent{cancelIntent}); !errors.Is(err, ErrInvalidState) {
		t.Fatal("active order did not prevent deletion")
	}
	if len(s.s.RetiredIdempotency) != 0 || len(s.s.BuyerDeletions) != 0 {
		t.Fatal("failed active-order deletion retired recovery intents")
	}
	if _, err := s.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil, cancelIntent.Key); err != nil {
		t.Fatalf("failed deletion blocked order recovery: %v", err)
	}
	tooMany := make([]RetiredIntent, 129)
	for i := range tooMany {
		tooMany[i] = RetiredIntent{Route: "order.create", Key: "large-list-intent-key"}
	}
	valid := RetiredIntent{Route: "order.create", Key: "valid-frozen-intent-key"}
	for _, intents := range [][]RetiredIntent{
		{{Route: "profile.put", Key: "private-invalid-route"}},
		{{Route: "order.transition.order_../etc", Key: "private-path-request"}},
		{{Route: "order.transition.order_" + strings.Repeat("A", 24), Key: "private-case-request"}},
		{{Route: "ai.create", Key: "short"}},
		{{Route: "order.create", Key: strings.Repeat("x", 129)}},
		{valid, valid}, tooMany,
	} {
		before, _ := json.Marshal(s.s)
		if _, err := s.DeleteBuyerDataRequest(buyer, "atomic-delete-request", intents); err == nil {
			t.Fatal("invalid deletion intent accepted")
		}
		after, _ := json.Marshal(s.s)
		if !bytes.Equal(before, after) {
			t.Fatal("invalid deletion request changed state")
		}
	}
	before, _ := json.Marshal(s.s)
	onDisk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// Block the backup rename to force a real persistence error after all
	// in-memory deletion stages and verify the whole transaction rolls back.
	if err := os.Remove(path + ".bak"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path+".bak", 0o700); err != nil {
		t.Fatal(err)
	}
	if receipt, err := s.DeleteBuyerDataRequest(buyer, "atomic-delete-request", []RetiredIntent{valid}); err == nil || receipt.ReceiptID != "" {
		t.Fatal("failed persistence reported successful deletion")
	}
	after, _ := json.Marshal(s.s)
	stillOnDisk, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) || !bytes.Equal(onDisk, stillOnDisk) {
		t.Fatal("failed deletion left changed memory or active state")
	}
	if err := os.Remove(path + ".bak"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteBuyerDataRequest(buyer, "atomic-delete-request", []RetiredIntent{valid}); err != nil {
		t.Fatal(err)
	}
	if len(s.s.RetiredIdempotency) != 3 || len(s.s.BuyerDeletions) != 1 {
		t.Fatal("successful retry failed to persist all protection")
	}
}

func TestPrivacyHTTPSealsLateRequestsAndVerifiesDeletionReceipt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 71)
	_, buyer := actor(t, 72)
	shop, product := setupCatalog(t, s, owner, 4)
	if _, err := s.SaveProfile(buyer, "To delete", nil); err != nil {
		t.Fatal(err)
	}
	input := orderInput(shop, product, "late-unseen-order-request")
	ai := AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "Late comparison request", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "late-unseen-ai-request"}
	entered, release := make(chan struct{}), make(chan struct{})
	api := NewServer(s, ServerConfig{Auth: testAuth{principals: map[string]Principal{"buyer-token": principal(buyer, "buyer")}}}).Handler()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Test-Hold-Order") == "yes" {
			close(entered)
			<-release
		}
		api.ServeHTTP(w, r)
	}))
	defer server.Close()
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	lateResult := make(chan int, 1)
	lateError := make(chan error, 1)
	go func() {
		body, _ := json.Marshal(input)
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/orders", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer buyer-token")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Test-Hold-Order", "yes")
		response, err := server.Client().Do(req)
		if err != nil {
			lateError <- err
			return
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		lateResult <- response.StatusCode
	}()
	<-entered
	requestID := "45459c47-5d4d-4e41-a3a3-8cfa736d745a"
	deletion := map[string]any{"confirmation": "DELETE_MY_SHOP_DATA", "deletionRequestId": requestID, "retiredIntents": []RetiredIntent{{Route: "order.create", Key: input.IdempotencyKey}, {Route: "ai.create", Key: ai.IdempotencyKey}}}
	var receipt BuyerDataDeletionReceipt
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/privacy/delete", "buyer-token", deletion, http.StatusOK, &receipt)
	unblock()
	select {
	case code := <-lateResult:
		if code != http.StatusConflict {
			t.Fatalf("late order POST returned %d", code)
		}
	case err := <-lateError:
		t.Fatal(err)
	}
	if receipt.RetiredIntentsVersion != 1 || receipt.RetiredIntentsCount != 2 || receipt.DeletionRequestID != requestID {
		t.Fatal("HTTP receipt did not acknowledge the frozen deletion request")
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/ai/jobs", "buyer-token", ai, http.StatusConflict, nil)
	if len(s.s.Orders) != 0 || len(s.s.AIJobs) != 0 || s.s.Products[product.ID].Variants[0].Reserved != 0 {
		t.Fatal("late request executed after deletion")
	}
	if _, err := s.SaveProfile(buyer, "New data", nil); err != nil {
		t.Fatal(err)
	}
	var replay BuyerDataDeletionReceipt
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/privacy/delete", "buyer-token", deletion, http.StatusOK, &replay)
	if replay.ReceiptID != receipt.ReceiptID || s.Profile(buyer).DisplayName != "New data" {
		t.Fatal("HTTP receipt retry deleted new data")
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/privacy/delete", "buyer-token", map[string]any{"confirmation": "DELETE_MY_SHOP_DATA", "retiredIntents": []map[string]string{{"route": "order.create", "key": "unknown-extra-fields", "actor": owner}}}, http.StatusBadRequest, nil)
	if s.Profile(buyer).DisplayName != "New data" {
		t.Fatal("malformed HTTP request deleted data")
	}
}

func TestPrivacyProtectionSurvivesRecoveryAndRefusesOlderRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	key := bytes.Repeat([]byte{0x79}, 32)
	s, err := OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	_, buyer := actor(t, 72)
	if _, err := s.SaveProfile(buyer, "Old profile", nil); err != nil {
		t.Fatal(err)
	}
	beforeDeletion, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	intents := []RetiredIntent{{Route: "order.create", Key: "recover-retired-order-key"}}
	if _, err := s.DeleteBuyerDataRequest(buyer, "recovery-request-id", intents); err != nil {
		t.Fatal(err)
	}
	protected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	backup, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(protected, backup) {
		t.Fatal("successful deletion left a pre-deletion recovery backup")
	}
	if err := os.WriteFile(path+".bak", beforeDeletion, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCommerceBackup(path, key); !errors.Is(err, ErrConflict) {
		t.Fatalf("older backup discarded current protection: %v", err)
	}
	if err := os.WriteFile(path+persistenceRollbackSuffix, beforeDeletion, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCommercePersistenceRollback(path, key); !errors.Is(err, ErrConflict) {
		t.Fatalf("older recovery point discarded current protection: %v", err)
	}
	for _, target := range []int{3, 4, 5, 6, 7} {
		if err := s.ExportRollbackSnapshot(filepath.Join(t.TempDir(), "old.json"), target); !errors.Is(err, ErrConflict) {
			t.Fatalf("unsafe v%d export succeeded: %v", target, err)
		}
	}
	if _, err := RollbackCommercePersistence(path, key, 1); !errors.Is(err, ErrConflict) {
		t.Fatalf("unsafe v1 rollback succeeded: %v", err)
	}
	unchanged, _ := os.ReadFile(path)
	if !bytes.Equal(unchanged, protected) {
		t.Fatal("refused recovery changed active state")
	}
	if err := os.WriteFile(path+".bak", backup, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("damaged active snapshot"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCommercePersistenceRollback(path, key); !errors.Is(err, ErrConflict) {
		t.Fatalf("damaged primary allowed an older recovery point despite a valid newer backup: %v", err)
	}
	if err := RestoreCommerceBackup(path, key); err != nil {
		t.Fatal(err)
	}
	s, err = OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.s.RetiredIdempotency) != 1 || len(s.s.BuyerDeletions) != 1 || s.Profile(buyer).DisplayName != "" {
		t.Fatal("normal verified recovery revived deleted data or removed protection")
	}
}

func TestPrivacySchemaV7MigrationPreservesExistingIdempotency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, _ := Open("")
	_, owner := actor(t, 71)
	_, buyer := actor(t, 72)
	shop, product := setupCatalog(t, s, owner, 4)
	input := orderInput(shop, product, "legacy-intent-hash-unchanged")
	order, err := s.CreateOrder(buyer, input)
	if err != nil {
		t.Fatal(err)
	}
	expected := s.s.Idempotency[idemMapKey(buyer, "order.create", input.IdempotencyKey)]
	s.s.Version = 7
	data, _ := json.Marshal(s.s)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	delete(fields, "RetiredIdempotency")
	delete(fields, "BuyerDeletions")
	delete(fields, "PrivacyDeletionBoundary")
	legacy, _ := json.Marshal(fields)
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if s.s.Version != 8 || s.s.RetiredIdempotency == nil || s.s.BuyerDeletions == nil || !reflect.DeepEqual(expected, s.s.Idempotency[idemMapKey(buyer, "order.create", input.IdempotencyKey)]) {
		t.Fatal("v7 migration changed an existing idempotency record")
	}
	if result, err := s.CreateOrder(buyer, input); err != nil || result.ID != order.ID {
		t.Fatalf("existing intent stopped replaying after migration: %v", err)
	}
}

func TestPrivacyLegacyDeletionAlwaysAdvancesRecoveryBoundary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, buyer := actor(t, 72)
	for _, name := range []string{"First private profile", "Another device's new profile"} {
		if _, err := s.SaveProfile(buyer, name, nil); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(path)
		previousBoundary := s.s.PrivacyDeletionBoundary
		if _, err := s.DeleteBuyerData(buyer); err != nil {
			t.Fatal(err)
		}
		if s.s.PrivacyDeletionBoundary == "" || s.s.PrivacyDeletionBoundary == previousBoundary {
			t.Fatal("legacy deletion did not advance its anonymous recovery boundary")
		}
		if len(s.s.RetiredIdempotency) != 0 || len(s.s.BuyerDeletions) != 0 {
			t.Fatal("fixture unexpectedly relied on retired keys or a deletion request ID")
		}
		protected, _ := os.ReadFile(path)
		backup, _ := os.ReadFile(path + ".bak")
		if !bytes.Equal(protected, backup) {
			t.Fatal("legacy profile-only deletion left a pre-deletion normal backup")
		}
		if err := os.WriteFile(path+".bak", before, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := RestoreCommerceBackup(path, nil); !errors.Is(err, ErrConflict) {
			t.Fatalf("legacy deletion was reversed by an older backup: %v", err)
		}
		if err := os.WriteFile(path+".bak", backup, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := RestoreCommerceBackup(path, nil); err != nil {
			t.Fatal(err)
		}
		s, err = Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if s.Profile(buyer).DisplayName != "" {
			t.Fatal("normal recovery revived a deleted profile")
		}
	}
}

func TestPrivacyPrimaryCommitFailureRestoresOriginalBackupAndMemory(t *testing.T) {
	for _, hasBackup := range []bool{false, true} {
		t.Run(map[bool]string{false: "no prior backup", true: "existing backup"}[hasBackup], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "commerce.json")
			s, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			_, buyer := actor(t, 72)
			if _, err := s.SaveProfile(buyer, "Private profile", nil); err != nil {
				t.Fatal(err)
			}
			if hasBackup {
				if _, err := s.SaveProfile(buyer, "Private profile", nil); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := json.Marshal(s.s)
			activeBefore, _ := os.ReadFile(path)
			backupBefore, backupErr := os.ReadFile(path + ".bak")
			if err := os.Mkdir(path+".tmp", 0o700); err != nil {
				t.Fatal(err)
			}
			intents := []RetiredIntent{{Route: "order.create", Key: "failed-primary-commit-key"}}
			if receipt, err := s.DeleteBuyerDataRequest(buyer, "failed-primary-request-id", intents); err == nil || receipt.ReceiptID != "" {
				t.Fatal("failed primary commit reported successful deletion")
			}
			after, _ := json.Marshal(s.s)
			activeAfter, _ := os.ReadFile(path)
			backupAfter, afterBackupErr := os.ReadFile(path + ".bak")
			if !bytes.Equal(before, after) || !bytes.Equal(activeBefore, activeAfter) {
				t.Fatal("failed primary commit changed memory or active state")
			}
			if backupErr == nil {
				if afterBackupErr != nil || !bytes.Equal(backupBefore, backupAfter) {
					t.Fatal("failed primary commit changed the original recovery backup")
				}
			} else if !errors.Is(backupErr, os.ErrNotExist) || !errors.Is(afterBackupErr, os.ErrNotExist) {
				t.Fatal("failed primary commit retained a new recovery backup")
			}
			if err := os.Remove(path + ".tmp"); err != nil {
				t.Fatal(err)
			}
			if hasBackup {
				if err := RestoreCommerceBackup(path, nil); err != nil {
					t.Fatal(err)
				}
				restored, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				if restored.Profile(buyer).DisplayName != "Private profile" || hasPrivacyProtection(restored.s) {
					t.Fatal("failed deletion became durable through backup recovery")
				}
			}
		})
	}
}
