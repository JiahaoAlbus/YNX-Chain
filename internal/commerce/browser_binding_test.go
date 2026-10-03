package commerce

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCommerceBrowserAssociationPersistenceAndMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	original := emptySnapshot()
	original.Version = 14
	original.BuyerProfiles["original-account"] = BuyerProfile{DisplayName: "Original profile"}
	raw, _ := json.Marshal(original)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if store.s.Version != 15 || store.s.BuyerProfiles["original-account"].DisplayName != "Original profile" {
		t.Fatal("migration lost original profile")
	}
	proof := businessActionAuthorization{SessionBinding: strings.Repeat("s", 43), Nonce: strings.Repeat("n", 43), ExpiresAt: time.Now().Add(time.Minute)}
	verified := &verifiedBusinessRequest{proof: proof, browserBindingDigest: strings.Repeat("a", 64)}
	ctx := context.WithValue(context.Background(), businessRequestContextKey{}, verified)
	if err := store.withBusinessAction(ctx, proof, func() error { return nil }, func(*Store) error { return nil }); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	key := effectDigest("original-browser-binding", proof.SessionBinding)
	if reopened.s.BusinessBrowserBindings[key] != verified.browserBindingDigest {
		t.Fatal("original association not durable")
	}
	candidate, _ := cloneSnapshot(reopened.s)
	delete(candidate.BusinessBrowserBindings, key)
	if containsRetiredIntents(candidate, reopened.s) {
		t.Fatal("restore could erase original association")
	}
	if _, err := reopened.rollbackSnapshotLocked(14); !errors.Is(err, ErrConflict) {
		t.Fatal("old format could discard Browser protection", err)
	}
	before, _ := json.Marshal(reopened.s)
	verified.browserBindingDigest = strings.Repeat("b", 64)
	proof.Nonce = strings.Repeat("z", 43)
	verified.proof = proof
	if err := reopened.withBusinessAction(ctx, proof, func() error { return nil }, func(*Store) error { t.Fatal("replaced Browser reached business work"); return nil }); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("replacement admitted", err)
	}
	after, _ := json.Marshal(reopened.s)
	if string(before) != string(after) {
		t.Fatal("replacement changed protected state")
	}
}

func TestCommerceOriginalCancellationReturnsUnavailable(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	verified := &verifiedBusinessRequest{principal: Principal{ExpiresAt: time.Now().Add(time.Minute)}, fence: func() error { t.Fatal("cancelled request reached actor fence"); return nil }}
	var unavailable *businessHTTPError
	if err := verified.current(ctx); !errors.As(err, &unavailable) || unavailable.status != 503 {
		t.Fatal("original cancellation returned authority", err)
	}
}
