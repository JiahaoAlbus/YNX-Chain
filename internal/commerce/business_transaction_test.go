package commerce

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func businessProof(s *Store) businessActionAuthorization {
	return businessActionAuthorization{SessionBinding: strings.Repeat("a", 43), Nonce: strings.Repeat("b", 43), ExpiresAt: s.now().Add(30 * time.Second)}
}
func currentBusinessActor() error { return nil }

func TestBusinessNonceAndOriginalCartCommitTogetherAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, _ := Open(path)
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, product := setupCatalog(t, s, owner, 20)
	proof := businessProof(s)
	var temporary *Store
	err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error {
		temporary = tx
		_, err := tx.SaveCart(buyer, []CartItem{{ProductID: product.ID, VariantID: product.Variants[0].ID, Quantity: 2}})
		return err
	})
	if err != nil || len(s.Cart(buyer).Items) != 1 || len(s.s.BusinessNonces) != 1 {
		t.Fatal("cart and nonce were not committed", err)
	}
	// A retained temporary handle cannot mutate the published state.
	if _, err := temporary.SaveProfile(buyer, "temporary-only", nil); err != nil {
		t.Fatal(err)
	}
	if s.Profile(buyer).DisplayName != "" {
		t.Fatal("transaction leaked mutable state")
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	called := false
	err = reopened.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { called = true; return nil })
	if !errors.Is(err, ErrConflict) || called {
		t.Fatal("restarted proof executed twice", err)
	}
	if err := RestoreCommerceBackup(path, nil); err != nil {
		t.Fatal(err)
	}
	backup, _ := Open(path)
	if !reflect.DeepEqual(backup.s.BusinessNonces, reopened.s.BusinessNonces) || !reflect.DeepEqual(backup.Cart(buyer), reopened.Cart(buyer)) {
		t.Fatal("backup separated nonce from business write")
	}
}

func TestBusinessTransactionFailureCancelExpiryAndActorChangePublishNothing(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 2)
	now := s.now()
	s.now = func() time.Time { return now }
	proof := businessProof(s)
	before, _ := cloneSnapshot(s.s)
	work := func(tx *Store) error { _, err := tx.SaveProfile(buyer, "staged", nil); return err }
	want := errors.New("business rejected")
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { _ = work(tx); return want }); !errors.Is(err, want) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := s.withBusinessAction(ctx, proof, currentBusinessActor, func(tx *Store) error { err := work(tx); cancel(); return err }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	checks := 0
	if err := s.withBusinessAction(context.Background(), proof, func() error {
		checks++
		if checks == 2 {
			return ErrUnauthorized
		}
		return nil
	}, work); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("replacement actor accepted", err)
	}
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { err := work(tx); now = proof.ExpiresAt; return err }); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("expired during work accepted", err)
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("failed transaction published staged business or nonce")
	}
}

func TestBusinessTransactionPersistFailureRetainsOriginalStateAndRetry(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 2)
	proof := businessProof(s)
	before, _ := cloneSnapshot(s.s)
	blocked := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocked, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocked, "state")
	work := func(tx *Store) error { _, err := tx.SaveProfile(buyer, "confirmed", nil); return err }
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, work); err == nil {
		t.Fatal("persistence failure hidden")
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("failure consumed nonce or profile")
	}
	s.path = ""
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, work); err != nil || s.Profile(buyer).DisplayName != "confirmed" {
		t.Fatal("original retry failed", err)
	}
}

func TestConcurrentBusinessReplayExecutesOnceAndSeparateBindingIsIndependent(t *testing.T) {
	s, _ := Open("")
	proof := businessProof(s)
	var called atomic.Int32
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { called.Add(1); return nil })
		}()
	}
	wg.Wait()
	close(results)
	ok, rejected := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else if errors.Is(err, ErrConflict) {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	if ok != 1 || rejected != 1 || called.Load() != 1 {
		t.Fatal("concurrent replay executed", ok, rejected, called.Load())
	}
	proof.SessionBinding = strings.Repeat("c", 43)
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { return nil }); err != nil {
		t.Fatal("separate binding conflicted", err)
	}
	if err := s.ExportRollbackSnapshot(filepath.Join(t.TempDir(), "old"), 10); !errors.Is(err, ErrConflict) {
		t.Fatal("old writer can lose consumed proofs", err)
	}
}

func TestBusinessOrderFailureRollsBackReservationCartAndKeyThenFreshProofRecovers(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	store, product := setupCatalog(t, s, owner, 20)
	in := orderInput(store, product, "verified-business-checkout")
	cart, err := s.SaveCart(buyer, in.Items)
	if err != nil {
		t.Fatal(err)
	}
	in.CartRevision = &cart.Revision
	proof := businessProof(s)
	before, _ := cloneSnapshot(s.s)
	var order Order
	work := func(tx *Store) error { var err error; order, err = tx.CreateOrder(buyer, in); return err }
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error {
		if err := work(tx); err != nil {
			return err
		}
		return ErrUnauthorized
	}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("rejected order retained reservation/cart consumption/key/nonce")
	}
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, work); err != nil {
		t.Fatal(err)
	}
	id := order.ID
	newCart, err := s.SaveCart(buyer, in.Items)
	if err != nil {
		t.Fatal(err)
	}
	proof.Nonce = strings.Repeat("d", 43)
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, work); err != nil || order.ID != id || !reflect.DeepEqual(newCart, s.Cart(buyer)) {
		t.Fatal("fresh proof recovery recreated order or consumed newer cart", err)
	}
}

func TestBusinessReplayDigestsSurviveDeletionAndRefuseOlderBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, _ := Open(path)
	_, buyer := actor(t, 2)
	if _, err := s.SaveProfile(buyer, "original", nil); err != nil {
		t.Fatal(err)
	}
	old, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	proof := businessProof(s)
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { _, err := tx.SaveProfile(buyer, "changed", nil); return err }); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", old, 0600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCommerceBackup(path, nil); !errors.Is(err, ErrConflict) {
		t.Fatal("older backup discarded consumed nonce", err)
	}
	if _, err := s.DeleteBuyerData(buyer); err != nil {
		t.Fatal(err)
	}
	if s.Profile(buyer).DisplayName != "" {
		t.Fatal("buyer profile retained")
	}
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { _, err := tx.SaveProfile(buyer, "revived", nil); return err }); !errors.Is(err, ErrConflict) {
		t.Fatal("privacy deletion released consumed proof", err)
	}
}
