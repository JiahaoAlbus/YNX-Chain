package commerce

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestCartIntentReplayAfterRemoteEditDoesNotOverwriteAndSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cart.json")
	s, _ := Open(path)
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, other := actor(t, 3)
	_, p := setupCatalog(t, s, owner, 40)
	empty := ""
	in := CartInput{Items: []CartItem{{ProductID: p.ID, VariantID: p.Variants[0].ID, Quantity: 1}}, ExpectedRevision: &empty, IdempotencyKey: "exact-cart-intent"}
	receipt, err := s.SaveCartIntent(buyer, in)
	if err != nil {
		t.Fatal(err)
	}
	laterItems := append([]CartItem(nil), in.Items...)
	laterItems[0].Quantity = 3
	later, err := s.SaveCartRevision(buyer, laterItems, &receipt.Revision)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := reopened.SaveCartIntent(buyer, in)
	if err != nil || !reflect.DeepEqual(replay, receipt) || !reflect.DeepEqual(reopened.Cart(buyer), later) {
		t.Fatal("replay replaced newer cart", err)
	}
	changed := in
	changed.Items = laterItems
	if _, err = reopened.SaveCartIntent(buyer, changed); !errors.Is(err, ErrConflict) {
		t.Fatal("changed key reused", err)
	}
	if _, err = reopened.SaveCartIntent(other, in); err != nil {
		t.Fatal("another buyer affected", err)
	}
}
func TestDeletionRetiresReceivedAndNotYetReceivedCartWrites(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, p := setupCatalog(t, s, owner, 40)
	empty := ""
	in := CartInput{Items: []CartItem{{ProductID: p.ID, VariantID: p.Variants[0].ID, Quantity: 1}}, ExpectedRevision: &empty, IdempotencyKey: "received-cart-write"}
	if _, err := s.SaveCartIntent(buyer, in); err != nil {
		t.Fatal(err)
	}
	receipt, err := s.DeleteBuyerData(buyer, RetiredIntent{Route: "cart.save", Key: "not-yet-received-cart-write"})
	if err != nil || receipt.IdempotencyDeleted != 1 {
		t.Fatal("cart receipt retained", err)
	}
	if _, err = s.SaveCartIntent(buyer, in); !errors.Is(err, ErrConflict) {
		t.Fatal("deleted cart revived", err)
	}
	in.IdempotencyKey = "not-yet-received-cart-write"
	if _, err = s.SaveCartIntent(buyer, in); !errors.Is(err, ErrConflict) {
		t.Fatal("late cart repopulated", err)
	}
	if len(s.Cart(buyer).Items) != 0 {
		t.Fatal("deleted cart returned")
	}
	for _, record := range s.s.Idempotency {
		if record.Actor == buyer {
			t.Fatal("deleted buyer idempotency receipt retained")
		}
	}
}
func TestFailedCartIntentCommitLeavesKeyAndSnapshotUntouched(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, p := setupCatalog(t, s, owner, 40)
	empty := ""
	in := CartInput{Items: []CartItem{{ProductID: p.ID, VariantID: p.Variants[0].ID, Quantity: 1}}, ExpectedRevision: &empty, IdempotencyKey: "cart-persistence-failure"}
	before, _ := cloneSnapshot(s.s)
	blocked := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocked, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocked, "state.json")
	if _, err := s.SaveCartIntent(buyer, in); err == nil {
		t.Fatal("write failure hidden")
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("failed cart intent published")
	}
	s.path = ""
	if _, err := s.SaveCartIntent(buyer, in); err != nil {
		t.Fatal("same key stopped working", err)
	}
}
